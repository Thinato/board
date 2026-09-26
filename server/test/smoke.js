// Post-deploy check against a running server: node test/smoke.js https://board-….run.app
// Health (with the model loaded), create a room as the site would, then ask over a socket and see it come back.
const assert = require('assert');
const WebSocket = require('ws');

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const ORIGIN = 'https://lisecki.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let health;
  for (let i = 0; i < 60; i++) {
    health = await fetch(`${BASE}/healthz`).then(r => r.json()).catch(() => null);
    if (health && health.embeddings !== 'loading model…') break;
    await sleep(2000);
  }
  assert.strictEqual(health?.embeddings, 'Serafim', `model not loaded: ${JSON.stringify(health)}`);

  const res = await fetch(`${BASE}/rooms`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{"title":"CI smoke"}' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), ORIGIN);
  const { roomId, modKey } = await res.json();

  const ws = new WebSocket(BASE.replace(/^http/, 'ws'), { origin: ORIGIN });
  const msgs = [];
  const next = (pred, ms = 10000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out; got ' + JSON.stringify(msgs.map(m => m.t)))), ms);
    const check = () => { const m = msgs.find(pred); if (m) { clearTimeout(t); resolve(m); } else setTimeout(check, 50); };
    check();
  });
  ws.on('message', raw => msgs.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.send(JSON.stringify({ t: 'hello', room: roomId, key: modKey, voter: 'smoke-test-voter-0001' }));
  assert.strictEqual((await next(m => m.t === 'hello')).role, 'mod');

  const t0 = Date.now();
  ws.send(JSON.stringify({ t: 'op', op: 'ask', args: { text: 'Vamos continuar em home office no ano que vem?' } }));
  await next(m => m.t === 'state' && Object.keys(m.state.questions).length === 1);
  const roundTrip = Date.now() - t0;

  ws.send(JSON.stringify({ t: 'similar', text: 'Vamos poder continuar de home office?', seq: 1 }));
  assert.ok((await next(m => m.t === 'similar')).match, 'similar question found');
  ws.close();
  console.log(`smoke ok: ${BASE} (model ${health.embeddings}, ask round trip ${roundTrip} ms)`);
})().catch(err => { console.error('smoke FAILED:', err.message); process.exit(1); });
