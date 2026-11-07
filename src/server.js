#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { StudioApi } from './api.js';
import { AuthHandoff } from './auth.js';

const deployment = process.env.KELEO_STUDIO_URL;
if (!deployment) {
  console.error('Set KELEO_STUDIO_URL to the deployed Keleo Studio /exec URL.');
  process.exit(1);
}

const api = new StudioApi(deployment);
const auth = new AuthHandoff(api);

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
  const server = new McpServer({ name: 'keleo-studio-mcp', version: '3.0.0' });
  register(server, 'start_auth', 'Open the Keleo Studio Apps Script token bridge in the user browser. Google sign-in may be required; the page automatically sends its token to this MCP process.', z.object({}), async () => ({ url: await auth.start('automatic'), instruction: 'Complete Google sign-in if prompted, then call auth_status.' }));
  register(server, 'start_auth_manual', 'Fallback: open a local page for manually pasting a Keleo Studio personal API token.', z.object({}), async () => ({ url: await auth.start('manual'), instruction: 'Complete the browser handoff, then call auth_status.' }));
  register(server, 'auth_status', 'Check authentication progress and token status without exposing the token.', z.object({}), async () => ({ ...auth.status(), expiresAt: api.authenticated ? new Date(api.expiresAt).toISOString() : null }));
  register(server, 'clear_auth', 'Discard the current token from MCP process memory.', z.object({}), async () => { api.clearToken(); auth.close(); return { authenticated: false }; });
  register(server, 'list_packages', 'List imported Keleo Studio packages and their slugs.', z.object({}), async () => api.request('packages'));
  register(server, 'get_package', 'Get a package manifest by its exact slug.', z.object({ slug: z.string().min(1) }), async ({ slug }) => api.request('package', { slug }));
  register(server, 'get_download_url', 'Get the Google Drive download URL for a package by exact slug.', z.object({ slug: z.string().min(1) }), async ({ slug }) => api.request('download', { slug }));
  register(server, 'list_documents', 'List indexed documents, optionally filtered by kind.', z.object({ kind: z.enum(['method', 'practice', 'baseline']).optional() }), async ({ kind }) => api.request('index', { kind }));
  register(server, 'get_document', 'Get full JSON for a document using its bundle slug and path from list_documents.', z.object({ bundle: z.string().min(1), path: z.string().min(1) }), async ({ bundle, path }) => api.request('document', { bundle, path }));
  register(server, 'get_openapi', 'Read the deployed Keleo Studio OpenAPI specification.', z.object({}), async () => api.request('openapi'));
  register(server, 'upload_package', 'Upload a local .keleo package file. Requires the user to have create permission.', z.object({ filePath: z.string().min(1).describe('Absolute path to a .keleo ZIP file on the MCP host') }), async ({ filePath }) => {
    if (!filePath.endsWith('.keleo')) throw new Error('Expected a .keleo file');
    const file = await stat(filePath);
    if (!file.isFile() || file.size > 50 * 1024 * 1024) throw new Error('Expected a regular .keleo file no larger than 50 MB');
    return api.request('upload', {}, { body: (await readFile(filePath)).toString('base64') });
  });
  server.server.onclose = () => auth.close();
  return server;
}

void serveStdio(createServer);
