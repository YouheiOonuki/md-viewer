// ===========================
// Markdown＋Mermaid ビューア — 画面から切り離した純粋関数
// DOM や localStorage に触らない。tests/core.test.js から node --test で確かめる
// ブラウザでは window.MdCore、Node（テスト）では module.exports で使う
// 注意: このファイルは md-viewer.html の script 要素にそのまま入るので、
//       「<」のすぐ後ろに script と書かない（正規表現も \s* をはさむ）
// ===========================
(function (root) {
  'use strict';

  // ---------- HTML の文字を無害な形にする ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 文字参照（&amp; や &#12354; など）を元の文字に戻す。見出しの文字を取り出すのに使う
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (err) { return m; }
      }
      var k = e.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
    });
  }

  // HTML の断片から、画面に出る文字だけを取り出す（要素の textContent と同じになるように）
  function htmlToText(html) {
    return decodeEntities(String(html).replace(/<[^>]*>/g, ''));
  }

  // ---------- 見出しの id ----------
  // GitHub と同じ考え方: 小文字にし、記号を消し、空白を「-」にする。日本語の文字はそのまま残す
  function slugify(text) {
    var s = String(text).trim().toLowerCase();
    s = s.replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '');
    s = s.replace(/\s/g, '-');
    return s || 'section';
  }

  // 同じ見出しが何度も出るときは -1, -2 … を付けて重ならないようにする
  function createSlugger() {
    var used = Object.create(null);
    return function (text) {
      var base = slugify(text);
      var id = base;
      if (used[base] !== undefined) {
        var n = used[base];
        do { n++; id = base + '-' + n; } while (used[id] !== undefined);
        used[base] = n;
      }
      used[id] = 0;
      return id;
    };
  }

  // ---------- 目次 ----------
  // Markdown の行内の書式を外して、表示される文字だけにする（おおまかな再現。記号は slugify で消える）
  function inlineToText(md) {
    var s = String(md);
    var codes = [];
    // コード（`…`）の中身は書式として読まないので、先に取り出しておく
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (m, t, body) {
      codes.push(body.replace(/^ (.*) $/, '$1'));
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');            // 画像は文字にならない
    s = s.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');           // リンクは表示の文字だけ
    s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
    s = s.replace(/<((?:https?|mailto|ftp):[^>\s]+)>/gi, '$1'); // <https://…> の自動リンク
    s = s.replace(/<[^>]*>/g, '');                             // HTML のタグ
    s = s.replace(/\\([!-\/:-@\[-`{-~])/g, function (m, c) { return '\u0001' + c.charCodeAt(0) + '\u0001'; });
    s = s.replace(/\*+/g, '').replace(/~~/g, '');
    s = s.replace(/(^|[^\p{L}\p{N}_])_+|_+(?=[^\p{L}\p{N}_]|$)/gu, '$1');
    s = s.replace(/\u0001(\d+)\u0001/g, function (m, c) { return String.fromCharCode(+c); });
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return codes[+i]; });
    return decodeEntities(s).trim();
  }

  /**
   * Markdown の見出しから目次を作る
   * @param {string} markdown
   * @returns {{level:number, text:string, id:string}[]}
   */
  function extractToc(markdown) {
    var lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    var toc = [];
    var slug = createSlugger();
    var fence = null;     // コードブロックの中なら { ch, len }
    var para = [];        // 直前の段落の行（Setext 形式の見出し用）

    function push(level, raw) {
      var text = inlineToText(raw);
      toc.push({ level: level, text: text, id: slug(text) });
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (fence) {
        var close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (close && close[1].charAt(0) === fence.ch && close[1].length >= fence.len) fence = null;
        continue;
      }
      var open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) { fence = { ch: open[1].charAt(0), len: open[1].length }; para = []; continue; }

      if (/^\s*$/.test(line)) { para = []; continue; }
      if (!para.length && /^( {4}|\t)/.test(line)) continue;     // 字下げのコードブロック

      var atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line);
      if (atx) {
        var body = atx[2].replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+[ \t]*$/, '');
        push(atx[1].length, body);
        para = [];
        continue;
      }

      var setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
      if (setext && para.length) {
        push(setext[1].charAt(0) === '=' ? 1 : 2, para.join('\n'));
        para = [];
        continue;
      }

      // 箇条書き・引用・表・区切り線は段落として数えない（Setext の見出しにならない）
      if (/^ {0,3}([-*+]|\d+[.)])([ \t]|$)/.test(line) || /^ {0,3}>/.test(line) || /^ {0,3}\|/.test(line) ||
          /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) {
        para = [];
        continue;
      }
      para.push(line.trim());
    }
    return toc;
  }

  // ---------- Excel・スプレッドシートの表（タブ区切り） ----------
  /**
   * タブ区切りのテキストを行と列に分ける。
   * Excel はセルに改行・タブ・「"」があると、セル全体を「"」で囲み、中の「"」を「""」にしてコピーする
   * @param {string} text
   * @returns {string[][]}
   */
  function parseTSV(text) {
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (s.charAt(s.length - 1) === '\n') s = s.slice(0, -1);   // 最後の改行（Excel が付ける）は行にしない
    if (s === '') return [];
    var rows = [], row = [], field = '', atStart = true, i = 0, n = s.length;
    while (i < n) {
      var c = s.charAt(i);
      if (atStart && c === '"') {
        var j = i + 1, buf = '', closed = false;
        while (j < n) {
          if (s.charAt(j) === '"') {
            if (s.charAt(j + 1) === '"') { buf += '"'; j += 2; continue; }
            j++; closed = true; break;
          }
          buf += s.charAt(j++);
        }
        if (closed && (j === n || s.charAt(j) === '\t' || s.charAt(j) === '\n')) {
          field = buf; i = j; atStart = false; continue;
        }
        // 閉じていない・閉じたあとに文字が続く「"」は、ただの文字として読む
        field += c; i++; atStart = false; continue;
      }
      if (c === '\t') { row.push(field); field = ''; atStart = true; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; atStart = true; i++; continue; }
      field += c; atStart = false; i++;
    }
    row.push(field);
    rows.push(row);
    return rows;
  }

  // 貼り付けた文字が表らしいか（タブを含み、2 行以上あり、2 列以上の行がある）
  function looksLikeTable(text) {
    if (!text || String(text).indexOf('\t') < 0) return false;
    var rows = parseTSV(text);
    if (rows.length < 2) return false;
    for (var i = 0; i < rows.length; i++) if (rows[i].length >= 2) return true;
    return false;
  }

  function formatCell(v) {
    return String(v)
      .replace(/\r\n?/g, '\n')
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>');
  }

  var NUMERIC = /^[-+]?(?:[¥￥$]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/;

  /**
   * タブ区切りの表を Markdown の表にする
   * - 1 行目を見出しの行にする
   * - 空のセル（結合セルの 2 つめ以降も空で来る）は空欄のまま
   * - 列の数が行ごとに違うときは、いちばん多い列数にそろえる
   * - 数字だけの列は右寄せにする
   * @param {string} text
   * @returns {string} 表の Markdown（空なら ''）
   */
  function tsvToMarkdown(text) {
    var rows = parseTSV(text);
    // 下の空行（すべて空のセル）は落とす
    while (rows.length && rows[rows.length - 1].every(function (c) { return String(c).trim() === ''; })) rows.pop();
    if (!rows.length) return '';
    var cols = 0;
    rows.forEach(function (r) { if (r.length > cols) cols = r.length; });
    var cells = rows.map(function (r) {
      var out = [];
      for (var k = 0; k < cols; k++) out.push(formatCell(k < r.length ? r[k] : ''));
      return out;
    });
    var align = [];
    for (var c = 0; c < cols; c++) {
      var any = false, allNum = true;
      for (var r = 1; r < cells.length; r++) {
        var v = cells[r][c];
        if (v === '') continue;
        any = true;
        if (!NUMERIC.test(v) || !/\d/.test(v)) { allNum = false; break; }
      }
      align.push(any && allNum ? '---:' : '---');
    }
    var line = function (arr) { return '| ' + arr.join(' | ') + ' |'; };
    var out = [line(cells[0]), line(align)];
    for (var q = 1; q < cells.length; q++) out.push(line(cells[q]));
    return out.join('\n');
  }

  // ---------- 1 ファイルの HTML に書き出す ----------
  // 書き出した HTML は JavaScript を使わない。念のため script 要素と on～ 属性を取り除く
  function stripScripts(html) {
    return String(html)
      .replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*\/?\s*script\b[^>]*>/gi, '')
      .replace(/(<[^>]*?)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1');
  }

  /**
   * 書き出し用の HTML 文書を組み立てる
   * @param {{title?:string, bodyHtml:string, css?:string, generator?:string}} o
   * @returns {string}
   */
  function buildExportHtml(o) {
    o = o || {};
    var title = o.title && String(o.title).trim() ? String(o.title).trim() : '文書';
    // CSS の中に「<」は要らない（</style> で要素が閉じるのを防ぐため、CSS のエスケープ \3c にする）
    var css = String(o.css || '').replace(/</g, '\\3c ');
    var body = stripScripts(o.bodyHtml || '');
    // 前の置き換えで on～ が残る書き方（属性が複数あるなど）もあるので、なくなるまで繰り返す
    for (var guard = 0; guard < 5; guard++) {
      var next = stripScripts(body);
      if (next === body) break;
      body = next;
    }
    return '<!DOCTYPE html>\n' +
      '<html lang="ja">\n' +
      '<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      // JavaScript を動かさない（script-src を許可しない）。画像だけは元の文書のとおり読めるようにする
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src * data: blob:; font-src data:">\n' +
      (o.generator ? '<meta name="generator" content="' + escapeHtml(o.generator) + '">\n' : '') +
      '<title>' + escapeHtml(title) + '</title>\n' +
      '<style>\n' + css + '\n</style>\n' +
      '</head>\n' +
      '<body>\n' +
      '<main class="markdown-body">\n' + body + '\n</main>\n' +
      '</body>\n' +
      '</html>\n';
  }

  // 自動リンク（URL をそのまま書いたもの）は、最初の空白・日本語などの文字の手前で終わらせる。
  // GFM の決まりでは「（https://example.com）」の「）」までリンクになってしまうため
  function autolinkSource(src) {
    var m = /[^\x21-\x7e]/.exec(String(src));
    return m ? String(src).slice(0, m.index) : String(src);
  }

  // ファイル名に使えない文字を除く（保存・書き出しの名前用）
  function safeFileName(name, fallback) {
    var s = String(name || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    if (s.length > 80) s = s.slice(0, 80).trim();
    return s || fallback || 'document';
  }

  var api = {
    escapeHtml: escapeHtml,
    decodeEntities: decodeEntities,
    htmlToText: htmlToText,
    slugify: slugify,
    createSlugger: createSlugger,
    inlineToText: inlineToText,
    extractToc: extractToc,
    parseTSV: parseTSV,
    looksLikeTable: looksLikeTable,
    tsvToMarkdown: tsvToMarkdown,
    stripScripts: stripScripts,
    buildExportHtml: buildExportHtml,
    safeFileName: safeFileName,
    autolinkSource: autolinkSource
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MdCore = api;
})(this);
