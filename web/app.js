// The server holds each room's state and runs the embedding model; this page renders what it sends
// and sends ops back. Locally, `node server/server.js` serves this page and the socket on one origin.
const SERVER = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? location.origin
  : 'https://board-1004509196255.southamerica-east1.run.app';
// Room links: participants get #r=<room>, moderators #r=<room>&k=<mod key>. The fragment never reaches a server log.
// The key is then kept in this browser and dropped from the address bar, so a screen share doesn't show it.
const LINK = new URLSearchParams(location.hash.slice(1));
const ROOM = LINK.get('r');
let MOD_KEY = LINK.get('k');
try {
  if (MOD_KEY) localStorage.setItem(`board:key:${ROOM}`, MOD_KEY);
  else MOD_KEY = localStorage.getItem(`board:key:${ROOM}`);
  if (LINK.has('k')) history.replaceState(null, '', `#r=${ROOM}`); // no hashchange event, so no reload
} catch {} // storage blocked: the key just stays in the URL
let IS_MOD = false;            // set by the server's hello, from the key
// Suggested groups: numbered, and colored with hues far apart that also differ in lightness.
// Blue is the page's accent and orange its attention color, so neither is used here.
const COLORS = ['#0f766e', '#7c3aed', '#4d7c0f', '#334155'];
const $ = s => document.querySelector(s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const votes = q => q.voters.length + (q.imported || 0); // imported: Slido/demo vote counts
const totalVotes = qs => qs.reduce((n, q) => n + votes(q), 0);

// Tiny DOM helper. Strings become text nodes, so user input is never parsed as HTML.
function h(tag, props = {}, ...kids) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter(k => k != null && k !== false));
  return el;
}

// Lucide icons (lucide.dev, ISC license): the inner markup of each 24×24 stroke icon.
const ICONS = {
  messages: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  presentation: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  sort: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8 12 3 7 8"/><path d="M12 3v12"/>',
  flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  send: '<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/><path d="M6 12h16"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkAll: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  reopen: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  group: '<path d="M3 7V5c0-1.1.9-2 2-2h2"/><path d="M17 3h2c1.1 0 2 .9 2 2v2"/><path d="M21 17v2c0 1.1-.9 2-2 2h-2"/><path d="M7 21H5c-1.1 0-2-.9-2-2v-2"/><rect width="7" height="5" x="7" y="7" rx="1"/><rect width="7" height="5" x="10" y="12" rx="1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attrs = { class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  svg.innerHTML = ICONS[name]; // constant markup from the table above, never user input
  return svg;
}
document.querySelectorAll('[data-icon]').forEach(el => el.prepend(icon(el.dataset.icon)));

// Anonymous, private per-browser id: the server only ever shows others a per-room hash of it (`me`).
let voterId = null;
try { voterId = localStorage.getItem('board:voter'); } catch {}
if (!/^[\w-]{16,64}$/.test(voterId || '')) {
  voterId = crypto.randomUUID();
  try { localStorage.setItem('board:voter', voterId); } catch {} // private mode: a new id per visit
}
let me = null;                 // this browser's voter hash in this room, from hello

let state = { questions: {}, groups: {}, apart: [] };
let view = { x: 40, y: 80, z: 1 };
let suggestions = [];          // [[questionId, ...], ...]
let suggestThreshold = 0.72;   // from the server, with each batch of suggestions
const pairSim = new Map();     // pairKey -> similarity, from the server's suggestions
let drag = null;
let renderPending = false;
let fitNext = true;            // fit the view to the board once the next state arrives

// ---------- Connection ----------
// Cloud Run bills while a socket is open, so idle tabs let go: hidden for 5 minutes closes the socket
// (it comes back when the tab does), and after a drop nobody has touched for 30 minutes it stays closed.

const HIDDEN_MS = 5 * 60e3, IDLE_MS = 30 * 60e3;
let ws = null, retries = 0, reconnectTimer = null, hiddenTimer = null, lastInput = Date.now();
let restarting = false;       // the server said it's restarting (1012): keep trying until it's back

function connect() {
  clearTimeout(reconnectTimer);
  if (document.hidden) return setStatus('paused');
  setStatus(retries ? 'reconnecting' : 'connecting');
  const sock = ws = new WebSocket(SERVER.replace(/^http/, 'ws'));
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', room: ROOM, key: MOD_KEY || undefined, voter: voterId }));
  sock.onmessage = e => onMessage(JSON.parse(e.data));
  sock.onclose = e => {
    if (ws !== sock) return;
    ws = null;
    if (e.code === 4404) return showLanding('This room doesn’t exist, or it expired after 90 days without activity.');
    if (document.hidden) return setStatus('paused');
    // 1012: the server is restarting (a deploy), so come back whether or not anyone is around, including
    // through the failed attempts while the new instance starts.
    if (e.code === 1012) restarting = true;
    if (!restarting && Date.now() - lastInput > IDLE_MS) return setStatus('offline');
    reconnectTimer = setTimeout(connect, Math.min(10000, 500 * 2 ** retries++));
    setStatus('reconnecting');
  };
}

document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenTimer);
  if (document.hidden) hiddenTimer = setTimeout(() => ws?.close(1000, 'tab hidden'), HIDDEN_MS);
  else if (ROOM && !ws && $('#status').dataset.state !== 'gone') { lastInput = Date.now(); retries = 0; connect(); }
});
for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, () => (lastInput = Date.now()), { capture: true, passive: true });

const STATUS = { connecting: 'Connecting…', reconnecting: 'Reconnecting…', live: 'Live', paused: 'Paused while hidden', offline: 'Disconnected · reconnect' };
function setStatus(s, detail) {
  const el = $('#status');
  el.dataset.state = s;
  el.textContent = STATUS[s];
  el.title = detail || '';
  el.disabled = s !== 'offline';
}

function send(msg) {
  if (ws?.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
  flash('Not connected, reconnecting…');
  if (!ws) { retries = 0; connect(); }
  return false;
}
const op = (name, args = {}) => send({ t: 'op', op: name, args });

let flashTimer;
function flash(msg) {
  const help = $('#help');
  help.textContent = msg;
  help.classList.add('flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(showHelp, 5000);
}

let lastAsked = '';
function onMessage(m) {
  if (m.t === 'hello') {
    retries = 0;
    restarting = false;
    me = m.me;
    IS_MOD = m.role === 'mod';
    showRole();
    $('#title').textContent = m.title;
    document.title = `${m.title} · Q&A Board`;
    setStatus('live', `Similarity: ${m.embeddings}`);
  } else if (m.t === 'state') {
    state = m.state;
    render();
    if (fitNext) { fitNext = false; fit(); }
  } else if (m.t === 'suggestions') {
    suggestThreshold = m.threshold;
    for (const g of m.groups) g.ids.forEach((a, i) => g.ids.forEach((b, j) => pairSim.set(pairKey(a, b), g.sim[i][j])));
    suggestions = m.groups.map(g => g.ids);
    render(); // outlines the cards and updates the tab's badge; the panel opens only when asked
  } else if (m.t === 'similar') {
    showSimilarResult(m);
  } else if (m.t === 'reply' && m.op === 'add') {
    fitNext = true;
    flash(`Imported ${m.added} of ${m.total} Slido questions` + (m.added < m.total ? ' (rest already on the board)' : ''));
  } else if (m.t === 'error') {
    if (m.op === 'ask' && !draft.value) { draft.value = lastAsked; showCount(); }
    flash(m.msg);
  }
}

const world = $('#world');
const viewport = $('#viewport');
const draft = $('#draft');

function membersOf(gid, s = state) {
  return Object.values(s.questions)
    .filter(q => q.groupId === gid)
    .sort((a, b) => votes(b) - votes(a) || a.createdAt - b.createdAt);
}

// ---------- Render ----------

function render() {
  if (drag) { renderPending = true; return; }
  renderPending = false;
  pruneSuggestions();
  const hide = $('#hideAnswered').ariaPressed === 'true';
  const suggestNo = {};
  suggestions.forEach((ids, i) => ids.forEach(id => (suggestNo[id] = i)));

  const card = q => {
    const el = h('div', { className: 'card' + (q.answered ? ' answered' : '') + (q.voters.includes(me) ? ' voted' : '') },
      h('p', { className: 'text' }, q.text),
      h('div', { className: 'row' },
        h('button', { className: 'vote', title: 'Upvote', ariaLabel: `Upvote, ${votes(q)} votes` }, icon('up'), `${votes(q)}`),
        h('span', { className: 'spacer' }),
        q.answered && h('span', { className: 'answered-tag' }, icon('check'), 'Answered'),
        IS_MOD && h('button', { className: 'answer', title: q.answered ? 'Reopen' : 'Mark answered', ariaLabel: q.answered ? 'Reopen' : 'Mark answered' },
          icon(q.answered ? 'reopen' : 'check'))));
    el.dataset.id = q.id;
    if (!q.groupId) Object.assign(el.style, { left: q.x + 'px', top: q.y + 'px' });
    if (q.id in suggestNo) { // numbered outline, matching the suggestion's number in the sidebar
      el.dataset.suggest = suggestNo[q.id] + 1;
      el.style.setProperty('--suggest', COLORS[suggestNo[q.id] % COLORS.length]);
    }
    return el;
  };

  const nodes = [];
  for (const g of Object.values(state.groups)) {
    const all = membersOf(g.id);
    if (!all.length) continue;
    const answered = all.every(q => q.answered);
    if (hide && answered) continue;
    const title = g.title || all[0].text;
    const el = h('section', { className: 'group' + (answered ? ' answered' : '') },
      h('header', {},
        IS_MOD ? h('input', { className: 'title', value: title, title: 'Rename group' }) : h('span', { className: 'title' }, title),
        h('span', { className: 'total', title: 'Combined votes · questions' }, icon('up'), `${totalVotes(all)} · ${all.length}`),
        IS_MOD && h('button', { className: 'answer-group', title: answered ? 'Reopen all' : 'Mark all answered', ariaLabel: answered ? 'Reopen all' : 'Mark all answered' },
          icon(answered ? 'reopen' : 'checkAll'))),
      h('div', { className: 'members' }, ...all.filter(q => !(hide && q.answered)).map(card)));
    el.dataset.gid = g.id;
    Object.assign(el.style, { left: g.x + 'px', top: g.y + 'px' });
    nodes.push(el);
  }
  for (const q of Object.values(state.questions)) {
    if (!q.groupId && !(hide && q.answered)) nodes.push(card(q));
  }
  world.replaceChildren(...nodes);
  renderSuggestions();
  showSuggestTab();
  renderPresentation();
  applyView();
}

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  viewport.style.backgroundSize = `${24 * view.z}px ${24 * view.z}px`;
  viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function fit() {
  const els = [...world.children];
  if (!els.length) return;
  const x0 = Math.min(...els.map(e => e.offsetLeft)), y0 = Math.min(...els.map(e => e.offsetTop));
  const x1 = Math.max(...els.map(e => e.offsetLeft + e.offsetWidth)), y1 = Math.max(...els.map(e => e.offsetTop + e.offsetHeight));
  const top = 64, vw = innerWidth, vh = innerHeight - top - 110;
  view.z = clamp(Math.min(vw / (x1 - x0 + 80), vh / (y1 - y0 + 80)), 0.25, 1);
  view.x = (vw - (x1 - x0) * view.z) / 2 - x0 * view.z;
  view.y = top + (vh - (y1 - y0) * view.z) / 2 - y0 * view.z;
  applyView();
}

// First grid slot (4 columns) where a w×h box overlaps nothing on the board, ignoring cards in `skip`.
function freeSlot(w = 240, h = 140, skip = []) {
  const rects = [...world.children].filter(e => !skip.includes(e.dataset.id))
    .map(e => ({ x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight }));
  for (let i = 0; ; i++) {
    const x = (i % 4) * 260, y = Math.floor(i / 4) * 150;
    if (!rects.some(r => x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h)) return { x, y };
  }
}

// ---------- Actions ----------

// Actions are ops the server applies (rules in server/ops.js); the new state comes back to every client.

// toggle false only adds a vote ("upvote it instead").
const upvote = (id, toggle = true) => op('vote', toggle ? { id } : { id, on: true });

// Answering is applied locally right away too, so presentation mode moves on without waiting for the echo.
function setAnswered(ids, answered) {
  ids.forEach(id => { if (state.questions[id]) state.questions[id].answered = answered; });
  op('answer', { ids, answered });
  render();
}

function acceptSuggestion(ids) {
  op('group', { ids, slot: freeSlot(272, 60 + ids.length * 120, ids) }); // rough group size; members vacate their spots
}

// Board items in Sort order: [groups, loose cards], each by votes (highest first), answered ones last.
// Shared by Sort and presentation mode. item: { key, group?, qs, votes, answered, createdAt }
function sortedSections() {
  const item = (key, qs, group) => ({
    key, group, qs, votes: totalVotes(qs), answered: qs.every(q => q.answered), createdAt: Math.min(...qs.map(q => q.createdAt)),
  });
  const groups = Object.values(state.groups).map(g => item(g.id, membersOf(g.id), g)).filter(i => i.qs.length);
  const loose = Object.values(state.questions).filter(q => !q.groupId).map(q => item(q.id, [q]));
  const order = (a, b) => a.answered - b.answered || b.votes - a.votes || a.createdAt - b.createdAt;
  return [groups.sort(order), loose.sort(order)];
}

// Moderator "Sort": one-shot layout, 4 per row; loose cards start on a fresh row below the groups.
function sortBoard() {
  const dom = new Map([...world.children].map(e => [e.dataset.gid || e.dataset.id, e]));
  const pos = {};
  let y = 0;
  for (const section of sortedSections()) {
    for (let i = 0; i < section.length; i += 4) {
      const row = section.slice(i, i + 4);
      row.forEach((it, col) => (pos[it.key] = { x: col * 300, y }));
      y += Math.max(...row.map(it => dom.get(it.key)?.offsetHeight ?? 140)) + 24; // hidden (answered) items: estimate
    }
  }
  op('layout', { pos });
  fitNext = true;
}

// ---------- Presentation mode (moderator) ----------
// Full screen, one item at a time in Sort order: a loose question, or a whole group.
// Mark answered (or skip) moves to the next unanswered item, until none are left; Back undoes the last answer or skip.

const presentBox = $('#present');
let presentKey = null; // item on screen; stays put while new votes/questions reshuffle the rest
// Steps Back can undo, newest last (per tab): { key } for a skip, { key, ids } for an answer (ids = what it marked).
const presentHistory = [];

const unanswered = () => sortedSections().flat().filter(i => !i.answered);

// The item after the current one (wrapping), so skipped items come back around.
function nextKey() {
  const left = unanswered();
  const i = left.findIndex(it => it.key === presentKey);
  return left.length > 1 ? left[(i + 1) % left.length].key : null;
}

function skip() {
  const next = nextKey();
  if (!next) return; // nothing else to move to
  presentHistory.push({ key: presentKey });
  presentKey = next;
  renderPresentation();
}

function answerCurrent() {
  const cur = unanswered().find(i => i.key === presentKey);
  if (!cur) return;
  presentHistory.push({ key: cur.key, ids: cur.qs.filter(q => !q.answered).map(q => q.id) });
  presentKey = nextKey();
  setAnswered(cur.qs.filter(q => !q.answered).map(q => q.id), true);
}

// Undo the last step and show that item again; an answer also reopens exactly what it marked.
function back() {
  const last = presentHistory.pop();
  if (!last) return;
  presentKey = last.key;
  if (last.ids) setAnswered(last.ids, false);
  else renderPresentation();
}

function renderPresentation() {
  if (presentBox.hidden) return;
  const all = sortedSections().flat(), left = all.filter(i => !i.answered);
  const cur = left.find(i => i.key === presentKey) || left[0];
  presentKey = cur?.key ?? null;
  presentBox.replaceChildren(...[
    h('header', {},
      h('span', { className: 'progress' }, `${all.length - left.length} of ${all.length} answered`),
      h('button', { onclick: stopPresenting }, icon('x'), 'Exit (Esc)')),
    cur ? h('main', { className: cur.group ? 'is-group' : '' },
      h('p', { className: 'meta' }, cur.group ? `${cur.qs.length} related questions · ` : '', icon('up'), `${cur.votes}`),
      cur.group?.title && h('h2', {}, cur.group.title),
      h('ul', {}, ...cur.qs.map(q => h('li', { className: q.answered ? 'answered' : '' },
        cur.group && h('span', { className: 'votes' }, ...(q.answered ? [icon('check')] : [icon('up'), `${votes(q)}`])),
        h('span', { className: 'text' }, q.text)))))
      : h('main', { className: 'done' }, h('h2', {}, all.length ? 'All questions answered 🎉' : 'No questions yet')),
    h('footer', {},
      h('button', { className: 'back', onclick: back, disabled: !presentHistory.length, title: 'Back to the previous question, undoing its answer or skip (← or Backspace)' }, icon('arrowLeft'), 'Back'),
      cur && h('button', { onclick: skip, title: 'Skip (→)' }, 'Skip', icon('arrowRight')),
      cur && h('button', { className: 'primary', onclick: answerCurrent }, icon('check'), cur.group ? 'Mark group answered (Enter)' : 'Mark answered (Enter)')),
  ].filter(Boolean));
}

function startPresenting() {
  document.activeElement?.blur(); // so Enter doesn't also post a half-typed draft
  presentBox.hidden = false;
  presentKey = null;
  renderPresentation();
  document.documentElement.requestFullscreen?.().catch(() => {}); // best effort; the overlay works without it
}

function stopPresenting() {
  presentBox.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// Esc in fullscreen is taken by the browser (no keydown), so leaving fullscreen also ends the presentation.
addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) presentBox.hidden = true; });
addEventListener('keydown', e => {
  if (presentBox.hidden) return;
  const action = { Enter: answerCurrent, ArrowRight: skip, ArrowLeft: back, Backspace: back, Escape: stopPresenting }[e.key];
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  action();
}, true);

// ---------- Suggestions (moderator) ----------

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// Cards already sharing a group stay linked: dismissing "add X to group G" only separates X from G's members.
const sameGroup = (a, b) => state.questions[a]?.groupId && state.questions[a].groupId === state.questions[b]?.groupId;
// The room remembers these pairs (state.apart), so later suggestions leave them apart, for every moderator.
const keepApart = (ids, others) => op('apart', {
  pairs: ids.flatMap(id => others.filter(o => o !== id && !sameGroup(id, o)).map(o => [id, o])),
});

// The server clusters unanswered questions (grouped ones too, so a new duplicate can join a group)
// The server re-runs grouping whenever questions change and pushes `suggestions` to moderators.

// Drop suggestions that no longer have anything left to do.
function pruneSuggestions() {
  suggestions = suggestions
    .map(ids => ids.filter(id => state.questions[id] && !state.questions[id].answered))
    .filter(ids => ids.length > 1 && ids.some(id => !state.questions[id].groupId));
}

// How well a card fits its suggestion: average similarity to the other cards (the measure the grouping uses).
// Recomputed from the server's pair similarities, so it updates when a card is removed.
function fitScore(id, ids) {
  const sims = ids.filter(o => o !== id).map(o => pairSim.get(pairKey(id, o)));
  if (!sims.length || sims.some(s => s == null)) return null;
  return sims.reduce((a, b) => a + b, 0) / sims.length;
}

function renderSuggestions() {
  const panel = $('#suggestions');
  if (panel.hidden) return;
  panel.replaceChildren(
    h('h3', {}, suggestions.length ? 'Suggested groups' : 'No similar questions found',
      suggestions.length > 0 && h('span', { className: 'count' }, suggestions.length)),
    ...suggestions.map((ids, i) => {
      const el = h('div', { className: 'suggestion' },
        h('header', {}, h('span', { className: 'no' }, i + 1), `${ids.length} questions`),
        // Best fit first, so the card most worth removing sits at the bottom.
        h('ul', {}, ...ids.map(id => [id, fitScore(id, ids)]).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([id, score]) => h('li', {},
          score != null && h('span', {
            className: 'fit' + (score < suggestThreshold ? ' weak' : ''),
            title: `Average similarity to the other cards here. Grouping needs ${suggestThreshold} on average.`,
          }, score.toFixed(2)),
          h('span', { className: 'q' }, state.questions[id].text,
            state.questions[id].groupId && h('span', { className: 'score' }, ' (already grouped)')),
          // Remove one card: it's kept apart from the rest, and the suggestion goes away if < 2 remain (pruneSuggestions).
          h('button', {
            className: 'remove', title: 'Not part of this group', ariaLabel: 'Remove from this suggestion',
            onclick: () => { keepApart([id], ids); suggestions[i] = ids.filter(x => x !== id); render(); },
          }, icon('x'))))),
        h('button', { className: 'primary', onclick: () => acceptSuggestion(ids) }, icon('group'), 'Group them'),
        h('button', { onclick: () => { keepApart(ids, ids); suggestions.splice(i, 1); render(); } }, icon('x'), 'Dismiss'));
      el.style.setProperty('--suggest', COLORS[i % COLORS.length]);
      return el;
    }),
    ...(state.apart.length ? [h('button', { className: 'undo', onclick: () => op('unapart') }, icon('undo'), 'Undo dismissals')] : []));
}

// The sidebar's tab: on the screen edge when closed, on the panel's edge when open, so it can always be
// toggled. Badged with how many groups are waiting to be merged.
function showSuggestTab() {
  const tab = $('#suggestTab'), open = !$('#suggestions').hidden, n = suggestions.length;
  tab.hidden = !IS_MOD;
  document.body.classList.toggle('suggest-open', open);
  tab.ariaExpanded = open;
  tab.replaceChildren(icon('group'), icon(open ? 'right' : 'left'), $('#suggestCount'));
  $('#suggestCount').hidden = !n || open; // the open panel's header shows the count
  $('#suggestCount').textContent = n;
  tab.ariaLabel = tab.title = open ? 'Hide suggested groups' : n ? `${n} suggested group${n > 1 ? 's' : ''} to merge` : 'Suggested groups';
}
$('#suggestTab').addEventListener('click', () => { $('#suggestions').hidden = !$('#suggestions').hidden; render(); });

// ---------- Canvas interactions ----------

world.addEventListener('click', e => {
  const id = e.target.closest('.card')?.dataset.id;
  if (e.target.closest('.vote')) upvote(id);
  else if (IS_MOD && e.target.closest('.answer')) setAnswered([id], !state.questions[id].answered);
  else if (IS_MOD && e.target.closest('.answer-group')) {
    const ms = membersOf(e.target.closest('.group').dataset.gid);
    setAnswered(ms.map(q => q.id), !ms.every(q => q.answered));
  }
});

world.addEventListener('change', e => {
  if (!IS_MOD || !e.target.matches('input.title')) return;
  const gid = e.target.closest('.group').dataset.gid;
  op('rename', { gid, title: e.target.value.trim().slice(0, 80) });
});

const toWorld = (cx, cy) => ({ x: (cx - view.x) / view.z, y: (cy - view.y) / view.z });

function dropTargetAt(cx, cy) {
  const el = document.elementFromPoint(cx, cy);
  const group = el?.closest('#world .group');
  if (group) return { el: group, gid: group.dataset.gid };
  const card = el?.closest('#world .card');
  return card ? { el: card, id: card.dataset.id } : null;
}

viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button, input')) return;
  const base = { sx: e.clientX, sy: e.clientY, moved: false };
  const card = IS_MOD && e.target.closest('.card');
  const group = IS_MOD && e.target.closest('.group');
  if (card) drag = { ...base, kind: 'card', el: card, id: card.dataset.id };
  else if (group) {
    const g = state.groups[group.dataset.gid];
    drag = { ...base, kind: 'group', el: group, id: g.id, ox: g.x, oy: g.y };
  } else drag = { ...base, kind: 'pan', ox: view.x, oy: view.y };
});

addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.kind === 'pan') viewport.classList.add('panning');
    if (drag.kind === 'card') {
      // Lift the card to the world root so it can leave its group.
      const r = drag.el.getBoundingClientRect();
      const p = toWorld(r.left, r.top);
      drag.ox = p.x; drag.oy = p.y;
      drag.el.classList.add('dragging');
      world.append(drag.el);
    }
  }
  if (drag.kind === 'pan') {
    view.x = drag.ox + dx; view.y = drag.oy + dy;
    applyView();
    return;
  }
  drag.el.style.left = drag.ox + dx / view.z + 'px';
  drag.el.style.top = drag.oy + dy / view.z + 'px';
  if (drag.kind === 'card') {
    const t = dropTargetAt(e.clientX, e.clientY);
    if (drag.target?.el !== t?.el) {
      drag.target?.el.classList.remove('drop-target');
      t?.el.classList.add('drop-target');
    }
    drag.target = t;
  }
});

function endDrag(e, commit) {
  const d = drag;
  drag = null;
  viewport.classList.remove('panning');
  if (!d || !d.moved || !commit || d.kind === 'pan') { if (renderPending || (d?.moved && d.kind !== 'pan')) render(); return; }
  const pos = { x: parseFloat(d.el.style.left), y: parseFloat(d.el.style.top) };
  // The dragged element stays where it was dropped until the server's state arrives and re-renders it.
  if (d.kind === 'group') op('moveGroup', { id: d.id, pos });
  else {
    const t = dropTargetAt(e.clientX, e.clientY);
    op('drop', { id: d.id, target: t && (t.gid ? { gid: t.gid } : { id: t.id }), pos });
  }
}
addEventListener('pointerup', e => endDrag(e, true));
addEventListener('pointercancel', e => endDrag(e, false));

// Figma-style: scroll pans, pinch or Ctrl/Cmd+scroll zooms around the cursor.
viewport.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const z = clamp(view.z * Math.exp(-e.deltaY * 0.01), 0.25, 2);
    view.x = e.clientX - (e.clientX - view.x) * z / view.z;
    view.y = e.clientY - (e.clientY - view.y) * z / view.z;
    view.z = z;
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
  }
  applyView();
}, { passive: false });

// ---------- Composer ----------

function post() {
  const text = draft.value.trim();
  if (!text || !op('ask', { text })) return;
  lastAsked = text; // put back if the server refuses it
  draft.value = '';
  showCount();
  showSimilar();
}

// Nudge people to upvote an existing question instead of posting a duplicate. The server compares
// the draft with open questions; `seq` drops answers to drafts that have since changed.
let similarSeq = 0;
function showSimilar() {
  const text = draft.value.trim();
  similarSeq++;
  if (text.length < 8) $('#similar').hidden = true;
  else send({ t: 'similar', text, seq: similarSeq });
}

function showSimilarResult(m) {
  const box = $('#similar');
  if (m.seq !== similarSeq) return;
  const best = m.match && state.questions[m.match.id];
  box.hidden = !best;
  if (!best) return;
  const already = best.voters.includes(me);
  box.replaceChildren('Similar question already asked: ', h('q', {}, best.text), ' ',
    h('button', {
      type: 'button', disabled: already,
      onclick: () => { upvote(best.id, false); draft.value = ''; showCount(); showSimilar(); },
    }, icon('up'), already ? 'You upvoted it' : 'Upvote it instead'));
}

$('#composer').addEventListener('submit', e => { e.preventDefault(); post(); });
let similarTimer;
draft.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });
// 200 chars keeps any question well inside the model's 128-token window (~0.24-0.44 tokens/char in pt-BR)
// and nudges one question per card, which embeds (and groups) better than several packed together.
const showCount = () => ($('#count').textContent = `${draft.value.length}/${draft.maxLength}`);
draft.addEventListener('input', () => {
  showCount();
  draft.style.height = 'auto';
  draft.style.height = draft.scrollHeight + 'px';
  clearTimeout(similarTimer);
  similarTimer = setTimeout(showSimilar, 300);
});

// ---------- Toolbar ----------

function showHelp() {
  const help = $('#help');
  help.classList.remove('flash');
  help.textContent = IS_MOD
    ? 'Drop a card on another to group · drag it out to ungroup · drag space to pan · ⌘/Ctrl+scroll to zoom'
    : 'Anonymous · ▲ to upvote · drag to pan · ⌘/Ctrl+scroll to zoom';
}

function showRole() {
  document.body.classList.toggle('is-mod', IS_MOD);
  $('#role').textContent = IS_MOD ? 'Moderator' : 'Participant';
  $('#role').classList.toggle('mod', IS_MOD);
  showHelp();
}

$('#status').addEventListener('click', () => { retries = 0; lastInput = Date.now(); connect(); });
$('#hideAnswered').addEventListener('click', e => {
  const b = e.currentTarget, on = b.ariaPressed !== 'true';
  b.ariaPressed = on;
  b.dataset.tip = on ? 'Show answered' : 'Hide answered';
  render();
});
// More: the rare board actions. Closes on a pick, a click elsewhere or Esc.
const more = $('#more');
const showMore = open => { more.hidden = !open; $('#moreBtn').ariaExpanded = open; };
$('#moreBtn').addEventListener('click', () => showMore(more.hidden));
more.addEventListener('click', e => e.target.closest('button') && showMore(false));
addEventListener('pointerdown', e => { if (!e.target.closest('#more, #moreBtn')) showMore(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !more.hidden) { showMore(false); $('#moreBtn').focus(); } });
$('#fit').addEventListener('click', fit);
$('#sort').addEventListener('click', sortBoard);
$('#presentBtn').addEventListener('click', startPresenting);
$('#demo').addEventListener('click', () => { op('demo'); fitNext = true; });
// Slido export: a JSON array of questions. Each point of Slido score becomes a placeholder vote,
// and re-importing the same file skips questions already on the board (the server checks ids).
$('#importBtn').addEventListener('click', () => $('#import').click());
$('#import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let rows = null;
  try { rows = JSON.parse(await file.text()); } catch {}
  if (!Array.isArray(rows)) return alert('Not a Slido export: expected a JSON array of questions.');
  const items = rows.filter(r => r?.type === 'Question' && typeof r.text === 'string' && r.text.trim()
    && r.is_public !== false && !r.date_deleted).map(r => ({
    id: r.event_question_id != null ? `slido-${r.event_question_id}` : undefined,
    text: r.text.trim(),
    votes: clamp(Math.floor(Number(r.score) || 0), 0, 1000),
    answered: r.is_answered === true,
    createdAt: Date.parse(r.date_created) || Date.now(),
  }));
  op('add', { items }); // the reply says how many were new
});
$('#clear').addEventListener('click', () => {
  if (confirm('Clear the whole board?')) op('clear');
});

// Share: links for participants and for other moderators. Anyone with the moderator link can moderate.
const roomLink = key => `${location.origin}${location.pathname}#r=${ROOM}` + (key ? `&k=${key}` : '');
$('#shareBtn').addEventListener('click', () => {
  const row = (label, url, note) => h('label', {}, h('span', {}, label),
    h('div', { className: 'row' },
      h('input', { readOnly: true, value: url, onfocus: e => e.target.select() }),
      h('button', {
        type: 'button',
        onclick: e => { const b = e.currentTarget; navigator.clipboard.writeText(url).then(
          () => (b.lastChild.textContent = 'Copied'),
          () => { b.previousSibling.select(); b.lastChild.textContent = 'Press ⌘/Ctrl+C'; }); }, // clipboard blocked
      }, icon('copy'), 'Copy')),
    h('small', {}, note));
  $('#share').replaceChildren(h('form', { method: 'dialog' },
    h('h3', {}, 'Invite people'),
    row('Participants', roomLink(), 'Ask and upvote anonymously.'),
    row('Moderators', roomLink(MOD_KEY), 'Full control: answer, group, clear. Share with care.'),
    h('button', { className: 'primary' }, 'Done')));
  $('#share').showModal();
});

// ---------- Start ----------

function showLanding(problem) {
  document.body.classList.add('landing');
  setStatus('offline');
  $('#status').dataset.state = 'gone';
  $('#landing-problem').textContent = problem || '';
  $('#landing-problem').hidden = !problem;
}

$('#landing').addEventListener('submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  const create = () => fetch(`${SERVER}/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: $('#roomTitle').value }),
  });
  try {
    // A request that never got through (seen now and then on a browser's first call) is retried once.
    // Only network failures: an HTTP error, like the rate limit, is shown as is. If the first request
    // did create a room and only the reply was lost, that room is left empty and expires.
    const res = await create().catch(() => new Promise(r => setTimeout(r, 1000)).then(create));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    location.hash = `r=${body.roomId}&k=${body.modKey}`; // reloads into the room, below
  } catch (err) {
    showLanding(`Couldn’t create the room: ${err.message || 'server unreachable'}.`);
    button.disabled = false;
  }
});
// Opening another room link in this tab.
addEventListener('hashchange', () => location.reload());

if (ROOM) connect();
else showLanding();
