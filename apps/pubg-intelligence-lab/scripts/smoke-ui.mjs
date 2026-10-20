// Opens every tab of a running Intelligence Lab in a real browser, on a desktop and on a phone, and checks that the page
// renders without console errors, failed requests or sideways overflow. Usage:
//   pnpm smoke:ui [url] [--shots directory]
// The url defaults to PUBG_INTELLIGENCE_URL or http://127.0.0.1:4179; the browser defaults to the macOS Chrome (CHROME overrides).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const shotsAt = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const base = (args.find((value) => /^https?:/u.test(value)) ?? process.env.PUBG_INTELLIGENCE_URL ?? 'http://127.0.0.1:4179').replace(/\/$/u, '');
const executablePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

const TABS = ['overview', 'field', 'style', 'compare', 'match', 'highlights', 'chat', 'lab'];
const VIEWPORTS = [
  { name: 'desktop', options: { viewport: { width: 1500, height: 1000 } } },
  { name: 'phone', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

const failures = [];
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const sample = await (await fetch(`${base}/api/matches?mode=squad&complete=1`)).json();
  const matchId = sample.matches?.[0]?.matchId ?? '';
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext(viewport.options);
    for (const tab of TABS) {
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
      page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/u.test(message.text())) problems.push(`console error: ${message.text()}`); });
      // The page cancels in-flight requests when the scope changes; that is normal, not a failure.
      page.on('requestfailed', (request) => { if (!/ABORTED|cancel/iu.test(request.failure()?.errorText ?? '')) problems.push(`request failed: ${request.url()}`); });
      page.on('response', (response) => { if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`); });
      const query = tab === 'match' && matchId ? `?tab=match&match=${encodeURIComponent(matchId)}` : `?tab=${tab}`;
      await page.goto(`${base}/${query}`, { waitUntil: 'load' });
      // The analysis tabs show a spinner until their data arrives; wait for real content.
      await page.waitForFunction(() => !document.querySelector('.av-spinner') && (document.querySelector('.workspace-body')?.textContent ?? '').trim().length > 60, null, { timeout: 120000 }).catch(() => problems.push('content never appeared'));
      await page.waitForTimeout(800);
      const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, text: (document.querySelector('.workspace-body')?.textContent ?? '').trim().length }));
      if (metrics.scrollWidth > metrics.clientWidth + 1) problems.push(`sideways overflow: page is ${metrics.scrollWidth}px wide in a ${metrics.clientWidth}px viewport`);
      if (viewport.name === 'phone' && tab === 'overview') {
        await page.click('.rail-toggle').catch(() => problems.push('scope drawer button missing'));
        const open = await page.waitForSelector('.left-rail.open', { timeout: 3000 }).then(() => true).catch(() => false);
        if (!open) problems.push('scope drawer did not open');
      }
      if (shotsAt) await page.screenshot({ path: `${shotsAt}/${viewport.name}-${tab}.png`, fullPage: true });
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${viewport.name.padEnd(7)} ${tab.padEnd(8)} ${metrics.text} chars${problems.length ? '\n     ' + problems.join('\n     ') : ''}`);
      for (const problem of problems) failures.push(`${viewport.name}/${tab}: ${problem}`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (failures.length) { console.error(`\n${failures.length} problem(s)`); process.exit(1); }
console.log('\nall pages rendered cleanly');
