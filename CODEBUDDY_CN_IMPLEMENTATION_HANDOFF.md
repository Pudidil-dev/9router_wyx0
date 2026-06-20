# CodeBuddy CN Implementation Handoff

## Current progress snapshot

Status as of `2026-06-20`:

- `codebuddy-cn` is no longer only a thin chat wrapper.
- Provider-side credential, usage, and image-generation work has been added in the repo.
- A dedicated CodeBuddy CN automation flow now exists under `src/app/api/tools/automation/cbcn/*` with dashboard wiring.
- 5sim-assisted registration support has been added to the automation manager.
- Several focused tests were added for provider, usage, automation manager, and automation routes.
- The latest route regression for Next.js 16 dynamic params has been fixed in `src/app/api/tools/automation/cbcn/[jobId]/route.js`.

What is working in-repo right now:

- dedicated CodeBuddy CN automation tab and job viewer in the dashboard automation page
- `start`, `logs`, `cancel`, `balance`, `warmup`, and job-detail `cbcn` API routes
- manual credential capture and direct credential import paths
- automatic 5sim number ordering and OTP polling path in the automation manager
- best-effort saved-connection balance snapshot and warmup flow
- provider/runtime additions for CodeBuddy CN usage probing and image handling

What is still not fully proven end to end:

- live browser automation through the current CodeBuddy CN login UI is still brittle
- the SMS login surface appears to move between normal DOM and iframe-backed UI states
- `npm run build` was attempted during this work, but the latest observed run stayed at `Creating an optimized production build ...` long enough that it was not treated as a clean pass
- real credit outcomes from newly created CN accounts still depend on live upstream behavior and 5sim inventory

## Recommended next resume point

If another agent picks this up, resume from the live automation/browser path first, not the provider runtime:

1. Verify the current local server is actually running the patched workspace code.
2. Re-test the CodeBuddy CN SMS-login opener against the current `codebuddy.cn` UI.
3. Confirm whether the login button opens a modal, an iframe-hosted panel, or a full redirect in the active runtime.
4. If the UI has shifted again, patch `openCodeBuddyCnSmsLogin` and the OTP entry selectors in the automation manager.
5. Re-run the focused CBCN automation tests, then retry a live 5sim registration.

## Objective

Implement the newly recovered `codebuddy-cn` feature contract from the latest `enowxai.exe` into `D:\Project_Gabut\9router_wyx0` so the provider is not just a basic Tencent Copilot/OpenAI-compatible entry, but matches the deeper upstream behavior exposed by the new binary.

This handoff is meant to be tagged directly to another AI agent so it can execute the work end to end.

## Important context

The target repo already contains a first-pass `codebuddy-cn` provider:

- `open-sse/providers/registry/codebuddy-cn.js`
- `open-sse/executors/codebuddy-cn.js`
- `public/providers/codebuddy-cn.png`

That existing implementation is useful, but it looks much thinner than what was recovered from the new `enowxai` binary.

The goal of this task is to close that gap.

## Source of truth for the recovered feature

Read these files from `D:\Project_Gabut\enowxai` before changing code:

- `D:\Project_Gabut\enowxai\recovered\reports\codebuddy-cn-provider-recovery.md`
- `D:\Project_Gabut\enowxai\recovered\reports\codebuddy-cn-deep-recovery.md`
- `D:\Project_Gabut\enowxai\recovered\pseudocode\codebuddy_cn_provider.go`
- `D:\Project_Gabut\enowxai\recovered\pseudocode\cbcn_automation.go`
- `D:\Project_Gabut\enowxai\recovered\codebuddy_cn\report.md`
- `D:\Project_Gabut\enowxai\recovered\codebuddy_cn\functions.txt`
- `D:\Project_Gabut\enowxai\recovered\codebuddy_cn\routes.txt`
- `D:\Project_Gabut\enowxai\recovered\codebuddy_cn\urls.txt`
- `D:\Project_Gabut\enowxai\recovered\codebuddy_cn\strings.txt`

## Recovered feature contract from `enowxai`

The latest binary introduced a new provider that is absent from the older backup binary.

Recovered provider function names:

- `NewCodeBuddyCnClient`
- `RecoverCodeBuddyCnIdentity`
- `extractCodeBuddyCnIdentityFromJWT`
- `resolveToken`
- `SendRequest`
- `SendRequestWithContextAndProxy`
- `ProcessStreamingResponse`
- `ProcessStreamFromReader`
- `FetchCredits`
- `GenerateImage`
- `WarmupCodeBuddyCnAccount`

Recovered credential forms:

- `jwt_token`
- `access_token`
- `api_key`

Recovered upstream/domain hints:

- `https://www.codebuddy.cn/console/api/client/v1/api-keys`
- `www.codebuddy.cn`
- activity / growth / console endpoints tied to account warmup and credits

Recovered automation/API route hints:

- `/api/tools/automation/cbcn/start`
- `/api/tools/automation/cbcn/logs`
- `/api/tools/automation/cbcn/cancel`
- `/api/tools/automation/cbcn/balance`

Recovered behavior hints:

- provider has an explicit identity recovery path from JWT
- provider can resolve and prefer different token types
- provider supports credit refresh
- provider supports image generation
- provider has a warmup flow
- automation appears to include enterprise login and OTP handling

## Current gap in `9router_wyx0`

This section is now partially outdated. The repo no longer only has the original thin implementation.

Originally the current `codebuddy-cn` implementation appeared to do only this:

- register provider metadata and model list
- call `https://copilot.tencent.com/v2/chat/completions`
- force streaming
- normalize `reasoning_effort`

That is much smaller than the recovered contract above.

The largest originally missing pieces were:

- richer credential resolution for `jwt_token` / `access_token` / `api_key`
- identity extraction and persistence from JWT
- credit fetching / balance refresh
- account warmup flow
- automation endpoints or automation manager for CN-specific account setup
- image generation path
- dashboard affordances for CN automation and balance refresh
- focused tests for all of the above

Current status against that list:

- credential/runtime work: partially implemented in the repo
- balance refresh support: implemented at the dashboard/API level, still needs live validation quality checks
- warmup flow: implemented
- CN automation manager and routes: implemented
- 5sim-assisted registration path: implemented, but still sensitive to live login UI changes
- image generation path: implemented in repo code, still worth sanity-checking live
- focused tests: added for multiple CBCN areas

## Required repo reading order

Before editing, read the applicable DOX chain and existing implementation files.

Read these `AGENTS.md` files first:

- `D:\Project_Gabut\9router_wyx0\AGENTS.md`
- `D:\Project_Gabut\9router_wyx0\open-sse\AGENTS.md`
- `D:\Project_Gabut\9router_wyx0\src\AGENTS.md`
- `D:\Project_Gabut\9router_wyx0\src\app\AGENTS.md`
- `D:\Project_Gabut\9router_wyx0\src\lib\AGENTS.md`
- `D:\Project_Gabut\9router_wyx0\tests\AGENTS.md`

Then inspect these likely touch points:

- `open-sse/providers/registry/codebuddy-cn.js`
- `open-sse/executors/codebuddy-cn.js`
- `open-sse/providers/index.js`
- `open-sse/config/providers.js`
- `open-sse/config/providerModels.js`
- `open-sse/handlers/chatCore.js`
- `src/sse/handlers/chat.js`
- `src/app/api/v1/chat/completions/route.js`
- `src/app/api/providers/route.js`
- `src/app/api/providers/[id]/test/route.js`
- `src/app/api/providers/[id]/test-models/route.js`
- `src/lib/oauth/services/codebuddyBulkImportManager.js`
- `src/lib/oauth/services/kiroGoogleAutomation.js`
- `src/app/api/oauth/codebuddy/bulk-import/route.js`
- `src/app/(dashboard)/dashboard/providers/page.js`
- `src/app/(dashboard)/dashboard/providers/[id]/page.js`
- `tests/unit/codebuddy-provider-test.test.js`
- `tests/unit/codebuddy-usage.test.js`
- `tests/unit/codebuddy-bulk-import-routes.test.js`

## Implementation goals

### 1. Strengthen provider credential handling

Make `codebuddy-cn` accept and correctly prioritize multiple auth shapes:

- `api_key`
- `access_token`
- `jwt_token`

Expected behavior:

- if `api_key` is available and valid for the chat path, use it
- if only JWT-style auth is present, recover identity fields from the JWT payload
- persist enough provider-specific metadata so the dashboard and test routes can explain what kind of auth is stored

Likely storage location:

- `providerSpecificData`

Suggested metadata fields:

- `authKind`
- `jwtSub`
- `jwtExp`
- `jwtEmail`
- `codebuddyCnUserId`
- `codebuddyCnEnterpriseId`
- `creditSource`
- `warmupAt`

### 2. Add balance / credit refresh support

Implement a provider-specific credit fetch path similar in spirit to the recovered `FetchCredits`.

Expected outcome:

- dashboard test/details page can display refreshed CN credits or quota info
- stored connection metadata can be updated with last known balance

Possible implementation shape:

- provider-specific fetch helper under `open-sse` or `src/lib/providers`
- API route to trigger refresh
- dashboard button or existing test action integration

Use the recovered CN console/activity/growth endpoint hints to determine the actual upstream request shape.

### 3. Add account warmup support

Recovered binary strongly suggests a `WarmupCodeBuddyCnAccount` flow.

Implement a provider-specific warmup step that can run before first normal usage or as a manual admin action.

Possible warmup responsibilities:

- touch upstream endpoints needed to activate the account
- prefetch console/account identity
- trigger trial/growth/activity initialization if needed
- cache warmup result in `providerSpecificData`

If the exact warmup contract cannot be proven from the binary strings alone, implement the minimal safe version and document the assumption in code comments and the PR summary.

### 4. Decide whether `codebuddy-cn` needs dedicated automation

The recovered binary includes dedicated automation routes under `cbcn`, which suggests this provider is not just normal chat transport.

Status:

- this decision has effectively been made
- dedicated automation now exists under `src/app/api/tools/automation/cbcn/*`
- the manager lives at `src/lib/oauth/services/codebuddyCnAutomationManager.js`
- the dashboard automation page includes a dedicated CBCN workflow

Investigate whether `9router_wyx0` should add:

- `src/app/api/oauth/codebuddy-cn/...`
- `src/lib/oauth/services/codebuddyCnBulkImportManager.js`
- dedicated browser automation helpers

Only add this if the recovered evidence supports it well enough.

If added, support at least:

- start job
- get logs/status
- cancel job
- fetch balance after successful account setup

Important:

- do not blindly clone `codebuddy` global behavior
- `codebuddy` and `codebuddy-cn` should remain separate providers with separate auth assumptions

### 5. Add image generation support if the provider contract really exposes it

Recovered symbol `GenerateImage` suggests image support exists.

Investigate the repo’s current image-generation provider pattern and either:

- implement `codebuddy-cn` image generation support fully, or
- document exactly why it is intentionally deferred

Do not silently ignore this symbol.

### 6. Tighten provider tests

Add focused tests for:

- credential resolution order
- JWT identity extraction behavior
- provider-specific header construction
- balance refresh logic
- warmup behavior
- any new automation route behavior
- image generation behavior if implemented

Prefer focused Vitest tests over broad suite churn.

Status:

- `tests/unit/codebuddy-cn-provider.test.js` exists
- `tests/unit/codebuddy-cn-usage.test.js` exists
- `tests/unit/codebuddy-cn-automation-manager.test.js` exists
- `tests/unit/codebuddy-cn-automation-routes.test.js` exists
- the CBCN automation route test file passed most recently after the Next.js 16 params fix

## Suggested execution order

1. Read recovered `enowxai` reports and pseudocode fully.
2. Read current `9router_wyx0` `codebuddy` and `codebuddy-cn` provider implementation fully.
3. Diff the existing `codebuddy` bulk-import / quota-cookie / provider-test flows against what `codebuddy-cn` needs.
4. Implement credential resolution and JWT identity recovery first.
5. Implement balance refresh second.
6. Implement warmup third.
7. Add automation only if evidence is strong enough and the repo architecture has a clean insertion point.
8. Add image generation if supported by existing provider abstractions.
9. Add focused unit tests.
10. Run targeted verification and then `npm run build`.

## Guardrails

- Keep `codebuddy` and `codebuddy-cn` separate.
- Do not collapse CN behavior into the existing global `codebuddy` provider unless the code clearly requires a shared helper.
- Preserve existing repo style: ES modules, double quotes, semicolons, 2-space indentation.
- Keep provider-specific code close to its domain.
- If you introduce new durable provider metadata, make sure dashboard/API code can tolerate older connections that do not have those fields yet.

## Deliverables

At minimum, the implementation should leave the repo with:

- a stronger `codebuddy-cn` provider runtime
- focused tests for the new behavior
- any necessary dashboard/API wiring for credit refresh and warmup
- updated `AGENTS.md` files if the touched area gains new durable contract details

## Verification checklist

Run focused tests that match the changed files, then run:

```powershell
npx vitest run --config tests/vitest.config.js tests/unit/codebuddy-provider-test.test.js tests/unit/codebuddy-usage.test.js
```

Add any new focused test files as needed, for example:

```powershell
npx vitest run --config tests/vitest.config.js tests/unit/codebuddy-cn-provider.test.js tests/unit/codebuddy-cn-balance.test.js tests/unit/codebuddy-cn-automation-routes.test.js
```

Then run:

```powershell
npm run build
```

Latest known verification during this implementation:

- `npx vitest run --config tests/vitest.config.js tests/unit/codebuddy-cn-automation-routes.test.js` passed with `8` tests
- earlier focused CBCN tests were reported passing before the latest live-browser debugging loop
- `npm run build` has not yet been confirmed clean in the current stretch of work

## Explicit unknowns

These points still need confirmation during implementation:

- whether `codebuddy-cn` upstream chat should stay on `copilot.tencent.com` for all features
- which exact endpoint powers CN credit fetching
- whether CN API key creation is browser-backed like global CodeBuddy or token-backed directly
- whether enterprise login and OTP automation are required for a viable first implementation
- whether `GenerateImage` maps onto an existing image endpoint already used elsewhere in the repo

Additional live unknowns discovered during implementation:

- whether the currently running local runtime is always loading the latest patched workspace files
- whether CodeBuddy CN SMS login is consistently exposed in the top document or only inside an iframe/modal flow
- whether the automation should fall back to manual browser completion more aggressively when the login surface cannot be opened
- whether API key creation is always available immediately after login or requires an additional warmup/account-init step

## Practical success definition

This task is successful when `codebuddy-cn` in `9router_wyx0` is no longer a thin chat wrapper and instead reflects the deeper recovered provider contract from the new `enowxai` binary, with tests and verification included.

## Suggested handoff note

The repo is meaningfully ahead of the original brief: provider/runtime support, usage probing, image wiring, dashboard automation UI, `cbcn` API routes, and a 5sim-capable automation manager are now present. The main unfinished area is live reliability against the changing CodeBuddy CN login UI and completing a trustworthy full build/live verification pass.
