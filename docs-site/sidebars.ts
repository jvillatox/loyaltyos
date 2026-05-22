import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: "category",
      label: "Getting Started",
      collapsible: false,
      items: [
        "getting-started/intro",
        "getting-started/quick-start",
        "getting-started/development",
        "getting-started/docker-setup",
      ],
    },
    {
      type: "category",
      label: "Core Concepts",
      collapsible: false,
      items: [
        "core-concepts/architecture",
        "core-concepts/data-model",
        "core-concepts/points-engine",
        "core-concepts/multi-tenancy",
      ],
    },
    {
      type: "category",
      label: "Packages",
      collapsible: true,
      collapsed: false,
      items: [
        "packages/core",
        "packages/campaigns",
        "packages/coupons",
        "packages/segments",
        "packages/rewards",
        "packages/badges",
        "packages/coalition",
        "packages/notifications",
        "packages/telemetry",
      ],
    },
    {
      type: "category",
      label: "Deployment",
      collapsible: false,
      items: ["deployment/kubernetes", "deployment/env-vars"],
    },
    {
      type: "category",
      label: "API Reference",
      collapsible: false,
      items: ["api/rest-api"],
    },
    {
      type: "category",
      label: "Integrations",
      collapsible: false,
      items: ["integrations/coalition", "integrations/customer-portal", "integrations/widget"],
    },
    {
      type: "category",
      label: "Community",
      collapsible: false,
      items: ["community/changelog", "community/contributing"],
    },
  ],
};

export default sidebars;
