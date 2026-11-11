import test from 'node:test';
import assert from 'node:assert/strict';
import { RestStudioApi } from '../src/rest-api.js';

const base = 'https://studio.example/api/';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('REST rejects remote HTTP URLs and malformed bearer credentials', () => {
  assert.throws(() => new RestStudioApi('http://studio.example/api/', 'bearer', 'token'), /HTTPS URL/);
  assert.throws(() => new RestStudioApi(base, 'bearer', 'token\r\nX-Evil: yes'), /Invalid bearer token/);
  assert.equal(new RestStudioApi('http://127.0.0.1:3000/api/', 'none').baseUrl.toString(), 'http://127.0.0.1:3000/api/');
});

test('REST routes preserve library response shapes and bearer authorization', async () => {
  const requests = [];
  const api = new RestStudioApi(base, 'bearer', 'test-token', async (url, options) => {
    requests.push({ url: url.toString(), options });
    return json({ bundles: [] });
  });
  assert.deepEqual(await api.request('packages'), { bundles: [] });
  await api.request('package', { slug: 'alpha beta' });
  await api.request('download', { slug: 'alpha beta' });
  await api.request('index', { kind: 'practice' });
  await api.request('document', { bundle: 'alpha beta', path: 'documents/a b.json' });
  await api.request('openapi');
  assert.deepEqual(requests.map(item => item.url), [
    'https://studio.example/api/packages',
    'https://studio.example/api/packages/alpha%20beta',
    'https://studio.example/api/packages/alpha%20beta/download',
    'https://studio.example/api/documents?kind=practice',
    'https://studio.example/api/documents/alpha%20beta/documents/a%20b.json',
    'https://studio.example/api/openapi.json'
  ]);
  assert.ok(requests.every(item => item.options.headers.Authorization === 'Bearer test-token'));
  await assert.rejects(api.request('document', { bundle: 'x', path: '../secret' }), /Invalid Keleo Studio path segment/);
});

test('REST upload sends original ZIP bytes and none mode sends no authorization', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x00, 0xff]);
  const api = new RestStudioApi(base, 'none', null, async (url, options) => {
    assert.equal(url.toString(), 'https://studio.example/api/packages');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['Content-Type'], 'application/zip');
    assert.deepEqual(options.body, bytes);
    return json({ bundle: { slug: 'test' } });
  });
  assert.deepEqual(await api.request('upload', {}, { body: bytes }), { bundle: { slug: 'test' } });
});

test('REST reports problem JSON without invoking browser authentication', async () => {
  const api = new RestStudioApi(base, 'none', null, async () => new Response(JSON.stringify({ title: 'Forbidden', detail: 'Create permission required' }), { status: 403, headers: { 'Content-Type': 'application/problem+json' } }));
  await assert.rejects(api.request('upload', {}, { body: Buffer.from('zip') }), /Create permission required/);
});

test('REST OAuth uses its credential and clears a rejected access token', async () => {
  let cleared = false;
  const credential = { getAccessToken: async () => 'oauth-token', clear: () => { cleared = true; } };
  const api = new RestStudioApi(base, 'oauth', credential, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer oauth-token');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(api.request('packages'), /Call start_auth again/);
  assert.equal(cleared, true);
});
