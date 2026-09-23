// 純粋関数のテスト: node --test tests/*.test.js
// （.github/workflows/test.yml で push・PR のたびに自動実行される）
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

// ---------- Excel の表（タブ区切り） ----------

test('受け入れ: タブ区切りの表を貼ると、正しい列数の Markdown の表になる', () => {
  const tsv = '名前\t部署\t内線\r\n山田\t総務\t1234\r\n佐藤\t経理\t5678\r\n';
  assert.equal(C.tsvToMarkdown(tsv), [
    '| 名前 | 部署 | 内線 |',
    '| --- | --- | ---: |',
    '| 山田 | 総務 | 1234 |',
    '| 佐藤 | 経理 | 5678 |',
  ].join('\n'));
});

test('セルの中の「|」はエスケープする', () => {
  const md = C.tsvToMarkdown('a\tb\nx|y\tz');
  assert.equal(md.split('\n')[2], '| x\\|y | z |');
});

test('Excel の「"」で囲んだセル: 中の改行は <br>、"" は " にする', () => {
  // Excel はセル内で改行したセルを "…" で囲み、中の " を "" にしてコピーする
  const tsv = '手順\t説明\r\n1\t"1 行目\n2 行目"\r\n2\t"「""OK""」を押す"\r\n';
  const rows = C.parseTSV(tsv);
  assert.deepEqual(rows, [['手順', '説明'], ['1', '1 行目\n2 行目'], ['2', '「"OK"」を押す']]);
  const md = C.tsvToMarkdown(tsv).split('\n');
  assert.equal(md[2], '| 1 | 1 行目<br>2 行目 |');
  assert.equal(md[3], '| 2 | 「"OK"」を押す |');
});

test('結合セル・空のセルは空欄のまま（列はずれない）', () => {
  // 結合したセルは、Excel では 2 つめ以降が空のセルとしてコピーされる
  const md = C.tsvToMarkdown('区分\t項目\t金額\n食費\t朝\t300\n\t昼\t800\n\t\t\n');
  assert.equal(md, [
    '| 区分 | 項目 | 金額 |',
    '| --- | --- | ---: |',
    '| 食費 | 朝 | 300 |',
    '|  | 昼 | 800 |',
  ].join('\n'));
});

test('行ごとに列の数が違うときは、いちばん多い列数にそろえる', () => {
  const md = C.tsvToMarkdown('a\tb\nx\ny\t3\t4').split('\n');
  assert.equal(md[0], '| a | b |  |');
  assert.equal(md[1], '| --- | ---: | ---: |');
  assert.equal(md[2], '| x |  |  |');
  assert.equal(md[3], '| y | 3 | 4 |');
});

test('閉じていない「"」や、途中の「"」はただの文字として読む', () => {
  assert.deepEqual(C.parseTSV('a"b\t"c\nd\t"e"f'), [['a"b', '"c'], ['d', '"e"f']]);
  assert.deepEqual(C.parseTSV('"x\ty'), [['"x', 'y']]);
});

test('数字の列は右寄せ、文字がまじる列は左寄せ', () => {
  const md = C.tsvToMarkdown('品目\t金額\t率\tメモ\nA\t1,200\t10%\t12a\nB\t-3.5\t\t5').split('\n');
  assert.equal(md[1], '| --- | ---: | ---: | --- |');
});

test('looksLikeTable: タブと 2 行以上がそろったときだけ表とみなす', () => {
  assert.equal(C.looksLikeTable('a\tb\nc\td'), true);
  assert.equal(C.looksLikeTable('a\tb'), false);            // 1 行だけ
  assert.equal(C.looksLikeTable('a\nb\nc'), false);         // タブがない
  assert.equal(C.looksLikeTable(''), false);
});

test('空・改行だけなら空文字', () => {
  assert.equal(C.tsvToMarkdown(''), '');
  assert.equal(C.tsvToMarkdown('\r\n'), '');
  assert.deepEqual(C.parseTSV(''), []);
});

// ---------- 目次 ----------

test('extractToc: ATX・Setext の見出しを拾い、コードブロックの中は拾わない', () => {
  const md = [
    '# はじめに',
    '',
    '## 手順 1: 申請書を **作る**',
    '',
    '```',
    '# これはコード',
    '```',
    '',
    '見出し 2',
    '--------',
    '',
    '### `code` と [リンク](https://example.com) #',
    '',
    '~~~md',
    '## これもコード',
    '~~~',
    '#タグ（見出しではない）',
  ].join('\n');
  assert.deepEqual(C.extractToc(md), [
    { level: 1, text: 'はじめに', id: 'はじめに' },
    { level: 2, text: '手順 1: 申請書を 作る', id: '手順-1-申請書を-作る' },
    { level: 2, text: '見出し 2', id: '見出し-2' },
    { level: 3, text: 'code と リンク', id: 'code-と-リンク' },
  ]);
});

test('同じ見出しには -1, -2 を付け、記号だけの見出しは section にする', () => {
  const ids = C.extractToc('# 概要\n# 概要\n# 概要\n# ！？').map((t) => t.id);
  assert.deepEqual(ids, ['概要', '概要-1', '概要-2', 'section']);
});

test('slugify: 日本語はそのまま、英字は小文字、記号は消える、々・ー は残る', () => {
  assert.equal(C.slugify('Step 1. Hello, World!'), 'step-1-hello-world');
  assert.equal(C.slugify('人々の「声」・アンケート'), '人々の声アンケート');
  assert.equal(C.slugify('  snake_case-and-dash  '), 'snake_case-and-dash');
});

// 目次の id が、画面に描いた見出しの id（見出しの文字から作る）とそろうことを marked で確かめる
test('extractToc の id は、marked で描いた見出しの文字から作る id と同じ', () => {
  let marked;
  try { ({ marked } = require('marked')); } catch (e) { return; }  // npm ci 前なら飛ばす
  const md = [
    '# Markdown＋Mermaid ビューアへようこそ',
    '## 手順 1: 申請書を **作る** & 出す',
    '## `a < b` の <em>比較</em>',
    '見出し\n===',
    '### [リンク](https://example.com) と ![画像](x.png) と <https://example.com>',
    '## 取り消し ~~線~~ と __太字__ と snake_case',
    '## 概要', '## 概要',
    '## エスケープ \\*星\\*',
  ].join('\n\n');
  const html = marked.parse(md, { gfm: true });
  const slug = C.createSlugger();
  const rendered = [...html.matchAll(/<h([1-6])>([\s\S]*?)<\/h\1>/g)].map((m) => {
    const text = C.htmlToText(m[2]);
    return { level: +m[1], id: slug(text) };
  });
  assert.deepEqual(C.extractToc(md).map((t) => ({ level: t.level, id: t.id })), rendered);
});

test('自動リンクは日本語の括弧・句読点の手前で終わる', () => {
  assert.equal(C.autolinkSource('https://example.com）と'), 'https://example.com');
  assert.equal(C.autolinkSource('https://example.com/a?b=1 次'), 'https://example.com/a?b=1');
  let Tokenizer, Marked;
  try { ({ Tokenizer, Marked } = require('marked')); } catch (e) { return; }  // npm ci 前なら飛ばす
  const base = Tokenizer.prototype.url;
  const mk = new Marked();
  mk.use({ tokenizer: { url(src) { return base.call(this, C.autolinkSource(src)); } } });
  assert.equal(mk.parse('リンク（https://example.com）です。www.example.com、'),
    '<p>リンク（<a href="https://example.com">https://example.com</a>）です。<a href="http://www.example.com">www.example.com</a>、</p>\n');
});

// ---------- HTML ----------

test('escapeHtml', () => {
  assert.equal(C.escapeHtml('<a href="x">\'&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('受け入れ: 書き出した HTML には script がない（JavaScript なしで表示できる）', () => {
  const html = C.buildExportHtml({
    title: '<題名>',
    bodyHtml: '<h1 id="a">題</h1><script>alert(1)</script><SCRIPT src="x.js"></SCRIPT><img src="x" onerror="alert(1)"><svg onload=alert(1)><rect/></svg><p>本文</p>',
    css: 'p{color:red}</style><script>alert(1)</script>',
  });
  assert.doesNotMatch(html, /<\s*script/i);
  assert.doesNotMatch(html, /\sonerror\s*=|\sonload\s*=/i);
  assert.match(html, /<title>&lt;題名&gt;<\/title>/);
  assert.match(html, /<p>本文<\/p>/);
  assert.match(html, /<h1 id="a">題<\/h1>/);
  assert.match(html, /Content-Security-Policy/);
  assert.equal((html.match(/<\/style>/g) || []).length, 1, 'CSS の中の </style> で要素が閉じない');
});

test('buildExportHtml: SVG（Mermaid の図）はそのまま残す', () => {
  const svg = '<svg id="m1" viewBox="0 0 10 10"><style>#m1 .node rect{fill:#eee}</style><g class="node"><rect width="5" height="5"></rect><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span>申請</span></div></foreignObject></g></svg>';
  const html = C.buildExportHtml({ title: 't', bodyHtml: '<div class="mermaid-block">' + svg + '</div>' });
  assert.ok(html.includes(svg));
});

test('safeFileName: ファイル名に使えない文字を除く', () => {
  assert.equal(C.safeFileName('a/b:c*?"<>|d'), 'abcd');
  assert.equal(C.safeFileName('   '), 'document');
  assert.equal(C.safeFileName('', '文書'), '文書');
});
