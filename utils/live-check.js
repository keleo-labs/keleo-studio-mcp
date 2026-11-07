#!/usr/bin/env node
// Diagnostic client for the configured local MCP server. It never prints the token.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const deployment = process.env.KELEO_STUDIO_URL;
if (!deployment) {
  console.error('Set KELEO_STUDIO_URL to the deployed Keleo Studio /exec URL.');
  process.exit(1);
}

const child = spawn(process.execPath, [new URL('../src/server.js', import.meta.url).pathname], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit']
});
const pending = new Map();
let id = 0;

createInterface({ input: child.stdout }).on('line', line => {
  let message;
  try { message = JSON.parse(line); }
  catch { console.error('Invalid MCP output'); child.kill(); return; }
  if (pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(requestId, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`, error => {
      if (error) { pending.delete(requestId); reject(error); }
    });
  });
}

async function call(name, args = {}) {
  const response = await send('tools/call', { name, arguments: args });
  if (response.error) throw new Error(response.error.message);
  const tool = response.result;
  if (tool.isError) throw new Error(tool.content[0]?.text || 'MCP tool failed');
  return JSON.parse(tool.content[0].text);
}

try {
  const hello = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'keleo-studio-live-check', version: '3.0.0' }
  });
  if (hello.error) throw new Error(hello.error.message);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  await call('start_auth');
  console.error('Keleo Studio is opening in your browser. Complete Google sign-in there if needed.');
  let authenticated = false;
  let previousState = '';
  for (let attempt = 0; attempt < 120; attempt++) {
    await delay(2000);
    const status = await call('auth_status');
    if (status.state !== previousState) {
      console.error(`Browser authentication: ${status.state}`);
      previousState = status.state;
    }
    if (status.error) throw new Error(status.error);
    if (status.authenticated) { authenticated = true; break; }
  }
  if (!authenticated) throw new Error('Apps Script token bridge did not complete within four minutes. Is the bridge deployed?');
  const packages = await call('list_packages');
  if (!Array.isArray(packages.bundles)) throw new Error('The packages API did not return a bundles array.');
  console.log(`Live MCP API check passed: ${packages.bundles.length} packages returned.`);
} catch (error) {
  console.error(`Live MCP API check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}
