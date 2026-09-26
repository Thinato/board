// Room persistence: one JSON document per room. Cloud Storage when BUCKET is set, ./data otherwise.
const fs = require('fs/promises');
const path = require('path');

const ROOM_ID = /^[\w-]{8,32}$/;
const check = id => { if (!ROOM_ID.test(id)) throw new Error('bad room id'); return id; };

function bucketStore(name) {
  const { Storage } = require('@google-cloud/storage');
  const bucket = new Storage().bucket(name);
  const file = id => bucket.file(`rooms/${check(id)}.json`);
  return {
    async read(id) {
      try { return JSON.parse((await file(id).download())[0]); }
      catch (err) { if (err.code === 404) return null; throw err; }
    },
    write: (id, doc) => file(id).save(JSON.stringify(doc), { contentType: 'application/json', resumable: false }),
  };
}

function dirStore(dir) {
  const file = id => path.join(dir, `${check(id)}.json`);
  return {
    async read(id) {
      try { return JSON.parse(await fs.readFile(file(id), 'utf8')); }
      catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    },
    async write(id, doc) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(id) + '.tmp', JSON.stringify(doc));
      await fs.rename(file(id) + '.tmp', file(id)); // atomic: a crash never leaves half a room
    },
  };
}

module.exports = {
  ROOM_ID,
  open: () => (process.env.BUCKET ? bucketStore(process.env.BUCKET) : dirStore(process.env.DATA_DIR || path.join(__dirname, 'data'))),
};
