variable "project_id" {
  description = "Shared lisecki.dev project. Owned by mondo's Terraform; board is a tenant and never manages the project itself."
  type        = string
  default     = "lisecki-dev"
}

variable "region" {
  description = "Same region as the rest of lisecki.dev: close to the people in the meetings."
  type        = string
  default     = "southamerica-east1"
}

variable "github_repository" {
  description = "owner/repo whose main-branch workflows may deploy. Nothing else can."
  type        = string
  default     = "Thinato/board"
}

# GitHub's immutable OIDC subject for this repo (owner and repo ids included), so a deleted and
# re-created repo with the same name can't deploy: gh api repos/Thinato/board/actions/oidc/customization/sub
variable "github_subject_prefix" {
  description = "OIDC `sub` prefix of the repo, as GitHub issues it (sub_claim_prefix)."
  type        = string
  default     = "repo:Thinato@39924528/board@1389396087"
}

variable "allowed_origins" {
  description = "Browser origins allowed to create rooms and open sockets (localhost is always allowed, for development)."
  type        = list(string)
  default     = ["https://lisecki.dev"]
}
