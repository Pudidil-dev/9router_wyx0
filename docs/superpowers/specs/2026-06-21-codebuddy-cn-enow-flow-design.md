# CodeBuddy CN Enow-Flow Alignment

## Goal

Make the CodeBuddy CN automation follow the reconstructed `enow-reverse` lifecycle rather than stopping after basic phone/OTP login:

`login -> account activation -> gateway state -> API key -> saved connection -> credit refresh`

`codebuddy-cn` remains separate from the permanently disabled regular `codebuddy` provider.

## Behavior Contract

- Launch the existing isolated Camoufox session with CN locale and region handling.
- Follow the recovered login choices: select the intended login route, avoid unrelated WeChat/QQ paths, and support the recovered HK 5sim route when automatic SMS registration is selected.
- After credentials are visible, determine whether the account needs the recovered CodeBuddy CN activation flow.
- Use the browser activation path first, including the recovered invite/free-tier controls, then use the recovered API activation endpoint as a fallback when its request shape is available.
- Persist activation and gateway outcomes with the saved credentials. Match enow's best-effort behavior: activation failures become `activation_skipped`, and a gateway authentication block becomes persisted probation metadata without discarding otherwise valid credentials.
- Create an API key only after activation and gateway checks succeed, then save the connection and refresh credit metadata.

## Boundary Conditions

- Preserve cancellation and worker cleanup; no late browser callback may save a cancelled account.
- Keep explicit progress and metadata for upstream activation or gateway checks that cannot be completed programmatically, while preserving enow's successful credential result.
- Do not alter the global `codebuddy` provider or unrelated pending CodeBuddy CN work.
- Use offline tests for state transitions and request construction; live upstream behavior remains separately validated with a user-controlled test account.

## Verification

- Add focused tests for activation-required, activation-complete, and gateway-probation outcomes.
- Run the CBCN provider, usage, manager, and route tests.
- Run the production build and perform one manual live run through the dashboard.
