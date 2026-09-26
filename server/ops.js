// Room state rules. The server is the only writer: clients send an op, `apply` checks role and input,
// then mutates the room state in place. Pure (no I/O), so tests can drive it directly.
//
// state: { questions: { id: {id, text, voters, imported?, answered, groupId, x, y, createdAt} },
//          groups: { id: {id, title, x, y} }, apart: ['a|b', ...] }
// voters holds per-room voter hashes, never raw voter ids (see server.js); imported is a vote count
// carried over from a Slido import or the demo (a number, so a big import can't bloat the state).
const crypto = require('crypto');
const { DEMO } = require('./embed.js');

// MAX_QUESTIONS also bounds clustering, which is O(n³) on the event loop: 300 takes ~0.2 s.
const MAX_TEXT = 200, MAX_TITLE = 80, MAX_QUESTIONS = 300, MAX_VOTES = 1000, MAX_APART = 20000;
const ID = /^(?!__proto__$)[\w-]{1,40}$/; // assigning a '__proto__' key would swap the object's prototype

class OpError extends Error {}
const fail = msg => { throw new OpError(msg); };

const uid = () => crypto.randomBytes(6).toString('base64url');
const emptyState = () => ({ questions: {}, groups: {}, apart: [] });
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function text(v, max) {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) fail('text required');
  if (t.length > max) fail(`text over ${max} characters`);
  return t;
}
// Own properties only: s.questions['__proto__'] would otherwise be Object.prototype, and ops would write to it.
const own = (o, k) => (typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
const coord = v => (Number.isFinite(v) ? Math.min(1e5, Math.max(-1e5, v)) : fail('bad position'));
const pos = p => ({ x: coord(p?.x), y: coord(p?.y) });
const question = (s, id) => own(s.questions, id) || fail('no such question');
const group = (s, id) => own(s.groups, id) || fail('no such group');
const ids = (s, list) => (Array.isArray(list) && list.length <= MAX_QUESTIONS ? list : fail('bad ids')).map(id => question(s, id));

function membersOf(s, gid) {
  return Object.values(s.questions).filter(q => q.groupId === gid);
}

// First slot of a 4-column grid where a w×h box overlaps nothing. Mirrors the client's freeSlot,
// with estimated sizes instead of DOM measurements: cards 240×140, groups 272 wide and ~120 per member.
function freeSlot(s, w = 240, h = 140) {
  const rects = [
    ...Object.values(s.questions).filter(q => !q.groupId).map(q => ({ x: q.x, y: q.y, w: 240, h: 140 })),
    ...Object.values(s.groups).map(g => ({ x: g.x, y: g.y, w: 272, h: 60 + membersOf(s, g.id).length * 120 })),
  ];
  for (let i = 0; ; i++) {
    const x = (i % 4) * 260, y = Math.floor(i / 4) * 150;
    if (!rects.some(r => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h)) return { x, y };
  }
}

function addQuestion(s, fields) {
  if (Object.keys(s.questions).length >= MAX_QUESTIONS) fail('room is full');
  const q = { id: uid(), voters: [], answered: false, groupId: null, createdAt: Date.now(), ...freeSlot(s), ...fields };
  s.questions[q.id] = q;
  return q;
}

// A group with fewer than 2 members stops being a group.
function dissolveIfSmall(s, gid) {
  const g = s.groups[gid];
  const left = membersOf(s, gid);
  if (!g || left.length >= 2) return;
  left.forEach(q => Object.assign(q, { groupId: null, x: g.x, y: g.y }));
  delete s.groups[gid];
}

// Each op: { mod: moderator-only?, run(state, args, ctx) -> optional reply }. ctx: { me: voter hash }.
const OPS = {
  ask: { run: (s, a) => { addQuestion(s, { text: text(a.text, MAX_TEXT) }); } },

  // on: true only adds a vote ("upvote it instead"); otherwise it toggles.
  vote: {
    run(s, a, ctx) {
      const q = question(s, a.id);
      const i = q.voters.indexOf(ctx.me);
      if (i < 0) q.voters.length < MAX_VOTES && q.voters.push(ctx.me);
      else if (a.on !== true) q.voters.splice(i, 1);
    },
  },

  answer: { mod: true, run: (s, a) => ids(s, a.ids).forEach(q => (q.answered = a.answered === true)) },

  // target: { gid } (a group or a card inside one), { id } (a free card), or null (empty canvas).
  drop: {
    mod: true,
    run(s, a) {
      const q = question(s, a.id), p = pos(a.pos), t = a.target;
      const oldGid = q.groupId;
      let gid = null;
      if (own(s.groups, t?.gid)) gid = t.gid;
      else if (t?.id !== q.id && own(s.questions, t?.id)) {
        const target = s.questions[t.id];
        gid = target.groupId || uid();
        if (!s.groups[gid]) s.groups[gid] = { id: gid, title: null, x: target.x, y: target.y };
        target.groupId = gid;
      }
      q.groupId = gid;
      if (!gid) Object.assign(q, p);
      if (oldGid && oldGid !== gid) dissolveIfSmall(s, oldGid);
    },
  },

  moveGroup: { mod: true, run: (s, a) => Object.assign(group(s, a.id), pos(a.pos)) },

  rename: {
    mod: true,
    run(s, a) {
      const g = group(s, a.gid);
      g.title = typeof a.title === 'string' && a.title.trim() ? text(a.title, MAX_TITLE) : null;
    },
  },

  // Accept a suggestion: join an existing group among them, or start one at `slot`.
  group: {
    mod: true,
    run(s, a) {
      const qs = ids(s, a.ids);
      if (qs.length < 2) fail('need 2 or more questions');
      let gid = qs.find(q => q.groupId)?.groupId;
      if (!gid) {
        gid = uid();
        s.groups[gid] = { id: gid, title: null, ...pos(a.slot) };
      }
      qs.forEach(q => { if (!q.groupId) q.groupId = gid; });
    },
  },

  // Sort: new positions for groups and loose cards, keyed by id.
  layout: {
    mod: true,
    run(s, a) {
      const entries = Object.entries(a.pos && typeof a.pos === 'object' ? a.pos : fail('bad layout'));
      for (const [key, p] of entries) {
        const item = own(s.groups, key) || own(s.questions, key);
        if (item) Object.assign(item, pos(p));
      }
    },
  },

  // Bulk add (Slido import). items: [{ id?, text, votes?, answered?, createdAt? }]; known ids are skipped,
  // so importing the same file twice adds nothing. Votes are kept as a count (`imported`).
  add: {
    mod: true,
    run(s, a) {
      const items = Array.isArray(a.items) && a.items.length <= MAX_QUESTIONS ? a.items : fail(`send up to ${MAX_QUESTIONS} items`);
      let added = 0;
      for (const it of items) {
        const id = it?.id == null ? uid() : ID.test(it.id) ? it.id : fail('bad id');
        if (Object.hasOwn(s.questions, id)) continue;
        const votes = Math.min(MAX_VOTES, Math.max(0, Math.floor(Number(it.votes) || 0)));
        addQuestion(s, {
          id, text: text(it.text, MAX_TEXT), answered: it.answered === true, imported: votes,
          createdAt: Number.isFinite(it.createdAt) ? it.createdAt : Date.now(),
        });
        added++;
      }
      return { added, total: items.length };
    },
  },

  demo: {
    mod: true,
    run(s) {
      [...DEMO].sort(() => Math.random() - 0.5).forEach(t =>
        addQuestion(s, { text: t, imported: Math.floor(Math.random() * 9) }));
    },
  },

  clear: { mod: true, run: s => Object.assign(s, emptyState()) },

  // Pairs a moderator said don't belong together (Dismiss or × on a suggestion).
  apart: {
    mod: true,
    run(s, a) {
      const set = new Set(s.apart);
      for (const [x, y] of Array.isArray(a.pairs) ? a.pairs : fail('bad pairs')) {
        if (x !== y && own(s.questions, x) && own(s.questions, y) && set.size < MAX_APART) set.add(pairKey(x, y));
      }
      s.apart = [...set];
    },
  },

  unapart: { mod: true, run: s => { s.apart = []; } },
};

// -> { ok: true, reply? } or { ok: false, error }
function apply(state, op, args, ctx) {
  const def = Object.hasOwn(OPS, op) ? OPS[op] : null;
  if (!def) return { ok: false, error: `unknown op ${op}` };
  if (def.mod && ctx.role !== 'mod') return { ok: false, error: 'moderators only' };
  try {
    return { ok: true, reply: def.run(state, args && typeof args === 'object' ? args : {}, ctx) };
  } catch (err) {
    if (err instanceof OpError) return { ok: false, error: err.message };
    throw err;
  }
}

module.exports = { apply, emptyState, pairKey, OPS, MAX_TEXT, MAX_QUESTIONS };
