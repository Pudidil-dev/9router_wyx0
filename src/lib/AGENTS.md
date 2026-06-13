# Server Libraries

## Purpose

- Own persistence, provider authentication services, network helpers, usage data, tunnels, updater behavior, MCP integration, and other server-side application services.

## Ownership

- Root database modules such as `localDb.js`, `usageDb.js`, `requestDetailsDb.js`, and `disabledModelsDb.js` own durable local state contracts.
- `db/` owns storage drivers, migrations, repositories, and database lifecycle.
- `oauth/` owns provider authorization, token exchange, refresh, and import services.
- `auth/`, `network/`, `usage/`, `tunnel/`, `updater/`, `mcp/`, and provider-specific folders own their named server domains.

## Local Contracts

- Preserve stored data compatibility and migration order; never discard user data as an incidental fix.
- Keep secrets out of logs, responses, fixtures, and committed files.
- Make writes resilient to partial or concurrent operations using existing repository and transaction patterns.
- Keep environment and data-directory handling centralized rather than hard-coding platform paths.
- Changes to storage shape, credential lifecycle, or externally visible side effects require tests and documentation updates.

## Work Guidance

- Use existing repository, normalization, and provider service APIs before reaching directly into storage.
- Keep provider-specific token fields and refresh rules in provider-local services.
- Handle corrupt, absent, and legacy data explicitly where the surrounding module supports recovery.

## Verification

- Run focused database, migration, OAuth, or provider tests under `tests/unit`.
- Run `npm run build` when exports or server bundling change.

## Child DOX Index

- No child DOX files are currently defined; this file owns the full `src/lib` subtree.
