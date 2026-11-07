## Keleo Studio MCP

This local MCP server gives agents tools for the Keleo Studio package and document API. It runs on your computer through stdio. For authentication, it opens a Keleo Studio page in your default browser; that page uses Apps Script's own token function and sends the result to a one-time local callback.

## Set up

Use Node.js 20 or later. From this directory, run `npm install`. Configure your MCP client to launch `node` with the absolute path to `src/server.js`, and set `KELEO_STUDIO_URL` to your deployment's `/exec` URL. Both `script.google.com/macros/s/.../exec` and Workspace domain URLs such as `script.google.com/a/macros/example.com/s/.../exec` are accepted. For example:

For Codex, run `codex mcp add keleo-studio --env KELEO_STUDIO_URL=YOUR_EXEC_URL -- node /absolute/path/to/keleo-studio-mcp/src/server.js`, then restart or reload the MCP connection.

```json
{
  "mcpServers": {
    "keleo-studio": {
      "command": "node",
      "args": ["/absolute/path/to/keleo-studio-mcp/src/server.js"],
      "env": {
        "KELEO_STUDIO_URL": "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
      }
    }
  }
}
```

Call `start_auth`. The server opens Keleo Studio in your default browser. Complete Google sign-in there if asked. Its `mcp-auth` page calls the same `getPersonalApiToken` Apps Script function as the API Reference, then posts the token to the MCP callback on `127.0.0.1`. The MCP validates it with the packages API. Poll `auth_status` until it reports `authenticated`. The token stays in MCP process memory, is discarded after 50 minutes or an authentication failure, and must be obtained again after the MCP process restarts.

The callback accepts a single token for a random one-time state and listens only on `127.0.0.1`. The token is posted in the request body, never placed in a URL. If the deployed app does not yet include the bridge, call `start_auth_manual` for the original paste page. The server never sends the token in a tool response or writes it to disk.

## Tools

`start_auth`, `start_auth_manual`, `auth_status` and `clear_auth` manage the local token. `list_packages`, `get_package`, `get_download_url`, `list_documents`, `get_document` and `get_openapi` read the library. `upload_package` reads a local `.keleo` ZIP file and sends its base64 contents to `?api=upload`; the account needs create permission.

Each API call uses the deployment's `?api=` query parameter and an `Authorization: Bearer` header. If Google returns a sign-in page or rejects the token, call `start_auth` again. A package slug identifies one package; document paths come from `list_documents`.

The deployment must be accessible to your Google account. Its Apps Script manifest sets domain access and execution as the accessing user. The server uses the API implemented in `keleo-studio-gas/src/Code.gs`, including its OpenAPI description. [Google's Apps Script reference](https://developers.google.com/apps-script/reference/script/script-app#getOAuthToken()) documents that `ScriptApp.getOAuthToken()` returns a short lived token for the effective user; the app's API Reference is the source for this personal token workflow.

## Verify

Run `npm test` for local API and handoff tests. To verify a real deployment, set `KELEO_STUDIO_URL` and run `npm run check:live`. The check opens the Apps Script bridge and calls `list_packages` after authentication. It prints only the package count, never the token. Deploy the matching `keleo-studio-gas` version before running the live check.

## Migrating from 2.x

In 3.0.0, `start_auth` opens an Apps Script token bridge in your existing browser. Deploy the updated `keleo-studio-gas` web app before using it. Use `start_auth_manual` if you need the local paste page while the deployment is pending. The dedicated Playwright browser profile from 2.x is no longer used.
