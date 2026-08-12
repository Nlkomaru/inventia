# Inventia

Inventia は Web UI、HTTP API、MCP から同じデータと業務ルールを利用する在庫管理システムです。

## 構成

- `app/`: TanStack Start / Router / Table、React 19、shadcn/ui、Base UI、Tailwind CSS v4、Hono、Drizzle、Cloudflare Workers / D1
- `storybook/`: `app/src/components/` の Storybook
- `/api/*`: Hono API（OpenAPI、Scalar、Streamable HTTP MCP を含む）

品目、物理的な所蔵、入出庫による数量変動を分離し、UI、HTTP、MCP の業務処理は service 層で共有します。
