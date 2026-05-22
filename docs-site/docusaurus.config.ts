import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes } from "prism-react-renderer";

const config: Config = {
  title: "LoyaltyOS",
  tagline: "Open source customer loyalty platform",
  favicon: "img/logo.svg",

  url: "https://jvillatox.github.io",
  baseUrl: "/loyaltyos/",

  organizationName: "jvillatox",
  projectName: "loyaltyos",

  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/jvillatox/loyaltyos/edit/main/docs-site/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: "img/logo.svg",
    navbar: {
      title: "LoyaltyOS",
      logo: {
        alt: "LoyaltyOS Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Docs",
        },
        {
          to: "/docs/api/rest-api",
          label: "API",
          position: "left",
        },
        {
          href: "https://github.com/jvillatox/loyaltyos",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting Started", to: "/docs/getting-started/intro" },
            { label: "Core Concepts", to: "/docs/core-concepts/architecture" },
            { label: "API Reference", to: "/docs/api/rest-api" },
          ],
        },
        {
          title: "Community",
          items: [
            { label: "GitHub", href: "https://github.com/jvillatox/loyaltyos" },
            { label: "Contributing", to: "/docs/community/contributing" },
            { label: "Changelog", to: "/docs/community/changelog" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Deployment", to: "/docs/deployment/kubernetes" },
            { label: "Integrations", to: "/docs/integrations/coalition" },
          ],
        },
      ],
      copyright: `Copyright © ${String(new Date().getFullYear())} LoyaltyOS. Built with Docusaurus. MIT Licensed.`,
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
