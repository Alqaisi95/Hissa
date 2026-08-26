/* المطابقة البنكية — ما تثبته هذه الاختبارات:
   ١ كشف متّزن يُطابَق بالكامل ⇒ صفر فروق ⇒ إعداد ⇒ المُعِدّ نفسه يُرفض توقيعه ⇒ ثانٍ يوقّع
   ٢ سطر ناقص من الكشف ⇒ فرق يظهر ⇒ لا إعداد قبل تفسيره
   ٣ أسطر مشوّهة ⇒ تُرفض بأسبابها ظاهرةً ولا تُسقَط صامتة
   ٤ كشف لا يتّزن داخليًّا ⇒ يُرفض إعداده صراحةً
   ٥ صرف زائد على المخصَّص ⇒ يظهر حرِجًا (الخلل الذي كان القصّ يبتلعه)
   ٦ funds.read بلا funds.reconcile ⇒ يقرأ ولا يفعل، والمحرّك يرفض زرًّا مزروعًا     */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';

const body = fs.readFileSync('hissa-demo.html', 'utf8');
const wrapper = fs.readFileSync('/tmp/app.html', 'utf8');
const RE = /<script id="appstate" type="application\/json">[\s\S]*?<\/script>/;
const base = JSON.parse(body.match(/<script id="appstate" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const write = (file, st) => fs.writeFileSync('serve/' + file, wrapper.replace(RE,
  '<script id="appstate" type="application/json">'
  + JSON.stringify(st).replace(/</g, '\\u003c') + '</' + 'script>'));

fs.copyFileSync('/tmp/app.html', 'serve/index.html');

/* ── حالة الصرف الزائد ──────────────────────────────────────────────────
   فرصة أُغلقت بين حدّها الأدنى وهدفها، فمجموع مراحلها أكبر من مخصَّصها،
   ثم صُرفت كل مراحلها. هذا ما كان `Math.min` يُخفيه. */
const over = JSON.parse(JSON.stringify(base));
{
  const p = over.pools.find(x => x.id === 'p_log');
  p.milestones.forEach(m => { m.state = 'executed'; });
  over.disbursements = p.milestones.map((m, i) => ({
    id: 'DSB-2026-90' + i, poolId: p.id, milestoneId: m.id, amount: m.amount,
    status: 'executed', requestedBy: 'u_fin1', requestedAt: '2026-06-01T08:00:00Z',
    approvedBy: 'u_fin2', approvedAt: '2026-06-01T11:00:00Z', evidence: 'اختبار الصرف الزائد',
  }));
  /* المخصَّص أقلّ من مجموع المراحل: يُخفَّض التزام واحد */
  over.orders.filter(o => o.poolId === p.id).forEach(o => { o.allocated = Math.floor(o.amount / 3); });
}
write('over.html', over);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, extra) => { if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (extra ? ' — ' + extra : '')); };

async function open(file, email, pw) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', email); await p.fill('#lpw', pw);
  await p.click('[data-act="doLogin"]');
  const inn = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  if (inn) {
    await p.evaluate(() => {
      const n = [...document.querySelectorAll('.navlink')].find(x => /المطابقة البنكية/.test(x.textContent));
      if (n) n.click();
    });
    await p.waitForTimeout(500);
  }
  return { ctx, p, errs, inn };
}
const err = p => p.$eval('#rcErr', e => e.textContent.trim()).catch(() => '');
const toasts = p => p.$$eval('.toastwrap .toast', t => t.map(x => x.textContent.trim()));
/* يُعرض السطر المطابِق لا الأخير: عرض آخر ما ظهر يجعل الفشل غير قابل للتشخيص */
const hit = (list, re) => list.find(t => re.test(t)) || '(لم يظهر) آخر ما ظهر: ' + (list.slice(-1)[0] || '—');

/* الحركات التي يتوقّعها السجل — تُبنى من الحالة نفسها لا بيدي */
function statementFor(st, { drop = 0, extra = '', breakBalance = false } = {}) {
  const rows = [];
  st.orders.forEach(o => {
    if (['pending', 'confirmed', 'allocated'].includes(o.status))
      rows.push([o.createdAt.slice(0, 10), o.id, 'Investor commitment ' + o.id, o.amount, 0]);
    else if (o.status === 'refunded') {
      rows.push([o.createdAt.slice(0, 10), o.id, 'Investor commitment ' + o.id, o.amount, 0]);
      rows.push([o.createdAt.slice(0, 10), o.id, 'Refund ' + o.id, 0, o.amount]);
    }
  });
  st.disbursements.filter(d => d.status === 'executed').forEach(d =>
    rows.push([(d.approvedAt || '2026-06-01').slice(0, 10), d.id, 'Supplier payment ' + d.id, 0, d.amount]));
  st.distributions.forEach(d =>
    rows.push([(d.paidAt || '2026-07-05').slice(0, 10), d.id, 'Distribution ' + d.id, 0, d.gross]));

  const kept = drop ? rows.slice(0, rows.length - drop) : rows;
  const money = v => (v ? (Math.floor(v / 1000) + '.' + String(v % 1000).padStart(3, '0')) : '');
  const net = kept.reduce((s, r) => s + r[3] - r[4], 0);
  const text = ['date,ref,description,credit,debit']
    .concat(kept.map(r => [r[0], r[1], r[2], money(r[3]), money(r[4])].join(',')))
    .concat(extra ? [extra] : []).join('\n');
  /* الإقفال = صفر افتتاحي + صافي ما في الكشف، إلا حين نكسره عمدًا */
  return { text, closing: money(net + (breakBalance ? 5000 : 0)) || '0.000' };
}

/* ══ ١ · كشف متّزن، مطابقة كاملة، ورقابة ثنائية ══ */
console.log('\n══ كشف متّزن ══');
const A = await open('index.html', 'maryam@hissa.om', 'Hissa#2026');
ok('مريم (عمليات مالية) تصل شاشة المطابقة', A.inn && !!(await A.p.$('#rcPaste')));
if (A.inn) {
  const s = statementFor(base);
  await A.p.fill('#rcOpen', '0.000');
  await A.p.fill('#rcClose', s.closing);
  await A.p.fill('#rcPaste', s.text);
  await A.p.click('[data-act="openRecon"]');
  await A.p.waitForTimeout(900);
  ok('لا خطأ عند القراءة', !(await err(A.p)), await err(A.p));

  const kv = await A.p.$$eval('.kv', n => n.map(x => x.textContent.trim()));
  const readRow = k => (kv.find(t => t.startsWith(k)) || '').replace(k, '').trim();
  console.log('    ' + kv.filter(t => /أسطر|مطابَقة|فروق|تفسير/.test(t)).join(' · '));
  ok('كل سطر طُوبق بمرجعه — صفر فروق',
    readRow('فروق') === '0', 'فروق: ' + readRow('فروق'));
  ok('الكشف متّزن داخليًّا',
    !!(await A.p.$$eval('.note--pos', n => n.some(x => /متّزن داخليًّا/.test(x.textContent)))));

  await A.p.click('[data-act="prepareRecon"]');
  await A.p.waitForTimeout(800);
  ok('أُعدّت للتوقيع', (await toasts(A.p)).some(t => /لن تستطيع توقيعها بنفسك/.test(t)));
  ok('ولا يُعرض لها زر توقيع أمام مُعِدّها', !(await A.p.$('[data-act="signRecon"]')));

  /* والمحرّك يرفض حتى لو زُرع الزر */
  const forced = await A.p.evaluate(() => {
    const id = (document.body.textContent.match(/REC-\d{4}-\d{4}/) || [])[0];
    if (!id) return '(لم يُعثر على مرجع المطابقة)';
    const btn = document.createElement('button');
    btn.dataset.act = 'signRecon'; btn.dataset.rec = id;
    document.body.appendChild(btn); btn.click();
    return new Promise(r => setTimeout(() => r(
      [...document.querySelectorAll('#alerts .toast')].map(t => t.textContent).join(' | ')), 900));
  });
  ok('المحرّك يرفض توقيع المُعِدّ لنفسه', /أعددتَ هذه المطابقة بنفسك/.test(forced), forced || '(صامت)');

  /* ══ الطرف الثاني ══
     في نفس الصفحة، لا في سياق آخر: لا كاتب في هذا المشغّل، فالحالة تعيش في
     ذاكرة الصفحة وحدها. والرقابة الثنائية شأن أشخاص لا تبويبات — فتبديل
     الحساب هنا يختبر القاعدة نفسها بلا تعقيد. */
  console.log('\n══ الطرف الثاني — نفس الصفحة، حساب آخر ══');
  await A.p.click('[data-act="logout"]'); await A.p.waitForTimeout(300);
  await A.p.click('[data-pub="login"]'); await A.p.waitForTimeout(200);
  await A.p.fill('#lem', 'khalid@hissa.om'); await A.p.fill('#lpw', 'Hissa#2026');
  await A.p.click('[data-act="doLogin"]');
  await A.p.waitForSelector('.topbar', { timeout: 9000 });
  await A.p.evaluate(() => {
    const n = [...document.querySelectorAll('.navlink')].find(x => /المطابقة البنكية/.test(x.textContent));
    if (n) n.click();
  });
  await A.p.waitForTimeout(600);

  ok('خالد يرى المطابقة التي أعدّتها مريم',
    (await A.p.$$eval('h2', h => h.map(x => x.textContent))).some(t => /REC-/.test(t)));
  const canSign = !!(await A.p.$('[data-act="signRecon"]'));
  ok('ويُعرض له زر التوقيع — وهو ليس المُعِدّ', canSign);
  if (canSign) {
    await A.p.click('[data-act="signRecon"]');
    await A.p.waitForTimeout(900);
    ok('وُقّعت', (await toasts(A.p)).some(t => /وُقّعت المطابقة/.test(t)),
      (await toasts(A.p)).slice(-1)[0] || '');
    const signed = await A.p.$$eval('table tbody tr', r => r.map(x => x.textContent));
    ok('وتظهر في سجل المطابقات الموقَّعة',
      signed.some(t => /REC-/.test(t) && /مريم/.test(t) && /خالد/.test(t)),
      (signed.find(t => /REC-/.test(t)) || '').replace(/\s+/g, ' ').slice(0, 70));
  }
  ok('بلا أخطاء تشغيل', A.errs.length === 0, A.errs.join(' | '));
}
await A.ctx.close();

/* ══ ٢+٣ · سطر ناقص وأسطر مشوّهة ══ */
console.log('\n══ سطر ناقص وأسطر مشوّهة ══');
const C = await open('index.html', 'maryam@hissa.om', 'Hissa#2026');
if (C.inn) {
  const s = statementFor(base, { drop: 1, extra: 'ليس تاريخًا,X,Y,1.000,\n2026-08-01,Z,bad amount,س ص ع,' });
  await C.p.fill('#rcOpen', '0.000');
  await C.p.fill('#rcClose', s.closing);
  await C.p.fill('#rcPaste', s.text);
  await C.p.click('[data-act="openRecon"]');
  await C.p.waitForTimeout(900);

  const rejected = await C.p.$$eval('.note--crit table tbody tr',
    r => r.map(x => x.textContent.trim())).catch(() => []);
  ok('الأسطر المشوّهة معروضة بأسبابها لا مُسقَطة', rejected.length === 2, rejected.length + ' سطرًا');
  ok('ويُسمّى سبب كل واحد',
    rejected.some(t => /ليس تاريخًا/.test(t)) && rejected.some(t => /مبلغ غير صالح/.test(t)));

  const breaks = await C.p.$$eval('.panel .chip--brand, .panel .chip--sand',
    n => n.map(x => x.textContent.trim()));
  ok('السطر الناقص صار فرقًا من جهة السجل',
    breaks.some(t => /عندنا لا في الكشف/.test(t)), breaks.join(' · '));

  await C.p.click('[data-act="prepareRecon"]');
  await C.p.waitForTimeout(800);
  const t1 = await toasts(C.p);
  ok('لا إعداد قبل تفسير الفرق', /بلا تفسير/.test(hit(t1, /بلا تفسير/)), hit(t1, /بلا تفسير/));

  /* فسّره ثم أعِدّها */
  const bid = await C.p.$eval('[data-act="explainBreak"]', e => e.dataset.id);
  await C.p.selectOption('#bk_' + bid, 'in_transit');
  await C.p.fill('#bn_' + bid, 'حوالة صدرت في آخر يوم ولم تظهر في كشف الفترة');
  await C.p.click('[data-act="explainBreak"]');
  await C.p.waitForTimeout(800);
  await C.p.click('[data-act="prepareRecon"]');
  await C.p.waitForTimeout(800);
  ok('وبعد التفسير تُعدّ', (await toasts(C.p)).some(t => /لن تستطيع توقيعها بنفسك/.test(t)));
  ok('بلا أخطاء تشغيل', C.errs.length === 0, C.errs.join(' | '));
}
await C.ctx.close();

/* ══ ٤ · كشف لا يتّزن داخليًّا ══ */
console.log('\n══ كشف لا يتّزن ══');
const D = await open('index.html', 'khalid@hissa.om', 'Hissa#2026');
if (D.inn) {
  const has = await D.p.$('#rcPaste');
  if (!has) { console.log('    (مطابقة سابقة ما زالت مفتوحة — يُتخطّى)'); }
  else {
    const s = statementFor(base, { breakBalance: true });
    await D.p.fill('#rcOpen', '0.000');
    await D.p.fill('#rcClose', s.closing);
    await D.p.fill('#rcPaste', s.text);
    await D.p.click('[data-act="openRecon"]');
    await D.p.waitForTimeout(900);
    ok('يُعلن أن الكشف نفسه لا يتّزن',
      !!(await D.p.$$eval('.note--crit', n => n.some(x => /الكشف نفسه لا يتّزن/.test(x.textContent)))));
    await D.p.click('[data-act="prepareRecon"]');
    await D.p.waitForTimeout(800);
    const t2 = await toasts(D.p);
    ok('ويُرفض إعداده', /لا يتّزن/.test(hit(t2, /لا يتّزن/)), hit(t2, /لا يتّزن/).slice(0, 80));
  }
  ok('بلا أخطاء تشغيل', D.errs.length === 0, D.errs.join(' | '));
}
await D.ctx.close();

/* ══ ٥ · الصرف الزائد ══ */
console.log('\n══ صرف زائد على المخصَّص ══');
const E = await open('over.html', 'maryam@hissa.om', 'Hissa#2026');
if (E.inn) {
  const crit = await E.p.$$eval('.note--crit', n => n.map(x => x.textContent.trim()));
  ok('الشاشة تعلنه صراحةً', crit.some(t => /صرف زائد بلا غطاء/.test(t)),
    (crit.find(t => /صرف زائد/.test(t)) || '(غائب)').slice(0, 90));
  await E.p.evaluate(() => {
    const n = [...document.querySelectorAll('.navlink')].find(x => /لوحة التشغيل/.test(x.textContent));
    if (n) n.click();
  });
  await E.p.waitForTimeout(600);
  const rows = await E.p.$$eval('.exc__row', n => n.map(x => x.textContent));
  ok('ويظهر بندًا في لوحة التشغيل', rows.some(t => /خرجت بلا غطاء/.test(t)),
    rows.filter(t => /صرف زائد/.test(t)).length + ' بندًا');
  ok('بلا أخطاء تشغيل', E.errs.length === 0, E.errs.join(' | '));
}
await E.ctx.close();

/* ══ ٦ · قراءة بلا فعل ══ */
console.log('\n══ المدقق: funds.read بلا funds.reconcile ══');
const F = await open('index.html', 'auditor@hissa.om', 'Hissa#2026');
if (F.inn) {
  ok('يرى الشاشة', !!(await F.p.$('#pagetitle')));
  ok('ولا نموذج لصق أمامه', !(await F.p.$('#rcPaste')));
  const forced = await F.p.evaluate(() => {
    const btn = document.createElement('button');
    btn.dataset.act = 'prepareRecon'; btn.dataset.rec = 'REC-2026-0001';
    document.body.appendChild(btn); btn.click();
    return new Promise(r => setTimeout(() => r(
      [...document.querySelectorAll('#alerts .toast')].map(t => t.textContent).join(' | ')), 900));
  });
  ok('والمحرّك يرفض زرًّا مزروعًا', /لا تملك صلاحية/.test(forced), forced || '(صامت)');
  ok('بلا أخطاء تشغيل', F.errs.length === 0, F.errs.join(' | '));
}
await F.ctx.close();

await b.close();
console.log(bad ? '\n✗ ' + bad + ' فحصًا فاشلًا\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
