/*
* Copyright (c) 2026 Moddable Tech, Inc.
*
*   This file is part of the Moddable SDK Tools.
*
*   The Moddable SDK Tools is free software: you can redistribute it and/or modify
*   it under the terms of the GNU General Public License as published by
*   the Free Software Foundation, either version 3 of the License, or
*   (at your option) any later version.
*
*   The Moddable SDK Tools is distributed in the hope that it will be useful,
*   but WITHOUT ANY WARRANTY; without even the implied warranty of
*   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
*   GNU General Public License for more details.
*
*   You should have received a copy of the GNU General Public License
*   along with the Moddable SDK Tools.  If not, see <http://www.gnu.org/licenses/>.
*
*/

declare module "mcp" {
  export const PROTOCOL_VERSIONS: readonly string[]
  export function textContent(text: string): { content: { type: string, text: string }[], isError: boolean }
  export function errorContent(text: string): { content: { type: string, text: string }[], isError: boolean }
  export class MCPServer {
    serverInfo: { name: string, version: string }
    sessionId: string
    protocolVersion: string
    initialized: boolean
    constructor(options?: {
      name?: string
      version?: string
      instructions?: string
      sessionId?: string
      tools?: object[]
      resources?: object[]
      prompts?: object[]
    })
    addTool(tool: object): void
    addResource(resource: object): void
    addPrompt(prompt: object): void
    handle(message: object | object[]): object | undefined
    handleText(text: string): string | undefined
  }
  export { MCPServer as default }
}

declare module "mcp/http" {
  export function createHTTPCallback(mcp: import("mcp").MCPServer, options?: { path?: string, statusPage?: () => string }): Function
  export function sessionHeaders(server: import("mcp").MCPServer): string[]
  export { createHTTPCallback as default }
}
