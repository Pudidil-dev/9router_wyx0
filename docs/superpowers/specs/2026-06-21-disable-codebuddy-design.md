# Permanently Disable CodeBuddy

## Scope

Permanently system-disable the regular `codebuddy` provider. Leave `codebuddy-cn` unchanged.

## Design

- Mark only the `codebuddy` registry entry as `systemDisabled` with its existing warning message.
- Enforce the lock through the existing provider-disabled guard so dashboard, API, OAuth, and bulk-login entry points reject it consistently.
- Keep the provider visible with its warning rather than removing or renaming it, so existing connections and configuration remain understandable.
- Do not alter `codebuddy-cn`, its executor, or its availability.

## Verification

- Add or update focused provider-availability coverage proving `codebuddy` cannot be enabled while `codebuddy-cn` remains available.
- Run the focused tests and a production build.
