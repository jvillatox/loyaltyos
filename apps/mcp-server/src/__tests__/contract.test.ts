import { routePermission } from "@loyaltyos/api-contract";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { LoyaltyOSClient } from "../client.js";
import { clearContracts, getContracts, type ToolContract } from "../contracts.js";
import { createMcpServer } from "../server.js";

interface ZodObjectWithShape {
  shape?: Record<string, z.ZodType<unknown>>;
}
interface McpServerInternals {
  _registeredTools?: Record<string, unknown>;
}

function getRegisteredToolNames(server: unknown): string[] {
  const tools = (server as McpServerInternals)._registeredTools;
  if (!tools) {
    throw new Error("MCP SDK internals changed: update getRegisteredToolNames()");
  }
  return Object.keys(tools);
}

function asShape(schema: z.ZodType<unknown>): Record<string, z.ZodType<unknown>> {
  return (schema as unknown as ZodObjectWithShape).shape ?? {};
}

function inputShape(contract: ToolContract): Record<string, z.ZodType<unknown>> {
  const shape = asShape(contract.inputSchema);
  const pathParams = new Set(contract.pathParams ?? []);
  return Object.fromEntries(Object.entries(shape).filter(([key]) => !pathParams.has(key)));
}

let contracts: readonly ToolContract[];
let toolNames: string[];

beforeAll(() => {
  clearContracts();
  const client = new LoyaltyOSClient("http://localhost:3002", "test-key");
  const server = createMcpServer(client);
  contracts = getContracts();
  toolNames = getRegisteredToolNames(server);
});

describe("MCP tool ↔ API contract", () => {
  it("registers exactly 21 tools including the analytics tools", () => {
    expect(toolNames).toHaveLength(21);
    expect(toolNames).toContain("analytics_dashboard");
    expect(toolNames).toContain("analytics_campaign");
  });

  it("every tool is registered in the contract registry (and vice versa)", () => {
    expect(toolNames.slice().sort()).toEqual(
      contracts
        .map((c) => c.name)
        .slice()
        .sort(),
    );
  });

  it("every tool resolves to a route in the shared manifest", () => {
    for (const contract of contracts) {
      expect(
        routePermission(contract.method, contract.path),
        `no manifest route for ${contract.method} ${contract.path} (tool "${contract.name}")`,
      ).toBeDefined();
    }
  });

  it("declares the same permission as the manifest", () => {
    for (const contract of contracts) {
      const manifestPermission = routePermission(contract.method, contract.path);
      expect(
        contract.permission,
        `permission mismatch for ${contract.method} ${contract.path} (tool "${contract.name}")`,
      ).toBe(manifestPermission);
    }
  });

  it("sends no field the API ignores and omits no required field", () => {
    for (const contract of contracts) {
      if (!contract.requestSchema) continue;

      const toolFields = inputShape(contract);
      const apiFields = asShape(contract.requestSchema);
      const apiKeys = Object.keys(apiFields);

      for (const key of Object.keys(toolFields)) {
        expect(
          apiKeys,
          `tool "${contract.name}" sends "${key}" but ${contract.method} ${contract.path} does not accept it`,
        ).toContain(key);
      }
      for (const key of apiKeys) {
        expect(
          Object.keys(toolFields),
          `tool "${contract.name}" omits "${key}" (required by ${contract.method} ${contract.path})`,
        ).toContain(key);
      }
      for (const key of apiKeys) {
        expect(
          toolFields[key]?.isOptional(),
          `tool "${contract.name}" field "${key}" required/optional mismatch with the API`,
        ).toBe(apiFields[key]?.isOptional());
      }
    }
  });
});
