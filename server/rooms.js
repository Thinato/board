// Live rooms: loaded on first join, broadcast to every socket in the room, saved in the background,
// unloaded when the last socket leaves.
// ponytail: all rooms live in one process (Cloud Run max 1 instance), fine for meetings of a few hundred;
// beyond that, route sockets by room or fan out through Redis pub/sub.
const crypto = require('crypto');
const E = require('./embed.js');
const { apply, emptyState, pairKey } = require('./ops.js');

const BROADCAST_MS = 150;  // coalesce bursts (a vote storm) into one state message
const SAVE_MS = 5000;      // at most one write per room every 5 s

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Vectors by question text, shared by all rooms. ponytail: evicts oldest past 5000 (~15 MB).
// Embedding waits for the model to finish loading, so word-match and model vectors never mix.
const vecCache = new Map();
let modelReady = Promise.resolve();
async function vectors(texts) {
  await modelReady;
  const embedMany = E.backend.embedMany;
  const missing = [...new Set(texts.filter(t => !vecCache.has(t)))];
  if (missing.length) {
    const vs = await embedMany(missing);
    vs.forEach((v, i) => vecCache.set(missing[i], v));
    for (const k of vecCache.keys()) { if (vecCache.size <= 5000) break; vecCache.delete(k); }
  }
  return texts.map(t => vecCache.get(t));
}

class Room {
  constructor(store, doc) {
    Object.assign(this, { store, doc, sockets: new Set(), dirty: false, saving: null, broadcastTimer: null, saveTimer: null });
  }

  get state() { return this.doc.state; }

  isModKey(key) {
    if (typeof key !== 'string' || !key) return false;
    const a = Buffer.from(sha256(key), 'hex'), b = Buffer.from(this.doc.keyHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Per-room hash of a voter's private id: stored and broadcast instead of the id itself.
  voterHash(voter) { return sha256(`${this.doc.id}:${voter}`).slice(0, 16); }

  apply(op, args, ctx) {
    const res = apply(this.state, op, args, ctx);
    if (res.ok) this.changed();
    return res;
  }

  changed() {
    this.dirty = true;
    this.broadcastTimer ??= setTimeout(() => { this.broadcastTimer = null; this.broadcast(); }, BROADCAST_MS);
    this.saveTimer ??= setTimeout(() => { this.saveTimer = null; this.save(); }, SAVE_MS);
  }

  stateMessage() { return JSON.stringify({ t: 'state', state: this.state }); }

  broadcast() {
    const msg = this.stateMessage();
    for (const ws of this.sockets) if (ws.readyState === 1) ws.send(msg);
  }

  // Returns once everything changed so far is written. One write at a time, in order.
  async save() {
    while (this.saving) await this.saving;
    if (!this.dirty) return;
    this.dirty = false;
    this.doc.updatedAt = Date.now();
    this.saving = this.store.write(this.doc.id, this.doc)
      .catch(err => {
        this.dirty = true; // try again with the next change or flush
        console.error(`save ${this.doc.id} failed:`, err.message);
      })
      .finally(() => { this.saving = null; });
    await this.saving;
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.save();
  }

  // Suggested groups over unanswered questions, with each pair's similarity so the client can show
  // (and recompute, after removing a card) how well each card fits: [{ ids, sim: [[...]] }]
  async suggest() {
    const pool = Object.values(this.state.questions).filter(q => !q.answered);
    const vecs = await vectors(pool.map(q => q.text));
    const apart = new Set(this.state.apart);
    const byId = new Map(pool.map((q, i) => [q.id, vecs[i]]));
    return {
      threshold: E.backend.threshold,
      groups: E.cluster(pool, vecs, E.backend.threshold, (a, b) => apart.has(pairKey(a, b)))
        .map(ids => ({ ids, sim: ids.map(a => ids.map(b => +E.similarity(byId.get(a), byId.get(b)).toFixed(3))) })),
    };
  }

  // Most similar open question to a draft, if it clears the hint threshold.
  async similar(text) {
    const open = Object.values(this.state.questions).filter(q => !q.answered);
    if (text.length < 8 || !open.length) return null;
    const [v, ...vs] = await vectors([text, ...open.map(q => q.text)]);
    let best = null, score = 0;
    open.forEach((q, i) => { const s = E.similarity(v, vs[i]); if (s > score) [best, score] = [q, s]; });
    return score >= E.backend.hintThreshold ? { id: best.id, score: +score.toFixed(3) } : null;
  }
}

class Rooms {
  constructor(store) {
    this.store = store;
    this.live = new Map(); // id -> Promise<Room | null>
  }

  async create(title) {
    const id = crypto.randomBytes(8).toString('base64url');
    const key = crypto.randomBytes(16).toString('base64url');
    const doc = { v: 1, id, title, keyHash: sha256(key), createdAt: Date.now(), updatedAt: Date.now(), state: emptyState() };
    await this.store.write(id, doc);
    return { roomId: id, modKey: key };
  }

  // Concurrent joins share one load.
  get(id) {
    if (!this.live.has(id)) {
      const p = this.store.read(id).then(doc => (doc ? new Room(this.store, doc) : null));
      this.live.set(id, p);
      p.then(room => { if (!room) this.live.delete(id); }, () => this.live.delete(id));
    }
    return this.live.get(id);
  }

  join(room, ws) {
    room.sockets.add(ws);
  }

  async leave(room, ws) {
    room.sockets.delete(ws);
    if (room.sockets.size) return;
    await room.flush();
    // Someone may have joined while we were saving.
    if (!room.sockets.size && (await this.live.get(room.doc.id)) === room) this.live.delete(room.doc.id);
  }

  async flushAll() {
    const rooms = await Promise.all(this.live.values());
    await Promise.all(rooms.filter(Boolean).map(r => r.flush()));
  }
}

module.exports = { Rooms, sha256, whenModelReady: p => { modelReady = p; } };
