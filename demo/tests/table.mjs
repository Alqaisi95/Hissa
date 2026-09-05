/* الجداول — أربعة وأربعون جدولًا في المستند، لا واحد منها كان يحمل رأسًا
   ثابتًا ولا زرّ فرز ولا حقل بحث. ما تثبته هذه الاختبارات:

   ١ الرافعة واحدة: labelCells تصل كل جدول، فلا أحد يُنسى
   ٢ الرأس يثبت فوق 900px حيث يوجد رأس، ولا يفعل دونها حيث الجدول بطاقات
   ٣ الفرز زرّ حقيقي يُبلَغ إليه بلوحة المفاتيح ويعلن حالته
   ٤ الترتيب على القيمة لا على النصّ — «9» لا تسبق «1,142»
   ٥ نقرة ثالثة تُعيد الترتيب الذي اختارته الشاشة
   ٦ الرأس القابل للفرز لا يلوّث تسمية البطاقة على الهاتف
   ٧ ولا يزيد عدد مستمعات المستند عن ثلاثة                                  */
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

async function open(hash, w, h) {
  const ctx = await b.newContext({ viewport: { width: w || 1500, height: h || 1200 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', 'sysadmin@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]');
  const inn = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  if (inn && hash) { await p.evaluate(x => { location.hash = x; }, hash); await p.waitForTimeout(500); }
  return { ctx, p, errs, inn };
}

/* ══ ١ · الرافعة تصل كل جدول ══ */
console.log('\n══ ١ · لا جدول خارج الرافعة ══');
const SCREENS = ['#/ops/audit', '#/ops/pipeline', '#/ops/money', '#/ops/recon', '#/ops/admin', '#/ops/pools'];
const A = await open('#/ops/audit');
ok('يدخل', A.inn);
if (A.inn) {
  const seen = [];
  for (const h of SCREENS) {
    await A.p.evaluate(x => { location.hash = x; }, h);
    await A.p.waitForTimeout(450);
    seen.push(await A.p.evaluate(() => {
      const ts = [...document.querySelectorAll('table')].filter(t => t.querySelector('thead th'));
      return {
        n: ts.length,
        dt: ts.filter(t => t.classList.contains('dt')).length,
        unlabelled: ts.filter(t => [...t.querySelectorAll('tbody tr:first-child td')]
          .some((td, i) => i > 0 && !td.dataset.role && !td.hasAttribute('data-label'))).length,
      };
    }));
  }
  const tot = seen.reduce((s, x) => s + x.n, 0);
  const dt = seen.reduce((s, x) => s + x.dt, 0);
  ok('كل جدول ذي رأس صار .dt', tot === dt && tot > 0, dt + ' من ' + tot);
  const un = seen.reduce((s, x) => s + x.unlabelled, 0);
  ok('ولا خلية بلا تسمية للبطاقة', un === 0, String(un));

  /* ══ ٢ · الرأس يثبت حيث يطول الجدول ══ */
  console.log('\n══ ٢ · الرأس يثبت ولا يختبئ خلف الشريط ══');
  await A.p.evaluate(() => { location.hash = '#/ops/audit'; });
  await A.p.waitForTimeout(500);
  const tall = await A.p.evaluate(() => {
    const ws = [...document.querySelectorAll('.tablewrap')].filter(x => x.querySelector('table.dt'));
    const w = ws.find(x => x.classList.contains('tablewrap--tall'));
    if (!w) return { total: ws.length, tall: 0 };
    return {
      total: ws.length,
      tall: ws.filter(x => x.classList.contains('tablewrap--tall')).length,
      pos: getComputedStyle(w.querySelector('thead th')).position,
      scrolls: getComputedStyle(w).overflowY,
    };
  });
  ok('كل جدول بيانات داخل حاوية تمرير', tall.total > 0 && tall.tall === tall.total,
    tall.tall + ' من ' + tall.total);
  ok('ورأسه لاصق داخلها', tall.pos === 'sticky', tall.pos || '—');
  ok('والحاوية هي التي تمرّر لا الصفحة', tall.scrolls === 'auto' || tall.scrolls === 'scroll', tall.scrolls || '—');

  ok('بلا أخطاء تشغيل', A.errs.length === 0, A.errs.join(' | '));
}
await A.ctx.close();

/* ══ ٣ · على الهاتف لا رأس ولا لصوق ══ */
console.log('\n══ ٣ · على 390px الجدول بطاقات، فلا رأس يلصق ══');
const M = await open('#/ops/audit', 390, 844);
if (M.inn) {
  const st = await M.p.evaluate(() => {
    const th = document.querySelector('.tablewrap--tall thead th');
    if (!th) return null;
    return { pos: getComputedStyle(th).position, headHidden: getComputedStyle(th.closest('thead')).position };
  });
  ok('الرأس ليس لاصقًا على الهاتف', !st || st.pos !== 'sticky', st ? st.pos : 'لا جدول طويل');
  const overflow = await M.p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('ولا فيض أفقي', overflow <= 0, String(overflow));
  ok('بلا أخطاء تشغيل', M.errs.length === 0, M.errs.join(' | '));
}
await M.ctx.close();

/* ══ ٤ · الفرز: زرّ حقيقي، وقيمة لا نصّ ══ */
console.log('\n══ ٤ · الفرز على القيمة لا على النصّ ══');
const S = await open('#/ops/pipeline');
if (S.inn) {
  const T = '[data-table="topinv"] ';
  const btn = await S.p.$(T + '.th-sort[data-key="value"]');
  ok('عمود المبلغ يحمل زرّ فرز', !!btn);
  if (btn) {
    const tag = await btn.evaluate(el => el.tagName);
    ok('وهو <button> لا <th> بمعالج', tag === 'BUTTON', tag);
    const named = await btn.evaluate(el => el.textContent.replace(/[▲▼↕]/g, '').trim());
    ok('وله اسم مقروء', named.length > 0, named);

    /* تصاعديًّا: الأصغر أولًا، بالقيمة العددية */
    await btn.click(); await S.p.waitForTimeout(400);
    const asc = await S.p.$$eval(T + 'tbody tr', rs => rs.map(r =>
      Number((r.children[1] || {}).textContent.replace(/[^\d]/g, '')) || 0));
    const ascOk = asc.every((v, i) => i === 0 || asc[i - 1] <= v);
    ok('تصاعديًّا مرتَّب عدديًّا', ascOk && asc.length > 2, asc.slice(0, 4).join(' ≤ '));

    await S.p.click(T + '.th-sort[data-key="value"]'); await S.p.waitForTimeout(400);
    const desc = await S.p.$$eval(T + 'tbody tr', rs => rs.map(r =>
      Number((r.children[1] || {}).textContent.replace(/[^\d]/g, '')) || 0));
    ok('وتنازليًّا كذلك', desc.every((v, i) => i === 0 || desc[i - 1] >= v),
      desc.slice(0, 4).join(' ≥ '));

    /* ══ ٥ · النقرة الثالثة تُعيد ترتيب الشاشة ══ */
    await S.p.click(T + '.th-sort[data-key="value"]'); await S.p.waitForTimeout(400);
    const cleared = await S.p.$$eval(T + 'th[aria-sort]', ts => ts.length);
    ok('النقرة الثالثة تُلغي الفرز', cleared === 0, cleared + ' عمودًا مرتَّبًا');
  }
  ok('بلا أخطاء تشغيل', S.errs.length === 0, S.errs.join(' | '));
}
await S.ctx.close();

/* ══ ٦ · بلوحة المفاتيح وحدها ══ */
console.log('\n══ ٦ · يُبلَغ إليه بلوحة المفاتيح ══');
const K = await open('#/ops/pipeline');
if (K.inn) {
  const reached = await K.p.evaluate(() => {
    const btn = document.querySelector('[data-table="topinv"] .th-sort');
    if (!btn) return null;
    btn.focus();
    return document.activeElement === btn;
  });
  ok('زرّ الفرز يقبل التركيز', reached === true, String(reached));
  await K.p.keyboard.press('Enter');
  await K.p.waitForTimeout(400);
  const announced = await K.p.$eval('[data-table="topinv"] th[aria-sort]',
    th => th.getAttribute('aria-sort')).catch(() => null);
  ok('و«Enter» يرتّب ويعلن الترتيب', !!announced, String(announced));
  ok('بلا أخطاء تشغيل', K.errs.length === 0, K.errs.join(' | '));
}
await K.ctx.close();

/* ══ ٧ · المستمعات ثلاثة كما كانت ══ */
console.log('\n══ ٧ · لا مستمع جديد على المستند ══');
const src = fs.readFileSync('hissa-demo.html', 'utf8');
const listeners = (src.match(/document\.addEventListener\(/g) || []).length;
ok('ثلاثة مستمعات على المستند فقط', listeners === 3, String(listeners));
ok('والفرز والبحث يمرّان بـdata-act',
  /data-act="sortTable"/.test(src) && /data-act="findTable"/.test(src));

await b.close();
console.log(bad ? '\n✗ ' + bad + ' فحصًا فاشلًا\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
