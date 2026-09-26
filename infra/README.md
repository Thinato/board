# Infrastructure

Terraform for board's part of the shared `lisecki-dev` project. It owns only board's resources:

| Resource | What for |
|---|---|
| Cloud Run `board` | WebSocket server + embedding model. 0 to 1 instance, 1 vCPU, 1 GiB, 60 min socket timeout |
| Bucket `lisecki-dev-board-rooms` | One JSON file per room, deleted after 90 days untouched |
| Artifact Registry `board` | Server images, 3 newest kept |
| Service accounts `board-server`, `board-deployer` | Runtime (bucket only) and CI (push + deploy board only) |
| WIF provider `github-board` | In mondo's `github` pool; accepts main-branch runs of `Thinato/board` only |

Mondo's Terraform owns the project, the WIF pool and the budget alert. Nothing here changes them:
`terraform plan` on a fresh state shows only additions.

Terraform owns the service's shape (memory, scaling, timeout, env); CI owns its image. After the first
apply the service runs Google's placeholder "hello" image until CI deploys.

## One-time setup

Needs your own login (`gcloud auth application-default login`) with owner rights on `lisecki-dev`.
State lives in mondo's state bucket under `board/state`.

```sh
cd infra
terraform init
terraform plan -out=tf.plan     # expect only additions
terraform apply tf.plan
```

Then give CI its three repository variables (identifiers, not secrets):

```sh
gh variable set GCP_PROJECT_ID   --repo Thinato/board --body lisecki-dev
gh variable set GCP_WIF_PROVIDER --repo Thinato/board --body "$(terraform output -raw wif_provider)"
gh variable set GCP_DEPLOYER_SA  --repo Thinato/board --body "$(terraform output -raw deployer_service_account)"
```

`SERVER` at the top of `web/app.js` is the service's deterministic URL,
`https://board-<project number>.southamerica-east1.run.app`; `terraform output service_uri` prints the
older alias of the same service.

## Cost

Meant to stay inside the free tier. Cloud Run bills while any socket is open, and the free tier
(180,000 vCPU-seconds a month, about 50 hours of this service) is shared with mondo's functions.
Guards: no warm instance (never set `min_instance_count` above 0), a 60-minute socket timeout, and pages
that disconnect when idle. Mondo's project budget alert fires at the first R$1 of spend.
