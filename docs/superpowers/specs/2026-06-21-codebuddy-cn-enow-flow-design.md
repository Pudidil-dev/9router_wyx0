# CodeBuddy CN Enow-Flow Alignment

## Goal

Make the CodeBuddy CN automation follow the reconstructed `enow-reverse` lifecycle rather than stopping after basic phone/OTP login:

`login -> API key -> gateway state -> credit refresh -> best-effort activation -> saved connection`

`codebuddy-cn` remains separate from the permanently disabled regular `codebuddy` provider.

## Behavior Contract

- Launch the existing isolated Camoufox session with CN locale and region handling.
- Follow the recovered login choices: select the intended login route, avoid unrelated WeChat/QQ paths, and support the recovered HK 5sim route when automatic SMS registration is selected.
- After credentials are visible, create the API key, capture gateway status, and refresh credits before determining whether the account needs the recovered CodeBuddy CN activation flow, matching the reconstructed enow entrypoint.
- Use the browser activation path first, including the recovered invite/free-tier controls, then use the recovered API activation endpoint as a fallback when its request shape is available.
- Persist activation and gateway outcomes with the saved credentials. Match enow's best-effort behavior: activation failures become `activation_skipped`, and a gateway authentication block becomes persisted probation metadata without discarding otherwise valid credentials.
- Save the connection after the recovered gateway, credit, and best-effort activation steps complete.

## Boundary Conditions

- Preserve cancellation and worker cleanup; no late browser callback may save a cancelled account.
- Keep explicit progress and metadata for upstream activation or gateway checks that cannot be completed programmatically, while preserving enow's successful credential result.
- Do not alter the global `codebuddy` provider or unrelated pending CodeBuddy CN work.
- Use offline tests for state transitions and request construction; live upstream behavior remains separately validated with a user-controlled test account.

## Dashboard Integration

- Categorize `codebuddy-cn` with the Free Tier providers rather than the generic OAuth Providers section.
- Place CodeBuddy CN immediately after regular CodeBuddy in the provider list.
- Treat CodeBuddy CN as an automation-owned provider on its detail page. Its primary action is `Open Automation`, linking to `/dashboard/automation?provider=codebuddy-cn`.
- Place the CodeBuddy CN automation tab immediately after regular CodeBuddy.
- Expose two separate modes:
  - `OAuth Login` uses the existing CodeBuddy CN device OAuth flow.
  - `5sim Bulk Registration` uses a dedicated modal backed only by `/api/tools/automation/cbcn/*`.
- The 5sim modal accepts the 5sim API key, account count, worker count, and recovered HK route overrides; it displays job summary, account steps, live preview, activity, errors, and cancellation.
- Do not route CodeBuddy CN bulk registration through the generic `/api/oauth/{provider}/bulk-import` contract.

## Verification

- Add focused tests for activation-required, activation-complete, and gateway-probation outcomes.
- Run the CBCN provider, usage, manager, and route tests.
- Run the production build and perform one manual live run through the dashboard.
- Verify provider placement, detail-page deep linking, both automation modes, narrow-screen modal layout, and cancellation in the browser.
