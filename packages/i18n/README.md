# @loyaltyos/i18n

Shared i18n package for LoyaltyOS. Provides locale catalogs (es-MX as default, en-US),
translation helpers, date/currency/number formatting, and locale detection.

## Adding a new locale

1. Copy `src/locales/es-MX.json` to `src/locales/<new-locale>.json` and translate all values
2. Run `pnpm --filter @loyaltyos/i18n gen-types` to regenerate types
3. Run `pnpm --filter @loyaltyos/i18n check-parity` to verify key consistency

## Translation key convention

Keys use dot notation organized by domain: `domain.subdomain.key`

Examples:

- `members.title` → "Miembros" / "Members"
- `campaigns.typeLabels.BONUS_POINTS` → "Puntos Bonus" / "Bonus Points"
- `errors.INSUFFICIENT_BALANCE` → "Saldo insuficiente" / "Insufficient balance"

## Adding a new key

1. Add the key to `src/locales/es-MX.json` first (this is the source of truth)
2. Add the matching key to all other locale files
3. Run `pnpm --filter @loyaltyos/i18n check-parity` to verify consistency
4. Run `pnpm --filter @loyaltyos/i18n gen-types` to regenerate `TranslationKey` type

## Usage

```ts
import { t, formatDate, formatCurrency, formatPoints, resolveLocale } from "@loyaltyos/i18n";

// Initialize (call once at app startup)
await initCatalog("es-MX");

// Translate
t("members.balance"); // "Saldo"

// With parameters
t("common.pageInfo", { page: 1, totalPages: 5, total: 100 });

// Format
formatDate(new Date(), "es-MX"); // "27 de mayo de 2026"
formatCurrency(19.99, "USD", "en-US"); // "$19.99"
formatPoints(1500, "es-MX"); // "1,500 pts"

// Detect locale
resolveLocale({
  userPreference: "en-US",
  browserLanguage: "es",
  acceptLanguage: "fr",
}); // "en-US"

// Change language at runtime
await changeLanguage("en-US");
```

## CI

The `check-parity` script runs in CI to ensure all locale files have identical key sets.
If a locale is missing keys or has extra keys, CI fails.
