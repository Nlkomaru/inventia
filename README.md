# Inventia

pnpm workspace containing the TanStack Start application and its component
workbench.

## Packages

- `app/` — TanStack Start on Cloudflare Workers, Hono API, MCP endpoint, Base UI components, and TanStack Table

## Development

Install all workspace dependencies:

```bash
pnpm install
```

Run the app and Storybook together:

```bash
pnpm dev
```

The app listens on <http://localhost:3000> and Storybook on
<http://localhost:6006>. To run one package:

```bash
pnpm --filter inventia dev
pnpm --filter @inventia/storybook dev
```

## API

TanStack Start forwards `/api/*` to the Hono app in `app/src/api/app.ts`.

| Path | Purpose |
| --- | --- |
| `/api/health` | Health status and deployment timestamp |
| `/api/openapi` | OpenAPI 3.1 document |
| `/api/scalar` | Scalar API reference |
| `/api/mcp` | Stateless MCP Streamable HTTP endpoint |
| `/api/stores` | Store master data and favicon images |
| `/api/settings/integrations/openrouter` | OpenRouter integration status and encrypted API key configuration |

The MCP server exposes these tools through the same services as the HTTP API:

| Area | Tools |
| --- | --- |
| System | `get_health` |
| Inventory | `search_inventory`, `get_inventory_item` |
| Locations | `list_locations`, `get_location`, `create_location`, `update_location`, `delete_location` |

## Verification

```bash
pnpm check
pnpm build
```

### Bindings during development

`app/wrangler.jsonc` binds the deployed D1 database, R2 bucket and Vectorize
index, and `dev`, `build` and `preview` all connect to them. There is no local
emulation, so **`dev` and `preview` read and write production data**.

The deployed Worker sits behind Cloudflare Access, so the remote bindings need
an Access service token. Put it in `app/.env`, which Vite loads into the
environment Wrangler reads:

```dotenv
CLOUDFLARE_ACCESS_CLIENT_ID=...
CLOUDFLARE_ACCESS_CLIENT_SECRET=...
```

## Cloudflare deployment

Authenticate and deploy the app package with the workspace-local Wrangler:

```bash
pnpm --filter inventia exec wrangler login
pnpm --filter inventia deploy
```

Store production secrets with
`pnpm --filter inventia exec wrangler secret put <NAME>`; keep non-secret
variables and bindings in `app/wrangler.jsonc`.

The OpenRouter settings page stores its API key encrypted in D1. Production
deployments sync the repository Actions secret `SETTINGS_ENCRYPTION_KEY` to the
Worker through `cloudflare/wrangler-action`. For local development, set a
32-byte base64 value in the same variable in an untracked `app/.dev.vars` file.
Never commit either value. Keep this encryption key stable; after rotating it,
save the OpenRouter API key again from the settings page.

The settings API changes a shared application-wide credential. Keep the Worker
and `/api/settings/integrations/*` behind the existing Cloudflare Access
application.

Local development normally uses the remote D1 database configured in
`app/wrangler.jsonc`, which requires Wrangler account authentication. In a
non-interactive environment, expose a Cloudflare Access service token instead:

```bash
export CLOUDFLARE_ACCESS_CLIENT_ID=<CLIENT_ID>
export CLOUDFLARE_ACCESS_CLIENT_SECRET=<CLIENT_SECRET>
pnpm --filter inventia dev
```

When both variables are present, Vite proxies `/api` to the deployed Worker and
adds the service-token headers on the server side. This avoids Wrangler's
interactive OAuth flow; the credentials are not exposed to browser code. All
API writes in this mode modify the deployed D1 database. Keep both values
outside the repository and configure a Service Auth policy on the existing
Access application that protects the Worker.
