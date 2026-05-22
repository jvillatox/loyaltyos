---
sidebar_position: 3
title: Widget
---

# Loyalty Widget

The LoyaltyOS Widget (`apps/widget`) is an embeddable Web Component built with Lit. Add a loyalty panel to any website with a single script tag. Themes via CSS custom properties. ~45 KB gzipped.

## Quick Start

### Script tag

```html
<script type="module" src="https://cdn.example.com/loyalty-widget.js"></script>

<loyalty-widget
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-session-token"
  mode="full"
  lang="en"
></loyalty-widget>
```

### npm

```bash
pnpm add @loyaltyos/widget
```

```typescript
import "@loyaltyos/widget";
```

## Attributes

| Attribute    | Type   | Default  | Description                                    |
| ------------ | ------ | -------- | ---------------------------------------------- |
| `api-url`    | string | —        | LoyaltyOS API base URL (required)              |
| `api-key`    | string | —        | API key for authentication (required)          |
| `program-id` | string | —        | Program ID for multi-tenant scoping (required) |
| `member-id`  | string | —        | Member ID for personalization                  |
| `token`      | string | —        | JWT session token (from magic-link auth)       |
| `mode`       | string | `"full"` | Display mode: `"full"` or `"mini"`             |
| `lang`       | string | `"en"`   | Language: `"en"` or `"es"`                     |

## Display Modes

### Full mode (`mode="full"`)

Shows all sub-components: points card, tier card with progress bar, top 3 rewards, badges gallery.

### Mini mode (`mode="mini"`)

Compact single-card view with points balance, current tier name, and quick "View rewards" link.

## Standalone Components

```html
<loyalty-points-card
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-token"
></loyalty-points-card>

<loyalty-tier-card ...></loyalty-tier-card>
<loyalty-rewards-top3 ...></loyalty-rewards-top3>
<loyalty-badges-gallery ...></loyalty-badges-gallery>
```

## Theming

Override CSS custom properties to match your brand:

```css
loyalty-widget {
  --loy-font-family: "Inter", sans-serif;
  --loy-color-primary: #7c3aed;
  --loy-color-primary-text: #ffffff;
  --loy-color-surface: #ffffff;
  --loy-color-text: #0f172a;
  --loy-color-text-secondary: #64748b;
  --loy-color-success: #16a34a;
  --loy-color-warning: #ea580c;
  --loy-radius-sm: 4px;
  --loy-radius-md: 8px;
  --loy-radius-lg: 12px;
  --loy-space-sm: 8px;
  --loy-space-md: 16px;
  --loy-space-lg: 24px;
}
```

## Events

| Event                      | When                             |
| -------------------------- | -------------------------------- |
| `loyalty:ready`            | Widget has finished loading data |
| `loyalty:error`            | API call failed                  |
| `loyalty:redeem-success`   | Reward was redeemed successfully |
| `loyalty:wishlist-updated` | Wishlist state changed           |

```javascript
document.querySelector("loyalty-widget").addEventListener("loyalty:ready", () => {
  console.log("Widget is ready");
});
```

## Build

```bash
pnpm --filter @loyaltyos/widget build
```

Output in `apps/widget/dist/`: `loyalty-widget.js` (ES module) and `loyalty-widget.umd.cjs` (UMD fallback).

## Browser Support

All modern browsers that support Web Components (Chrome, Firefox, Safari, Edge). No polyfills needed.
