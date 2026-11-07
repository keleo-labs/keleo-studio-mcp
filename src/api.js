export class StudioApi {
  constructor(baseUrl, fetcher = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/(?:macros\/s|a\/macros\/[^/]+\/s)\/[^/]+\/(exec|dev)$/.test(url.pathname)) {
      throw new Error('KELEO_STUDIO_URL must be a script.google.com Apps Script /exec (or /dev) HTTPS URL');
    }
    this.baseUrl = url;
    this.fetcher = fetcher;
    this.token = null;
    this.expiresAt = 0;
  }

  setToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]{20,4096}$/.test(token)) {
      throw new Error('Enter the Google OAuth access token shown by Keleo Studio');
    }
    this.token = token;
    // Apps Script reports an approximate one-hour lifetime; renew early.
    this.expiresAt = Date.now() + 50 * 60_000;
  }

  clearToken() {
    this.token = null;
    this.expiresAt = 0;
  }

  get authenticated() {
    if (this.token && Date.now() >= this.expiresAt) this.clearToken();
    return Boolean(this.token);
  }

  async request(api, params = {}, options = {}) {
    if (!this.authenticated) throw new Error('Authentication required. Call start_auth, then complete the browser handoff.');
    const url = new URL(this.baseUrl);
    url.searchParams.set('api', api);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.fetcher(url, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'text/plain' })
        },
        body: options.body,
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw new Error(`Keleo Studio request failed: ${error.message}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 401 || response.status === 403 || !contentType.includes('json')) {
      if (response.status === 401 || response.status === 403 || contentType.includes('html')) {
        this.clearToken();
        throw new Error('Google rejected the token or returned a sign-in page. Call start_auth and submit a new token.');
      }
      throw new Error(`Keleo Studio returned HTTP ${response.status} (${contentType || 'unknown content type'}).`);
    }
    const data = await response.json();
    if (!response.ok || data?.error) throw new Error(`Keleo Studio: ${data?.error || `HTTP ${response.status}`}`);
    return data;
  }
}
