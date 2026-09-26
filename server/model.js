// Loads the local Brazilian Portuguese sentence-embedding model (Transformers.js on onnxruntime-node)
// into Embed.backend. Needs ./setup-model.sh once (the Docker build runs it); otherwise word match stays.
const path = require('path');
const E = require('./embed.js');

const MODEL = 'serafim-100m';   // models/serafim-100m, 8-bit quantized by setup-model.sh
// Tuned on the ASSIN2 pt-BR benchmark + our Slido export (average-linkage grouping):
const THRESHOLD = 0.72;       // suggest groups: ASSIN2 matches 100% of duplicates, 94% of related, 25% of unrelated pairs
const HINT_THRESHOLD = 0.8;   // composer hint: fires for 2/20 Slido questions, catches typed paraphrases at 0.83-0.91

async function load() {
  try {
    E.backend.name = 'loading model…';
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;    // everything comes from ./models, nothing is fetched at runtime
    env.localModelPath = path.join(__dirname, 'models') + path.sep;
    const extract = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });

    // One text per run: the 8-bit model scales activations per batch, so batching would make a question's
    // vector depend on its batch-mates (seen: 0.716 vs 0.732 for the same pair). Runs are queued.
    let queue = Promise.resolve();
    const run = async texts => {
      const out = [];
      for (const t of texts) out.push(Float32Array.from((await extract(t, { pooling: 'mean', normalize: true })).data));
      return out;
    };
    Object.assign(E.backend, {
      name: 'Serafim',
      threshold: THRESHOLD,
      hintThreshold: HINT_THRESHOLD,
      embedMany: texts => (queue = queue.catch(() => {}).then(() => run(texts))),
    });
  } catch (err) {
    console.warn('Embedding model unavailable, using word match:', err.message);
    E.backend.name = 'word match';
  }
  return E.backend.name;
}

module.exports = { load };
