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

  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (x) {
      var key = String(x || '').toLowerCase().replace(/\s+/g, '');
      if (key && !seen[key]) { seen[key] = true; out.push(String(x).trim()); }
    });
    return out;
  }

  function matches(text, re) {
    var out = [], m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) out.push(m[0]);
    return uniq(out);
  }

  // 只提取结构明确、可以机械核验的事实。颜色名保持在原始材料中，不做猜测式抽取。
  function extractProductFacts(pastCopies, keywords) {
    var source = [pastCopies || '', keywords || ''].join('\n').trim();
    var colorSource = source.replace(/(?:显白|白搭|黑科技|深瞳|浅瞳|白皮|黄皮)/g, '');
    var colorTokens = matches(colorSource, /(?:克莱因|酒红|烟灰|雾霾|奶茶|蜜糖色|金色|银色|白色|黑色|白瞳|黑瞳|琥珀|翡翠|香槟|玫瑰|樱花|海盐|黛色|裸色|藕色|茶色|咖色|杏色|红|橙|黄|绿|青|蓝|紫|粉|棕|褐|灰)/g);
    var facts = {
      source: source,
      prices: matches(source, /(?:💰\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:r\b|元|块|💰|十片|[片盒]装))/gi),
      diameters: matches(source, /\d+(?:\.\d+)?\s*mm/gi),
      cycles: matches(source, /(?:日抛|月抛|季抛|半年抛|年抛)/g),
      axis: matches(source, /(?:非定轴|定轴|定位高光|不乱转)/g),
      degrees: matches(source, /(?:平光|无度数|有度数|(?:近视|度数)[:：]?\s*\d+\s*度?)/g),
      promotions: matches(source, /(?:清仓|最后一批|最后现货|售空不补|绝版|停产|退市|手慢(?:无|🈚️)|限时|现货|缺货|下架)/g),
      claims: matches(source, /(?:深瞳(?:也能)?显色|浅瞳(?:也能)?显色|显白|融瞳|放大(?:双眼|感)|小直径|大直径|舒适|不磨眼|不滑片|原相机|原图直出|无滤镜|Live实况|实拍)/gi)
    };
    facts.colorSource = colorTokens.join('、');
    facts.hasColor = colorTokens.length > 0;
    facts.hasAnyStructured = !!(facts.prices.length || facts.diameters.length || facts.cycles.length || facts.axis.length || facts.degrees.length || facts.promotions.length);
    return facts;
  }

  function resolveProductFacts(pastText, keywordText) {
    if (!pastText || !keywordText) return extractProductFacts(pastText, keywordText);
    var pastFacts = extractProductFacts(pastText, '');
    var keywordFacts = extractProductFacts('', keywordText);
    var combinedSource = [pastText, keywordText].join('\n').trim();
    function preferKeyword(field) {
      return keywordFacts[field].length ? keywordFacts[field].slice() : pastFacts[field].slice();
    }
    return {
      source: combinedSource,
      prices: preferKeyword('prices'),
      diameters: preferKeyword('diameters'),
      cycles: preferKeyword('cycles'),
      axis: preferKeyword('axis'),
      degrees: preferKeyword('degrees'),
      promotions: preferKeyword('promotions'),
      claims: preferKeyword('claims'),
      colorSource: keywordFacts.hasColor ? keywordFacts.colorSource : pastFacts.colorSource,
      hasColor: keywordFacts.hasColor || pastFacts.hasColor,
      hasAnyStructured: keywordFacts.hasAnyStructured || pastFacts.hasAnyStructured
    };
  }

  function factsBlock(facts) {
    var lines = [];
    function add(label, arr) { if (arr && arr.length) lines.push(label + '：' + arr.join('、')); }
    add('价格', facts.prices);
    add('直径', facts.diameters);
    add('抛型', facts.cycles);
    add('定轴/高光稳定', facts.axis);
    add('度数', facts.degrees);
    add('促销/库存状态', facts.promotions);
    add('效果/拍摄声明', facts.claims);
    if (facts.hasColor) lines.push('颜色/色号：原始材料中包含颜色描述，请沿用原文叫法或同色系氛围表达');
    if (!lines.length) lines.push('未机械识别到数值型参数或固定规格；这是正常情况，不代表产品资料不足。');
    return lines.join('\n');
  }

  function colorFamilies(text) {
    var defs = [
      { key: 'green', re: /绿|青|翡|橄榄|苔|薄荷|抹茶|森林|孔雀|💚|🍀|🌿|🐸/ },
      { key: 'blue', re: /蓝|海盐|克莱因|湖水|冰川|晴空|海洋|🩵|💧|🔵|🧿|🦋/ },
      { key: 'purple', re: /紫|藕|薰衣草|葡萄|鸢尾|💜|🪻|🍇|🦄|🔯/ },
      { key: 'red', re: /红|酒|血|玫瑰|樱桃|赤|莓|🩸|🍷|🥀|❤️|🔴/ },
      { key: 'pink', re: /粉|樱花|蜜桃|桃|初恋|🩷|🌸|💗|🎀/ },
      { key: 'brown', re: /棕|褐|茶|咖|杏|蜜|琥珀|焦糖|奶油|金|香槟|🤎|🪵|🐻|💛|🍊/ },
      { key: 'gray', re: /灰|银|黑|白|烟|雾|黛|裸|🩶|🖤|🤍|🐦‍⬛|⚔️/ }
    ];
    var out = [];
    defs.forEach(function (d) { if (d.re.test(text || '')) out.push(d); });
    return out;
  }

  function filterByColor(arr, source, limit) {
    var fams = colorFamilies(source);
    if (!fams.length) return [];
    var matched = (arr || []).filter(function (item) {
      var s = typeof item === 'string' ? item : JSON.stringify(item);
      for (var i = 0; i < fams.length; i++) if (fams[i].re.test(s)) return true;
      return false;
    });
    return matched.slice(0, limit);
  }

  function sanitizeFewShot(f) {
    function clean(s) {
      return String(s || '')
        .replace(/\d+(?:\.\d+)?\s*mm/gi, '[直径参数]')
        .replace(/(?:💰\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:r\b|元|块|💰|十片|[片盒]装))/gi, '[价格信息]')
        .replace(/(?:日抛|月抛|季抛|半年抛|年抛)/g, '[抛型参数]')
        .replace(/(?:非定轴|定轴|定位高光|不乱转)/g, '[规格卖点]')
        .replace(/(?:平光|无度数|有度数|(?:近视|度数)[:：]?\s*\d+\s*度?)/g, '[度数参数]')
        .replace(/(?:清仓|最后一批|最后现货|售空不补|绝版|停产|退市|手慢(?:无|🈚️)|限时|现货|缺货|下架)/g, '[促销信息]')
        .replace(/(?:深瞳(?:也能)?显色|浅瞳(?:也能)?显色|显白|融瞳|放大(?:双眼|感)|小直径|大直径|舒适|不磨眼|不滑片|原相机|原图直出|无滤镜|Live实况|实拍)/gi, '[效果声明]');
    }
    return { title: clean(f.title), lines: (f.lines || []).map(clean) };
  }

  function sanitizeReference(s, facts) {
    var out = String(s || '')
      .replace(/\d+(?:\.\d+)?\s*mm/gi, '[用户已给直径]')
      .replace(/(?:💰\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:r\b|元|块|💰|十片|[片盒]装))/gi, '[用户已给价格]')
      .replace(/(?:清仓|最后一批|最后现货|售空不补|绝版|停产|退市|手慢(?:无|🈚️)|限时|现货|缺货|下架)/g, '[用户已给促销信息]');
    if (!facts.cycles.length) out = out.replace(/(?:日抛|月抛|季抛|半年抛|年抛)/g, '[用户已给抛型]');
    if (!facts.axis.length) out = out.replace(/(?:非定轴|定轴|定位高光|不乱转)/g, '[用户已给规格]');
    if (!facts.degrees.length) out = out.replace(/(?:平光|无度数|有度数|(?:近视|度数)[:：]?\s*\d+\s*度?)/g, '[用户已给度数]');
    if (!facts.claims.length) out = out.replace(/(?:深瞳(?:也能)?显色|浅瞳(?:也能)?显色|显白|融瞳|放大(?:双眼|感)|小直径|大直径|舒适|不磨眼|不滑片|原相机|原图直出|无滤镜|Live实况|实拍)/gi, '[用户已给效果]');
    return out;
  }

  function sanitizeStrings(arr, facts) {
    return (arr || []).map(function (x) { return sanitizeReference(x, facts); });
  }

  function sanitizeFormulas(arr, facts) {
    return (arr || []).map(function (f) {
      return { tpl: sanitizeReference(f.tpl, facts), ex: sanitizeReference(f.ex, facts) };
    });
  }

  function creativeAngles(n, facts) {
    var pool = [
      '第一眼视觉冲击：突出用户已给颜色带来的上眼感受',
      '人设氛围：把这副美瞳写成一种具体人物气质',
      '真实佩戴场景：拍照、约会、通勤或妆容搭配，任选一个具体场景',
      '细节质感：只围绕用户明确给出的花纹、融瞳、显色或其他卖点',
      '情绪共鸣：从“终于找到本命款”的口吻切入',
      '反差感：素眼与上眼后的气质变化，但不得编造参数',
      '朋友视角：像闺蜜看到上眼效果后的即时反应',
      '收藏理由：总结它为什么值得反复戴，不添加新事实',
      '妆容适配：围绕用户给出的色系匹配妆容氛围',
      '短促爆点：用最强的一项已知卖点完成高密度表达'
    ];
    if (facts.prices.length || facts.promotions.length) pool[4] = '购买钩子：只使用用户资料里的价格或促销信息制造紧迫感';
    if (!facts.hasColor) {
      pool[0] = '第一眼氛围冲击：不提具体颜色，用气质和情绪描述上眼感受';
      pool[8] = '妆容氛围：只谈风格适配，不虚构具体色系';
    }
    var out = [];
    for (var i = 0; i < n; i++) out.push((i + 1) + '. ' + pool[i % pool.length]);
    return out.join('\n');
  }

  function inputModeOf(pastText, keywordText) {
    if (pastText && keywordText) return 'past_and_keywords';
    if (pastText) return 'past_only';
    if (keywordText) return 'keywords_only';
    return 'empty';
  }

  function inputModeRule(mode) {
    if (mode === 'past_only') {
      return '本次是【仅过往文案模式】：用户没有填写产品关键词是正常且完整的输入。必须把过往文案当作本款产品的唯一资料来源，理解其中所有明确描述；颜色、数值参数、价格或促销若有则继承，没有也完全不影响生成。即使过往文案只有质感、花纹、氛围或上眼观感，也要据此直接创作；不得拒绝生成、不得要求补充关键词、不得输出说明或提问。';
    }
    if (mode === 'past_and_keywords') {
      return '本次是【过往文案 + 关键词模式】：过往文案提供同款产品的基础事实，关键词提供本次新增或修正信息。两者冲突时以本次关键词为准；不冲突的信息可以合并使用。';
    }
    if (mode === 'keywords_only') {
      return '本次是【仅关键词模式】：只以关键词为产品事实来源，直接完成创作，不得要求用户补充过往文案。';
    }
    return '本次是【无产品资料模式】：仍须按风格直接生成，只写氛围、人设、情绪和不涉及产品事实的赞美；不得拒绝生成或要求补充资料。';
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
    var counts = normalizeCounts(opts);
    var target = counts.titleCount + ' 条独立标题和 ' + counts.bodyCount + ' 条独立正文句子';
    var pastText = opts.pastCopies && String(opts.pastCopies).trim() ? String(opts.pastCopies).trim() : '';
    var keywordText = opts.keywords && String(opts.keywords).trim() ? String(opts.keywords).trim() : '';
    var inputMode = inputModeOf(pastText, keywordText);
    var facts = resolveProductFacts(pastText, keywordText);

    var sys = [];
    sys.push('# 角色');
    sys.push(sanitizeReference(COMMON.role || '你是顶级小红书/电商美瞳种草文案写手。', facts));
    sys.push('');
    sys.push('# 目标');
    sys.push('为指定美瞳产品写 ' + target + '，严格模仿下方风格档。标题与正文是两个独立素材池，不配对，不按文章分组。');
    sys.push(inputModeRule(inputMode));
    sys.push('');
    sys.push('# 结构与标点（所有风格通用）');
    sys.push('标题短促有网感，约10～22字，可带1～2簇emoji；每条正文约12～40字，仅为一行独立、完整的句子，可自由组合，不依赖任何标题或相邻句子。');
    sys.push(sanitizeReference(COMMON.punctuationRule || '', facts));
    sys.push('');
    sys.push('# 通用高频句式（三风格共用，自由穿插）');
    sys.push(joinArr(sanitizeStrings(pick('common.sharedFormulas', COMMON.sharedFormulas, 10), facts)));
    sys.push('通用网感词：' + joinArr(sanitizeStrings(pick('common.sharedVocab', COMMON.sharedVocab, 14), facts)));
    sys.push('emoji 通则：' + sanitizeReference(COMMON.emojiRule || '', facts));
    sys.push('通用谐音卖萌：' + homophonesBlock(pick('common.homophones', COMMON.homophones, 12)));
    sys.push('');
    sys.push('# 本次风格档：' + (s.label || styleKey));
    sys.push('氛围定位：' + (s.vibe || ''));
    sys.push('');
    sys.push('## 该风格偏好句式（叠加在通用句式之上，拉开本风格差异）');
    sys.push(formulasBlock(sanitizeFormulas(pick('style.' + styleKey + '.formulas', s.formulas, 8), facts)) || '（无）');
    sys.push('');
    sys.push('## 标志性口头禅/梗');
    sys.push(joinArr(sanitizeStrings(pick('style.' + styleKey + '.signatures', s.signatures, 8), facts)));
    sys.push('');
    sys.push('## 安全词库（只提供本次真正可用的创作素材）');
    var paletteSample = facts.hasColor ? filterByColor(pick('style.' + styleKey + '.palette', s.palette, 24), facts.colorSource, 8) : [];
    sys.push('同色系氛围色词：' + (paletteSample.length ? joinArr(paletteSample) : '（本次不提供；不得自定具体颜色）'));
    sys.push('人设/氛围（✅可自由发挥）：' + joinArr(pick('style.' + styleKey + '.persona', s.persona, 8)));
    sys.push('夸张赞美（✅可自由发挥）：' + joinArr(pick('style.' + styleKey + '.praise', s.praise, 10)));
    var emojiSample = facts.hasColor ? filterByColor(pick('style.' + styleKey + '.emojiCombos', s.emojiCombos, 14), facts.colorSource, 6) : [];
    sys.push('emoji 配色：' + (emojiSample.length ? joinArr(emojiSample) : '使用与风格相符的中性情绪 emoji，不暗示具体产品颜色'));
    sys.push('');
    sys.push('## 标题参考模板（体会节奏与情绪，不要逐字套用）');
    sys.push(joinArr(sanitizeStrings(pick('style.' + styleKey + '.titlePatterns', s.titlePatterns, 8), facts)));
    sys.push('');
    sys.push('# 该风格真实样例（仅作风格示范；严禁照抄样例里的具体产品名/价格/角色名/品牌名）');
    // 优先走自演化词库的加权抽样（带 recency 防重复）；evolve.js 缺失时回退 Fisher-Yates 随机 6 条
    var shotSample = null;
    if (window.EVOLVE && typeof window.EVOLVE.sample === 'function') {
      try { shotSample = window.EVOLVE.sample('style.' + styleKey + '.fewShots', 4); } catch (e) { shotSample = null; }
    }
    if (!shotSample || !shotSample.length) {
      var shotPool = (s.fewShots || []).slice();
      for (var si = shotPool.length - 1; si > 0; si--) {
        var sj = Math.floor(Math.random() * (si + 1));
        var sTmp = shotPool[si]; shotPool[si] = shotPool[sj]; shotPool[sj] = sTmp;
      }
      shotSample = shotPool.slice(0, Math.min(4, shotPool.length));
    }
    sys.push(fewShotsBlock((shotSample || []).map(sanitizeFewShot)) || '（无）');
    sys.push('');
    sys.push('# 禁忌（重要）');
    sys.push('- 严禁输出具体的二次元角色名（林克/雏田/小舞/知更鸟/温迪等）、品牌或系列专有名（piggyoo/Jumicon/Isoralook 等）、仅出现过一次的生僻色名——这些只是风格方向参考，除非用户输入资料（关键词或过往文案）明确给出，否则不要写进文案。');
    sys.push('- 严禁照抄样例；标题之间、正文之间分别避免重复。同一产品特征可以换角度表达，但不得编造卖点凑数。样例仅供学习语气，不沿用标题加多行正文的成篇结构。');
    sys.push('- 【产品参数红线·最高优先级·违反即失败】文案里出现的任何【产品事实参数】都必须 100% 来自用户的关键词或过往文案，【用户没提到的，一个都不许自动生成/编造】。包括但不限于：① 产品真实色名/色号（必须与用户给定的产品色系一致；风格色盘里的色感词仅在【与用户给定色系相符】时可用于丰富表达，用户没给颜色时不得自定具体色名）② 直径（14.5mm）③ 价格（29r）④ 款式（定轴/非定轴）⑤ 高光（定位高光/不乱转）⑥ 抛型（半年抛/日抛）⑦ 着色 ⑧ 度数 ⑨ 任何可验证规格。宁可文案只剩氛围/情绪/赞美（阴湿/颓靡/显白/混血感/网感句式/emoji），也绝不杜撰。【样例里出现的具体产品参数 ≠ 你可以用；风格色盘的色感词仅在【与用户给定色系相符】时可用】。');
    sys.push('- 卖点要落到产品的【实际特征】（来自用户输入），不要只空喊赞美；但绝不为"落到产品"而编造用户没给的参数。');
    sys.push('- 该风格独有句式 + 人设/氛围/emoji 配色是拉开差异的关键，请主动用上；但【色系名必须与用户给定的产品色系相符】——风格色盘里的色感词只在【与用户色系一致】时用于丰富表达，用户没给颜色时不要自定具体色名。');
    sys.push('');
    sys.push('# 独立素材的内容角度');
    sys.push('标题突出不同情绪或画面；正文分别从用户提供的产品描述、场景、氛围、人设和感叹切入，每句表达完整，不出现“上述”“接着”“这也是”等对其他句子的依赖。');
    sys.push('');
    sys.push('# 输出契约');
    sys.push(materialContract(counts));
    sys.push('正文要有具体画面和自然口语，避免把词库机械堆叠。');
    sys.push('产品卖点、参数、价格、促销均为【条件项】：用户输入资料明确表达过才可以写。机械抽取只辅助识别结构化字段，不能覆盖或否定过往文案中的定性描述。');
    sys.push('参考素材中的方括号内容只是安全占位符，最终文案严禁输出任何占位符。');
    sys.push('必须恰好输出 ' + target + '，JSON 对象之后不要输出任何内容。');

    var user = [];
    user.push('# 本次输入模式');
    user.push(inputModeRule(inputMode));
    user.push('');
    user.push('# 机械识别到的结构化信息（仅作辅助，不是完整清单）');
    user.push(factsBlock(facts));
    user.push('未列出的字段仅表示正则没有识别到固定格式，不代表用户没有提供产品描述，也不代表资料不足。');
    user.push('过往文案和关键词里的明确描述都属于可用信息，包括花纹、质感、通透感、氛围、人设、上眼观感、妆容适配和使用场景；请理解原意后用于创作。');
    user.push('不要在最终回答中复述识别结果、资料状态或缺失字段，直接输出文案。');
    user.push('');
    if (pastText) {
      user.push('# 同款产品的过往文案（这是【同一款美瞳上一篇帖子】的文案）');
      if (inputMode === 'past_and_keywords') {
        user.push('用途：从中提取该产品的基础信息——颜色/色系名、直径、款式（是否定轴）、抛型、价格、促销、核心卖点。本次关键词中出现的同类字段会覆盖这里的旧值，其余信息继续沿用。');
      } else {
        user.push('用途：理解并继承文案中明确表达的产品内容，包括定性描述与核心卖点；颜色、直径、款式、抛型、价格或促销只有原文出现时才继承。原文没有数值参数是正常情况，不影响生成。');
      }
      user.push('注意：过往文案的【语气/标题/句式不要照抄】——语气由上方风格档决定，每篇都要有新角度、新表达；你只继承其中的【产品信息】，不是模仿它的写法。');
      user.push('<past_copy_data>');
      user.push(pastText);
      user.push('</past_copy_data>');
      user.push('');
    }
    if (keywordText) {
      user.push('# 本次产品关键词（特征/颜色/直径/价格/促销钩子等）');
      if (inputMode === 'past_and_keywords') user.push('关键词是本次最新补充：若与过往文案冲突，以这里为准；其余产品事实继续沿用过往文案。');
      user.push('<keyword_data>');
      user.push(keywordText);
      user.push('</keyword_data>');
      user.push('');
    } else if (inputMode === 'past_only') {
      user.push('# 关键词状态');
      user.push('本次未填写关键词；这不影响生成。请完整使用上方过往文案中的产品事实和卖点。');
      user.push('');
    }
    user.push('# 任务');
    if (inputMode === 'past_only') {
      user.push('仅根据上方同款过往文案提取产品信息，按所选风格重新创作 ' + target + '。必须直接生成，不得因为关键词为空而拒绝、解释或提问。');
    } else if (inputMode === 'past_and_keywords') {
      user.push('综合过往文案与本次关键词，按所选风格生成 ' + target + '；冲突信息以关键词为准。');
      user.push('凡是关键词已经提供的字段，只能使用关键词里的最新值，不得再使用过往文案中的同类旧值。');
    } else {
      user.push('按上述风格档生成 ' + target + '。');
    }
    user.push('标题和正文不需要强关联，不按索引对应；正文每行可独立选用。');
    user.push('只写用户明确提供的产品事实，没有参数时照常使用定性描述、氛围创作。');
    user.push(materialContract(counts));

    return {
      messages: [
        { role: 'system', content: sys.join('\n') },
        { role: 'user', content: user.join('\n') }
      ],
      facts: facts,
      titleCount: counts.titleCount,
      bodyCount: counts.bodyCount,
      inputMode: inputMode
    };
  }

  function normalizeCounts(opts) {
    opts = opts || {};
    function limit(value, fallback, max) {
      var n = parseInt(value, 10);
      return Math.max(1, Math.min(max, isFinite(n) ? n : fallback));
    }
    return { titleCount: limit(opts.titleCount, 10, 30), bodyCount: limit(opts.bodyCount, 20, 50) };
  }

  function materialContract(counts) {
    return '只输出一个 JSON 对象，结构为 {"titles":["独立标题"],"lines":["独立正文句子"]}。titles 恰好 ' +
      counts.titleCount + ' 个字符串，lines 恰好 ' + counts.bodyCount +
      ' 个字符串；每个字符串只含一行，不含编号或 Markdown 标记；不得输出嵌套文章、解释或代码块。';
  }

  function parseMaterials(raw) {
    var text = String(raw || '').trim().replace(/^```(?:json|markdown)?\s*\n?/i, '').replace(/\n?```$/, '').trim();
    var out = { titles: [], lines: [] };
    function clean(items) {
      if (!Array.isArray(items)) return [];
      return uniq(items.filter(function (x) { return typeof x === 'string'; }).map(function (x) {
        return x.replace(/\s*\n\s*/g, ' ').replace(/^\s*(?:#{1,6}\s+|>\s*|[-*]\s+|\d+[、)]\s*|\d+\.(?!\d)\s*)/, '').trim();
      }));
    }
    try {
      var data = JSON.parse(text);
      if (data && typeof data === 'object') return { titles: clean(data.titles), lines: clean(data.lines) };
    } catch (e) {}
    // 只接受明确的双分区文本；拒绝把错误说明或成篇文案猜成素材。
    var section = '';
    text.split(/\r?\n/).forEach(function (line) {
      var heading = line.trim().replace(/^#{1,6}\s*/, '').replace(/[:：]$/, '');
      if (/^(?:标题|titles)(?:\s*[（(]\d+\s*条?[）)])?$/i.test(heading)) { section = 'titles'; return; }
      if (/^(?:正文|文案|lines)(?:\s*[（(]\d+\s*条?[）)])?$/i.test(heading)) { section = 'lines'; return; }
      if (section && /^\s*(?:[-*]\s+|>\s*|\d+[.、)]\s*)\S/.test(line)) out[section].push(line);
    });
    return { titles: clean(out.titles), lines: clean(out.lines) };
  }

  function validateMaterials(parts, counts) {
    var issues = [];
    if (parts.titles.length !== counts.titleCount) issues.push('标题应为 ' + counts.titleCount + ' 条，实际 ' + parts.titles.length + ' 条');
    if (parts.lines.length !== counts.bodyCount) issues.push('正文应为 ' + counts.bodyCount + ' 条，实际 ' + parts.lines.length + ' 条');
    return issues;
  }

  function parseCopies(text) {
    if (!text) return [];
    text = String(text).replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    // 同时兼容标准 --- 分隔和模型漏写分隔符、直接连续输出多个 # 标题的情况。
    var blocks = text.split(/\n\s*-{3,}\s*\n|\n(?=#+\s+)/);
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

  function normalizeFact(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function unauthorized(found, source) {
    var src = normalizeFact(source), bad = [];
    found.forEach(function (x) { if (src.indexOf(normalizeFact(x)) === -1) bad.push(x); });
    return uniq(bad);
  }

  function validateCopies(copies, facts, expectedCount) {
    facts = facts || extractProductFacts('', '');
    var issues = [];
    if (copies.length !== expectedCount) issues.push('应输出 ' + expectedCount + ' 条，实际解析到 ' + copies.length + ' 条');
    copies.forEach(function (c, i) {
      var text = [c.title].concat(c.lines || []).join('\n');
      if (!c.title || c.title === '(无标题)') issues.push('第 ' + (i + 1) + ' 条缺少标题');
      if (!c.lines || c.lines.length < 3 || c.lines.length > 5) issues.push('第 ' + (i + 1) + ' 条正文必须为 3～5 行');
      var badPrice = unauthorized(matches(text, /(?:💰\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:r\b|元|块|💰|十片|[片盒]装))/gi), facts.source);
      var badDiameter = unauthorized(matches(text, /\d+(?:\.\d+)?\s*mm/gi), facts.source);
      var badCycle = unauthorized(matches(text, /(?:日抛|月抛|季抛|半年抛|年抛)/g), facts.source);
      var badAxis = unauthorized(matches(text, /(?:非定轴|定轴|定位高光|不乱转)/g), facts.source);
      var badDegree = unauthorized(matches(text, /(?:平光|无度数|有度数|(?:近视|度数)[:：]?\s*\d+\s*度?)/g), facts.source);
      var badPromo = unauthorized(matches(text, /(?:清仓|最后一批|最后现货|售空不补|绝版|停产|退市|手慢(?:无|🈚️)|限时|现货|缺货|下架)/g), facts.source);
      var badClaim = unauthorized(matches(text, /(?:深瞳(?:也能)?显色|浅瞳(?:也能)?显色|显白|融瞳|放大(?:双眼|感)|小直径|大直径|舒适|不磨眼|不滑片|原相机|原图直出|无滤镜|Live实况|实拍)/gi), facts.source);
      if (badPrice.length) issues.push('第 ' + (i + 1) + ' 条出现未授权价格：' + badPrice.join('、'));
      if (badDiameter.length) issues.push('第 ' + (i + 1) + ' 条出现未授权直径：' + badDiameter.join('、'));
      if (badCycle.length) issues.push('第 ' + (i + 1) + ' 条出现未授权抛型：' + badCycle.join('、'));
      if (badAxis.length) issues.push('第 ' + (i + 1) + ' 条出现未授权规格：' + badAxis.join('、'));
      if (badDegree.length) issues.push('第 ' + (i + 1) + ' 条出现未授权度数：' + badDegree.join('、'));
      if (badPromo.length) issues.push('第 ' + (i + 1) + ' 条出现未授权促销信息：' + badPromo.join('、'));
      if (badClaim.length) issues.push('第 ' + (i + 1) + ' 条出现未授权效果声明：' + badClaim.join('、'));
      if (/\[[^\]]+\]|【用户已给[^】]+】/.test(text)) issues.push('第 ' + (i + 1) + ' 条错误输出了参考占位符');
    });
    var seenTitles = {};
    copies.forEach(function (c, i) {
      var key = normalizeFact(c.title).replace(/[^\w\u4e00-\u9fa5]/g, '');
      if (key && seenTitles[key] != null) issues.push('第 ' + (i + 1) + ' 条与第 ' + (seenTitles[key] + 1) + ' 条标题重复');
      else if (key) seenTitles[key] = i;
    });
    return issues;
  }

  function classifyIssues(issues) {
    var out = { format: [], safety: [], quality: [] };
    (issues || []).forEach(function (issue) {
      if (/应输出|缺少标题|正文必须为/.test(issue)) out.format.push(issue);
      else if (/未授权|占位符/.test(issue)) out.safety.push(issue);
      else out.quality.push(issue);
    });
    return out;
  }

  // 格式修复使用独立的短提示词，不重复发送完整风格库，也不允许改写或补充产品事实。
  function buildFormatRepairMessages(raw, issues, expectedCount) {
    return [
      {
        role: 'system',
        content: [
          '你是纯文本格式整理器，不是文案写手。',
          '只整理现有内容的 Markdown 结构，禁止润色、改写、补充、删除产品事实，禁止新增价格、颜色、参数、促销或卖点。',
          materialContract(expectedCount),
          '将标题提取到 titles，将独立正文句子提取到 lines。数量不足时保留已有内容，不得编造新文案凑数。',
          '无前言、编号、解释或代码块；第一个字符必须是 {。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          '自动检查发现的格式问题：',
          (issues || []).map(function (x) { return '- ' + x; }).join('\n'),
          '',
          '请只修复下面文本的格式：',
          '<draft>',
          String(raw || ''),
          '</draft>'
        ].join('\n')
      }
    ];
  }

  // 空响应恢复必须重新执行原任务；没有草稿可整理，因此保留原上下文并追加一条强约束指令。
  function buildEmptyRecoveryMessages(originalMessages, expectedCount, diagnostic) {
    var messages = (originalMessages || []).map(function (message) {
      return { role: message.role, content: message.content };
    });
    var finishReason = diagnostic && diagnostic.finishReason ? diagnostic.finishReason : '未提供';
    messages.push({
      role: 'user',
      content: [
        '【空响应恢复审查】上一次调用没有返回可见正文（finish_reason：' + finishReason + '）。',
        '请重新检查并完整执行上面的原始文案任务，不要解释空响应原因。',
        materialContract(expectedCount),
        '不要输出前言、分析、拒绝说明、代码块或任何格式外文字；第一个字符必须是 {。'
      ].join('\n')
    });
    return messages;
  }

  window.PromptEngine = {
    buildPrompt: buildPrompt,
    normalizeCounts: normalizeCounts,
    parseMaterials: parseMaterials,
    validateMaterials: validateMaterials,
    parseCopies: parseCopies,
    extractProductFacts: extractProductFacts,
    validateCopies: validateCopies,
    classifyIssues: classifyIssues,
    buildFormatRepairMessages: buildFormatRepairMessages,
    buildEmptyRecoveryMessages: buildEmptyRecoveryMessages,
    STYLES: window.STYLES,
    COMMON: window.COMMON
  };
})();
