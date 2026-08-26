/* PWA — ما تثبته هذه الاختبارات:
   ١ المانيفست يُخدم بنوعه الصحيح ويُقرأ، ومساراته نسبية (شرط GitHub Pages)
   ٢ عامل الخدمة يُسجَّل ويسيطر على الصفحة
   ٣ ثم تُقطع الشبكة كليًّا وتُعاد الصفحة — فتعمل بالكامل: تفتح، وتُسجّل دخولًا،
     وتصل لوحة الإدارة. هذا هو الفرق بين «أضفنا مانيفست» و«يعمل دون اتصال».
   ٤ النسخة العامة لا تحمل بريدًا خارج نطاقَي البذرة
   ٥ اسم مخزن عامل الخدمة يحمل بصمة البناء — وإلا لما وصل أي تحديث

   127.0.0.1 سياق آمن بحكم المواصفة، فعامل الخدمة يعمل عليه دون شهادة.
   يُشغَّل من جذر المستودع:  node demo/tests/pwa.mjs                          */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8749;
const BASE = 'http://127.0.0.1:' + PORT + '/';

let bad = 0;
const ok = (l, v, extra) => {
  if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (extra ? ' — ' + extra : ''));
};

/* ══ الحارس: لا بريد حقيقي في نسخة عامة ══ */
console.log('\n══ نظافة النسخة العامة ══');
const html = fs.readFileSync('site/index.html', 'utf8');
const foreign = [...new Set((html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
  .filter(e => !/@(example\.om|hissa\.om)$/.test(e)))];
ok('لا بريد خارج نطاقَي البذرة', foreign.length === 0, foreign.join(', ') || 'نظيفة');

const sw = fs.readFileSync('site/sw.js', 'utf8');
const build = (sw.match(/const BUILD = '([0-9a-f]+)'/) || [])[1];
ok('اسم المخزن يحمل بصمة البناء', !!build && build !== '__BUILD__', build || 'غير مستبدلة');
ok('البصمة تطابق محتوى index.html',
  build === (await import('node:crypto')).createHash('sha256')
    .update(fs.readFileSync('site/index.html')).digest('hex').slice(0, 12));

/* ══ الخادم ══ */
const srv = spawn(process.execPath, ['demo/tools/serve.mjs', 'site', String(PORT)],
  { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ar-OM' });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

try {
  console.log('\n══ المانيفست ══');
  const mres = await p.request.get(BASE + 'manifest.webmanifest');
  ok('يُخدم بنوع manifest', /application\/manifest\+json/.test(mres.headers()['content-type'] || ''),
    mres.headers()['content-type']);
  const man = await mres.json();
  ok('اسم وأيقونات ولون', !!man.name && man.icons.length >= 2 && !!man.theme_color);
  ok('يحمل أيقونة maskable', man.icons.some(i => /maskable/.test(i.purpose || '')));
  ok('كل المسارات نسبية — شرط الخدمة تحت /repo/ على Pages',
    man.start_url.startsWith('.') && man.scope === '.'
      && man.icons.every(i => i.src.startsWith('./'))
      && (man.shortcuts || []).every(c => c.url.startsWith('./')),
    man.start_url + ' · ' + man.scope);
  ok('الهوية ثابتة عند «./» فلا يصير التطبيق تطبيقًا آخر', man.id === './', man.id);

  /* ── الاختصارات: هذا هو معنى «PWA للّوحات» ── */
  const cuts = man.shortcuts || [];
  ok('المانيفست يحمل اختصارات للّوحات', cuts.length >= 3, cuts.length + ' اختصارًا');
  ok('كل اختصار يفتح عنوانًا داخل التطبيق لا الصفحة العامة',
    cuts.length > 0 && cuts.every(c => /#\//.test(c.url)),
    cuts.map(c => c.url).join(' · '));
  ok('ولوحة الإدارة ولوحة التشغيل والمطابقة من بينها',
    ['#/ops/adash', '#/ops/dash', '#/ops/recon'].every(u => cuts.some(c => c.url.endsWith(u))),
    cuts.map(c => c.url).join(' · '));
  ok('لكل اختصار اسم وأيقونة', cuts.every(c => c.name && (c.icons || []).length));
  ok('بداية التشغيل عنوان توجيه لا مسار خام', /#\//.test(man.start_url), man.start_url);
  for (const i of man.icons) {
    const r = await p.request.get(BASE + i.src.replace('./', ''));
    ok('الأيقونة موجودة: ' + i.src, r.status() === 200 && /image\/png/.test(r.headers()['content-type'] || ''));
  }

  console.log('\n══ التسجيل والسيطرة ══');
  await p.goto(BASE, { waitUntil: 'load' });
  const reg = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, active: !!r.active };
  });
  ok('عامل الخدمة نشط', reg.active, reg.scope);
  ok('نطاقه هو جذر الموقع', reg.scope.endsWith('/'), reg.scope);

  /* السيطرة تبدأ بعد أول تحميل؛ إعادة التحميل تجعل الصفحة تحت سيطرته */
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(700);
  ok('الصفحة تحت سيطرة العامل',
    await p.evaluate(() => !!navigator.serviceWorker.controller));
  const label = await p.$$eval('.savebar span:last-child', n => n.map(x => x.textContent.trim()))
    .catch(() => []);
  console.log('    شريط الحالة: ' + (label.join(' · ') || '(الموقع العام لم يُسجَّل دخوله بعد)'));

  console.log('\n══ دون اتصال ══');
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(600);
  ok('الصفحة العامة تُفتح والشبكة مقطوعة', !!(await p.$('.hero h1')));
  const title = await p.$eval('#pagetitle', e => e.textContent.trim()).catch(() => '');
  ok('العنوان مقروء', title.length > 5, title);

  /* والتطبيق نفسه — لا الصفحة العامة وحدها */
  await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
  await p.fill('#lem', 'admin@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]');
  const inn = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  ok('يسجّل الدخول والشبكة مقطوعة', inn);
  if (inn) {
    await p.click('[data-view="ops.adash"]');
    await p.waitForSelector('.band__t', { timeout: 5000 });
    const bands = await p.$$eval('.band__t', n => n.length);
    ok('لوحة الإدارة تُبنى كاملة دون اتصال', bands === 5, bands + ' أشرطة');
    /* والاختصار نفسه: عنوان اللوحة يُفتح والشبكة مقطوعة، وهو ما يفعله
       الضغط المطوّل على أيقونة التطبيق في شاشة الهاتف. */
    await p.goto(BASE + '#/ops/audit', { waitUntil: 'load' });
    await p.waitForTimeout(700);
    const t2 = await p.$eval('#pagetitle', e => e.textContent.trim()).catch(() => '');
    ok('اختصار إلى لوحة أخرى يفتحها دون اتصال', t2 === 'سجل التدقيق', t2 || '(لم تُفتح)');
    const off = await p.$$eval('.savebar span:last-child', n => n.map(x => x.textContent.trim()));
    ok('شريط الحالة يقول إنه يعمل دون اتصال',
      off.some(t => /يعمل دون اتصال/.test(t)), off.join(' · '));
  }
  await ctx.setOffline(false);

  ok('بلا أخطاء تشغيل', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  srv.kill();
}

console.log(bad ? '\n✗ ' + bad + ' فحصًا فاشلًا\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
