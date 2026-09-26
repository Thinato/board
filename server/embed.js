// Similarity for the board. `backend` starts as the word-match mock below;
// model.js swaps in a real local embedding model when one is installed (see setup.sh).
(function () {
  const DIM = 1024;
  const THRESHOLD = 0.35;
  const STOP = new Set(`a an the is are was were be been being do does did doing i we you they it its this that these those
    of to in on for with and or but how what whats when where why who which will can could should would our my your their
    there any about from at by as us me so if not no have has had get going gonna just still also more much some next
    anything something theres im weve youre new now yet getting after again over
    o os um uma uns umas de da das dos em na nas nos para pra por pelo pela pelos pelas com sem que se e ou como qual
    quais quando onde quem ser sera seremos sao foi era esta estao estamos estar vai vamos vao isso isto esse essa esses
    essas este desse dessa desses dessas nesse nessa ao aos mais muito muita muitos tambem ja nao sim seu sua seus suas
    nosso nossa nossos voces voce eles elas ele ela tem temos ter ha hoje fato cada vez ainda entre sobre ate pode podemos`.split(/\s+/));
  const SYN = {
    wfh: 'remote', home: 'remote', hybrid: 'remote', office: 'remote', rto: 'remote', remotely: 'remote',
    pay: 'compensation', salary: 'compensation', salarie: 'compensation', raise: 'compensation',
    bonuse: 'compensation', bonus: 'compensation', comp: 'compensation',
    release: 'launch', ship: 'launch', shipp: 'launch', live: 'launch',
    delay: 'late', postpone: 'late',
    hire: 'hiring', headcount: 'hiring', recruit: 'hiring',
    // Portuguese (accent-folded, stemmed forms)
    aprender: 'conhecimento', aprendizado: 'conhecimento', meta: 'objetivo', estrategica: 'objetivo',
    feature: 'funcionalidade', casa: 'remote', remoto: 'remote', trabalhando: 'work', trabalho: 'work',
    salarial: 'compensation', aumento: 'compensation', remuneracao: 'compensation', revisao: 'review',
    lancado: 'launch', lancamento: 'launch', aplicativo: 'app', atrasou: 'late',
  };

  function stem(w) {
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  function tokens(text) {
    // Fold accents (confiança -> confianca) so Portuguese text survives the split.
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f'’]/g, '').split(/[^a-z0-9]+/)
      .filter(w => w && !STOP.has(w))
      .map(w => SYN[w] || SYN[stem(w)] || stem(w));
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) % DIM;
  }

  function embed(text) {
    const v = new Float32Array(DIM);
    for (const t of tokens(text)) v[hash(t)] += 1;
    const n = Math.hypot(...v) || 1;
    return v.map(x => x / n);
  }

  // Cosine similarity of two normalized vectors.
  function similarity(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // Active backend: async so a real model can replace it without touching callers.
  // threshold: suggest grouping; hintThreshold: "similar question already asked" (stricter, it compares against everything).
  const backend = { name: 'word match', threshold: THRESHOLD, hintThreshold: THRESHOLD, embedMany: async texts => texts.map(embed) };

  // items: [{id, text}], vecs: one vector per item -> [[id, id, ...], ...] (clusters of 2+)
  // Average-linkage agglomerative: repeatedly merge the two clusters whose members are most similar
  // on average, while that average is >= threshold. Unlike "any pair links", this doesn't chain
  // a whole session of loosely related questions into one blob.
  // apart(idA, idB) -> true for pairs a moderator said don't belong together; they never end up in one cluster.
  // ponytail: naive O(n³), fine for a few hundred questions; use a proper HAC/ANN library beyond that.
  function cluster(items, vecs = items.map(q => embed(q.text)), threshold = THRESHOLD, apart = () => false) {
    const sim = vecs.map(a => vecs.map(b => similarity(a, b)));
    const groups = items.map((_, i) => [i]);
    const avg = (g, h) => g.reduce((s, a) => s + h.reduce((t, b) => t + sim[a][b], 0), 0) / (g.length * h.length);
    const blocked = (g, h) => g.some(a => h.some(b => apart(items[a].id, items[b].id)));
    for (;;) {
      let best = threshold, bi = -1, bj = -1;
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++) {
          const s = avg(groups[i], groups[j]);
          if (s >= best && !blocked(groups[i], groups[j])) [best, bi, bj] = [s, i, j];
        }
      if (bi < 0) break;
      groups[bi].push(...groups.splice(bj, 1)[0]);
    }
    return groups.filter(g => g.length > 1).map(g => g.map(i => items[i].id));
  }

  // Demo questions (pt-BR): 3 duplicate clusters (home office, salary, app launch) + 3 singles.
  // Grouped correctly by both the local model and this mock; embed.test.js checks the mock.
  const DEMO = [
    'Vamos continuar em home office no ano que vem?',
    'Vamos poder continuar trabalhando de casa?',
    'O home office vai continuar depois da reestruturação?',
    'Quando acontece a revisão salarial deste ano?',
    'Vamos ter aumento ou bônus este ano?',
    'Alguma novidade sobre o ciclo de revisão de remuneração?',
    'Quando o novo aplicativo vai ser lançado?',
    'Qual a data de lançamento do app mobile?',
    'O lançamento do app atrasou de novo?',
    'Como vai funcionar o plantão durante as festas de fim de ano?',
    'Dá pra melhorar o café da copa?',
    'Quem é o responsável pelo design system agora?',
  ];

  const api = { embed, similarity, cluster, tokens, backend, THRESHOLD, DEMO };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Embed = api;
})();
