# App Router

## Purpose

- Own dashboard pages and the HTTP API exposed by the Next.js App Router.

## Ownership

- `(dashboard)/`, `dashboard/`, `login/`, `landing/`, and `callback/` own user-facing routes.
- `api/v1/` and `api/v1beta/` own OpenAI, Anthropic, Gemini, and compatible client-facing endpoints.
- Other `api/` directories own dashboard management, provider setup, OAuth, keys, usage, sync, media, translator, tunnel, and runtime control endpoints.

## Local Contracts

- Keep compatibility endpoints thin: validate HTTP input, delegate to shared routing or service modules, and preserve expected status, headers, streaming, and error formats.
- Treat provider credentials, cookies, API keys, OAuth tokens, and request logs as sensitive.
- Preserve Next.js server/client boundaries; add `"use client"` only where browser state or APIs require it.
- Keep dashboard behavior aligned with the corresponding API contract and shared store.
- Do not silently change `/v1/*` compatibility semantics without focused regression tests.

## Work Guidance

- Follow nearby route and component patterns before adding abstractions.
- Reuse shared dashboard components and existing provider metadata.
- Keep `api/oauth/*/bulk-import` handlers thin: validate input, delegate to bulk import managers, and preserve the shared job JSON shape used by `BulkAccountAutomationModal`.
- For user-facing changes, verify loading, empty, error, disabled, and narrow-screen states.

## Verification

- Run focused unit tests for the affected route or provider flow.
- Run `npm run build`.
- For dashboard changes, run the app and inspect the affected workflow in a browser.

## Child DOX Index

- No child DOX files are currently defined; this file owns the full `src/app` subtree.
