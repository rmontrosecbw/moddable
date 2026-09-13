/*---
description: MCP tools/list and tools/call
flags: [module]
---*/

import MCPServer from "mcp";

const server = new MCPServer({
	name: "tools-mcp",
	tools: [{
		name: "echo",
		description: "Echo a message",
		inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
		handler(args) { return { heard: args.text }; }
	}]
});

const listed = server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
assert.sameValue(1, listed.result.tools.length);
assert.sameValue("echo", listed.result.tools[0].name);

const called = server.handle({
	jsonrpc: "2.0",
	id: 3,
	method: "tools/call",
	params: { name: "echo", arguments: { text: "ping" } }
});
assert.sameValue(false, called.result.isError);
assert.sameValue(true, called.result.content[0].text.includes("ping"));
