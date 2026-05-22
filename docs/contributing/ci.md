# CI/CD

## Required Secrets

Configure these in **Settings > Secrets and variables > Actions > Repository secrets**:

| Secret          | Purpose                                             | Workflow                             |
| --------------- | --------------------------------------------------- | ------------------------------------ |
| `NPM_TOKEN`     | npm access token for publishing `@loyaltyos/widget` | `release.yml` — `publish-widget` job |
| `CODECOV_TOKEN` | Codecov upload token for coverage reports           | `ci.yml` — `test` job                |

### NPM_TOKEN

1. Go to [npmjs.com](https://npmjs.com) → Access Tokens
2. Create a new **Automation** token (bypasses 2FA for CI)
3. Add it as `NPM_TOKEN` in the repository secrets

The workflow publishes `@loyaltyos/widget` on every `v*` tag push. No other packages are published to npm — only the widget is a standalone consumable (Web Component via CDN/bundler).

### CODECOV_TOKEN

1. Go to [codecov.io](https://codecov.io) → add the repository
2. Copy the upload token
3. Add it as `CODECOV_TOKEN` in the repository secrets

Coverage is uploaded on every push to `main` and every PR.
