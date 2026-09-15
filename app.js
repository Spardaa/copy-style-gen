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
  var parseMaterials = window.PromptEngine.parseMaterials;
  var validateMaterials = window.PromptEngine.validateMaterials;
  var buildFormatRepairMessages = window.PromptEngine.buildFormatRepairMessages;
  var buildEmptyRecoveryMessages = window.PromptEngine.buildEmptyRecoveryMessages;
  var VALID_STYLES = Object.keys(window.PromptEngine.STYLES);

  var $ = function (id) { return document.getElementById(id); };
  var LS = {
    get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // intensity 已从 UI 移除，固定为标准档
  var state = { style: 'ssorcon' };
  var batch = null;
  var selectedTitle = -1;
  var selectedLines = [];
  var copying = false;

  function readCounts() {
    var counts = window.PromptEngine.normalizeCounts({ titleCount: $('titleCount').value, bodyCount: $('bodyCount').value });
    ['titleCount', 'bodyCount'].forEach(function (key) {
      $(key).value = String(counts[key]);
      LS.set(key, String(counts[key]));
    });
    return counts;
  }

  function readTemperature() {
    var el = $('temperature');
    var n = parseFloat(el && el.value);
    if (!isFinite(n)) n = 0.95;
    return Math.max(0, Math.min(1.5, n));
  }

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
    $('titleCount').value = LS.get('titleCount', '10');
    $('bodyCount').value = LS.get('bodyCount', '20');
    readCounts();
    var tempInput = $('temperature');
    if (tempInput) {
      tempInput.value = LS.get('temperature', '0.95');
      var tv = $('tempVal'); if (tv) tv.textContent = tempInput.value;
    }
  }
  // 设置项自动保存
  Array.prototype.forEach.call(['baseUrl', 'apiKey', 'model'], function (id) {
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
  function textFromContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(function (part) {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    }).join('');
  }

  // OpenAI 兼容厂商的正文位置并不完全一致，兼容常见的字符串、内容数组和旧式 text。
  function extractResponseText(data) {
    var choice = data && data.choices && data.choices[0];
    var message = choice && choice.message;
    var text = textFromContent(message && message.content);
    if (!text && choice && typeof choice.text === 'string') text = choice.text;
    if (!text && data && typeof data.output_text === 'string') text = data.output_text;
    if (!text && data && Array.isArray(data.output)) {
      text = data.output.map(function (item) {
        return textFromContent(item && item.content);
      }).join('');
    }
    return typeof text === 'string' ? text.trim() : '';
  }

  function emptyResponseDiagnostic(data) {
    var choice = data && data.choices && data.choices[0];
    var message = choice && choice.message;
    var reasoning = message && (message.reasoning_content || message.reasoning);
    return {
      finishReason: choice && choice.finish_reason ? String(choice.finish_reason) : '',
      hasChoices: !!(data && data.choices && data.choices.length),
      hasReasoning: !!(reasoning && String(reasoning).trim()),
      hasToolCalls: !!(message && message.tool_calls && message.tool_calls.length),
      responseKeys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : []
    };
  }

  function makeEmptyResponseError(data) {
    var diagnostic = emptyResponseDiagnostic(data);
    var reason = diagnostic.finishReason ? 'finish_reason=' + diagnostic.finishReason : '接口未提供 finish_reason';
    var err = new Error('模型返回为空（' + reason + '）');
    err.code = 'EMPTY_LLM_RESPONSE';
    err.diagnostic = diagnostic;
    return err;
  }

  function emptyFailureAdvice(firstError, retryError) {
    var a = firstError && firstError.diagnostic ? firstError.diagnostic : {};
    var b = retryError && retryError.diagnostic ? retryError.diagnostic : {};
    var finish = b.finishReason || a.finishReason || '';
    var reason;
    var advice;
    if (finish === 'content_filter') {
      reason = '接口的内容安全过滤拦截了可见正文。';
      advice = '删减可能触发过滤的过往文案或关键词，或改用允许该营销场景的模型。';
    } else if (finish === 'length') {
      reason = '模型在输出最终正文前已达到长度上限。';
      advice = '减少生成条数、缩短过往文案，或换用上下文/输出额度更大的模型。';
    } else if (b.hasToolCalls || a.hasToolCalls) {
      reason = '模型返回了工具调用，而不是普通文本正文。';
      advice = '改用普通聊天模型，并确认接口未强制启用工具调用。';
    } else if (b.hasReasoning || a.hasReasoning) {
      reason = '接口只返回了推理内容，没有返回最终可见正文。';
      advice = '改用非推理型聊天模型，或提高该模型的输出额度后重试。';
    } else if (!b.hasChoices || !a.hasChoices) {
      reason = '接口响应缺少 OpenAI 兼容的 choices 正文结构。';
      advice = '检查 Base URL 是否为 /chat/completions、模型名是否正确，并确认服务商兼容 Chat Completions。';
    } else {
      reason = '接口连续两次返回了成功响应，但都没有可见文本。';
      advice = '先重试；若持续出现，请更换模型，并检查服务商额度、内容过滤记录与接口日志。';
    }
    return '模型连续两次返回为空，自动恢复未成功。\n\n错误原因：' + reason + '\n修改建议：' + advice;
  }

  // 核心：接收显式 max_tokens，供生成流程与 evolve.js 扩库复用同一套 buildUrl/auth/超时
  async function callLLMCore(messages, temperature, maxTokens) {
    var apiKey = $('apiKey').value.trim();
    var model = $('model').value.trim();
    if (!apiKey) throw new Error('请先在「API 设置」里填写 API Key');
    if (!model) throw new Error('请填写模型名');

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);

    var requestBody = { model: model, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: false };
    // DeepSeek V4 默认开启高强度思考；本应用的创作/格式整理/恢复/扩库均为短任务，显式关闭以降低延迟并避免推理耗尽输出额度。
    if (/^deepseek-v4-(?:flash|pro)$/i.test(model)) requestBody.thinking = { type: 'disabled' };

    var resp;
    try {
      resp = await fetch(buildUrl($('baseUrl').value), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(requestBody),
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
    var text = extractResponseText(data);
    if (!text) throw makeEmptyResponseError(data);
    return text;
  }
  // 标题与单行正文分别预算；默认 10 标题 + 20 句 = 3200 tokens。
  async function callLLM(messages, temperature, counts) {
    var maxTokens = Math.min(9000, counts.titleCount * 70 + counts.bodyCount * 110 + 300);
    return callLLMCore(messages, temperature, maxTokens);
  }
  // 格式修复只做结构整理：短提示词、低温度、较小输出预算，避免再次跑完整创作链路
  async function callFormatRepair(messages, counts) {
    return callLLM(messages, 0, counts);
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

  function renderResults() {
    var box = $('results');
    $('resultsHead').style.display = 'flex';
    $('resultsTitle').textContent = '标题 ' + batch.parts.titles.length + ' 条 · 正文 ' + batch.parts.lines.length + ' 句';
    box.innerHTML = '';
    ['titles', 'lines'].forEach(function (kind) {
      var section = document.createElement('section');
      section.className = 'material-section';
      var heading = document.createElement('h3');
      heading.textContent = kind === 'titles' ? '标题 · 选择一个' : '正文 · 按点击顺序多选';
      section.appendChild(heading);
      if (!batch.parts[kind].length) {
        var empty = document.createElement('p');
        empty.textContent = '本次未返回此类素材，请重新生成。';
        section.appendChild(empty);
      }
      batch.parts[kind].forEach(function (text, i) {
        var row = document.createElement('div');
        row.className = 'material-row';
        var label = document.createElement('label');
        label.className = 'material-option';
        var input = document.createElement('input');
        input.type = kind === 'titles' ? 'radio' : 'checkbox';
        input.name = kind === 'titles' ? 'materialTitle' : 'materialLine';
        input.dataset.kind = kind;
        input.dataset.index = String(i);
        input.checked = kind === 'titles' ? selectedTitle === i : selectedLines.indexOf(i) !== -1;
        var order = document.createElement('span');
        order.className = 'selection-order';
        var content = document.createElement('span');
        content.textContent = text;
        label.appendChild(input); label.appendChild(order); label.appendChild(content);
        input.onchange = function () {
          if (kind === 'titles') selectedTitle = i;
          else {
            var position = selectedLines.indexOf(i);
            if (input.checked && position === -1) selectedLines.push(i);
            if (!input.checked && position !== -1) selectedLines.splice(position, 1);
          }
          updateComposition();
        };
        var dislike = document.createElement('button');
        dislike.className = 'material-dislike';
        dislike.type = 'button';
        dislike.textContent = batch.disliked[kind + i] ? '已反馈' : '👎';
        dislike.disabled = !!batch.disliked[kind + i];
        dislike.setAttribute('aria-label', '降低这条' + (kind === 'titles' ? '标题' : '正文') + '所用词句的推荐权重');
        dislike.onclick = function () {
          var matched = false;
          if (window.EVOLVE && window.EVOLVE.banCard) {
            try { matched = window.EVOLVE.banCard(text, batch.style, batch.exposure, kind); } catch (e) {}
          }
          batch.disliked[kind + i] = true;
          dislike.textContent = matched ? '已降权' : '未匹配';
          dislike.disabled = true;
          refreshLibrary();
        };
        row.appendChild(label); row.appendChild(dislike); section.appendChild(row);
      });
      box.appendChild(section);
    });
    $('composer').hidden = false;
    updateComposition();
  }

  function selectedParts() {
    if (!batch) return { titles: [], lines: [] };
    return {
      titles: selectedTitle < 0 ? [] : [batch.parts.titles[selectedTitle]],
      lines: selectedLines.map(function (i) { return batch.parts.lines[i]; })
    };
  }

  function compositionText(parts) {
    return parts.titles.concat(parts.lines.length ? [parts.lines.join('\n')] : []).join('\n\n');
  }

  function updateComposition() {
    var parts = selectedParts();
    $('compositionPreview').textContent = compositionText(parts) || '在上方选择标题和正文，组合内容会显示在这里。';
    $('selectionSummary').textContent = '已选 ' + parts.titles.length + ' 个标题 · ' + parts.lines.length + ' 句正文';
    $('copySelectionBtn').disabled = copying || !parts.titles.length || !parts.lines.length;
    Array.prototype.forEach.call($('results').querySelectorAll('.material-option input'), function (input) {
      var i = +input.dataset.index;
      var title = input.dataset.kind === 'titles';
      var position = title ? (selectedTitle === i ? 0 : -1) : selectedLines.indexOf(i);
      input.checked = position !== -1;
      input.parentNode.classList.toggle('selected', input.checked);
      input.nextSibling.textContent = position === -1 ? '' : (title ? '✓' : String(position + 1));
    });
  }

  function refreshLibrary() {
    var lp = $('libPanel');
    if (lp && lp.open) { try { renderLibPanel(); } catch (e) {} }
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
    if (btn._flashTimer) clearTimeout(btn._flashTimer);
    btn.textContent = ok ? '已复制 ✓' : '复制失败';
    btn._flashTimer = setTimeout(function () { btn.textContent = '📋 复制组合'; }, 1200);
  }
  async function copySelection() {
    var parts = selectedParts();
    if (copying || !batch || !parts.titles.length || !parts.lines.length) return;
    copying = true;
    var sourceBatch = batch;
    var btn = $('copySelectionBtn');
    btn.disabled = true;
    var text = compositionText(parts);
    var ok = await copyText(text);
    copying = false;
    flash(btn, ok);
    if (ok && window.EVOLVE && window.EVOLVE.recordCopy) {
      try { window.EVOLVE.recordCopy(text, sourceBatch.style, sourceBatch.exposure, parts); } catch (e) {}
    }
    refreshLibrary();
    updateComposition();
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

    var html = '<table class="lib-table"><thead><tr><th>词句</th><th>状态</th><th>抽样</th><th>标题使用</th><th>正文使用</th><th>标题复制</th><th>正文复制</th><th>复制总计</th><th>👎</th><th>权重</th><th></th></tr></thead><tbody>';
    if (!rows.length) {
      html += '<tr><td colspan="11" class="lib-empty">（无）</td></tr>';
    } else {
      rows.forEach(function (it) {
        var esc = escapeHtml(it.sig || '');
        html += '<tr>' +
          '<td class="lib-word">' + esc + '</td>' +
          '<td>' + tierBadge(it.tier, it.banned) + '</td>' +
          '<td>' + it.shown + '</td>' +
          '<td>' + (it.usedTitle || 0) + '</td>' +
          '<td>' + (it.usedBody || 0) + '</td>' +
          '<td>' + (it.copyTitle || 0) + '</td>' +
          '<td>' + (it.copyBody || 0) + '</td>' +
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
    var box = $('generationStatus');
    btn.disabled = true;
    box.innerHTML = '<div class="status"><span class="spin"></span> 正在生成，请稍候…</div>';
    try {
      var counts = readCounts();
      var generationStyle = state.style;
      var temperature = readTemperature();
      if (window.EVOLVE && window.EVOLVE.bumpEpoch) { try { window.EVOLVE.bumpEpoch(); } catch (e) {} }
      var built = buildPrompt({
        style: generationStyle,
        pastCopies: $('pastCopies').value,
        keywords: $('keywords').value,
        titleCount: counts.titleCount,
        bodyCount: counts.bodyCount,
        intensity: 'mid'
      });
      var exposure = window.EVOLVE && window.EVOLVE.captureExposure ? window.EVOLVE.captureExposure(built.messages[0].content) : [];
      var raw;
      try {
        raw = await callLLM(built.messages, temperature, counts);
      } catch (firstError) {
        if (!firstError || firstError.code !== 'EMPTY_LLM_RESPONSE' || !buildEmptyRecoveryMessages) throw firstError;
        box.innerHTML = '<div class="status"><span class="spin"></span> 首次未收到正文，正在进行一次恢复审查…</div>';
        var recoveryMessages = buildEmptyRecoveryMessages(built.messages, counts, firstError.diagnostic);
        try {
          raw = await callLLM(recoveryMessages, Math.min(temperature, 0.4), counts);
        } catch (retryError) {
          if (retryError && retryError.code === 'EMPTY_LLM_RESPONSE') {
            throw new Error(emptyFailureAdvice(firstError, retryError));
          }
          throw retryError;
        }
      }
      var parts = parseMaterials(raw);
      var issues = validateMaterials(parts, counts);
      var repairNote = '';
      if (issues.length && buildFormatRepairMessages) {
        box.innerHTML = '<div class="status"><span class="spin"></span> 文案已生成，正在整理输出格式…</div>';
        try {
          var repaired = parseMaterials(await callFormatRepair(buildFormatRepairMessages(raw, issues, counts), counts));
          // 修复失败或丢失内容时保留已经解析成功的素材。
          if (Math.abs(repaired.titles.length - counts.titleCount) < Math.abs(parts.titles.length - counts.titleCount)) parts.titles = repaired.titles;
          if (Math.abs(repaired.lines.length - counts.bodyCount) < Math.abs(parts.lines.length - counts.bodyCount)) parts.lines = repaired.lines;
        } catch (repairError) {
          repairNote = '格式整理失败：' + (repairError.message || String(repairError));
        }
        issues = validateMaterials(parts, counts);
      }
      if (!parts.titles.length && !parts.lines.length) throw new Error('未能识别标题和正文，格式修复未成功。请重试或检查模型是否支持 JSON 文本输出。' + (repairNote ? '\n' + repairNote : ''));
      parts.titles = parts.titles.slice(0, counts.titleCount);
      parts.lines = parts.lines.slice(0, counts.bodyCount);
      batch = { parts: parts, style: generationStyle, exposure: exposure, disliked: {} };
      selectedTitle = -1;
      selectedLines = [];
      renderResults();
      box.textContent = issues.length ? '已保留可用素材。' + issues.join('；') + '。可选择复制或重新生成。' + repairNote : '';
      if (window.EVOLVE && window.EVOLVE.recordUsed) { try { window.EVOLVE.recordUsed(parts, generationStyle, exposure); } catch (e) {} }
      refreshLibrary();
      // 先让结果完成渲染，再异步扩库；不占用主生成与格式修复阶段的模型并发
      var styleForExpand = generationStyle;
      setTimeout(function () {
        if (window.EVOLVE && window.EVOLVE.expand) { try { window.EVOLVE.expand(styleForExpand); } catch (e) {} }
      }, 0);
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
    $('copySelectionBtn').onclick = copySelection;
    $('clearSelectionBtn').onclick = function () {
      selectedTitle = -1; selectedLines = []; updateComposition();
    };
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
    ['titleCount', 'bodyCount'].forEach(function (key) { $(key).addEventListener('change', readCounts); });
    try { initStyleRadios(); } catch (e) { console.error('[app.js] initStyleRadios 失败：', e); }
  }
  bindAndInit();
})();
