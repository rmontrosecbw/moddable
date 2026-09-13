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

import MCPServer from "mcp";
import IoTDevice from "iotdevice";

function objectSchema(properties, required) {
	const schema = { type: "object", properties };
	if (required)
		schema.required = required;
	return schema;
}

function createDeviceMCP(device, options = {}) {
	const allowInject = false !== options.allowInject;
	const tools = [
		{
			name: "read_sensors",
			description: "Read the current sensor values, smoothed estimates, z-scores, and anomaly flags.",
			handler() {
				return device.snapshot().sensors;
			}
		},
		{
			name: "read_sensor_history",
			description: "Return the recent sliding-window samples for one sensor.",
			inputSchema: objectSchema({ name: { type: "string" } }, ["name"]),
			handler(args) {
				return { name: args.name, values: device.history(args.name) };
			}
		},
		{
			name: "get_device_status",
			description: "Get operating mode, health, controllers, and the last heuristic actions.",
			handler() {
				return device.snapshot();
			}
		},
		{
			name: "list_controllers",
			description: "List actuator/controller names and their current values.",
			handler() {
				return device.snapshot().controllers;
			}
		},
		{
			name: "set_controller",
			description: "Set a controller output. In auto mode this is an override until the next matching policy.",
			inputSchema: objectSchema({
				name: { type: "string" },
				value: { type: "number" }
			}, ["name", "value"]),
			handler(args) {
				return device.setController(args.name, args.value, "mcp");
			}
		},
		{
			name: "set_mode",
			description: "Switch between auto (heuristics drive controllers) and manual (AI or operator drives controllers).",
			inputSchema: objectSchema({ mode: { type: "string", enum: ["auto", "manual"] } }, ["mode"]),
			handler(args) {
				return { mode: device.setMode(args.mode) };
			}
		},
		{
			name: "get_heuristics",
			description: "Return the latest on-device heuristic evaluation, including anomalies and model prediction.",
			handler() {
				return {
					heuristic: device.lastHeuristic,
					actions: device.lastActions,
					prediction: device.predict()
				};
			}
		},
		{
			name: "list_policies",
			description: "List the heuristic policy rules that map sensor conditions to controller actions.",
			handler() {
				return device.policy.rules;
			}
		},
		{
			name: "set_policy",
			description: "Add or replace a policy rule. when may be one clause or an array of AND clauses.",
			inputSchema: objectSchema({
				id: { type: "string" },
				enabled: { type: "boolean" },
				when: { type: "object" },
				then: { type: "object" }
			}, ["id", "when", "then"]),
			handler(args) {
				return device.policy.add(args);
			}
		},
		{
			name: "remove_policy",
			description: "Remove a policy rule by id.",
			inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
			handler(args) {
				return { removed: device.policy.remove(args.id) };
			}
		},
		{
			name: "train_baseline",
			description: "Lock the current per-sensor statistics as the normal operating baseline for anomaly detection.",
			handler() {
				return device.trainBaseline();
			}
		},
		{
			name: "train_model",
			description: "Train the on-device linear classifier from recent labeled samples (anomaly vs nominal).",
			handler() {
				return device.trainModel();
			}
		},
		{
			name: "predict",
			description: "Run the on-device linear model against the latest sensor features.",
			handler() {
				return device.predict();
			}
		}
	];

	if (allowInject) {
		tools.push({
			name: "inject_sample",
			description: "Override a sensor value to test heuristics. Pass value null to clear the override.",
			inputSchema: objectSchema({
				name: { type: "string" },
				value: { type: ["number", "null"] }
			}, ["name"]),
			handler(args) {
				device.inject(args.name, args.value);
				return device.sample();
			}
		});
	}

	return new MCPServer({
		name: options.name ?? device.name,
		version: options.version ?? "1.0.0",
		instructions: options.instructions ?? "ESP32-S3 IoT device. Read sensors, inspect heuristics, and control actuators. Prefer set_mode manual before holding an actuator; use auto to let on-device policies run.",
		tools,
		resources: [
			{
				uri: "iot://status",
				name: "Device status",
				description: "Full device snapshot",
				read() { return device.snapshot(); }
			},
			{
				uri: "iot://heuristics",
				name: "Heuristics",
				description: "Latest heuristic evaluation",
				read() { return device.lastHeuristic ?? {}; }
			},
			{
				uri: "iot://policies",
				name: "Policies",
				description: "Active operating policies",
				read() { return device.policy.rules; }
			}
		],
		prompts: [
			{
				name: "diagnose",
				description: "Ask the model to diagnose device health from live telemetry.",
				handler() {
					return {
						description: "Diagnose the IoT device",
						messages: [{
							role: "user",
							content: {
								type: "text",
								text: `Diagnose this ESP32-S3 IoT device and recommend controller or policy changes.\n${JSON.stringify(device.snapshot())}`
							}
						}]
					};
				}
			}
		]
	});
}

export default createDeviceMCP;
export { createDeviceMCP, IoTDevice };
