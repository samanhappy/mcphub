# Analyse de Sécurité MCPHub

## 🔒 Résumé Exécutif

Cette analyse identifie plusieurs vulnérabilités de sécurité dans MCPHub qui peuvent exposer vos serveurs MCP à des accès non autorisés. **Il est crucial de configurer correctement la sécurité avant tout déploiement en production.**

## ⚠️ Vulnérabilités Identifiées

### 1. CRITIQUE : Absence d'authentification par défaut sur les endpoints MCP/SSE

**Impact** : Accès non autorisé à tous les serveurs MCP

**Description** :
Les endpoints `/mcp/*` et `/sse/*` sont accessibles sans authentification par défaut si Bearer Auth n'est pas explicitement activé.

**Localisation** :
- `src/services/sseService.ts:20-40` - Fonction `validateBearerAuth()`
- `src/middlewares/auth.ts:44-56` - Option `skipAuth`

**Exemple d'exploitation** :
```bash
# Accès à tous les serveurs sans authentification
curl http://votre-serveur:3000/mcp

# Accès à un serveur spécifique
curl http://votre-serveur:3000/mcp/playwright

# Accès à un groupe
curl http://votre-serveur:3000/mcp/production
```

**Severité** : 🔴 CRITIQUE (CVSS: 9.1 - Critical)

---

### 2. HAUTE : Usurpation d'identité via les routes user-scoped

**Impact** : N'importe qui peut se faire passer pour n'importe quel utilisateur

**Description** :
Le middleware `sseUserContextMiddleware` crée un contexte utilisateur basé uniquement sur le paramètre d'URL, sans validation.

**Localisation** :
- `src/middlewares/userContext.ts:40-83` (lignes 49-57)

**Code vulnérable** :
```typescript
// LIGNE 49-57 : FAILLE DE SÉCURITÉ CRITIQUE
if (username) {
  // TODO: Should be retrieved from user database
  const user: IUser = {
    username,
    password: '',
    isAdmin: false, // ⚠️ Pas de vérification réelle!
  };
  userContextService.setCurrentUser(user);
}
```

**Exemple d'exploitation** :
```bash
# Se faire passer pour l'utilisateur "admin"
curl http://votre-serveur:3000/admin/mcp/production

# Se faire passer pour n'importe quel utilisateur
curl http://votre-serveur:3000/bob/mcp/secret-group
```

**Severité** : 🟠 HAUTE (CVSS: 8.1 - High)

---

### 3. MOYENNE : Absence de contrôle d'accès sur les groupes

**Impact** : Tous les utilisateurs peuvent accéder à tous les groupes

**Description** :
Bien que les groupes aient un champ `owner`, aucune validation n'est effectuée pour vérifier si un utilisateur a le droit d'accéder à un groupe spécifique.

**Localisation** :
- `src/services/sseService.ts:71-75`
- `src/types/index.ts:16-22` (champ `owner` non utilisé)

**Code avec TODO non implémenté** :
```typescript
// For user-scoped routes, validate that the user has access to the group
if (username && group) {
  // Additional validation can be added here to check if user has access to the group
  console.log(`User ${username} accessing group: ${group}`);
}
```

**Severité** : 🟡 MOYENNE (CVSS: 6.5 - Medium)

---

### 4. MOYENNE : Option `skipAuth` exposée

**Impact** : Désactivation complète de l'authentification

**Description** :
L'option `skipAuth` permet de désactiver complètement l'authentification, incluant l'accès au dashboard et aux API. Bien que restreinte aux admins dans l'UI, elle est dangereuse en production.

**Localisation** :
- `src/middlewares/auth.ts:44-56`
- `frontend/src/pages/SettingsPage.tsx:690-702`

**Severité** : 🟡 MOYENNE (CVSS: 5.9 - Medium) si mal configuré

---

## ✅ Mécanismes de Sécurité Existants

### 1. Bearer Authentication (Optionnelle)

**Configuration** : `systemConfig.routing.enableBearerAuth`

**Avantages** :
- ✅ Implémentée et fonctionnelle
- ✅ Configurable via le dashboard
- ✅ Génération automatique de clés sécurisées
- ✅ Protège les endpoints `/mcp` et `/sse`

**Utilisation** :
```bash
curl -H "Authorization: Bearer votre-clé-secrète" \
  http://localhost:3000/mcp/playwright
```

### 2. Gestion des Utilisateurs

- ✅ Création/modification/suppression d'utilisateurs
- ✅ Distinction admin/non-admin
- ✅ Hachage des mots de passe avec bcrypt
- ✅ JWT pour l'authentification dashboard

### 3. Gestion des Groupes

- ✅ Organisation des serveurs en groupes
- ✅ Champ `owner` prévu (mais non utilisé)
- ✅ Configuration des outils par groupe

---

## 🛡️ Recommandations de Sécurité

### Priorité 1 : IMMÉDIAT (Avant tout déploiement)

1. **ACTIVER Bearer Authentication**
   ```json
   {
     "systemConfig": {
       "routing": {
         "enableBearerAuth": true,
         "bearerAuthKey": "générez-une-clé-forte-aléatoire"
       }
     }
   }
   ```

2. **Désactiver `skipAuth`**
   ```json
   {
     "systemConfig": {
       "routing": {
         "skipAuth": false
       }
     }
   }
   ```

3. **Désactiver les routes globales si non nécessaires**
   ```json
   {
     "systemConfig": {
       "routing": {
         "enableGlobalRoute": false
       }
     }
   }
   ```

### Priorité 2 : PRODUCTION

4. **Déployer derrière un reverse proxy avec authentification**
   - Utiliser Nginx, Traefik, ou Caddy
   - Ajouter une couche d'authentification (OAuth, Basic Auth, mTLS)
   - Configurer des rate limits

5. **Ne JAMAIS exposer MCPHub directement sur Internet**
   - Utiliser un VPN ou un réseau privé
   - Restreindre l'accès par IP si possible

6. **Changer le mot de passe admin par défaut**
   - Défaut : `admin` / `admin123`
   - Changer immédiatement via le dashboard

### Priorité 3 : DÉVELOPPEMENT FUTUR

7. **Implémenter le contrôle d'accès utilisateur → groupe**
   - Valider que l'utilisateur a accès au groupe demandé
   - Utiliser le champ `owner` pour les permissions
   - Ajouter une table de relations user-group

8. **Supprimer les routes user-scoped non sécurisées**
   - Ou implémenter une validation réelle de l'utilisateur
   - Vérifier l'identité via JWT

9. **Ajouter des tests de sécurité**
   - Tests d'authentification
   - Tests de contrôle d'accès
   - Tests d'injection

---

## 📋 Checklist de Sécurité pour le Déploiement

Avant de déployer MCPHub en production, vérifiez :

- [ ] Bearer Authentication est activé
- [ ] Une clé Bearer forte a été générée (min. 32 caractères aléatoires)
- [ ] `skipAuth` est désactivé (`false`)
- [ ] Le mot de passe admin par défaut a été changé
- [ ] MCPHub est derrière un reverse proxy
- [ ] Les logs sont activés et surveillés
- [ ] Les endpoints sont restreints par réseau (VPN, firewall)
- [ ] Les groupes sont configurés avec les bons serveurs
- [ ] Les routes globales sont désactivées si non nécessaires
- [ ] Les variables d'environnement sensibles sont sécurisées
- [ ] Un système de backup est en place pour `mcp_settings.json`

---

## 🔧 Configuration Sécurisée Recommandée

### Via le Dashboard (Recommandé)

1. Connectez-vous à `http://localhost:3000`
2. Allez dans **Settings** → **Route Configuration**
3. Activez **Enable Bearer Auth** (une clé sera générée automatiquement)
4. Copiez la clé générée et sauvegardez-la en lieu sûr
5. Désactivez **Skip Auth** si activé
6. Désactivez **Enable Global Route** pour forcer l'utilisation de groupes

### Via le fichier de configuration

**Fichier** : `mcp_settings.json`

```json
{
  "systemConfig": {
    "routing": {
      "enableGlobalRoute": false,
      "enableGroupNameRoute": true,
      "enableBearerAuth": true,
      "bearerAuthKey": "CHANGEZ_CETTE_CLE_PAR_UNE_VALEUR_ALEATOIRE_FORTE",
      "skipAuth": false
    }
  },
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
```

### Configuration Nginx (Reverse Proxy)

```nginx
server {
    listen 443 ssl;
    server_name mcphub.votre-domaine.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Authentification basique supplémentaire
    auth_basic "MCPHub Access";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=mcphub:10m rate=10r/s;
    limit_req zone=mcphub burst=20 nodelay;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Important pour SSE
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

---

## 🔍 Détection d'Intrusion

### Logs à Surveiller

MCPHub génère des logs dans la console. Surveillez ces patterns :

**Tentatives d'accès non autorisé** :
```
Bearer authentication failed or not provided
```

**Accès à des groupes inexistants** :
```
No transport found for sessionId
```

**Changements de configuration** :
```
System config updated
```

### Recommandations de Monitoring

1. Utilisez un agrégateur de logs (ELK, Loki, etc.)
2. Configurez des alertes sur les patterns suspects
3. Surveillez les métriques d'utilisation
4. Auditez régulièrement les utilisateurs et groupes

---

## 📞 Signalement de Vulnérabilités

Si vous découvrez une vulnérabilité de sécurité dans MCPHub :

1. **NE PAS** créer d'issue publique GitHub
2. Contactez les mainteneurs via le canal de sécurité approprié
3. Fournissez un maximum de détails (sans exploiter la vulnérabilité)
4. Attendez la correction avant divulgation publique (responsible disclosure)

---

## 📚 Références

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [Bearer Token Best Practices](https://datatracker.ietf.org/doc/html/rfc6750)

---

## 📝 Historique des Modifications

| Date | Version | Changements |
|------|---------|-------------|
| 2025-11-13 | 1.0 | Analyse initiale de sécurité |

---

**Note** : Cette analyse a été réalisée sur la version actuelle du code. Les vulnérabilités et recommandations peuvent évoluer avec les mises à jour du projet.
