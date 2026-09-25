# VPU Điểm Danh - Deployment Checklist

**Ngày**: 2026-09-17  
**Version**: 1.0  
**Mục đích**: Đảm bảo deployment hoàn chỉnh và an toàn

---

## 📋 Pre-Deployment

### Local Setup
- [ ] Clone/extract vpu-checkin source code
- [ ] Verify Node.js v18+ installed
- [ ] Verify Docker v20.10+ and Docker Compose v1.29+ installed
- [ ] Run `npm install` or `pnpm install` locally
- [ ] Run `npm run build` to verify build success
- [ ] Test app locally: `npm run preview`

### Files Verification
- [ ] Dockerfile exists
- [ ] docker-compose.yml exists
- [ ] .env.example exists
- [ ] .dockerignore exists
- [ ] nginx.conf exists (for production)
- [ ] INSTALLATION.md exists
- [ ] DOCKER-DEPLOYMENT.md exists
- [ ] VPU_Diem_Danh_Presentation.pptx exists

---

## 🔒 Security Pre-checks

### Environment Configuration
- [ ] Generate secure AUTH_SECRET: `openssl rand -base64 32`
- [ ] Generate secure DB_PASSWORD
- [ ] Copy .env.example to .env
- [ ] Update .env with secure values
- [ ] **Never commit .env file to git**
- [ ] Add .env to .gitignore

### Database Security
- [ ] Change default PostgreSQL password
- [ ] Set strong DB_USER password (minimum 12 chars, mixed case)
- [ ] Restrict database network access (db service not exposed)
- [ ] Enable PostgreSQL password authentication

### Google OAuth (if used)
- [ ] Create OAuth 2.0 credentials in Google Cloud Console
- [ ] Set correct redirect URIs for development AND production
- [ ] Store GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET securely
- [ ] Never log credentials
- [ ] Rotate credentials every 90 days

### HTTPS Configuration (Production)
- [ ] Obtain SSL certificate (Let's Encrypt recommended)
- [ ] Configure nginx.conf with SSL
- [ ] Enable HSTS header
- [ ] Enable automatic certificate renewal
- [ ] Test HTTPS: `curl -I https://your-domain.com`

---

## 🚀 Development Deployment

### Docker Build
- [ ] Build Docker image: `docker-compose build`
- [ ] Verify build completes without errors
- [ ] Check image size: `docker images | grep vpu`
- [ ] Test image: `docker-compose up -d app`
- [ ] Verify app runs: `http://localhost:3000`

### Database Setup
- [ ] Create data volume: database initialized
- [ ] Verify database connection: `docker-compose logs db`
- [ ] Check database is healthy: `docker-compose ps`

### Application Testing
- [ ] Admin panel loads: `/admin`
- [ ] Check-in interface loads
- [ ] GPS permission request works
- [ ] QR code generation works
- [ ] Data persistence verified

### Logs & Monitoring
- [ ] View application logs: `docker-compose logs app`
- [ ] View database logs: `docker-compose logs db`
- [ ] Health check responds: `curl http://localhost:3000/health`

---

## 🏢 Production Deployment

### Infrastructure
- [ ] VPS/Server provisioned (2GB RAM minimum)
- [ ] SSH access configured
- [ ] Firewall configured (allow 80, 443, 22)
- [ ] Domain name registered and DNS configured
- [ ] SSL certificate obtained and renewed automatically

### Docker Deployment
- [ ] Install Docker on server
- [ ] Install Docker Compose on server
- [ ] Copy vpu-checkin files to server
- [ ] Copy .env to server (via secure method)
- [ ] Build image on server: `docker-compose build`
- [ ] Verify image built successfully

### Production Services
- [ ] Start with production profile: `docker-compose --profile production up -d`
- [ ] Verify all services running: `docker-compose ps`
- [ ] Check Nginx reverse proxy: `curl http://localhost:80`
- [ ] Verify HTTPS works: `curl -I https://your-domain.com`
- [ ] Test application: `https://your-domain.com`

### Database Verification
- [ ] Database initialized and running
- [ ] Backup directory created: `/backups`
- [ ] First backup created: `docker-compose exec db pg_dump -U vpu_admin vpu_checkin > backups/initial.sql`
- [ ] Backup location verified

### Monitoring Setup
- [ ] Health checks enabled and responding
- [ ] Logs being collected
- [ ] Resource monitoring in place
- [ ] Uptime monitoring configured (optional)

---

## 📊 Post-Deployment Verification

### Functionality Tests
- [ ] User can access check-in page
- [ ] Admin can create events
- [ ] QR codes generate correctly
- [ ] GPS verification works (with permission)
- [ ] Data exports to CSV
- [ ] Google Drive export works (if configured)
- [ ] Email notifications work (if configured)

### Performance Tests
- [ ] Page load time < 3 seconds
- [ ] API response time < 500ms
- [ ] Concurrent users test (simulate 10+ users)
- [ ] Database query performance acceptable
- [ ] No memory leaks after 24h runtime

### Security Tests
- [ ] HTTPS enforced (all HTTP redirects to HTTPS)
- [ ] Security headers present (check via curl -I)
- [ ] CSRF protection enabled
- [ ] SQL injection prevention verified
- [ ] XSS protection enabled
- [ ] Rate limiting working

### Availability Tests
- [ ] Service auto-restarts after crash
- [ ] Database auto-restarts after crash
- [ ] Health check endpoint responds
- [ ] Graceful degradation on partial failure

---

## 💾 Backup & Recovery

### Initial Setup
- [ ] Backup directory created: `mkdir -p backups`
- [ ] Database backup script configured
- [ ] File backup script configured
- [ ] Backup retention policy defined (e.g., keep 30 days)

### Test Recovery
- [ ] Database backup successful
- [ ] Test restore from backup
- [ ] Restore time documented
- [ ] Recovery procedure documented

### Automated Backups
- [ ] Cron job configured for daily backups
- [ ] Backup logs configured: `/var/log/backup.log`
- [ ] Email notification on backup failure (optional)
- [ ] Offsite backup location configured (optional)

---

## 📈 Monitoring & Alerts

### Container Monitoring
- [ ] CPU usage monitored
- [ ] Memory usage monitored
- [ ] Disk usage monitored
- [ ] Network I/O monitored
- [ ] Alert thresholds set (e.g., CPU > 80%)

### Application Monitoring
- [ ] Request rate monitored
- [ ] Error rate monitored
- [ ] Response time monitored
- [ ] Success rate tracked

### Database Monitoring
- [ ] Connection count monitored
- [ ] Query performance tracked
- [ ] Lock wait time monitored
- [ ] Disk usage monitored

### Alerts Setup
- [ ] Slack/Email alerts configured
- [ ] Alert recipients defined
- [ ] Alert thresholds appropriate
- [ ] Alert response procedure documented

---

## 🔧 Maintenance Schedule

### Daily
- [ ] Check application is running
- [ ] Review error logs
- [ ] Monitor disk space

### Weekly
- [ ] Review performance metrics
- [ ] Verify backups completed successfully
- [ ] Check for updates to dependencies
- [ ] Test admin functions

### Monthly
- [ ] Security audit
- [ ] Database optimization (VACUUM, REINDEX)
- [ ] Update dependencies: `npm update`
- [ ] Review and archive old logs
- [ ] Test disaster recovery procedure

### Quarterly
- [ ] Security updates
- [ ] Docker image rebuild with latest base image
- [ ] Performance capacity planning
- [ ] Update documentation

### Annually
- [ ] Full security audit
- [ ] Compliance review (GDPR, etc.)
- [ ] Disaster recovery drill
- [ ] SSL certificate renewal check

---

## 📚 Documentation

### Required Documentation
- [ ] INSTALLATION.md completed
- [ ] DOCKER-DEPLOYMENT.md completed
- [ ] README.md has deployment instructions
- [ ] Admin guide for managing events
- [ ] User guide for checking in
- [ ] Troubleshooting guide updated

### Runbooks
- [ ] How to start/stop services
- [ ] How to view logs
- [ ] How to restore from backup
- [ ] How to scale services
- [ ] Emergency procedures

### Contact Information
- [ ] Support email documented
- [ ] On-call schedule established
- [ ] Escalation path defined
- [ ] Emergency contacts listed

---

## ✅ Sign-off

**Deployed By:** ________________  
**Date:** ________________  
**Time:** ________________  

**Verified By:** ________________  
**Date:** ________________  

**Notes:**
```
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

---

## 🆘 Quick Reference - Common Commands

```bash
# View status
docker-compose ps

# View logs
docker-compose logs -f app

# Restart services
docker-compose restart

# Stop services
docker-compose down

# Start services
docker-compose up -d

# Rebuild image
docker-compose build --no-cache

# Access database
docker-compose exec db psql -U vpu_admin vpu_checkin

# Backup database
docker-compose exec db pg_dump -U vpu_admin vpu_checkin > backup.sql

# Monitor resources
docker stats

# Clear unused resources
docker system prune -a
```

---

## 🚨 Emergency Procedures

### Application Won't Start
1. Check logs: `docker-compose logs app`
2. Verify .env file exists
3. Rebuild image: `docker-compose build --no-cache`
4. Restart: `docker-compose restart`

### Database Connection Error
1. Check database is running: `docker-compose ps db`
2. View database logs: `docker-compose logs db`
3. Verify database credentials in .env
4. Restart database: `docker-compose restart db`

### Disk Space Full
1. Check usage: `docker system df`
2. Clean images: `docker image prune -a`
3. Clean volumes: `docker volume prune`
4. Clean containers: `docker container prune`

### Need to Restore from Backup
1. Stop services: `docker-compose down`
2. Restore database: `psql -U vpu_admin vpu_checkin < backup.sql`
3. Restart: `docker-compose up -d`

### Port Conflict
1. Find process: `lsof -i :3000`
2. Kill process: `kill -9 <PID>`
3. Or change PORT in .env and restart

---

**Last Updated:** 2026-09-17  
**Next Review:** 2026-12-17
