## What

<!-- One concern per PR. What changes, in a few lines. -->

## Why

<!-- The doc, decision (docs/07 Qnn) or module file this implements. -->

## Checks

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (frontend changes)
- [ ] Backend tests pass on Postgres (backend changes)
- [ ] One migration at most, with a real `downgrade()` (schema changes)
- [ ] No new entity, field or contract without product-owner sign-off
- [ ] No new inline role checks; permissions only through the policy
- [ ] Both themes and the skeleton / empty / error states checked (UI changes)
- [ ] The module board or status line updated, if this changes status
