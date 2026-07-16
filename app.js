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
    var tempInput = $('temperature');
    if (tempInput) {
      tempInput.value = LS.get('temperature', '0.95');
      var tv = $('tempVal'); if (tv) tv.textContent = tempInput.value;
    }
  }
  // 设置项自动保存
  Array.prototype.forEach.call(['baseUrl', 'apiKey', 'model', 'count'], function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', function () { LS.set(id, el.value); });
  });
  // temperature 滑条：实时显示数值 + 保存
  var tempInput = $('temperature');
  if (tempInput) {
    tempInput.addEventListener('input', function () {
      var tv = $('tempVal'); if (tv) tv.textContent = tempInput.value;
      LS.set('temperature', tempInput.value);
    });
  }

  // ---- 拼接请求 URL ----
  function buildUrl(baseUrl) {
    var u = (baseUrl || '').trim().replace(/\/+$/, '');
    if (!u) throw new Error('请先在「API 设置」里填写 Base URL');
    if (/\/chat\/completions$/.test(u)) return u;
    if (/\/v\d+$/.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
  }

  // ---- 调用 LLM ----
  // 核心：接收显式 max_tokens，供生成流程与 evolve.js 扩库复用同一套 buildUrl/auth/超时
  async function callLLMCore(messages, temperature, maxTokens) {
    var apiKey = $('apiKey').value.trim();
    var model = $('model').value.trim();
    if (!apiKey) throw new Error('请先在「API 设置」里填写 API Key');
    if (!model) throw new Error('请填写模型名');

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
  // 生成流程专用：按生成数量推导 max_tokens
  async function callLLM(messages, temperature) {
    var count = parseInt($('count').value, 10) || 5;
    var maxTokens = Math.min(8000, count * 600 + 200);
    return callLLMCore(messages, temperature, maxTokens);
  }
  // 暴露给 evolve.js 做异步扩库（显式 max_tokens，默认 800）
  window.callLLM = function (messages, temperature, maxTokens) {
    return callLLMCore(messages, temperature, maxTokens || 800);
  };

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
        '<button class="ban-btn" data-i="' + i + '" title="拉黑这条用到的词句，后续不再出现">👎</button>' +
        '<div class="title">' + escapeHtml(c.title) + '</div>' +
        '<div class="qlines">' + linesHtml + '</div>';
      box.appendChild(card);
    });
    Array.prototype.forEach.call(box.querySelectorAll('.copy-btn'), function (btn) {
      btn.onclick = function () { copyOne(copies[+btn.dataset.i], btn); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.ban-btn'), function (btn) {
      btn.onclick = function () {
        var c = copies[+btn.dataset.i];
        if (window.EVOLVE && window.EVOLVE.banCard) {
          try { window.EVOLVE.banCard(toText(c)); } catch (e) {}
        }
        var lp = $('libPanel'); if (lp && lp.open) { try { renderLibPanel(); } catch (e) {} }
        btn.textContent = '已拉黑';
        btn.disabled = true;
      };
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
  async function copyOne(c, btn) {
    var ok = await copyText(toText(c));
    flash(btn, ok);
    // 复制成功 = 偏好信号：归因本轮暴露的词项 + 触发异步扩库
    if (ok && window.EVOLVE && window.EVOLVE.recordCopy) {
      try { window.EVOLVE.recordCopy(toText(c), state.style); } catch (e) {}
    }
  }
  async function copyAll(copies) {
    var text = copies.map(toText).join('\n\n');
    var ok = await copyText(text);
    flash($('copyAllBtn'), ok);
    if (ok && window.EVOLVE && window.EVOLVE.recordCopy) {
      try { window.EVOLVE.recordCopy(text, state.style); } catch (e) {}
    }
  }

  // ---- 词库状态面板 ----
  function tierBadge(tier, banned) {
    if (banned) return '<span class="tier tier-ban">已拉黑</span>';
    if (tier === 'seed') return '<span class="tier tier-seed">种子</span>';
    if (tier === 'active') return '<span class="tier tier-active">转正</span>';
    if (tier === 'candidate') return '<span class="tier tier-cand">AI新增</span>';
    return escapeHtml(tier || '');
  }
  function renderLibPanel() {
    if (!window.EVOLVE || !window.EVOLVE.inspect) return;
    var data;
    try { data = window.EVOLVE.inspect(); } catch (e) { return; }
    var onlyCand = $('libOnlyCand') && $('libOnlyCand').checked;
    var totalItems = 0, totalCand = 0, totalActive = 0, totalSeed = 0;
    data.categories.forEach(function (c) {
      totalItems += c.total; totalCand += c.candidate; totalActive += c.active; totalSeed += c.seed;
    });
    $('libEpoch').textContent = 'epoch ' + data.epoch;
    $('libTotal').textContent = '共 ' + totalItems + ' 条';
    $('libCand').textContent = 'AI新增 ' + totalCand + ' · 转正 ' + totalActive + ' · 种子 ' + totalSeed;
    $('libBan').textContent = '黑名单 ' + data.blacklist.length;

    var sel = $('libCat');
    if (!sel.options.length) {
      data.categories.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.catKey; o.textContent = c.catKey + ' (' + c.total + ')';
        sel.appendChild(o);
      });
    }
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
    var curCat = sel.value;
    var cat = null;
    for (var i = 0; i < data.categories.length; i++) { if (data.categories[i].catKey === curCat) { cat = data.categories[i]; break; } }
    var rows = cat ? cat.items : [];
    if (onlyCand) rows = rows.filter(function (x) { return x.tier === 'candidate' || x.banned; });

    var html = '<table class="lib-table"><thead><tr><th>词句</th><th>状态</th><th>shown</th><th>copy</th><th>👎</th><th>权重</th><th></th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="7" class="lib-empty">（无）</td></tr>';
    } else {
      rows.forEach(function (it) {
        var esc = escapeHtml(it.sig || '');
        html += '<tr>' +
          '<td class="lib-word">' + esc + '</td>' +
          '<td>' + tierBadge(it.tier, it.banned) + '</td>' +
          '<td>' + it.shown + '</td>' +
          '<td>' + it.copy + '</td>' +
          '<td>' + (it.dislike || 0) + '</td>' +
          '<td><b>' + it.weight + '</b></td>' +
          '<td><button class="lib-del" data-cat="' + curCat + '" data-sig="' + esc + '">删除</button></td>' +
          '</tr>';
      });
    }
    html += '</tbody></table>';
    $('libTable').innerHTML = html;
    Array.prototype.forEach.call($('libTable').querySelectorAll('.lib-del'), function (btn) {
      btn.onclick = function () {
        if (window.EVOLVE && window.EVOLVE.removeItem) { try { window.EVOLVE.removeItem(btn.dataset.cat, btn.dataset.sig); } catch (e) {} }
        renderLibPanel();
      };
    });

    $('libBanCount').textContent = data.blacklist.length;
    var banHtml = '';
    if (!data.blacklist.length) {
      banHtml = '<span class="lib-empty">（无）</span>';
    } else {
      data.blacklist.forEach(function (sig) {
        var esc = escapeHtml(sig);
        banHtml += '<span class="lib-ban-item">' + esc + ' <button class="lib-unban" data-sig="' + esc + '">解封</button></span>';
      });
    }
    $('libBanList').innerHTML = banHtml;
    Array.prototype.forEach.call($('libBanList').querySelectorAll('.lib-unban'), function (btn) {
      btn.onclick = function () {
        if (window.EVOLVE && window.EVOLVE.unban) { try { window.EVOLVE.unban(btn.dataset.sig); } catch (e) {} }
        renderLibPanel();
      };
    });
  }

  // ---- 主流程 ----
  async function generate() {
    var btn = $('genBtn');
    var box = $('results');
    btn.disabled = true;
    box.innerHTML = '<div class="status"><span class="spin"></span> 正在生成，请稍候…</div>';
    $('resultsHead').style.display = 'none';
    try {
      if (window.EVOLVE && window.EVOLVE.bumpEpoch) { try { window.EVOLVE.bumpEpoch(); } catch (e) {} }
      var built = buildPrompt({
        style: state.style,
        pastCopies: $('pastCopies').value,
        keywords: $('keywords').value,
        count: parseInt($('count').value, 10) || 5,
        intensity: 'mid'
      });
      // 异步扩库：在生成期间并发跑（用户此时一定在页面等待结果，复制后离开也不会打断扩库）；60s 节流
      if (window.EVOLVE && window.EVOLVE.expand) { try { window.EVOLVE.expand(state.style); } catch (e) {} }
      var raw = await callLLM(built.messages, parseFloat($('temperature').value) || 0.95);
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
    // 词库状态面板：展开时渲染 + 各控件绑定
    var libPanel = $('libPanel');
    if (libPanel) libPanel.addEventListener('toggle', function () { if (libPanel.open) { try { renderLibPanel(); } catch (e) {} } });
    var libRefresh = $('libRefresh');
    if (libRefresh) libRefresh.onclick = function () { try { renderLibPanel(); } catch (e) {} };
    var libReset = $('libReset');
    if (libReset) libReset.onclick = function () {
      if (confirm('确定重置词库？会清空所有学习到的权重/候选/黑名单，从原始词表重新种子。')) {
        if (window.EVOLVE && window.EVOLVE.reset) { try { window.EVOLVE.reset(); } catch (e) {} }
        var sel = $('libCat'); if (sel) sel.innerHTML = '';
        try { renderLibPanel(); } catch (e) {}
      }
    };
    var libCat = $('libCat');
    if (libCat) libCat.onchange = function () { try { renderLibPanel(); } catch (e) {} };
    var libOnlyCand = $('libOnlyCand');
    if (libOnlyCand) libOnlyCand.onchange = function () { try { renderLibPanel(); } catch (e) {} };
    try { loadSettings(); } catch (e) { console.error('[app.js] loadSettings 失败：', e); }
    try { initStyleRadios(); } catch (e) { console.error('[app.js] initStyleRadios 失败：', e); }
  }
  bindAndInit();
})();
