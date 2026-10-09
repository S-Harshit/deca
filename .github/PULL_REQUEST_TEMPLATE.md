**What and why**

**How it was checked**
- [ ] `cd dema-client && npx tsc -b && npx eslint src && npm run build` is clean
- [ ] `cd tests && node run.mjs quick` passes (and a test covers the change)
- [ ] `docs/SPEC.md` says what changed
- [ ] No event path skips signature verification; no server limit was loosened

See CONTRIBUTING.md for the rules that are easy to break.
