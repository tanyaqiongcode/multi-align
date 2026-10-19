// Real-time browser runner: virtual-time dump-dom can outrun File.arrayBuffer I/O.
const { chromium } = require('playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript({ path: path.join(__dirname, 'import_snippet.js') });
    await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
    await page.waitForSelector('#e2e-result', { state: 'attached' });
    const result = JSON.parse(await page.locator('#e2e-result').getAttribute('data-result'));
    assert.equal(result.fatal, undefined);
    for (const key of ['batch', 'replace', 'card', 'invalid']) assert.equal(result[key], 'ok', key);
    assert.deepEqual(result.errors, []);
    console.log('Import E2E passed:', result);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
