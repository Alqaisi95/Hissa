/* المرحلة ٢ — سطح العمل ops.dash. معايير القبول العشرة:
   ١  لا عنصر في ① ترفضه ACTS — بأربع جلسات على طرفَي كل قاعدة
   ٢  حساب بلا صلاحية الفعل لا يرى التبويب إطلاقًا — لا معطَّلًا ولا فارغًا
   ٣  اعتماد عنصر يُبقي موضع التمرير والتبويب النشط
   ٤  الطابور الفارغ يبقى معروضًا بنصّه المكتوب
   ٥  الرابط بعد الفلترة يعيد نفس العرض في نافذة أخرى
   ٦  كسر سطر في السجل ⇒ شارة حمراء برقم السطر الصحيح
   ٧  الرفض بسبب نصّي يصل سجل التدقيق
   ٨  الشاشة تُرسم على قاعدة فارغة تمامًا بلا خطأ وحدة تحكّم
   ٩  صفر مستمعات أحداث جديدة
   ١٠ صفر تنسيق ماليّ في METRICS، وصفر حساب ماليّ في طبقة الرسم            */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';

const body = fs.readFileSync('hissa-demo.html', 'utf8');
const APP = fs.readFileSync('/tmp/app.html', 'utf8');
fs.copyFileSync('/tmp/app.html', 'serve/index.html');

const STATE_RE = /<script id="appstate" type="application\/json">([\s\S]*?)<\/script>/;
const seed = JSON.parse(body.match(STATE_RE)[1]);
const write = (file, st) => fs.writeFileSync('serve/' + file, APP.replace(STATE_RE,
  '<script id="appstate" type="application/json">'
  + JSON.stringify(st).replace(/</g, '\\u003c') + '</' + 'script>'));
const clone = o => JSON.parse(JSON.stringify(o));

/* ── نسخة فيها ما ينتظر طرفًا ثانيًا على القواعد الثلاث ── */
const work = clone(seed);
work.disbursements.push({ id: 'DSB-T-1', poolId: 'p_log', milestoneId: 'm3', amount: 500000,
  status: 'requested', requestedBy: 'u_fin2', requestedAt: '2026-08-18T08:00:00Z',
  approvedBy: null, approvedAt: null, evidence: 'محضر اختبار للطرف الثاني' });
work.settingProposals.push({ id: 'SET-T-1', key: 'minTicket', before: 100000, value: 200000,
  reason: 'اقتراح اختباري', effectiveFrom: '2026-09-01', status: 'pending',
  proposedBy: 'u_adm1', proposedAt: '2026-08-19T08:00:00Z', decidedBy: null, decidedAt: null });
write('work.html', work);

/* ── نسخة بسلسلة تدقيق مكسورة عمدًا في السطر الثالث ── */
const broken = clone(seed);
broken.audit[2].detail = 'نصّ عُدِّل بعد كتابته';
write('broken.html', broken);

/* ── قاعدة فارغة تمامًا، وفيها حساب واحد يفتح كل شيء ── */
const empty = { v: 1, version: 0, schema: 6, settings: clone(seed.settings),
  users: [clone(seed.users.find(u => u.id === 'u_adm2'))],
  pools: [], orders: [], disbursements: [], distributions: [], reports: [], cases: [],
  audit: [], applications: [], invites: [], settingProposals: [], settingsHistory: [],
  resets: [], reconciliations: [] };
write('empty.html', empty);

/* ── طلب وافقت عليه اللجنة ولم ينشره أحد ──────────────────────────────
   الحالة التي لم تكن تظهر في أي مكان: زرّ النشر معروض على ops.apps، ولا
   طابور ولا قائمة مهل تسمّيه. */
const approved = clone(seed);
{
  const a = approved.applications[0];
  a.status = 'approved';
  a.decidedAt = '2026-08-18T09:00:00Z';
}
write('approved.html', approved);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, extra) => { if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (extra ? ' — ' + extra : '')); };
const head = t => console.log('\n══ ' + t + ' ══');

async function open(file, email, hash) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(350);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', email); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]'); await p.waitForTimeout(1400);
  await p.goto('http://127.0.0.1:8731/' + file + (hash || '#/ops/dash'), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { ctx, p, errs };
}
const queueIds = p => p.$$eval('.qcard--crit .qrow', rs => rs.map(r => r.id.replace('rec-', '')));

/* ── ١ · لا عنصر معروض ترفضه ACTS ─────────────────────────────────────── */
head('١ · الطابور ① لا يعرض ما سيُرفض');
{
  const parties = { 'u_fin2': 'DSB-T-1', 'u_adm1': 'SET-T-1' };
  for (const [uid, id] of Object.entries(parties)) {
    const email = { u_fin2: 'khalid@hissa.om', u_adm1: 'admin@hissa.om' }[uid];
    const { ctx, p } = await open('work.html', email);
    const ids = await queueIds(p);
    ok('الطرف نفسه (' + email + ') لا يرى ' + id, !ids.includes(id), ids.join('،') || 'فارغ');
    await ctx.close();
  }
  const { ctx, p } = await open('work.html', 'maryam@hissa.om');   // u_fin1: طرف ثانٍ للصرف
  const ids = await queueIds(p);
  ok('والطرف الثاني يرى طلب الصرف', ids.includes('DSB-T-1'), ids.join('،') || 'فارغ');

  /* والاختبار الحقيقي: الضغط ينجح فعلًا ولا يعود بخطأ. */
  await p.click('[data-act="approveDsb"][data-dsb="DSB-T-1"]');
  await p.waitForTimeout(1200);
  /* commit() always warns "this session only" when no writer is attached, which
     every browser test is. That is not a refusal — filter it, not the check. */
  const alerts = (await p.$$eval('#alerts .toast', t => t.map(x => x.textContent)))
    .filter(t => !/هذه الجلسة فقط/.test(t));
  ok('واعتماده يمرّ بلا رفض', alerts.length === 0, alerts.join(' | '));
  const after = await queueIds(p);
  ok('ويختفي من الطابور بعد الاعتماد', !after.includes('DSB-T-1'));
  await ctx.close();
}

/* ── ٢ · تبويب بلا صلاحية لا يُرسم ────────────────────────────────────── */
head('٢ · التبويبات خلف صلاحية الفعل');
{
  const { ctx, p } = await open('work.html', 'maryam@hissa.om');   // مالية: لا kyc ولا مراجعة طلبات
  const tabs = await p.$$eval('.tablink', t => t.map(x => x.textContent.replace(/\d+/g, '').trim()));
  ok('مالية لا ترى تبويب التحقق', !tabs.some(t => t.includes('التحقق')), tabs.join('،') || 'لا تبويبات');
  ok('ولا تراه معطَّلًا', (await p.$$('.tablink[aria-disabled], .tablink:disabled')).length === 0);
  await ctx.close();

  const c2 = await open('work.html', 'compliance@hissa.om');       // الالتزام: kyc.approve + case.work
  const tabs2 = await c2.p.$$eval('.tablink', t => t.map(x => x.textContent.replace(/\d+/g, '').trim()));
  ok('والالتزام يرى تبويب التحقق', tabs2.some(t => t.includes('التحقق')), tabs2.join('،'));
  await c2.ctx.close();
}

/* ── ٣ · الاعتماد يُبقي التمرير والتبويب ──────────────────────────────── */
head('٣ · الموضع يبقى بعد الإجراء');
{
  const { ctx, p } = await open('work.html', 'compliance@hissa.om', '#/ops/dash?tab=kyc');
  const tabBefore = await p.$eval('.tablink[aria-selected="true"]', e => e.dataset.tab);
  await p.evaluate(() => window.scrollTo(0, 320));
  await p.waitForTimeout(150);
  const yBefore = await p.evaluate(() => window.scrollY);
  const btn = await p.$('[data-act="approveKyc"]');
  if (btn) {
    await btn.click(); await p.waitForTimeout(1200);
    const yAfter = await p.evaluate(() => window.scrollY);
    ok('موضع التمرير محفوظ عبر إعادة الرسم', Math.abs(yAfter - yBefore) < 40, `${yBefore} → ${yAfter}`);
  } else ok('موضع التمرير محفوظ عبر إعادة الرسم', false, 'لا زرّ اعتماد في طابور التحقق');
  /* by key, not by label: the label carries the queue's count, and approving
     an item is supposed to change that count. */
  const tabAfter = await p.$eval('.tablink[aria-selected="true"]', e => e.dataset.tab);
  ok('والتبويب النشط كما هو', tabAfter === tabBefore, `${tabBefore} → ${tabAfter}`);
  ok('لأنه في العنوان', (await p.evaluate(() => location.hash)).includes('tab=kyc'));
  await ctx.close();
}

/* ── ٤ · الطابور الفارغ يبقى ──────────────────────────────────────────── */
head('٤ · الفراغ يُعرض ولا يختفي');
{
  const { ctx, p } = await open('work.html', 'huda@hissa.om');     // متابعة محفظة
  const cards = await p.$$eval('.qcard, .card', c => c.length);
  const empties = await p.$$eval('.empty', e => e.map(x => x.textContent.trim()));
  ok('الشاشة ترسم بطاقاتها', cards > 0, String(cards));
  ok('وكل فراغ يحمل نصًّا مكتوبًا لا فراغًا', empties.every(t => t.length > 8), JSON.stringify(empties));
  await ctx.close();
}

/* ── ٥ · الرابط يعيد نفس العرض ────────────────────────────────────────── */
head('٥ · الرابط قابل للمشاركة');
{
  const a = await open('work.html', 'compliance@hissa.om', '#/ops/dash?tab=cases');
  const shotA = await a.p.$eval('.tablink[aria-selected="true"]', e => e.textContent.trim());
  const rowsA = await a.p.$$eval('.qrows .qrow', r => r.length);
  const url = await a.p.evaluate(() => location.hash);
  await a.ctx.close();

  const c = await open('work.html', 'compliance@hissa.om', url);
  const shotB = await c.p.$eval('.tablink[aria-selected="true"]', e => e.textContent.trim());
  const rowsB = await c.p.$$eval('.qrows .qrow', r => r.length);
  ok('نافذة أخرى بنفس الرابط ⇒ نفس التبويب', shotA === shotB, `${shotA} / ${shotB}`);
  ok('ونفس الصفوف', rowsA === rowsB, `${rowsA} / ${rowsB}`);
  await c.ctx.close();
}

/* ── ٦ · السلسلة المكسورة تُعلن نفسها ─────────────────────────────────── */
head('٦ · شارة سلامة السجل');
{
  const good = await open('work.html', 'sysadmin@hissa.om');
  ok('السليمة تُعرض شريط حالة أخضر', (await good.p.$$('.statusbar__dot--ok')).length === 1);
  ok('ولا إنذار', (await good.p.$$('.note--crit')).length === 0);
  await good.ctx.close();

  const bd = await open('broken.html', 'sysadmin@hissa.om');
  const txt = await bd.p.$eval('.note--crit', e => e.textContent).catch(() => '');
  ok('المكسورة تُعلن الكسر', txt.includes('مكسورة'), txt.slice(0, 60));
  ok('وبرقم السطر الصحيح (٣)', /السطر 3\b/.test(txt), txt.slice(0, 90));
  ok('ومعها طريق إلى السجل', (await bd.p.$$('.note--crit a[href*="ops/audit"]')).length === 1);
  await bd.ctx.close();
}

/* ── ٧ · الرفض بسببه يصل التدقيق ──────────────────────────────────────── */
head('٧ · الرفض يُسجَّل بسببه');
{
  const { ctx, p } = await open('work.html', 'maryam@hissa.om');
  await p.click('[data-act="askReject"][data-id="DSB-T-1"]');
  await p.waitForTimeout(300);
  ok('زرّ الرفض يفتح صندوق السبب', (await p.$$('#rejWhy')).length === 1);

  await p.fill('#rejWhy', 'قصير');
  await p.click('[data-act="doReject"][data-id="DSB-T-1"]');
  await p.waitForTimeout(900);
  const refused = await p.$$eval('#alerts .toast', t => t.map(x => x.textContent).join(' '));
  ok('سبب قصير يُرفض', /عشرة أحرف/.test(refused), refused.slice(0, 60));
  ok('والصندوق يبقى مفتوحًا لتصحيحه', (await p.$$('#rejWhy')).length === 1);

  await p.fill('#rejWhy', 'الدليل المرفق لا يثبت استيفاء شرط المرحلة');
  await p.click('[data-act="doReject"][data-id="DSB-T-1"]');
  await p.waitForTimeout(1400);
  ok('واختفى الطلب من الطابور', !(await queueIds(p)).includes('DSB-T-1'));

  await p.goto('http://127.0.0.1:8731/work.html#/ops/audit', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  const log = await p.$eval('#root', e => e.textContent);
  ok('والسبب في سجل التدقيق حرفيًّا', log.includes('الدليل المرفق لا يثبت استيفاء شرط المرحلة'));
  ok('ومعه أن الإجراء رفض صرف', log.includes('رفض صرف'));
  await ctx.close();
}

/* ── ٨ · قاعدة فارغة تمامًا ───────────────────────────────────────────── */
head('٨ · الشاشة على قاعدة فارغة');
{
  const { ctx, p, errs } = await open('empty.html', 'sysadmin@hissa.om');
  const title = await p.$eval('#pagetitle', e => e.textContent.trim()).catch(() => '');
  ok('الشاشة تُرسم', title === 'لوحة التشغيل', title);
  const empties = await p.$$eval('.empty', e => e.map(x => x.textContent.trim()));
  ok('وكل طابور يعرض نصّ فراغه', empties.length >= 3, empties.length + ': ' + JSON.stringify(empties));
  ok('ولا خطأ في وحدة التحكّم', errs.length === 0, errs.slice(0, 2).join(' | '));
  ok('ولا فيض أفقي', await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth === 0));
  await ctx.close();
}

/* ── ٩ · لا مستمعات جديدة ─────────────────────────────────────────────── */
head('٩ · مستمع واحد لكل نوع حدث');
{
  const src = body.match(/<script id="appscript">([\s\S]*?)<\/script>/)[1];
  const doc = (src.match(/document\.addEventListener\(/g) || []).length;
  ok('ثلاثة مستمعات على المستند فقط: click · input · change', doc === 3, String(doc));
  const inViews = (src.slice(src.indexOf("VIEWS['ops.dash']")).match(/addEventListener\(/g) || []).length;
  ok('ولا مستمع داخل ops.dash', inViews === 0 || !src.slice(src.indexOf("VIEWS['ops.dash']"),
     src.indexOf("VIEWS['ops.adash']")).includes('addEventListener'));
  const acts = (src.match(/data-act="/g) || []).length;
  ok('والتصرّف كلّه عبر data-act', acts > 60, String(acts));
}

/* ── ١٠ · فصل الحساب عن العرض ─────────────────────────────────────────── */
head('١٠ · لا تنسيق في الحساب ولا حساب في التنسيق');
{
  const src = body.match(/<script id="appscript">([\s\S]*?)<\/script>/)[1];
  /* Comments are stripped first: the rule is about what the layer computes,
     and the header prose explaining the rule quotes the very symbol it bans. */
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const metrics = strip(src.slice(src.indexOf('/* ── the five bases'), src.indexOf('/* ══ end METRICS')));
  ok('لا toFixed في METRICS', !metrics.includes('toFixed'));
  ok('ولا parseFloat', !metrics.includes('parseFloat'));
  ok('ولا رمز عملة', !metrics.includes('ر.ع'));
  ok('ولا استدعاء rial()/fmt() للتنسيق', !/\brial\(|\bfmt\(/.test(metrics));

  const view = strip(src.slice(src.indexOf("VIEWS['ops.dash']"), src.indexOf("VIEWS['ops.adash']")));
  ok('ولا حساب ماليّ في طبقة الرسم', !/\bproRata\(|feeBps|\* 10000|\/ 10000/.test(view),
     (view.match(/proRata\(|feeBps|\* 10000|\/ 10000/g) || []).join('،'));
}

/* ── ١١ · العمل الذي لم يكن له طابور ─────────────────────────────────── */
head('١١ · طلب معتمَد لم يُنشر يصل اللوحة');
{
  const { ctx, p, errs } = await open('approved.html', 'sysadmin@hissa.om', '#/ops/dash');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('اللوحة تسمّيه', /وافقت عليه اللجنة/.test(txt),
     (txt.match(/وافقت عليه اللجنة[^·]*/) || ['(لا شيء)'])[0].trim());
  ok('وتقول إنه لم يُنشر كفرصة', /لم يُنشر كفرصة بعد/.test(txt));
  ok('وسطره يحمل معرِّف الطلب ليُبرَز',
     (await p.$$('.qcard--crit #rec-APP-2026-0007')).length === 1);
  ok('وتبويب الطلبات يعدّه', /الطلبات/.test(txt));
  ok('بلا أخطاء تشغيل', errs.length === 0, errs.join(' · '));
  await ctx.close();
}
{
  /* وعلى البذرة — والطلب فيها قيد الفحص — لا تُقال العبارة. */
  const { ctx, p } = await open('index.html', 'sysadmin@hissa.om', '#/ops/dash');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('ولا تُقال عن طلب ما زال قيد الفحص', !/وافقت عليه اللجنة/.test(txt));
  await ctx.close();
}

/* ── ١٢ · البوّابة داخل الطبقة لا في الشاشة ──────────────────────────── */
head('١٢ · قائمة المهل مبنيّة بصلاحية قارئها');
{
  const { ctx, p } = await open('work.html', 'compliance@hissa.om', '#/ops/dash');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('حساب الالتزام يرى قائمة مهله', /تجاوز مهلته/.test(txt) || /لا شيء ينتظرك/.test(txt));
  ok('ولا طلب صرف فيها', !/ينتظر اعتماد طرف ثانٍ/.test(txt));
  ok('ولا تقريرًا', !/موعد الاستحقاق/.test(txt));
  await ctx.close();
}

console.log('\n' + (bad ? '✗ ' + bad + ' فاشلًا' : '✓ كل معايير المرحلة ٢ خضراء'));
await b.close();
process.exit(bad ? 1 : 0);
