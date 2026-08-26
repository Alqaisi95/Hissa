/* حقوق صاحب البيانات: الوصول، التصحيح، والحذف بحدوده الصادقة. */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const URL = 'http://127.0.0.1:8731/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
const errs = [];
const ok = (l, v) => console.log((v ? '  ✓ ' : '  ✗ ') + l);
const saved = [];

async function open() {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 }, locale: 'ar-OM' });
  await ctx.exposeFunction('__save', html => fs.writeFileSync('serve/index.html', html));
  await ctx.exposeFunction('__file', (name, data) => saved.push({ name, data }));
  await ctx.addInitScript(() => {
    window.claude = { use: n => Promise.resolve(
      n === 'artifact' ? { publish: h => window.__save(h) }
      : n === 'downloads' ? { save: ({ filename, data }) => window.__file(filename, data) }
      : null) };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  return { ctx, p };
}
async function login(p, email, pw) {
  await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
  await p.fill('#lem', email); await p.fill('#lpw', pw);
  await p.click('[data-act="doLogin"]');
  return p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
}
async function goto(p, view) {
  const navs = await p.$$eval('.navlink', l => l.map(x => x.dataset.view));
  const i = navs.indexOf(view);
  if (i < 0) return false;
  (await p.$$('.navlink'))[i].click(); await p.waitForTimeout(450);
  return true;
}
const alerts = p => p.$$eval('#alerts .toast', t => t.map(x => x.textContent.trim()));
const notes  = p => p.$$eval('#toasts .toast', t => t.map(x => x.textContent.trim()));

console.log('══ 1 · حق الوصول: نسخة كاملة ══');
{
  const { ctx, p } = await open();
  await login(p, 'abdullah@example.om', 'Hissa#2026');
  await goto(p, 'acct.me');
  ok('قسم «بياناتي وحقوقي» ظاهر للمستثمر',
    (await p.$$eval('h2', h => h.map(x => x.textContent))).some(t => t.includes('بياناتي وحقوقي')));
  await p.click('[data-act="downloadMyData"]'); await p.waitForTimeout(700);
  const f = saved.slice(-1)[0];
  ok('نُزّل ملف: ' + (f ? f.name : '(لا شيء)'), !!f);
  if (f) {
    const d = JSON.parse(f.data);
    ok('يحمل الحساب والالتزامات وأسطر التدقيق',
      !!d.account && Array.isArray(d.orders) && Array.isArray(d.auditRows));
    ok('التزاماته موجودة فعلًا: ' + d.orders.length, d.orders.length > 0);
    ok('لا ملح ولا تجزئة داخل الملف',
      !('salt' in d.account) && !('pw' in d.account)
      && !/[0-9a-f]{32,}/.test(f.data));
  }
  await ctx.close();
}

console.log('\n══ 2 · حق التصحيح ══');
{
  const { ctx, p } = await open();
  await login(p, 'majid@example.om', 'Hissa#2026');
  await goto(p, 'acct.me');
  /* The inline box keeps the previous attempt's text, and an engine refusal
     goes to the alert region instead — so reading "whatever is on screen"
     reported the wrong reason and every assertion still passed. Clear the box
     first, then take only what this click produced. */
  const say = async (name, email, pw) => {
    await p.evaluate(() => { const e = document.getElementById('rcErr'); if (e) e.innerHTML = ''; });
    await p.fill('#rcName', name); await p.fill('#rcEmail', email); await p.fill('#rcPw', pw);
    const m = { a: (await alerts(p)).length, n: (await notes(p)).length };
    await p.click('[data-act="rectify"]'); await p.waitForTimeout(900);
    const inline = await p.$eval('#rcErr', e => e.textContent.trim()).catch(() => '');
    return inline || (await alerts(p)).slice(m.a).concat((await notes(p)).slice(m.n)).slice(-1)[0] || '';
  };
  const r1 = await say('ماجد البوسعيدي', 'majid@example.om', '');
  ok('بلا كلمة مرور يُرفض: ' + r1, /أكّد بكلمة مرورك/.test(r1));
  const r2 = await say('ماجد ب.', 'majid2@example.om', 'wrong');
  ok('بكلمة مرور خاطئة يُرفض: ' + r2, /كلمة المرور غير صحيحة/.test(r2));
  const r3 = await say('ماجد ب.', 'reem@example.om', 'Hissa#2026');
  ok('بريد مستخدَم يُرفض بالسبب الصحيح: ' + r3, /مسجَّل لحساب آخر/.test(r3));
  const good = await say('ماجد سالم البوسعيدي', 'majid.new@example.om', 'Hissa#2026');
  ok('يُقبل: ' + good, /صُحِّحت/.test(good));
  await ctx.close();
  const c2 = await open();
  ok('البريد الجديد يفتح الحساب', await login(c2.p, 'majid.new@example.om', 'Hissa#2026'));
  await c2.ctx.close();
  const c3 = await open();
  ok('البريد القديم لم يعد يفتحه', !(await login(c3.p, 'majid@example.om', 'Hissa#2026')));
  await c3.ctx.close();
}

console.log('\n══ 3 · حق الحذف — ويرفض حين يجب ══');
{
  const { ctx, p } = await open();
  await login(p, 'admin@hissa.om', 'Hissa#2026');
  await goto(p, 'ops.admin');
  const rows = await p.$$eval('table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok('حساب بالتزامات قائمة يظهر «مانع قائم» لا زرًّا',
    rows.some(r => r.includes('عبدالله الغافري') && r.includes('مانع قائم')));
  ok('لا يُعرض زر طمس لحسابات فريق التشغيل',
    await p.$$eval('[data-act="erasePerson"]', bs => bs.every(x => !/u_(fin|pf|adm|cmp|aud)/.test(x.dataset.user))));

  const free = await p.$('[data-act="erasePerson"]');
  ok('يوجد حساب بلا مانع قابل للطمس', !!free);
  let target = null;
  if (free) {
    target = await free.getAttribute('data-user');
    await free.click(); await p.waitForTimeout(900);
    const t = (await alerts(p)).slice(-1)[0] || '';
    ok('نُفِّذ الطمس: ' + t.slice(0, 60), /طُمست/.test(t));
    const after = await p.$$eval('table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
    ok('صار الاسم «حساب مطموس»', after.some(r => r.includes('حساب مطموس')));
  }

  // the money and the chain must be untouched
  await goto(p, 'ops.audit');
  const integrity = await p.$eval('.note--pos, .note--crit', e => e.textContent.trim());
  ok('سلسلة التدقيق ما زالت سليمة: ' + integrity.slice(0, 46), /سليمة/.test(integrity));
  await ctx.close();

  if (target) {
    const c2 = await open();
    ok('الحساب المطموس لا يفتح بكلمة مروره القديمة',
      !(await login(c2.p, 'pending@example.om', 'Hissa#2026')));
    ok('لا خطأ في الصفحة عند محاولة دخوله', errs.length === 0);
    await c2.ctx.close();
  }
}

console.log('\n══ 4 · لا بريد داخل سطر لا يُعدَّل ══');
{
  const { ctx, p } = await open();
  await login(p, 'admin@hissa.om', 'Hissa#2026');
  await goto(p, 'ops.audit');
  const details = await p.$$eval('table tbody tr td:nth-child(4)', t => t.map(x => x.textContent));
  const withMail = details.filter(t => /@/.test(t));
  /* One row predates the fix and can never be rewritten. Every other row must
     be clean, and the count must not grow. */
  const legacy = withMail.filter(t => t.includes('omar@test.com'));
  ok('لا بريد إلا في السطر القديم الذي لا يُعاد كتابته (' + withMail.length + ' سطر)',
    withMail.length === legacy.length && legacy.length <= 1);
  await ctx.close();
}

console.log('\nerrors:', errs.length ? errs.slice(0, 4) : 'none');
await b.close();
