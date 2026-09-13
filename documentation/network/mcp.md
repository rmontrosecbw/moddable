# Model Context Protocol
Copyright 2026 Moddable Tech, Inc.  
Revised: September 13, 2026

## Table of Contents

* [Introduction](#intro)
* [MCPServer](#server)
* [HTTP transport](#http)
* [Connecting an AI client](#client)
* [IoT example](#iot)

<a id="intro"></a>
## Introduction

The `mcp` module implements a [Model Context Protocol](https://modelcontextprotocol.io) JSON-RPC 2.0 server that can run on a microcontroller. An AI client initializes a session, lists tools and resources, and calls tools that read sensors or set controllers.

The protocol handler is transport-independent. Bind it to the Moddable HTTP server, a Node host for development, or the stdio proxy used by desktop AI apps.

```js
import MCPServer from "mcp";
```

```json
"include": [
	"$(MODULES)/network/mcp/manifest.json"
]
```

Supported methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.

Protocol versions accepted: `2025-06-18`, `2025-03-26`, `2024-11-05`.

<a id="server"></a>
## class MCPServer

```js
const mcp = new MCPServer({
	name: "esp32-s3-iot",
	version: "1.0.0",
	instructions: "Read sensors and set controllers on this device.",
	tools: [{
		name: "read_sensors",
		description: "Current sensor snapshot",
		handler() { return device.snapshot().sensors; }
	}],
	resources: [{
		uri: "iot://status",
		name: "status",
		read() { return device.snapshot(); }
	}]
});

const reply = mcp.handle({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cursor", version: "1" } }
});
```

`handle(message)` accepts one JSON-RPC object or a batch array. Notifications return `undefined`. `handleText(text)` parses a string and stringifies the response.

<a id="http"></a>
## HTTP transport

`mcp/http` adapts `MCPServer` to the Moddable `http.Server` callback:

```js
import {Server} from "http";
import {createHTTPCallback} from "mcp/http";

const server = new Server({port: 8080});
server.callback = createHTTPCallback(mcp, {
	path: "/mcp",
	statusPage() { return "<html>ok</html>"; }
});
```

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/mcp` | JSON-RPC request (Streamable HTTP) |
| `GET` | `/mcp` | Server and session discovery |
| `GET` | `/` | Optional HTML status page |
| `GET` | `/health` | Liveness JSON |

Responses include `Mcp-Session-Id` and `MCP-Protocol-Version`. CORS headers are open so a browser or local proxy can reach the device on the LAN.

<a id="client"></a>
## Connecting an AI client

Desktop hosts that only speak stdio MCP should run the proxy from the IoT example:

```
node examples/network/mcp-iot/mcp-proxy.mjs http://192.168.1.50:8080/mcp
```

Clients that speak Streamable HTTP can use the device URL directly:

```json
{
  "mcpServers": {
    "esp32-iot": {
      "url": "http://iot-device.local:8080/mcp"
    }
  }
}
```

<a id="iot"></a>
## IoT example

The [MCP IoT example](../../examples/network/mcp-iot/readme.md) is a complete ESP32-S3 application: sensors, controllers, on-device heuristics, mDNS, and MCP tools an AI can use to diagnose and operate the node.
