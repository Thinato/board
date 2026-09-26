output "service_uri" {
  description = "The WebSocket server (legacy alias; web/app.js uses board-<project number>.<region>.run.app, same service)."
  value       = google_cloud_run_v2_service.board.uri
}

output "image_repository" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.board.repository_id}"
}

output "wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  value = google_service_account.deployer.email
}

output "rooms_bucket" {
  value = google_storage_bucket.rooms.name
}
