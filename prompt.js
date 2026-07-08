// prompt.js — 装配 styles/*.js 提取的风格数据，提供 buildPrompt / parseCopies
// 风格数据来自 window.STYLES（styles/*.js）与 window.COMMON（styles/common.js），运行时读取
(function () {
  'use strict';

  function joinArr(a, sep) { return (a || []).join(sep || '、'); }
  function formulasBlock(fs) {
    return (fs || []).map(function (f) { return '· ' + f.tpl + '  （例：' + f.ex + '）'; }).join('\n');
  }
  function homophonesBlock(h) {
    return (h || []).map(function (x) { return x.w + '=' + x.m; }).join('；');
  }
  function fewShotsBlock(fs) {
    return (fs || []).map(function (f) {
      return '# ' + f.title + '\n' + (f.lines || []).map(function (l) { return '> ' + l; }).join('\n');
    }).join('\n\n---\n\n');
  }

  function buildPrompt(opts) {
    opts = opts || {};
    var STYLES = window.STYLES || {};
    var COMMON = window.COMMON || {};
    var styleKey = opts.style || 'ssorcon';
    var s = STYLES[styleKey] || STYLES.ssorcon || {};
    var n = Math.max(1, parseInt(opts.count, 10) || 1);

    var sys = [];
    sys.push('# 角色');
    sys.push(COMMON.role || '你是顶级小红书/电商美瞳种草文案写手。');
    sys.push('');
    sys.push('# 目标');
    sys.push('为指定美瞳产品写 ' + n + ' 条小红书种草文案，严格模仿下方风格档。');
    sys.push('');
    sys.push('# 结构与标点（所有风格通用）');
    sys.push(COMMON.structureRule || '');
    sys.push(COMMON.punctuationRule || '');
    sys.push('');
    sys.push('# 通用高频句式（三风格共用，自由穿插）');
    sys.push(joinArr(COMMON.sharedFormulas));
    sys.push('通用网感词：' + joinArr(COMMON.sharedVocab));
    sys.push('通用价格/促销钩子：' + joinArr(COMMON.sharedPriceHooks));
    sys.push('emoji 通则：' + (COMMON.emojiRule || ''));
    sys.push('通用谐音卖萌：' + homophonesBlock(COMMON.homophones));
    sys.push('');
    sys.push('# 本次风格档：' + (s.label || styleKey));
    sys.push('氛围定位：' + (s.vibe || ''));
    sys.push('');
    sys.push('## 该风格偏好句式（叠加在通用句式之上，拉开本风格差异）');
    sys.push(formulasBlock(s.formulas) || '（无）');
    sys.push('');
    sys.push('## 标志性口头禅/梗');
    sys.push(joinArr(s.signatures));
    sys.push('');
    sys.push('## 词库（按用户关键词匹配选用，不要堆砌）');
    sys.push('核心色系：' + joinArr(s.palette));
    sys.push('人设/氛围：' + joinArr(s.persona));
    sys.push('产品规格：' + joinArr(s.specs));
    sys.push('夸张赞美：' + joinArr(s.praise));
    sys.push('价格/促销钩子：' + joinArr(s.priceHooks));
    sys.push('emoji 配色（成簇、贴色系）：' + joinArr(s.emojiCombos));
    sys.push('');
    sys.push('## 标题参考模板（体会节奏与情绪，不要逐字套用）');
    sys.push(joinArr(s.titlePatterns));
    sys.push('');
    sys.push('# 该风格真实样例（仅作风格示范；严禁照抄样例里的具体产品名/价格/角色名/品牌名）');
    // 每次从风格样例池随机洗牌抽 6 条（Fisher-Yates），让每次模仿对象不同，避免千篇一律
    var shotPool = (s.fewShots || []).slice();
    for (var si = shotPool.length - 1; si > 0; si--) {
      var sj = Math.floor(Math.random() * (si + 1));
      var sTmp = shotPool[si]; shotPool[si] = shotPool[sj]; shotPool[sj] = sTmp;
    }
    var shotSample = shotPool.slice(0, Math.min(6, shotPool.length));
    sys.push(fewShotsBlock(shotSample) || '（无）');
    sys.push('');
    sys.push('# 禁忌（重要）');
    sys.push('- 严禁输出具体的二次元角色名（林克/雏田/小舞/知更鸟/温迪等）、品牌或系列专有名（piggyoo/Jumicon/Isoralook 等）、仅出现过一次的生僻色名——这些只是风格方向参考，除非用户关键词明确给出，否则不要写进文案。');
    sys.push('- 严禁照抄样例；' + n + ' 条之间标题、角度、卖点必须互不相同。');
    sys.push('- 【产品参数红线·严禁编造】以下只能来自用户的关键词或过往文案，用户没明确给出的绝不杜撰具体值：① 具体色系名（翡翠绿/克莱因蓝/樱花粉等）② 直径数值（14.5mm 等）③ 价格（29r 等）④ 款式（定轴/非定轴）⑤ 抛型（半年抛/日抛）⑥ 其它可验证规格。用户没给的参数：宁可省略，或用与产品事实无关的氛围/情绪表达填充（阴湿/颓靡/显白/混血感/网感句式/emoji/夸张赞美），也绝不编造数值/色名/价位。');
    sys.push('- 卖点要落到产品的【实际特征】（来自用户输入），不要只空喊赞美；但绝不为"落到产品"而编造用户没给的参数。');
    sys.push('- 该风格独有句式 + 人设/氛围/emoji 配色是拉开差异的关键，请主动用上；但【色系名只能用用户给定的】，不要从风格词库自行挑选色名。');
    sys.push('');
    sys.push('# 输出契约');
    sys.push(COMMON.outputContract || ('直接以 # 开头输出 ' + n + ' 条，每条 = 1 行 # 标题 + 3~5 行 > 引用，条间用单独一行 --- 分隔，无前言/编号/代码块标记。'));
    sys.push('必须恰好输出 ' + n + ' 条，最后一条之后不要输出任何内容。');

    var user = [];
    if (opts.pastCopies && String(opts.pastCopies).trim()) {
      user.push('# 同款产品的过往文案（这是【同一款美瞳上一篇帖子】的文案）');
      user.push('用途：从中提取该产品的【真实信息】——颜色/色系名、直径、款式（是否定轴）、抛型、价格、促销、核心卖点。新生成的文案必须【沿用这些产品信息】保持准确一致，不要编造与原文案冲突的参数。');
      user.push('注意：过往文案的【语气/标题/句式不要照抄】——语气由上方风格档决定，每篇都要有新角度、新表达；你只继承其中的【产品信息】，不是模仿它的写法。');
      user.push(String(opts.pastCopies).trim());
      user.push('');
    }
    var kwFallback = '（用户未额外补充关键词。产品具体参数——色系名/直径/价格/款式/抛型——以【上方过往文案】为准；若过往文案也没有，则【严禁编造】任何色名/数值/价位，宁可只用氛围/情绪/赞美/网感句式 + emoji 表达，也不要杜撰产品参数。）';
    user.push('# 本次产品关键词（特征/颜色/直径/价格/促销钩子等，据此生成）');
    user.push((opts.keywords && String(opts.keywords).trim()) || kwFallback);
    user.push('');
    user.push('# 任务');
    user.push('按上述风格档生成 ' + n + ' 条文案，每条标题/角度/卖点互不重复。直接输出，第 1 条以 # 开头。');

    return {
      messages: [
        { role: 'system', content: sys.join('\n') },
        { role: 'user', content: user.join('\n') }
      ],
      temperature: 0.95
    };
  }

  function parseCopies(text) {
    if (!text) return [];
    text = String(text).replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    var blocks = text.split(/\n\s*-{3,}\s*\n/);
    var results = [];
    blocks.forEach(function (raw) {
      raw = raw.trim();
      if (!raw) return;
      var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var title = '';
      var quoteLines = [];
      lines.forEach(function (l) {
        if (!title && /^#+\s*/.test(l)) {
          title = l.replace(/^#+\s*/, '').trim();
        } else if (l.charAt(0) === '>') {
          quoteLines.push(l.replace(/^>\s?/, '').trim());
        } else if (!title) {
          title = l;
        } else {
          quoteLines.push(l);
        }
      });
      if (title || quoteLines.length) {
        results.push({ title: title || '(无标题)', lines: quoteLines });
      }
    });
    return results;
  }

  window.PromptEngine = {
    buildPrompt: buildPrompt,
    parseCopies: parseCopies,
    STYLES: window.STYLES,
    COMMON: window.COMMON
  };
})();
