/* شاشة التحليلات — لم يكن لها اختبار خاصّ قبل هذه الدفعة، فكانت أوسع
   شاشة في النظام (ستة أقسام، ثمانية مؤشرات، ستة رسوم) محروسة بـa11y
   و route وحدهما. ما تثبته:

   ١ كل رسم يحمل عنوانًا مكتوبًا ووحدةً مرئية — لا رقمًا بلا وحدة
   ٢ وكل رسم يشحن جدوله، فالقراءة لا تتوقف على تمييز اللون
   ٣ المؤشرات الثمانية تُقرأ من المحدِّدات نفسها التي تقرؤها لوحة التشغيل،
     فالرقم واحد في الشاشتين بالبايسة
   ٤ جدول المستثمرين كامل لا مقتطَع، ويُرتَّب ويُبحث فيه
   ٥ والفرز والبحث يعيشان خارج الـDOM فيبقيان بعد إعادة الرسم
   ٦ ولا لون وحده يحمل معنًى: كل قطعة ملوَّنة لها مفتاح أو صفّ في الجدول  */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';

fs.copyFileSync('/tmp/app.html', 'serve/index.html');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, extra) => {
  if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (extra ? ' — ' + extra : ''));
};

async function open(email, pw, hash) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', email); await p.fill('#lpw', pw);
  await p.click('[data-act="doLogin"]');
  const inn = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  if (inn && hash) {
    await p.evaluate(h => { location.hash = h; }, hash);
    await p.waitForTimeout(500);
  }
  return { ctx, p, errs, inn };
}

/* ══ ١ · كل رسم يقول ما وحدته ══ */
console.log('\n══ ١ · لا رقم بلا وحدة ══');
const A = await open('sysadmin@hissa.om', 'Hissa#2026', '#/ops/pipeline');
ok('الشاشة تفتح بعنوانها', A.inn);
if (A.inn) {
  const title = await A.p.textContent('#pagetitle');
  ok('العنوان «التحليلات»', /التحليلات/.test(title), title);

  const frames = await A.p.$$eval('.frame', fs_ => fs_.map(f => ({
    title: (f.querySelector('h2') || {}).textContent || '',
    unit: (f.querySelector('.frame__unit') || {}).textContent || '',
    rows: f.querySelectorAll('.frame__table tbody tr').length,
    toggle: !!f.querySelector('.frame__toggle'),
  })));
  ok('الشاشة ترسم أطرها', frames.length >= 5, frames.length + ' إطارًا');
  const noUnit = frames.filter(f => !f.unit.trim()).map(f => f.title);
  ok('كل إطار يعلن وحدته مرئيةً', noUnit.length === 0, noUnit.join(' | ') || 'كلّها');
  const noTitle = frames.filter(f => !f.title.trim());
  ok('وكل إطار يحمل عنوانًا مكتوبًا', noTitle.length === 0, String(noTitle.length));

  /* ══ ٢ · الرسم يشحن جدوله ══ */
  console.log('\n══ ٢ · الرسم يشحن جدوله ══');
  const noTable = frames.filter(f => f.rows === 0).map(f => f.title);
  ok('لا إطار بلا صفوف في جدوله', noTable.length === 0, noTable.join(' | ') || 'كلّها تحمل صفوفًا');
  ok('ولكل إطار زرّ «عرض كجدول»', frames.every(f => f.toggle));

  /* ══ ٣ · الرقم واحد في الشاشتين ══ */
  console.log('\n══ ٣ · الرقم نفسه على اللوحتين ══');
  const pipeVals = await A.p.$$eval('.kpis .kv', ks => ks.map(k => ({
    k: (k.querySelector('.kv__k') || {}).textContent || '',
    v: (k.querySelector('.kv__v') || {}).textContent || '',
  })));
  ok('شريط المؤشرات مرسوم', pipeVals.length >= 8, pipeVals.length + ' مؤشرًا');
  await A.p.evaluate(() => { location.hash = '#/ops/dash'; });
  await A.p.waitForTimeout(500);
  const dashVals = await A.p.$$eval('.kpis .kv', ks => ks.map(k => ({
    k: (k.querySelector('.kv__k') || {}).textContent || '',
    v: (k.querySelector('.kv__v') || {}).textContent || '',
  })));
  ok('ولوحة التشغيل ترسم شريطها', dashVals.length >= 6, dashVals.length + ' مؤشرًا');
  /* الاثنان المشتركان يجب أن يتطابقا حرفًا بحرف: مصدرهما محدِّد واحد */
  const shared = ['محتجز لصالح المستثمرين', 'صُرف للمورّدين', 'فرص مفتوحة', 'فرص دون حدّها الأدنى'];
  const diffs = shared.map(label => {
    const a = (pipeVals.find(x => x.k === label) || {}).v;
    const d = (dashVals.find(x => x.k === label) || {}).v;
    return a === d ? null : label + ': ' + a + ' مقابل ' + d;
  }).filter(Boolean);
  ok('الأربعة المشتركة متطابقة على الشاشتين', diffs.length === 0, diffs.join(' | ') || 'متطابقة');

  ok('بلا أخطاء تشغيل', A.errs.length === 0, A.errs.join(' | '));
}
await A.ctx.close();

/* ══ ٤ · جدول المستثمرين كامل ويُرتَّب ══ */
console.log('\n══ ٤ · القائمة كاملة، ويمكن ترتيبها ══');
const B = await open('sysadmin@hissa.om', 'Hissa#2026', '#/ops/pipeline');
if (B.inn) {
  /* الجدول مُعنون بـdata-table، فالاختبار يخاطبه بعينه: الشاشة تحمل ستة
     جداول أخرى، وأول <table> في المستند ليس هذا. */
  const T = '[data-table="topinv"] ';
  const nRows = await B.p.$$eval(T + 'tbody tr', rs => rs.length);
  /* الرقم المرجعيّ من الشاشة نفسها لا من حسابٍ ثانٍ: بجانب الجدول تُطبع
     «العدد الكلي للمستثمرين النشطين»، وهي الرقم الذي كان الجدول المقطوع عند
     ثمانية يناقضه متى تجاوز العدد ثمانية. أن يتطابقا هو المطلوب بعينه. */
  const stated = await B.p.evaluate(() => {
    const m = document.body.textContent.match(/العدد الكلي للمستثمرين النشطين:\s*(\d+)/);
    return m ? Number(m[1]) : -1;
  });
  ok('الجدول يعرض كل المستثمرين بلا قطع', nRows === stated && nRows > 0,
    nRows + ' صفًّا مقابل ' + stated + ' معلَنًا');
  const ranked = stated;

  const heads = await B.p.$$eval(T + '.th-sort', hs => hs.map(h => h.textContent.replace(/[▲▼↕]/g, '').trim()));
  ok('رؤوسه أزرار فرز حقيقية', heads.length >= 3, heads.join(' · '));

  /* العمود كلّه، لا صفّه الأول: البذرة تضع «أمل المحروقية» أكبرَ ملتزم
     وأوّلَ الأسماء ترتيبًا معًا، فالصفّ الأول لا يتحرّك وإن رُتِّب الجدول
     كلّه ترتيبًا صحيحًا. أن يتحرّك ليس هو المطلوب — المطلوب أن يترتّب. */
  const before = await B.p.$$eval(T + 'tbody tr td:first-child', td => td.map(x => x.textContent));
  await B.p.click(T + '.th-sort[data-key="name"]');
  await B.p.waitForTimeout(400);
  const after = await B.p.$$eval(T + 'tbody tr td:first-child', td => td.map(x => x.textContent));
  const collated = after.every((v, i) => i === 0 || after[i - 1].localeCompare(v, 'ar') <= 0);
  ok('الفرز بالاسم يرتّب العمود عربيًّا', collated && after.length > 2, after.slice(0, 3).join(' ≤ '));
  ok('ولا يفقد صفًّا في الطريق', after.length === before.length, after.length + ' / ' + before.length);
  const sorted = await B.p.$eval(T + 'th[aria-sort]', th => th.getAttribute('aria-sort'));
  ok('والعمود يعلن ترتيبه بـaria-sort', sorted === 'ascending' || sorted === 'descending', sorted);

  /* ══ ٥ · البحث في العنوان، وهو نفسه إعادة رسمٍ كاملة ══
     كل ضغطة مفتاح تكتب في العنوان فتُعيد بناء المستند كلّه. فالبحث والفرز
     يُختبران معًا هنا: أن يبقى الترتيب معلَنًا بعد ذلك هو الدليل على أن حالته
     تعيش خارج الـDOM الذي مُحي للتوّ. */
  await B.p.fill('#find-topinv', 'أمل');
  await B.p.waitForTimeout(500);
  const hash = await B.p.evaluate(() => location.hash);
  ok('البحث يُكتب في العنوان', /q=/.test(hash), hash);
  const shown = await B.p.$$eval(T + 'tbody tr', rs => rs.length);
  ok('والقائمة تُرشَّح فعلًا', shown > 0 && shown < nRows, shown + ' من ' + nRows);
  const focused = await B.p.evaluate(() => (document.activeElement || {}).id);
  ok('والتركيز يبقى في حقل البحث', focused === 'find-topinv', focused);
  const survived = await B.p.$eval(T + 'th[aria-sort]',
    th => th.getAttribute('aria-sort')).catch(() => null);
  ok('والفرز باقٍ بعد إعادة رسم المستند كاملًا', survived === sorted, String(survived));

  /* ══ ٦ · وباقٍ حتى بعد مغادرة الشاشة والعودة إليها ══ */
  await B.p.evaluate(() => { location.hash = '#/ops/dash'; });
  await B.p.waitForTimeout(400);
  await B.p.evaluate(() => { location.hash = '#/ops/pipeline'; });
  await B.p.waitForTimeout(500);
  const back = await B.p.$eval(T + 'th[aria-sort]',
    th => th.getAttribute('aria-sort')).catch(() => null);
  ok('ويعود الترتيب مع الشاشة', back === sorted, String(back));
  const cleared = await B.p.$eval('#find-topinv', el => el.value).catch(() => null);
  ok('أمّا البحث فيسقط مع مغادرة الشاشة — فهو سؤال عن هذه الشاشة وحدها',
    cleared === '', JSON.stringify(cleared));

  ok('بلا أخطاء تشغيل', B.errs.length === 0, B.errs.join(' | '));
}
await B.ctx.close();

/* ══ ٧ · لا معنى محمولًا باللون وحده ══ */
console.log('\n══ ٧ · اللون لا يحمل معنًى وحده ══');
const C = await open('sysadmin@hissa.om', 'Hissa#2026', '#/ops/pipeline');
if (C.inn) {
  const bars = await C.p.$$eval('.frame', fs_ => fs_.map(f => ({
    title: (f.querySelector('h2') || {}).textContent || '',
    segs: f.querySelectorAll('.pw__seg').length,
    keys: f.querySelectorAll('.legend__item').length,
    rows: f.querySelectorAll('.frame__table tbody tr').length,
  })).filter(x => x.segs > 1));
  const mute = bars.filter(x => !x.keys && !x.rows).map(x => x.title);
  ok('كل شريط مركَّب له مفتاح أو جدول', mute.length === 0, mute.join(' | ') || bars.length + ' شريطًا');
  ok('بلا أخطاء تشغيل', C.errs.length === 0, C.errs.join(' | '));
}
await C.ctx.close();

await b.close();
console.log(bad ? '\n✗ ' + bad + ' فحصًا فاشلًا\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
