# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue or pull request. On GitHub, use **Security > Report a vulnerability** on this repository (private vulnerability reporting). Include what you found, how to reproduce it, and what you think the impact is.

You can expect an acknowledgement within a week or so. This is a small, volunteer-run project, so there is no guaranteed timeline and no bug bounty, but real reports get a fix and credit if you want it.

## What the project is, and is not

Deca is designed for small private rooms between people who share a link. It is **not** a hardened public service. The security model, what is signed and verified, the server limits, and the **known gaps** are written down in the Security section of [docs/SPEC.md](docs/SPEC.md#security). In short:

- Chat events are signed with each person's own key, so nobody can write as someone else; the server never sees message content.
- Voice, video and file data travel directly between browsers, encrypted by WebRTC. A relay (TURN), if you configure one, only carries encrypted bytes but can see who talked to whom and how much.
- In normal server rooms the signaling server is trusted to introduce people honestly. In "connect by code" rooms, codes are signed, newcomers need the host's approval, and members can compare check words.
- Some control messages (music, media and link advertisements) are not signed; a member can lie about them. See the known gaps.

## In scope

The web app (`dema-client`), the signaling server (`dema-server/server.js`), the launcher scripts (`scripts/`), and the way they handle untrusted input from other people in a room.

## Out of scope

Third-party services the app talks to (YouTube's player, Google Fonts, public STUN servers, a TURN provider you choose), games you add yourself, and denial of service against a server you host without the protections in the Configuration section of the README.
