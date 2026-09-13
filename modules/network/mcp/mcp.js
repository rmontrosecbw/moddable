/*
 * Copyright (c) 2026  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

/*
	Model Context Protocol (MCP) JSON-RPC 2.0 server.

	Transport-independent: applications bind this handler to HTTP, WebSocket,
	or a stdio proxy so a desktop AI can call tools on an MCU.
*/

const PROTOCOL_VERSIONS = Object.freeze(["2025-06-18", "2025-03-26", "2024-11-05"]);
const DEFAULT_PROTOCOL = PROTOCOL_VERSIONS[0];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function jsonError(id, code, message, data) {
	const error = { code, message };
	if (undefined !== data)
		error.data = data;
	return { jsonrpc: "2.0", id: id ?? null, error };
}

function jsonResult(id, result) {
	return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
	return { content: [{ type: "text", text }], isError: false };
}

function errorContent(text) {
	return { content: [{ type: "text", text }], isError: true };
}

function asText(value) {
	return "string" === typeof value ? value : JSON.stringify(value);
}

class MCPServer {
	constructor(options = {}) {
		this.serverInfo = {
			name: options.name ?? "moddable-mcp",
			version: options.version ?? "1.0.0"
		};
		this.instructions = options.instructions ?? "";
		this.tools = new Map;
		this.resources = new Map;
		this.prompts = new Map;
		this.initialized = false;
		this.sessionId = options.sessionId ?? `mcp-${Date.now()}`;
		this.protocolVersion = DEFAULT_PROTOCOL;
		this.nextId = 1;

		const tools = options.tools ?? [];
		for (let i = 0; i < tools.length; i++)
			this.addTool(tools[i]);
		const resources = options.resources ?? [];
		for (let i = 0; i < resources.length; i++)
			this.addResource(resources[i]);
		const prompts = options.prompts ?? [];
		for (let i = 0; i < prompts.length; i++)
			this.addPrompt(prompts[i]);
	}
	addTool(tool) {
		if (!tool?.name || "function" !== typeof tool.handler)
			throw new Error("tool requires name and handler");
		this.tools.set(tool.name, {
			name: tool.name,
			title: tool.title ?? tool.name,
			description: tool.description ?? "",
			inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
			handler: tool.handler
		});
	}
	addResource(resource) {
		if (!resource?.uri || "function" !== typeof resource.read)
			throw new Error("resource requires uri and read");
		this.resources.set(resource.uri, {
			uri: resource.uri,
			name: resource.name ?? resource.uri,
			title: resource.title ?? resource.name ?? resource.uri,
			description: resource.description ?? "",
			mimeType: resource.mimeType ?? "application/json",
			read: resource.read
		});
	}
	addPrompt(prompt) {
		if (!prompt?.name || "function" !== typeof prompt.handler)
			throw new Error("prompt requires name and handler");
		this.prompts.set(prompt.name, {
			name: prompt.name,
			title: prompt.title ?? prompt.name,
			description: prompt.description ?? "",
			arguments: prompt.arguments ?? [],
			handler: prompt.handler
		});
	}
	handleText(text) {
		let message;
		try {
			message = JSON.parse(text);
		}
		catch (error) {
			return JSON.stringify(jsonError(null, PARSE_ERROR, "Parse error", String(error)));
		}
		const response = this.handle(message);
		return undefined === response ? undefined : JSON.stringify(response);
	}
	handle(message) {
		if (Array.isArray(message)) {
			const responses = [];
			for (let i = 0; i < message.length; i++) {
				const response = this.#dispatch(message[i]);
				if (undefined !== response)
					responses.push(response);
			}
			return responses.length ? responses : undefined;
		}
		return this.#dispatch(message);
	}
	#dispatch(message) {
		if (!message || "2.0" !== message.jsonrpc || "string" !== typeof message.method)
			return jsonError(message?.id ?? null, INVALID_REQUEST, "Invalid Request");

		const id = message.id;
		const isNotification = undefined === id;
		try {
			const result = this.#invoke(message.method, message.params ?? {});
			if (isNotification)
				return undefined;
			return jsonResult(id, result);
		}
		catch (error) {
			if (isNotification)
				return undefined;
			const code = error.code ?? INTERNAL_ERROR;
			return jsonError(id, code, error.message ?? "Internal error", error.data);
		}
	}
	#invoke(method, params) {
		switch (method) {
			case "initialize":
				return this.#initialize(params);
			case "notifications/initialized":
				this.initialized = true;
				return {};
			case "ping":
				return {};
			case "tools/list":
				return this.#listTools();
			case "tools/call":
				return this.#callTool(params);
			case "resources/list":
				return this.#listResources();
			case "resources/read":
				return this.#readResource(params);
			case "resources/templates/list":
				return { resourceTemplates: [] };
			case "prompts/list":
				return this.#listPrompts();
			case "prompts/get":
				return this.#getPrompt(params);
			default: {
				const error = new Error(`Method not found: ${method}`);
				error.code = METHOD_NOT_FOUND;
				throw error;
			}
		}
	}
	#initialize(params) {
		const requested = params.protocolVersion;
		this.protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL;
		this.initialized = false;
		return {
			protocolVersion: this.protocolVersion,
			capabilities: {
				tools: { listChanged: false },
				resources: { listChanged: false, subscribe: false },
				prompts: { listChanged: false }
			},
			serverInfo: this.serverInfo,
			instructions: this.instructions
		};
	}
	#listTools() {
		const tools = [];
		for (const tool of this.tools.values()) {
			tools.push({
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema
			});
		}
		return { tools };
	}
	#callTool(params) {
		if (!params?.name) {
			const error = new Error("tools/call requires name");
			error.code = INVALID_PARAMS;
			throw error;
		}
		const tool = this.tools.get(params.name);
		if (!tool) {
			const error = new Error(`Unknown tool: ${params.name}`);
			error.code = INVALID_PARAMS;
			throw error;
		}
		try {
			const result = tool.handler(params.arguments ?? {});
			if (result && Array.isArray(result.content))
				return result;
			return textContent(asText(result));
		}
		catch (error) {
			return errorContent(error.message ?? String(error));
		}
	}
	#listResources() {
		const resources = [];
		for (const resource of this.resources.values()) {
			resources.push({
				uri: resource.uri,
				name: resource.name,
				title: resource.title,
				description: resource.description,
				mimeType: resource.mimeType
			});
		}
		return { resources };
	}
	#readResource(params) {
		if (!params?.uri) {
			const error = new Error("resources/read requires uri");
			error.code = INVALID_PARAMS;
			throw error;
		}
		const resource = this.resources.get(params.uri);
		if (!resource) {
			const error = new Error(`Unknown resource: ${params.uri}`);
			error.code = INVALID_PARAMS;
			throw error;
		}
		const body = resource.read();
		const text = "string" === typeof body ? body : JSON.stringify(body);
		return {
			contents: [{
				uri: resource.uri,
				mimeType: resource.mimeType,
				text
			}]
		};
	}
	#listPrompts() {
		const prompts = [];
		for (const prompt of this.prompts.values()) {
			prompts.push({
				name: prompt.name,
				title: prompt.title,
				description: prompt.description,
				arguments: prompt.arguments
			});
		}
		return { prompts };
	}
	#getPrompt(params) {
		if (!params?.name) {
			const error = new Error("prompts/get requires name");
			error.code = INVALID_PARAMS;
			throw error;
		}
		const prompt = this.prompts.get(params.name);
		if (!prompt) {
			const error = new Error(`Unknown prompt: ${params.name}`);
			error.code = INVALID_PARAMS;
			throw error;
		}
		return prompt.handler(params.arguments ?? {});
	}
}

export default MCPServer;
export { MCPServer, textContent, errorContent, PROTOCOL_VERSIONS };
