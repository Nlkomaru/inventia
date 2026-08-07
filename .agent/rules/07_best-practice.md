# 在庫管理の設計原則

## 品目と在庫

- 品目の表示情報と在庫数量を分離します。
- 在庫変動は `receive`、`issue`、`adjust` など理由を持つ不変の履歴として記録します。
- 数量は整数で扱い、負数を許可するかは業務ルールとして明示します。
- 同時更新で数量を失わないよう、読み取り後の上書きではなく DB transaction 内の原子的な更新を使います。
- 更新系 API/MCP tool は重複実行への方針を持ちます。外部クライアントからの再送があり得る操作には idempotency key を保存します。

## 拡張可能な識別子

識別子は `item_identifiers` のような別エンティティとして管理し、品目テーブルへ `isbn`、`asin`、`jan` 列を増やし続けません。

最低限、次の情報を持たせます。

- `itemId`
- `scheme`: `isbn13`、`isbn10`、`asin`、`ean13`、`jan`、`sku`、`custom` など
- `value`: 検索・一意性判定に使用する正規化値
- `displayValue`: 必要な場合だけ、入力時の表示形式
- `issuer` または `namespace`: `custom` 値の衝突を避ける範囲

同一 `(scheme, normalized value, namespace)` の重複方針を DB 制約で表現します。識別子が同じでも複数の物理個体が存在できるため、識別子を所蔵個体 ID として使いません。

## ISBN

- 入力ではハイフン、空白、大文字小文字を正規化します。
- ISBN-10 と ISBN-13 は桁数だけでなくチェックディジットを検証します。
- ISBN-10 の末尾 `X` を許可します。
- ISBN-10/13 の変換を行う場合は変換可能性を検証し、元値と正規化値の関係をテストします。
- ISBN から取得したタイトル、著者、表紙などは外部メタデータです。ユーザーが編集した在庫情報を暗黙に上書きしません。

## Amazon URL と ASIN

外部 URL は `item_links` のような別エンティティとして管理します。最低限 `itemId`、`provider`、`url`、抽出できた `externalId`、取得日時を持たせます。

- URL は `new URL()` で解析し、文字列の部分一致だけで判定しません。
- `amazon.co.jp` など、許可する正規 host を明示します。見た目が似た host を受け入れません。
- `/dp/{ASIN}`、`/gp/product/{ASIN}` など、対応すると決めた pathname から ASIN を抽出します。
- tracking query、fragment は保存前に削除し、canonical URL を生成します。
- 短縮 URL は無条件に追跡しません。展開する場合は redirect 回数、timeout、応答サイズ、最終 host を制限して SSRF を防ぎます。
- ASIN と ISBN が同じ形でも同一 scheme として扱いません。

## MCP tool

MCP は DB の生 SQL 実行機能ではなく、在庫管理の安全なユースケースを提供します。基本 tool は次の粒度を基準にします。

- `search_inventory`: タイトル、識別子、在庫状態で検索
- `get_inventory_item`: 品目、識別子、リンク、数量を取得
- `create_inventory_item`: 品目と任意の識別子・リンクを登録
- `update_inventory_item`: 表示情報、識別子、リンクを明示的に更新
- `adjust_inventory_stock`: 理由、差分、idempotency key を伴う在庫調整
- `resolve_external_reference`: ISBN や対応 URL を検証・正規化し、候補メタデータを返す

実装済み tool だけを公開・文書化します。検索結果は件数上限と cursor を持ち、DB 全件や秘密情報を返しません。更新操作は認証・認可なしで公開しません。

## Database / D1

- パラメータを bind し、入力を SQL 文字列へ連結しません。
- 外部キー、unique、check、index を業務上の不変条件に合わせて定義します。
- migration は前方適用可能にし、既存行を考慮します。
- N+1 query を避け、検索条件と join に必要な index を追加します。
- ページング順は一意で安定させ、offset より cursor を優先します。
- DB row をそのまま API/MCP へ返さず、service で公開モデルへ変換します。

## テスト

テストは次の観測可能な契約を優先します。

- ISBN-10/13 の正常値、不正チェックディジット、区切り文字、末尾 `X`
- Amazon URL の対応 path、tracking 除去、不正 host、曖昧な ASIN
- 識別子の重複と namespace
- 入出庫、0 境界、負在庫方針、重複 idempotency key
- HTTP と MCP が同じ service 結果・エラー規則を返すこと
- D1 migration 後の制約と検索 index
