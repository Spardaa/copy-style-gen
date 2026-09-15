// Run with Playwright installed or available through NODE_PATH. Uses isolated browser data and mocked API responses.
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var chromium = require('playwright').chromium;
var root = path.resolve(__dirname, '..');
async function run() {
  var server = http.createServer(function (req, res) {
    var relative = decodeURIComponent(req.url.split('?')[0]);
    var file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (file.indexOf(root + path.sep) !== 0) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, content) {
      if (err) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html'); res.end(content);
    });
  });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    var page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    var errors = [], requests = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    await page.addInitScript(function () {
      localStorage.setItem('auth_ok', '1');
      localStorage.setItem('baseUrl', 'https://example.test/v1');
      localStorage.setItem('apiKey', 'test-key');
      localStorage.setItem('model', 'deepseek-v4-flash');
      window.testClipboard = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async function (text) { window.testClipboard.push(text); } } });
    });
    var titles = Array.from({ length: 10 }, function (_, i) { return '冷雾氛围标题 ' + (i + 1) + ' 🥲'; });
    var lines = Array.from({ length: 20 }, function (_, i) { return '像雨夜玻璃一样通透，清冷又破碎的氛围 ' + (i + 1); });
    await page.route('https://example.test/**', async function (route) {
      var body = route.request().postDataJSON();
      requests.push(body);
      var expand = body.max_tokens === 1000 || body.messages[0].content.indexOf('词库扩') !== -1;
      await route.fulfill({ json: { choices: [{ message: { content: expand ? '[]' : JSON.stringify({ titles: titles, lines: lines }) }, finish_reason: 'stop' }] } });
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    // Expansion timing is covered by VM tests; avoid incidental background requests here.
    await page.evaluate(function () { window.EVOLVE.expand = function () {}; });
    assert.strictEqual(await page.inputValue('#titleCount'), '10');
    assert.strictEqual(await page.inputValue('#bodyCount'), '20');
    await page.click('#genBtn');
    await page.waitForSelector('.material-option');
    assert.strictEqual(await page.locator('[name="materialTitle"]').count(), 10);
    assert.strictEqual(await page.locator('[name="materialLine"]').count(), 20);
    assert.strictEqual(requests[0].thinking.type, 'disabled');
    assert.strictEqual(requests[0].max_tokens, 3200);
    await page.locator('[name="materialTitle"]').nth(2).check();
    await page.locator('[name="materialLine"]').nth(7).check();
    await page.locator('[name="materialLine"]').nth(1).check();
    await page.locator('[name="materialLine"]').nth(7).uncheck();
    await page.locator('[name="materialLine"]').nth(7).check();
    var expected = titles[2] + '\n\n' + lines[1] + '\n' + lines[7];
    assert.strictEqual(await page.textContent('#compositionPreview'), expected);
    await page.click('#copySelectionBtn');
    assert.deepStrictEqual(await page.evaluate(function () { return window.testClipboard; }), [expected]);
    await page.click('#libPanel summary');
    await page.waitForFunction(function () { return document.getElementById('libTable').textContent.indexOf('标题复制') !== -1; });
    assert.ok((await page.textContent('#libTable')).indexOf('标题复制') !== -1);
    await page.click('#libPanel summary');
    var output = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-composer-qa-'));
    await page.locator('#resultsHead').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(function () { return document.documentElement.scrollWidth <= window.innerWidth; }), 'mobile must not overflow horizontally');
    await page.locator('#composer').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'mobile.png') });
    await page.click('#clearSelectionBtn');
    assert.ok(await page.isDisabled('#copySelectionBtn'));
    await page.fill('#titleCount', '6'); await page.fill('#bodyCount', '12'); await page.locator('#bodyCount').blur();
    await page.reload();
    assert.strictEqual(await page.inputValue('#titleCount'), '6');
    assert.strictEqual(await page.inputValue('#bodyCount'), '12');
    assert.deepStrictEqual(errors, []);
    console.log('browser composer tests passed; screenshots: ' + output);
  } finally {
    if (browser) await browser.close();
    await new Promise(function (resolve) { server.close(resolve); });
  }
}
run().catch(function (err) { console.error(err); process.exitCode = 1; });
