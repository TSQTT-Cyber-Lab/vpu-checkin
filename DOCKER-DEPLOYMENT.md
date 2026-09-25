# VPU Điểm Danh - Docker Deployment Guide

**Phiên bản:** 1.0  
**Cập nhật:** 2026-09-17  
**Hỗ trợ:** Docker & Docker Compose

## 📋 Mục Lục

1. [Yêu Cầu Hệ Thống](#yêu-cầu-hệ-thống)
2. [Quick Start (3 phút)](#quick-start-3-phút)
3. [Cấu Hình Chi Tiết](#cấu-hình-chi-tiết)
4. [Deployment Options](#deployment-options)
5. [Sản Xuất (Production)](#sản-xuất-production)
6. [Monitoring & Logs](#monitoring--logs)
7. [Backup & Restore](#backup--restore)
8. [Troubleshooting](#troubleshooting)

---

## 🔧 Yêu Cầu Hệ Thống

### Docker Tối thiểu
- **Docker:** v20.10+
- **Docker Compose:** v1.29+
- **Disk Space:** 2 GB (cho image + data)
- **Memory:** 1 GB minimum (khuyên 2+ GB)

### Hệ Điều Hành
- ✅ Linux (Ubuntu, Debian, CentOS, etc.)
- ✅ macOS (Intel & Apple Silicon)
- ✅ Windows (Windows Pro/Enterprise + WSL2)

### Port Requirements
- **3000:** Application port (web interface)
- **5432:** PostgreSQL port (nếu dùng)
- **5050:** pgAdmin port (debug mode)
- **80/443:** Nginx reverse proxy (production mode)

---

## 🚀 Quick Start (3 phút)

### 1. Chuẩn bị

```bash
# Clone hoặc tải source code
cd vpu-checkin

# Copy environment file
cp .env.example .env

# (Optional) Edit .env với cấu hình của bạn
nano .env
```

### 2. Khởi động Docker

```bash
# Build image lần đầu
docker-compose build

# Khởi động services (chạy background)
docker-compose up -d

# Kiểm tra status
docker-compose ps
```

### 3. Truy cập Ứng dụng

```
http://localhost:3000
```

**Tài khoản test:**
- Email: `son.pt@tbd.edu.vn` (trong context claude.ai)
- Role: Admin (nếu trong danh sách invite)

### 4. Dừng Services

```bash
docker-compose down
```

---

## ⚙️ Cấu Hình Chi Tiết

### Environment Variables (.env)

```bash
# ============== Application ==============
PORT=3000
NODE_ENV=production
BASE_URL=http://localhost:3000

# ============== Security ==============
AUTH_SECRET=your-secure-random-string-here

# ============== Database ==============
DB_TYPE=postgres
DATABASE_URL=postgresql://vpu_admin:password@db:5432/vpu_checkin
DB_PASSWORD=change_me_in_production

# ============== Google OAuth (optional) ==============
GOOGLE_CLIENT_ID=your-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# ============== Debug (tùy chọn) ==============
PGADMIN_EMAIL=admin@example.com
PGADMIN_PASSWORD=change_me
PGADMIN_PORT=5050
```

### Thay đổi .env

```bash
# Dừng services
docker-compose down

# Chỉnh sửa .env
nano .env

# Khởi động lại
docker-compose up -d
```

---

## Deployment Options

### Option 1: Lightweight (Ứng dụng + SQLite)

**Phù hợp:** Testing, small deployments

```bash
# Không cần .env modification
docker-compose up -d app
```

### Option 2: Full Stack (App + PostgreSQL)

**Phù hợp:** Production, multi-user

```bash
# Chỉnh sửa .env với DB credentials
docker-compose up -d
```

### Option 3: Debug Mode (+ pgAdmin)

**Phù hợp:** Development, database inspection

```bash
# Thêm --profile debug
docker-compose --profile debug up -d

# Truy cập pgAdmin
http://localhost:5050
# Email: admin@example.com
# Password: change_me
```

### Option 4: Production (+ Nginx Reverse Proxy)

**Phù hợp:** Production deployment, SSL/TLS

```bash
# Thêm --profile production
docker-compose --profile production up -d

# Truy cập application
http://localhost:80 (Nginx)
```

---

## 🏢 Sản Xuất (Production)

### 1. Chuẩn bị Production .env

```bash
# Tạo secure AUTH_SECRET
openssl rand -base64 32

# Cập nhật .env
cat > .env << 'EOF'
PORT=3000
NODE_ENV=production
BASE_URL=https://your-domain.com

AUTH_SECRET=<generated-secure-string>

DATABASE_URL=postgresql://vpu_admin:strong_password@db:5432/vpu_checkin
DB_PASSWORD=strong_password

GOOGLE_CLIENT_ID=your-production-id
GOOGLE_CLIENT_SECRET=your-production-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/callback
EOF
```

### 2. SSL/TLS Setup (HTTPS)

#### Option A: Let's Encrypt

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone -d your-domain.com

# Update nginx.conf
# Uncomment SSL section, update paths:
# ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem
# ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem

# Mount certs in docker-compose.yml
volumes:
  - /etc/letsencrypt:/etc/nginx/ssl:ro
```

#### Option B: Self-signed (Testing only)

```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem -out ssl/cert.pem

# Update nginx.conf SSL section
```

### 3. Deploy to VPS

```bash
# SSH vào VPS
ssh user@your-vps.com

# Cài Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone repository
git clone <repository-url> vpu-checkin
cd vpu-checkin

# Setup .env
cp .env.example .env
nano .env  # Edit with production values

# Start with production profile
docker-compose --profile production up -d

# Verify
docker-compose ps
```

### 4. Domain Setup (DNS)

```
Type: A Record
Name: your-domain.com (or subdomain)
Value: <VPS-IP-Address>

# Verify DNS propagation
nslookup your-domain.com
```

### 5. Firewall & Security

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow SSH
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### 6. Auto-renewal (SSL Certificate)

```bash
# Set up cron job for Let's Encrypt renewal
sudo crontab -e

# Add line:
0 0 1 * * certbot renew --quiet && docker-compose -f /home/user/vpu-checkin/docker-compose.yml restart nginx
```

---

## 📊 Monitoring & Logs

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
docker-compose logs -f db

# Last 100 lines
docker-compose logs --tail=100 app

# Filter by time
docker-compose logs --since 10m app
```

### Docker Stats (Real-time Resource Usage)

```bash
# Monitor all containers
docker stats

# Specific container
docker stats vpu-checkin-app vpu-checkin-db
```

### Health Check

```bash
# Check service status
docker-compose ps

# Detailed inspection
docker inspect vpu-checkin-app | grep -A 20 '"Health"'
```

### Performance Tuning

```bash
# View resource limits
docker inspect vpu-checkin-app | grep -i -E '"cpus"|"memory"'

# Adjust in docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 512M
        reservations:
          cpus: '1'
          memory: 256M
```

---

## 💾 Backup & Restore

### Database Backup

**PostgreSQL:**
```bash
# Backup database
docker-compose exec db pg_dump -U vpu_admin vpu_checkin > backup-$(date +%Y%m%d).sql

# Compressed backup
docker-compose exec db pg_dump -U vpu_admin vpu_checkin | gzip > backup-$(date +%Y%m%d).sql.gz

# List backups
ls -lh backup-*.sql*
```

**SQLite:**
```bash
# Backup database file
docker-compose exec app cp data/db.sqlite data/db.sqlite.backup-$(date +%Y%m%d)

# Or from host
cp data/db.sqlite data/db.sqlite.backup-$(date +%Y%m%d)
```

### Files Backup

```bash
# Backup data volume
docker-compose exec app tar czf - data/ | gzip > data-backup-$(date +%Y%m%d).tar.gz

# Backup entire directory
tar czf vpu-checkin-backup-$(date +%Y%m%d).tar.gz .
```

### Database Restore

**PostgreSQL:**
```bash
# Restore from backup
docker-compose exec -T db psql -U vpu_admin vpu_checkin < backup-20260917.sql

# Restore from compressed backup
gunzip -c backup-20260917.sql.gz | docker-compose exec -T db psql -U vpu_admin vpu_checkin
```

**SQLite:**
```bash
# Restore database
docker-compose exec app cp data/db.sqlite.backup-20260917 data/db.sqlite
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /home/user/vpu-checkin && docker-compose exec -T db pg_dump -U vpu_admin vpu_checkin | gzip > backups/backup-$(date +\%Y\%m\%d).sql.gz

# Weekly backup compression
0 3 * * 0 cd /home/user/vpu-checkin/backups && tar czf backup-$(date +\%Y\%m\%d).tar.gz *.sql.gz && rm backup-20260910.sql.gz 2>/dev/null
```

---

## 🔴 Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -i :3000

# Kill process (if needed)
kill -9 <PID>

# Or change port in .env
PORT=3001
docker-compose down && docker-compose up -d
```

### Database Connection Error

```bash
# Check database is running
docker-compose ps db

# View database logs
docker-compose logs db

# Restart database
docker-compose restart db

# Check connection
docker-compose exec app nc -zv db 5432
```

### Out of Disk Space

```bash
# Check disk usage
docker system df

# Clean up unused images
docker image prune -a

# Clean up unused volumes
docker volume prune

# Clean up stopped containers
docker container prune
```

### High Memory Usage

```bash
# Check memory limits
docker stats

# Reduce memory in docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 256M  # Reduced from 512M
```

### Application Crashes on Startup

```bash
# Check logs
docker-compose logs app

# Rebuild image
docker-compose build --no-cache

# Start with verbose logging
docker-compose up app
```

### Geolocation/GPS Not Working

```bash
# Ensure HTTPS in production
# Or localhost in development

# Check browser console
docker-compose exec app nc -zv localhost 3000
```

### Google OAuth Not Working

```bash
# Verify credentials in .env
echo $GOOGLE_CLIENT_ID

# Check redirect URI matches in Google Console
# Local: http://localhost:3000/auth/callback
# Production: https://your-domain.com/auth/callback
```

### Database Migration Issues

```bash
# Check migrations exist
docker-compose exec app ls -la migrations/

# Run migrations manually
docker-compose exec app npm run migrate

# View migration status
docker-compose exec app npm run migrate:status
```

---

## 🔒 Security Best Practices

### 1. Use Strong Passwords

```bash
# Generate secure password
openssl rand -base64 32

# Update in .env
DB_PASSWORD=<generated-password>
PGADMIN_PASSWORD=<generated-password>
AUTH_SECRET=<generated-password>
```

### 2. Disable pgAdmin in Production

```bash
# Remove pgAdmin from docker-compose.yml
# Or don't use --profile debug

# If exposed by accident, restrict access
# Update nginx.conf to require auth
location /pgadmin {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### 3. Enable HTTPS Only

```bash
# Redirect HTTP to HTTPS (nginx.conf)
server {
    listen 80;
    return 301 https://$host$request_uri;
}
```

### 4. Regular Updates

```bash
# Check for updates
docker pull node:18-alpine
docker pull postgres:15-alpine

# Rebuild images
docker-compose build --no-cache

# Restart services
docker-compose restart
```

### 5. Monitor & Audit

```bash
# Enable audit logging
docker-compose logs -f > logs/audit.log &

# Regular security checks
docker-compose exec db psql -U vpu_admin -c "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100;"
```

---

## 📈 Scaling & Performance

### Horizontal Scaling

```yaml
# Multiple app instances with load balancer
services:
  app1:
    build: .
    port: 3001
  app2:
    build: .
    port: 3002
  
  nginx:
    upstream vpu_app {
      server app1:3000;
      server app2:3000;
    }
```

### Vertical Scaling (More Resources)

```bash
# Allocate more CPU/Memory
docker update --cpus="2.0" --memory="1024m" vpu-checkin-app
docker restart vpu-checkin-app
```

### Caching Layer (Redis)

```yaml
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    networks:
      - vpu-network

# Update .env
REDIS_URL=redis://redis:6379
```

---

## 🆘 Support & Maintenance

### Regular Maintenance Tasks

```bash
# Weekly: Database vacuum
docker-compose exec db vacuumdb -U vpu_admin vpu_checkin

# Monthly: Security updates
docker-compose down
docker pull node:18-alpine
docker pull postgres:15-alpine
docker-compose build --no-cache
docker-compose up -d

# Quarterly: Database optimization
docker-compose exec db reindexdb -U vpu_admin vpu_checkin
```

### Monitoring Services

```bash
# Install monitoring stack (optional)
# Using Prometheus + Grafana

docker-compose --profile monitoring up -d

# Access Grafana
http://localhost:3001
```

### Getting Help

- 📧 Email: son.pt@tbd.edu.vn
- 📚 Documentation: INSTALLATION.md, README.md
- 🐛 Issues: Check Docker logs first
- 💬 Community: Tìm support từ Docker community

---

## 📝 Changelog

### v1.0 (2026-09-17)
- ✅ Docker & Docker Compose support
- ✅ PostgreSQL + SQLite options
- ✅ Nginx reverse proxy configuration
- ✅ SSL/TLS support (Let's Encrypt ready)
- ✅ Health checks & monitoring
- ✅ Automated backup scripts
- ✅ Production-ready deployment guide
