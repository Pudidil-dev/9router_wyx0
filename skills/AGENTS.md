# Distributed Agent Skills

## Purpose

- Own standalone `SKILL.md` documents that teach external AI agents how to use 9Router capabilities.

## Ownership

- `9router/` is the entry and setup skill.
- Capability folders own chat, embeddings, image, speech, web search, and web fetch workflows.
- `README.md` indexes public raw links and shared environment setup.

## Local Contracts

- Keep every skill usable as a standalone document fetched from a raw GitHub URL.
- Keep endpoint paths, environment variables, authentication behavior, request schemas, and examples aligned with the actual API.
- Do not embed real API keys, credentials, private URLs, or machine-specific paths.
- Update the entry skill and `README.md` index when adding, renaming, or removing a capability skill.
- Prefer concise, imperative instructions and explicit verification examples.

## Work Guidance

- Compare examples with the corresponding route and provider behavior before publishing changes.
- Keep cross-skill duplication limited to setup details necessary for standalone use.

## Verification

- Inspect Markdown frontmatter, links, shell snippets, and JSON examples.
- Exercise changed endpoint examples against a local server when behavior or schemas change.

## Child DOX Index

- No child DOX files are currently defined; each capability folder is currently governed by this file.
