var assert = require('assert');
var harness = require('./app-harness');
var parts = { titles: ['标题一', '标题二'], lines: ['正文一', '正文二', '正文三'] };
var empty = { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] };
async function run() {
  var recovered = harness([empty, { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(parts) }] } }] }]);
  await recovered.generate();
  assert.strictEqual(recovered.requests.length, 2);
  assert.strictEqual(recovered.inputs('titles').length, 2);
  assert.ok(recovered.requests[1].messages[2].content.indexOf('lines 恰好 3') !== -1);
  assert.strictEqual(recovered.requests[1].thinking.type, 'disabled');
  var failed = harness([empty]);
  await failed.generate();
  assert.strictEqual(failed.requests.length, 2);
  assert.ok(failed.ids.generationStatus.innerHTML.indexOf('内容安全过滤') !== -1);
  assert.ok(failed.ids.generationStatus.innerHTML.indexOf('修改建议') !== -1);
  var retained = harness([harness.response(parts), empty]);
  await retained.generate();
  retained.choose('titles', 1); retained.choose('lines', 2);
  await retained.generate();
  assert.strictEqual(retained.ids.compositionPreview.textContent, '标题二\n\n正文三');
  await retained.ids.copySelectionBtn.onclick();
  assert.strictEqual(retained.feedback.length, 1);
  assert.strictEqual(retained.feedback[0].text, '标题二\n\n正文三');
  console.log('empty response tests passed');
}
run().catch(function (e) { console.error(e); process.exitCode = 1; });
