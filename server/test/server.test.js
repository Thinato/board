// End to end against a real server process: rooms, roles, broadcast, vote privacy, persistence across restart.
const test = require('node:test');
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
let proc;

async function start() {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, DATA_DIR, EMBED: 'word', BUCKET: '' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(resolve => proc.stdout.on('data', d => String(d).includes('board server') && resolve()));
}
async function stop() {
  const exited = new Promise(resolve => proc.on('exit', resolve));
  proc.kill('SIGTERM');
  return exited;
}

const createRoom = async (title, headers = {}) =>
  fetch(`${BASE}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ title }) });

// A client that records every message and can wait for one matching a predicate.
function connect(room, { key, voter = 'voter-' + Math.random().toString(36).slice(2).padEnd(16, 'x'), origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin });
  const c = { ws, voter, msgs: [], waiters: [], closed: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'state') c.state = m.state;
    c.waiters = c.waiters.filter(w => !(w.pred(m) && (w.resolve(m), true)));
  });
  ws.on('close', code => { c.closed = code; c.msgs.push({ t: 'closed', code }); c.waiters.forEach(w => w.resolve({ t: 'closed', code })); });
  ws.on('error', () => {});
  c.next = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const found = c.msgs.find(pred);
    if (found) return resolve(found);
    c.waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error('timed out waiting')), ms);
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.op = (op, args) => c.send({ t: 'op', op, args });
  ws.on('open', () => c.send({ t: 'hello', room, key, voter }));
  // Resolves with hello, or with { t: 'closed', code } when refused (including a refused upgrade).
  c.ready = new Promise(resolve => { ws.on('close', code => resolve({ t: 'closed', code })); c.next(m => m.t === 'hello', 5000).then(resolve, () => {}); });
  return c;
}
const stateWith = pred => m => m.t === 'state' && pred(m.state);
const texts = s => Object.values(s.questions).map(q => q.text).sort();

test('rooms, roles, broadcast, privacy and persistence', async t => {
  await start();
  t.after(() => proc.exitCode ?? proc.kill());

  const res = await createRoom('Town hall');
  assert.strictEqual(res.status, 201);
  const { roomId, modKey } = await res.json();
  assert.match(roomId, /^[\w-]{8,32}$/);

  const mod = connect(roomId, { key: modKey });
  const guest = connect(roomId);
  const impostor = connect(roomId, { key: 'wrong-key' });
  assert.deepStrictEqual([(await mod.ready).role, (await guest.ready).role, (await impostor.ready).role], ['mod', 'participant', 'participant']);
  assert.strictEqual((await mod.ready).title, 'Town hall');

  await t.test('a question reaches everyone', async () => {
    const t0 = Date.now();
    guest.op('ask', { text: 'Vamos continuar em home office no ano que vem?' });
    await mod.next(stateWith(s => texts(s).length === 1));
    assert.ok(Date.now() - t0 < 1000);
  });

  await t.test('participants cannot moderate', async () => {
    const id = Object.keys(guest.state.questions)[0];
    for (const [op, args] of [['answer', { ids: [id], answered: true }], ['clear', {}], ['demo', {}]]) {
      guest.op(op, args);
      assert.strictEqual((await guest.next(m => m.t === 'error' && m.op === op)).msg, 'moderators only');
    }
    guest.send({ t: 'suggest' });
    await guest.next(m => m.t === 'error' && m.msg === 'moderators only');
    assert.strictEqual(Object.values(mod.state.questions)[0].answered, false);
  });

  await t.test('votes are counted per voter and raw voter ids are never broadcast', async () => {
    const id = Object.keys(guest.state.questions)[0];
    guest.op('vote', { id });
    await mod.next(stateWith(s => s.questions[id]?.voters.length === 1));
    const me = (await guest.ready).me;
    assert.deepStrictEqual(mod.state.questions[id].voters, [me]);
    assert.ok(!JSON.stringify(mod.msgs).includes(guest.voter) && !JSON.stringify(guest.msgs).includes(mod.voter));
  });

  await t.test('moderator ops, suggestions and the similar hint', async () => {
    mod.op('demo', {});
    await guest.next(stateWith(s => texts(s).length === 13));
    mod.send({ t: 'suggest' });
    const { groups } = await mod.next(m => m.t === 'suggestions');
    assert.ok(groups.length >= 3 && groups.every(g => g.ids.length === g.sim.length));
    mod.op('group', { ids: groups[0].ids, slot: { x: 900, y: 0 } });
    mod.op('apart', { pairs: [[groups[1].ids[0], groups[1].ids[1]]] });
    await guest.next(stateWith(s => Object.keys(s.groups).length === 1 && s.apart.length === 1));
    guest.send({ t: 'similar', text: 'Qual a data de lançamento do app mobile?', seq: 7 });
    const sim = await guest.next(m => m.t === 'similar');
    assert.strictEqual(sim.seq, 7);
    assert.ok(sim.match && guest.state.questions[sim.match.id]);
  });

  await t.test('state survives a restart', async () => {
    const before = JSON.stringify(mod.state);
    await stop();
    assert.strictEqual(await mod.next(m => m.t === 'closed').then(m => m.code), 1012);
    await start();
    const again = connect(roomId, { key: modKey });
    await again.ready;
    await again.next(m => m.t === 'state');
    assert.strictEqual(JSON.stringify(again.state), before);
    again.ws.close();
  });

  await t.test('malformed messages close that socket, not the server', async () => {
    for (const bad of ['null', '1', '[]', '"x"', '{']) {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      await new Promise(r => ws.on('open', r));
      ws.send(bad);
      assert.strictEqual(await new Promise(r => ws.on('close', r)), 4400, bad);
    }
    const flood = connect(roomId);
    await flood.ready;
    for (let i = 0; i < 40; i++) flood.send({ t: 'similar', text: 'uma pergunta qualquer número ' + i, seq: i });
    assert.strictEqual((await flood.next(m => m.t === 'closed', 5000)).code, 1008, 'backlog over 20 closes the socket');
    assert.strictEqual((await fetch(`${BASE}/healthz`)).status, 200);
  });

  await t.test('unknown rooms and foreign origins are refused', async () => {
    const lost = connect('nosuchroom123');
    assert.strictEqual((await lost.ready).code, 4404);
    assert.strictEqual((await createRoom('x', { origin: 'https://evil.example' })).status, 403);
    const foreign = connect(roomId, { origin: 'https://evil.example' });
    assert.strictEqual((await foreign.ready).t, 'closed');
    const ok = await createRoom('x', { origin: 'https://lisecki.dev' });
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://lisecki.dev');
  });

  await stop();
});
