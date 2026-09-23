# Markdown＋Mermaid ビューア

公開 URL: **https://yorozu-craft.com/md-viewer/**

インストール不要のMarkdownエディタ。Mermaidの図も描ける1ファイルのHTMLをダウンロードして、ダブルクリックで開くだけ。通信しないのでオフラインや社内のPCでも使えます。
yorozu-craft のツールの1つです（共通ルールは [youheioonuki.github.io の README](https://github.com/YouheiOonuki/youheioonuki.github.io) を参照）。

## 本体はダウンロード版の 1 ファイル

2026-09-23 のオーナー決定（yorozu-plans の ROADMAP「実装順の変更と 06 の方針」）により、**`md-viewer.html`（1 ファイルの HTML）が本体**。インストール不要・通信なし・広告と解析なし。`index.html` は紹介とダウンロードのページで、広告とアクセス解析はここと `guide.html` だけに入れる。「ブラウザで試す」はダウンロード版と同じ `md-viewer.html` を開く。

| ページ | 広告・解析 | 検索 |
|-------|-----------|------|
| `index.html`（紹介・ダウンロード） | AdSense・Cloudflare ビーコンあり | index |
| `guide.html`（使い方） | AdSense・Cloudflare ビーコンあり | index |
| `md-viewer.html`（本体） | **なし**（外部への通信を一切しない） | `noindex`、sitemap に載せない |

## 機能

- 編集とプレビューを左右に並べる（幅 760px 以下は「編集・プレビュー・目次」のタブ切り替え）
- GFM（表・タスクリスト・取り消し線・自動リンク・コードブロック）。自動リンクは日本語の文字（「）」「。」など）の手前で止める
- ```` ```mermaid ```` のブロックを図にする。Markdown の再描画は 150ms、図は入力が止まってから 500ms 後に描く。同じコードの図はキャッシュから出す
- 見出しから目次（サイドバー。押すとその見出しへ移動）。見出しの id は見出しの文字から作る（`core.js` の `slugify`。日本語はそのまま、同じ見出しには `-1`, `-2`）
- `.md` を開く（ファイル選択・ドラッグ＆ドロップ。UTF-8 で読めなければ Shift_JIS）、`.md` で保存（ダウンロード、Ctrl+S）
- **1 ファイルの HTML に書き出す**：図は SVG で埋め込み、JavaScript を含まない（書き出した HTML の `Content-Security-Policy` でも script を禁止）。印刷用 CSS で表・図・コードブロックをページの途中で切れにくくする（`break-inside: avoid`）
- Excel・スプレッドシートの表（タブ区切り）を Markdown の表に変換：貼り付けを自動判定（タブを含み 2 行以上。コードブロックの中は除く。お知らせから「元の文字で貼り付け」に戻せる）と、「表の貼り付け」ボタンのダイアログ。結合セル・空のセルは空欄、`|` は `\|`、セル内の改行は `<br>`、Excel の `"…"` 囲み（`""` は `"`）に対応、数字だけの列は右寄せ
- 安全性：DOMPurify で無害化（`style`・`form` などの要素も禁止）、mermaid は `securityLevel: 'strict'`・`startOnLoad: false`
- 下書きの自動保存 `md-viewer_draft`、設定 `md-viewer_settings`（try/catch。保存できない環境では 1 回だけ警告）
- 初めて開いたときは見本の文章（見出し・表・タスクリスト・フローチャート）

### 通信しないことの担保

- `md-viewer.html` の先頭の `Content-Security-Policy`：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`。インターネット上の画像も表示しない（data: の画像だけ）。文書の中のリンクは押したときだけ新しいタブで開く
- `tests/build.test.js`：外部を読む要素（`script src`・`link stylesheet` など）・広告と解析のコード・本ツールのコードの `fetch` などが無いこと、CSP の中身を確かめる
- ブラウザでの確認（2026-09-23、Playwright の Chromium、`file://` と `http://127.0.0.1`）：見本の文章を開いて操作したとき、ページ自身以外のリクエストは 0 件。外部の画像を書いた文書では、画像の読み込みがすべて CSP で止まる

### 対応している図

2026-09-23 に mermaid 12.0.0 で描けることを確かめたもの：flowchart・sequenceDiagram・classDiagram・stateDiagram-v2・erDiagram・journey・gantt・pie・quadrantChart・requirementDiagram・gitGraph・C4Context・mindmap・timeline・sankey-beta・xychart-beta・block-beta・packet-beta・kanban・architecture-beta・radar-beta・treemap-beta、`layout: elk`。**ZenUML は非対応**（mermaid の本体に入っておらず、外部から読み込む作りのため）。

## ビルド方法

```sh
npm ci            # package.json で固定したライブラリ（marked・mermaid・DOMPurify）を入れる
node build.mjs    # md-viewer.html と THIRD_PARTY_LICENSES.txt を作る
node --test tests/*.test.js
```

- `build.mjs` は依存パッケージなし。`src/app.html` に `src/app.css`・`src/doc.css`・ライブラリのブラウザ用ビルド（`dompurify/dist/purify.min.js`・`marked/lib/marked.umd.js`・`mermaid/dist/mermaid.min.js`）・`src/core.js`・`src/app.js` をそのまま埋め込む
- 埋め込む JS に `</script` があれば `<\/script` にし、`<script` があればビルドを止める（今のライブラリには無い）。`src/*.js` にも「`<` のすぐ後ろに script」と書かない
- 同じ入力なら同じ `md-viewer.html` になる（日付などを入れない）。CI（`.github/workflows/test.yml`）で `npm ci && node build.mjs` のあと差分が無いことを確かめるので、**`src/` やライブラリを直したら、ビルドした `md-viewer.html` も一緒にコミットする**（GitHub Pages はリポジトリのファイルをそのまま配る）
- サイズ（2026-09-23 のビルド）：`md-viewer.html` 約 5.6MB（企画の目標 10MB 以下）。うち mermaid.min.js 5,575,485・marked.umd.js 46,891・purify.min.js 28,885 バイト。ビルドのたびに `node build.mjs` がバイト数を表示する。ライブラリを更新したら紹介ページの「約 5.6MB」も直す

## ライブラリとライセンス

| ライブラリ | バージョン | ライセンス | 埋め込むファイル |
|-----------|-----------|-----------|----------------|
| marked | 18.0.14 | MIT | `lib/marked.umd.js` |
| mermaid | 12.0.0 | MIT | `dist/mermaid.min.js` |
| DOMPurify | 3.4.16 | MPL-2.0 OR Apache-2.0（Apache-2.0 を選択） | `dist/purify.min.js` |

- `package.json` の `devDependencies` にバージョンを固定（`^` なし）。`package-lock.json` もコミットする
- ライセンス全文は `build.mjs` が集めて `THIRD_PARTY_LICENSES.txt` と `md-viewer.html` の末尾（`<script type="text/plain" id="licenses">`、画面の「ライセンス」ボタンで表示）に入れる。集め方：3 つのライブラリから `dependencies` をたどった全パッケージ（`@types/*` を除く）＋ mermaid の配布ファイルに組み込まれているが npm では入らないパッケージ（`licenses/extra.json` と `licenses/*.txt`。js-yaml・fastdom・langium・chevrotain-allstar・vscode-jsonrpc ほか）。2026-09-23 時点で 94 パッケージ
- 内訳（2026-09-23）：MIT 45・ISC 33・Apache-2.0 6・BSD-3-Clause 6・EPL-2.0 1（elkjs）・Unlicense 1（robust-predicates）・MPL-2.0 OR Apache-2.0 1（DOMPurify）・khroma 1（下記）
- **elkjs**（0.9.3、package.json の license は `EPL-2.0`）：`mermaid.min.js` の中に入っている（"Eclipse Layout Kernel" の文字列と、`mermaid.js` の中の `elkjs@0.9.3` のパスで確認）。EPL-2.0 の本文と、ソースコードの入手先（https://github.com/kieler/elkjs 、npm の `elkjs@0.9.3`）を `THIRD_PARTY_LICENSES.txt` の冒頭に書いている
- **khroma**（2.1.0）：package.json に `license` の欄が無いが、同梱の `license` ファイルは MIT License（Copyright (c) 2019-present Fabio Spampinato, Andrew Maney）
- mermaid 12.0.0 の中には、mermaid のビルド時の DOMPurify 3.4.12 と marked 16 系も入っている（ライセンスは同じ）
- `npm audit`（2026-09-23）：mermaid → chevrotain 11.1.2 → lodash-es 4.17.23 に high が 5 件（`_.template` と `_.unset`/`_.omit`）。`npm audit fix --force` は mermaid 11 に戻すので行っていない。mermaid の配布ファイルにはビルド時の lodash-es がそのまま入っているため、npm 側を直しても `md-viewer.html` は変わらない。次の mermaid の更新で解消を確かめる

## 保守

| 時期 | 確認すること | 直す場所 |
|------|------------|---------|
| 半年に 1 回（3 月・9 月ごろ） | marked・mermaid・DOMPurify の新しい版（特に DOMPurify と mermaid のセキュリティ修正）、`npm audit` | `package.json` のバージョン → `npm install` → `node build.mjs` → テスト → ブラウザで見本・図の種類・書き出しを確認 → `md-viewer.html`・`THIRD_PARTY_LICENSES.txt`・`package-lock.json` をコミット |
| 同上 | mermaid の配布ファイルに組み込まれるパッケージの変化（`node_modules/mermaid/dist/mermaid.js` の中の `node_modules/.pnpm/` のパスを見る） | `licenses/extra.json`・`licenses/*.txt` |
| ライブラリを更新したとき | ファイルサイズ、ライセンスの一覧 | `index.html` の「約 5.6MB」・JSON-LD の `fileSize`、`guide.html` の「ライセンス一覧」、この README |

直したら、`guide.html` の「更新履歴」に日付と内容を 1 行足す。

## ファイル

| ファイル | 役割 |
|---------|------|
| `md-viewer.html` | **本体**（ビルドで作る。ダウンロード版・「ブラウザで試す」の両方） |
| `index.html` | 紹介・ダウンロードのページ |
| `guide.html` | 使い方・オフラインでの使い方・Mermaid の書き方・Excel の表・書き出しと印刷・安全性・ライセンス一覧・よくある質問・ご利用上の注意・更新履歴 |
| `src/app.html` | 本体の HTML のひな形（`{{…}}` を build.mjs が埋める） |
| `src/app.css` | 本体の画面の見た目（和紙風の配色、ダークモード対応） |
| `src/doc.css` | 文書（プレビューと書き出した HTML）の見た目・印刷用 CSS |
| `src/core.js` | 画面から切り離した純粋関数（`tsvToMarkdown`・`parseTSV`・`extractToc`・`slugify`・`escapeHtml`・`buildExportHtml` など。UMD） |
| `src/app.js` | 本体の画面の制御・描画・保存・書き出し |
| `build.mjs` | `md-viewer.html` と `THIRD_PARTY_LICENSES.txt` を作る |
| `package.json` / `package-lock.json` | 埋め込むライブラリ（dev 依存、バージョン固定） |
| `licenses/` | mermaid の配布ファイルに組み込まれているが npm では入らないパッケージのライセンス本文 |
| `THIRD_PARTY_LICENSES.txt` | 同梱ライブラリのライセンス全文（ビルドで作る） |
| `style.css` | 紹介・使い方ページの見た目（和紙風の配色、ダークモード対応） |
| `404.html` | ツール配下の存在しない URL で出るページ（サイト共通のもの） |
| `favicon.svg` / `apple-touch-icon.png` / `og-image.png` | アイコン / ホーム画面用アイコン / SNS 共有用画像（1200×630） |
| `sitemap.xml` | サイトマップ（index.html と guide.html だけ。robots.txt はドメイン直下で管理） |
| `tests/core.test.js` | 純粋関数のテスト（表の変換・目次・自動リンク・書き出し） |
| `tests/build.test.js` | ビルドした `md-viewer.html` のテスト（外部への通信が無いこと・CSP・ライセンス） |

テストは `node --test tests/*.test.js`。`.github/workflows/test.yml` で push・PR のたびに、`npm ci`・ビルドの差分確認・テストを自動で行う。

## ライセンス

MIT License（`LICENSE`）。同梱ライブラリのライセンスは `THIRD_PARTY_LICENSES.txt`。
