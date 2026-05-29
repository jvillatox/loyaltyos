# Localization

LoyaltyOS supports **es-MX** (Mexican Spanish) and **en-US** (US English). All user-facing surfaces — Admin, Portal, Widget, API errors, and email notifications — are localized.

## Supported Locales

| Locale  | Language         | Status    |
| ------- | ---------------- | --------- |
| `es-MX` | Spanish (Mexico) | Default   |
| `en-US` | English (US)     | Supported |

Translation catalogs live in `packages/i18n/src/locales/`. Each locale is a single JSON file with the same key structure.

### Adding a New Locale

1. Create `packages/i18n/src/locales/<locale>.json` with all required keys (use `en-US.json` as a template).
2. Add the locale to `SUPPORTED_LOCALES` in `packages/i18n/src/detect.ts`.
3. Register it in `packages/i18n/src/locales.ts` (for widget imports).
4. Register it in `apps/portal/src/lib/i18n.ts` and `apps/admin/src/lib/i18n.ts`.
5. Add the locale to the `Program.supportedLocales` array in your seed or admin panel.
6. Run `pnpm i18n:check` to verify all keys are present.

## Locale Resolution by Surface

### Admin (`apps/admin`)

| Priority | Source                                 |
| -------- | -------------------------------------- |
| 1        | `?lang=` query parameter               |
| 2        | sessionStorage `loyaltyos-locale`      |
| 3        | `/auth/me` API (admin user preference) |
| 4        | `navigator.language`                   |
| 5        | `es-MX` (hard fallback)                |

### Portal (`apps/portal`)

| Priority | Source                                                     |
| -------- | ---------------------------------------------------------- |
| 1        | `?lang=` query parameter                                   |
| 2        | sessionStorage `loyaltyos-locale`                          |
| 3        | `/auth/me` API → `member.locale` → `program.defaultLocale` |
| 4        | `navigator.language`                                       |
| 5        | `es-MX` (hard fallback)                                    |

The portal calls `bootstrapLocale()` before rendering to ensure correct strings on first paint. Language changes via the profile selector call `setUserLocale()`, which persists to both sessionStorage and the server (`PATCH /v1/members/me`).

### Widget (`apps/widget`)

| Priority | Source                                      |
| -------- | ------------------------------------------- |
| 1        | `?lang=` query parameter                    |
| 2        | `data-lang` attribute on `<loyalty-widget>` |
| 3        | `locale` attribute on `<loyalty-widget>`    |
| 4        | `navigator.language`                        |
| 5        | `es-MX` (hard fallback)                     |

Locale is resolved by `WidgetConfigController` and passed explicitly to `widgetT()` and `formatPoints()`. All string and number formatting uses the same locale value.

### API Errors (`apps/api`)

| Priority | Source                           |
| -------- | -------------------------------- |
| 1        | `Accept-Language` request header |
| 2        | `es-MX` (hard fallback)          |

Errors thrown via `LoyaltyError` are mapped to localized messages using the `errors.{code}` path in the catalog. Clients should send `Accept-Language: <locale>` to receive messages in their preferred language.

### Notifications (`packages/notifications`)

| Priority | Source                                          |
| -------- | ----------------------------------------------- |
| 1        | `_locale` in trigger context (from auth route)  |
| 2        | `member.locale` (persisted on first magic link) |
| 3        | `program.defaultLocale`                         |
| 4        | `es-MX` (hard fallback)                         |

Template lookup: first tries the resolved locale, then falls back to `program.defaultLocale`, then `es-MX`. Templates are unique per `(programId, name, locale)`.

## API Consumer Guide

To receive localized error messages, send the `Accept-Language` header:

```bash
# English response
curl -H "Accept-Language: en-US" \
  -H "X-Program-Id: prog_001" \
  https://api.example.com/api/v1/auth/verify-magic-link \
  -d '{"token":"invalid"}'

# Response: { "error": { "code": "INVALID_TOKEN", "message": "Invalid or expired token" } }

# Spanish response
curl -H "Accept-Language: es-MX" \
  -H "X-Program-Id: prog_001" \
  https://api.example.com/api/v1/auth/verify-magic-link \
  -d '{"token":"invalid"}'

# Response: { "error": { "code": "INVALID_TOKEN", "message": "Token inválido o expirado" } }
```

## Template Authoring

Notification templates use Handlebars syntax with locale-aware formatting helpers. Create one template per locale per trigger event.

### Example: Welcome Email

**Template (es-MX):**

```handlebars
Hola
{{member.firstName}}, ¡Bienvenido a nuestro programa de lealtad! Tienes
{{formatPoints welcomePoints _locale}}. Tu próximo nivel:
{{formatPoints nextTierPoints _locale}}.
```

**Template (en-US):**

```handlebars
Hi
{{member.firstName}}, Welcome to our loyalty program! You have
{{formatPoints welcomePoints _locale}}. Your next tier:
{{formatPoints nextTierPoints _locale}}.
```

### Available Handlebars Helpers

| Helper           | Usage                                       | Example Output |
| ---------------- | ------------------------------------------- | -------------- |
| `formatCurrency` | `{{formatCurrency amount currency locale}}` | $1,234.56      |
| `formatDate`     | `{{formatDate date style locale}}`          | May 27, 2026   |
| `formatPoints`   | `{{formatPoints n locale}}`                 | 1,234 pts      |

## Member Preference Storage

- `member.locale` stores the member's preferred locale (nullable).
- Set on first magic link request if the client sends a `locale` field.
- Can be updated via `PATCH /v1/members/me { locale }`.
- When `null`, the program's `defaultLocale` is used.
- Per-request overrides via `Accept-Language` header or `_locale` in notification context.
