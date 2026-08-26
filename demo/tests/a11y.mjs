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

/* كان هذا يطبع ولا يُفشل: بقي فحصٌ ساقطًا صامتًا حتّى كشفه تغييرٌ آخر.
   الفحص الذي لا يُفشل ليس شبكة أمان بل زينة. */
let bad = 0;
const ok = (label, v) => { if (!v) bad += 1; console.log((v ? '  ✓ ' : '  ✗ ') + label); };

console.log('── public ──');
ok('live regions exist before any message',
  await p.evaluate(() => !!document.querySelector('#alerts[role=alert]') && !!document.querySelector('#toasts[role=status]')));
// skip link: first Tab must reach it, and it must be visible once focused
await p.keyboard.press('Tab');
await p.waitForTimeout(250);   // the skip link slides in; measure after it lands
const skip = await p.evaluate(() => {
  const a = document.activeElement;
  return { cls: a.className, tag: a.tagName, act: a.dataset.act,
           top: a.getBoundingClientRect().top };
});
ok('first Tab lands on the skip control (' + skip.cls + ')', skip.cls === 'skip');
ok('skip control becomes visible when focused (top=' + Math.round(skip.top) + ')', skip.top >= 0 && skip.top < 200);
/* لم يعد <a href="#pagetitle">: الهاش صار شريط العنوان، ورابط جزء فيه يُقرأ
   مسارًا فيغادر الشاشة. صار زرًّا ينقل التركيز. */
ok('skip is a button that moves focus, not a fragment link',
  skip.tag === 'BUTTON' && skip.act === 'skipMain');
await p.evaluate(() => document.querySelector('.skip').click());
await p.waitForTimeout(200);
ok('and it lands the reader on the heading',
  await p.evaluate(() => document.activeElement && document.activeElement.id === 'pagetitle'));
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

/* ══ ثوابت الهاتف ═══════════════════════════════════════════════════════
   هذه هي الأرقام التي أنتجها التشخيص (npm run demo:audit) بعد إصلاحه، وهي
   هنا لتُفشل الدفعة إن ارتدّت. الأداة تصف الحال كاملًا؛ هذا يحرس الحدّ. */
console.log('── الهاتف ──');
const phone = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  hasTouch: true, isMobile: true, locale: 'ar-OM',
});
const mp = await phone.newPage();
mp.on('pageerror', e => errs.push('phone: ' + e.message));
await mp.goto('http://127.0.0.1:8731/', { waitUntil: 'load' });
await mp.waitForTimeout(350);
await mp.click('[data-pub="login"]'); await mp.waitForTimeout(200);
await mp.fill('#lem', 'sysadmin@hissa.local'); await mp.fill('#lpw', 'Hissa#2026');
await mp.click('[data-act="doLogin"]'); await mp.waitForTimeout(1500);

const PHONE_SCREENS = ['ops.adash', 'ops.dash', 'ops.admin', 'ops.audit', 'ops.money', 'ops.recon'];
const worst = { doc: 0, nav: 0, table: 0, small: 0 };
for (const v of PHONE_SCREENS) {
  await mp.goto('http://127.0.0.1:8731/#/' + v.replace('.', '/'), { waitUntil: 'load' });
  await mp.waitForTimeout(420);
  const m = await mp.evaluate(() => {
    const vis = e => {
      if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0;
    };
    const bar = document.querySelector('.tabbar');
    const tw = [...document.querySelectorAll('.tablewrap')].filter(vis)
      .map(w => w.scrollWidth - w.clientWidth);
    const small = [...document.querySelectorAll('a[href],button,select,input,textarea,summary')]
      .filter(vis).filter(e => e.getBoundingClientRect().height < 44).length;
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nav: bar ? bar.scrollWidth - bar.clientWidth : 0,
      table: Math.max(0, ...tw, 0),
      small,
    };
  });
  Object.keys(worst).forEach(k => { worst[k] = Math.max(worst[k], m[k]); });
}
ok('390px: لا فيض أفقي في أي شاشة (' + worst.doc + ')', worst.doc === 0);
ok('390px: التنقّل لا يُمرَّر أفقيًّا — كان 2254px (' + worst.nav + ')', worst.nav === 0);
ok('390px: لا جدول يفيض — كان 145px (' + worst.table + ')', worst.table === 0);
ok('390px: لا هدف لمس دون 44px — كانت 7 (' + worst.small + ')', worst.small === 0);
ok('390px: الشريط السفلي موجود والقائمة الجانبية مخفية', await mp.evaluate(() =>
  getComputedStyle(document.querySelector('.tabbar')).display !== 'none'
  && getComputedStyle(document.querySelector('.side')).display === 'none'));
ok('390px: «المزيد» يفتح ورقة بكل الشاشات', await (async () => {
  await mp.click('.tabbar [data-act="moreNav"]'); await mp.waitForTimeout(350);
  const n = await mp.$$eval('.sheet a.navlink', l => l.length);
  /* تُغلق بالمفتاح — ورقة لا تُغلق من لوحة المفاتيح مصيدة */
  await mp.keyboard.press('Escape'); await mp.waitForTimeout(250);
  const gone = !(await mp.$('.sheet'));
  return n === 15 && gone;
})());
/* على شاشة فيها صفوف فعلًا: آخر شاشة في الحلقة قد تكون فارغة، وجدول بلا
   صفوف لا يثبت شيئًا عن شكل الصفّ. */
await mp.goto('http://127.0.0.1:8731/#/ops/admin', { waitUntil: 'load' });
await mp.waitForTimeout(500);
ok('390px: الجداول صارت بطاقات لكل صفّ', await mp.evaluate(() => {
  const td = document.querySelector('.dt tbody td[data-label]');
  if (!td) return false;
  const tr = td.closest('tr');
  return getComputedStyle(td).display === 'grid'
      && getComputedStyle(tr).display === 'block'
      && getComputedStyle(td.closest('table').querySelector('thead')).position === 'absolute';
}));

console.log('errors:', errs.length ? errs : 'none');
if (errs.length) bad += 1;
await b.close();
console.log(bad ? '\n✗ ' + bad + ' فحصًا فشل\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
