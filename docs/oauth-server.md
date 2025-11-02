# OAuth 2.0 Authorization Server

MCPHub can act as an OAuth 2.0 authorization server, allowing external applications like ChatGPT Web to securely authenticate and access your MCP servers.

## Overview

The OAuth 2.0 authorization server feature enables MCPHub to:

- Provide standard OAuth 2.0 authentication flows
- Issue and manage access tokens for external clients
- Support secure authorization without exposing user credentials
- Enable integration with services that require OAuth (like ChatGPT Web)

## Configuration

### Enable OAuth Server

Add the following configuration to your `mcp_settings.json`:

```json
{
  "systemConfig": {
    "oauthServer": {
      "enabled": true,
      "accessTokenLifetime": 3600,
      "refreshTokenLifetime": 1209600,
      "authorizationCodeLifetime": 300,
      "requireClientSecret": false,
      "allowedScopes": ["read", "write"]
    }
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable OAuth authorization server |
| `accessTokenLifetime` | number | `3600` | Access token lifetime in seconds (1 hour) |
| `refreshTokenLifetime` | number | `1209600` | Refresh token lifetime in seconds (14 days) |
| `authorizationCodeLifetime` | number | `300` | Authorization code lifetime in seconds (5 minutes) |
| `requireClientSecret` | boolean | `false` | Whether client secret is required (set to false for PKCE) |
| `allowedScopes` | string[] | `["read", "write"]` | List of allowed OAuth scopes |

## OAuth Clients

### Creating OAuth Clients

#### Via API (Recommended)

Create an OAuth client using the API:

```bash
curl -X POST http://localhost:3000/api/oauth/clients \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "name": "My Application",
    "redirectUris": ["https://example.com/callback"],
    "grants": ["authorization_code", "refresh_token"],
    "scopes": ["read", "write"],
    "requireSecret": false
  }'
```

Response:
```json
{
  "success": true,
  "message": "OAuth client created successfully",
  "client": {
    "clientId": "a1b2c3d4e5f6g7h8",
    "clientSecret": null,
    "name": "My Application",
    "redirectUris": ["https://example.com/callback"],
    "grants": ["authorization_code", "refresh_token"],
    "scopes": ["read", "write"],
    "owner": "admin"
  }
}
```

**Important**: If `requireSecret` is true, the `clientSecret` will be shown only once. Save it securely!

#### Via Configuration File

Alternatively, add OAuth clients directly to `mcp_settings.json`:

```json
{
  "oauthClients": [
    {
      "clientId": "my-app-client",
      "clientSecret": "optional-secret-for-confidential-clients",
      "name": "My Application",
      "redirectUris": ["https://example.com/callback"],
      "grants": ["authorization_code", "refresh_token"],
      "scopes": ["read", "write"],
      "owner": "admin"
    }
  ]
}
```

### Managing OAuth Clients

#### List All Clients

```bash
curl http://localhost:3000/api/oauth/clients \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

#### Get Specific Client

```bash
curl http://localhost:3000/api/oauth/clients/CLIENT_ID \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

#### Update Client

```bash
curl -X PUT http://localhost:3000/api/oauth/clients/CLIENT_ID \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "name": "Updated Name",
    "redirectUris": ["https://example.com/callback", "https://example.com/callback2"]
  }'
```

#### Delete Client

```bash
curl -X DELETE http://localhost:3000/api/oauth/clients/CLIENT_ID \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

#### Regenerate Client Secret

```bash
curl -X POST http://localhost:3000/api/oauth/clients/CLIENT_ID/regenerate-secret \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

## OAuth Flow

MCPHub supports the OAuth 2.0 Authorization Code flow with PKCE (Proof Key for Code Exchange).

### 1. Authorization Request

The client application redirects the user to the authorization endpoint:

```
GET /oauth/authorize?
  client_id=CLIENT_ID&
  redirect_uri=REDIRECT_URI&
  response_type=code&
  scope=read%20write&
  state=RANDOM_STATE&
  code_challenge=CODE_CHALLENGE&
  code_challenge_method=S256
```

Parameters:
- `client_id`: OAuth client ID
- `redirect_uri`: Redirect URI (must match registered URI)
- `response_type`: Must be `code`
- `scope`: Space-separated list of scopes (e.g., `read write`)
- `state`: Random string to prevent CSRF attacks
- `code_challenge`: PKCE code challenge (optional but recommended)
- `code_challenge_method`: PKCE method (`S256` or `plain`)

### 2. User Authorization

The user is presented with a consent page showing:
- Application name
- Requested scopes
- Approve/Deny buttons

If the user approves, they are redirected to the redirect URI with an authorization code:

```
https://example.com/callback?code=AUTHORIZATION_CODE&state=RANDOM_STATE
```

### 3. Token Exchange

The client exchanges the authorization code for an access token:

```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=AUTHORIZATION_CODE" \
  -d "redirect_uri=REDIRECT_URI" \
  -d "client_id=CLIENT_ID" \
  -d "code_verifier=CODE_VERIFIER"
```

Response:
```json
{
  "access_token": "ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "REFRESH_TOKEN",
  "scope": "read write"
}
```

### 4. Using Access Token

Use the access token to make authenticated requests:

```bash
curl http://localhost:3000/api/servers \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

### 5. Refreshing Token

When the access token expires, use the refresh token to get a new one:

```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=REFRESH_TOKEN" \
  -d "client_id=CLIENT_ID"
```

## PKCE (Proof Key for Code Exchange)

PKCE is a security extension to OAuth 2.0 that prevents authorization code interception attacks. It's especially important for public clients (mobile apps, SPAs).

### Generating PKCE Parameters

1. Generate a code verifier (random string):
   ```javascript
   const codeVerifier = crypto.randomBytes(32).toString('base64url');
   ```

2. Generate code challenge from verifier:
   ```javascript
   const codeChallenge = crypto
     .createHash('sha256')
     .update(codeVerifier)
     .digest('base64url');
   ```

3. Include in authorization request:
   - `code_challenge`: The generated challenge
   - `code_challenge_method`: `S256`

4. Include in token request:
   - `code_verifier`: The original verifier

## OAuth Scopes

MCPHub supports the following default scopes:

| Scope | Description |
|-------|-------------|
| `read` | Read access to MCP servers and tools |
| `write` | Execute tools and modify MCP server configurations |

You can customize allowed scopes in the `oauthServer.allowedScopes` configuration.

## Server Metadata

MCPHub provides OAuth 2.0 Authorization Server Metadata (RFC 8414) at:

```
GET /.well-known/oauth-authorization-server
```

Response:
```json
{
  "issuer": "http://localhost:3000",
  "authorization_endpoint": "http://localhost:3000/oauth/authorize",
  "token_endpoint": "http://localhost:3000/oauth/token",
  "userinfo_endpoint": "http://localhost:3000/oauth/userinfo",
  "scopes_supported": ["read", "write"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256", "plain"]
}
```

## User Info Endpoint

Get authenticated user information (OpenID Connect compatible):

```bash
curl http://localhost:3000/oauth/userinfo \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Response:
```json
{
  "sub": "username",
  "username": "username"
}
```

## Integration with ChatGPT Web

To integrate MCPHub with ChatGPT Web:

1. Enable OAuth server in MCPHub configuration
2. Create an OAuth client with ChatGPT's redirect URI
3. Configure ChatGPT Web MCP Connector:
   - **MCP Server URL**: `http://your-mcphub-url/mcp`
   - **Authentication**: OAuth
   - **OAuth Client ID**: Your client ID
   - **OAuth Client Secret**: Leave empty (PKCE flow)
   - **Authorization URL**: `http://your-mcphub-url/oauth/authorize`
   - **Token URL**: `http://your-mcphub-url/oauth/token`
   - **Scopes**: `read write`

## Security Considerations

1. **HTTPS in Production**: Always use HTTPS in production to protect tokens in transit
2. **Secure Client Secrets**: If using confidential clients, store client secrets securely
3. **Token Storage**: Access tokens are stored in memory by default. For production, consider using a database
4. **Token Rotation**: Implement token rotation by using refresh tokens
5. **Scope Limitation**: Grant only necessary scopes to clients
6. **Redirect URI Validation**: Always validate redirect URIs strictly
7. **State Parameter**: Always use the state parameter to prevent CSRF attacks
8. **PKCE**: Use PKCE for public clients (strongly recommended)
9. **Rate Limiting**: For production deployments, implement rate limiting on OAuth endpoints to prevent brute force attacks. Consider using middleware like `express-rate-limit`
10. **Input Validation**: All OAuth parameters are validated, but additional application-level validation may be beneficial
11. **XSS Protection**: The authorization page escapes all user input to prevent XSS attacks

## Troubleshooting

### "OAuth server not available"

Make sure `oauthServer.enabled` is set to `true` in your configuration and restart MCPHub.

### "Invalid redirect_uri"

Ensure the redirect URI in the authorization request exactly matches one of the registered redirect URIs for the client.

### "Invalid client"

Verify the client ID is correct and the OAuth client exists in the configuration.

### Token expired

Use the refresh token to obtain a new access token, or re-authorize the application.

## Example: JavaScript Client

```javascript
// Generate PKCE parameters
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// Store code verifier for later use
sessionStorage.setItem('codeVerifier', codeVerifier);

// Redirect to authorization endpoint
const authUrl = new URL('http://localhost:3000/oauth/authorize');
authUrl.searchParams.set('client_id', 'my-client-id');
authUrl.searchParams.set('redirect_uri', 'http://localhost:8080/callback');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'read write');
authUrl.searchParams.set('state', crypto.randomBytes(16).toString('hex'));
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

window.location.href = authUrl.toString();

// In callback handler:
const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get('code');
const codeVerifier = sessionStorage.getItem('codeVerifier');

// Exchange code for token
const tokenResponse = await fetch('http://localhost:3000/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: 'http://localhost:8080/callback',
    client_id: 'my-client-id',
    code_verifier: codeVerifier,
  }),
});

const tokens = await tokenResponse.json();
// Store tokens securely
localStorage.setItem('accessToken', tokens.access_token);
localStorage.setItem('refreshToken', tokens.refresh_token);

// Use access token
const response = await fetch('http://localhost:3000/api/servers', {
  headers: { Authorization: `Bearer ${tokens.access_token}` },
});
```

## References

- [OAuth 2.0 - RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAuth 2.0 Authorization Server Metadata - RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)
- [PKCE - RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.0 for Browser-Based Apps](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
