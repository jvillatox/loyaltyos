import "dotenv/config";

import http from "node:http";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { LoyaltyOSClient } from "./client.js";
import { defaultRateLimiter } from "./rate-limiter.js";
import { createMcpServer } from "./server.js";

const LOYALTYOS_API_URL = process.env.LOYALTYOS_API_URL ?? "http://localhost:3002";
const LOYALTYOS_TOKEN = process.env.LOYALTYOS_TOKEN ?? "";
const MCP_TRANSPORT = process.env.MCP_TRANSPORT ?? "stdio";
const MCP_SERVER_PORT = Number(process.env.MCP_SERVER_PORT ?? "3010");

function warnIfMissingToken(): void {
  if (LOYALTYOS_TOKEN) {
    return;
  }
  console.error(
    [
      "LOYALTYOS_TOKEN is not set.",
      "Create an ANALYST personal access token:",
      '  pnpm --filter @loyaltyos/api admin:token:create --email <email> --name "MCP" --role ANALYST --days 90',
      "then set LOYALTYOS_TOKEN to the printed token. Tool calls will be rejected until it is configured.",
    ].join("\n"),
  );
}

async function startStdio(): Promise<void> {
  const client = new LoyaltyOSClient(LOYALTYOS_API_URL, LOYALTYOS_TOKEN);
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LoyaltyOS MCP Server running in stdio mode");
}

async function startSSE(): Promise<void> {
  const client = new LoyaltyOSClient(LOYALTYOS_API_URL, LOYALTYOS_TOKEN);

  // We use a simple HTTP server for SSE transport using the MCP SDK's
  // StreamableHTTPServerTransport, which provides full MCP over HTTP POST.
  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "POST" && req.url === "/mcp") {
        try {
          defaultRateLimiter.check("sse");
          const server = createMcpServer(client);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (error) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    })();
  });

  httpServer.listen(MCP_SERVER_PORT, () => {
    console.error(
      `LoyaltyOS MCP Server running in SSE mode on http://0.0.0.0:${String(MCP_SERVER_PORT)}/mcp`,
    );
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  warnIfMissingToken();
  if (MCP_TRANSPORT === "sse") {
    await startSSE();
  } else {
    await startStdio();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
