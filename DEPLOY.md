# Deploying Branch Pulse on an Ubuntu VPS

Stack on one server, all in Docker: **Caddy** (HTTPS, the only public ports 80/443) -> **web** (Next.js) and **api** (NestJS) -> **PostgreSQL 16** (internal only). The compose file and images were built and tested end to end (migrate, seed, login through the proxy, secure cookie).

## 0. What you need

- Ubuntu 22.04 or 24.04 VPS, **2 vCPU / 4 GB RAM** recommended (2 GB works if you add swap; the image build is the heavy part).
- A **domain name** (for example `app.yourshop.com`) with an **A record** pointing at the VPS IP. HTTPS certificates are issued automatically for it. It needs ports 80 and 443 open.
- Your code on the server (git repo or copied files).

## 1. Prepare the server

```bash
ssh root@YOUR_SERVER_IP

# updates, tools, timezone
apt update && apt -y upgrade
apt -y install ca-certificates curl git ufw
timedatectl set-timezone Asia/Kolkata

# a normal user (use SSH keys, not passwords)
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copies your key to the new user

# firewall: SSH + web only. The database is never exposed.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Docker (official script) and let the deploy user run it
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# optional, only if the server has 2 GB RAM or less
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Log out and back in as `deploy` (`ssh deploy@YOUR_SERVER_IP`). Optionally disable root/password SSH login in `/etc/ssh/sshd_config` (`PermitRootLogin no`, `PasswordAuthentication no`) and `apt -y install fail2ban unattended-upgrades`.

## 2. Put the code on the server

Recommended: push the project to a **private** Git repository (GitHub/GitLab) and clone it. The project folder is not a git repository yet, so on your PC:

```bash
git init && git add -A && git commit -m "Branch Pulse"
git remote add origin git@github.com:YOU/branch-pulse.git && git push -u origin main
```

On the server (add a read-only *deploy key* to the repo if it is private):

```bash
git clone git@github.com:YOU/branch-pulse.git ~/branch-pulse && cd ~/branch-pulse
```

Without Git you can copy the folder instead (skip `node_modules`, `.next`, `dist`, `.env`):
`rsync -av --exclude node_modules --exclude .next --exclude dist --exclude '.env*' ./ deploy@SERVER:~/branch-pulse/` - then `deploy.sh` below will not be able to `git pull`, so run the build steps in section 4 by hand.

## 3. Configure

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in `DOMAIN` and generate the four secrets (hex only, so nothing needs URL-encoding):

```bash
openssl rand -hex 24     # run once per secret: POSTGRES_PASSWORD, APP_RW_PASSWORD, JWT_ACCESS_SECRET, SEED_PASSWORD
chmod 600 .env.prod
```

`SEED_PASSWORD` becomes the first `owner` password. Keep `.env.prod` out of git (already in `.gitignore`).

## 4. First deploy

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C build                     # 5-10 minutes the first time
$C up -d db                  # creates the database and the restricted app role
$C run --rm migrate          # applies all migrations
$C run --rm seed             # roles, permissions, approval limits, units, expense categories, ONE owner user
$C up -d                     # api, web and caddy
$C ps                        # all services should become "healthy"
```

Open `https://YOUR_DOMAIN`, sign in as **owner** with `SEED_PASSWORD`. Caddy fetches the certificate on the first request (give it a minute).

## 5. Create your branches and staff

The seed creates no demo data. Sign in as **owner** and use the **Branches** menu: **Add branch** suggests the next free branch ID (prefix configurable via the `branch.code_prefix` setting, default `BR`), and you can create the branch manager's login in the same form. Each branch page has Settings (opening cash, rent, manager, activate/deactivate), Expenses, History and Reports tabs.

There is no screen for other staff logins (accountant, stock manager) yet; create those through the API once. Replace the domain and IDs (the same calls can also create branches and managers if you prefer scripting):

```bash
D=https://YOUR_DOMAIN
T=$(curl -s $D/api/v1/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"owner","password":"YOUR_SEED_PASSWORD"}' | sed 's/.*"accessToken":"\([^"]*\)".*/\1/')

# a branch (Tamil name optional)
curl -s $D/api/v1/locations -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"code":"BR001","name":"Anna Nagar","nameTa":"அண்ணா நகர்","type":"BRANCH","defaultOpeningCash":"2000.00"}'

# its manager (use the "id" returned above as locationIds)
curl -s $D/api/v1/users -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"username":"manager1","password":"A-Strong-Pass-1","fullName":"Anna Nagar Manager","roleCodes":["BRANCH_MANAGER"],"locationIds":["BRANCH_ID"]}'
```

Roles: `OWNER`, `ACCOUNTANT`, `STOCK_MANAGER`, `BRANCH_MANAGER`, `STAFF`. To change the owner password: `PATCH /api/v1/users/<owner id>` with `{"password":"..."}`.

## 6. Updating later

```bash
cd ~/branch-pulse && ./infra/deploy.sh    # git pull, build, migrate, restart
```

Migrations run *before* the new API starts. Roll back by checking out the previous commit and running the script again (migrations only ever add; restore a backup if you need to undo data changes).

## 7. Backups (do this on day one)

```bash
chmod +x infra/*.sh
sudo mkdir -p /var/backups/branch-pulse && sudo chown deploy: /var/backups/branch-pulse
./infra/backup.sh                                   # test it once

crontab -e
# every day at 02:30 IST
30 2 * * * /home/deploy/branch-pulse/infra/backup.sh >> /var/log/branch-pulse-backup.log 2>&1
```

It writes a database dump and a tarball of uploaded receipts, and keeps 35 days. **Also copy `/var/backups/branch-pulse` off the server** (`rclone` to any cloud bucket, or `rsync` to another machine); a backup on the same disk does not survive losing the server. Test a restore now and then.

**Restore**

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C stop api web
cat /var/backups/branch-pulse/db-YYYY-MM-DD_HHMM.dump | $C exec -T db pg_restore -U postgres -d branch_pulse --clean --if-exists
docker run --rm -v branch-pulse_uploads:/data -v /var/backups/branch-pulse:/backup alpine \
  tar xzf /backup/uploads-YYYY-MM-DD_HHMM.tgz -C /data
$C start api web
```

## 8. Everyday operations

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C ps                       # status
$C logs -f api              # API logs (also: web, caddy, db)
$C restart api              # restart one service
df -h && docker system df   # disk usage
```

## 9. Know the limits of this setup

- **One server, one database.** No point-in-time recovery or read replica (the HLD targets RPO 5 min on managed Postgres). Daily dumps mean up to a day of data at risk; use your provider's VPS snapshots as well, or move to a managed PostgreSQL later - only `DATABASE_URL`/`DIRECT_URL` change.
- **Receipts are stored on the server's disk** (volume `uploads`), because the S3 storage provider is not built yet. They are included in the backup above.
- **Run a single API container.** The nightly closing job and login rate limits are in-process.
- **Security basics already in place:** HTTPS with HSTS, HttpOnly + Secure + SameSite=Strict refresh cookie, database not reachable from outside, app database role cannot bypass row-level security or delete history. Keep the OS updated and secrets only in `.env.prod`.
- **Email/WhatsApp alerts, OTP 2FA and reports export are not implemented yet** (see README).
