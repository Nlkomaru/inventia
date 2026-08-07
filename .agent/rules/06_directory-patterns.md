# ディレクトリ配置規則

Inventia は pnpm workspace です。アプリと Storybook の責務を混在させません。

## ルート

- `package.json` — workspace 共通コマンド
- `pnpm-workspace.yaml` — workspace 定義
- `biome.json` — 共通フォーマット・Lint 設定
- `.agent/rules/` — エージェント向けルールの分割ソース

## `app/`

- `app/src/routes/` — TanStack Router のページと API catch-all route
- `app/src/components/` — 再利用可能な React Aria UI コンポーネント
- `app/src/api/` — Hono の HTTP/MCP transport と公開契約
- `app/src/domain/` — 在庫、品目、識別子、外部リンクの型・純粋な業務ルール
- `app/src/services/` — HTTP/UI/MCP で共有するユースケース
- `app/src/repositories/` — D1 などの永続化実装と query
- `app/src/mcp/` — MCP tool 定義。transport は API 層、業務処理は service 層へ委譲
- `app/src/db/` — DB schema、migration 補助、DB 固有の型
- `app/migrations/` — 順序付き D1 migration
- `app/wrangler.jsonc` — Worker 設定と非 secret binding

上記の未作成ディレクトリは、その責務の最初の実装時にだけ作成します。小規模な段階で空のレイヤーや barrel file を先に作りません。

## `storybook/`

- `storybook/src/*.stories.tsx` — `app/src/components/` のストーリー
- `storybook/.storybook/` — Storybook 設定

## 依存方向

```text
routes / api / mcp / UI
          ↓
       services
          ↓
        domain
          ↑
     repositories
```

- domain は Hono、React、MCP、Cloudflare binding に依存しません。
- service は transport 固有の Request/Response に依存しません。
- repository は SQL と保存形式を外側へ漏らしません。
- API と MCP が互いを HTTP 経由で呼び出しません。同じ service を直接利用します。
