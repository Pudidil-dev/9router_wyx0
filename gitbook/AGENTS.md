# Documentation Site

## Purpose

- Own the standalone multilingual Next.js documentation site and its localized Markdown content.

## Ownership

- `app/` owns docs routes, layouts, and styling.
- `components/` owns documentation navigation and rendering UI.
- `content/<lang>/` owns localized Markdown pages.
- `constants/docsConfig.js` owns shared navigation slugs and translated labels.
- `constants/languages.js` owns supported language metadata.
- `lib/` and `utils/` own content loading and Markdown processing.

## Local Contracts

- Keep navigation slugs aligned with files in every supported language.
- Preserve language fallback behavior and valid locale routing.
- When adding a language, update language metadata, translated navigation labels, and the required content tree together.
- When changing user-facing documentation semantics, update all maintained translations or explicitly document incomplete parity.
- Keep links, headings, code samples, and deployment commands accurate for the current product.

## Work Guidance

- Reuse the shared slug structure rather than creating language-specific navigation shapes.
- Keep Markdown content authoritative; avoid hard-coding article bodies in components.
- Check mobile sidebar, table of contents, code blocks, and long localized text for layout regressions.

## Verification

- Run `npm --prefix gitbook run build`.
- For visual changes, run `npm --prefix gitbook run dev` and inspect representative desktop and mobile pages.

## Child DOX Index

- No child DOX files are currently defined; this file owns the full `gitbook` subtree.
