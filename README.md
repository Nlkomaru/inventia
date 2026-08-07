# Inventia

pnpm workspace containing the TanStack Start application and its component
workbench.

## Packages

- `app/` — TanStack Start on Cloudflare Workers, Hono API, MCP endpoint, and
  React Aria components
- `storybook/` — Storybook for components implemented in `app/`

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
| `/api/health` | Typed health response |
| `/api/openapi.json` | OpenAPI 3.1 document |
| `/api/docs` | Scalar API reference |
| `/api/mcp` | Stateless MCP Streamable HTTP endpoint |

The MCP server exposes the `get_health` tool.

## Verification

```bash
pnpm check
pnpm build
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
