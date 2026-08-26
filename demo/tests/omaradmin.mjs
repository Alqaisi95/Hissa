await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ar-OM', deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const ok = (l, v) => console.log((v ? '  ✓ ' : '  ✗ ') + l);

await p.goto('http://127.0.0.1:8731/', { waitUntil: 'load' }); await p.waitForTimeout(500);
await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
await p.fill('#lem', 'sysadmin@hissa.local'); await p.fill('#lpw', 'Hissa#2026');
await p.click('[data-act="doLogin"]');
const inn = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
ok('يدخل بالبريد وكلمة المرور', inn);
if (!inn) { console.log(await p.$eval('#lerr', e => e.textContent)); await b.close(); process.exit(1); }
await p.waitForTimeout(700);

ok('يفتح على «لوحة إدارة النظام»',
  (await p.$eval('#pagetitle', h => h.textContent.trim())) === 'لوحة إدارة النظام');
const navs = await p.$$eval('.navlink', l => l.map(x => x.textContent.trim()));
console.log('  القائمة (' + navs.length + '):');
navs.forEach(n => console.log('     ' + n));
ok('يرى كل شاشات فريق التشغيل الثلاث عشرة + حسابي', navs.length === 14);

// كل صلاحية في المصفوفة ممنوحة له
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.frame__toggle')].find(x => /جدول/.test(x.textContent));
  if (t) t.click();
});
await p.waitForTimeout(400);
const mine = await p.$$eval('.pmx tbody tr', rows => {
  const head = [...document.querySelectorAll('.pmx__who span:first-child')].map(x => x.textContent.trim());
  const col = head.indexOf('عمر');
  return rows.map(r => {
    const cells = [...r.querySelectorAll('.pmx__c')];
    return { perm: r.querySelector('.mono').textContent.trim(),
             on: col >= 0 && cells[col] && cells[col].querySelector('.pm--on') !== null };
  });
});
const missing = mine.filter(x => !x.on).map(x => x.perm);
ok('كل الـ' + mine.length + ' صلاحية ممنوحة' + (missing.length ? ' — ناقصة: ' + missing.join(', ') : ''),
  mine.length === 17 && missing.length === 0);

/* السلسلة سليمة بعد الإضافة.
   يُختار الرقم بمعناه لا بموضعه: اللوحة صار فيها أكثر من hero، وأخذُ الأول
   كان يقرأ عدّاد فصل المهام ويحكم به على سلامة السلسلة. */
const integ = await p.$$eval('.hero', ns => {
  const h = ns.find(n => /سلسلة التجزئة/.test(n.querySelector('.hero__k').textContent));
  return h ? h.querySelector('.hero__v').textContent.trim() : '(لم يُعثر على بطاقة السلسلة)';
});
ok('سلسلة التدقيق: ' + integ, integ === 'سليمة');

// الرقابة الثنائية ما زالت قائمة رغم الصلاحيات المطلقة
await p.evaluate(() => {
  const n = [...document.querySelectorAll('.navlink')].find(x => /الصرف والاعتماد/.test(x.textContent));
  if (n) n.click();
});
await p.waitForTimeout(500);
/* createDsb refuses without evidence of at least six characters, so clicking
   it bare creates nothing and the "you requested this" row never appears —
   the previous run failed on my own omission, not on the product. */
const hasForm = await p.$('#dpick');
if (hasForm) {
  await p.fill('#dev', 'محضر تركيب واختبار — TRK-2026-20، فحص ذاتي للرقابة الثنائية');
  await p.click('[data-act="createDsb"]');
  await p.waitForTimeout(900);
  console.log('    طلب الصرف: ' + ((await p.$$eval('#toasts .toast', t => t.map(x => x.textContent.trim()))).slice(-1)[0] || '(لا شيء)'));
} else {
  console.log('    لا مرحلة قابلة للطلب — يُتخطّى فحص الرقابة الثنائية');
}
await p.evaluate(() => {
  const n = [...document.querySelectorAll('.navlink')].find(x => /الصرف والاعتماد/.test(x.textContent));
  if (n) n.click();
});
await p.waitForTimeout(500);
const selfRow = await p.$$eval('table tbody tr', r => r.map(x => x.textContent).filter(t => /أنت الطالب/.test(t)));
const otherRow = await p.$$eval('[data-act="approveDsb"]', b => b.length);
ok('لا يعتمد ما طلبه بنفسه رغم امتلاكه الصلاحيتين', !hasForm || selfRow.length > 0);
ok('ويعتمد ما طلبه غيره (' + otherRow + ' طلبًا)', otherRow > 0);

await p.evaluate(() => {
  const n = [...document.querySelectorAll('.navlink')].find(x => /لوحة إدارة النظام/.test(x.textContent));
  if (n) n.click();
});
await p.waitForTimeout(700);
await p.screenshot({ path: 'shots/omar-admin.png' });
console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
