import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OnlineStats, AnomalyDetector, HeuristicEngine, PolicyEngine, LinearModel } from "ml";
import MCPServer from "mcp";
import { IoTDevice } from "iotdevice";
import { createDeviceMCP } from "iotbridge";

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
function check(name, fn) {
	fn();
	passed += 1;
	console.log(`ok  ${name}`);
}

check("welford stats", () => {
	const stats = new OnlineStats;
	[2, 4, 4, 4, 5, 5, 7, 9].forEach(value => stats.update(value));
	assert.equal(stats.mean, 5);
	assert.ok(Math.abs(stats.variance - (32 / 7)) < 1e-10);
});

check("anomaly z-score", () => {
	const detector = new AnomalyDetector({ zLimit: 3, minSamples: 5 });
	for (let i = 0; i < 10; i++)
		detector.update(20 + (i % 2) * 0.2);
	assert.equal(detector.score(20.1).anomaly, false);
	assert.equal(detector.score(80).anomaly, true);
});

check("policy maps heat to fan", () => {
	const engine = new HeuristicEngine;
	engine.addChannel("temperature", { unit: "C" });
	for (let i = 0; i < 6; i++)
		engine.observe({ temperature: 21 + i });
	const policy = new PolicyEngine([
		{ id: "cool", when: { sensor: "temperature", op: ">", value: 24 }, then: { controller: "fan", value: 1 } }
	]);
	const actions = policy.evaluate(engine);
	assert.equal(actions[0].controller, "fan");
});

check("linear model separates classes", () => {
	const model = new LinearModel({ labels: ["ok", "alert"] });
	model.fit([
		{ x: [0, 0], y: 0 },
		{ x: [0.1, 0.2], y: 0 },
		{ x: [3, 3], y: 1 },
		{ x: [2.8, 3.2], y: 1 }
	], { epochs: 160, learningRate: 0.25 });
	assert.equal(model.predict([0.05, 0.1]).label, "ok");
	assert.equal(model.predict([3.1, 2.9]).label, "alert");
});

check("mcp initialize and tools", () => {
	const server = new MCPServer({
		name: "unit",
		tools: [{ name: "echo", handler(args) { return { heard: args.text }; } }]
	});
	const init = server.handle({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } }
	});
	assert.equal(init.result.protocolVersion, "2025-03-26");
	const listed = server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	assert.equal(listed.result.tools[0].name, "echo");
	const called = server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
	assert.match(called.result.content[0].text, /hi/);
	assert.equal(server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
	assert.equal(JSON.parse(server.handleText("{nope")).error.code, -32700);
});

check("device auto mode runs heuristics", () => {
	const device = new IoTDevice({ name: "unit-device" });
	device.inject("temperature", 34);
	const snap = device.sample();
	assert.equal(snap.mode, "auto");
	assert.equal(snap.controllers.fan.value, 1);
	assert.ok(snap.actions.some(action => "fan" === action.controller));
	device.setMode("manual");
	device.setController("fan", 0, "test");
	assert.equal(device.snapshot().controllers.fan.value, 0);
	assert.equal(device.snapshot().mode, "manual");
});

check("device MCP tools expose telemetry", () => {
	const device = new IoTDevice({ name: "bridged" });
	for (let i = 0; i < 8; i++)
		device.sample();
	const mcp = createDeviceMCP(device);
	mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
	const tools = mcp.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
	const names = tools.result.tools.map(tool => tool.name);
	for (const needed of ["read_sensors", "set_controller", "set_mode", "get_heuristics", "train_baseline", "predict"])
		assert.ok(names.includes(needed), needed);
	const status = mcp.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_device_status", arguments: {} } });
	assert.match(status.result.content[0].text, /bridged/);
	const resource = mcp.handle({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "iot://status" } });
	assert.equal(resource.result.contents[0].uri, "iot://status");
});

async function rpc(port, payload) {
	const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(payload)
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
}

async function waitForHealth(port) {
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`);
			if (response.ok)
				return await response.json();
		}
		catch {
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`host server on ${port} did not start`);
}

const port = 18080;
const child = spawn(process.execPath, ["--import", join(here, "node-aliases.mjs"), join(here, "host-server.mjs")], {
	env: { ...process.env, MCP_PORT: String(port), SAMPLE_MS: "80" },
	stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk; });
try {
	await waitForHealth(port);
	const page = await fetch(`http://127.0.0.1:${port}/`);
	const html = await page.text();
	assert.equal(page.headers.get("content-type")?.includes("text/html"), true);
	assert.match(html, /Sensors/);
	assert.match(html, /Controllers/);

	const discovery = await fetch(`http://127.0.0.1:${port}/mcp`);
	const info = await discovery.json();
	assert.equal(info.protocol, "mcp");
	assert.ok(discovery.headers.get("mcp-session-id"));

	const init = await rpc(port, {
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "node-test", version: "0" } }
	});
	assert.equal(init.body.result.serverInfo.name, "esp32-s3-iot-host");
	await rpc(port, { jsonrpc: "2.0", method: "notifications/initialized" });

	const listed = await rpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list" });
	assert.ok(listed.body.result.tools.find(tool => "inject_sample" === tool.name));

	await rpc(port, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "set_mode", arguments: { mode: "auto" } } });
	const injected = await rpc(port, {
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: { name: "inject_sample", arguments: { name: "temperature", value: 36 } }
	});
	assert.match(injected.body.result.content[0].text, /"fan":\{"value":1/);

	const diagnose = await rpc(port, { jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "diagnose" } });
	assert.equal(diagnose.body.result.messages[0].role, "user");
	passed += 1;
	console.log("ok  http mcp host");
}
catch (error) {
	console.error(stderr);
	throw error;
}
finally {
	child.kill("SIGTERM");
	await new Promise(resolve => child.once("exit", resolve));
}

console.log(`${passed} checks passed`);
