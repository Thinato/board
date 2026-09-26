const test = require('node:test');
const assert = require('assert');
const { apply, emptyState, OPS } = require('../ops.js');

const mod = { role: 'mod', me: 'm' }, guest = { role: 'participant', me: 'p' };
const ask = (s, text, ctx = guest) => apply(s, 'ask', { text }, ctx);
const idOf = (s, text) => Object.values(s.questions).find(q => q.text === text).id;

test('participants can only ask and vote', () => {
  const s = emptyState();
  ask(s, 'one'); ask(s, 'two');
  const [a, b] = Object.keys(s.questions);
  const before = JSON.stringify(s);
  const args = { ids: [a], answered: true, id: a, target: { id: b }, pos: { x: 1, y: 1 }, gid: a, title: 'x',
    slot: { x: 0, y: 0 }, items: [{ text: 'x' }], pairs: [[a, b]] };
  const modOps = Object.keys(OPS).filter(op => OPS[op].mod);
  assert.deepStrictEqual(modOps.sort(), ['add', 'answer', 'apart', 'clear', 'demo', 'drop', 'group', 'layout', 'moveGroup', 'rename', 'unapart']);
  for (const op of modOps) assert.deepStrictEqual(apply(s, op, args, guest), { ok: false, error: 'moderators only' }, op);
  assert.strictEqual(JSON.stringify(s), before, 'nothing changed');
});

test('ask validates text and places cards apart', () => {
  const s = emptyState();
  assert.strictEqual(ask(s, '   ').ok, false);
  assert.strictEqual(ask(s, 'x'.repeat(201)).ok, false);
  assert.strictEqual(ask(s, { text: 'obj' }).ok, false);
  ask(s, '  first  '); ask(s, 'second');
  const [q1, q2] = Object.values(s.questions);
  assert.strictEqual(q1.text, 'first');
  assert.notDeepStrictEqual([q1.x, q1.y], [q2.x, q2.y]);
});

test('votes toggle per voter; on:true only adds', () => {
  const s = emptyState();
  ask(s, 'q');
  const id = idOf(s, 'q');
  apply(s, 'vote', { id }, guest);
  apply(s, 'vote', { id }, mod);
  assert.deepStrictEqual(s.questions[id].voters, ['p', 'm']);
  apply(s, 'vote', { id }, guest);
  assert.deepStrictEqual(s.questions[id].voters, ['m']);
  apply(s, 'vote', { id, on: true }, mod);
  assert.deepStrictEqual(s.questions[id].voters, ['m']);
  assert.strictEqual(apply(s, 'vote', { id: 'nope' }, guest).ok, false);
});

test('drop groups cards, and a group of one dissolves', () => {
  const s = emptyState();
  ask(s, 'a'); ask(s, 'b'); ask(s, 'c');
  const [a, b, c] = ['a', 'b', 'c'].map(t => idOf(s, t));
  apply(s, 'drop', { id: a, target: { id: b }, pos: { x: 0, y: 0 } }, mod);
  const gid = s.questions[a].groupId;
  assert.ok(gid && s.questions[b].groupId === gid && s.groups[gid]);
  apply(s, 'drop', { id: c, target: { gid }, pos: { x: 0, y: 0 } }, mod);
  apply(s, 'drop', { id: a, target: null, pos: { x: 500, y: 600 } }, mod);
  assert.deepStrictEqual([s.questions[a].groupId, s.questions[a].x, s.questions[a].y], [null, 500, 600]);
  assert.ok(s.groups[gid], 'b and c still grouped');
  apply(s, 'drop', { id: b, target: null, pos: { x: 0, y: 0 } }, mod);
  assert.strictEqual(s.groups[gid], undefined);
  assert.strictEqual(s.questions[c].groupId, null);
  assert.strictEqual(apply(s, 'drop', { id: a, target: null, pos: { x: NaN, y: 0 } }, mod).ok, false);
});

test('group, answer, rename, layout, clear', () => {
  const s = emptyState();
  ask(s, 'a'); ask(s, 'b');
  const [a, b] = ['a', 'b'].map(t => idOf(s, t));
  assert.strictEqual(apply(s, 'group', { ids: [a], slot: { x: 0, y: 0 } }, mod).ok, false);
  apply(s, 'group', { ids: [a, b], slot: { x: 7, y: 8 } }, mod);
  const gid = s.questions[a].groupId;
  assert.deepStrictEqual([s.groups[gid].x, s.groups[gid].y], [7, 8]);
  apply(s, 'rename', { gid, title: '  Salary  ' }, mod);
  assert.strictEqual(s.groups[gid].title, 'Salary');
  apply(s, 'rename', { gid, title: '' }, mod);
  assert.strictEqual(s.groups[gid].title, null);
  apply(s, 'answer', { ids: [a, b], answered: true }, mod);
  assert.ok(s.questions[a].answered && s.questions[b].answered);
  apply(s, 'layout', { pos: { [gid]: { x: 300, y: 0 }, ghost: { x: 1, y: 1 } } }, mod);
  assert.strictEqual(s.groups[gid].x, 300);
  apply(s, 'clear', {}, mod);
  assert.deepStrictEqual(s, emptyState());
});

test('add imports once, with placeholder votes; apart pairs dedupe', () => {
  const s = emptyState();
  const items = [{ id: 'slido-1', text: 'Imported', votes: 3, answered: true, createdAt: 5 }, { text: 'No id' }];
  assert.deepStrictEqual(apply(s, 'add', { items }, mod).reply, { added: 2, total: 2 });
  assert.deepStrictEqual(apply(s, 'add', { items: items.slice(0, 1) }, mod).reply, { added: 0, total: 1 });
  const q = s.questions['slido-1'];
  assert.deepStrictEqual([q.voters, q.imported, q.answered, q.createdAt], [[], 3, true, 5]);
  assert.strictEqual(apply(s, 'add', { items: [{ id: '../x', text: 't' }] }, mod).ok, false);
  const other = idOf(s, 'No id');
  apply(s, 'apart', { pairs: [[other, 'slido-1'], ['slido-1', other], ['slido-1', 'slido-1'], ['ghost', 'slido-1'], ['x'.repeat(5000), other]] }, mod);
  assert.deepStrictEqual(s.apart, [[other, 'slido-1'].sort().join('|')], 'only real, distinct question pairs');
  apply(s, 'unapart', {}, mod);
  assert.deepStrictEqual(s.apart, []);
});

test('unknown ops and prototype keys are rejected', () => {
  const s = emptyState();
  assert.strictEqual(apply(s, 'constructor', {}, mod).ok, false);
  assert.strictEqual(apply(s, 'nope', {}, mod).ok, false);
});

test('__proto__ ids never reach Object.prototype', () => {
  const s = emptyState();
  ask(s, 'a'); ask(s, 'b');
  const [a, b] = ['a', 'b'].map(t => idOf(s, t));
  const tries = [
    ['answer', { ids: ['__proto__'], answered: true }],
    ['rename', { gid: '__proto__', title: 'pwned' }],
    ['moveGroup', { id: '__proto__', pos: { x: 1, y: 2 } }],
    ['layout', { pos: JSON.parse('{"__proto__": {"x": 1, "y": 2}}') }],
    ['drop', { id: a, target: { id: '__proto__' }, pos: { x: 0, y: 0 } }],
    ['drop', { id: a, target: { gid: '__proto__' }, pos: { x: 0, y: 0 } }],
    ['vote', { id: '__proto__' }],
    ['add', { items: [{ id: '__proto__', text: 'x' }] }],
    ['group', { ids: ['__proto__', b], slot: { x: 0, y: 0 } }],
  ];
  for (const [op, args] of tries) apply(s, op, args, mod);
  for (const k of ['answered', 'title', 'x', 'y', 'groupId']) assert.strictEqual(({})[k], undefined, k);
  assert.strictEqual(Object.getPrototypeOf(s.questions), Object.prototype);
});

test('rooms are capped at MAX_QUESTIONS', () => {
  const { MAX_QUESTIONS } = require('../ops.js');
  const s = emptyState();
  const items = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ text: `q${i}` }));
  assert.strictEqual(apply(s, 'add', { items }, mod).reply.added, MAX_QUESTIONS);
  assert.deepStrictEqual(ask(s, 'one more'), { ok: false, error: 'room is full' });
});
