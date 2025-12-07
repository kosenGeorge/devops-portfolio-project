# 🚀 DevOps Portfolio Project: Production Docker Stack

![Docker](https://img.shields.io/badge/Docker-29.1.2-blue)
![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04%20LTS-orange)
![Nginx](https://img.shields.io/badge/Nginx-1.24-green)
![License](https://img.shields.io/badge/License-MIT-green)

A production-ready multi-service Docker stack deployed on Ubuntu Server, featuring Nginx, Redis, and comprehensive monitoring. This project demonstrates real-world DevOps skills and problem-solving abilities.

## 📋 Features

- **🐳 Multi-container architecture** with Docker Compose
- **🌐 Nginx web server** with custom configuration
- **🗄️ Redis database** with persistence
- **🔍 Whoami service** for container monitoring
- **✅ Health checks** and auto-restart policies
- **📊 Monitoring scripts** with real-time status
- **🔧 Management interface** for easy administration
- **📝 Complete documentation** in Russian and English

## 🏗️ Architecture
┌─────────────────────────────────────────────────┐
│ Production Docker Stack │
├─────────────────────────────────────────────────┤
│ 🌐 Nginx:8888 - Web server with portfolio │
│ 🔍 Whoami:8889 - Container info service │
│ 🗄️ Redis:6379 - In-memory database │
│ 🔗 devops-net - Docker bridge network │
└─────────────────────────────────────────────────┘

text

## 🚀 Quick Start

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+

### Deployment
```bash
# Clone the repository
git clone https://github.com/kosenGeorge/devops-portfolio-project.git
cd devops-portfolio-project

# Start all services
docker compose up -d

# Check status
./manage.sh
📁 Project Structure
text
devops-portfolio-project/
├── docker-compose.yml    # Multi-service configuration
├── Dockerfile           # Custom Nginx image
├── README.md           # Project documentation
├── manage.sh           # Management interface
├── .gitignore          # Git ignore rules
└── screenshots/        # Project screenshots
🔧 Services Overview
ServicePortPurposeStatus
Nginx8888Web server with portfolio site✅ Production-ready
Whoami8889Container information service✅ Active
Redis6379In-memory key-value store✅ With persistence
🛠️ Technologies Used
Infrastructure: Ubuntu Server 24.04 LTS

Containerization: Docker 29.1.2, Docker Compose

Web Server: Nginx 1.24 with custom config

Database: Redis 7.2 (alpine)

Monitoring: Custom bash scripts, health checks

Networking: Docker bridge networks, port mapping

Automation: Bash scripting, Git

📈 Monitoring & Management
The project includes a comprehensive management system:

bash
# Interactive management interface
./manage.sh

# Or use direct commands:
docker compose ps          # Check service status
docker compose logs -f     # View real-time logs
docker compose exec redis redis-cli monitor  # Monitor Redis
🎯 Learning Outcomes
This project demonstrates practical skills in:

Linux System Administration - Ubuntu Server setup and management

Docker & Containerization - Multi-service architecture

Web Server Configuration - Nginx setup and optimization

Database Management - Redis configuration and persistence

Networking - Docker networks and port mapping

Problem Solving - Debugging and fixing real issues (403 errors)

Automation - Scripting and process automation

Documentation - Professional project documentation

🐛 Real Problem Solved: 403 Forbidden Error
During development, encountered and resolved a 403 Forbidden error in Nginx by:

Analyzing Nginx error logs

Correcting file permissions and ownership

Adjusting Docker volume configurations

Implementing proper health checks

👨‍💻 Author
Egor Kosenkov - Aspiring DevOps Engineer

📧 Email: kosenkovegor01@gmail.com

🐙 GitHub: kosenGeorge

💼 LinkedIn: [Your LinkedIn Profile]

📝 License
This project is licensed under the MIT License - see the LICENSE file for details.

🙏 Acknowledgments
This project was developed as part of a practical DevOps learning journey

Special thanks to the Docker and Ubuntu communities for excellent documentation

Inspired by real-world production infrastructure patterns
