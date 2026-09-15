var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var context = { window: {}, console: console };
context.window = context;
vm.createContext(context);

['styles/common.js', 'styles/ssorcon.js', 'styles/sakura_blue.js', 'styles/sakura_red.js', 'prompt.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
});

var engine = context.PromptEngine;

var facts = engine.extractProductFacts('', '定轴 翡翠绿 14.5mm 半年抛 29r 最后一批 深瞳显白');
assert.deepStrictEqual(Array.prototype.slice.call(facts.prices), ['29r']);
assert.deepStrictEqual(Array.prototype.slice.call(facts.diameters), ['14.5mm']);
assert.deepStrictEqual(Array.prototype.slice.call(facts.cycles), ['半年抛']);
assert.strictEqual(facts.hasColor, true);

var noColor = engine.extractProductFacts('', '深瞳显白 原相机出片');
assert.strictEqual(noColor.hasColor, false, '“显白”不应被误判为用户提供了白色产品');
var atmosphereOnly = engine.extractProductFacts('', '奶凶暗黑感 氛围很绝');
assert.strictEqual(atmosphereOnly.hasColor, false, '氛围词不应被误判为具体产品颜色');

var built = engine.buildPrompt({ style: 'ssorcon', count: 99, keywords: '翡翠绿 29r' });
assert.strictEqual(built.count, 10, '生成数量必须限制到 1～10');
assert.strictEqual(built.inputMode, 'keywords_only');
assert.ok(built.messages[0].content.indexOf('每条只负责一个主角度') !== -1);
assert.ok(built.messages[1].content.indexOf('直径：【未提供，禁止提及】') === -1, '未识别字段不应再以禁止项逐条列出');

var pastOnly = engine.buildPrompt({
  style: 'ssorcon',
  count: 5,
  pastCopies: '# 翡翠绿太绝了\n> 14.5mm 半年抛\n> 29r最后一批',
  keywords: '   '
});
assert.strictEqual(pastOnly.inputMode, 'past_only');
assert.ok(pastOnly.messages[0].content.indexOf('仅过往文案模式') !== -1);
assert.ok(pastOnly.messages[1].content.indexOf('不得因为关键词为空而拒绝') !== -1);
assert.ok(pastOnly.messages[1].content.indexOf('<keyword_data>') === -1, '仅过往文案模式不应构造虚假的关键词区块');
assert.deepStrictEqual(Array.prototype.slice.call(pastOnly.facts.prices), ['29r']);

var descriptivePastOnly = engine.buildPrompt({
  style: 'sakura_blue',
  count: 3,
  pastCopies: '像雨夜玻璃一样通透，外圈柔和，上眼是清冷又破碎的氛围感。'
});
assert.strictEqual(descriptivePastOnly.inputMode, 'past_only');
assert.strictEqual(descriptivePastOnly.facts.hasAnyStructured, false);
assert.ok(descriptivePastOnly.messages[1].content.indexOf('这是正常情况，不代表产品资料不足') !== -1);
assert.ok(descriptivePastOnly.messages[1].content.indexOf('花纹、质感、通透感、氛围') !== -1);
assert.ok(descriptivePastOnly.messages[0].content.indexOf('只有质感、花纹、氛围或上眼观感，也要据此直接创作') !== -1);
assert.ok(descriptivePastOnly.messages[1].content.indexOf('未提供，禁止提及') === -1);
assert.ok(descriptivePastOnly.messages[1].content.indexOf('不得因为关键词为空而拒绝') !== -1);

var pastAndKeywords = engine.buildPrompt({
  style: 'sakura_red',
  count: 3,
  pastCopies: '棕色 14.2mm 39r',
  keywords: '本次价格29r，最后一批'
});
assert.strictEqual(pastAndKeywords.inputMode, 'past_and_keywords');
assert.ok(pastAndKeywords.messages[0].content.indexOf('过往文案 + 关键词模式') !== -1);
assert.ok(pastAndKeywords.messages[1].content.indexOf('冲突时以本次关键词为准') !== -1);
assert.deepStrictEqual(Array.prototype.slice.call(pastAndKeywords.facts.prices), ['29r'], '关键词价格应覆盖过往价格');
assert.deepStrictEqual(Array.prototype.slice.call(pastAndKeywords.facts.diameters), ['14.2mm'], '关键词未提供的字段应沿用过往文案');

var emptyInput = engine.buildPrompt({ style: 'sakura_blue', count: 2 });
assert.strictEqual(emptyInput.inputMode, 'empty');
assert.ok(emptyInput.messages[0].content.indexOf('仍须按风格直接生成') !== -1);

var parsed = engine.parseCopies('# 标题1\n> 一\n> 二\n> 三\n# 标题2\n> 四\n> 五\n> 六');
assert.strictEqual(parsed.length, 2, '漏写 --- 时也应按标题拆成两条');

var unauthorized = engine.validateCopies([
  { title: '测试', lines: ['29r拿下', '14.5mm上眼', '半年抛', '最后一批'] }
], engine.extractProductFacts('', '翡翠绿'), 1);
assert.ok(unauthorized.some(function (x) { return x.indexOf('未授权价格') !== -1; }));
assert.ok(unauthorized.some(function (x) { return x.indexOf('未授权直径') !== -1; }));
assert.ok(unauthorized.some(function (x) { return x.indexOf('未授权抛型') !== -1; }));
assert.ok(unauthorized.some(function (x) { return x.indexOf('未授权促销') !== -1; }));

var claimIssue = engine.validateCopies([
  { title: '测试', lines: ['原相机实拍', '深瞳显色', '氛围拉满'] }
], engine.extractProductFacts('', '翡翠绿'), 1);
assert.ok(claimIssue.some(function (x) { return x.indexOf('未授权效果声明') !== -1; }));

var authorized = engine.validateCopies([
  { title: '测试', lines: ['29r拿下', '14.5mm上眼', '半年抛定轴', '最后一批'] }
], facts, 1);
assert.deepStrictEqual(Array.prototype.slice.call(authorized), []);

var grouped = engine.classifyIssues([
  '应输出 5 条，实际解析到 4 条',
  '第 1 条正文必须为 3～5 行',
  '第 2 条出现未授权价格：29r',
  '第 3 条与第 1 条标题重复'
]);
assert.strictEqual(grouped.format.length, 2);
assert.strictEqual(grouped.safety.length, 1);
assert.strictEqual(grouped.quality.length, 1);

var formatMessages = engine.buildFormatRepairMessages(
  '# 标题\n正文一\n正文二\n正文三',
  grouped.format,
  1
);
assert.strictEqual(formatMessages.length, 2, '格式修复应使用独立短提示词');
assert.ok(formatMessages[0].content.indexOf('纯文本格式整理器') !== -1);
assert.ok(formatMessages[0].content.indexOf('禁止润色、改写') !== -1);
assert.ok(formatMessages[1].content.indexOf('<draft>') !== -1);

var recoveryMessages = engine.buildEmptyRecoveryMessages(
  [{ role: 'system', content: '原系统提示' }, { role: 'user', content: '原任务' }],
  3,
  { finishReason: 'stop' }
);
assert.strictEqual(recoveryMessages.length, 3, '空响应恢复应保留原任务并追加审查指令');
assert.strictEqual(recoveryMessages[0].content, '原系统提示');
assert.ok(recoveryMessages[2].content.indexOf('恰好 3 条') !== -1);
assert.ok(recoveryMessages[2].content.indexOf('第一个字符必须是 #') !== -1);

console.log('prompt tests passed');
