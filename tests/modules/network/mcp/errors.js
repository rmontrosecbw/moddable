/*---
description: MCP protocol error handling
flags: [module]
---*/

import MCPServer from "mcp";

const server = new MCPServer({ name: "err-mcp" });
const parsed = JSON.parse(server.handleText("{not-json"));
assert.sameValue(-32700, parsed.error.code);

const missing = server.handle({ jsonrpc: "2.0", id: 9, method: "no/such" });
assert.sameValue(-32601, missing.error.code);

const bad = server.handle({ jsonrpc: "1.0", id: 8, method: "ping" });
assert.sameValue(-32600, bad.error.code);

const note = server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
assert.sameValue(undefined, note);
