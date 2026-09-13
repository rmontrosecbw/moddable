/*
 * Copyright (c) 2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK.
 *
 *   This work is licensed under the
 *       Creative Commons Attribution 4.0 International License.
 *   To view a copy of this license, visit
 *       <http://creativecommons.org/licenses/by/4.0>.
 *   or send a letter to Creative Commons, PO Box 1866,
 *   Mountain View, CA 94042, USA.
 *
 */

import {HeuristicEngine, LinearModel, PolicyEngine} from "ml";

const DEFAULT_SENSORS = [
	{ name: "temperature", unit: "C", min: -10, max: 60, seed: 22 },
	{ name: "humidity", unit: "%", min: 0, max: 100, seed: 48 },
	{ name: "light", unit: "lux", min: 0, max: 1200, seed: 320 },
	{ name: "motion", unit: "bool", min: 0, max: 1, seed: 0 },
	{ name: "soil", unit: "%", min: 0, max: 100, seed: 58 }
];

const DEFAULT_CONTROLLERS = [
	{ name: "fan", kind: "binary", value: 0 },
	{ name: "heater", kind: "binary", value: 0 },
	{ name: "grow_light", kind: "binary", value: 0 },
	{ name: "pump", kind: "binary", value: 0 },
	{ name: "alarm", kind: "binary", value: 0 }
];

const DEFAULT_POLICIES = [
	{ id: "cool-if-hot", when: { sensor: "temperature", op: ">", value: 27 }, then: { controller: "fan", value: 1 } },
	{ id: "stop-fan-if-cool", when: { sensor: "temperature", op: "<", value: 23 }, then: { controller: "fan", value: 0 } },
	{ id: "heat-if-cold", when: { sensor: "temperature", op: "<", value: 18 }, then: { controller: "heater", value: 1 } },
	{ id: "stop-heat-if-warm", when: { sensor: "temperature", op: ">", value: 21 }, then: { controller: "heater", value: 0 } },
	{ id: "light-if-dark", when: { sensor: "light", op: "<", value: 180 }, then: { controller: "grow_light", value: 1 } },
	{ id: "light-off-if-bright", when: { sensor: "light", op: ">", value: 400 }, then: { controller: "grow_light", value: 0 } },
	{ id: "water-if-dry", when: { sensor: "soil", op: "<", value: 30 }, then: { controller: "pump", value: 1 } },
	{ id: "pump-off-if-moist", when: { sensor: "soil", op: ">", value: 45 }, then: { controller: "pump", value: 0 } },
	{ id: "alarm-on-anomaly", when: { sensor: "temperature", metric: "zscore", op: ">", value: 3 }, then: { controller: "alarm", value: 1 } },
	{ id: "alarm-off-if-stable", when: { sensor: "temperature", metric: "zscore", op: "<", value: 2 }, then: { controller: "alarm", value: 0 } }
];

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function copySensor(spec) {
	return {
		name: spec.name,
		unit: spec.unit,
		min: spec.min,
		max: spec.max,
		seed: spec.seed,
		value: spec.seed
	};
}

class IoTDevice {
	constructor(options = {}) {
		this.name = options.name ?? "esp32-s3-iot";
		this.mode = options.mode ?? "auto";
		this.tick = 0;
		this.historyLimit = options.historyLimit ?? 24;
		this.sensors = (options.sensors ?? DEFAULT_SENSORS).map(copySensor);
		this.controllers = new Map;
		const controllers = options.controllers ?? DEFAULT_CONTROLLERS;
		for (let i = 0; i < controllers.length; i++) {
			const item = controllers[i];
			this.controllers.set(item.name, { name: item.name, kind: item.kind ?? "binary", value: item.value ?? 0, source: "init" });
		}
		this.engine = new HeuristicEngine({
			featureOrder: this.sensors.map(sensor => sensor.name),
			model: new LinearModel({
				labels: ["nominal", "intervene"]
			})
		});
		for (let i = 0; i < this.sensors.length; i++)
			this.engine.addChannel(this.sensors[i].name, { unit: this.sensors[i].unit, window: options.window ?? 32 });
		this.policy = new PolicyEngine(options.policies ?? DEFAULT_POLICIES);
		this.lastHeuristic = undefined;
		this.lastActions = [];
		this.overrides = {};
		this.training = [];
		this.trainingLimit = options.trainingLimit ?? 48;
	}
	#simulate() {
		const fan = this.controllers.get("fan")?.value ?? 0;
		const heater = this.controllers.get("heater")?.value ?? 0;
		const grow = this.controllers.get("grow_light")?.value ?? 0;
		const pump = this.controllers.get("pump")?.value ?? 0;
		const sample = {};
		for (let i = 0; i < this.sensors.length; i++) {
			const sensor = this.sensors[i];
			if (undefined !== this.overrides[sensor.name]) {
				sensor.value = this.overrides[sensor.name];
				sample[sensor.name] = sensor.value;
				continue;
			}
			let next = sensor.value;
			switch (sensor.name) {
				case "temperature":
					next += (0.15 * Math.sin(this.tick / 18)) + ((Math.random() - 0.5) * 0.25);
					next += heater * 0.35;
					next -= fan * 0.3;
					break;
				case "humidity":
					next += ((Math.random() - 0.5) * 0.4) - (fan * 0.08) + (pump * 0.2);
					break;
				case "light":
					next = 180 + (220 * (0.5 + 0.5 * Math.sin(this.tick / 30))) + (grow * 260) + ((Math.random() - 0.5) * 12);
					break;
				case "motion":
					next = Math.random() < 0.08 ? 1 : 0;
					break;
				case "soil":
					next -= 0.12 + (Math.random() * 0.05);
					next += pump * 3.2;
					break;
				default:
					next += (Math.random() - 0.5);
					break;
			}
			sensor.value = clamp(next, sensor.min, sensor.max);
			sample[sensor.name] = Math.round(sensor.value * 100) / 100;
		}
		return sample;
	}
	sample(injected) {
		this.tick += 1;
		const raw = injected ?? this.#simulate();
		this.lastHeuristic = this.engine.observe(raw);
		const features = this.engine.features().values;
		this.training.push({ x: features, y: this.lastHeuristic.anomalies ? 1 : 0 });
		if (this.training.length > this.trainingLimit)
			this.training.shift();
		if ("auto" === this.mode) {
			this.lastActions = this.policy.evaluate(this.engine);
			for (let i = 0; i < this.lastActions.length; i++) {
				const action = this.lastActions[i];
				this.#applyController(action.controller, action.value, action.id);
			}
		}
		else {
			this.lastActions = this.policy.evaluate(this.engine);
		}
		return this.snapshot();
	}
	#applyController(name, value, source) {
		const controller = this.controllers.get(name);
		if (!controller)
			throw new Error(`unknown controller ${name}`);
		controller.value = "binary" === controller.kind ? (value ? 1 : 0) : value;
		controller.source = source ?? "manual";
		controller.updated = this.tick;
		return controller;
	}
	setController(name, value, source) {
		return this.#applyController(name, value, source ?? "mcp");
	}
	setMode(mode) {
		if ("auto" !== mode && "manual" !== mode)
			throw new Error("mode must be auto or manual");
		this.mode = mode;
		return this.mode;
	}
	inject(name, value) {
		if (null === value)
			delete this.overrides[name];
		else
			this.overrides[name] = value;
		return this.overrides;
	}
	trainBaseline() {
		return this.engine.trainBaseline();
	}
	trainModel() {
		if (this.training.length < 4)
			throw new Error("collect more samples before training");
		this.engine.model = new LinearModel({ labels: ["nominal", "intervene"] });
		return this.engine.model.fit(this.training, { epochs: 50, learningRate: 0.03 });
	}
	predict() {
		const features = this.engine.features();
		if (!this.engine.model.weights.length)
			return { label: "untrained", score: 0, features };
		return { ...this.engine.model.predict(features.values), features };
	}
	snapshot() {
		const sensors = {};
		for (let i = 0; i < this.sensors.length; i++) {
			const sensor = this.sensors[i];
			const channel = this.engine.channels.get(sensor.name);
			sensors[sensor.name] = {
				value: sensor.value,
				unit: sensor.unit,
				smoothed: channel?.ewma.value,
				zscore: channel && undefined !== channel.last ? channel.stats.zscore(channel.last) : 0,
				slope: channel ? channel.window.slope() : 0,
				anomaly: channel && undefined !== channel.last ? Math.abs(channel.stats.zscore(channel.last)) >= channel.detector.zLimit : false
			};
		}
		const controllers = {};
		for (const [name, controller] of this.controllers)
			controllers[name] = { value: controller.value, source: controller.source };
		return {
			name: this.name,
			tick: this.tick,
			mode: this.mode,
			health: this.lastHeuristic?.health ?? "unknown",
			anomalies: this.lastHeuristic?.anomalies ?? 0,
			prediction: this.lastHeuristic?.prediction,
			sensors,
			controllers,
			actions: this.lastActions,
			overrides: this.overrides
		};
	}
	history(name) {
		return this.engine.getChannel(name).window.toArray();
	}
	statusPage() {
		const snap = this.snapshot();
		const sensorRows = Object.keys(snap.sensors).map(name => {
			const item = snap.sensors[name];
			return `<tr><td>${name}</td><td>${item.value.toFixed(2)} ${item.unit}</td><td>${item.zscore.toFixed(2)}</td><td>${item.anomaly ? "yes" : "no"}</td></tr>`;
		}).join("");
		const controllerRows = Object.keys(snap.controllers).map(name => {
			const item = snap.controllers[name];
			return `<tr><td>${name}</td><td>${item.value}</td><td>${item.source}</td></tr>`;
		}).join("");
		return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3">
<title>${snap.name}</title>
<style>
body{font-family:sans-serif;margin:24px;background:#111;color:#eee}
table{border-collapse:collapse;margin:12px 0}
td,th{border:1px solid #444;padding:6px 10px}
.ok{color:#8f8}.warn{color:#fc6}
code{background:#222;padding:2px 4px}
</style></head><body>
<h1>${snap.name}</h1>
<p>Mode <b>${snap.mode}</b> · Health <span class="${"nominal" === snap.health ? "ok" : "warn"}">${snap.health}</span> · Tick ${snap.tick}</p>
<p>MCP endpoint: <code>POST /mcp</code> (JSON-RPC 2.0). Use the stdio proxy or an HTTP MCP client.</p>
<h2>Sensors</h2>
<table><tr><th>Name</th><th>Value</th><th>z</th><th>Anomaly</th></tr>${sensorRows}</table>
<h2>Controllers</h2>
<table><tr><th>Name</th><th>Value</th><th>Source</th></tr>${controllerRows}</table>
</body></html>`;
	}
}

export default IoTDevice;
export { IoTDevice, DEFAULT_SENSORS, DEFAULT_CONTROLLERS, DEFAULT_POLICIES };
