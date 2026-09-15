var fs = require('fs');
var path = require('path');
var vm = require('vm');

module.exports = function (responses, settings) {
  settings = Object.assign({ baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'deepseek-v4-flash', titleCount: '2', bodyCount: '3' }, settings);
  var events = [], requests = [], clipboard = [], feedback = [], timers = [];
  function Node(tag, id) {
    this.tagName = tag; this.id = id; this.children = []; this.style = {}; this.dataset = {};
    this.options = []; this.value = ''; this.textContent = ''; this.disabled = false; this.handlers = {};
    this.classList = { add: function () {}, remove: function () {}, toggle: function () {} };
  }
  Object.defineProperty(Node.prototype, 'innerHTML', {
    get: function () { return this.html || ''; },
    set: function (v) { this.html = v; this.children = []; }
  });
  Object.defineProperty(Node.prototype, 'nextSibling', {
    get: function () { return this.parentNode.children[this.parentNode.children.indexOf(this) + 1]; }
  });
  Node.prototype.setAttribute = function (key, value) { this[key] = value; };
  Node.prototype.addEventListener = function (name, fn) { this.handlers[name] = fn; };
  Node.prototype.appendChild = function (node) { node.parentNode = this; this.children.push(node); if (this.id === 'results') events.push('render'); };
  Node.prototype.querySelectorAll = function (selector) {
    var all = [];
    function visit(n) { n.children.forEach(function (c) { if (selector === '.material-option input' && c.tagName === 'input') all.push(c); visit(c); }); }
    visit(this); return all;
  };
  var ids = {};
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var re = /id="([^"]+)"/g, match;
  while ((match = re.exec(html))) ids[match[1]] = new Node('div', match[1]);
  var radios = ['ssorcon', 'sakura_red', 'sakura_blue'].map(function (value) {
    var radio = new Node('input'); radio.value = value; radio.closest = function () { return null; }; return radio;
  });
  var context = {
    console: console, AbortController: AbortController,
    setTimeout: function (fn, ms) { if (ms === 0) timers.push(fn); return 1; }, clearTimeout: function () {},
    localStorage: { getItem: function (k) { return settings[k] || null; }, setItem: function (k, v) { settings[k] = v; } },
    document: {
      getElementById: function (id) { return ids[id] || null; },
      querySelectorAll: function (selector) { return selector === 'input[name="style"]' ? radios : []; },
      createElement: function (tag) { return new Node(tag); },
      body: new Node('body')
    },
    navigator: { clipboard: { writeText: async function (text) { clipboard.push(text); } } },
    isSecureContext: true,
    fetch: async function (url, opts) {
      var index = requests.length; requests.push(JSON.parse(opts.body)); events.push('request');
      var data = responses[Math.min(index, responses.length - 1)];
      if (typeof data === 'function') data = await data();
      return { ok: true, json: async function () { return data; } };
    }
  };
  context.window = context;
  vm.createContext(context);
  ['styles/common.js', 'styles/ssorcon.js', 'styles/sakura_blue.js', 'styles/sakura_red.js', 'prompt.js'].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  });
  context.EVOLVE = {
    bumpEpoch: function () {}, captureExposure: function () { return ['source-snapshot']; },
    recordUsed: function () { events.push('used'); },
    recordCopy: function (text, style, snapshot, parts) { feedback.push({ text: text, style: style, snapshot: snapshot, parts: parts }); },
    expand: function () { events.push('expand'); }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), context);
  return {
    context: context, ids: ids, events: events, requests: requests, clipboard: clipboard, feedback: feedback, radios: radios,
    generate: async function () { await ids.genBtn.onclick(); timers.splice(0).forEach(function (fn) { fn(); }); },
    inputs: function (kind) { return ids.results.querySelectorAll('.material-option input').filter(function (input) { return input.dataset.kind === kind; }); },
    choose: function (kind, i, checked) { var input = this.inputs(kind)[i]; input.checked = checked !== false; input.onchange(); }
  };
};
module.exports.response = function (parts) { return { choices: [{ message: { content: JSON.stringify(parts) }, finish_reason: 'stop' }] }; };
