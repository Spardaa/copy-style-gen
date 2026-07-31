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
assert.ok(built.messages[0].content.indexOf('每条只负责一个主角度') !== -1);
assert.ok(built.messages[1].content.indexOf('直径：【未提供，禁止提及】') !== -1);

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

console.log('prompt tests passed');
