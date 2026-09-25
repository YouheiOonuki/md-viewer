// ビルドした md-viewer.html（ダウンロード版）のテスト: node --test tests/*.test.js
// 受け入れ: ダウンロード版の中に、外部へ通信するもの（http/https で読み込むもの）が入っていない
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'md-viewer.html'), 'utf8');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('外部のファイルを読み込む要素がない（script src・link href・img src など）', () => {
  assert.doesNotMatch(html, /<script[^>]*\ssrc\s*=/i, 'script src');
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']?stylesheet/i, 'link stylesheet');
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const l of links) assert.doesNotMatch(l, /href\s*=\s*["']?(https?:)?\/\//i, l);
  assert.doesNotMatch(html, /<(img|iframe|audio|video|source|embed|object)\b[^>]*\ssrc\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /@import\s+url\(\s*["']?(https?:)?\/\//i);
});

test('広告・アクセス解析のコードが入っていない', () => {
  for (const s of ['googlesyndication', 'cloudflareinsights', 'adsbygoogle', 'google-adsense-account', 'googletagmanager', 'google-analytics']) {
    assert.ok(!html.includes(s), s);
  }
});

test('本ツールのコード（core.js・app.js）は fetch・XMLHttpRequest・WebSocket などで通信しない', () => {
  for (const f of ['src/core.js', 'src/app.js']) {
    const code = read(f);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|\bimport\s*\(/, f);
    // コードの中の http(s) の URL は、使い方ページへのリンク（押したときだけ開く）以外に無い
    const urls = (code.match(/https?:\/\/[A-Za-z0-9.-]+/g) || []).filter((u) => u !== 'https://example.com');
    assert.deepEqual(urls, [], f + ' に URL: ' + urls.join(', '));
  }
});

test('Content-Security-Policy で外部への通信を禁止している', () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(m, 'CSP の meta がある');
  const csp = m[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /img-src data: blob:(;|$)/);
  assert.doesNotMatch(csp, /https?:|\*/);
  // CSP の meta は、ほかのスクリプトより前にある
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
});

test('noindex（検索には紹介ページ index.html を出す）', () => {
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('ライブラリとライセンス全文が入っている', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, ver] of Object.entries(pkg.devDependencies)) {
    assert.ok(html.includes(ver), name + ' ' + ver);
  }
  assert.match(html, /<script type="text\/plain" id="licenses">/);
  const lic = read('THIRD_PARTY_LICENSES.txt');
  for (const s of ['marked@', 'dompurify@', 'mermaid@', 'elkjs@', 'Eclipse Public License', 'khroma@', 'Apache License', 'Mozilla Public License']) {
    assert.ok(lic.includes(s), 'THIRD_PARTY_LICENSES.txt に ' + s);
    assert.ok(html.includes(s), 'md-viewer.html に ' + s);
  }
});

test('script 要素が途中で閉じていない（埋め込んだコードに </script が残っていない）', () => {
  const opens = (html.match(/<script\b/gi) || []).length;
  const closes = (html.match(/<\/script>/gi) || []).length;
  assert.equal(opens, closes);
  assert.equal(opens, 7);   // DOMPurify・marked・mermaid・core.js・app.js・reset-storage.js・ライセンス
});

test('index.html・guide.html はダウンロード版へリンクし、ダウンロード版はサイトマップに載せない', () => {
  const index = read('index.html');
  assert.match(index, /<a [^>]*href="\.\/md-viewer\.html"[^>]*\sdownload/);
  assert.doesNotMatch(read('sitemap.xml'), /md-viewer\.html/);
});
