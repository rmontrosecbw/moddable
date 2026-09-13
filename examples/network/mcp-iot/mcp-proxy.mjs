#!/usr/bin/env node

/*
	stdio MCP <-> HTTP MCP proxy.

	An AI client (Cursor, Claude Desktop) speaks MCP over stdin/stdout.
	This process forwards each JSON-RPC message to the ESP32 (or host) HTTP
	endpoint so the model can call device tools.

	Usage:
	  node mcp-proxy.mjs http://192.168.1.50:8080/mcp
*/

const endpoint = process.argv[2] ?? process.env.MCP_URL ?? "http://127.0.0.1:8080/mcp";

let buffer = Buffer.alloc(0);
let expected = undefined;
let framed = undefined;

function writeMessage(object) {
	const json = JSON.stringify(object);
	const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
	process.stdout.write(header + json);
}

async function forward(message) {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream"
		},
		body: JSON.stringify(message)
	});
	if (202 === response.status)
		return undefined;
	const text = await response.text();
	if (!text)
		return undefined;
	return JSON.parse(text);
}

function handleObject(message) {
	forward(message).then(result => {
		if (undefined !== result && undefined !== message.id)
			writeMessage(result);
	}).catch(error => {
		if (undefined !== message.id) {
			writeMessage({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32603, message: error.message }
			});
		}
	});
}

function consume() {
	while (true) {
		if (false !== framed) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd >= 0) {
				framed = true;
				const header = buffer.subarray(0, headerEnd).toString("utf8");
				const match = /Content-Length:\s*(\d+)/i.exec(header);
				expected = match ? Number(match[1]) : 0;
				buffer = buffer.subarray(headerEnd + 4);
			}
			else if (undefined === framed && buffer.includes(0x7b)) {
				framed = false;
			}
			else {
				return;
			}
		}
		if (true === framed) {
			if (undefined === expected || buffer.length < expected)
				return;
			const json = buffer.subarray(0, expected).toString("utf8");
			buffer = buffer.subarray(expected);
			expected = undefined;
			handleObject(JSON.parse(json));
			continue;
		}
		const newline = buffer.indexOf(0x0a);
		if (newline < 0)
			return;
		const line = buffer.subarray(0, newline).toString("utf8").trim();
		buffer = buffer.subarray(newline + 1);
		if (line)
			handleObject(JSON.parse(line));
	}
}

process.stdin.on("data", chunk => {
	buffer = Buffer.concat([buffer, chunk]);
	try {
		consume();
	}
	catch (error) {
		process.stderr.write(`${error.message}\n`);
	}
});

process.stdin.on("end", () => process.exit(0));
process.stderr.write(`MCP proxy forwarding stdio to ${endpoint}\n`);
