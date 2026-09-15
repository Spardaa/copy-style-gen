var assert = require('assert');
var harness = require('./app-harness');
var parts = { titles: ['标题一', '标题二'], lines: ['正文一', '正文二', '正文三'] };
async function run() {
  var app = harness([harness.response(parts)]);
  await app.generate();
  assert.deepStrictEqual(app.requests[0].thinking, { type: 'disabled' });
  assert.strictEqual(app.requests.length, 1);
  assert.strictEqual(app.inputs('titles').length, 2);
  assert.strictEqual(app.inputs('lines').length, 3);
  assert.ok(app.events.indexOf('render') < app.events.indexOf('expand'));
  assert.ok(app.ids.copySelectionBtn.disabled);
  app.choose('titles', 0); app.choose('titles', 1);
  app.choose('lines', 2); app.choose('lines', 0);
  assert.strictEqual(app.ids.compositionPreview.textContent, '标题二\n\n正文三\n正文一');
  assert.strictEqual(app.feedback.length, 0, '勾选不计复制');
  app.choose('lines', 2, false); app.choose('lines', 2);
  assert.strictEqual(app.ids.compositionPreview.textContent, '标题二\n\n正文一\n正文三');
  app.radios[1].checked = true; app.radios[1].handlers.change();
  await app.ids.copySelectionBtn.onclick();
  assert.deepStrictEqual(app.clipboard, ['标题二\n\n正文一\n正文三']);
  assert.strictEqual(app.feedback[0].style, 'ssorcon', '切换风格不改变当前批次的反馈归属');
  assert.strictEqual(app.feedback[0].parts.lines.length, 2);
  app.context.navigator.clipboard.writeText = async function () { throw new Error('denied'); };
  await app.ids.copySelectionBtn.onclick();
  assert.strictEqual(app.feedback.length, 1, '复制失败不能加分');
  app.ids.clearSelectionBtn.onclick();
  assert.ok(app.ids.copySelectionBtn.disabled);

  var malformed = harness([
    { choices: [{ message: { content: '不是文案格式' } }] },
    harness.response(parts)
  ]);
  await malformed.generate();
  assert.strictEqual(malformed.requests.length, 2);
  assert.strictEqual(malformed.inputs('titles').length, 2);
  assert.ok(malformed.requests[1].messages[0].content.indexOf('titles 恰好 2') !== -1);

  var partial = harness([harness.response({ titles: ['已有标题'], lines: ['已有正文'] })]);
  await partial.generate();
  assert.strictEqual(partial.requests.length, 2);
  assert.ok(partial.ids.generationStatus.textContent.indexOf('已保留可用素材') !== -1);
  assert.strictEqual(partial.inputs('lines').length, 1);
  console.log('app flow tests passed');
}
run().catch(function (e) { console.error(e); process.exitCode = 1; });
