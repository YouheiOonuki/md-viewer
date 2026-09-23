// ===========================
// Markdown＋Mermaid ビューア — 画面の制御
// 純粋関数は core.js（window.MdCore）。marked・DOMPurify・mermaid は md-viewer.html に同梱したものを使う
// 外部には一切通信しない（Content-Security-Policy でも禁止している）
// 注意: このファイルは md-viewer.html の script 要素にそのまま入るので、「<」のすぐ後ろに script と書かない
// ===========================
(function () {
  'use strict';

  var Core = window.MdCore;
  var marked = window.marked;
  var DOMPurify = window.DOMPurify;
  var mermaid = window.mermaid;

  var RENDER_DELAY = 150;    // Markdown の再描画（ミリ秒）
  var MERMAID_DELAY = 500;   // Mermaid の図は重いので、入力が止まってから描く
  var SAVE_DELAY = 800;      // 下書きの自動保存

  // --- ブラウザへの保存（キーは必ず "md-viewer_" で始める。読み書きはすべて try/catch） ---
  var KEY_PREFIX = 'md-viewer_';
  var store = {
    get: function (name, fallback) {
      try {
        var v = window.localStorage.getItem(KEY_PREFIX + name);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (name, value) {
      try { window.localStorage.setItem(KEY_PREFIX + name, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
  };

  var SAMPLE = [
    '# Markdown＋Mermaid ビューアへようこそ',
    '',
    '左の欄に Markdown を書くと、右にすぐ反映されます。この文章は見本です。自由に書き換えてください（書いた内容は、このブラウザの中に自動で下書き保存されます）。',
    '',
    '## できること',
    '',
    '- **見出し**から目次を作ります（「目次」の見出しを押すと、その場所へ移動します）',
    '- 表・チェックリスト・~~取り消し線~~・コードブロック・自動リンク（https://example.com）',
    '- `mermaid` と書いたコードブロックを図にします',
    '- Excel の表をコピーして貼り付けると、Markdown の表に変換します',
    '',
    '## 表',
    '',
    '| 手順 | 担当 | 日数 |',
    '| --- | --- | ---: |',
    '| 申請書を作る | 総務 | 2 |',
    '| 上長の承認 | 課長 | 1 |',
    '| 提出する | 総務 | 1 |',
    '',
    '## チェックリスト',
    '',
    '- [x] 下書きを書く',
    '- [ ] 図を入れる',
    '- [ ] HTML に書き出して共有する',
    '',
    '## 図（Mermaid）',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[申請書を作る] --> B{上長の承認}',
    '  B -- 承認 --> C[提出する]',
    '  B -- 差し戻し --> A',
    '```',
    '',
    '## 書き出しと印刷',
    '',
    '「HTML 書き出し」を押すと、図も入った 1 つの HTML ファイルに保存できます。書き出したファイルは JavaScript を使わないので、受け取った人はブラウザで開くだけで読めます。「印刷」から PDF にもできます。',
    ''
  ].join('\n');

  // --- 画面の部品 ---
  function $(id) { return document.getElementById(id); }
  var el = {
    editor: $('mv-editor'),
    preview: $('mv-preview'),
    previewPane: $('mv-preview-pane'),
    toc: $('mv-toc'),
    tocEmpty: $('mv-toc-empty'),
    file: $('mv-file'),
    fileInput: $('mv-file-input'),
    status: $('mv-status'),
    drop: $('mv-drop'),
    toast: $('mv-toast'),
    toastText: $('mv-toast-text'),
    toastAction: $('mv-toast-action'),
    tableDialog: $('mv-table-dialog'),
    tsv: $('mv-tsv'),
    tsvOut: $('mv-tsv-out'),
    autoTable: $('mv-auto-table'),
    aboutDialog: $('mv-about-dialog'),
    licenseText: $('mv-license-text'),
    tocToggle: $('mv-toc-toggle')
  };

  var state = {
    fileName: '',          // 開いた・保存したファイルの名前（拡張子なし）
    dirty: false,          // 最後に開いた・保存したあとに書き換えたか
    storageOk: true,
    warnedStorage: false,
    autoTable: true
  };

  // ---------- お知らせ ----------
  var toastTimer = null;
  function toast(text, actionLabel, action) {
    el.toastText.textContent = text;
    if (actionLabel) {
      el.toastAction.textContent = actionLabel;
      el.toastAction.hidden = false;
      el.toastAction.onclick = function () { hideToast(); action(); };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 8000 : 3500);
  }
  function hideToast() { el.toast.hidden = true; }

  function setStatus(text, warn) {
    el.status.textContent = text;
    el.status.className = warn ? 'is-warn' : '';
  }

  // ---------- Mermaid ----------
  var mermaidReady = false;
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',     // 図の中のリンク・HTML・クリック処理を無効にする
      theme: 'default',            // 書き出し・印刷と同じ明るい配色で描く（暗い画面では白い台紙に載せる）
      fontFamily: '"Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif'
    });
    mermaidReady = true;
  } catch (e) { /* 図が描けなくても、文章の表示は続ける */ }

  var diagramCache = new Map();   // 図のコード → { svg } または { error }
  var diagramSeq = 0;
  var diagramQueue = Promise.resolve();
  var lastSvgByIndex = [];        // 書き換え中は、前に描いた図を薄く出しておく（ちらつき防止）
  var currentBlocks = [];         // 今のプレビューにある図のコード
  var renderNonce = '';

  function cacheSet(src, value) {
    diagramCache.set(src, value);
    if (diagramCache.size > 60) diagramCache.delete(diagramCache.keys().next().value);
  }

  function renderDiagram(src) {
    if (diagramCache.has(src)) return Promise.resolve(diagramCache.get(src));
    if (!mermaidReady) return Promise.resolve({ error: '図を描く部品（mermaid）を読み込めませんでした。' });
    var id = 'mv-mermaid-' + (++diagramSeq);
    return Promise.resolve()
      .then(function () { return mermaid.render(id, src); })
      .then(function (out) {
        var v = { svg: out.svg };
        cacheSet(src, v);
        return v;
      }, function (err) {
        var v = { error: (err && (err.message || err.str)) || String(err) };
        cacheSet(src, v);
        return v;
      })
      .then(function (v) {
        // 失敗したときに mermaid が body に残す要素を片付ける
        ['d' + id, id].forEach(function (x) {
          var n = document.getElementById(x);
          if (n && !el.preview.contains(n)) n.remove();
        });
        return v;
      });
  }

  function fillBlock(block, result) {
    block.classList.remove('is-stale', 'mermaid-error');
    if (result.svg) {
      block.innerHTML = result.svg;
      block.setAttribute('data-done', '1');
    } else {
      block.classList.add('mermaid-error');
      block.textContent = '';
      var p = document.createElement('p');
      p.textContent = '図を描けませんでした。Mermaid の書き方を確かめてください。';
      var pre = document.createElement('pre');
      pre.textContent = String(result.error || '').slice(0, 800);
      block.appendChild(p);
      block.appendChild(pre);
      block.setAttribute('data-done', '1');
    }
  }

  // まだ描いていない図を、順番に描く
  function drawPendingDiagrams() {
    diagramQueue = diagramQueue.then(function () {
      var blocks = el.preview.querySelectorAll('.mermaid-block[data-mm^="' + renderNonce + '-"]:not([data-done])');
      var chain = Promise.resolve();
      Array.prototype.forEach.call(blocks, function (block) {
        chain = chain.then(function () {
          var idx = +block.getAttribute('data-mm').split('-').pop();
          var src = currentBlocks[idx];
          if (src == null) return;
          return renderDiagram(src).then(function (res) {
            if (block.isConnected) {
              fillBlock(block, res);
              if (res.svg) lastSvgByIndex[idx] = res.svg;
            }
          });
        });
      });
      return chain;
    });
    return diagramQueue;
  }

  var mermaidTimer = null;
  function scheduleDiagrams() {
    clearTimeout(mermaidTimer);
    mermaidTimer = setTimeout(drawPendingDiagrams, MERMAID_DELAY);
  }

  // ---------- Markdown の描画 ----------
  var renderer = new marked.Renderer();
  var baseCode = renderer.code.bind(renderer);
  var blocksThisRender = [];
  renderer.code = function (token) {
    var lang = String(token.lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') {
      blocksThisRender.push(token.text);
      return '<div class="mermaid-block" data-mm="' + renderNonce + '-' + (blocksThisRender.length - 1) + '"></div>\n';
    }
    return baseCode(token);
  };

  // 自動リンクは日本語の文字（「）」「。」など）の手前で止める
  var baseUrlTokenizer = marked.Tokenizer.prototype.url;
  marked.use({
    tokenizer: {
      url: function (src) { return baseUrlTokenizer.call(this, Core.autolinkSource(src)); }
    }
  });

  var PURIFY = {
    FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea', 'dialog'],
    FORBID_ATTR: ['autofocus']
  };

  function render() {
    var text = el.editor.value;
    renderNonce = Math.random().toString(36).slice(2, 10);
    blocksThisRender = [];
    var html;
    try {
      html = marked.parse(text, { gfm: true, breaks: false, renderer: renderer });
    } catch (e) {
      html = '<pre>' + Core.escapeHtml(String(e && e.message || e)) + '</pre>';
    }
    currentBlocks = blocksThisRender;
    el.preview.innerHTML = DOMPurify.sanitize(html, PURIFY);

    // 見出しに id を付け、目次を作る（id と目次は同じ文字から作るので必ずそろう）
    var slug = Core.createSlugger();
    var heads = el.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var items = [];
    Array.prototype.forEach.call(heads, function (h) {
      var text = h.textContent;
      var id = slug(text);
      h.id = id;
      items.push({ level: +h.tagName.charAt(1), text: text.trim() || '（無題）', id: id });
    });
    renderToc(items);

    // 図: 描いたことのあるコードはすぐ出し、新しいものは入力が止まってから描く
    var pending = false;
    var blocks = el.preview.querySelectorAll('.mermaid-block[data-mm^="' + renderNonce + '-"]');
    Array.prototype.forEach.call(blocks, function (block) {
      var idx = +block.getAttribute('data-mm').split('-').pop();
      var src = currentBlocks[idx];
      if (diagramCache.has(src)) {
        fillBlock(block, diagramCache.get(src));
      } else {
        pending = true;
        if (lastSvgByIndex[idx]) {
          block.innerHTML = lastSvgByIndex[idx];
          block.classList.add('is-stale');
        } else {
          block.innerHTML = '<p class="mermaid-pending">図を描いています…</p>';
        }
      }
    });
    if (pending) scheduleDiagrams();
  }

  function renderToc(items) {
    el.toc.textContent = '';
    el.tocEmpty.hidden = items.length > 0;
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'lv' + it.level;
      var a = document.createElement('a');
      a.href = '#' + encodeURIComponent(it.id);
      a.textContent = it.text;
      a.setAttribute('data-target', it.id);
      li.appendChild(a);
      el.toc.appendChild(li);
    });
  }

  function jumpTo(id) {
    var target = null;
    var heads = el.preview.querySelectorAll('[id]');
    for (var i = 0; i < heads.length; i++) { if (heads[i].id === id) { target = heads[i]; break; } }
    if (!target) return;
    if (isNarrow()) setView('preview');
    target.scrollIntoView({ block: 'start' });
  }

  el.toc.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    jumpTo(a.getAttribute('data-target'));
  });

  // プレビューの中のリンク: ページ内は移動、外のリンクは新しいタブ（押したときだけ）
  el.preview.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    e.preventDefault();
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (err) { /* そのまま使う */ }
      jumpTo(id);
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) window.open(a.href, '_blank', 'noopener,noreferrer');
  });

  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, RENDER_DELAY);
  }

  // ---------- 下書きの自動保存 ----------
  var saveTimer = null;
  function saveDraft() {
    var ok = store.set('draft', { text: el.editor.value, fileName: state.fileName });
    state.storageOk = ok;
    if (!ok && !state.warnedStorage) {
      state.warnedStorage = true;
      setStatus('この環境では下書きを自動保存できません。閉じる前に「.md で保存」で保存してください。', true);
    } else if (ok) {
      setStatus('下書きをこのブラウザに保存しました');
    }
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, SAVE_DELAY);
  }

  window.addEventListener('beforeunload', function (e) {
    clearTimeout(saveTimer);
    saveDraft();
    // 下書きを保存できない環境で、保存していない変更があるときだけ確認を出す
    if (!state.storageOk && state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function onEdit() {
    state.dirty = true;
    scheduleRender();
    scheduleSave();
  }
  el.editor.addEventListener('input', onEdit);

  function setText(text, fileName) {
    el.editor.value = text;
    state.fileName = fileName || '';
    state.dirty = false;
    lastSvgByIndex = [];
    showFileName();
    render();
    saveDraft();
  }

  function showFileName() {
    el.file.textContent = state.fileName ? state.fileName + '.md' : '';
    document.title = (state.fileName ? state.fileName + '｜' : '') + 'Markdown＋Mermaid ビューア';
  }

  // ---------- ファイルを開く ----------
  function decodeText(buf) {
    // ほとんどは UTF-8。Windows のメモ帳などで作った Shift_JIS のファイルも読めるようにする
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch (e) { /* 次へ */ }
    try { return new TextDecoder('shift_jis').decode(buf); } catch (e) { /* 次へ */ }
    return new TextDecoder('utf-8').decode(buf);
  }

  function openFile(file) {
    if (!file) return;
    if (state.dirty && el.editor.value.trim() && !window.confirm('いま書いている内容を、開くファイルで置き換えます。よろしいですか？')) return;
    file.arrayBuffer().then(function (buf) {
      var name = file.name.replace(/\.(md|markdown|mdown|txt)$/i, '');
      setText(decodeText(buf), name);
      toast('「' + file.name + '」を開きました');
    }, function () {
      toast('ファイルを読み込めませんでした');
    });
  }

  $('mv-open').addEventListener('click', function () { el.fileInput.value = ''; el.fileInput.click(); });
  el.fileInput.addEventListener('change', function () { openFile(el.fileInput.files && el.fileInput.files[0]); });

  // ドラッグ＆ドロップ
  var dragDepth = 0;
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
  }
  document.addEventListener('dragenter', function (e) { if (hasFiles(e)) { dragDepth++; el.drop.hidden = false; } });
  document.addEventListener('dragleave', function (e) { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; el.drop.hidden = true; } });
  document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.drop.hidden = true;
    openFile(e.dataTransfer.files[0]);
  });

  // ---------- 保存・書き出し ----------
  function firstHeading() {
    var h = el.preview.querySelector('h1') || el.preview.querySelector('h2, h3');
    return h ? h.textContent.trim() : '';
  }
  function baseName() {
    return Core.safeFileName(state.fileName || firstHeading(), 'document');
  }

  function download(content, name, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function saveMarkdown() {
    var name = baseName();
    download(el.editor.value, name + '.md', 'text/markdown;charset=utf-8');
    state.fileName = name;
    state.dirty = false;
    showFileName();
    saveDraft();
    toast('「' + name + '.md」として保存しました（ダウンロード）');
  }
  $('mv-save').addEventListener('click', saveMarkdown);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveMarkdown();
    }
  });

  // 図をすべて描き終えてから、プレビューの中身を 1 つの HTML にする
  function exportHtml() {
    clearTimeout(renderTimer);
    clearTimeout(mermaidTimer);
    render();
    setStatus('書き出しの準備をしています…');
    return drawPendingDiagrams().then(function () {
      var clone = el.preview.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.mermaid-block'), function (b) {
        b.removeAttribute('data-mm');
        b.removeAttribute('data-done');
        b.classList.remove('is-stale');
      });
      var title = firstHeading() || state.fileName || '文書';
      var html = Core.buildExportHtml({
        title: title,
        bodyHtml: clone.innerHTML,
        css: $('mv-doc-css').textContent,
        generator: 'Markdown＋Mermaid ビューア（yorozu-craft）'
      });
      var name = baseName() + '.html';
      download(html, name, 'text/html;charset=utf-8');
      setStatus('');
      toast('「' + name + '」に書き出しました（ダウンロード）');
      return html;
    });
  }
  $('mv-export').addEventListener('click', function () { exportHtml(); });

  $('mv-print').addEventListener('click', function () {
    clearTimeout(renderTimer);
    render();
    drawPendingDiagrams().then(function () { window.print(); });
  });

  $('mv-new').addEventListener('click', function () {
    if (el.editor.value.trim() && state.dirty && !window.confirm('いま書いている内容を消して、白紙にします。よろしいですか？（先に「.md で保存」で保存できます）')) return;
    setText('', '');
    el.editor.focus();
  });
  $('mv-sample').addEventListener('click', function () {
    if (el.editor.value.trim() && state.dirty && !window.confirm('いま書いている内容を、見本の文章で置き換えます。よろしいですか？')) return;
    setText(SAMPLE, '');
  });

  // ---------- Excel の表の貼り付け ----------
  // 編集欄に文字を入れる（Ctrl+Z で元に戻せるよう、できれば insertText を使う）
  function insertAtCursor(text) {
    var ta = el.editor;
    ta.focus();
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || ta.value.indexOf(text) < 0) {
      var s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText(text, s, en, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // 表の前後を空行にして、段落とつながらないようにする
  function padBlock(md) {
    var ta = el.editor;
    var before = ta.value.slice(0, ta.selectionStart);
    var after = ta.value.slice(ta.selectionEnd);
    var pre = before === '' || /\n\n$/.test(before) ? '' : (/\n$/.test(before) ? '\n' : '\n\n');
    var post = after === '' ? '\n' : (/^\n\n/.test(after) ? '' : (/^\n/.test(after) ? '\n' : '\n\n'));
    return pre + md + post;
  }

  function insideCodeBlock() {
    var before = el.editor.value.slice(0, el.editor.selectionStart);
    var fences = before.match(/^ {0,3}(```|~~~)/gm);
    return !!fences && fences.length % 2 === 1;
  }

  el.editor.addEventListener('paste', function (e) {
    if (!state.autoTable || !e.clipboardData) return;
    var text = e.clipboardData.getData('text/plain');
    if (!Core.looksLikeTable(text) || insideCodeBlock()) return;
    var md = Core.tsvToMarkdown(text);
    if (!md) return;
    e.preventDefault();
    var start = el.editor.selectionStart;
    var block = padBlock(md);
    insertAtCursor(block);
    toast('表を Markdown に変換して貼り付けました', '元の文字で貼り付け', function () {
      var ta = el.editor;
      if (ta.value.substr(start, block.length) !== block) return;
      ta.focus();
      ta.setSelectionRange(start, start + block.length);
      insertAtCursor(text);
    });
  });

  function updateTsvPreview() {
    var md = Core.tsvToMarkdown(el.tsv.value);
    el.tsvOut.textContent = md || '（ここに変換結果が出ます）';
  }
  el.tsv.addEventListener('input', updateTsvPreview);
  el.autoTable.addEventListener('change', function () {
    state.autoTable = el.autoTable.checked;
    store.set('settings', { autoTable: state.autoTable });
  });

  var savedSel = null;
  $('mv-table').addEventListener('click', function () {
    savedSel = [el.editor.selectionStart, el.editor.selectionEnd];
    el.tsv.value = '';
    updateTsvPreview();
    el.autoTable.checked = state.autoTable;
    el.tableDialog.showModal();
    el.tsv.focus();
  });
  el.tableDialog.addEventListener('close', function () {
    if (el.tableDialog.returnValue !== 'insert') return;
    var md = Core.tsvToMarkdown(el.tsv.value);
    if (!md) return;
    if (isNarrow()) setView('edit');
    el.editor.focus();
    if (savedSel) el.editor.setSelectionRange(savedSel[0], savedSel[1]);
    insertAtCursor(padBlock(md));
    toast('表を入れました');
  });

  // ---------- ライセンス ----------
  $('mv-about').addEventListener('click', function () {
    if (!el.licenseText.textContent) {
      var src = $('licenses');
      el.licenseText.textContent = src ? src.textContent.replace(/^\n/, '') : '';
    }
    el.aboutDialog.showModal();
  });

  // ---------- 目次の表示・狭い画面のタブ ----------
  function isNarrow() { return window.matchMedia('(max-width: 760px)').matches; }
  function setView(view) {
    document.body.setAttribute('data-view', view);
    Array.prototype.forEach.call(document.querySelectorAll('.mv-tabs [role="tab"]'), function (t) {
      t.setAttribute('aria-selected', t.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.mv-tabs [role="tab"]'), function (t) {
    t.addEventListener('click', function () { setView(t.getAttribute('data-view')); });
  });
  el.tocToggle.addEventListener('click', function () {
    var hidden = document.body.classList.toggle('mv-toc-hidden');
    el.tocToggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    store.set('settings', { autoTable: state.autoTable, tocHidden: hidden });
  });

  // ---------- 起動 ----------
  var settings = store.get('settings', {}) || {};
  state.autoTable = settings.autoTable !== false;
  if (settings.tocHidden) {
    document.body.classList.add('mv-toc-hidden');
    el.tocToggle.setAttribute('aria-pressed', 'false');
  }

  var draft = store.get('draft', null);
  if (draft && typeof draft.text === 'string') {
    el.editor.value = draft.text;
    state.fileName = draft.fileName || '';
    state.dirty = !!draft.text.trim();
  } else {
    el.editor.value = SAMPLE;
  }
  showFileName();
  render();
  // 保存できる環境かを最初に確かめる（できなければ 1 回だけ知らせる）
  if (!store.set('check', 1)) {
    state.storageOk = false;
    state.warnedStorage = true;
    setStatus('この環境では下書きを自動保存できません。閉じる前に「.md で保存」で保存してください。', true);
  } else {
    try { window.localStorage.removeItem(KEY_PREFIX + 'check'); } catch (e) { /* 何もしない */ }
    setStatus(draft ? '前回の下書きを開きました' : '見本の文章を出しています');
  }

  // テスト用（ブラウザでの確認に使う。外部には何も出さない）
  window.MdViewer = { render: render, exportHtml: exportHtml, flush: drawPendingDiagrams };
})();
