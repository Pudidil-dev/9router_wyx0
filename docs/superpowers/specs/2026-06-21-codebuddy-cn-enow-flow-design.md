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
- Persist a distinct activation/gateway outcome. A gateway authentication block is recorded as the recovered probation state instead of being mislabeled as a successful, usable connection.
- Create an API key only after activation and gateway checks succeed, then save the connection and refresh credit metadata.

## Boundary Conditions

- Preserve cancellation and worker cleanup; no late browser callback may save a cancelled account.
- Keep explicit, actionable terminal states for upstream pages that cannot be completed programmatically, rather than incorrectly reporting success.
- Do not alter the global `codebuddy` provider or unrelated pending CodeBuddy CN work.
- Use offline tests for state transitions and request construction; live upstream behavior remains separately validated with a user-controlled test account.

## Verification

- Add focused tests for activation-required, activation-complete, and gateway-probation outcomes.
- Run the CBCN provider, usage, manager, and route tests.
- Run the production build and perform one manual live run through the dashboard.
