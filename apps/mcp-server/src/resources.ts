import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";

interface CampaignListItem {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  multiplier?: number;
  maxBudget?: number | null;
  isStackable?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

interface CampaignListResponse {
  data: {
    items: CampaignListItem[];
    total: number;
  };
}

export function registerResources(server: McpServer, client: LoyaltyOSClient): void {
  server.resource("Active Campaigns", "loyaltyos://campaigns/active", async () => {
    const result = await client.get<CampaignListResponse>("/api/v1/admin/campaigns", {
      params: { isActive: "true", pageSize: 100 },
    });

    const campaigns = result.data.items;

    if (campaigns.length === 0) {
      return {
        contents: [
          {
            uri: "loyaltyos://campaigns/active",
            text: "# Active Campaigns\n\nNo active campaigns.",
            mimeType: "text/markdown",
          },
        ],
      };
    }

    const markdown = [
      "# Active Campaigns",
      "",
      ...campaigns.map((c) =>
        [
          `## ${c.name}`,
          `- **Type:** ${c.type}`,
          c.multiplier != null ? `- **Multiplier:** ${String(c.multiplier)}` : null,
          `- **Stackable:** ${c.isStackable ? "Yes" : "No"}`,
          c.maxBudget != null ? `- **Budget Cap:** ${c.maxBudget.toLocaleString()}` : null,
          c.startsAt ? `- **Start:** ${c.startsAt}` : null,
          c.endsAt ? `- **End:** ${c.endsAt}` : null,
          "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ].join("\n");

    return {
      contents: [
        {
          uri: "loyaltyos://campaigns/active",
          text: markdown,
          mimeType: "text/markdown",
        },
      ],
    };
  });
}
