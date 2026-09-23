// md-viewer.html（1 ファイルで動くダウンロード版）と THIRD_PARTY_LICENSES.txt を作る
//
//   npm ci          # package.json で固定したライブラリを入れる（最初と、ライブラリを更新したとき）
//   node build.mjs
//
// - src/app.html に src/app.css・src/doc.css・ライブラリ・src/core.js・src/app.js をそのまま埋め込む
// - ライブラリは各パッケージがブラウザ用に配っているビルド済みのファイルを使う（依存パッケージは増やさない）
// - 同梱ライブラリと、それらに含まれるパッケージのライセンス全文を集めて、md-viewer.html の末尾と
//   THIRD_PARTY_LICENSES.txt に入れる
// - 日付など実行するたびに変わる値は入れない（同じ入力なら同じファイルになる。CI で確かめている）
// 依存パッケージなし（Node 20 以上）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(ROOT, 'node_modules');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

if (!fs.existsSync(path.join(NM, 'mermaid'))) {
  console.error('node_modules がありません。先に npm ci を実行してください。');
  process.exit(1);
}

const pkgJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// ---------- 埋め込むライブラリ（ブラウザ用のビルド済みファイル） ----------
const LIBS = [
  { name: 'DOMPurify', pkg: 'dompurify', file: 'dist/purify.min.js', global: 'DOMPurify', license: 'MPL-2.0 または Apache-2.0（本ツールは Apache-2.0 を選択）', use: 'プレビューの HTML を無害化する' },
  { name: 'marked', pkg: 'marked', file: 'lib/marked.umd.js', global: 'marked', license: 'MIT', use: 'Markdown を HTML にする' },
  { name: 'mermaid', pkg: 'mermaid', file: 'dist/mermaid.min.js', global: 'mermaid', license: 'MIT（中に含まれるパッケージのライセンスは下記）', use: '図を描く' },
];
for (const lib of LIBS) {
  lib.version = pkgJson(path.join(NM, lib.pkg)).version;
  lib.code = fs.readFileSync(path.join(NM, lib.pkg, lib.file), 'utf8');
}

// ---------- ライセンス全文を集める ----------
function repoUrl(p) {
  let r = p.repository;
  if (r && typeof r === 'object') r = r.url;
  if (!r) return p.homepage || '';
  r = String(r).replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '');
  if (/^github:/.test(r)) r = 'https://github.com/' + r.slice(7);
  else if (/^[\w.-]+\/[\w.-]+$/.test(r)) r = 'https://github.com/' + r;
  return r;
}

function findPkg(name, fromDir) {
  let d = fromDir;
  for (;;) {
    const p = path.join(d, 'node_modules', name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (d === ROOT) return null;
    d = path.dirname(d);
  }
}

// marked・dompurify・mermaid と、その依存パッケージをすべてたどる（型定義 @types/* は実行コードを含まないので除く）
const seen = new Map();
function walk(name, fromDir) {
  const dir = findPkg(name, fromDir);
  if (!dir) throw new Error('パッケージが見つかりません: ' + name);
  if (seen.has(dir)) return;
  const p = pkgJson(dir);
  seen.set(dir, p);
  for (const dep of Object.keys(p.dependencies || {}).sort()) {
    if (dep.startsWith('@types/')) continue;
    walk(dep, dir);
  }
}
for (const lib of LIBS) walk(lib.pkg, ROOT);

const entries = [];
for (const [dir, p] of seen) {
  const files = fs.readdirSync(dir).filter((f) => /^(licen[sc]e|copying)(\b|[-_.]|$)/i.test(f)).sort();
  if (!files.length) throw new Error('ライセンスのファイルがありません: ' + p.name + '（licenses/ に本文を置いて extra.json に足す）');
  let lic = p.license || (Array.isArray(p.licenses) ? p.licenses.map((l) => l.type || l).join(' OR ') : '');
  if (!lic && p.name === 'khroma') lic = 'MIT（package.json に記載がないため、同梱の license ファイルによる）';
  entries.push({
    name: p.name, version: p.version, license: lic || '（ファイルを参照）', repo: repoUrl(p),
    text: files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n').trim()).join('\n\n'),
  });
}
const extra = JSON.parse(read('licenses/extra.json'));
for (const e of extra.packages) {
  entries.push({ name: e.name, version: e.version, license: e.license, repo: e.repository, text: read('licenses/' + e.file).replace(/\r\n?/g, '\n').trim() });
}
entries.sort((a, b) => (a.name + '@' + a.version).localeCompare(b.name + '@' + b.version, 'en'));

// 本文が同じもの（chevrotain の各パッケージなど）はまとめて 1 回だけ載せる
const groups = new Map();
for (const e of entries) {
  if (!groups.has(e.text)) groups.set(e.text, []);
  groups.get(e.text).push(e);
}

const elk = entries.find((e) => e.name === 'elkjs');
const RULE = '='.repeat(72);
let licenses = [
  'THIRD-PARTY SOFTWARE NOTICES / 同梱しているソフトウェアのライセンス',
  '',
  'Markdown＋Mermaid ビューア（md-viewer.html）には、次のライブラリをそのまま埋め込んでいます。',
  ...LIBS.map((l) => `  - ${l.name} ${l.version}（npm: ${l.pkg}/${l.file}） ${l.license}`),
  '',
  'mermaid の配布ファイル（mermaid.min.js）には、mermaid が使う多くのパッケージが組み込まれています。',
  '下の一覧は、npm で入る依存パッケージと、配布ファイルに組み込まれているパッケージをすべて載せています',
  '（ブラウザでは使われない依存パッケージも、念のため含めています）。',
  '',
];
if (elk) {
  licenses.push(
    '■ elkjs について（Eclipse Public License 2.0）',
    `mermaid.min.js には elkjs ${elk.version}（Eclipse Layout Kernel の JavaScript 版）が含まれています。`,
    'elkjs は Eclipse Public License 2.0 で配布されています。本ツールは、mermaid の配布ファイルに組み込まれた',
    'elkjs のコードに手を加えず、そのまま含めています。elkjs のソースコードは次から入手できます。',
    `  ${elk.repo}  （バージョン ${elk.version}。npm パッケージ elkjs@${elk.version} にも含まれています）`,
    'ソースコードは Eclipse Public License 2.0 のもとで入手でき、この本文は下に載せています。',
    '',
  );
}
licenses.push(
  '■ 本ツール自身のコード（src/core.js・src/app.js ほか）',
  'MIT License, Copyright (c) 2026 Youhei Oonuki',
  'https://github.com/YouheiOonuki/md-viewer',
  '',
);
for (const [text, list] of groups) {
  licenses.push(RULE);
  for (const e of list) licenses.push(`${e.name}@${e.version}  License: ${e.license}${e.repo ? '  ' + e.repo : ''}`);
  licenses.push(RULE, '', text, '');
}
licenses = licenses.join('\n').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_LICENSES.txt'), licenses + '\n');

// ---------- md-viewer.html を組み立てる ----------
// <script> の中に「</script」があると、そこで要素が終わってしまうので「<\/script」にする。
// 「<script」があると HTML の読み取りが別の状態に入るので、入っていたら止める（今のライブラリには無い）
function scriptSafe(code, label) {
  if (/<script/i.test(code)) throw new Error(label + ' に「<script」という文字列があります。埋め込み方を見直してください');
  return code.replace(/<\/script/gi, '<\\/script');
}
function scriptTag(code, label) {
  return `<script>/* ${label} */\n${scriptSafe(code, label)}\n</script>`;
}

const scripts = [
  ...LIBS.map((l) => scriptTag(l.code, `${l.name} ${l.version} | ${l.license.replace(/（.*$/, '')} | 全文は末尾の id="licenses"`)),
  scriptTag(read('src/core.js'), 'Markdown＋Mermaid ビューア: core.js | MIT'),
  scriptTag(read('src/app.js'), 'Markdown＋Mermaid ビューア: app.js | MIT'),
].join('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const libList = LIBS.map((l) => `        <li>${esc(l.name)} ${esc(l.version)}（${esc(l.license)}）… ${esc(l.use)}</li>`).join('\n');
const libSummary = LIBS.map((l) => `${l.name} ${l.version}`).join(', ');
const favicon = 'data:image/svg+xml,' + encodeURIComponent(read('favicon.svg').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim());

if (/<\/?script/i.test(licenses)) throw new Error('ライセンスの本文に「<script」「</script」があります');

const template = read('src/app.html');
const fill = {
  LIB_SUMMARY: libSummary,
  BUILD_NOTE: 'https://github.com/YouheiOonuki/md-viewer の build.mjs で作成（npm ci && node build.mjs）',
  FAVICON: favicon,
  APP_CSS: read('src/app.css'),
  DOC_CSS: read('src/doc.css'),
  LIB_LIST: libList,
  SCRIPTS: scripts,
  LICENSES: licenses,
};
// 置き換えは 1 回で行う（埋め込んだ中身に {{…}} があっても、もう一度置き換えない）
const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in fill)) throw new Error('未知の置き換え: ' + m);
  return fill[k];
});
fs.writeFileSync(path.join(ROOT, 'md-viewer.html'), out);

const size = Buffer.byteLength(out);
console.log(`md-viewer.html: ${size.toLocaleString('en')} バイト（${(size / 1024 / 1024).toFixed(2)} MB）`);
for (const l of LIBS) console.log(`  ${l.name} ${l.version}: ${Buffer.byteLength(l.code).toLocaleString('en')} バイト`);
console.log(`THIRD_PARTY_LICENSES.txt: ${entries.length} パッケージ（本文 ${groups.size} 種類）`);
