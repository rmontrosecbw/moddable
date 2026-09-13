import http from "node:http";
import { IoTDevice } from "iotdevice";
import { createDeviceMCP } from "iotbridge";

const port = Number(process.env.MCP_PORT ?? 8080);
const device = new IoTDevice({ name: process.env.DEVICE_NAME ?? "esp32-s3-iot-host" });
const mcp = createDeviceMCP(device);

const interval = setInterval(() => device.sample(), Number(process.env.SAMPLE_MS ?? 250));

function send(response, status, headers, body) {
	const payload = Buffer.from("string" === typeof body ? body : JSON.stringify(body));
	response.writeHead(status, {
		"Content-Length": payload.length,
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Mcp-Session-Id": mcp.sessionId,
		"MCP-Protocol-Version": mcp.protocolVersion,
		...headers
	});
	response.end(payload);
}

const server = http.createServer((request, response) => {
	const url = new URL(request.url, `http://127.0.0.1:${port}`);
	if ("OPTIONS" === request.method)
		return send(response, 204, { "Content-Type": "text/plain" }, "");

	if ("/" === url.pathname && "GET" === request.method)
		return send(response, 200, { "Content-Type": "text/html; charset=utf-8" }, device.statusPage());

	if ("/health" === url.pathname)
		return send(response, 200, { "Content-Type": "application/json" }, { ok: true, serverInfo: mcp.serverInfo, snapshot: device.snapshot() });

	if ("/mcp" === url.pathname && "GET" === request.method) {
		return send(response, 200, { "Content-Type": "application/json" }, {
			protocol: "mcp",
			transport: "streamable-http",
			sessionId: mcp.sessionId,
			serverInfo: mcp.serverInfo
		});
	}

	if ("/mcp" === url.pathname && "POST" === request.method) {
		const chunks = [];
		request.on("data", chunk => chunks.push(chunk));
		request.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8");
			if (!text)
				return send(response, 202, { "Content-Type": "application/json" }, "");
			const result = mcp.handleText(text);
			if (undefined === result)
				return send(response, 202, { "Content-Type": "application/json" }, "");
			send(response, 200, { "Content-Type": "application/json" }, result);
		});
		return;
	}

	send(response, 404, { "Content-Type": "application/json" }, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
	device.sample();
	console.log(`IoT MCP host listening on http://127.0.0.1:${port}/mcp`);
	console.log(`Status page http://127.0.0.1:${port}/`);
});

function shutdown() {
	clearInterval(interval);
	server.close();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { server, device, mcp, port };
