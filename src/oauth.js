import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { openBrowser } from './auth.js';
import { validEndpoint } from './rest-api.js';

const random = () => randomBytes(32).toString('base64url');

export class OAuthHandoff {
  constructor(issuer, clientId, scopes, fetcher = fetch, browserOpener = openBrowser) {
    this.issuer = validEndpoint(issuer, 'KELEO_STUDIO_OIDC_ISSUER');
    if (!clientId || !scopes) throw new Error('OAuth requires a client ID and API scopes');
    this.clientId = clientId;
    this.scopes = scopes;
    this.fetcher = fetcher;
    this.browserOpener = browserOpener;
    this.server = null;
    this.timer = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.error = null;
  }

  async metadata() {
    if (this.discovery) return this.discovery;
    const discoveryUrl = new URL(`${this.issuer.pathname.replace(/\/+$/, '')}/.well-known/openid-configuration`, this.issuer);
    const response = await this.fetcher(discoveryUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`OIDC discovery returned HTTP ${response.status}`);
    const metadata = await response.json();
    if (metadata.issuer !== this.issuer.toString().replace(/\/$/, '')) throw new Error('OIDC discovery issuer does not match configuration');
    this.discovery = {
      authorization: validEndpoint(metadata.authorization_endpoint, 'OIDC authorization endpoint'),
      token: validEndpoint(metadata.token_endpoint, 'OIDC token endpoint')
    };
    return this.discovery;
  }

  async start() {
    if (this.server) return this.authorizationUrl;
    const metadata = await this.metadata();
    this.error = null;
    this.state = random();
    this.verifier = random();
    this.server = createServer((req, res) => { void this.handle(req, res); });
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      this.server = null;
      throw error;
    }
    this.redirectUri = `http://127.0.0.1:${this.server.address().port}/callback`;
    const url = new URL(metadata.authorization);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', this.scopes);
    url.searchParams.set('state', this.state);
    url.searchParams.set('code_challenge', createHash('sha256').update(this.verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    this.authorizationUrl = url.toString();
    this.timer = setTimeout(() => {
      this.error = 'Authentication timed out after five minutes. Call start_auth to retry.';
      this.stopListening();
    }, 5 * 60_000);
    this.timer.unref();
    this.browserOpener(this.authorizationUrl);
    return this.authorizationUrl;
  }

  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    const port = this.server?.address()?.port;
    if (!port || req.headers.host !== `127.0.0.1:${port}` || req.method !== 'GET') { res.writeHead(403).end('Forbidden'); return; }
    const url = new URL(req.url, this.redirectUri);
    if (url.pathname !== '/callback' || url.searchParams.get('state') !== this.state) { res.writeHead(403).end('Forbidden'); return; }
    if (url.searchParams.has('error')) {
      this.error = 'OAuth authorization was denied or failed.';
      res.writeHead(400).end(this.error);
      this.stopListening();
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400).end('Missing authorization code'); return; }
    const verifier = this.verifier;
    this.state = null;
    try {
      await this.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, client_id: this.clientId, code_verifier: verifier }));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><h2>Connected</h2><p>You can return to your agent.</p>');
      this.stopListening();
    } catch (error) {
      this.error = error.message;
      res.writeHead(400).end('OAuth token exchange failed');
      this.stopListening();
    }
  }

  async exchange(body) {
    const { token } = await this.metadata();
    const response = await this.fetcher(token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`OAuth token endpoint returned HTTP ${response.status}`);
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
      throw new Error('OAuth token response is missing an access token or expiry');
    }
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + Number(data.expires_in) * 1000;
    if (typeof data.refresh_token === 'string') this.refreshToken = data.refresh_token;
    this.error = null;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    if (this.refreshToken) {
      try {
        await this.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.clientId }));
        return this.accessToken;
      } catch {
        this.clear();
      }
    }
    this.accessToken = null;
    throw new Error('Authentication required. Call start_auth and complete the browser handoff.');
  }

  status() {
    return {
      state: this.accessToken && (Date.now() < this.expiresAt || this.refreshToken) ? 'authenticated' : this.error ? 'error' : this.server ? 'waiting_for_browser' : 'idle',
      authenticated: Boolean(this.accessToken && (Date.now() < this.expiresAt || this.refreshToken)),
      ...(this.error ? { error: this.error } : {})
    };
  }

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.error = null;
    this.stopListening();
  }

  stopListening() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.server?.close();
    this.server = null;
    this.state = null;
    this.verifier = null;
    this.redirectUri = null;
    this.authorizationUrl = null;
  }
}
