# Start here

Deca is a private room you share with a link: chat, calls, files, music and games with your friends. It runs on your own computer. Nothing is stored on anyone's server.

## What you need

- A Mac or a Windows PC, and an internet connection.
- **Node.js**, a free program, installed once. Get it at <https://nodejs.org> (click the big green button, open the file, click Next/Continue until it finishes). If you skip this, the start file below opens that page for you.

## Start it

1. If you downloaded a zip, **unzip it** (double-click it).
2. Open the folder and double-click:
   - **Mac:** `Start Deca.command`
   - **Windows:** `Start Deca.bat`
3. Wait. The first time takes a few minutes while it sets itself up. A window shows what it is doing.
4. When it says **"Deca is running"**, your browser opens and the window shows a link. **That link is your invitation.** Send it to your friends in any chat. (It may already be copied for you.)
5. Open the link yourself too, type your name and press **Create a space**.

**Keep that window open while you hang out. Close it to stop Deca.** The link changes every time you start, and a brand-new link can take up to a minute to start working for other people. If a friend sees "not found", wait a moment and refresh.

## If your computer warns you

The start files are not "signed" by a big company, so your computer is careful the first time:

- **Mac says "cannot be opened because the developer cannot be verified":** right-click (or Control-click) the file, choose **Open**, then **Open** again. You only do this once.
- **Mac says it is not allowed to run:** open the Terminal app, type `bash ` (with a space), drag the file into the window, press Enter.
- **Windows says "Windows protected your PC":** click **More info**, then **Run anyway**.

Everything is plain text you can read: the launcher is `scripts/start.mjs`.

## Good to know

- Your browser will ask to use your camera and microphone when you start a call. Say yes. It only works on the link you were given (a secure address), not on a plain internet address from your local network.
- Up to 8 people fit in a room.
- Can't reach the link, or want no server in the middle? On the first screen pick **No server? Connect by code**. Whoever joins gets a short code to send to whoever invited them; that person pastes it in (Members, then **Connect by code**) and sends a code back.
- Only on this computer, with no public link? Run `node scripts/start.mjs --local` in a terminal.
- Linux: `node scripts/start.mjs`.
- Something not working? The file `.run/server.log` shows what happened.

---
Deca was built entirely by AI (Claude, by Anthropic), with a person choosing what to build and trying it out. It is free and open source (MIT).
