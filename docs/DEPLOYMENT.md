
Deployment Guide
Local Development
bash
# 1. Clone repository
git clone <repo-url>
cd devops-portfolio-project

# 2. Start services
docker compose up -d

# 3. Access services
#    Website: http://localhost:8888
#    Whoami:  http://localhost:8889
#    Redis:   localhost:6379
Production Deployment
Server Requirements:

Ubuntu 20.04+ LTS

2GB RAM minimum

20GB storage

Static IP address

Setup Script:

bash
#!/bin/bash
# production-setup.sh
apt update
apt install -y docker.io docker-compose git
git clone <repo-url> /opt/devops-project
cd /opt/devops-project
docker compose up -d
Monitoring Setup:

Configure health checks

Set up log rotation

Enable firewall (UFW)

Regular backups
