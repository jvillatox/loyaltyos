# Widget Integration

The LoyaltyOS Widget (`apps/widget`) is an embeddable Web Component built with Lit. Add a loyalty panel to any website with a single script tag. Themes via CSS custom properties. ~45 KB gzipped.

## Quick Start

### Script tag (CDN or self-hosted)

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

### npm (for bundlers)

```bash
pnpm add @loyaltyos/widget
```

```typescript
import "@loyaltyos/widget";
```

```html
<loyalty-widget
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-token"
  mode="full"
  lang="en"
></loyalty-widget>
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
| `lang`       | string | `"en"`   | Language for static strings (`"en"` or `"es"`) |

## Display Modes

### Full mode (`mode="full"`)

Shows all sub-components stacked vertically:

- **Points card** — current balance with confirmed/pending breakdown
- **Tier card** — current tier with progress bar to next tier
- **Top 3 rewards** — most relevant rewards with points cost
- **Badges gallery** — unlocked badges with images

### Mini mode (`mode="mini"`)

Compact single-card view:

- Points balance
- Current tier name
- Quick "View rewards" link

## Standalone Components

Each sub-component can be used independently:

```html
<loyalty-points-card
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-token"
></loyalty-points-card>

<loyalty-tier-card
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-token"
></loyalty-tier-card>

<loyalty-rewards-top3
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  token="jwt-token"
></loyalty-rewards-top3>

<loyalty-badges-gallery
  api-url="https://api.example.com"
  api-key="dev-key"
  program-id="prog_dev"
  member-id="mem_001"
  token="jwt-token"
></loyalty-badges-gallery>
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
  --loy-space-xl: 32px;
  --loy-font-size-md: 14px;
  --loy-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
}
```

## Events

The widget dispatches custom DOM events:

| Event                      | When                                 |
| -------------------------- | ------------------------------------ |
| `loyalty:ready`            | Widget has finished loading data     |
| `loyalty:error`            | API call failed                      |
| `loyalty:redeem-success`   | Reward was redeemed successfully     |
| `loyalty:wishlist-updated` | Wishlist state changed (portal only) |

```javascript
document.querySelector("loyalty-widget").addEventListener("loyalty:ready", () => {
  console.log("Widget is ready");
});

document.querySelector("loyalty-widget").addEventListener("loyalty:error", (e) => {
  console.error("Widget error:", e.detail);
});
```

## Auth Flow

1. Your backend calls `POST /api/v1/auth/login` with the member's email.
2. Member clicks the magic link → token is verified.
3. Pass the resulting JWT as the `token` attribute to the widget.
4. Widget includes the token in all API requests via `Authorization: Bearer <token>`.

## Build

```bash
pnpm --filter @loyaltyos/widget build
```

Output in `apps/widget/dist/`:

- `loyalty-widget.js` — ES module (entry point)
- `loyalty-widget.umd.cjs` — UMD fallback

## Browser Support

All modern browsers that support Web Components (Chrome, Firefox, Safari, Edge). No polyfills needed.
