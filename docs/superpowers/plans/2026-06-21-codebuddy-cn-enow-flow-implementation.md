# CodeBuddy CN Enow-Flow Implementation Plan

**Goal:** Align the existing CodeBuddy CN automation with the reconstructed enow lifecycle while preserving valid credentials when activation or gateway checks are only best-effort.

**Architecture:** Keep the job manager responsible for orchestration and move CN account-state requests and activation decisions into a small provider-local lifecycle service. After browser credentials appear, the manager follows enow's recovered order: create the API key, check gateway state, fetch credits, run best-effort activation, persist the resulting metadata, and save the connection.

**Tech stack:** ES modules, Camoufox transport through the existing launcher, Next.js 16 routes, Vitest.

---

## Task 1: Implement the recovered account lifecycle as an isolated service

**Files:**
- Create: `src/lib/oauth/services/codebuddyCnLifecycle.js`
- Create: `tests/unit/codebuddy-cn-lifecycle.test.js`
- Read/reuse: `open-sse/executors/codebuddy-cn/config.js`

1. Write failing tests for:
   - activation is skipped when user info reports credits or `is_activated`;
   - browser activation is attempted before API fallback;
   - activation failure returns `activation_skipped` metadata instead of throwing away credentials;
   - gateway status maps `blocked`/`probation` and request errors to the recovered probation shape.
2. Run `npx vitest run --config tests/vitest.config.js tests/unit/codebuddy-cn-lifecycle.test.js` and confirm the missing service fails.
3. Implement request helpers that run through the authenticated page with cookies and use the recovered URLs/header from the existing CBCN config.
4. Implement the browser activation sequence reconstructed from enow: open activation URL, accept the visible agreement control, fill the configured invite code, select the free option, submit, and detect navigation completion.
5. Implement API activation only as the fallback and return structured outcomes; do not turn upstream uncertainty into a thrown job failure.
6. Re-run the lifecycle test file until green.

## Task 2: Align the browser/session setup and HK 5sim defaults

**Files:**
- Modify: `src/lib/oauth/services/codebuddyCnAutomationManager.js`
- Modify: `tests/unit/codebuddy-cn-automation-manager.test.js`

1. Add failing tests for the recovered default 5sim route: `hongkong / virtual54 / codebuddy`.
2. Add failing tests for CN region handling and lifecycle progress labels exposed through testable helpers.
3. Update only CBCN defaults; preserve explicit user overrides.
4. Add a provider-local post-login region selector for `china-mainland`, with `singapore` fallback only when the first option is unavailable.
5. Do not patch browser fingerprints or add a second browser runtime; continue using isolated Camoufox contexts.
6. Run the manager test file and confirm all manager tests pass and terminate cleanly.

## Task 3: Integrate activation and gateway metadata into account processing

**Files:**
- Modify: `src/lib/oauth/services/codebuddyCnAutomationManager.js`
- Modify: `tests/unit/codebuddy-cn-automation-manager.test.js`
- Modify: `tests/unit/codebuddy-cn-automation-routes.test.js` only if the sanitized job contract changes

1. Write failing orchestration tests for the exact ordering:
   `credentials captured -> API key -> gateway check -> quota probe -> best-effort activation -> save`.
2. Cover enow's non-blocking behavior: an activation exception logs `activation_skipped`, saves the recovered credentials, and persists activation metadata.
3. Cover gateway probation: save valid credentials with `gatewayStatus` metadata and surface a warning step without reporting a false hard failure.
4. Add cancellation assertions before activation, before API-key creation, and before saving so a cancelled job cannot produce a late connection.
5. Implement the lifecycle call and merge only sanitized lifecycle fields into `providerSpecificData`.
6. Re-run manager and route tests.

## Task 4: Complete credit refresh and durable status display

**Files:**
- Modify: `src/lib/oauth/services/codebuddyCnAutomationManager.js`
- Modify: `src/app/(dashboard)/dashboard/automation/page.js` only if existing activity rendering cannot show the new steps
- Modify: `tests/unit/codebuddy-cn-usage.test.js`
- Modify: `tests/unit/codebuddy-cn-automation-routes.test.js` as required

1. Add failing assertions that saved lifecycle metadata survives the first usage refresh.
2. Keep the dashboard on the existing shared automation UI; represent activation and probation through existing step/activity messages rather than adding a new workflow.
3. Ensure usage refresh cannot overwrite activation or gateway metadata.
4. Run CBCN usage and route tests.

## Task 5: Focused and production verification

1. Run:
   `npx vitest run --config tests/vitest.config.js tests/unit/codebuddy-cn-lifecycle.test.js tests/unit/codebuddy-cn-provider.test.js tests/unit/codebuddy-cn-usage.test.js tests/unit/codebuddy-cn-automation-manager.test.js tests/unit/codebuddy-cn-automation-routes.test.js`
2. Confirm the Vitest process exits without a lingering worker.
3. Run `git diff --check`.
4. Run `npm run build` and confirm exit code 0.
5. Perform one dashboard live test with a user-controlled account and record the observed steps without logging credentials, cookies, phone numbers, OTPs, or API keys.
6. Commit only the CBCN lifecycle files and tests; preserve unrelated working-tree changes.
