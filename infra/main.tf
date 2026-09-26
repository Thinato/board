# Q&A Board: one Cloud Run service (WebSocket server + embedding model) and a bucket of rooms.
# The static page is GitHub Pages (lisecki.dev/board/), outside this config.
#
# Shared project: mondo's Terraform owns the project, its APIs, the WIF pool and the budget alert.
# Everything here is board's own and named board-*, so applying or destroying it can't touch mondo.

data "google_project" "main" {
  project_id = var.project_id
}

locals {
  services = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # WIF token exchange
    "sts.googleapis.com",            # WIF token exchange
  ]
}

# Already enabled by mondo; declared so board stands up on its own in a fresh project.
# Never disabled on destroy: other apps use them.
resource "google_project_service" "services" {
  for_each = toset(local.services)

  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}

# ------------------------------------------------------------------------------
# Container images. Only the 3 newest are kept, to stay inside the 0.5 GB free tier.
# ------------------------------------------------------------------------------

resource "google_artifact_registry_repository" "board" {
  location      = var.region
  repository_id = "board"
  format        = "DOCKER"
  description   = "Q&A Board server images, pushed by CI."

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-newest-3"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "delete-the-rest"
    action = "DELETE"
    condition {
      tag_state = "ANY"
    }
  }

  depends_on = [google_project_service.services]
}

# ------------------------------------------------------------------------------
# Rooms: one JSON object per room. Rewritten at most every 5 s while a room is in use,
# so a room untouched for 90 days is one nobody has opened in 90 days: it is deleted.
# ------------------------------------------------------------------------------

resource "google_storage_bucket" "rooms" {
  name     = "${var.project_id}-board-rooms"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Each save overwrites the room. Soft delete would keep every overwritten copy for 7 days, billed.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.services]
}

# ------------------------------------------------------------------------------
# Runtime identity: read/write objects in the rooms bucket and nothing else.
# No project-level role, so it can't reach mondo's Firestore or anything else in the project.
# ------------------------------------------------------------------------------

resource "google_service_account" "server" {
  account_id   = "board-server"
  display_name = "Board server runtime"
  description  = "Runs the Q&A Board Cloud Run service. Rooms bucket only."
}

resource "google_storage_bucket_iam_member" "server_rooms" {
  bucket = google_storage_bucket.rooms.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.server.email}"
}

# ------------------------------------------------------------------------------
# The service. Terraform owns its shape; CI owns the image (it deploys a new one per push),
# the same split mondo makes between Terraform and the Firebase CLI.
#
# Cost (see mondo/docs/05-cost.md): scales to zero, never kept warm. Cloud Run bills while a
# WebSocket is open, so the page closes idle sockets and the 60-minute timeout ends forgotten ones.
# One instance holds every room in memory, so max is 1.
# ------------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "board" {
  name                = "board"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.server.email
    timeout                          = "3600s" # longest a WebSocket may stay open; clients reconnect
    session_affinity                 = true
    max_instance_request_concurrency = 1000

    scaling {
      min_instance_count = 0 # never set above 0: one warm instance costs more than the whole free tier
      max_instance_count = 1
    }

    containers {
      # Placeholder until CI's first deploy; ignored afterwards.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi" # ~420 MB with the model loaded
        }
        cpu_idle = true # CPU only while requests (sockets) are open
      }

      env {
        name  = "BUCKET"
        value = google_storage_bucket.rooms.name
      }
      env {
        name  = "ORIGINS"
        value = join(",", var.allowed_origins)
      }

      # Port open = started (the model loads in the background). Not an HTTP probe on a health path:
      # Cloud Run's front end reserves paths ending in z, so /healthz is easy to get wrong.
      startup_probe {
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
      scaling, # service-level block the API echoes back empty; instance limits live in template.scaling
    ]
  }

  depends_on = [google_project_service.services, google_storage_bucket_iam_member.server_rooms]
}

# Anyone can open the page; rooms are protected by their unguessable ids and mod keys.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.board.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ------------------------------------------------------------------------------
# CI: GitHub Actions deploys through Workload Identity Federation, no keys.
# A provider of its own in mondo's `github` pool, accepting only main-branch runs of this repo.
# ------------------------------------------------------------------------------

locals {
  pool = "projects/${data.google_project.main.number}/locations/global/workloadIdentityPools/github"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = "github"
  workload_identity_pool_provider_id = "github-board"
  display_name                       = "GitHub OIDC (board)"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Without a condition any GitHub repository could mint a token for this pool.
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "board-deployer"
  display_name = "Board CI deployer"
  description  = "Impersonated by GitHub Actions via WIF: pushes images and deploys the board service. Has no keys."
}

# Bound to the exact subject (this repo's main branch), not the whole repository: the pool is shared,
# so a looser provider added to it later still couldn't impersonate the deployer.
resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${local.pool}/subject/${var.github_subject_prefix}:ref:refs/heads/main"
}

# Scoped to board's own resources, not the project.
resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = var.region
  repository = google_artifact_registry_repository.board.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_deploy" {
  name     = google_cloud_run_v2_service.board.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_server" {
  service_account_id = google_service_account.server.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
