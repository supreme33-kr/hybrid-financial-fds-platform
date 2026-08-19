variable "aws_region" {
  description = "AWS Region for the hybrid FDS environment."
  type        = string
  default     = "ap-northeast-2"
}

variable "environment" {
  description = "Environment name used in resource tags."
  type        = string
  default     = "education"
}

variable "vpc_cidr" {
  description = "CIDR block for the AWS VPC. Must not overlap the On-Prem network."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "Availability zones used for subnet placement."
  type        = list(string)
  default     = ["ap-northeast-2a", "ap-northeast-2c"]
}

variable "onprem_cidr" {
  description = "On-Prem network CIDR reserved for a future VPN or Transit Gateway route. Confirm the actual prefix with the network owner before apply."
  type        = string
  default     = "10.1.93.0/24"
}

variable "transit_gateway_id" {
  description = "Optional Transit Gateway ID. Leave blank until the actual Hybrid connectivity method is approved."
  type        = string
  default     = ""
}
