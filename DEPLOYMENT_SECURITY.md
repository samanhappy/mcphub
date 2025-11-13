# Guide de Déploiement Sécurisé MCPHub

Ce guide vous accompagne pas à pas pour déployer MCPHub de manière sécurisée en production.

## 📋 Prérequis

- [ ] Docker et Docker Compose installés (ou Node.js ≥18)
- [ ] Un nom de domaine (recommandé pour HTTPS)
- [ ] Nginx ou Traefik pour le reverse proxy
- [ ] Un certificat SSL/TLS (Let's Encrypt recommandé)
- [ ] Accès SSH au serveur de production

---

## 🚀 Déploiement Étape par Étape

### Étape 1 : Préparation de l'Environnement

#### 1.1 Créer un Utilisateur Dédié

```bash
# Sur votre serveur de production
sudo adduser mcphub
sudo usermod -aG docker mcphub
su - mcphub
```

#### 1.2 Cloner le Projet

```bash
cd /home/mcphub
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
```

#### 1.3 Créer la Structure des Dossiers

```bash
mkdir -p /home/mcphub/mcphub/data
mkdir -p /home/mcphub/mcphub/config
mkdir -p /home/mcphub/mcphub/logs
```

---

### Étape 2 : Configuration Sécurisée

#### 2.1 Générer une Clé Bearer Forte

```bash
# Générer une clé aléatoire de 32 caractères
openssl rand -base64 32
```

**Sauvegardez cette clé dans un gestionnaire de mots de passe !**

#### 2.2 Créer le Fichier de Configuration

Créez `/home/mcphub/mcphub/config/mcp_settings.json` :

```json
{
  "systemConfig": {
    "routing": {
      "enableGlobalRoute": false,
      "enableGroupNameRoute": true,
      "enableBearerAuth": true,
      "bearerAuthKey": "VOTRE_CLE_BEARER_GENEREE_ICI",
      "skipAuth": false
    }
  },
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

**⚠️ Important** :
- Remplacez `VOTRE_CLE_BEARER_GENEREE_ICI` par la clé générée à l'étape 2.1
- Ne commitez JAMAIS ce fichier dans Git
- Permissions recommandées : `chmod 600 mcp_settings.json`

#### 2.3 Créer le Fichier d'Environnement

Créez `/home/mcphub/mcphub/.env` :

```bash
# Port interne (ne pas exposer directement)
PORT=3000

# Mode de production
NODE_ENV=production

# Base de données PostgreSQL pour Smart Routing (optionnel)
# DATABASE_URL=postgresql://user:password@localhost:5432/mcphub

# OpenAI API pour Smart Routing (optionnel)
# OPENAI_API_KEY=votre-clé-openai
```

**Permissions** : `chmod 600 .env`

---

### Étape 3 : Configuration du Reverse Proxy

#### Option A : Nginx (Recommandé)

##### 3.1 Installer Nginx

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
```

##### 3.2 Créer la Configuration Nginx

Créez `/etc/nginx/sites-available/mcphub` :

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name mcphub.votre-domaine.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Configuration
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mcphub.votre-domaine.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/mcphub.votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcphub.votre-domaine.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=mcphub_general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=mcphub_api:10m rate=30r/s;
    limit_req zone=mcphub_general burst=20 nodelay;

    # Client Max Body Size
    client_max_body_size 10M;

    # Logging
    access_log /var/log/nginx/mcphub_access.log;
    error_log /var/log/nginx/mcphub_error.log warn;

    # Proxy Settings for MCPHub
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CRITICAL: Disable buffering for SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # API Rate Limiting (plus strict)
    location /api/ {
        limit_req zone=mcphub_api burst=50 nodelay;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
    }
}
```

##### 3.3 Activer la Configuration

```bash
sudo ln -s /etc/nginx/sites-available/mcphub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

##### 3.4 Obtenir un Certificat SSL

```bash
sudo certbot --nginx -d mcphub.votre-domaine.com
```

#### Option B : Traefik avec Docker Compose

Créez `docker-compose.yml` :

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik/traefik.yml:/traefik.yml:ro
      - ./traefik/acme.json:/acme.json
      - ./traefik/config.yml:/config.yml:ro
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.entrypoints=http"
      - "traefik.http.routers.traefik.rule=Host(`traefik.votre-domaine.com`)"

  mcphub:
    image: samanhappy/mcphub:latest
    container_name: mcphub
    restart: unless-stopped
    volumes:
      - ./config/mcp_settings.json:/app/mcp_settings.json:ro
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - PORT=3000
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mcphub.rule=Host(`mcphub.votre-domaine.com`)"
      - "traefik.http.routers.mcphub.entrypoints=websecure"
      - "traefik.http.routers.mcphub.tls=true"
      - "traefik.http.routers.mcphub.tls.certresolver=cloudflare"
      - "traefik.http.services.mcphub.loadbalancer.server.port=3000"
      # Rate limiting
      - "traefik.http.middlewares.mcphub-ratelimit.ratelimit.average=100"
      - "traefik.http.middlewares.mcphub-ratelimit.ratelimit.burst=50"
      - "traefik.http.routers.mcphub.middlewares=mcphub-ratelimit"
```

---

### Étape 4 : Démarrage de MCPHub

#### Option A : Avec Docker

```bash
cd /home/mcphub/mcphub

docker run -d \
  --name mcphub \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v $(pwd)/config/mcp_settings.json:/app/mcp_settings.json:ro \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -e NODE_ENV=production \
  samanhappy/mcphub:latest
```

#### Option B : Avec Docker Compose

```bash
cd /home/mcphub/mcphub
docker-compose up -d
```

#### Option C : Installation Native

```bash
cd /home/mcphub/mcphub
pnpm install --prod
pnpm build
pnpm start
```

**Pour systemd** (recommandé), créez `/etc/systemd/system/mcphub.service` :

```ini
[Unit]
Description=MCPHub Service
After=network.target

[Service]
Type=simple
User=mcphub
WorkingDirectory=/home/mcphub/mcphub
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node /home/mcphub/mcphub/dist/index.js
Restart=on-failure
RestartSec=10

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/mcphub/mcphub/data /home/mcphub/mcphub/logs

[Install]
WantedBy=multi-user.target
```

Activez le service :

```bash
sudo systemctl daemon-reload
sudo systemctl enable mcphub
sudo systemctl start mcphub
sudo systemctl status mcphub
```

---

### Étape 5 : Configuration Initiale

#### 5.1 Premier Accès

1. Accédez à `https://mcphub.votre-domaine.com`
2. Connectez-vous avec :
   - **Username** : `admin`
   - **Password** : `admin123`

#### 5.2 Changer le Mot de Passe Admin

**IMMÉDIATEMENT** après la première connexion :

1. Allez dans **Settings**
2. Cliquez sur **Change Password**
3. Changez le mot de passe avec un mot de passe fort (min. 16 caractères)

#### 5.3 Vérifier la Configuration de Sécurité

1. Allez dans **Settings** → **Route Configuration**
2. Vérifiez que :
   - ✅ **Enable Bearer Auth** est activé
   - ✅ La **Bearer Auth Key** est configurée
   - ❌ **Skip Auth** est désactivé
   - ❌ **Enable Global Route** est désactivé (recommandé)

#### 5.4 Créer des Groupes

1. Allez dans **Groups**
2. Créez un groupe pour organiser vos serveurs (ex: "Production")
3. Ajoutez vos serveurs MCP au groupe

---

### Étape 6 : Test de Sécurité

#### 6.1 Tester l'Authentification Bearer

**Sans Bearer Token (doit échouer)** :
```bash
curl https://mcphub.votre-domaine.com/mcp
# Attendu: 401 Unauthorized
```

**Avec Bearer Token (doit réussir)** :
```bash
curl -H "Authorization: Bearer VOTRE_CLE_BEARER" \
  https://mcphub.votre-domaine.com/mcp
```

#### 6.2 Tester l'Accès aux Groupes

```bash
# Tester l'accès à un groupe spécifique
curl -H "Authorization: Bearer VOTRE_CLE_BEARER" \
  https://mcphub.votre-domaine.com/mcp/production
```

#### 6.3 Vérifier les Headers de Sécurité

```bash
curl -I https://mcphub.votre-domaine.com

# Vérifiez la présence de :
# - Strict-Transport-Security
# - X-Frame-Options
# - X-Content-Type-Options
```

---

## 🔐 Hardening Supplémentaire

### 1. Pare-feu (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (redirect)
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 2. Fail2Ban pour Protection Brute Force

```bash
sudo apt install fail2ban -y
```

Créez `/etc/fail2ban/jail.local` :

```ini
[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/mcphub_error.log
maxretry = 5
findtime = 600
bantime = 3600
```

```bash
sudo systemctl restart fail2ban
```

### 3. Monitoring et Alertes

#### 3.1 Installer Prometheus + Grafana (optionnel)

```bash
# À configurer selon vos besoins de monitoring
```

#### 3.2 Log Monitoring avec Logwatch

```bash
sudo apt install logwatch -y
sudo logwatch --detail High --mailto admin@votre-domaine.com --service all --range today
```

### 4. Backups Automatiques

Créez `/home/mcphub/backup.sh` :

```bash
#!/bin/bash
BACKUP_DIR="/home/mcphub/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup de la configuration
cp /home/mcphub/mcphub/config/mcp_settings.json "$BACKUP_DIR/mcp_settings_$DATE.json"

# Backup des données
tar -czf "$BACKUP_DIR/data_$DATE.tar.gz" /home/mcphub/mcphub/data/

# Garder seulement les 7 derniers backups
find "$BACKUP_DIR" -name "*.json" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete
```

Ajoutez au crontab :

```bash
crontab -e
# Ajouter :
0 2 * * * /home/mcphub/backup.sh
```

### 5. Mise à Jour Automatique des Dépendances

```bash
# Créer un script de mise à jour
cat > /home/mcphub/update.sh << 'EOF'
#!/bin/bash
cd /home/mcphub/mcphub
docker pull samanhappy/mcphub:latest
docker-compose down
docker-compose up -d
EOF

chmod +x /home/mcphub/update.sh
```

---

## 📊 Monitoring de Sécurité

### Logs à Surveiller

1. **Nginx Access Logs** : `/var/log/nginx/mcphub_access.log`
2. **Nginx Error Logs** : `/var/log/nginx/mcphub_error.log`
3. **MCPHub Logs** : `/home/mcphub/mcphub/logs/`
4. **Docker Logs** : `docker logs mcphub`

### Patterns Suspects

Surveillez ces patterns dans les logs :

```bash
# Tentatives d'accès sans Bearer token
grep "Bearer authentication failed" /var/log/nginx/mcphub_error.log

# Tentatives de force brute
grep "401 Unauthorized" /var/log/nginx/mcphub_access.log | wc -l

# Accès à des routes non existantes
grep "404 Not Found" /var/log/nginx/mcphub_access.log
```

---

## 🚨 En Cas de Compromission

Si vous suspectez une compromission :

1. **IMMÉDIATEMENT** : Régénérez la clé Bearer
   ```bash
   openssl rand -base64 32
   # Mettez à jour mcp_settings.json
   docker restart mcphub
   ```

2. **Changez tous les mots de passe** via le dashboard

3. **Auditez les logs** pour identifier les accès suspects

4. **Vérifiez les serveurs MCP** pour des modifications non autorisées

5. **Restaurez depuis un backup** si nécessaire

6. **Isolez le serveur** du réseau si la compromission est confirmée

---

## ✅ Checklist Post-Déploiement

- [ ] MCPHub accessible via HTTPS uniquement
- [ ] Certificat SSL valide (Let's Encrypt)
- [ ] Bearer Authentication activée et clé forte configurée
- [ ] Mot de passe admin changé
- [ ] `skipAuth` désactivé
- [ ] Pare-feu configuré (UFW)
- [ ] Fail2Ban installé et actif
- [ ] Backups automatiques configurés
- [ ] Monitoring des logs configuré
- [ ] Rate limiting configuré dans Nginx
- [ ] Headers de sécurité configurés
- [ ] Tests d'authentification réussis
- [ ] Documentation de l'infrastructure réalisée
- [ ] Clés Bearer sauvegardées en lieu sûr
- [ ] Accès SSH sécurisé (clés, pas de root)

---

## 📚 Ressources Complémentaires

- [SECURITY.md](SECURITY.md) - Analyse complète des vulnérabilités
- [Documentation MCPHub](https://docs.mcphubx.com/)
- [Model Context Protocol Spec](https://modelcontextprotocol.io/)
- [OWASP Security Cheat Sheets](https://cheatsheetseries.owasp.org/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)

---

## 💬 Support

En cas de problème de sécurité :
- Lisez d'abord [SECURITY.md](SECURITY.md)
- Vérifiez les logs d'erreur
- Rejoignez le [Discord MCPHub](https://discord.gg/qMKNsn5Q)
- Ne partagez JAMAIS vos clés Bearer publiquement

---

**Dernière mise à jour** : 2025-11-13
