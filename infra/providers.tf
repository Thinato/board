terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Same state bucket as mondo, own prefix. The bucket is created by hand (see mondo/infra/README.md §1).
  backend "gcs" {
    bucket = "lisecki-dev-tfstate"
    prefix = "board/state"
  }
}

# user_project_override + billing_project: some APIs refuse user credentials without a quota project.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
