import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function openBrowser(url, platform = process.platform) {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', error => console.error(`Could not open browser: ${error.message}`));
  child.unref();
}

export class AuthHandoff {
  constructor(api, browserOpener = openBrowser) {
    this.api = api;
    this.browserOpener = browserOpener;
    this.server = null;
    this.nonce = null;
    this.mode = null;
    this.error = null;
    this.timer = null;
  }

  async start(mode = 'automatic') {
    if (mode !== 'automatic' && mode !== 'manual') throw new Error('Unknown authentication mode');
    if (this.server && this.mode !== mode) this.close();
    if (this.server) {
      const url = mode === 'automatic' ? this.appUrl() : this.localUrl();
      this.browserOpener(url);
      return url;
    }
    this.mode = mode;
    this.error = null;
    this.nonce = randomBytes(24).toString('hex');
    this.server = createServer((req, res) => this.handle(req, res));
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', resolve);
      });
    } catch (error) {
      this.server = null;
      throw error;
    }
    const url = mode === 'automatic' ? this.appUrl() : this.localUrl();
    this.timer = setTimeout(() => {
      this.error = 'Authentication timed out after five minutes. Call start_auth to retry.';
      this.stopListening();
    }, 5 * 60_000);
    this.timer.unref();
    this.browserOpener(url);
    return url;
  }

  appUrl() {
    const url = new URL(this.api.baseUrl);
    url.searchParams.set('mcp_auth', '1');
    url.searchParams.set('port', String(this.server.address().port));
    url.searchParams.set('state', this.nonce);
    return url.toString();
  }

  status() {
    return {
      state: this.api.authenticated ? 'authenticated' : this.error ? 'error' : this.server ? 'waiting_for_browser' : 'idle',
      authenticated: this.api.authenticated,
      ...(this.error ? { error: this.error } : {})
    };
  }

  localUrl() {
    return `http://127.0.0.1:${this.server.address().port}/?state=${this.nonce}`;
  }

  handle(req, res) {
    const origin = `http://127.0.0.1:${this.server.address().port}`;
    const url = new URL(req.url, origin);
    const valid = req.headers.host === `127.0.0.1:${this.server.address().port}` && url.searchParams.get('state') === this.nonce;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
    if (!valid) { res.writeHead(403).end('Forbidden'); return; }
    if (req.method === 'GET' && url.pathname === '/' && this.mode === 'manual') {
      const appUrl = escapeHtml(this.api.baseUrl.toString());
      const action = escapeHtml(`/?state=${this.nonce}`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect Keleo Studio</title><style>body{font:16px system-ui;max-width:38rem;margin:3rem auto;padding:0 1rem;line-height:1.5}input{width:100%;padding:.7rem;box-sizing:border-box}button{padding:.7rem 1rem;margin-top:1rem}</style><h2>Connect Keleo Studio</h2><p>Open <a href="${appUrl}" target="_blank" rel="noopener noreferrer">Keleo Studio</a>, choose <strong>API Reference</strong> in its navigation, then select <strong>Generate My API Token</strong>.</p><p>Copy the token and paste it here. It stays in this MCP process and is cleared after 50 minutes or if Google rejects it.</p><form method="post" action="${action}"><label for="token">Personal API token</label><input id="token" name="token" type="password" autocomplete="off" required><button type="submit">Connect</button></form>`);
      return;
    }
    if (req.method === 'POST' && ((url.pathname === '/' && this.mode === 'manual') || (url.pathname === '/callback' && this.mode === 'automatic'))) {
      if ((this.mode === 'manual' && req.headers.origin !== origin) || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
        res.writeHead(403).end('Forbidden'); return;
      }
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 8192) req.destroy();
      });
      req.on('end', async () => {
        try {
          this.api.setToken(new URLSearchParams(body).get('token'));
          if (this.mode === 'automatic') await this.api.request('packages');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><h2>Connected</h2><p>You can return to your agent. Close this page when ready.</p>');
          this.close();
        } catch (error) {
          this.api.clearToken();
          this.error = error.message;
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error.message);
        }
      });
      return;
    }
    res.writeHead(404).end('Not found');
  }

  close() {
    this.error = null;
    this.stopListening();
  }

  stopListening() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.server?.close();
    this.server = null;
    this.nonce = null;
    this.mode = null;
  }
}
