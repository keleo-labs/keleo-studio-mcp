#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { StudioApi } from './api.js';
import { AuthHandoff } from './auth.js';
import { RestStudioApi } from './rest-api.js';
import { OAuthHandoff } from './oauth.js';

const deployment = process.env.KELEO_STUDIO_URL;
if (!deployment) {
  console.error('Set KELEO_STUDIO_URL to the Keleo Studio API URL.');
  process.exit(1);
}

const backend = process.env.KELEO_STUDIO_BACKEND || 'gas';
if (!['gas', 'rest'].includes(backend)) throw new Error('KELEO_STUDIO_BACKEND must be gas or rest');
const authMode = backend === 'rest' ? process.env.KELEO_STUDIO_AUTH : 'gas';
if (backend === 'rest' && !['oauth', 'bearer', 'none'].includes(authMode)) throw new Error('KELEO_STUDIO_AUTH must be oauth, bearer, or none for REST mode');
if (authMode === 'bearer' && !process.env.KELEO_STUDIO_TOKEN) throw new Error('Set KELEO_STUDIO_TOKEN for bearer authentication');
if (authMode === 'oauth' && (!process.env.KELEO_STUDIO_OIDC_ISSUER || !process.env.KELEO_STUDIO_OAUTH_CLIENT_ID || !process.env.KELEO_STUDIO_OAUTH_SCOPES)) {
  throw new Error('Set KELEO_STUDIO_OIDC_ISSUER, KELEO_STUDIO_OAUTH_CLIENT_ID, and KELEO_STUDIO_OAUTH_SCOPES for OAuth');
}
const auth = authMode === 'gas' ? new AuthHandoff(new StudioApi(deployment))
  : authMode === 'oauth' ? new OAuthHandoff(process.env.KELEO_STUDIO_OIDC_ISSUER, process.env.KELEO_STUDIO_OAUTH_CLIENT_ID, process.env.KELEO_STUDIO_OAUTH_SCOPES)
  : null;
const api = backend === 'gas' ? auth.api : new RestStudioApi(deployment, authMode, authMode === 'oauth' ? auth : process.env.KELEO_STUDIO_TOKEN);

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function failure(error) {
  return { content: [{ type: 'text', text: error.message }], isError: true };
}

function register(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try { return result(await handler(args)); }
    catch (error) { return failure(error); }
  });
}

function createServer() {
  const server = new McpServer({ name: 'keleo-studio-mcp', version: '3.1.0' });
  if (authMode === 'gas') {
    register(server, 'start_auth', 'Open the Keleo Studio Apps Script token bridge in the user browser.', z.object({}), async () => ({ url: await auth.start('automatic'), instruction: 'Complete Google sign-in if prompted, then call auth_status.' }));
    register(server, 'start_auth_manual', 'Open a local page for manually pasting a Keleo Studio personal API token.', z.object({}), async () => ({ url: await auth.start('manual'), instruction: 'Complete the browser handoff, then call auth_status.' }));
  } else if (authMode === 'oauth') {
    register(server, 'start_auth', 'Open browser authorization for the Keleo Studio REST API.', z.object({}), async () => ({ url: await auth.start(), instruction: 'Complete sign-in in the browser, then call auth_status.' }));
  }
  register(server, 'auth_status', 'Check API readiness and authentication status without exposing credentials.', z.object({}), async () => {
    if (authMode === 'gas') return { ...auth.status(), expiresAt: api.authenticated ? new Date(api.expiresAt).toISOString() : null };
    if (authMode === 'oauth') { const status = auth.status(); return { ...status, expiresAt: status.authenticated ? new Date(auth.expiresAt).toISOString() : null }; }
    return { state: 'ready', authenticated: true, expiresAt: null };
  });
  if (auth) register(server, 'clear_auth', 'Discard the current token from MCP process memory.', z.object({}), async () => {
    if (authMode === 'gas') { api.clearToken(); auth.close(); }
    else auth.clear();
    return { authenticated: false };
  });
  register(server, 'list_packages', 'List imported Keleo Studio packages and their slugs.', z.object({}), async () => api.request('packages'));
  register(server, 'get_package', 'Get a package manifest by its exact slug.', z.object({ slug: z.string().min(1) }), async ({ slug }) => api.request('package', { slug }));
  register(server, 'get_download_url', 'Get the download URL for a package by exact slug.', z.object({ slug: z.string().min(1) }), async ({ slug }) => api.request('download', { slug }));
  register(server, 'list_documents', 'List indexed documents, optionally filtered by kind.', z.object({ kind: z.enum(['method', 'practice', 'baseline']).optional() }), async ({ kind }) => api.request('index', { kind }));
  register(server, 'get_document', 'Get full JSON for a document using its bundle slug and path from list_documents.', z.object({ bundle: z.string().min(1), path: z.string().min(1) }), async ({ bundle, path }) => api.request('document', { bundle, path }));
  register(server, 'get_openapi', 'Read the deployed Keleo Studio OpenAPI specification.', z.object({}), async () => api.request('openapi'));
  register(server, 'upload_package', 'Upload a local .keleo package file. Requires the user to have create permission.', z.object({ filePath: z.string().min(1).describe('Absolute path to a .keleo ZIP file on the MCP host') }), async ({ filePath }) => {
    if (!filePath.endsWith('.keleo')) throw new Error('Expected a .keleo file');
    const file = await stat(filePath);
    if (!file.isFile() || file.size > 50 * 1024 * 1024) throw new Error('Expected a regular .keleo file no larger than 50 MB');
    const bytes = await readFile(filePath);
    return api.request('upload', {}, { body: backend === 'gas' ? bytes.toString('base64') : bytes });
  });
  server.server.onclose = () => { if (authMode === 'gas') auth.close(); else auth?.clear(); };
  return server;
}

void serveStdio(createServer);
