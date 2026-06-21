# Application Source

## Purpose

- Own the Next.js application, dashboard and management APIs, local persistence, shared UI and services, and the application-side SSE bridge.

## Ownership

- `app/` owns App Router pages, layouts, dashboard UI, and HTTP route handlers.
- `lib/` owns persistence, OAuth integrations, networking, usage storage, tunnels, MCP support, and other server-side services.
- `sse/` owns request parsing and orchestration before work enters `open-sse/`.
- `shared/`, `store/`, `i18n/`, `models/`, and `mitm/` remain owned by this file unless a nested contract is added.

## Local Contracts

- Keep server-only credentials and filesystem access out of client components.
- Preserve the boundary between application routes in `src/app`, application orchestration in `src/sse`, and provider-neutral runtime behavior in `open-sse`.
- Reuse shared constants, stores, hooks, and UI components instead of duplicating cross-dashboard behavior.
- Shared bulk automation components may expose provider-specific copy, worker limits, and device-based worker recommendations; Camoufox is the single browser runtime and bulk workers run headless by default.
- Keep CodeBuddy CN account activation and gateway-probation handling in provider-local OAuth services; routes and dashboard components consume sanitized job state only.
- Document durable changes to source ownership or runtime flow in this file and, when architectural, in `docs/ARCHITECTURE.md`.

## Work Guidance

- Follow existing App Router and ES module patterns.
- Keep provider-specific authentication and service logic under the closest provider or OAuth domain.
- Keep dashboard automation UI in `app/` thin and delegate browser-session, polling, and provider-specific login logic to `lib/oauth/services/*BulkImportManager`.
- Check imports across `@/` aliases and relative `open-sse` boundaries when moving modules.

## Verification

- Run focused Vitest files for the changed behavior.
- Run `npm run build` for changes that affect routes, components, shared imports, or server bundling.

## Child DOX Index

- `app/AGENTS.md` - dashboard UI and all App Router API surfaces.
- `lib/AGENTS.md` - persistence, OAuth, security-sensitive server services, and data lifecycle.
- `sse/AGENTS.md` - application-side routing, combo handling, credentials, and handoff to `open-sse`.
