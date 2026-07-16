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

  // 从自演化词库加权抽样子集；evolve.js 缺失/异常时回退到原全量数组（不影响生成）
  function pick(catKey, fallbackArr, k) {
    if (window.EVOLVE && typeof window.EVOLVE.sample === 'function') {
      try { var r = window.EVOLVE.sample(catKey, k); if (r && r.length) return r; } catch (e) {}
    }
    return fallbackArr || [];
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
    sys.push(joinArr(pick('common.sharedFormulas', COMMON.sharedFormulas, 10)));
    sys.push('通用网感词：' + joinArr(pick('common.sharedVocab', COMMON.sharedVocab, 14)));
    sys.push('通用价格/促销钩子：' + joinArr(COMMON.sharedPriceHooks));
    sys.push('emoji 通则：' + (COMMON.emojiRule || ''));
    sys.push('通用谐音卖萌：' + homophonesBlock(pick('common.homophones', COMMON.homophones, 12)));
    sys.push('');
    sys.push('# 本次风格档：' + (s.label || styleKey));
    sys.push('氛围定位：' + (s.vibe || ''));
    sys.push('');
    sys.push('## 该风格偏好句式（叠加在通用句式之上，拉开本风格差异）');
    sys.push(formulasBlock(pick('style.' + styleKey + '.formulas', s.formulas, 8)) || '（无）');
    sys.push('');
    sys.push('## 标志性口头禅/梗');
    sys.push(joinArr(pick('style.' + styleKey + '.signatures', s.signatures, 8)));
    sys.push('');
    sys.push('## 词库（⚠️ 除标注"可自由发挥"的以外，其余【仅在用户明确提到时】才可用其风格化写法；用户没提的绝不主动写）');
    sys.push('核心色系/色感词库（✅仅可用【与用户给定产品色系相符】的色感词来丰富表达；用户没给颜色时，不得自定具体色名）：' + joinArr(pick('style.' + styleKey + '.palette', s.palette, 18)));
    sys.push('人设/氛围（✅可自由发挥）：' + joinArr(pick('style.' + styleKey + '.persona', s.persona, 8)));
    sys.push('产品规格：定轴/直径/抛型/高光/着色/度数等（⚠️用户没提到的，一个都不许写）：' + joinArr(s.specs));
    sys.push('夸张赞美（✅可自由发挥）：' + joinArr(pick('style.' + styleKey + '.praise', s.praise, 10)));
    sys.push('价格/促销钩子（⚠️用户没给价格/促销的，绝不写）：' + joinArr(s.priceHooks));
    sys.push('emoji 配色（✅可自由发挥，成簇贴色系）：' + joinArr(pick('style.' + styleKey + '.emojiCombos', s.emojiCombos, 10)));
    sys.push('');
    sys.push('## 标题参考模板（体会节奏与情绪，不要逐字套用）');
    sys.push(joinArr(pick('style.' + styleKey + '.titlePatterns', s.titlePatterns, 8)));
    sys.push('');
    sys.push('# 该风格真实样例（仅作风格示范；严禁照抄样例里的具体产品名/价格/角色名/品牌名）');
    // 优先走自演化词库的加权抽样（带 recency 防重复）；evolve.js 缺失时回退 Fisher-Yates 随机 6 条
    var shotSample = null;
    if (window.EVOLVE && typeof window.EVOLVE.sample === 'function') {
      try { shotSample = window.EVOLVE.sample('style.' + styleKey + '.fewShots', 6); } catch (e) { shotSample = null; }
    }
    if (!shotSample || !shotSample.length) {
      var shotPool = (s.fewShots || []).slice();
      for (var si = shotPool.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1));
        var sTmp = shotPool[si]; shotPool[si] = shotPool[sj]; shotPool[sj] = sTmp;
      }
      shotSample = shotPool.slice(0, Math.min(6, shotPool.length));
    }
    sys.push(fewShotsBlock(shotSample) || '（无）');
    sys.push('');
    sys.push('# 禁忌（重要）');
    sys.push('- 严禁输出具体的二次元角色名（林克/雏田/小舞/知更鸟/温迪等）、品牌或系列专有名（piggyoo/Jumicon/Isoralook 等）、仅出现过一次的生僻色名——这些只是风格方向参考，除非用户关键词明确给出，否则不要写进文案。');
    sys.push('- 严禁照抄样例；' + n + ' 条之间标题、角度、卖点必须互不相同。');
    sys.push('- 【产品参数红线·最高优先级·违反即失败】文案里出现的任何【产品事实参数】都必须 100% 来自用户的关键词或过往文案，【用户没提到的，一个都不许自动生成/编造】。包括但不限于：① 产品真实色名/色号（必须与用户给定的产品色系一致；风格色盘里的色感词仅在【与用户给定色系相符】时可用于丰富表达，用户没给颜色时不得自定具体色名）② 直径（14.5mm）③ 价格（29r）④ 款式（定轴/非定轴）⑤ 高光（定位高光/不乱转）⑥ 抛型（半年抛/日抛）⑦ 着色 ⑧ 度数 ⑨ 任何可验证规格。宁可文案只剩氛围/情绪/赞美（阴湿/颓靡/显白/混血感/网感句式/emoji），也绝不杜撰。【样例里出现的具体产品参数 ≠ 你可以用；风格色盘的色感词仅在【与用户给定色系相符】时可用】。');
    sys.push('- 卖点要落到产品的【实际特征】（来自用户输入），不要只空喊赞美；但绝不为"落到产品"而编造用户没给的参数。');
    sys.push('- 该风格独有句式 + 人设/氛围/emoji 配色是拉开差异的关键，请主动用上；但【色系名必须与用户给定的产品色系相符】——风格色盘里的色感词只在【与用户色系一致】时用于丰富表达，用户没给颜色时不要自定具体色名。');
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
    user.push('按上述风格档生成 ' + n + ' 条文案，每条标题/角度/卖点互不重复。');
    user.push('【最后强调·最重要】只允许写用户在上面【明确提到】的产品参数；用户没提到的（价格/直径/定轴/高光/抛型/色系名/度数/着色……任何一个）都【不许自动生成】。拿不准有没有的，就不写。直接输出，第 1 条以 # 开头。');

    return {
      messages: [
        { role: 'system', content: sys.join('\n') },
        { role: 'user', content: user.join('\n') }
      ]
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
