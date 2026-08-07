# Version Control

- リポジトリは [Inventia](https://github.com/Nlkomaru/inventia) です。
- ブランチを作成する場合は最新の `main` から作成し、PR の base は `main` にします。
- push、PR 作成、merge はユーザーの明示的な依頼を受けてから行います。
- ユーザーの作業中の変更を revert、reset、checkout、強制 push しません。
- 秘密情報、ローカル DB、`.dev.vars`、生成済み認証情報をコミットしません。
- D1 のスキーマ変更は再現可能なマイグレーションとしてコミットし、手動変更だけで済ませません。

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
