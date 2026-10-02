/* eslint-disable @typescript-eslint/no-explicit-any -- wire messages are dynamic and validated at ingest */
// Full-mesh WebRTC on top of a signaling WebSocket.
// Every pair uses "perfect negotiation" so either side may renegotiate (needed for video).
// Each pair has two data channels: "ctl" (JSON events/control) and "file" (binary transfer),
// so a big file never blocks chat.

import type { LocalSignaling } from "./localSignal";

// Two independent STUN servers so one being unreachable does not slow every first connection (more than two only slows gathering).
const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];

/** iceCandidatePoolSize pre-gathers candidates so a connection starts with some already in hand. */
const rtcConfig = (iceServers: RTCIceServer[]): RTCConfiguration => ({ iceServers, iceCandidatePoolSize: 2, bundlePolicy: "max-bundle" });

// The server hands out ICE servers (STUN + optional TURN) from its ICE_SERVERS env var, so TURN
// credentials can change without rebuilding the client.
async function loadIceServers(): Promise<RTCIceServer[]> {
  if (import.meta.env.VITE_STATIC) return DEFAULT_ICE; // static hosting has no /ice
  try {
    // Never let a slow /ice hold up every connection: give it a couple of seconds, then use STUN.
    const res = await fetch(`${import.meta.env.BASE_URL}ice`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) return await res.json();
  } catch {
    // fall through to STUN only
  }
  return DEFAULT_ICE;
}

const BLOCKED_AFTER_MS = 25000;
/** A link that has not opened its data channel by now is rebuilt. */
const OPEN_TIMEOUT_MS = 20000;
const MANUAL_OPEN_TIMEOUT_MS = 20 * 60_000;

const SIGNAL_URL =
  import.meta.env.VITE_SIGNAL_URL ??
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

/** "blocked": signaling knows them but no direct link came up (NAT/firewall, needs TURN). */
export type PeerInfo = {
  peerId: string;
  name: string;
  state: "connecting" | "open" | "blocked";
  /** direct = straight between browsers; relay = bounced through a TURN server. */
  route?: "direct" | "relay";
  /** Why it is not open yet (ICE state, retries), for a tooltip. */
  detail?: string;
};

type Handlers = {
  onJoined: (hostId: string, existing: number, max?: number, locked?: boolean) => void;
  onPeers: (peers: PeerInfo[]) => void;
  onPeerOpen: (peerId: string) => void;
  /** The link to a peer dropped (they may still be in the room and get redialed). */
  onPeerGone: (peerId: string) => void;
  /** The signaling server says the peer really left the room. */
  onPeerLeft: (peerId: string) => void;
  onSignalLost: () => void;
  /** Another tab/window took over this identity. Do not reconnect: the two would fight forever. */
  onReplaced: () => void;
  /** The server turned us away: another identity holder ("taken"), a locked room, or a busy server. */
  onRefused: (reason: string) => void;
  /** The host locked or unlocked the room to newcomers. */
  onLockState: (locked: boolean) => void;
  /** The room is at capacity: nothing to retry automatically. */
  onFull: (max: number) => void;
  onControl: (from: string, msg: any) => void;
  onFile: (from: string, data: string | ArrayBuffer) => void;
  onStream: (peerId: string, stream: MediaStream) => void;
};

type Peer = {
  name: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  since: number;
  /** When the network attempt (ICE checks) began. Without a server the codes take a person minutes to carry, so age since creation says nothing. */
  checkingSince?: number;
  /** Our connection generation, sent with every signal so the far side can tell a fresh connection from an old one. */
  gen: number;
  /** The far side's generation; a higher one means they started over. */
  remoteGen?: number;
  restarts: number;
  lastRestart: number;
  route?: "direct" | "relay";
  /** track id -> sender, so adding a screen share never disturbs the camera. */
  senders: Map<string, RTCRtpSender>;
  ctl?: RTCDataChannel;
  file?: RTCDataChannel;
};

/** The part of WebSocket that Mesh uses, so a stand-in (see localSignal.ts) can take the server's place. */
type Sock = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e?: unknown) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e?: unknown) => void) | null;
};

export class Mesh {
  private ws!: Sock;
  /** "Connect by code": no signaling server. The stand-in answers for it and carries messages over existing links. */
  private readonly hub?: LocalSignaling;
  private readonly peers = new Map<string, Peer>();
  private readonly names = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly roomPeers = new Set<string>();
  /** Without a server: people whose latest connection attempt failed. They stay listed (with a way to try again) rather than looking "still connecting". */
  private readonly manualFailed = new Set<string>();
  /** Not in the room list after a restart-style rejoin: given time to reappear before we call them gone. */
  private readonly pendingGone = new Set<string>();
  /**
   * People in the room we are not connected to (yet): since when, and how many tries so far. This is
   * what keeps their row on screen between attempts instead of vanishing and reappearing.
   */
  private readonly waiting = new Map<string, { since: number; attempts: number }>();
  private lastEmit = "";
  private closed = false;
  /** Set when reconnecting would be wrong: another tab took over, or the room is full. */
  private halted = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly peerId: string;
  private readonly spaceId: string;
  private readonly name: string;
  private readonly secret: string;
  private readonly h: Handlers;
  private local: MediaStream[] = [];
  private ice: RTCConfiguration = rtcConfig(DEFAULT_ICE);
  /** Identifies this page load to the server, so a reconnect is recognised as us and not as a stranger. */
  private readonly session = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  private retry = 0;
  private reconnecting: ReturnType<typeof setTimeout> | null = null;
  private lastHeard = Date.now();
  private lastGen = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  // Signaling is handled strictly one message at a time, in order: an ICE candidate must not be
  // applied while the offer/answer before it is still being set, or it is silently lost. The queue
  // starts out waiting for the ICE server list so no peer is created with the wrong servers.
  private queue: Promise<unknown>;

  constructor(spaceId: string, peerId: string, name: string, secret: string, h: Handlers, hub?: LocalSignaling) {
    this.hub = hub;
    this.secret = secret;
    this.spaceId = spaceId;
    this.peerId = peerId;
    this.name = name;
    this.h = h;
    // Without a server there is nothing to ask for TURN credentials: public STUN only.
    this.queue = (hub ? Promise.resolve(DEFAULT_ICE) : loadIceServers()).then((iceServers) => {
      this.ice = rtcConfig(iceServers);
    });
    hub?.bind(this);
    this.connect();
    // Dead sockets can look open for a long time (sleep, a silently dropped tunnel), so ask and check.
    this.heartbeat = setInterval(() => this.checkSocket(), 12000);
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }

  private connect() {
    if (this.closed || this.halted) return;
    const ws: Sock = this.hub ? this.hub.socket() : (new WebSocket(SIGNAL_URL) as unknown as Sock);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.lastHeard = Date.now();
      ws.send(JSON.stringify({ type: "join", spaceId: this.spaceId, peerId: this.peerId, name: this.name, session: this.session, key: this.secret }));
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") return;
      this.queue = this.queue.then(() => this.onSignal(msg)).catch((err) => console.error("signal error", err));
    };
    ws.onclose = () => this.socketDown(ws);
  }

  /** The socket to the server is gone. Existing peer links carry on; we just need to get back in. */
  private socketDown(ws: Sock) {
    if (this.ws !== ws || this.closed || this.halted) return;
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
    this.h.onSignalLost();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed || this.halted || this.reconnecting) return;
    const delay = Math.min(10000, 500 * 2 ** this.retry++);
    this.reconnecting = this.later(() => {
      this.reconnecting = null;
      this.connect();
    }, delay);
  }

  private checkSocket() {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastHeard > 35000) this.socketDown(ws);
    else ws.send('{"type":"ping"}');
  }

  /** The network came back or the tab woke up: don't sit out the backoff timer. */
  private readonly wake = () => {
    if (this.closed || this.halted || (document.visibilityState === "hidden")) return;
    const ws = this.ws;
    if (ws.readyState === WebSocket.OPEN) return void this.checkSocket();
    if (ws.readyState === WebSocket.CONNECTING) return;
    if (this.reconnecting) {
      clearTimeout(this.reconnecting);
      this.timers.delete(this.reconnecting);
      this.reconnecting = null;
    }
    this.retry = 0;
    this.connect();
  };

  /** Lock or unlock the room to newcomers (members already inside are unaffected). */
  setLock(locked: boolean) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "lock", locked }));
  }

  isOpen(peerId: string) {
    return this.peers.get(peerId)?.ctl?.readyState === "open";
  }

  openIds() {
    return [...this.peers.keys()].filter((id) => this.isOpen(id));
  }

  /** Someone in the room we have just heard of, from a peer rather than a server. `dialNow`: we are the newcomer, so we start the connection. */
  meet(id: string, name: string, dialNow: boolean) {
    if (id === this.peerId || this.blocked.has(id) || this.closed) return;
    this.roomPeers.add(id);
    this.pendingGone.delete(id);
    this.names.set(id, name);
    if (this.peers.has(id)) return;
    this.markWaiting(id);
    if (dialNow) this.dial(id, name);
  }

  sendTo(peerId: string, msg: unknown) {
    const ch = this.peers.get(peerId)?.ctl;
    if (ch?.readyState !== "open") return false;
    ch.send(JSON.stringify(msg));
    return true;
  }

  broadcast(msg: unknown) {
    for (const id of this.peers.keys()) this.sendTo(id, msg);
  }

  /** Send on the file channel, waiting when the buffer is full. */
  async sendFile(peerId: string, data: string | ArrayBuffer) {
    const ch = this.peers.get(peerId)?.file;
    if (ch?.readyState !== "open") throw new Error("file channel closed");
    if (ch.bufferedAmount > 1_000_000) {
      ch.bufferedAmountLowThreshold = 256_000;
      await new Promise<void>((resolve) => {
        ch.onbufferedamountlow = () => {
          ch.onbufferedamountlow = null;
          resolve();
        };
      });
    }
    ch.send(data as string); // string | ArrayBuffer are both valid; TS can't pick an overload for the union
  }

  /** The set of streams (camera, screen) we publish. Only the difference is renegotiated. */
  setLocalStreams(streams: MediaStream[]) {
    this.local = streams;
    for (const p of this.peers.values()) this.syncTracks(p);
  }

  /** Cut a peer off and refuse future connections from them (kick). */
  block(peerId: string) {
    this.blocked.add(peerId);
    this.drop(peerId);
  }

  /** Idempotent. Stops timers, leaves the room and tears down every peer connection. */
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.ws.onopen = this.ws.onmessage = this.ws.onclose = null;
    // Say goodbye properly so the others hear "left" now, not after the grace period.
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send('{"type":"leave"}');
    this.ws.close();
    for (const p of this.peers.values()) this.teardown(p);
    this.peers.clear();
    this.local = [];
  }

  /** Timers are tracked so close() can cancel them (no redial after leaving). */
  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private teardown(peer: Peer) {
    peer.pc.onnegotiationneeded = null;
    peer.pc.onsignalingstatechange = null;
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.ontrack = null;
    peer.pc.ondatachannel = null;
    peer.ctl?.close();
    peer.file?.close();
    peer.pc.close();
  }

  private emit() {
    const list: PeerInfo[] = [...this.peers.entries()].map(([peerId, p]) => ({
      peerId,
      name: p.name,
      state: this.linkState(p),
      route: p.route,
      detail: this.detail(peerId, p),
    }));
    // In the room but no connection object right now (between retries): still show them.
    for (const [peerId, w] of this.waiting) {
      if (this.peers.has(peerId) || !this.roomPeers.has(peerId)) continue;
      list.push({
        peerId,
        name: this.names.get(peerId) ?? peerId,
        state: this.hub ? (this.manualFailed.has(peerId) ? "blocked" : "connecting") : Date.now() - w.since > BLOCKED_AFTER_MS ? "blocked" : "connecting",
        detail: `waiting to retry (attempt ${w.attempts + 1})`,
      });
    }
    // Several network events can leave the summary unchanged; don't make the whole UI re-render for that.
    const key = JSON.stringify(list);
    if (key === this.lastEmit) return;
    this.lastEmit = key;
    this.h.onPeers(list);
  }

  private detail(id: string, p: Peer) {
    if (p.ctl?.readyState === "open") return undefined;
    return `network: ${p.pc.iceConnectionState}, attempt ${(this.waiting.get(id)?.attempts ?? 0) + 1}`;
  }

  /** Start (or keep) the clock on someone we are trying to reach. */
  private markWaiting(id: string) {
    if (!this.waiting.has(id)) this.waiting.set(id, { since: Date.now(), attempts: 0 });
    this.later(() => this.emit(), BLOCKED_AFTER_MS + 500); // so "connecting" can turn into "can't connect"
    this.emit();
  }

  /** Try again right now, instead of waiting for the next scheduled attempt. */
  retryNow(id: string) {
    if (!this.roomPeers.has(id) || this.blocked.has(id)) return;
    const w = this.waiting.get(id);
    if (w) w.attempts = 0;
    this.dial(id, this.names.get(id) ?? id);
  }

  private peerIdOf(p: Peer): string {
    for (const [id, q] of this.peers) if (q === p) return id;
    return "";
  }

  private linkState(p: Peer): PeerInfo["state"] {
    if (p.ctl?.readyState === "open") return "open";
    const failed = p.pc.iceConnectionState === "failed";
    // With codes, "blocked" means the network attempt itself failed or has been trying for a long time, not that a person is slow.
    // And only once the other side's half has been applied and we are not holding a code that still has to be carried: until then
    // the network may already be probing (the other side starts as soon as it has our code) while a person is still walking the reply over.
    if (this.hub) {
      if (!p.pc.remoteDescription || this.hub.holdsCode(this.peerIdOf(p))) return "connecting";
      return failed || (p.checkingSince !== undefined && Date.now() - p.checkingSince > BLOCKED_AFTER_MS) ? "blocked" : "connecting";
    }
    return failed || Date.now() - p.since > BLOCKED_AFTER_MS ? "blocked" : "connecting";
  }

  /** Bound upload per peer: in a mesh the cost multiplies by the number of peers. */
  private capBitrate(peer: Peer) {
    for (const sender of peer.senders.values()) {
      const track = sender.track;
      if (!track) continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      const screen = track.kind === "video" && track.contentHint === "detail";
      params.encodings[0].maxBitrate = track.kind === "audio" ? 32_000 : screen ? 1_000_000 : 450_000;
      sender.setParameters(params).catch(() => undefined);
    }
  }

  /** Read the selected ICE candidate pair to learn whether traffic is direct or relayed. */
  private async detectRoute(peer: Peer) {
    try {
      const stats = await peer.pc.getStats();
      const byId = new Map<string, any>();
      stats.forEach((r) => byId.set(r.id, r));
      const transport = [...byId.values()].find((r) => r.type === "transport" && r.selectedCandidatePairId);
      const pair = transport
        ? byId.get(transport.selectedCandidatePairId)
        : [...byId.values()].find((r) => r.type === "candidate-pair" && r.nominated && r.state === "succeeded");
      if (!pair) return;
      const types = [byId.get(pair.localCandidateId), byId.get(pair.remoteCandidateId)].map((c) => c?.candidateType);
      peer.route = types.includes("relay") ? "relay" : "direct";
    } catch {
      // stats unavailable: leave route unknown
    }
  }

  private signal(to: string, payload: unknown, gen: number) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "signal", to, payload, gen }));
    }
  }

  private syncTracks(peer: Peer) {
    // Video waits until the direct link is really up (data channel open). Until then the connection
    // stays small and quick to set up, and nothing half-working can show up as a flickering tile.
    if (peer.ctl?.readyState !== "open") return;
    const wanted = new Map<string, { track: MediaStreamTrack; stream: MediaStream }>();
    for (const stream of this.local) for (const track of stream.getTracks()) wanted.set(track.id, { track, stream });
    for (const [id, sender] of peer.senders) {
      if (wanted.has(id)) continue;
      peer.pc.removeTrack(sender);
      peer.senders.delete(id);
    }
    for (const [id, { track, stream }] of wanted) {
      if (!peer.senders.has(id)) peer.senders.set(id, peer.pc.addTrack(track, stream));
    }
  }

  private createPeer(remoteId: string, name: string): Peer {
    const pc = new RTCPeerConnection(this.ice);
    this.lastGen = Math.max(Date.now(), this.lastGen + 1);
    const peer: Peer = {
      name,
      pc,
      polite: this.peerId < remoteId,
      makingOffer: false,
      ignoreOffer: false,
      since: this.waiting.get(remoteId)?.since ?? Date.now(),
      gen: this.lastGen,
      restarts: 0,
      lastRestart: 0,
      senders: new Map(),
    };
    this.peers.set(remoteId, peer);
    this.markWaiting(remoteId);
    // Re-evaluate once the grace period passes so "connecting" can turn into "blocked".
    this.later(() => this.peers.get(remoteId) === peer && this.emit(), BLOCKED_AFTER_MS + 500);
    // Network up but the data channel never opens (or nothing ever happens): don't sit there forever.
    this.later(() => {
      if (this.peers.get(remoteId) === peer && peer.ctl?.readyState !== "open") this.linkLost(remoteId);
    }, this.hub ? MANUAL_OPEN_TIMEOUT_MS : OPEN_TIMEOUT_MS); // a person has to carry the code: give them time
    pc.oniceconnectionstatechange = () => {
      if (this.peers.get(remoteId) !== peer) return;
      this.emit();
      const st = pc.iceConnectionState;
      if (st === "checking" && (!this.hub || pc.remoteDescription)) {
        peer.checkingSince = Date.now();
        this.later(() => this.peers.get(remoteId) === peer && this.emit(), BLOCKED_AFTER_MS + 500);
      }
      if (st === "connected" || st === "completed") {
        peer.restarts = 0;
        peer.checkingSince = undefined;
      }
      // A wobble (wifi switch, brief loss) often heals by itself; give it a moment, then renegotiate
      // the network path on the SAME connection instead of tearing everything down.
      if (st === "disconnected") {
        this.later(() => {
          if (this.peers.get(remoteId) === peer && pc.iceConnectionState === "disconnected") this.tryRestart(remoteId, peer);
        }, 3000);
      }
      if (st === "failed") this.tryRestart(remoteId, peer);
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(remoteId, { description: pc.localDescription }, peer.gen);
      } catch (err) {
        console.error("negotiation failed", err);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onsignalingstatechange = () => pc.signalingState === "stable" && this.capBitrate(peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(remoteId, { candidate: e.candidate }, peer.gen);
      else this.hub?.gatheringDone(remoteId, peer.gen); // every address has been tried: a code can now be sealed with all of them in it
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(remoteId) !== peer) return;
      if (pc.connectionState === "closed") this.linkLost(remoteId);
      else if (pc.connectionState === "failed") this.tryRestart(remoteId, peer);
    };
    pc.ondatachannel = (e) => this.attach(remoteId, peer, e.channel);
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      stream.onremovetrack = () => this.h.onStream(remoteId, stream);
      e.track.onmute = () => this.h.onStream(remoteId, stream);
      e.track.onunmute = () => this.h.onStream(remoteId, stream);
      this.h.onStream(remoteId, stream);
    };

    if (this.local.length) this.syncTracks(peer);
    return peer;
  }

  private attach(remoteId: string, peer: Peer, ch: RTCDataChannel) {
    const alive = () => this.peers.get(remoteId) === peer;

    if (ch.label === "file") {
      peer.file = ch;
      ch.binaryType = "arraybuffer";
      ch.onmessage = (e) => this.h.onFile(remoteId, e.data);
      return;
    }

    peer.ctl = ch;
    const opened = () => {
      if (!alive()) return;
      this.waiting.delete(remoteId);
      this.manualFailed.delete(remoteId);
      if (this.local.length) this.syncTracks(peer); // the call, now that there is a real link to carry it
      void this.detectRoute(peer).then(() => alive() && this.emit());
      this.emit();
      this.hub?.peerOpened(remoteId);
      this.h.onPeerOpen(remoteId);
    };
    ch.onopen = opened;
    ch.onclose = () => alive() && this.linkLost(remoteId);
    ch.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (this.hub?.handleControl(remoteId, msg)) return;
        this.h.onControl(remoteId, msg);
      } catch {
        // ignore malformed frames
      }
    };
    if (ch.readyState === "open") opened();
    else this.emit();
  }

  private drop(remoteId: string) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    this.peers.delete(remoteId);
    this.teardown(peer);
    this.emit();
    this.hub?.peerLost(remoteId);
    this.h.onPeerGone(remoteId);
  }

  /**
   * A link died but the peer may still be in the room (sleep, network blip): redial instead of
   * pretending they left. The higher id redials first; the other waits, then tries anyway.
   */
  private linkLost(remoteId: string) {
    if (this.hub) this.manualFailed.add(remoteId);
    this.drop(remoteId);
    this.scheduleRedial(remoteId);
  }

  private scheduleRedial(remoteId: string) {
    if (!this.roomPeers.has(remoteId) || this.blocked.has(remoteId)) return;
    this.markWaiting(remoteId);
    // Without a server a redial needs a link to carry it, or a person: do not make a new code every few seconds.
    // The person can press "try again" when they are ready.
    if (this.hub && !this.hub.canReach(remoteId)) return;
    const w = this.waiting.get(remoteId)!;
    const backoff = Math.min(2 ** w.attempts++, 4); // 1x, 2x, then 4x: gentle on a link that keeps failing
    this.later(
      () => {
        if (this.closed || !this.roomPeers.has(remoteId) || this.peers.has(remoteId)) return;
        this.dial(remoteId, this.names.get(remoteId) ?? remoteId);
      },
      (this.peerId > remoteId ? 1000 : 8000) * backoff,
    );
  }

  /**
   * The path died. Try a cheap ICE restart on the same connection first (keeps data channels and
   * calls alive when it works); if it doesn't come back within a few seconds, rebuild the link.
   */
  private tryRestart(remoteId: string, peer: Peer) {
    if (Date.now() - peer.lastRestart < 5000) return; // several events for one failure
    // A restart would change our network credentials and make the code someone is carrying useless: wait for it to be delivered.
    if (this.hub?.holdsCode(remoteId)) return;
    if (peer.restarts >= 2) return void this.linkLost(remoteId);
    peer.restarts++;
    peer.lastRestart = Date.now();
    try {
      peer.pc.restartIce();
    } catch {
      return void this.linkLost(remoteId);
    }
    this.later(() => {
      const st = peer.pc.iceConnectionState;
      if (this.peers.get(remoteId) === peer && st !== "connected" && st !== "completed") this.linkLost(remoteId);
    }, 7000);
  }

  private dial(remoteId: string, name: string) {
    this.manualFailed.delete(remoteId);
    this.drop(remoteId); // never leave an old connection behind a new one
    const peer = this.createPeer(remoteId, name);
    // Creating the channels triggers negotiationneeded, which sends the offer.
    this.attach(remoteId, peer, peer.pc.createDataChannel("ctl"));
    this.attach(remoteId, peer, peer.pc.createDataChannel("file"));
  }

  private async onSignal(msg: any) {
    switch (msg.type) {
      case "joined":
        this.onJoined(msg);
        break;
      case "refused":
        this.halted = true; // retrying would just be refused again
        this.h.onRefused(String(msg.reason));
        break;
      case "lock-state":
        this.h.onLockState(!!msg.locked);
        break;
      case "full":
        this.halted = true;
        this.h.onFull(msg.max);
        break;
      case "replaced":
        // Another tab now owns this identity. Stay down: reconnecting would just kick it back out.
        this.halted = true;
        this.h.onReplaced();
        break;
      case "peer-joined":
        // Same id showing up again (refresh): the old connection is stale.
        this.drop(msg.peerId);
        // They dial us; remember the name until their offer arrives.
        this.roomPeers.add(msg.peerId);
        this.pendingGone.delete(msg.peerId);
        this.names.set(msg.peerId, msg.name);
        this.markWaiting(msg.peerId); // visible straight away, not only once their offer arrives
        // They are supposed to dial us. If nothing has arrived after a while, reach out ourselves: a
        // newcomer whose browser can't start connections can still answer one.
        if (this.hub) break; // codes: a second offer from our side would be a second code to carry, and the first would go stale
        this.later(() => {
          const id: string = msg.peerId;
          if (!this.closed && this.roomPeers.has(id) && !this.peers.has(id) && !this.blocked.has(id)) {
            this.dial(id, this.names.get(id) ?? id);
          }
        }, 10000);
        break;
      case "peer-left":
        this.markLeft(msg.peerId);
        break;
      case "signal":
        await this.onDescriptionOrCandidate(msg.from, msg.payload, msg.gen);
        break;
    }
  }

  private onJoined(msg: any) {
    this.h.onJoined(msg.hostId, msg.peers.length, msg.max, msg.locked);
    const listed = new Set<string>(msg.peers.map((p: any) => p.peerId));
    for (const p of msg.peers) {
      this.roomPeers.add(p.peerId);
      this.names.set(p.peerId, p.name);
      if (!this.peers.has(p.peerId)) this.markWaiting(p.peerId);
    }
    const missing = [...this.roomPeers].filter((id) => !listed.has(id));
    if (msg.resumed) {
      // The server kept our place, so its list is complete: anyone missing really left while we were offline.
      for (const id of missing) this.markLeft(id);
    } else if (missing.length) {
      // The server does not remember us (it restarted, or this is a fresh join), so its list may be
      // incomplete because others are still reconnecting. Wait for them before declaring anyone gone.
      for (const id of missing) this.pendingGone.add(id);
      this.later(() => this.sweepGone(), 20000);
    }
    for (const id of listed) this.pendingGone.delete(id);
    if (msg.resumed) {
      // We slipped back in unnoticed, so nobody dropped their link to us. Keep the healthy ones and
      // only rebuild what is missing.
      for (const p of msg.peers) if (!this.peers.has(p.peerId)) this.scheduleRedial(p.peerId);
    } else {
      // A fresh join (or the server forgot us): everyone drops any old link to us and waits for our offer.
      for (const p of msg.peers) this.dial(p.peerId, p.name);
    }
  }

  private markLeft(id: string) {
    this.waiting.delete(id);
    this.pendingGone.delete(id);
    this.roomPeers.delete(id);
    this.drop(id);
    this.h.onPeerLeft(id);
  }

  /** Anyone still unaccounted for (not re-listed, no live link) after the wait has left. */
  private sweepGone() {
    for (const id of [...this.pendingGone]) {
      this.pendingGone.delete(id);
      if (this.peers.get(id)?.ctl?.readyState === "open") continue; // still talking to us directly
      this.markLeft(id);
    }
  }

  private async onDescriptionOrCandidate(from: string, payload: any, gen?: number) {
    if (this.blocked.has(from)) return;
    let peer = this.peers.get(from);

    // Every signal names the connection it belongs to. A newer one means they started over (refresh,
    // redial): drop ours rather than mixing two connections. An older one is a straggler: ignore it.
    if (peer && typeof gen === "number") {
      if (peer.remoteGen === undefined) peer.remoteGen = gen;
      else if (gen < peer.remoteGen) return;
      else if (gen > peer.remoteGen) {
        this.drop(from);
        peer = undefined;
      }
    }

    if (payload.description) {
      // They are redialing over a connection we still hold but that is dead: start fresh.
      const dead = peer && ["closed", "failed"].includes(peer.pc.connectionState);
      if (dead && payload.description.type === "offer") {
        this.drop(from);
        peer = undefined;
      }
      peer ??= this.createPeer(from, this.names.get(from) ?? from);
      if (typeof gen === "number") peer.remoteGen ??= gen;
      const { pc } = peer;
      const d: RTCSessionDescriptionInit = payload.description;
      const collision = d.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(d);
      // Without a server the other side may have been probing us for a long time already: our own attempt starts now.
      if (this.hub) peer.checkingSince = Date.now();
      if (d.type === "offer") {
        await pc.setLocalDescription();
        this.signal(from, { description: pc.localDescription }, peer.gen);
      }
    } else if (payload.candidate && peer) {
      try {
        await peer.pc.addIceCandidate(payload.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  }
}
