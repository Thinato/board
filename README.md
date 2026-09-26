# Q&A Board

Anonymous questions for meetings, a sli.do replacement: people post and upvote questions, moderators mark
them answered, group duplicates on a Figma-like board (with suggestions from a Brazilian Portuguese
embedding model), sort, and present them one at a time.

Served at **https://lisecki.dev/board/**.

## Rooms and roles

Anyone can create a room from the home page, no account needed. Creating one gives two links:

- **Participants:** `lisecki.dev/board/#r=<room>`. Ask and upvote, anonymously.
- **Moderators:** `…#r=<room>&k=<key>`. Everything else. Anyone holding this link can moderate, so share it with care.

Both are under **Share** in the moderator toolbar. The key sits in the URL fragment, so it never reaches a
server log. Rooms are deleted after 90 days without activity.

## How it fits together

```
web/       static page (GitHub Pages)  ──WebSocket──▶  server/  Node 22 on Cloud Run (southamerica-east1)
                                                        ├─ room state, one process, broadcast to every socket
                                                        ├─ Serafim 100m (8-bit), grouping + "similar question" hint
                                                        └─ rooms saved as JSON in a Cloud Storage bucket
infra/     Terraform for the Cloud Run service, bucket, image registry, CI identity
```

- The server is the only writer. The page sends ops (`ask`, `vote`, `drop`, …); `server/ops.js` checks the
  role and input, applies them, and the new room state goes to everyone.
- Votes are anonymous. Each browser keeps a random id; others only ever see a per-room hash of it.
- Idle tabs let go of their socket (hidden 5 min, or untouched 30 min when a connection drops), because
  Cloud Run bills while a socket is open.

## Run it locally

```sh
cd server
npm install
./setup-model.sh        # once: downloads and quantizes the model (~110 MB kept); skip it to use word match
npm start               # http://localhost:8080, rooms saved in server/data/
npm test
```

## Deploy

Pushes to `main` deploy themselves: `server/**` builds the image and rolls out Cloud Run
(`.github/workflows/server.yml`), and `web/**` publishes Pages (`.github/workflows/pages.yml`).
The one-time setup is in [infra/README.md](infra/README.md).

`slido.export.json` (a real meeting export for the Import Slido demo) is gitignored and must stay out of
this public repo.
