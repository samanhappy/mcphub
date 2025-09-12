# MCPHub on Hugging Face Spaces

This guide explains how to deploy MCPHub on Hugging Face Spaces.

## Quick Deploy

### 1. Create a New Space

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces)
2. Click "Create new Space"
3. Choose "Docker" as the SDK
4. Set your Space name and visibility

### 2. Upload Files

Upload all project files to your Space, or clone this repository:

```bash
git clone https://github.com/your-username/mcphub.git
cd mcphub
```

### 3. Use the Optimized Dockerfile

Rename `Dockerfile.hf` to `Dockerfile` in your Space:

```bash
mv Dockerfile.hf Dockerfile
```

### 4. Configure Environment Variables

In your Space's Settings → Variables, add:

```
PORT=7860
REQUEST_TIMEOUT=60000
BASE_PATH=""
```

### 5. Configure Secrets (Optional)

In your Space's Settings → Secrets, add any API keys:

```
AMAP_MAPS_API_KEY=your_amap_key
SLACK_BOT_TOKEN=your_slack_bot_token
SLACK_TEAM_ID=your_slack_team_id
```

### 6. Set Up Database (For Persistence)

Since HF Spaces are ephemeral, configure an external database:

```
DATABASE_URL=postgresql://user:password@host:port/database
```

Recommended providers:
- [Supabase](https://supabase.com/) (Free PostgreSQL)
- [Railway](https://railway.app/) (PostgreSQL)
- [PlanetScale](https://planetscale.com/) (MySQL)

## Key Optimizations for HF Spaces

### 1. Port Configuration
- App now defaults to port 7860 (HF Spaces requirement)
- Dockerfile exposes port 7860
- Environment variable `PORT=7860` is set

### 2. User Permissions
- Uses non-root user with UID 1000 (HF Spaces requirement)
- All files have correct ownership

### 3. Reduced Image Size
- Removed Playwright (not needed for basic functionality)
- Only essential MCP servers included
- Optimized dependency installation

### 4. Environment Variables
- All configuration via environment variables
- Supports HF Spaces secrets for API keys
- Database URL for external persistence

## Differences from Standard Deployment

| Feature | Standard | HF Spaces |
|---------|----------|----------|
| Port | 3000 | 7860 |
| User | root | user (UID 1000) |
| Playwright | Optional | Disabled |
| Database | SQLite/Local | External Required |
| File Storage | Local | Ephemeral |

## Troubleshooting

### Space Not Starting
1. Check build logs for errors
2. Ensure all environment variables are set
3. Verify database connection (if using external DB)

### Port Issues
Ensure `PORT=7860` is set in environment variables.

### Permission Errors
The Dockerfile.hf already handles user permissions correctly.

### Large Image Size
The optimized Dockerfile removes unnecessary dependencies. If you need Playwright, consider upgrading to a GPU Space for more resources.

## Performance Tips

1. **Use External Database**: Essential for data persistence
2. **Minimize Dependencies**: Only install required MCP servers
3. **Cache Management**: Configure appropriate cache headers
4. **Resource Monitoring**: Monitor Space resource usage

## Security Considerations

1. **API Keys**: Always use HF Spaces Secrets, never hardcode
2. **Database**: Use secure connection strings
3. **Admin Access**: Set strong admin credentials
4. **CORS**: Configure appropriate CORS settings for your domain

## Example Space Configuration

A complete example Space configuration:

**Environment Variables:**
```
PORT=7860
REQUEST_TIMEOUT=60000
BASE_PATH=""
DATABASE_URL=postgresql://user:pass@host:5432/mcphub
DEFAULT_ADMIN_USERNAME=admin
```

**Secrets:**
```
DEFAULT_ADMIN_PASSWORD=secure_password_123
AMAP_MAPS_API_KEY=your_amap_key
SLACK_BOT_TOKEN=xoxb-your-slack-token
```

## Support

For issues specific to HF Spaces deployment, check:
1. [HF Spaces Documentation](https://huggingface.co/docs/hub/spaces)
2. Space build logs
3. Project issues on GitHub
