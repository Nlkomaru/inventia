# コーディングプラクティス

## 実装順序

1. 入出力スキーマとドメイン型を定義します。
2. 正規化、検証、在庫計算などを純粋関数として実装します。
3. データアクセスを repository に閉じ込めます。
4. 業務処理を service に実装します。
5. HTTP、MCP、UI から同じ service を呼びます。
6. 変更した経路を実際に起動して検証します。

## TypeScript

- `strict` を維持し、`any`、非 null アサーション、二重キャストで型エラーを隠しません。
- 外部入力は Zod で境界検証し、検証済みの型だけを内部へ渡します。
- Zod スキーマを型と API/MCP 契約の基準にし、同じ構造を手書きで重複させません。
- 日時は保存・API とも ISO 8601 UTC を基本にします。
- ID は暗号学的に安全な方法で生成します。
- 意図を言い換えるだけのコメントを各行へ追加しません。制約や理由だけを日本語で記述します。

## React / TanStack Start

- 関数コンポーネントと Hooks を使用します。
- サーバーデータを不要にクライアントのグローバル状態へ複製しません。
- `app/src/components/` の共有コンポーネントを再利用します。
- 対話 UI は React Aria Components を優先し、キーボード、フォーカス、ラベル、エラー通知を保ちます。
- Tailwind CSS v4 の既存トークンと記法を使用します。
- 1 コンポーネント 1 ファイルを基本とし、ファイル名と公開コンポーネント名を一致させます。

## Hono / API / MCP

- HTTP 入出力は `@hono/zod-openapi` のスキーマで定義します。
- MCP tool の `inputSchema` と `outputSchema` を必ず定義し、`structuredContent` とテキスト表現を返します。
- MCP handler 内へ SQL や業務ルールを直接書かず、HTTP API と共有する service を呼びます。
- MCP tool は小さく目的別にし、検索、詳細取得、登録、更新、在庫調整を曖昧な万能 tool にまとめません。
- 破壊的・更新系 tool は説明に副作用を明記し、対象 ID と変更内容を構造化入力で要求します。
- 内部例外、SQL、秘密情報をクライアントへ返しません。利用者が修正できる安定したエラーへ変換します。
- MCP transport/server は現在のステートレス構成に従い、リクエスト固有状態をモジュール変数へ保存しません。

## Cloudflare Workers

- D1、R2、KV などは binding 経由で使用します。
- request 固有の可変状態をモジュールスコープへ置きません。
- Promise は `await`、`return`、または実行コンテキストの `waitUntil` で明示的に処理します。
- 秘密情報は Wrangler secrets を使用し、`wrangler.jsonc` の `vars` には置きません。
- binding 変更後は `wrangler types` 相当の `pnpm --filter inventia run cf-typegen` を実行し、生成型を利用します。
- 外部 PostgreSQL/MySQL には Hyperdrive を使用します。

## 確認コマンド

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
pnpm --filter inventia dev
pnpm --filter inventia check
pnpm --filter inventia build
pnpm --filter inventia run cf-typegen
pnpm --filter @inventia/storybook dev
pnpm --filter @inventia/storybook check
pnpm --filter @inventia/storybook build
```

全体チェックだけでなく、変更した API、MCP tool、在庫操作、UI を直接実行してください。
