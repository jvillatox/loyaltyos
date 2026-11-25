// Runtime configuration for the portal (read by src/lib/program.ts).
//
// The production image rewrites this file at container boot from the
// PORTAL_PROGRAM_ID environment variable (see Dockerfile entrypoint), so the
// program can be changed without rebuilding. In development, edit this file or
// open the portal with a ?program= query param.
window.__LOYALTYOS_CONFIG__ = window.__LOYALTYOS_CONFIG__ || {};
