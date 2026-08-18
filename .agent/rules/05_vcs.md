# Version Control

- リポジトリは [Inventia](https://github.com/Nlkomaru/inventia) です。
- ブランチを作成する場合は最新の `main` から作成し、PR の base は `main` にします。
- merge はユーザーの明示的な依頼を受けてから行います。push と PR 作成は「作業完了時」の手順に従います。
- ユーザーの作業中の変更を revert、reset、checkout、強制 push しません。
- 秘密情報、ローカル DB、`.dev.vars`、生成済み認証情報をコミットしません。
- D1 のスキーマ変更は再現可能なマイグレーションとしてコミットし、手動変更だけで済ませません。

## 作業完了時

依頼された作業が完了したら、追加の指示を待たずに次を行います。

1. 最新の `main` から作業ブランチを作成します。作業前に作成済みであればそのブランチを使います。
2. 変更をレビューしやすい単位に分けてコミットします。
3. ブランチを push します。
4. base を `main` にして PR を作成します。
5. migration を追加した場合は `wrangler d1 migrations apply <database> --remote` で本番 D1 へ適用します。

既存データを失う migration（列やテーブルの削除、既存行の書き換え）だけは、適用前にユーザーへ確認します。
作業が途中で、動作確認まで終わっていない場合はコミットまでに留め、残りをユーザーへ伝えます。

## コミット

コミットメッセージは英語で、次の形式にします。

```text
<emoji> <imperative summary>
```

例:

```text
📦 Add extensible inventory identifiers
```

## Issue

- 新機能を追加する場合は、依頼されたときに英語で Issue を作成します。
- 既存ラベルだけを使用し、ラベルを勝手に作成しません。

## Pull Request

- タイトルはコミットと同様に emoji から始めます。
- 本文は日本語で、変更内容、データ移行の有無、API/MCP 契約、動作確認結果を記載します。
