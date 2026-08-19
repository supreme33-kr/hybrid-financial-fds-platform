data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "fds" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "financial-fds-vpc"
  }
}

resource "aws_internet_gateway" "fds" {
  vpc_id = aws_vpc.fds.id

  tags = {
    Name = "financial-fds-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.fds.id
  cidr_block              = "10.20.10.0/24"
  availability_zone       = var.availability_zones[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "financial-fds-public-${var.availability_zones[0]}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count             = length(var.availability_zones)
  vpc_id            = aws_vpc.fds.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 20 + count.index)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "financial-fds-private-${var.availability_zones[count.index]}"
    Tier = "private"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.fds.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.fds.id
  }

  tags = {
    Name = "financial-fds-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(var.availability_zones)
  vpc_id = aws_vpc.fds.id

  tags = {
    Name = "financial-fds-private-rt-${count.index + 1}"
  }
}

resource "aws_route_table_association" "private" {
  count          = length(var.availability_zones)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route" "private_to_onprem" {
  count                  = var.transit_gateway_id == "" ? 0 : length(aws_route_table.private)
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = var.onprem_cidr
  transit_gateway_id     = var.transit_gateway_id
}

resource "aws_security_group" "fds_api" {
  name        = "financial-fds-api"
  description = "Ingress for the FDS API is limited to the approved On-Prem network."
  vpc_id      = aws_vpc.fds.id

  ingress {
    description = "HTTPS from On-Prem network"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.onprem_cidr]
  }

  egress {
    description = "Allow egress; further restrict after ROSA and Hybrid design are approved."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "financial-fds-api-sg"
  }
}
