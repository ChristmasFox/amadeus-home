/** Self-contained browser acceptance: synthetic data, desktop + phone, detail, PNG download, exact replay seek. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { startHighlightFixture } from '../tests/highlights-fixture.js';

const args = process.argv.slice(2);
const shotsIndex = args.indexOf('--shots');
const artifacts = shotsIndex >= 0 && args[shotsIndex + 1] ? resolve(args[shotsIndex + 1]!) : mkdtempSync(join(tmpdir(), 'pubg-highlight-ui-'));
mkdirSync(artifacts, { recursive: true });
const server = await startHighlightFixture();
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 1000 }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
    await page.goto(`${server.url}/?tab=highlights`);
    await page.waitForFunction(() => document.querySelectorAll('.hl-item').length === 12);
    await page.locator('.hl-filters').getByRole('button', { name: /^队友救援/u }).click();
    assert.equal(await page.locator('.hl-item').count(), 3);
    await page.locator('.hl-item').last().click();
    await page.locator('.hl-evidence').getByText('对局 highlight-1', { exact: true }).waitFor();
    assert.match(await page.locator('.hl-summary').innerText(), /30 秒/u);
    await page.evaluate(() => document.fonts.ready);
    const image = await page.locator('.hl-poster').evaluate((canvas) => ({ width: (canvas as HTMLCanvasElement).width, height: (canvas as HTMLCanvasElement).height }));
    assert.deepEqual(image, { width: 1200, height: 1500 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 PNG 海报', exact: true }).click()]);
    const file = join(artifacts, `${name}-poster.png`); await download.saveAs(file);
    const png = readFileSync(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 1500);
    assert.ok(png.length > 20_000, 'poster has rendered content');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no sideways overflow (${name}: ${overflow})`);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.hl-page')?.scrollTo(0, 0); });
    await page.screenshot({ path: join(artifacts, `${name}-highlights.png`), fullPage: true });
    const replay = page.getByRole('link', { name: '↗ 跳到这段回放', exact: true });
    const target = new URL((await replay.getAttribute('href'))!, server.url);
    const time = target.searchParams.get('t');
    assert.equal(target.searchParams.get('match'), 'highlight-1');
    await replay.click();
    const slider = page.getByRole('slider', { name: '回放时间' });
    await slider.waitFor();
    await page.waitForFunction((expected) => (document.querySelector('input[aria-label="回放时间"]') as HTMLInputElement)?.value === expected, time);
    assert.equal(await slider.inputValue(), time);
    await page.screenshot({ path: join(artifacts, `${name}-replay.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: cross-match list → rescue detail → 1200×1500 PNG → highlight-1 @ ${time}s`);
  }
  assert.equal(server.sourceUnchanged(), true);
  console.log(`PASS source snapshot unchanged; artifacts: ${artifacts}`);
} finally { await browser.close(); await server.close(); }
