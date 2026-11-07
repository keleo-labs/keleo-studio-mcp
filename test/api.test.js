import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioApi } from '../src/api.js';

const deployment = 'https://script.google.com/macros/s/test-deployment/exec';
const token = 'abcdefghijklmnopqrstuvwxyz1234567890';

test('rejects a deployment outside the Apps Script web app host', () => {
  assert.throws(() => new StudioApi('https://example.com/exec'), /KELEO_STUDIO_URL/);
});

test('accepts a Workspace domain-scoped deployment URL', () => {
  const url = 'https://script.google.com/a/macros/example.com/s/test-deployment/exec';
  assert.equal(new StudioApi(url).baseUrl.toString(), url);
});

test('sends query-routed API request with bearer token', async () => {
  const api = new StudioApi(deployment, async (url, options) => {
    assert.equal(url.searchParams.get('api'), 'document');
    assert.equal(url.searchParams.get('bundle'), 'a-b');
    assert.equal(url.searchParams.get('path'), 'documents/x.json');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify({ name: 'X' }), { headers: { 'Content-Type': 'application/json' } });
  });
  api.setToken(token);
  assert.deepEqual(await api.request('document', { bundle: 'a-b', path: 'documents/x.json' }), { name: 'X' });
});

test('sends upload as base64 text and reports API errors', async () => {
  const api = new StudioApi(deployment, async (url, options) => {
    assert.equal(url.searchParams.get('api'), 'upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'text/plain');
    assert.equal(options.body, 'eGlw');
    return new Response(JSON.stringify({ error: 'Permission denied' }), { headers: { 'Content-Type': 'application/json' } });
  });
  api.setToken(token);
  await assert.rejects(api.request('upload', {}, { body: 'eGlw' }), /Permission denied/);
  assert.equal(api.authenticated, true);
});

test('discards token when Google returns a sign-in page', async () => {
  const api = new StudioApi(deployment, async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }));
  api.setToken(token);
  await assert.rejects(api.request('packages'), /submit a new token/);
  assert.equal(api.authenticated, false);
});

test('does not call API without a token', async () => {
  const api = new StudioApi(deployment, () => { throw new Error('Unexpected request'); });
  await assert.rejects(api.request('packages'), /Call start_auth/);
});
