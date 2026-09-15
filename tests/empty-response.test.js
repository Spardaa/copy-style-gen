var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function element(id, events) {
  return {
    id: id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    options: [],
    addEventListener: function () {},
    querySelectorAll: function () { return []; },
    appendChild: function () { if (id === 'results') events.push('render'); },
    classList: { add: function () {}, remove: function () {} }
  };
}

async function scenario(responses) {
  var events = [];
  var ids = {};
  [
    'results', 'baseUrl', 'apiKey', 'model', 'count', 'temperature', 'tempVal',
    'resultsHead', 'resultsTitle', 'copyAllBtn', 'genBtn', 'pastCopies', 'keywords',
    'libPanel', 'libRefresh', 'libReset', 'libCat', 'libOnlyCand'
  ].forEach(function (id) { ids[id] = element(id, events); });
  ids.baseUrl.value = 'https://example.test/v1';
  ids.apiKey.value = 'test-key';
  ids.model.value = 'test-model';
  ids.count.value = '1';
  ids.temperature.value = '0.95';

  var call = 0;
  var context = {
    console: console,
    AbortController: AbortController,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    localStorage: {
      getItem: function (key) {
        return { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', count: '1', temperature: '0.95' }[key] || null;
      },
      setItem: function () {}
    },
    document: {
      getElementById: function (id) { return ids[id] || null; },
      querySelectorAll: function () { return []; },
      createElement: function () { return element('card', events); },
      body: { appendChild: function () {}, removeChild: function () {} }
    },
    fetch: async function () {
      var response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { ok: true, json: async function () { return response; } };
    }
  };
  context.window = context;
  context.PromptEngine = {
    STYLES: { ssorcon: {} },
    buildPrompt: function () { return { messages: [{ role: 'user', content: '原任务' }], facts: {}, count: 1 }; },
    buildEmptyRecoveryMessages: function (messages) {
      events.push('recovery');
      return messages.concat([{ role: 'user', content: '恢复' }]);
    },
    parseCopies: function (raw) {
      return raw ? [{ title: '标题', lines: ['一', '二', '三'] }] : [];
    },
    validateCopies: function () { return []; },
    classifyIssues: function () { return { format: [], safety: [], quality: [] }; },
    buildFormatRepairMessages: function () { return []; }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  await ids.genBtn.onclick();
  return { ids: ids, events: events, calls: call };
}

async function run() {
  var recovered = await scenario([
    { choices: [{ message: { content: '' }, finish_reason: 'stop' }] },
    { choices: [{ message: { content: [{ type: 'text', text: '# 标题\n> 一\n> 二\n> 三' }] }, finish_reason: 'stop' }] }
  ]);
  assert.strictEqual(recovered.calls, 2, '真正空响应应只追加一次恢复调用');
  assert.ok(recovered.events.indexOf('recovery') !== -1);
  assert.ok(recovered.events.indexOf('render') !== -1, '内容数组中的正文应被识别并渲染');

  var failed = await scenario([
    { choices: [{ message: { content: null }, finish_reason: 'content_filter' }] },
    { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }
  ]);
  assert.strictEqual(failed.calls, 2, '恢复失败后不应无限重试');
  assert.ok(failed.ids.results.innerHTML.indexOf('连续两次返回为空') !== -1);
  assert.ok(failed.ids.results.innerHTML.indexOf('内容安全过滤') !== -1);
  assert.ok(failed.ids.results.innerHTML.indexOf('修改建议') !== -1);
  console.log('empty response tests passed');
}

run().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
