// evolve.js — 自演化词库引擎（解决长期生成重复）
// 思路：把静态全量词表升级成两层——库(localStorage 基因池，随使用增长) + 每次给 prompt 的加权抽样子集(永有界)。
// 权重 = 偏好(被复制) − 最近用过(recency 防重复) + 欠试用探索分；非原始频率，避免滚雪球。
// 候选词(LLM 扩库产出)先进候选池试用，达标自动转正、零反馈自动淘汰；👎 一键拉黑。
// 红线：扩库只动氛围/人设/emoji/赞美/句式，结构性排除产品事实(色名/直径/价格/款式/高光/抛型/度数/规格)。
// 约定：var/function/IIFE，禁 ?? / ?.，与 app.js/prompt.js 一致。
(function () {
  'use strict';

  var STORAGE_KEY = 'evolve_lib_v1';
  var VERSION = 1;
  var CAP_NEW = 40;            // 每类非种子条目软上限（超限先淘汰权重最低的 active，seed 永不淘汰）
  var EXPAND_COOLDOWN_MS = 60000; // 扩库节流，避免连续触发狂打 API
  var EXPAND_COUNT = 8;        // 每次扩库让 LLM 生成的新候选条数
  var DISLIKE_BAN = 2;         // 同一词累计被👎到此次数才进黑名单（单次👎只降权，不拉黑）
  var ANCHOR_MIN = 10;          // 扩库风格锚下限（小类别保底，给足风格信号）
  var ANCHOR_MAX = 30;         // 扩库风格锚上限（大类别如 palette 封顶；30条锚≈450 token，节流后成本可忽略）

  var db = null;               // 内存缓存（localStorage 的单一真相源，变更后 save()）
  var epochShown = [];         // 本轮 generate 实际暴露给模型的项（{catKey,item,shape}），bumpEpoch 时清空，供复制归因只用"真暴露过"的项
  var lastExpandAt = 0;        // 上次扩库时间戳，节流用

  // ---- 类别 → 原生 shape 映射（payload 保留原生结构，现有 joinArr/formulasBlock 等格式化器无需改）----
  function fieldShape(field) {
    if (field === 'formulas') return 'tplex';
    if (field === 'homophones') return 'wm';
    if (field === 'fewShots') return 'titlelines';
    return 'string';
  }
  function shapeOfCatKey(catKey) {
    var parts = String(catKey).split('.');
    return fieldShape(parts[parts.length - 1]);
  }

  // ---- 当前所有动态类别的配置（common + 每个风格）----
  function catConfigs() {
    var COMMON = window.COMMON || {};
    var STYLES = window.STYLES || {};
    var cfgs = [];
    cfgs.push({ key: 'common.sharedFormulas', arr: COMMON.sharedFormulas || [], shape: 'string' });
    cfgs.push({ key: 'common.sharedVocab', arr: COMMON.sharedVocab || [], shape: 'string' });
    cfgs.push({ key: 'common.homophones', arr: COMMON.homophones || [], shape: 'wm' });
    var styleFields = [
      ['formulas', 'tplex'], ['signatures', 'string'], ['titlePatterns', 'string'],
      ['praise', 'string'], ['persona', 'string'], ['emojiCombos', 'string'], ['fewShots', 'titlelines'],
      ['palette', 'string']
    ];
    Object.keys(STYLES).forEach(function (sk) {
      var s = STYLES[sk] || {};
      styleFields.forEach(function (sf) {
        cfgs.push({ key: 'style.' + sk + '.' + sf[0], arr: s[sf[0]] || [], shape: sf[1] });
      });
    });
    return cfgs;
  }

  function clonePayload(el, shape) {
    if (shape === 'string') return el;
    if (shape === 'wm') return { w: el.w, m: el.m };
    if (shape === 'tplex') return { tpl: el.tpl, ex: el.ex };
    if (shape === 'titlelines') return { title: el.title, lines: (el.lines || []).slice() };
    return el;
  }
  function sigOf(it, shape) {
    var p = it.payload;
    if (shape === 'string') return typeof p === 'string' ? p : '';
    if (shape === 'wm') return (p && p.w) ? p.w : '';
    if (shape === 'tplex') return (p && p.tpl) ? p.tpl : '';
    if (shape === 'titlelines') return (p && p.title) ? p.title : '';
    return '';
  }
  // 归因用：返回该项"会出现在生成文案里"的候选子串（短于 3 字的跳过，谐音/样例不参与归因）
  function matchKeys(it, shape) {
    var p = it.payload, out = [];
    if (shape === 'string') {
      if (typeof p === 'string' && p.length >= 3) out.push(p);
    } else if (shape === 'tplex') {
      if (p && p.tpl) { var t = String(p.tpl).replace(/[XＸ\[\]【】]/g, ''); if (t.length >= 3) out.push(t); }
      if (p && p.ex && String(p.ex).length >= 3) out.push(String(p.ex));
    }
    return out;
  }

  // ---- 存取 ----
  function freshDB() {
    return { version: VERSION, epoch: 0, items: {}, blacklist: [], _cid: 1 };
  }
  function save() {
    if (!db) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) {}
  }
  function makeSeedItem(catKey, el, shape, idx) {
    return {
      id: catKey + ':s' + idx,
      payload: clonePayload(el, shape),
      tier: 'seed',
      shown: 0, copy: 0, dislike: 0,
      lastShownEpoch: -999,
      createdAt: 0
    };
  }
  function seedCategory(cfg) {
    var arr = [];
    (cfg.arr || []).forEach(function (el, idx) { arr.push(makeSeedItem(cfg.key, el, cfg.shape, idx)); });
    db.items[cfg.key] = arr;
  }
  function seed() { catConfigs().forEach(function (cfg) { seedCategory(cfg); }); }
  function ensureSeeded() {
    catConfigs().forEach(function (cfg) {
      if (!db.items[cfg.key] || !db.items[cfg.key].length) seedCategory(cfg);
    });
  }
  function load() {
    if (db) return db;
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) {} }
    if (!parsed || parsed.version !== VERSION) {
      db = freshDB(); seed(); save(); return db;
    }
    db = parsed;
    if (db._cid == null) db._cid = 1;
    if (!db.blacklist) db.blacklist = [];
    if (!db.items) db.items = {};
    if (db.epoch == null) db.epoch = 0;
    ensureSeeded();
    save();
    return db;
  }

  function isBanned(it, shape) {
    var sig = sigOf(it, shape);
    return sig && db.blacklist.indexOf(sig) !== -1;
  }

  // ---- 权重（非原始频率）----
  function weight(it, epoch) {
    var w;
    if ((it.dislike || 0) > 0) {
      w = 0.2;                       // 被👎过 -> 直接压到地板（几乎不被抽，但未拉黑；可被复制救赎）
    } else {
      w = 1 + (it.copy || 0) * 2;    // exploit 偏好
      if ((it.shown || 0) < 3) w += 4; // explore：欠试用/新候选加分
    }
    var lse = (it.lastShownEpoch == null) ? -999 : it.lastShownEpoch;
    var age = epoch - lse;
    if (age <= 0) w *= 0.1;        // 同轮（防御性）
    else if (age === 1) w *= 0.2;  // 上一轮刚用过→强降权（防重复，轻量无膨胀版 L1）
    else if (age === 2) w *= 0.5;
    if (w > 8) w = 8;
    if (w < 0.2) w = 0.2;
    return w;
  }

  // ---- 加权无放回抽样 ----
  function sample(catKey, k) {
    var d = load();
    var shape = shapeOfCatKey(catKey);
    var pool = (d.items[catKey] || []).filter(function (it) { return !isBanned(it, shape); });
    if (!pool.length) return [];
    var take = Math.min(k, pool.length);
    var picked = [];
    var arr = pool.slice();
    for (var i = 0; i < take; i++) {
      var total = 0;
      for (var j = 0; j < arr.length; j++) total += weight(arr[j], d.epoch);
      var r = Math.random() * total, acc = 0, idx = arr.length - 1;
      for (var j2 = 0; j2 < arr.length; j2++) {
        acc += weight(arr[j2], d.epoch);
        if (r <= acc) { idx = j2; break; }
      }
      picked.push(arr[idx]);
      arr.splice(idx, 1);
    }
    picked.forEach(function (it) {
      it.shown = (it.shown || 0) + 1;
      it.lastShownEpoch = d.epoch;
      epochShown.push({ catKey: catKey, item: it, shape: shape });
    });
    save();
    return picked.map(function (it) { return it.payload; });
  }

  function bumpEpoch() {
    var d = load();
    d.epoch = (d.epoch || 0) + 1;
    epochShown = [];
    save();
  }

  // ---- 复制归因：命中的暴露项 copy++，再 curate（扩库已移至 generate() 时触发）----
  function recordCopy(text, styleKey) {
    if (!text) return;
    var d = load();
    var t = String(text), hit = false;
    epochShown.forEach(function (e) {
      var keys = matchKeys(e.item, e.shape);
      for (var i = 0; i < keys.length; i++) {
        // 命中即 copy++；正反馈同时【清空 dislike】——被复制=救赎，撤销之前的👎降权
        if (t.indexOf(keys[i]) !== -1) { e.item.copy = (e.item.copy || 0) + 1; e.item.dislike = 0; hit = true; break; }
      }
    });
    if (hit) save();
    curate();
  }

  // ---- 候选生命周期 ----
  function countTier(arr, tier) {
    var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i].tier === tier) n++; return n;
  }
  function curate() {
    var d = load();
    Object.keys(d.items).forEach(function (catKey) {
      var arr = d.items[catKey] || [];
      var kept = [];
      arr.forEach(function (it) {
        if (it.tier === 'candidate') {
          if ((it.shown || 0) >= 3 && (it.copy || 0) >= 1) { it.tier = 'active'; kept.push(it); return; } // 转正
          if ((it.shown || 0) >= 5 && (it.copy || 0) === 0) return;                                       // 试过没人爱→淘汰
          if ((it.copy || 0) === 0 && (d.epoch - (it.createdAt || 0)) > 12 && (it.shown || 0) >= 3) return; // 老旧零反馈→淘汰
          kept.push(it);
        } else { kept.push(it); }
      });
      var cap = countTier(kept, 'seed') + CAP_NEW;
      while (kept.length > cap) {                       // 软上限：先挤权重最低的 active，seed 不动
        var evictIdx = -1, evictW = Infinity;
        for (var i = 0; i < kept.length; i++) {
          if (kept[i].tier === 'active') { var w = weight(kept[i], d.epoch); if (w < evictW) { evictW = w; evictIdx = i; } }
        }
        if (evictIdx === -1) break;
        kept.splice(evictIdx, 1);
      }
      d.items[catKey] = kept;
    });
    save();
  }

  // ---- 👎 降权（非立即拉黑）：只对【最长匹配】的那条 dislike++；累计达 DISLIKE_BAN 才进黑名单 ----
  function banCard(text) {
    if (!text) return;
    var d = load();
    var t = String(text);
    // 取命中里匹配键最长（最具体）的一条，避免一次👎波及一堆词
    var best = null;
    epochShown.forEach(function (e) {
      var keys = matchKeys(e.item, e.shape);
      for (var i = 0; i < keys.length; i++) {
        if (t.indexOf(keys[i]) !== -1) {
          if (!best || keys[i].length > best.key.length) {
            best = { item: e.item, key: keys[i], sig: sigOf(e.item, e.shape) };
          }
        }
      }
    });
    if (!best) { save(); return; }
    best.item.dislike = (best.item.dislike || 0) + 1;
    // 单次只降权；同一词累计👎达阈值才拉黑（候选拉黑即淘汰，seed/active 仅屏蔽抽样）
    if (best.item.dislike >= DISLIKE_BAN && best.sig) {
      if (d.blacklist.indexOf(best.sig) === -1) d.blacklist.push(best.sig);
      if (best.item.tier === 'candidate') {
        best.item._drop = true;
        Object.keys(d.items).forEach(function (catKey) {
          d.items[catKey] = (d.items[catKey] || []).filter(function (it) { return !it._drop; });
        });
      }
    }
    save();
  }

  // ---- 红线安全网：拒绝含产品参数的候选 ----
  function containsProductParam(s) {
    if (!s) return false;
    if (/\d+(\.\d+)?\s*mm/i.test(s)) return true;          // 直径 14.5mm
    if (/\d+\s*r\b/.test(s)) return true;                   // 价格 29r
    if (/💰\s*\d+|\d+\s*💰/.test(s)) return true;            // 💰29
    if (/(定轴|非定轴|定位高光|半年抛|日抛|年抛|月抛|季抛|着色|度数|基弧)/.test(s)) return true;
    return false;
  }

  // ---- 异步扩库（复制后自动触发，节流；仅红线安全类别）----
  var EXPAND_STYLE_FIELDS = ['formulas', 'signatures', 'titlePatterns', 'praise', 'persona', 'emojiCombos', 'palette'];
  function buildExpandPrompt(field, shape, anchors) {
    var isFormula = shape === 'tplex';
    var isPalette = field === 'palette';
    var anchorStr = (anchors || []).join('\n');
    var sys = '你是小红书美瞳种草文案的【风格词库扩充器】。';
    if (isPalette) {
      // palette 是色感/氛围色词（文案描述，非产品真实色号），扩库允许色名、仅禁其它产品参数
      sys += '任务：参考下面已有的色感/氛围色词，生成 ' + EXPAND_COUNT + ' 个全新的、风格高度一致的色感色词。';
      sys += '\n【红线】只生成【色感/氛围色词】（如 海盐蓝/初恋粉/雾霾灰/废土棕/鎏金星河 这类色调描述词，可含具体色名）。';
      sys += '严禁任何【其它产品参数】：直径(mm)、价格(r/💰)、款式(定轴/非定轴)、高光、抛型(半年抛/日抛)、着色、度数、规格。';
      sys += '\n\n输出格式：JSON 字符串数组，如 ["色词1","色词2",...]。只输出 JSON 数组，不要任何解释或代码块标记。';
    } else {
      sys += '任务：参考下面已有的「' + field + '」条目，生成 ' + EXPAND_COUNT + ' 条全新的、风格高度一致的同类条目。';
      sys += '\n\n【红线·最高优先级】只能生成【氛围/人设/情绪/赞美/网感句式/emoji/谐音卖萌】，';
      sys += '严禁生成任何【产品事实参数】：色系名（翡翠绿/克莱因蓝等具体色名）、直径（14.5mm）、价格（29r/💰）、';
      sys += '款式（定轴/非定轴）、高光、抛型（半年抛/日抛）、着色、度数、规格——一个都不许出现。';
      sys += '\n句式类的 X 是占位符（代表产品/色名），必须保留。';
      sys += '\n\n输出格式：' + (isFormula
        ? 'JSON 对象数组，每条形如 {"tpl":"X已经next level了","ex":"这副已经next level了"}，tpl 用 X 占位、ex 给不含产品参数的示范。'
        : 'JSON 字符串数组，如 ["条目1","条目2",...]。') + '只输出 JSON 数组，不要任何解释或代码块标记。';
    }
    var user = '已有参考（风格锚，不要与这些重复）：\n' + (anchorStr || '（暂无）') +
      '\n\n请生成 ' + EXPAND_COUNT + ' 条全新的同类条目，严格守住上面的红线。';
    return { system: sys, user: user };
  }
  function parseJsonList(raw) {
    if (!raw) return null;
    var s = String(raw).trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    var start = s.indexOf('['), end = s.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    var slice = s.substring(start, end + 1);
    try { var v = JSON.parse(slice); if (Array.isArray(v)) return v; } catch (e) {}
    var out = [], re = /"((?:[^"\\]|\\.)*)"/g, m;
    while ((m = re.exec(slice))) out.push(m[1]);
    return out.length ? out : null;
  }
  function normalizeCandidate(p, shape) {
    if (shape === 'string') return (typeof p === 'string') ? p.trim() : null;
    if (shape === 'tplex') return (p && typeof p === 'object' && p.tpl) ? { tpl: String(p.tpl).trim(), ex: String(p.ex || '').trim() } : null;
    return null;
  }
  async function expandOne(catKey, field, shape) {
    var d = load();
    if (!window.callLLM) return;
    var arr = d.items[catKey] || [];
    // 风格锚：取 seed+active（不含候选）的一半，夹在 [ANCHOR_MIN, ANCHOR_MAX]，并随机抽样
    // —— 每次扩库看到不同的锚子集 -> 新候选更多样；锚只用已验证的种子/转正项防漂移
    var nonCand = arr.filter(function (it) { return it.tier !== 'candidate'; });
    var anchorCount = Math.min(Math.max(ANCHOR_MIN, Math.min(ANCHOR_MAX, Math.round(nonCand.length * 4 / 5))), nonCand.length);
    var aPool = nonCand.slice();
    for (var ai = aPool.length - 1; ai > 0; ai--) {
      var aj = Math.floor(Math.random() * (ai + 1));
      var atmp = aPool[ai]; aPool[ai] = aPool[aj]; aPool[aj] = atmp;
    }
    var anchors = aPool.slice(0, anchorCount).map(function (it) { return sigOf(it, shape); }).filter(Boolean);
    var p = buildExpandPrompt(field, shape, anchors);
    var raw;
    try { raw = await window.callLLM([{ role: 'system', content: p.system }, { role: 'user', content: p.user }], 0.95, 700); }
    catch (e) { return; }
    var parsed = parseJsonList(raw);
    if (!parsed || !parsed.length) return;
    var existing = {};
    arr.forEach(function (it) { var sg = sigOf(it, shape); if (sg) existing[sg] = true; });
    var added = 0;
    parsed.forEach(function (el) {
      var payload = normalizeCandidate(el, shape);
      if (!payload) return;
      var sig = sigOf({ payload: payload }, shape);
      if (!sig || existing[sig] || d.blacklist.indexOf(sig) !== -1) return;
      if (containsProductParam(sig)) return;            // 红线安全网
      arr.push({ id: catKey + ':c' + (d._cid++), payload: payload, tier: 'candidate', shown: 0, copy: 0, dislike: 0, lastShownEpoch: -999, createdAt: d.epoch });
      existing[sig] = true; added++;
    });
    d.items[catKey] = arr;
    if (added) save();
  }
  async function expand(styleKey) {
    var d = load();
    var now = Date.now();
    if (now - lastExpandAt < EXPAND_COOLDOWN_MS) return;
    if (!window.callLLM) return;
    lastExpandAt = now;
    // 轮换：本轮扩一个类别（风格类轮转 + 偶尔扩通用类）
    var pool = EXPAND_STYLE_FIELDS.map(function (f) {
      return { catKey: 'style.' + styleKey + '.' + f, field: f, shape: fieldShape(f) };
    });
    pool.push({ catKey: 'common.sharedFormulas', field: 'sharedFormulas', shape: 'string' });
    pool.push({ catKey: 'common.sharedVocab', field: 'sharedVocab', shape: 'string' });
    var pick = pool[d.epoch % pool.length];
    await expandOne(pick.catKey, pick.field, pick.shape);
  }

  function stats() {
    var d = load();
    var out = { epoch: d.epoch, blacklist: (d.blacklist || []).length, categories: {} };
    Object.keys(d.items).forEach(function (k) {
      out.categories[k] = {
        total: d.items[k].length,
        seed: countTier(d.items[k], 'seed'),
        active: countTier(d.items[k], 'active'),
        candidate: countTier(d.items[k], 'candidate')
      };
    });
    return out;
  }

  // ---- 调试/管理面板用：详细视图 + 手动操作 ----
  function inspect() {
    var d = load();
    var cats = Object.keys(d.items).map(function (catKey) {
      var shape = shapeOfCatKey(catKey);
      var arr = d.items[catKey] || [];
      var items = arr.map(function (it) {
        return {
          sig: sigOf(it, shape),
          tier: it.tier,
          shown: it.shown || 0,
          copy: it.copy || 0,
          dislike: it.dislike || 0,
          weight: Math.round(weight(it, d.epoch) * 100) / 100,
          banned: isBanned(it, shape)
        };
      }).sort(function (a, b) { return b.weight - a.weight; });
      return {
        catKey: catKey,
        total: arr.length,
        seed: countTier(arr, 'seed'),
        active: countTier(arr, 'active'),
        candidate: countTier(arr, 'candidate'),
        items: items
      };
    }).sort(function (a, b) { return a.catKey < b.catKey ? -1 : 1; });
    return { epoch: d.epoch, blacklist: (d.blacklist || []).slice(), categories: cats };
  }
  function reset() {
    db = freshDB();
    seed();
    epochShown = [];
    save();
  }
  function unban(sig) {
    var d = load();
    var i = d.blacklist.indexOf(sig);
    if (i !== -1) { d.blacklist.splice(i, 1); save(); }
  }
  function removeItem(catKey, sig) {
    var d = load();
    var arr = d.items[catKey];
    if (!arr) return;
    var shape = shapeOfCatKey(catKey);
    d.items[catKey] = arr.filter(function (it) { return sigOf(it, shape) !== sig; });
    save();
  }

  // 初始化（此时 window.COMMON / window.STYLES 已由 styles/*.js 注入）
  load();

  window.EVOLVE = {
    bumpEpoch: bumpEpoch,
    sample: sample,
    recordCopy: recordCopy,
    banCard: banCard,
    expand: expand,
    curate: curate,
    stats: stats,
    inspect: inspect,
    reset: reset,
    unban: unban,
    removeItem: removeItem
  };
})();
