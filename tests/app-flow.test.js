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

async function run() {
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
      events.push('main-request');
      return {
        ok: true,
        json: async function () { return { choices: [{ message: { content: '# 标题\n> 一\n> 二\n> 三' } }] }; }
      };
    }
  };
  context.window = context;
  context.PromptEngine = {
    STYLES: { ssorcon: {} },
    buildPrompt: function () { return { messages: [], facts: {}, count: 1 }; },
    parseCopies: function () { return [{ title: '标题', lines: ['一', '二', '三'] }]; },
    validateCopies: function () { return ['第 1 条出现未授权价格：29r']; },
    classifyIssues: function () { return { format: [], safety: ['第 1 条出现未授权价格：29r'], quality: [] }; },
    buildFormatRepairMessages: function () { return []; }
  };
  context.EVOLVE = {
    bumpEpoch: function () {},
    expand: function () { events.push('expand'); }
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8'), context, { filename: 'app.js' });
  await ids.genBtn.onclick();
  await new Promise(function (resolve) { setTimeout(resolve, 10); });

  assert.ok(events.indexOf('main-request') !== -1);
  assert.ok(events.indexOf('render') !== -1);
  assert.ok(ids.results.innerHTML.indexOf('已阻止展示') === -1, '参数提示不应再阻止结果展示');
  assert.ok(events.indexOf('expand') !== -1);
  assert.ok(events.indexOf('render') < events.indexOf('expand'), '扩库必须在结果渲染之后启动');
  console.log('app flow tests passed');
}

run().catch(function (e) {
  console.error(e);
  process.exitCode = 1;
});
