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

import {Server} from "http";
import Timer from "timer";
import Net from "net";
import MDNS from "mdns";
import config from "mc/config";
import IoTDevice from "iotdevice";
import createDeviceMCP from "iotbridge";
import {createHTTPCallback} from "mcp/http";

const port = config.mcpPort ?? 8080;
const sampleMs = config.sampleMs ?? 1000;
const hostName = config.hostName ?? "iot-device";

const device = new IoTDevice({
	name: config.deviceName ?? "esp32-s3-iot"
});
const mcp = createDeviceMCP(device, { allowInject: false !== config.allowInject });

const server = new Server({port});
server.callback = createHTTPCallback(mcp, {
	path: "/mcp",
	statusPage() {
		return device.statusPage();
	}
});

Timer.repeat(() => {
	const snap = device.sample();
	if (0 === snap.tick % 10)
		trace(`${snap.name} tick ${snap.tick} health ${snap.health} temp ${snap.sensors.temperature.value}\n`);
}, sampleMs);

try {
	new MDNS({hostName}, function(message, value) {
		if (1 === message && value) {
			this.add({
				name: "mcp",
				protocol: "tcp",
				port,
				txt: { path: "/mcp", proto: "mcp" }
			});
			this.add({
				name: "http",
				protocol: "tcp",
				port
			});
			trace(`mDNS name ${value}.local\n`);
		}
	});
}
catch {
	trace("mDNS unavailable\n");
}

trace(`${device.name} MCP server on ${Net.get("IP")}:${port}/mcp\n`);
trace(`Status page http://${Net.get("IP")}:${port}/\n`);
