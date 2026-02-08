# MCPHub : Le Hub Unifié pour les Serveurs MCP

[English](README.md) | Français | [中文版](README.zh.md)

MCPHub facilite la gestion et la mise à l'échelle de plusieurs serveurs MCP (Model Context Protocol) en les organisant en points de terminaison HTTP streamables (SSE) flexibles, prenant en charge l'accès à tous les serveurs, à des serveurs individuels ou à des groupes de serveurs logiques.

![Aperçu du tableau de bord](assets/dashboard.zh.png)

## 🌐 Démo en direct et Documentation

- **Documentation** : [docs.mcphubx.com](https://docs.mcphubx.com/)
- **Environnement de démo** : [demo.mcphubx.com](https://demo.mcphubx.com/)

## 🚀 Fonctionnalités

- **Gestion centralisée** - Surveillez et contrôlez tous les serveurs MCP depuis un tableau de bord unifié
- **Routage flexible** - Accédez à tous les serveurs, groupes spécifiques ou serveurs individuels via HTTP/SSE
- **Routage intelligent** - Découverte d'outils propulsée par IA utilisant la recherche sémantique vectorielle ([En savoir plus](https://docs.mcphubx.com/features/smart-routing))
- **Configuration à chaud** - Ajoutez, supprimez ou mettez à jour les serveurs sans temps d'arrêt
- **Support OAuth 2.0** - Modes client et serveur pour une authentification sécurisée ([En savoir plus](https://docs.mcphubx.com/features/oauth))
- **Connexion Sociale** - Support de connexion GitHub et Google via Better Auth (nécessite le mode Base de données)
- **Mode Base de données** - Stockez la configuration dans PostgreSQL pour les environnements de production ([En savoir plus](https://docs.mcphubx.com/configuration/database-configuration))
- **Prêt pour Docker** - Déployez instantanément avec la configuration conteneurisée

## 🔧 Démarrage rapide

### Configuration

Créez un fichier `mcp_settings.json` :

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "time-mcp"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    }
  }
}
```

📖 Consultez le [Guide de configuration](https://docs.mcphubx.com/configuration/mcp-settings) pour les options complètes incluant OAuth, les variables d'environnement, et plus.

### Déploiement avec Docker

```bash
# Exécutez avec une configuration personnalisée (recommandé)
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub

# Ou exécutez avec les paramètres par défaut
docker run -p 3000:3000 samanhappy/mcphub
```

### Accéder au tableau de bord

Ouvrez `http://localhost:3000` et connectez-vous avec les identifiants par défaut : `admin` / `admin123`

### Connecter les clients IA

Connectez les clients IA (Claude Desktop, Cursor, etc.) via :

```
http://localhost:3000/mcp           # Tous les serveurs
http://localhost:3000/mcp/{group}   # Groupe spécifique
http://localhost:3000/mcp/{server}  # Serveur spécifique
http://localhost:3000/mcp/$smart    # Routage intelligent
http://localhost:3000/mcp/$smart/{group}  # Routage intelligent dans un groupe
```

> **Note de sécurité** : Les points de terminaison MCP nécessitent une authentification par défaut pour éviter toute exposition accidentelle. Pour autoriser l'accès MCP sans authentification, désactivez **Activer l'authentification Bearer** dans la section Clés. **Ignorer l'authentification** n'affecte que la connexion au tableau de bord. À utiliser uniquement dans des environnements de confiance.

📖 Consultez la [Référence API](https://docs.mcphubx.com/api-reference) pour la documentation détaillée des points de terminaison.

## 📚 Documentation

| Sujet                                                                                 | Description                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| [Démarrage rapide](https://docs.mcphubx.com/quickstart)                               | Commencez en 5 minutes                      |
| [Configuration](https://docs.mcphubx.com/configuration/mcp-settings)                  | Options de configuration du serveur MCP     |
| [Mode Base de données](https://docs.mcphubx.com/configuration/database-configuration) | Configuration PostgreSQL pour la production |
| [OAuth](https://docs.mcphubx.com/features/oauth)                                      | Configuration client et serveur OAuth 2.0   |
| [Routage intelligent](https://docs.mcphubx.com/features/smart-routing)                | Découverte d'outils propulsée par IA        |
| [Configuration Docker](https://docs.mcphubx.com/configuration/docker-setup)           | Guide de déploiement Docker                 |

## 🧑‍💻 Développement local

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

> Pour les utilisateurs Windows, démarrez le backend et le frontend séparément : `pnpm backend:dev`, `pnpm frontend:dev`

📖 Consultez le [Guide de développement](https://docs.mcphubx.com/development) pour les instructions de configuration détaillées.

## 🔍 Stack technique

- **Backend** : Node.js, Express, TypeScript
- **Frontend** : React, Vite, Tailwind CSS
- **Authentification** : JWT & bcrypt
- **Protocole** : Model Context Protocol SDK

## 👥 Contribuer

Les contributions sont les bienvenues ! Rejoignez notre [communauté Discord](https://discord.gg/qMKNsn5Q) pour des discussions et du support.

## ❤️ Sponsor

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/samanhappy)

## 🌟 Historique des étoiles

[![Historique des étoiles](https://api.star-history.com/svg?repos=samanhappy/mcphub&type=Date)](https://www.star-history.com/#samanhappy/mcphub&Date)

## 📄 Licence

Sous licence [Apache 2.0 License](LICENSE).
