// app.js — UI 逻辑 + OpenAI 兼容调用 + 解析渲染
// 用 IIFE 包裹；避免 ES2020 的 ?? / ?. 以兼容更多浏览器内核；任何初始化失败都给可见提示而非静默失效
(function () {
  'use strict';

  // ---- 守卫：prompt.js 必须先于 app.js 加载并挂载 window.PromptEngine ----
  if (!window.PromptEngine) {
    var errBox = document.getElementById('results');
    if (errBox) errBox.innerHTML = '<div class="error">⚠️ prompt.js 未加载，请确认 prompt.js 与 index.html 在同一目录，然后刷新页面。</div>';
    console.error('[app.js] window.PromptEngine 缺失，脚本终止。');
    return;
  }
  var buildPrompt = window.PromptEngine.buildPrompt;
  var parseCopies = window.PromptEngine.parseCopies;
  var VALID_STYLES = Object.keys(window.PromptEngine.STYLES);

  var $ = function (id) { return document.getElementById(id); };
  var LS = {
    get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // intensity 已从 UI 移除，固定为标准档
  var state = { style: 'ssorcon' };

  // ---- 风格选择 ----
  function initStyleRadios() {
    var inputs = document.querySelectorAll('input[name="style"]');
    Array.prototype.forEach.call(inputs, function (inp) {
      if (inp.value === state.style) {
        inp.checked = true;
        var lab = inp.closest('.style-radio'); if (lab) lab.classList.add('checked');
      }
      inp.addEventListener('change', function () {
        if (!inp.checked) return;
        state.style = inp.value;
        LS.set('style', inp.value);
        Array.prototype.forEach.call(document.querySelectorAll('.style-radio'), function (l) { l.classList.remove('checked'); });
        var lab = inp.closest('.style-radio'); if (lab) lab.classList.add('checked');
      });
    });
  }

  function loadSettings() {
    $('baseUrl').value = LS.get('baseUrl', '');
    $('apiKey').value = LS.get('apiKey', '');
    $('model').value = LS.get('model', 'deepseek-chat');
    var saved = LS.get('style', 'ssorcon');
    state.style = VALID_STYLES.indexOf(saved) !== -1 ? saved : 'ssorcon';
    $('count').value = LS.get('count', '5');
  }
  // 设置项自动保存
  Array.prototype.forEach.call(['baseUrl', 'apiKey', 'model', 'count'], function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { LS.set(id, el.value); });
  });

  // ---- 拼接请求 URL ----
  function buildUrl(baseUrl) {
    var u = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!u) throw new Error('请先在「API 设置」里填写 Base URL');
    if (/\/chat\/completions$/.test(u)) return u;
    if (/\/v\d+$/.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  // ---- 调用 LLM ----
  async function callLLM(messages, temperature) {
    var apiKey = $('apiKey').value.trim();
    var model = $('model').value.trim();
    if (!apiKey) throw new Error('请先在「API 设置」里填写 API Key');
    if (!model) throw new Error('请填写模型名');
    var count = parseInt($('count').value, 10) || 5;
    var maxTokens = Math.min(8000, count * 600 + 200);

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);

    var resp;
    try {
      resp = await fetch(buildUrl($('baseUrl').value), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: model, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: false }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('请求超时（90s），模型可能响应过慢或网络异常');
      throw new Error('网络/跨域错误：' + (e && e.message ? e.message : e) + '\n\n常见原因：\n• 该厂商不支持浏览器跨域(CORS)调用 → 换 DeepSeek/OpenAI 或自建代理\n• Base URL 填错\n• 网络/代理问题');
    }
    clearTimeout(timer);

    if (!resp.ok) {
      var detail = '';
      try { detail = JSON.stringify(await resp.json()); } catch (e1) { try { detail = await resp.text(); } catch (e2) {} }
      throw new Error('HTTP ' + resp.status + ' ' + resp.statusText + '\n' + detail);
    }
    var data = await resp.json();
    var text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!text) throw new Error('模型返回为空：' + JSON.stringify(data).slice(0, 300));
    return text;
  }

  // ---- 工具 ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function renderResults(copies) {
    var box = $('results');
    $('resultsHead').style.display = 'flex';
    $('resultsTitle').textContent = '生成结果 · ' + copies.length + ' 条';
    if (!copies.length) {
      box.innerHTML = '<div class="status">未能解析出文案，请检查模型输出或重试。</div>';
      return;
    }
    box.innerHTML = '';
    copies.forEach(function (c, i) {
      var card = document.createElement('div');
      card.className = 'copy-card';
      var linesHtml = c.lines.map(function (l) { return '<div>' + escapeHtml(l) + '</div>'; }).join('');
      card.innerHTML = '<button class="copy-btn" data-i="' + i + '">复制</button>' +
        '<div class="title">' + escapeHtml(c.title) + '</div>' +
        '<div class="qlines">' + linesHtml + '</div>';
      box.appendChild(card);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.copy-btn'), function (btn) {
      btn.onclick = function () { copyOne(copies[+btn.dataset.i], btn); };
    });
  }

  function toText(c) {
    // 复制为纯文本：去掉 # 和 > 标记，标题与正文之间空一行
    return c.title + '\n\n' + (c.lines || []).join('\n');
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function flash(btn, ok) {
    var old = btn.textContent;
    btn.textContent = ok ? '已复制 ✓' : '复制失败';
    setTimeout(function () { btn.textContent = old; }, 1200);
  }
  async function copyOne(c, btn) { flash(btn, await copyText(toText(c))); }
  async function copyAll(copies) { flash($('copyAllBtn'), await copyText(copies.map(toText).join('\n\n'))); }

  // ---- 主流程 ----
  async function generate() {
    var btn = $('genBtn');
    var box = $('results');
    btn.disabled = true;
    box.innerHTML = '<div class="status"><span class="spin"></span> 正在生成，请稍候…</div>';
    $('resultsHead').style.display = 'none';
    try {
      var built = buildPrompt({
        style: state.style,
        pastCopies: $('pastCopies').value,
        keywords: $('keywords').value,
        count: parseInt($('count').value, 10) || 5,
        intensity: 'mid'
      });
      var raw = await callLLM(built.messages, built.temperature);
      var copies = parseCopies(raw);
      renderResults(copies);
      window._lastCopies = copies;
    } catch (e) {
      box.innerHTML = '<div class="error">❌ ' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    } finally {
      btn.disabled = false;
    }
  }

  // ---- 绑定 + 初始化（核心绑定优先；初始化用 try 包裹，单项失败不阻断按钮）----
  function bindAndInit() {
    var genBtn = $('genBtn');
    if (genBtn) genBtn.onclick = generate;
    var copyAllBtn = $('copyAllBtn');
    if (copyAllBtn) copyAllBtn.onclick = function () { copyAll(window._lastCopies || []); };
    try { loadSettings(); } catch (e) { console.error('[app.js] loadSettings 失败：', e); }
    try { initStyleRadios(); } catch (e) { console.error('[app.js] initStyleRadios 失败：', e); }
  }
  bindAndInit();
})();
