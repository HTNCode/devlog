# Devlog

Notionの課題DBを土台にした、Backlog風のチケット管理modです。Claude Codeの中で、手を止めずに課題を確認・更新できます。

- `/devlog`で課題一覧をペインに表示（未完了 / 今週期限 / 進行中 / 人の担当）
- 行を選んでEnter、または ▸ で本文の要約を表示（Escで閉じる）
- gitブランチ名の課題キー（例: `feat/sek-08-x` → `SEK-08`）から、今の課題をプロンプトの上に表示
- 「着手」でチケットを引用した文章をプロンプトに入れる（送信はしない）
- ガントチャートで期間を表示し、キーやドラッグで期限を変更
- Claudeが実行した`git commit` / `gh pr merge`を検知して状態変更を提案
- 添付ファイルの一覧・保存・画像プレビュー・アップロード
- 起票フォーム（必須項目がそろうまで確定できない）

Notionへの書き込みは、すべて人が「確定」を押したときだけ行います。書き込みの直前にNotionを読み直し、変わっていれば上書きしません。

## 必要なもの

- function hooks（mods）が使えるClaude Code
- claude.aiのNotionコネクタ（`/mcp`に`claude.ai Notion`が出ていること）

## インストール

Claude Codeのプロンプトで次を実行し、`y`でマーケットプレイスを追加します。

```
/plugin install notion-backlog --marketplace HTNCode/devlog
```

シェルからなら:

```
claude plugin install notion-backlog --marketplace HTNCode/devlog
```

## 設定

インストール時の設定画面、または`/config`の`notion-backlog`の項目で、次を設定します。

| 項目 | 内容 | 既定値 |
| --- | --- | --- |
| `dataSource` | 課題DBのURL、または`collection://`のID（必須） | なし |
| `server` | NotionのMCPサーバー名 | `claude.ai Notion` |
| `propTitle`ほか | DBのプロパティ名（下の表） | 下の表 |
| `statusTodo` / `statusDoing` / `statusDone` | 状態の選択肢の名前 | 未着手 / 進行中 / 完了 |
| `ownerHuman` | 人の担当を示すラベルの名前 | 人間 |

DBには次の種類のプロパティが必要です。名前は設定で変えられます。名前や種類が合わないときは、読み取り専用で動きます。

| 設定項目 | 既定の名前 | 種類 |
| --- | --- | --- |
| `propTitle` | タスク/プロジェクト名 | タイトル |
| `propStatus` | ステータス | ステータス |
| `propPriority` | 優先順位 | セレクト |
| `propCategory` | カテゴリー | セレクト |
| `propTags` | 案件タグ | マルチセレクト |
| `propOwner` | 人間ラベル | ステータス |
| `propStart` | 開始日 | 日付 |
| `propEnd` | 終了日 | 日付 |

課題キーは、件名の中の`SEK-08`のような「英大文字で始まる英数字-数字」の部分から取ります。

## 使い方

| コマンド | 動き |
| --- | --- |
| `/devlog` | 課題ペインを開く |
| `/devlog new` | 起票フォームを開く |
| `/devlog list` / `week` / `doing` / `human` | 一覧をテキストで返す |
| `/devlog refresh` | 読み込み直す |

ペインの中のキー: `1`〜`4`タブ、`g`ガント、`r`更新、`n`起票、`c` URLコピー、`w`着手、`a`添付、`y`確定、`x`取消、`Esc`要約 → ペインの順に閉じる。ガントでは`k` / `j`で選択、`h` / `l`で期限、`b` / `f`で期間を1日ずつ動かします。すべての操作にボタンとキーがあるので、tmuxやherdrの中でもマウスなしで使えます。

フルスクリーン表示で端末幅が110桁以上あると、ペインはトランスクリプトの横に並びます。それ以外ではプロンプトの上に表示されます。

## 安全面

- Notionへの書き込み（状態・期間の変更、起票、案件タグの追加、添付）は確定ボタンを押したときだけ
- チケットの本文はほかの人も書けるデータとして扱い、Claudeには引用データとして渡す
- 要約はツールも会話履歴も持たないモデル呼び出しで作る
- 添付の保存先は`~/Downloads/notion-backlog/<課題キー>/`。保存しても自動では開かない
- Claude自身がNotionツールで行う書き込みは止めない

## 開発

```
claude plugin validate .
claude plugin test .
```

## ライセンス

[The Unlicense](LICENSE)（パブリックドメイン）
