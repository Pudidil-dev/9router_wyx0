# 9Router WYx0

WYx0 fork of 9Router focused on provider automation, multi-account workflows, and quota tracking for coding agents.

This repository is forked from [decolua/9router](https://github.com/decolua/9router). The upstream project remains the base AI router. This fork documents and ships the WYx0 changes on top: Kiro automation, CodeBuddy automation, quota tracker upgrades, and small dashboard quality-of-life updates.

This branch is synced with upstream 9Router `v0.5.4` while preserving WYx0 automation.

## Focus

- Kiro bulk login automation with browser-assisted Google account flow and worker progress recovery.
- CodeBuddy and Qoder bulk login automation with browser/device polling and saved OAuth connections.
- Experimental 1min AI bulk login automation with conservative one-worker defaults.
- Gemini Web cookie onboarding with auto-capture support and dedicated provider branding.
- CodeBuddy quota tracking through the web console usage endpoint when a valid web session cookie is available.
- Quota Tracker improvements, including provider pagination and single-account/bulk display modes.
- Provider UX polish: refreshed provider icons, provider icon fallback, connection status filtering, and related dashboard updates.
- Safer provider workflows: token refresh handling, account fallback, CodeBuddy tiny-stream retry, request detail compaction, and focused tests around the new automation paths.

## Upstream v0.5.4 Included

This fork includes upstream 9Router v0.5.4 updates while retaining WYx0-specific behavior, including:

- Combo Fusion and capacity auto-switch improvements.
- Kiro API-key/headless auth support.
- Claude quota auto-ping and 429 throttling updates.
- Upstream OpenSSE provider registry refactor, with WYx0 providers re-added to the registry.
- Upstream Kiro thinking budget, Antigravity/Kiro/Xiaomi, Combo Fusion, custom vision model, and compatible-node alias fixes from the v0.5.3/v0.5.4 release line.
- Upstream provider, model, translator, CLI, runtime, and dashboard fixes through the v0.5.4 release line.

## What Changed In This Fork

### Automation

- Added `/dashboard/automation` as the entry point for bulk provider workflows.
- Added Kiro bulk import routes and services for browser-based account onboarding.
- Added CodeBuddy and Qoder bulk import routes and services, including browser/device authorization polling.
- Added experimental 1min AI bulk import support with a one-worker safety cap.
- Added server-side worker capacity recommendations via `/api/system/capacity`, with browser-device fallback when the endpoint is unavailable.
- Added reusable browser automation helpers for Google login, provider onboarding, region selection, privacy prompts, and manual follow-up.

### Quota Tracking

- Added CodeBuddy to supported usage providers.
- Added CodeBuddy quota parsing for credit packages such as monthly, gift, extra, and activity credits.
- Added a CodeBuddy "Quota Cookie" flow so existing OAuth connections can attach a web console cookie for usage reads.
- Added Quota Tracker pagination and a display mode switch for single-account versus bulk provider views.

### Provider And Dashboard Polish

- Added and refreshed provider visual assets, including CodeBuddy and Gemini Web icons, plus provider icon fallback behavior.
- Removed promotional header actions so the dashboard focuses on routing, providers, and automation controls.
- Improved connection status utilities and provider table ergonomics for automation-heavy workflows.
- Added supporting tests for Kiro/CodeBuddy import managers, route behavior, connection status, and account fallback.

## CodeBuddy Quota Note

CodeBuddy chat uses the plugin/CLI OAuth token, but the CodeBuddy credit usage endpoint is part of the web console and requires a valid web session cookie. New CodeBuddy bulk automation attempts to capture that cookie during browser login. Existing connections can attach it from:

`Dashboard -> Providers -> CodeBuddy -> select connection -> Quota Cookie`

If the cookie is missing or expired, the connection can still chat, but quota tracking will show a clear message instead of fake usage numbers.

## Local Development

For the fastest development loop, use Turbopack:

```bash
cp .env.example .env
npm install
npm run dev:turbo
```

Use the webpack dev server only when debugging Turbopack-specific issues:

```bash
npm run dev
```

Default local URLs:

- Dashboard: `http://localhost:20129/dashboard`
- OpenAI-compatible API: `http://localhost:20129/v1`
- Automation: `http://localhost:20129/dashboard/automation`
- Quota Tracker: `http://localhost:20129/dashboard/quota`
- Server capacity recommendation API: `http://localhost:20129/api/system/capacity`

Fast production-like WYx0 run, using the built CLI/app bundle and project-local data directory:

```bash
node cli/scripts/build-cli.js
npm run wyx
```

If the CLI/app bundle is already current, start WYx0 directly:

```bash
npm run wyx
```

When running beside an original 9Router instance, prefer `http://127.0.0.1:20129/dashboard` to avoid sharing `localhost` auth cookies.
WYx0 also supports isolated dashboard cookies via `.env` so both apps can stay logged in even when opened on the same hostname:

```env
AUTH_TOKEN_COOKIE_NAME=wyx_auth_token
OIDC_STATE_COOKIE_NAME=wyx_oidc_state
OIDC_NONCE_COOKIE_NAME=wyx_oidc_nonce
OIDC_VERIFIER_COOKIE_NAME=wyx_oidc_code_verifier
```

After changing these values for the fast WYx0 runtime, rebuild the CLI/app bundle before starting it again:

```bash
node cli/scripts/build-cli.js
npm run wyx
```

Production build:

```bash
npm run build
PORT=20129 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run start
```

## Verification

Recommended checks before opening a PR:

```bash
npm run build
```

Focused unit tests may be run when the local test setup is available:

```bash
npx vitest run tests/unit/kiro-bulk-import-manager.test.js tests/unit/kiro-bulk-import-routes.test.js
npx vitest run tests/unit/codebuddy-bulk-import-manager.test.js tests/unit/codebuddy-bulk-import-routes.test.js
npx vitest run tests/translator/bugs-kiro.test.js tests/translator/format-roundtrip.test.js
```

## PR Scope

This fork's current PR scope is intentionally centered on WYx0 changes:

- Preserve Kiro automation.
- Preserve CodeBuddy, Qoder, and 1min AI automation flows.
- Preserve Gemini Web cookie onboarding and provider branding.
- Preserve CodeBuddy quota usage support.
- Preserve quota tracker pagination and bulk/single view behavior.
- Sync upstream 9Router v0.5.4 fixes/features while keeping fork metadata and packaging.

## Upstream Credit

9Router WYx0 builds on the original 9Router project by decolua. Keep upstream credit and license notices intact when redistributing or merging changes.
