// Q&A Board server: HTTP (create room, health) + one WebSocket per open board.
// Locally it also serves ../web, so `node server.js` is the whole dev setup: http://localhost:8080
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const model = require('./model.js');
const E = require('./embed.js');
const store = require('./store.js');
const { Rooms, whenModelReady } = require('./rooms.js');

const PORT = Number(process.env.PORT) || 8080;
const ORIGINS = (process.env.ORIGINS || 'https://lisecki.dev').split(',');
const WEB = path.join(__dirname, '..', 'web');
const SERVE_WEB = fs.existsSync(WEB); // not in the container: production pages come from GitHub Pages
const VOTER = /^[\w-]{16,64}$/;

const rooms = new Rooms(store.open());
if (process.env.EMBED !== 'word') whenModelReady(model.load().then(name => console.log(`embeddings: ${name}`)));

// Browsers always send Origin; other clients (smoke test, curl) don't, and have no cookies to abuse.
const originOk = o => !o || ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
// Cloud Run appends the caller's address to X-Forwarded-For, so the last entry is the one it saw.
// IPv6 is keyed by /64: one host usually owns the whole block.
function clientIp(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

// Fixed-window counters. ponytail: in memory, reset on restart; fine as an abuse brake, not a quota.
function limiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now(), h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); if (hits.size > 10000) hits.clear(); return true; }
    return ++h.n <= max;
  };
}
const roomsPerIp = limiter(20, 3600e3), roomsTotal = limiter(300, 3600e3);
// Open sockets per address. High enough for a whole office behind one NAT, low enough that one host
// can't take all of Cloud Run's 1000 connection slots.
const SOCKETS_PER_IP = 300;
const socketsByIp = new Map();

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, max = 2048) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function createRoom(req, res, cors) {
  if (!roomsPerIp(clientIp(req)) || !roomsTotal('all')) return json(res, 429, { error: 'Too many new rooms, try again later' }, cors);
  let title = '';
  try { title = JSON.parse(await readBody(req)).title; } catch {}
  title = typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : 'Q&A';
  json(res, 201, await rooms.create(title), cors);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const file = path.join(WEB, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(WEB)) return json(res, 404, { error: 'not found' });
  fs.readFile(fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file) || '.html'] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = origin && originOk(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  try {
    // Not /healthz: Cloud Run's front end reserves paths ending in z and never forwards them.
    if (req.url === '/health') return json(res, 200, { ok: true, embeddings: E.backend.name, rooms: rooms.live.size });
    if (req.url === '/rooms') {
      if (!originOk(origin)) return json(res, 403, { error: 'origin not allowed' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' });
        return res.end();
      }
      if (req.method === 'POST') return await createRoom(req, res, cors);
    }
    if (SERVE_WEB && req.method === 'GET') return serveStatic(req, res);
    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
});

// ---------- WebSocket ----------
// Client -> server: { t: 'hello', room, key?, voter }, then { t: 'op', op, args }, { t: 'similar', text, seq }, { t: 'suggest' }
// Server -> client: hello { role, me, title, embeddings }, state { state }, reply { op, ... }, similar, suggestions, error

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  // Whole-room state messages compress ~5x. No context takeover keeps memory per socket small.
  perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true },
});

server.on('upgrade', (req, socket, head) => {
  if (!originOk(req.headers.origin)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  const ip = clientIp(req);
  if ((socketsByIp.get(ip) || 0) >= SOCKETS_PER_IP) return socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
  wss.handleUpgrade(req, socket, head, ws => {
    socketsByIp.set(ip, (socketsByIp.get(ip) || 0) + 1);
    ws.on('close', () => { const n = socketsByIp.get(ip) - 1; if (n) socketsByIp.set(ip, n); else socketsByIp.delete(ip); });
    wss.emit('connection', ws, req);
  });
});

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('error', err => console.warn('socket error:', err.message));

  let room = null, ctx = null, tokens = 20, last = Date.now(), lastAsk = 0, pending = 0;
  const helloTimer = setTimeout(() => ws.close(4400, 'hello expected'), 10000);

  // 10 messages/s sustained, bursts of 20.
  const allowed = () => {
    const now = Date.now();
    tokens = Math.min(20, tokens + (now - last) / 100);
    last = now;
    return tokens >= 1 && tokens--;
  };

  // One message at a time, in order: an op sent right after hello waits for the room to load, and each
  // socket has at most one embedding run queued on the model. The backlog is bounded, and a handler
  // error closes this socket instead of the process.
  let queue = Promise.resolve();
  ws.on('message', raw => {
    if (++pending > 20) return ws.close(1008, 'too many messages');
    queue = queue.then(() => handle(raw))
      .catch(err => { console.error(err); ws.close(1011, 'server error'); })
      .finally(() => pending--);
  });

  async function handle(raw) {
    let m;
    try { m = JSON.parse(raw); } catch {}
    if (!m || typeof m !== 'object') return ws.close(4400, 'bad message');
    if (!allowed()) return send(ws, { t: 'error', msg: 'Slow down' });

    if (!room) {
      if (m.t !== 'hello' || typeof m.room !== 'string' || !store.ROOM_ID.test(m.room) || !VOTER.test(m.voter ?? '')) {
        return ws.close(4400, 'bad hello');
      }
      clearTimeout(helloTimer);
      const r = await rooms.get(m.room);
      if (!r) return ws.close(4404, 'room not found');
      if (ws.readyState !== 1) return;
      room = r;
      ctx = { role: room.isModKey(m.key) ? 'mod' : 'participant', me: room.voterHash(m.voter) };
      rooms.join(room, ws);
      send(ws, { t: 'hello', role: ctx.role, me: ctx.me, title: room.doc.title, embeddings: E.backend.name });
      ws.send(room.stateMessage());
      return;
    }

    try {
      if (m.t === 'op') {
        if (m.op === 'ask') {
          if (Date.now() - lastAsk < 3000) return send(ws, { t: 'error', op: m.op, msg: 'Wait a few seconds between questions' });
          lastAsk = Date.now();
        }
        const res = room.apply(m.op, m.args, ctx);
        if (!res.ok) send(ws, { t: 'error', op: m.op, msg: res.error });
        else if (res.reply) send(ws, { t: 'reply', op: m.op, ...res.reply });
      } else if (m.t === 'similar' && typeof m.text === 'string') {
        send(ws, { t: 'similar', seq: m.seq, match: await room.similar(m.text.trim().slice(0, 200)) });
      } else if (m.t === 'suggest') {
        if (ctx.role !== 'mod') return send(ws, { t: 'error', msg: 'moderators only' });
        send(ws, { t: 'suggestions', ...(await room.suggest()) });
      }
    } catch (err) {
      console.error(err);
      send(ws, { t: 'error', msg: 'server error' });
    }
  }

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (room) rooms.leave(room, ws).catch(err => console.error(err));
  });
});

// Drop sockets that stopped answering pings (sleeping laptops, dead networks).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

// Cloud Run sends SIGTERM before stopping an instance (deploys, scale-down). Save first, then close
// sockets with 1012 so clients reconnect to the next instance, which reads what we just saved.
// Exits by letting the event loop drain: process.exit() makes onnxruntime-node abort (exit 134) while
// its thread pool is alive. The unref'd timer is a fallback, inside Cloud Run's 10 s grace period.
async function shutdown() {
  clearInterval(heartbeat);
  server.close();
  await rooms.flushAll();
  for (const ws of wss.clients) ws.close(1012, 'restarting');
  await rooms.flushAll();
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('unhandledRejection', err => console.error('unhandled rejection:', err));
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

server.listen(PORT, () => console.log(`board server on :${PORT}${SERVE_WEB ? ` (serving ${WEB})` : ''}`));
