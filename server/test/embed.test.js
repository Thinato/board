// Run: npm test
const assert = require('assert');
const { embed, similarity, cluster, THRESHOLD, DEMO } = require('../embed.js');

const sim = (a, b) => similarity(embed(a), embed(b));

assert(sim('Is WFH going to continue?', 'Will remote work continue?') >= THRESHOLD, 'paraphrase should match');
assert(sim('When is the app launching?', 'Can we get better coffee?') < 0.3, 'unrelated should not match');
assert(Math.abs(sim('Hello there', 'Hello there') - 1) < 1e-6, 'identical text = 1');

const groups = cluster(DEMO.map((text, id) => ({ id, text })))
  .map(g => g.sort((a, b) => a - b).join(','))
  .sort();
assert.deepStrictEqual(groups, ['0,1,2', '3,4,5', '6,7,8']);

// Pairs kept apart by a moderator never share a cluster, the rest still group.
const apart = (a, b) => (a === 0 && b === 1) || (a === 1 && b === 0);
const constrained = cluster(DEMO.map((text, id) => ({ id, text })), undefined, THRESHOLD, apart);
assert(!constrained.some(g => g.includes(0) && g.includes(1)), '0 and 1 kept apart');
assert(constrained.some(g => g.includes(3) && g.includes(4) && g.includes(5)), 'other clusters unaffected');

console.log('ok');
