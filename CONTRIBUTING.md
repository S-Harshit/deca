# Contributing to Deca

Thanks for looking. Deca is a small project: a browser-only "room you carry in a link" (chat, files, calls, music, games, peer to peer over WebRTC) with a tiny server that only introduces people. Please read [docs/SPEC.md](docs/SPEC.md) first: it is the source of truth for how things behave, and a change should keep it in step.

## Before you start

- **Open an issue first** for anything bigger than a small fix, so we agree on the direction before you spend time. Deca is meant to stay a *hangout space* (rooms that disappear, no accounts, no stored history by default), not a chat platform: features like DMs, contacts, persistent profiles or server-side storage are out of scope.
- Look at [docs/PLUGINS.md](docs/PLUGINS.md) if you want to add a panel: shared features should be expressible with its primitives (last-writer-wins state, signed events, signals).

## Set up

You need Node 18 or newer.

```
cd dema-client && npm ci && npm run dev      # https dev server (HTTP=1 for plain http), proxies /ws /ice /games to :8080
cd dema-server && npm ci && node server.js   # the signaling and static server on :8080
```

Checks that must be clean before a pull request:

```
cd dema-client && npx tsc -b && npx eslint src && npm run build
cd tests && npm ci && node run.mjs quick      # or `node run.mjs` for everything (about 15 minutes)
```

Tests are described in [tests/README.md](tests/README.md). Add a test for each feature or bug fix, in the file for its topic. Browser suites run one at a time on purpose (one server, per-address limits).

## Rules that are easy to break

These come from hard lessons; the full list is in [CLAUDE.md](CLAUDE.md).

- **Events are signed and verified.** Never add an event path that skips `verifyEvent`, and never trust `author` or `by` fields from the wire. New event types go in `EventType`, the `TYPES` set and a validity rule in `derive()` (`log.ts`).
- **Control messages that are not events** (`music`, `media`, `links`...) are not signed: validate and sanitise them on receipt.
- **Server limits are deliberate** (`MAX_PAYLOAD`, `MAX_PER_IP`, rate limits, `MAX_PEERS`). Do not loosen them to make a test pass. Every socket needs an `error` listener.
- **Live-only effects** (coin, rock-paper-scissors, air horn) fire only for events that arrive live; history sync must never replay a sound or animation.
- **Theme CSS is scoped** (`html[data-theme="..."]`). Prefer new class names, and check the header and a running call after any layout CSS change: broad CSS edits have caused visual regressions here.
- **Games** are static folders in `dema-server/games/<id>/`. Never commit or fetch game assets you do not have the rights to.

## Style

Keep comments to the *why*. No emojis in code. TypeScript is strict (`noUnusedLocals`, `erasableSyntaxOnly`: no constructor parameter properties). Prefer small, scoped changes.

## About AI-written code

This project was written entirely by an AI (Claude) working with a human who set the direction. Contributions written with AI help are welcome on the same terms as any other: you are responsible for understanding what you submit, it must pass the checks above, and it must not include anything you do not have the right to contribute.

## Licence

By contributing you agree that your contribution is licensed under the project's [MIT licence](LICENSE).

## Security problems

Please do not open a public issue for a vulnerability: see [SECURITY.md](SECURITY.md).
