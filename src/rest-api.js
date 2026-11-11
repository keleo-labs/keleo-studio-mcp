function validEndpoint(value, name) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL (HTTP is allowed only for loopback development)`);
  }
  return url;
}

function segment(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error('Invalid Keleo Studio path segment');
  }
  return encodeURIComponent(value);
}

export class RestStudioApi {
  constructor(baseUrl, authMode, credential, fetcher = fetch) {
    this.baseUrl = validEndpoint(baseUrl, 'KELEO_STUDIO_URL');
    if (!['oauth', 'bearer', 'none'].includes(authMode)) throw new Error('Invalid REST authentication mode');
    if (authMode === 'bearer' && (typeof credential !== 'string' || !credential || /[\r\n]/.test(credential))) throw new Error('Invalid bearer token');
    if (authMode === 'oauth' && typeof credential?.getAccessToken !== 'function') throw new Error('OAuth credentials are required');
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/+$/, '')}/`;
    this.authMode = authMode;
    this.credential = credential;
    this.fetcher = fetcher;
  }

  async request(api, params = {}, options = {}) {
    let path;
    switch (api) {
      case 'packages': path = 'packages'; break;
      case 'package': path = `packages/${segment(params.slug)}`; break;
      case 'download': path = `packages/${segment(params.slug)}/download`; break;
      case 'index': path = 'documents'; break;
      case 'document': {
        const parts = params.path?.split('/');
        if (!parts?.length) throw new Error('Invalid Keleo Studio document path');
        path = `documents/${segment(params.bundle)}/${parts.map(segment).join('/')}`;
        break;
      }
      case 'openapi': path = 'openapi.json'; break;
      case 'upload': path = 'packages'; break;
      default: throw new Error(`Unknown Keleo Studio operation: ${api}`);
    }
    const url = new URL(path, this.baseUrl);
    if (api === 'index' && params.kind) url.searchParams.set('kind', params.kind);
    const token = this.authMode === 'oauth' ? await this.credential.getAccessToken() : this.authMode === 'bearer' ? this.credential : null;
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(api === 'upload' ? { 'Content-Type': 'application/zip' } : {}) };
    let response;
    try {
      response = await this.fetcher(url, { method: api === 'upload' ? 'POST' : 'GET', headers, body: options.body, signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new Error(`Keleo Studio request failed: ${error.message}`);
    }
    if (response.status === 401 && this.authMode === 'oauth') {
      this.credential.clear();
      throw new Error('Keleo Studio rejected the OAuth token. Call start_auth again.');
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/\bjson\b|\+json\b/.test(contentType)) throw new Error(`Keleo Studio returned HTTP ${response.status} (${contentType || 'unknown content type'}).`);
    const data = await response.json();
    if (!response.ok || data?.error) throw new Error(`Keleo Studio: ${data?.detail || data?.error || data?.title || `HTTP ${response.status}`}`);
    return data;
  }
}

export { validEndpoint };
