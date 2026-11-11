import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

test('stdio MCP advertises the API and auth tools without writing non-protocol output', async () => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, KELEO_STUDIO_BACKEND: 'gas', KELEO_STUDIO_URL: 'https://script.google.com/macros/s/test-deployment/exec' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout });
  const responses = [];
  lines.on('line', line => responses.push(JSON.parse(line)));
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = async id => {
    for (let i = 0; i < 100; i++) {
      const response = responses.find(item => item.id === id);
      if (response) return response;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`No MCP response for request ${id}`);
  };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
    const init = await waitFor(1);
    assert.equal(init.result.serverInfo.name, 'keleo-studio-mcp');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await waitFor(2);
    const names = listed.result.tools.map(tool => tool.name);
    assert.deepEqual(names, ['start_auth', 'start_auth_manual', 'auth_status', 'clear_auth', 'list_packages', 'get_package', 'get_download_url', 'list_documents', 'get_document', 'get_openapi', 'upload_package']);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'auth_status', arguments: {} } });
    const status = await waitFor(3);
    assert.deepEqual(JSON.parse(status.result.content[0].text), { state: 'idle', authenticated: false, expiresAt: null });
  } finally {
    child.stdin.end();
    await new Promise(resolve => child.once('exit', resolve));
  }
});

for (const mode of ['oauth', 'bearer', 'none']) {
  test(`REST ${mode} advertises only applicable authentication tools`, async () => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env, KELEO_STUDIO_BACKEND: 'rest', KELEO_STUDIO_AUTH: mode,
        KELEO_STUDIO_URL: 'https://studio.example/api/', KELEO_STUDIO_TOKEN: 'test-token',
        KELEO_STUDIO_OIDC_ISSUER: 'https://id.example', KELEO_STUDIO_OAUTH_CLIENT_ID: 'client', KELEO_STUDIO_OAUTH_SCOPES: 'openid studio.read'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const responses = [];
    createInterface({ input: child.stdout }).on('line', line => responses.push(JSON.parse(line)));
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    const waitFor = async id => {
      for (let i = 0; i < 100; i++) {
        const response = responses.find(item => item.id === id);
        if (response) return response;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`No MCP response for request ${id}`);
    };
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
      await waitFor(1);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const names = (await waitFor(2)).result.tools.map(tool => tool.name);
      assert.equal(names.includes('start_auth'), mode === 'oauth');
      assert.equal(names.includes('clear_auth'), mode === 'oauth');
      assert.equal(names.includes('start_auth_manual'), false);
      assert.ok(names.includes('upload_package'));
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'auth_status', arguments: {} } });
      const status = JSON.parse((await waitFor(3)).result.content[0].text);
      assert.equal(status.state, mode === 'oauth' ? 'idle' : 'ready');
    } finally {
      child.stdin.end();
      await new Promise(resolve => child.once('exit', resolve));
    }
  });
}
