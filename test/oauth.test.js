import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthHandoff } from '../src/oauth.js';

test('OAuth browser handoff uses PKCE and rejects wrong state', async () => {
  let opened;
  let exchanged;
  const fetcher = async (url, options) => {
    if (url.pathname.endsWith('/.well-known/openid-configuration')) return new Response(JSON.stringify({ issuer: 'https://id.example', authorization_endpoint: 'https://id.example/authorize', token_endpoint: 'https://id.example/token' }), { headers: { 'Content-Type': 'application/json' } });
    exchanged = options.body;
    return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600, refresh_token: 'refresh-token' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const auth = new OAuthHandoff('https://id.example', 'client', 'openid studio.read', fetcher, url => { opened = url; });
  try {
    const url = new URL(await auth.start());
    assert.equal(opened, url.toString());
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'openid studio.read');
    const redirect = url.searchParams.get('redirect_uri');
    const wrong = await fetch(`${redirect}?state=wrong&code=code`);
    assert.equal(wrong.status, 403);
    assert.equal(exchanged, undefined);
    const ok = await fetch(`${redirect}?state=${url.searchParams.get('state')}&code=code`);
    assert.equal(ok.status, 200);
    assert.equal(exchanged.get('grant_type'), 'authorization_code');
    assert.equal(exchanged.get('redirect_uri'), redirect);
    assert.ok(exchanged.get('code_verifier'));
    assert.equal(await auth.getAccessToken(), 'access-token');
    assert.equal(auth.status().authenticated, true);
  } finally {
    auth.clear();
  }
});

test('OAuth refreshes expired tokens and requires reauthentication after refresh failure', async () => {
  let rejectRefresh = false;
  const auth = new OAuthHandoff('https://id.example', 'client', 'openid', async (_url, options) => {
    if (rejectRefresh) return new Response('{}', { status: 401 });
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    return new Response(JSON.stringify({ access_token: 'new-token', expires_in: 3600 }), { headers: { 'Content-Type': 'application/json' } });
  }, () => {});
  auth.discovery = { token: new URL('https://id.example/token') };
  auth.accessToken = 'old-token';
  auth.refreshToken = 'refresh-token';
  auth.expiresAt = Date.now() - 1;
  assert.equal(await auth.getAccessToken(), 'new-token');
  auth.expiresAt = Date.now() - 1;
  rejectRefresh = true;
  await assert.rejects(auth.getAccessToken(), /Call start_auth/);
  assert.equal(auth.status().authenticated, false);
});
