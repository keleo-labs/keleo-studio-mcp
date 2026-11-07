import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioApi } from '../src/api.js';
import { AuthHandoff } from '../src/auth.js';

const token = 'abcdefghijklmnopqrstuvwxyz1234567890';

test('local browser handoff accepts token and rejects wrong origin or state', async () => {
  const api = new StudioApi('https://script.google.com/macros/s/test-deployment/exec');
  let opened;
  const handoff = new AuthHandoff(api, url => { opened = url; });
  try {
    const url = await handoff.start('manual');
    assert.equal(opened, url);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Generate My API Token/);
    assert.match(html, /script.google.com/);

    const wrongState = await fetch(url.replace(/state=[a-f0-9]+/, 'state=wrong'));
    assert.equal(wrongState.status, 403);
    const wrongOrigin = await fetch(url, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `token=${token}` });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(api.authenticated, false);

    const origin = new URL(url).origin;
    const submit = await fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    assert.equal(submit.status, 200);
    assert.equal(api.authenticated, true);
    assert.equal(handoff.server, null);
  } finally {
    handoff.close();
  }
});

test('Apps Script bridge posts a token to a one-time loopback callback', async () => {
  const api = new StudioApi('https://script.google.com/a/macros/example.com/s/test-deployment/exec', async (url, options) => {
    assert.equal(url.searchParams.get('api'), 'packages');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify({ bundles: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  let opened;
  const handoff = new AuthHandoff(api, url => { opened = url; });
  try {
    const url = new URL(await handoff.start('automatic'));
    assert.equal(opened, url.toString());
    assert.equal(url.searchParams.get('mcp_auth'), '1');
    assert.equal(url.hostname, 'script.google.com');
    const callback = `http://127.0.0.1:${url.searchParams.get('port')}/callback?state=${url.searchParams.get('state')}`;
    assert.deepEqual(handoff.status(), { state: 'waiting_for_browser', authenticated: false });
    const invalid = await fetch(callback.replace(/state=[a-f0-9]+/, 'state=wrong'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token })
    });
    assert.equal(invalid.status, 403);
    const submitted = await fetch(callback, {
      method: 'POST', headers: { Origin: 'https://example-script.googleusercontent.com', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token })
    });
    assert.equal(submitted.status, 200);
    assert.deepEqual(handoff.status(), { state: 'authenticated', authenticated: true });
    assert.equal(handoff.server, null);
  } finally {
    handoff.close();
  }
});
