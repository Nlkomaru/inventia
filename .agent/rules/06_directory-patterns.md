# ディレクトリ

- `app/src/routes/`: TanStack Router ページと API catch-all
- `app/src/components/`: shadcn/ui、Base UI、TanStack Table を使う共有 UI
- `app/src/{api,services,domain,repositories,db}/`: transport、ユースケース、業務型、永続化、DB
- `app/migrations/`: D1 migration
- `storybook/src/`: 共有 UI の stories

空のレイヤーや不要な barrel file は作りません。
