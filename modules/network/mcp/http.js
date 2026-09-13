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

import {Server} from "http";

const MCP_HEADERS = Object.freeze([
	"Content-Type", "application/json",
	"Access-Control-Allow-Origin", "*",
	"Access-Control-Allow-Headers", "content-type, mcp-session-id, mcp-protocol-version, accept",
	"Access-Control-Allow-Methods", "GET, POST, OPTIONS"
]);

function sessionHeaders(server) {
	return [
		...MCP_HEADERS,
		"Mcp-Session-Id", server.sessionId,
		"MCP-Protocol-Version", server.protocolVersion
	];
}

function jsonBody(value) {
	const text = "string" === typeof value ? value : JSON.stringify(value);
	return ArrayBuffer.fromString ? ArrayBuffer.fromString(text) : text;
}

function createHTTPCallback(mcp, options = {}) {
	const path = options.path ?? "/mcp";
	const statusPage = options.statusPage;

	return function(message, value, etc) {
		switch (message) {
			case Server.status:
				this.path = value;
				this.method = etc;
				break;
			case Server.headersComplete:
				if ("POST" === this.method && this.path === path)
					return String;
				return false;
			case Server.requestComplete:
				this.requestText = value;
				break;
			case Server.prepareResponse:
				return prepare(mcp, this, path, statusPage);
		}
	};
}

function prepare(mcp, request, path, statusPage) {
	if ("OPTIONS" === request.method)
		return { status: 204, headers: sessionHeaders(mcp), body: "" };

	if (request.path === path && "GET" === request.method) {
		return {
			headers: sessionHeaders(mcp),
			body: jsonBody({
				protocol: "mcp",
				transport: "streamable-http",
				sessionId: mcp.sessionId,
				serverInfo: mcp.serverInfo
			})
		};
	}

	if (request.path === path && "POST" === request.method) {
		if (!request.requestText)
			return { status: 202, headers: sessionHeaders(mcp), body: "" };
		const response = mcp.handleText(request.requestText);
		if (undefined === response)
			return { status: 202, headers: sessionHeaders(mcp), body: "" };
		return { headers: sessionHeaders(mcp), body: jsonBody(response) };
	}

	if ("/" === request.path && "function" === typeof statusPage) {
		const page = statusPage();
		return {
			headers: ["Content-Type", "text/html; charset=utf-8"],
			body: jsonBody(page)
		};
	}

	if ("/health" === request.path) {
		return {
			headers: sessionHeaders(mcp),
			body: jsonBody({ ok: true, serverInfo: mcp.serverInfo })
		};
	}

	return {
		status: 404,
		headers: ["Content-Type", "application/json"],
		body: jsonBody({ error: "not found" })
	};
}

export default createHTTPCallback;
export { createHTTPCallback, sessionHeaders };
