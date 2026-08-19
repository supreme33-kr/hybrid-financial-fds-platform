output "vpc_id" {
  value       = aws_vpc.fds.id
  description = "Financial FDS VPC ID."
}

output "public_subnet_id" {
  value       = aws_subnet.public.id
  description = "Public subnet ID."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs for ROSA or other approved compute resources."
}

output "fds_api_security_group_id" {
  value       = aws_security_group.fds_api.id
  description = "Security group ID for FDS API ingress."
}
