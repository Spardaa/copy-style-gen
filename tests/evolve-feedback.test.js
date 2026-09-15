var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var storage = {};
var context = {
  localStorage: { getItem: function (k) { return storage[k] || null; }, setItem: function (k, v) { storage[k] = v; } },
  COMMON: { sharedVocab: ['冷雾笼罩', '月光碎片', '未选词句', '经过过滤'] },
  STYLES: { a: { titlePatterns: ['氛围标题'] }, b: { titlePatterns: ['氛围标题'] } }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'evolve.js'), 'utf8'), context);
var engine = context.EVOLVE;
function item(sig, cat) {
  return engine.inspect().categories.filter(function (c) { return c.catKey === (cat || 'common.sharedVocab'); })[0].items.filter(function (i) { return i.sig === sig; })[0];
}
engine.bumpEpoch();
engine.sample('common.sharedVocab', 4);
engine.sample('style.a.titlePatterns', 1);
engine.sample('style.b.titlePatterns', 1);
var snapshot = engine.captureExposure('冷雾笼罩 月光碎片 未选词句 氛围标题');
var all = { titles: ['氛围标题 冷雾笼罩'], lines: ['冷雾笼罩 月光碎片', '未选词句', '经过过滤'] };
engine.recordUsed(all, 'a', snapshot);
assert.strictEqual(item('冷雾笼罩').usedTitle, 1);
assert.strictEqual(item('冷雾笼罩').usedBody, 1);
assert.strictEqual(item('冷雾笼罩').copy, 0, '生成使用不是复制');
assert.strictEqual(item('经过过滤').usedBody, 0, '没有进入最终提示词的素材不可归因');
engine.bumpEpoch();
var selected = { titles: [all.titles[0]], lines: [all.lines[0]] };
engine.recordCopy('copied', 'a', snapshot, selected);
assert.strictEqual(item('冷雾笼罩').copy, 1, '同一次复制的两个区块匹配同一词项只加一次');
assert.strictEqual(item('冷雾笼罩').copyTitle, 1);
assert.strictEqual(item('冷雾笼罩').copyBody, 1);
assert.strictEqual(item('未选词句').copy, 0);
assert.strictEqual(item('氛围标题', 'style.a.titlePatterns').copy, 1);
assert.strictEqual(item('氛围标题', 'style.b.titlePatterns').copy, 0, '不能把其他风格同名词记为复制');
engine.banCard('月光碎片', 'a', snapshot, 'lines');
engine.banCard('月光碎片', 'a', snapshot, 'lines');
assert.strictEqual(item('月光碎片').banned, true);
engine.recordCopy('月光碎片', 'a', snapshot, { titles: [], lines: ['月光碎片'] });
assert.strictEqual(item('月光碎片').dislike, 0);
assert.strictEqual(item('月光碎片').banned, false, '复制能恢复现存种子的黑名单状态');
engine.reset();
engine.recordCopy('copied', 'a', snapshot, selected);
assert.strictEqual(item('冷雾笼罩').copy, 0, '重置后不能反馈到同 ID 的新项');
console.log('evolve feedback tests passed');
