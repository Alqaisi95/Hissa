/* The page rebuilds itself from STYLE_SRC + SCRIPT_SRC on every commit.
   This proves the rebuilt document is still a working application: publish
   once through a stand-in writer, then boot the bytes it produced. */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1360, height: 950 }, locale: 'ar-OM' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => {
  window.__published = null;
  window.claude = { use: n => Promise.resolve(n === 'artifact'
    ? { publish: html => { window.__published = html; return Promise.resolve(); } } : null) };
});
await p.goto('http://127.0.0.1:8731/', { waitUntil: 'load' });
await p.waitForTimeout(500);
await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
await p.fill('#lem', 'compliance@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
await p.click('[data-act="doLogin"]');
await p.waitForSelector('.topbar', { timeout: 9000 });
await p.waitForTimeout(300);
// any state change triggers the rebuild; taking a case is the cheapest one
const nav = await p.$$('.navlink');
for (const n of nav) { const t = await n.textContent(); if (/الحالات|الالتزام/.test(t)) { await n.click(); break; } }
await p.waitForTimeout(400);
const take = await p.$('[data-act="takeCase"]');
if (take) { await take.click(); await p.waitForTimeout(600); }
const html = await p.evaluate(() => window.__published);
console.log('published:', html ? (html.length / 1024 | 0) + ' kb' : '*** nothing published ***');
if (html) {
  for (const [what, needle] of [
    ['skip link',        'class="skip"'],
    ['assertive region', 'id="alerts" role="alert"'],
    ['polite region',    'id="toasts" role="status"'],
    ['state block',      '<script id="appstate"'],
    ['schema stamped',   '"schema":3'],
  ]) console.log((html.includes(needle) ? '  ✓ ' : '  ✗ ') + what);
  fs.writeFileSync('serve/rebuilt.html', html);
  /* A fresh context, not a second tab: the sign-in lives in browser storage
     shared across the context, and booting there would show a signed-in shell
     and prove nothing about a first-time visitor loading the rebuild. */
  const ctx2 = await b.newContext({ viewport: { width: 1360, height: 950 }, locale: 'ar-OM' });
  const p2 = await ctx2.newPage();
  const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto('http://127.0.0.1:8731/rebuilt.html', { waitUntil: 'load' });
  await p2.waitForTimeout(700);
  console.log((await p2.$('.hero') ? '  ✓ ' : '  ✗ ') + 'rebuilt document renders the public site');
  await p2.click('[data-pub="login"]'); await p2.waitForTimeout(250);
  await p2.fill('#lem', 'compliance@hissa.om'); await p2.fill('#lpw', 'Hissa#2026');
  await p2.click('[data-act="doLogin"]');
  const back = await p2.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  console.log((back ? '  ✓ ' : '  ✗ ') + 'signs in on the rebuild');
  if (back) {
    await p2.waitForTimeout(400);
    /* The commit appended an audit row; the rebuilt document must carry it.
       Counting rows on the audit screen is the honest check — searching the
       UI for a label proves nothing when the label may not be rendered. */
    const rows = await p2.$$eval('.navlink', l => l.length);
    for (let i = 0; i < rows; i++) {
      const links = await p2.$$('.navlink');
      const t = await links[i].textContent();
      if (/التدقيق/.test(t)) { await links[i].click(); break; }
    }
    await p2.waitForTimeout(500);
    const audited = await p2.$$eval('tbody tr', r => r.length).catch(() => 0);
    console.log((audited > 1 ? '  ✓ ' : '  ✗ ')
      + 'the commit survived into the rebuild: ' + audited + ' audit rows (seed had 1)');
  }
  console.log('  rebuild errors:', e2.length ? e2.slice(0, 3) : 'none');
}
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
