await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ar-OM' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
await p.goto('http://127.0.0.1:8731/', { waitUntil: 'load' });
await p.waitForTimeout(400);

const ok = (label, v) => console.log((v ? '  ✓ ' : '  ✗ ') + label);

console.log('── public ──');
ok('live regions exist before any message',
  await p.evaluate(() => !!document.querySelector('#alerts[role=alert]') && !!document.querySelector('#toasts[role=status]')));
// skip link: first Tab must reach it, and it must be visible once focused
await p.keyboard.press('Tab');
await p.waitForTimeout(250);   // the skip link slides in; measure after it lands
const skip = await p.evaluate(() => {
  const a = document.activeElement;
  return { cls: a.className, top: a.getBoundingClientRect().top, href: a.getAttribute('href') };
});
ok('first Tab lands on the skip link (' + skip.cls + ')', skip.cls === 'skip');
ok('skip link becomes visible when focused (top=' + Math.round(skip.top) + ')', skip.top >= 0 && skip.top < 200);
ok('skip link points at the page heading', skip.href === '#pagetitle');
ok('landing heading is a focus target', await p.$eval('#pagetitle', h => h.tagName === 'H1' && h.tabIndex === -1));

console.log('── signed in ──');
await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
await p.fill('#lem', 'admin@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
await p.click('[data-act="doLogin"]');
await p.waitForSelector('.topbar', { timeout: 9000 });
await p.waitForTimeout(400);
ok('focus moved to the heading of the screen just opened',
  await p.evaluate(() => document.activeElement && document.activeElement.id === 'pagetitle'));
ok('welcome went to the polite region, not the alert one',
  await p.evaluate(() => document.getElementById('toasts').children.length > 0
                      && document.getElementById('alerts').children.length === 0));

const navs = await p.$$('.navlink');
await navs[2].click(); await p.waitForTimeout(400);
ok('focus follows a nav change',
  await p.evaluate(() => document.activeElement && document.activeElement.id === 'pagetitle'));
ok('active nav carries aria-current=page, and only one does',
  await p.$$eval('.navlink', l => l.filter(x => x.getAttribute('aria-current') === 'page').length) === 1);
ok('no navlink advertises aria-current="false"',
  await p.$$eval('.navlink', l => l.every(x => x.getAttribute('aria-current') !== 'false')));
/* Renaming the attribute value once left the stylesheet selecting the old one,
   so the current screen silently lost its highlight and every assertion about
   the attribute still passed. Check that it paints, not just that it is set. */
ok('the current nav entry still looks current', await p.$$eval('.navlink', l => {
  const on = l.find(x => x.getAttribute('aria-current') === 'page');
  const off = l.find(x => x.getAttribute('aria-current') !== 'page');
  if (!on || !off) return false;
  const a = getComputedStyle(on), b = getComputedStyle(off);
  return a.backgroundColor !== b.backgroundColor && a.color !== b.color;
}));

// a refusal must reach the assertive region
await p.evaluate(() => {
  const b = document.createElement('button');
  b.dataset.act = 'approveDsb'; b.dataset.id = 'DSB-2026-0001'; b.id = 'forged';
  document.querySelector('.main__inner').appendChild(b);
});
await p.click('#forged'); await p.waitForTimeout(400);
const alerts = await p.$$eval('#alerts .toast', t => t.map(x => x.textContent.trim()));
ok('a refused action is announced assertively: ' + (alerts.join(' | ') || '(none)'),
  alerts.some(t => /لا تملك صلاحية/.test(t)));
// the refusal re-rendered the shell; focus must come back to the control,
// not fall through to the document body
ok('focus returns to the control after a re-render, not to the body',
  await p.evaluate(() => document.activeElement && document.activeElement !== document.body
    && document.activeElement.id !== 'pagetitle'));

// decorative marks stay out of the accessibility tree
ok('decorative glyphs hidden (brand mark, avatar, nav number, status dot)',
  await p.evaluate(() => ['.brand__mark', '.whoami__av', '.navlink__n', '.savebar__dot']
    .every(s => { const e = document.querySelector(s); return !e || e.getAttribute('aria-hidden') === 'true'; })));

// the forged control was the test's own; it must not count as unnamed markup
await p.evaluate(() => document.getElementById('forged')?.remove());

// every control must be reachable and named
const unnamed = await p.$$eval('button, a[href], select, input, textarea', els => els
  .filter(e => e.offsetParent !== null)
  .filter(e => !(e.textContent || '').trim() && !e.getAttribute('aria-label')
            && !e.getAttribute('title') && !e.labels?.length && !e.getAttribute('placeholder'))
  .map(e => e.tagName + '.' + e.className).slice(0, 8));
ok('every visible control has an accessible name' + (unnamed.length ? ' — ' + unnamed.join(', ') : ''), !unnamed.length);

console.log('errors:', errs.length ? errs : 'none');
await b.close();
