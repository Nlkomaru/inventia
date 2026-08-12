# 実装規約

## TypeScript / React

- `strict` を維持し、`any`、非 null アサーション、二重キャストで型エラーを隠しません。
- 外部入力は Zod で検証し、日時は ISO 8601 UTC、ID は暗号学的に安全な方法を使用します。
- TanStack Router のファイルベースルートはページを `routes/<path>/index.tsx` に置き、URL を変えない分類には pathless route を使用します。
- UI は既存の shadcn/ui コンポーネントを再利用し、そのプリミティブである Base UI の composition (`render`) に従います。
- 表形式データは TanStack Table を使用し、キーボード操作、フォーカス、ラベル、空状態を保ちます。
- Tailwind CSS v4 の既存トークンを使い、コンポーネント固有 CSS や状態の重複を避けます。

## 境界

- `routes` / `api` / `mcp` / UI → `services` → `domain` の依存方向を守り、SQL は `repositories` に閉じ込めます。
- HTTP は Zod OpenAPI、MCP tool は入出力 schema を契約の基準にし、同じ service を呼びます。
- Cloudflare リソースは binding 経由で利用し、秘密情報は Wrangler secrets または環境変数に置きます。
- D1 schema 変更は migration として追加し、binding 変更後は `pnpm --filter inventia run cf-typegen` を実行します。
