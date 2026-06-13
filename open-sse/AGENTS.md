# Routing And Provider Core

## Purpose

- Own provider-neutral request orchestration, provider executors, streaming transformations, account fallback, token refresh integration, usage extraction, and cross-format translation.

## Ownership

- `handlers/` owns chat, response, embeddings, speech, image, and search orchestration.
- `executors/` owns provider-specific network requests and refresh behavior.
- `services/` owns model, provider, account, project, credential, and usage services.
- `config/` owns provider/model capability declarations and runtime constants.
- `translator/` owns request and response format conversion.
- `utils/`, `transformer/`, and `rtk/` own stream helpers, response transformations, and token-saving filters.

## Local Contracts

- Preserve streaming frame order, terminal events, usage reporting, and abort behavior.
- Keep provider-specific behavior in executors or provider-local handlers; keep shared orchestration provider-neutral.
- Treat status-based retry, credential refresh, cooldown, and account fallback rules as behavioral contracts.
- Add provider/model declarations consistently across config, executor selection, translator registration, and tests.
- Never log authorization headers, tokens, cookies, or complete sensitive request bodies by default.

## Work Guidance

- Trace both streaming and non-streaming paths before changing shared handlers.
- Check source format, target format, provider model metadata, and executor behavior together.
- Use structured parsing for SSE, NDJSON, protobuf, and provider envelopes; preserve unknown fields when compatibility requires it.

## Verification

- Run focused unit tests for the changed handler, executor, fallback, or stream behavior.
- Run `tests/translator` when formats, model metadata, or translator registration change.
- Run `npm run build` for shared runtime or bundling changes.

## Child DOX Index

- `translator/AGENTS.md` - translation registry, request and response converters, bridge pitfalls, and translator test rules.
