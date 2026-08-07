# Inventia の概要

Inventia は、日用品から書籍を含む多様な物品を登録、検索、入出庫できる在庫管理システムです。人が操作する Web UI と、外部の AI クライアントや自動化から利用する MCP エンドポイントが、同じ在庫データと業務ルールを共有します。

## ドメイン方針

- 在庫の中心は汎用的なものすべてとし、書籍だけに固定しません。
- ISBN、ASIN、JAN/EAN、SKU、管理番号などは、品目本体とは別の拡張可能な識別子として扱います。
- Amazon を含む外部 URL は、品目本体とは別の情報源リンクとして扱います。
- 「商品・作品」と「物理的な所蔵個体」と「数量の増減」を混同しません。
- 現在数量だけを上書きせず、入庫、出庫、棚卸調整などの在庫変動を追跡可能にします。
- UI、HTTP API、MCP は同じサービス層と検証処理を使用し、経路ごとに異なる業務ルールを作りません。

## 主な技術スタック

### アプリ (`app/`)

- TanStack Start + React 19
- TanStack Router のファイルベースルーティング
- Hono + Zod OpenAPI による HTTP API
- Model Context Protocol TypeScript SDK + `@hono/mcp` による Streamable HTTP MCP
- React Aria Components によるアクセシブルな UI
- Tailwind CSS v4
- Cloudflare Workers
- TypeScript 6、Vite 8、Biome

### コンポーネントカタログ (`storybook/`)

- Storybook
- `app/` に実装した UI コンポーネントのストーリー

### データベース

- Cloudflare Workers から利用するリレーショナルデータは D1 を第一候補とします。
- 外部 PostgreSQL/MySQL が必要になった場合は、Worker から直接接続せず Hyperdrive を使用します。
- Cloudflare リソースには REST API ではなく binding 経由でアクセスします。
- binding は `app/wrangler.jsonc` に定義し、`pnpm --filter inventia run cf-typegen` で型を生成します。

## 公開インターフェース

- `/api/*` は `app/src/api/app.ts` の Hono アプリへ転送されます。
- `/api/openapi` は OpenAPI 3.1 ドキュメントです。
- `/api/scalar` は API リファレンスです。
- `/api/mcp` はステートレスな MCP Streamable HTTP エンドポイントです。

HTTP API と MCP の追加・変更時は、スキーマ、説明、エラー、認可、業務処理を揃えてください。
