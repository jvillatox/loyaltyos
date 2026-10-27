import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { LoyaltyOSClient } from "./client.js";
import { createMcpServer } from "./server.js";

export { createMcpServer, LoyaltyOSClient };

export interface McpToolResult {
  isError: boolean;
  text: string;
}

export interface InMemoryMcp {
  callTool(name: string, args?: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

/**
 * Wires an MCP server to an in-process MCP client over a linked in-memory
 * transport, so tests can invoke the real tool handlers (input validation,
 * client HTTP call, error mapping) without a stdio/SSE socket.
 */
export async function createInMemoryMcp(client: LoyaltyOSClient): Promise<InMemoryMcp> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createMcpServer(client);
  await server.connect(serverTransport);

  const mcpClient = new Client({ name: "loyaltyos-e2e", version: "1.0.0" });
  await mcpClient.connect(clientTransport);

  return {
    async callTool(name, args = {}) {
      const result = (await mcpClient.callTool({ name, arguments: args })) as CallToolResult;
      const text = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return { isError: result.isError === true, text };
    },
    async close() {
      await mcpClient.close();
    },
  };
}
