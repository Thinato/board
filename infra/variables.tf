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

variable "allowed_origins" {
  description = "Browser origins allowed to create rooms and open sockets (localhost is always allowed, for development)."
  type        = list(string)
  default     = ["https://lisecki.dev"]
}
