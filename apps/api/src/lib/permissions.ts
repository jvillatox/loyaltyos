// The route manifest and permission lookup now live in the shared
// `@loyaltyos/api-contract` package so the API and the MCP server resolve the
// same source of truth. Kept as a re-export so existing imports don't churn.
export * from "@loyaltyos/api-contract";
