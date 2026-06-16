# Project Scripts

## Purpose

- Own repository-level Node scripts used for safe Next.js builds, standalone startup, fast WYx0 runtime startup, and README translation helpers.

## Ownership

- `build-next-safe.mjs` owns the production build wrapper and any guardrails around invoking Next.js builds.
- `start-standalone.mjs` owns standalone server startup behavior for production bundles.
- `start-wyx-fast.cjs` owns the fast local WYx0 runtime entry used by `npm run wyx`.
- `translate-readme.js` owns README translation automation for root documentation.

## Local Contracts

- Preserve Node 18 compatibility and cross-platform Windows, macOS, and Linux behavior.
- Keep script side effects explicit, especially writes to build output, local runtime data, translated docs, or environment-derived paths.
- Do not embed secrets, machine-specific absolute paths, or provider credentials.
- Keep package scripts in `package.json` aligned with renamed, moved, or newly required files.

## Work Guidance

- Prefer small ES module scripts unless an existing CommonJS runtime constraint applies.
- Reuse existing environment variables and project data-directory conventions rather than inventing new path rules.
- Keep command output concise and actionable because these scripts run in developer and packaging workflows.

## Verification

- Run the exact package script or Node script affected by the change.
- Run `npm run build` after changes to build wrappers or Next.js startup assumptions.
- Run `npm run wyx` only when validating fast runtime startup behavior and stop it after the smoke test.

## Child DOX Index

- No child DOX files are currently defined; this file owns the full `scripts` subtree.
