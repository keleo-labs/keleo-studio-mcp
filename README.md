## Keleo Studio MCP

This local MCP server gives agents tools to read and upload Keleo Studio library content. It runs through stdio and supports the existing Google Apps Script deployment or a REST deployment with the same library responses.

## Set up

Use Node.js 20 or later. Run `npm install`, then configure your MCP client to launch `node` with the absolute path to `src/server.js`. Set these environment variables for the backend you use:

| Backend | Required configuration |
|---|---|
| Apps Script (default) | `KELEO_STUDIO_URL=https://script.google.com/macros/s/.../exec` |
| REST with OAuth | `KELEO_STUDIO_BACKEND=rest`, `KELEO_STUDIO_AUTH=oauth`, `KELEO_STUDIO_URL`, `KELEO_STUDIO_OIDC_ISSUER`, `KELEO_STUDIO_OAUTH_CLIENT_ID`, `KELEO_STUDIO_OAUTH_SCOPES` |
| REST with bearer token | `KELEO_STUDIO_BACKEND=rest`, `KELEO_STUDIO_AUTH=bearer`, `KELEO_STUDIO_URL`, `KELEO_STUDIO_TOKEN` |
| REST without authentication | `KELEO_STUDIO_BACKEND=rest`, `KELEO_STUDIO_AUTH=none`, `KELEO_STUDIO_URL` |

For REST, set `KELEO_STUDIO_URL` to the API base path, such as `https://studio.example/api/`. REST authentication mode is required; the server never switches modes after an authentication failure. HTTPS is required except for a loopback development URL. The server does not write tokens to disk or include them in tool responses.

For Codex with Apps Script, run `codex mcp add keleo-studio --env KELEO_STUDIO_URL=YOUR_EXEC_URL -- node /absolute/path/to/keleo-studio-mcp/src/server.js`, then reload the MCP connection. A REST bearer configuration uses the same command with `KELEO_STUDIO_BACKEND=rest`, `KELEO_STUDIO_AUTH=bearer` and the REST URL and token supplied as additional `--env` values.

## Authentication

For Apps Script, call `start_auth`. Keleo Studio opens in your browser, calls its `getPersonalApiToken` function and posts the token to a one-time callback on `127.0.0.1`. If the deployment lacks that bridge, use `start_auth_manual` to paste a token. Apps Script tokens remain in process memory for up to 50 minutes.

For REST OAuth, call `start_auth` and complete sign-in in the browser. The server discovers the authorization and token endpoints from the configured OIDC issuer, uses authorization code with PKCE and receives the code through a one-time loopback callback. Register the MCP client as a public client that accepts a loopback redirect URI with a variable port. Configure scopes that let its access token call the library API. The server refreshes the access token when the provider issues a refresh token; otherwise, sign in again when it expires.

For REST bearer mode, the server sends `KELEO_STUDIO_TOKEN` in an `Authorization: Bearer` header. For REST `none` mode, it sends no authorization header. These modes need no browser handoff. `auth_status` reports readiness, but the API can still reject an operation. Remove or change a configured bearer token in your MCP environment and restart the server to change it.

## Tools and REST contract

`list_packages`, `get_package`, `get_download_url`, `list_documents`, `get_document`, `get_openapi` and `upload_package` are available in every mode. `auth_status` is also always available. `start_auth` and `clear_auth` appear for Apps Script and REST OAuth; `start_auth_manual` appears only for Apps Script.

Apps Script keeps its `?api=` routing and base64 text upload. The REST backend must implement the following resource routes and return the same JSON shapes as Apps Script:

| Tool | REST request |
|---|---|
| `list_packages` | `GET /packages` |
| `get_package` | `GET /packages/{slug}` |
| `get_download_url` | `GET /packages/{slug}/download` |
| `list_documents` | `GET /documents?kind=...` (optional filter) |
| `get_document` | `GET /documents/{bundle}/{path}` (the path can contain subdirectories) |
| `get_openapi` | `GET /openapi.json` |
| `upload_package` | `POST /packages` with raw `.keleo` bytes and `Content-Type: application/zip` |

The REST implementation must return JSON for these operations, including `{ "bundles": [...] }` for package lists, `{ "downloadUrl": "..." }` for download URLs and `{ "bundle": { ... } }` for uploads. Errors may use JSON or `application/problem+json`. The MCP validates the local `.keleo` file and its 50 MB size limit before upload. The REST service itself is a separate implementation.

## Verify

Run `npm test` for local API, authentication and MCP protocol tests. For a deployed backend, set its environment variables and run `npm run check:live`. The check signs in through a browser only when the selected mode requires it, calls `list_packages` and prints the package count without printing credentials.

## Migration

Existing Apps Script configurations continue to work without new environment variables. Version 3.0.0 introduced the Apps Script browser token bridge; its deployment still needs that bridge for `start_auth`. Version 3.1.0 adds REST mode and its explicit authentication setting.
