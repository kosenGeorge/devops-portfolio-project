
Architecture Documentation
System Design
1. Network Architecture
text
Internet → Router (192.168.0.1) → Ubuntu Server (192.168.0.43)
                                     ↓
                            Docker Containers:
                            - Nginx:8888 (Web)
                            - Whoami:8889 (Monitoring)
                            - Redis:6379 (Database)
2. Docker Network
Network Name: devops-net

Type: Bridge

Subnet: 172.20.0.0/16

Services communicate internally via service names

3. Data Flow
User accesses http://192.168.0.43:8888

Nginx serves static HTML/CSS/JS

Health checks run every 30 seconds

Redis stores session/data (if implemented)

Whoami provides container metadata
