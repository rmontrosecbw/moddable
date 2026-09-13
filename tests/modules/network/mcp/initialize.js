/*---
description: MCP initialize handshake
flags: [module]
---*/

import MCPServer from "mcp";

const server = new MCPServer({ name: "test-mcp", version: "1.2.3" });
const reply = server.handle({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } }
});

assert.sameValue("2.0", reply.jsonrpc);
assert.sameValue(1, reply.id);
assert.sameValue("2025-03-26", reply.result.protocolVersion);
assert.sameValue("test-mcp", reply.result.serverInfo.name);
assert.sameValue("1.2.3", reply.result.serverInfo.version);
