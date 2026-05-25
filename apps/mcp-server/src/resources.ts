import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LoyaltyOSClient } from "./client.js";

export function registerResources(server: McpServer, client: LoyaltyOSClient): void {
  server.resource("Program Overview", "loyaltyos://program/overview", async () => {
    const dashboard = await client.getDashboard("30d");
    const config = await client.getProgramConfig();

    const markdown = [
      `# ${config.name}`,
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Active Members | ${dashboard.activeMembers.toLocaleString()} |`,
      `| New Members (30d) | ${dashboard.newMembers.toLocaleString()} |`,
      `| Points Issued (30d) | ${dashboard.pointsIssued.toLocaleString()} |`,
      `| Points Redeemed (30d) | ${dashboard.pointsRedeemed.toLocaleString()} |`,
      `| Redemption Rate | ${(dashboard.redemptionRate * 100).toFixed(1)}% |`,
      `| Total Liability | ${dashboard.totalLiability.toLocaleString()} |`,
      `| Coalition Enabled | ${config.coalitionEnabled ? "Yes" : "No"} |`,
      config.coalitionProvider ? `| Coalition Provider | ${config.coalitionProvider} |` : "",
      "",
      "## Tiers",
      "",
      ...config.tiers.map(
        (t) => `- **${t.name}** (≥ ${t.minPoints.toLocaleString()} pts): ${t.benefits.join(", ")}`,
      ),
      "",
      `Point expiry: ${config.pointExpiryDays ? `${String(config.pointExpiryDays)} days` : "Never"}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      contents: [
        { uri: "loyaltyos://program/overview", text: markdown, mimeType: "text/markdown" },
      ],
    };
  });

  server.resource("Active Campaigns", "loyaltyos://campaigns/active", async () => {
    const { campaigns } = await client.listCampaigns({ status: "active" });

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
          `- **Status:** ${c.status}`,
          `- **Start:** ${c.startDate}`,
          c.endDate ? `- **End:** ${c.endDate}` : null,
          c.membersReached ? `- **Members Reached:** ${c.membersReached.toLocaleString()}` : null,
          c.pointsIssued ? `- **Points Issued:** ${c.pointsIssued.toLocaleString()}` : null,
          c.conversionRate != null
            ? `- **Conversion Rate:** ${(c.conversionRate * 100).toFixed(1)}%`
            : null,
          `- **Stackable:** ${c.stackable ? "Yes" : "No"}`,
          c.budgetCap ? `- **Budget Cap:** ${c.budgetCap.toLocaleString()}` : null,
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

  server.resource("Tier Configuration", "loyaltyos://tiers/config", async () => {
    const config = await client.getProgramConfig();

    const markdown = [
      "# Tier Configuration",
      "",
      `**Currency:** ${config.currency}`,
      `**Point Expiry:** ${config.pointExpiryDays ? `${String(config.pointExpiryDays)} days` : "Never"}`,
      "",
      "| Tier | Min Points | Benefits |",
      "|------|-----------|----------|",
      ...config.tiers.map(
        (t) => `| ${t.name} | ${t.minPoints.toLocaleString()} | ${t.benefits.join(", ")} |`,
      ),
    ].join("\n");

    return {
      contents: [
        {
          uri: "loyaltyos://tiers/config",
          text: markdown,
          mimeType: "text/markdown",
        },
      ],
    };
  });
}
