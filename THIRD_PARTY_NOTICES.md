# Third-party notices

Deca itself is MIT licensed (see [LICENSE](LICENSE)). It uses and refers to the following.

## Shipped in the app (runtime dependencies)

| Package | Licence | Used for |
|---|---|---|
| [React](https://react.dev) and react-dom | MIT | the web app's interface |
| [highlight.js](https://highlightjs.org) | BSD-3-Clause | colouring code blocks in chat |
| [ws](https://github.com/websockets/ws) | MIT | the signaling server's WebSocket support |

Build tools, linters and test tools (Vite, TypeScript, ESLint, Playwright, pngjs and their own dependencies) are development dependencies and are not part of what is served. Their licences are in their own packages.

## Loaded from other places at run time (not bundled)

- **Fonts:** Inter, JetBrains Mono and Space Grotesk, from Google Fonts (SIL Open Font License 1.1). Opening Deca makes your browser request them from Google; self-hosting them would avoid that.
- **YouTube player:** the music feature plays videos in YouTube's embedded player. Nothing from YouTube is stored or redistributed by Deca; YouTube's own terms apply to what you play.
- **STUN servers:** public STUN servers (Google, Cloudflare) help browsers find each other's addresses. You can use your own through the `ICE_SERVERS` setting.

## Games

- **Snake** and **Pixel Hop** are original and part of this project (MIT).
- **Freedoom** (`dema-server/games/freedoom/`): the folder holds only a small page and its licence texts. Its game data file is a separate download (`get-wad.sh`) under the BSD licence, and the engine (PrBoom inside [EmulatorJS](https://emulatorjs.org), GPL) is fetched from the EmulatorJS CDN when someone plays. See `LICENSE-Freedoom.txt` and `CREDITS-Freedoom.txt` there.
- Any other game you place in `dema-server/games/` is yours: only add games you have the rights to. Everything there except the three above is git-ignored on purpose.

## Trademarks

Names such as YouTube, Google, Cloudflare, Render, Vercel, GitHub, React and shadcn/ui belong to their owners. Deca is not affiliated with or endorsed by them. The "Zinc" theme is an original CSS look inspired by shadcn/ui's visual style and uses none of its code.
