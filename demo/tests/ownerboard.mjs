/* المرحلة ٤ — سطح صاحب المشروع على سيلكتورات METRICS.
 *
 * كانت هذه الشاشة الرابعة والأخيرة التي تحسب أرقامها بنفسها، وكانت ستة
 * سيلكتورات مكتوبة لها بلا مستدعٍ واحد. ما يثبته هذا الاختبار:
 *
 *   ١ الأسئلة الأربعة تُبنى، والشاشة تأخذ العرض الكامل
 *   ٢ دون الحدّ الأدنى: تقول كم ينقص وأن الإغلاق يسترد كل شيء
 *   ٣ وفوقه: تقول إن الإغلاق ناجح ولا تُنذر
 *   ٤ أرقام الصرف تطابق المحرّك بالبايسة
 *   ٥ رسم النجاح صفر ما لم يتجاوز التوزيعُ رأسَ المال، والأساس معلن
 *   ٦ سطح المالك لا يحمل مبلغ فرق مطابقة ولا اسم موقّعها
 *   ٧ عنوان يسمّي فرصة ليست له لا يفتحها
 *   ٨ حساب فريق تشغيل لا يصل الشاشة أصلًا
 *   ٩ ولا حساب ماليّ في طبقة الرسم
 */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';

const body = fs.readFileSync('hissa-demo.html', 'utf8');
const APP = fs.readFileSync('/tmp/app.html', 'utf8');
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const RE = /<script id="appstate" type="application\/json">([\s\S]*?)<\/script>/;
const seed = JSON.parse(body.match(RE)[1]);
const clone = o => JSON.parse(JSON.stringify(o));
const write = (f, st) => fs.writeFileSync('serve/' + f, APP.replace(RE,
  '<script id="appstate" type="application/json">'
  + JSON.stringify(st).replace(/</g, '\\u003c') + '</' + 'script>'));

/* ١ · فرصة مفتوحة لم تبلغ حدّها الأدنى: يُبقى أصغر التزامَين فقط */
const short = clone(seed);
{
  const keep = short.orders.filter(o => o.poolId === 'p_cafe')
    .sort((a, b) => a.amount - b.amount).slice(0, 2).map(o => o.id);
  short.orders = short.orders.filter(o => o.poolId !== 'p_cafe' || keep.includes(o.id));
}
write('short.html', short);

/* ٢ · مطابقة موقَّعة تحمل فرقًا ومُوقِّعًا — لا يجوز أن يظهر أيٌّ منهما للمالك */
const recon = clone(seed);
recon.reconciliations = [{
  id: 'REC-2026-0001', periodFrom: '2026-08-01', periodTo: '2026-08-28',
  openingBalance: 0, closingBalance: 12_345_000,
  lines: [], rejected: [], matched: [],
  breaks: [{ id: 'REC-2026-0001-B1', side: 'statement', ref: 'FEE-9', amount: 7_654_000,
             what: 'رسم تحويل', kind: 'fee', note: 'رسم شهري من البنك لا يقابله حدث', caseId: null }],
  status: 'signed',
  preparedBy: 'u_fin1', preparedAt: '2026-08-27T09:00:00Z',
  signedBy: 'u_fin2', signedAt: '2026-08-28T09:00:00Z',
}];
write('recon.html', recon);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, x) => { if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (x ? ' — ' + x : '')); };
const head = t => console.log('\n══ ' + t + ' ══');
const errs = [];

async function open(file, email, hash) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', email); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]'); await p.waitForTimeout(1300);
  await p.goto('http://127.0.0.1:8731/' + file + (hash || '#/own/project'), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { ctx, p };
}
const num = t => { const m = String(t).match(/([\d,]+(?:\.\d{3})?)/);
  return m ? Math.round(Number(m[1].replace(/,/g, '')) * 1000) : null; };
const kpi = async (p, label) => p.evaluate(l => {
  const k = [...document.querySelectorAll('.kv__k')].find(x => x.textContent.trim() === l);
  return k ? k.parentElement.querySelector('.kv__v').textContent.trim() : null;
}, label);

/* ── ١ · الأسئلة الأربعة، والعرض الكامل ───────────────────────────────── */
head('١ · سطح المالك يُبنى');
{
  const { ctx, p } = await open('index.html', 'owner.logistics@example.om');
  const bands = await p.$$eval('.band__t', n => n.map(x => x.textContent.trim()));
  ok('أربعة أشرطة', bands.length === 4, bands.join(' · '));
  ok('أوّلها سؤال بلوغ الحدّ', /يبلغ التمويل/.test(bands[0] || ''), bands[0]);
  ok('وفيها سؤال ما خرج للمالك', /خرج إليك/.test(bands[1] || ''), bands[1]);
  ok('وسؤال ما تأخذه المنصّة', /المنصّة/.test(bands[2] || ''), bands[2]);
  ok('وسؤال مكان المال', /المال حيث/.test(bands[3] || ''), bands[3]);
  ok('والشاشة تأخذ العرض الكامل',
     await p.$eval('.main__inner', e => e.classList.contains('main__inner--wide')));
  ok('والمسار مطويّ لا يفترش الشاشة', !!(await p.$('details.fold')));
  await ctx.close();
}

/* ── ٢ · دون الحدّ الأدنى ─────────────────────────────────────────────── */
head('٢ · فرصة لم تبلغ حدّها');
{
  const { ctx, p } = await open('short.html', 'owner.cafe@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('تقول إنه لم يبلغ الحدّ الأدنى', /لم يبلغ الحدّ الأدنى/.test(txt));
  ok('وتقول كم ينقص بالضبط', /ينقص\s*[\d,]+/.test(txt),
     (txt.match(/ينقص\s*[\d,]+ ر\.ع/) || ['—'])[0]);
  ok('وتقول إن الإغلاق يسترد كل ريال', /استرداد كل ريال/.test(txt));
  const live = short.orders.filter(o => o.poolId === 'p_cafe'
    && ['pending', 'confirmed', 'allocated'].includes(o.status));
  const raised = live.reduce((s, o) => s + o.amount, 0);
  ok('والملتزم به يطابق المحرّك بالبايسة',
     num(await kpi(p, 'الملتزم به')) === raised,
     `${num(await kpi(p, 'الملتزم به'))} / ${raised}`);
  await ctx.close();
}

/* ── ٣ · وفوق الحدّ ───────────────────────────────────────────────────── */
head('٣ · فرصة بلغت حدّها');
{
  const { ctx, p } = await open('index.html', 'owner.cafe@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('تقول إن الحدّ الأدنى بلغ', /بلغ الحدّ الأدنى/.test(txt));
  ok('ولا تُنذر بالاسترداد', !/استرداد كل ريال/.test(txt));
  ok('وتذكر المتّسع حتى السقف', /حتى سقف الاكتتاب/.test(txt));
  await ctx.close();
}

/* ── ٤ · الصرف يطابق المحرّك ──────────────────────────────────────────── */
head('٤ · ما خرج وما بقي محتجزًا');
{
  const { ctx, p } = await open('index.html', 'owner.logistics@example.om');
  const pl = seed.pools.find(x => x.id === 'p_log');
  const planned = pl.milestones.reduce((s, m) => s + m.amount, 0);
  const paid = seed.disbursements
    .filter(d => d.poolId === 'p_log' && d.status === 'executed')
    .reduce((s, d) => s + d.amount, 0);
  ok('المخطَّط على المراحل', num(await kpi(p, 'مخطَّط على المراحل')) === planned,
     `${num(await kpi(p, 'مخطَّط على المراحل'))} / ${planned}`);
  ok('وما صُرف فعلًا', num(await kpi(p, 'صُرف لك فعلًا')) === paid,
     `${num(await kpi(p, 'صُرف لك فعلًا'))} / ${paid}`);
  ok('والمحتجز هو الفرق لا رقمًا ثالثًا',
     num(await kpi(p, 'ما زال محتجزًا')) === Math.max(0, planned - paid),
     `${num(await kpi(p, 'ما زال محتجزًا'))} / ${Math.max(0, planned - paid)}`);
  await ctx.close();
}

/* ── ٥ · الرسوم وأساسها ──────────────────────────────────────────────── */
head('٥ · ما تأخذه المنصّة');
{
  const { ctx, p } = await open('index.html', 'owner.logistics@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  const allocated = seed.orders.filter(o => o.poolId === 'p_log' && o.status === 'allocated')
    .reduce((s, o) => s + (o.allocated != null ? o.allocated : o.amount), 0);
  const distributed = seed.distributions.filter(d => d.poolId === 'p_log')
    .reduce((s, d) => s + d.gross, 0);
  ok('رسم النجاح صفر ما دام التوزيع دون رأس المال',
     distributed <= allocated && num(await kpi(p, 'رسم النجاح')) === 0,
     `وُزّع ${distributed} من ${allocated}`);
  ok('والأساس معلن على البطاقة نفسها', /على الربح وحده/.test(txt));
  ok('ورسم المنصة على ما خُصِّص عند الإغلاق', /على ما خُصِّص عند الإغلاق/.test(txt));
  ok('ويُقال إنه بأسعار يوم الإغلاق لا اليوم', /النافذة يوم إغلاق|النافذة يوم|يوم إغلاق/.test(txt));
  await ctx.close();
}

/* ── ٦ · المطابقة: الواقعة دون أرقام المنصّة ─────────────────────────── */
head('٦ · ما يُقال للمالك عن المطابقة');
{
  const { ctx, p } = await open('recon.html', 'owner.logistics@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('يعرف أن الحساب قوبل ووُقّع', /مطابَق ومُوقَّع/.test(txt));
  ok('ويرى الفترة', /2026-08-01 → 2026-08-28/.test(txt));
  ok('ولا يرى مبلغ الفرق', !/7,654/.test(txt));
  ok('ولا الرصيد الختامي', !/12,345/.test(txt));
  ok('ولا اسم من وقّعها', !/خالد الرواحي/.test(txt));
  ok('ويُقال له صراحةً أين تُقرأ التفاصيل', /تخصّ فريق المالية والمدقّق/.test(txt));
  await ctx.close();
}

/* ── ٧ · عنوان فرصة ليست له ──────────────────────────────────────────── */
head('٧ · حدود ما يفتحه العنوان');
{
  const { ctx, p } = await open('index.html', 'owner.logistics@example.om', '#/own/project/p_cafe');
  const title = (await p.$eval('#pagetitle', e => e.textContent)).trim();
  const cafe = seed.pools.find(x => x.id === 'p_cafe').title;
  const log = seed.pools.find(x => x.id === 'p_log').title;
  ok('لا يفتح مشروع مالك آخر', title !== cafe, title);
  ok('بل يبقى على مشروعه', title === log, title);
  await ctx.close();
}

/* ── ٨ · فريق التشغيل لا يصل الشاشة ──────────────────────────────────── */
head('٨ · الشاشة ليست لفريق التشغيل');
{
  const { ctx, p } = await open('index.html', 'maryam@hissa.om', '#/own/project');
  const hash = await p.evaluate(() => location.hash);
  ok('العنوان يُصحَّح إلى وجهة الحساب', !/own\/project/.test(hash), hash);
  const txt = await p.$eval('#root', e => e.textContent);
  ok('ولا يظهر شيء من سطح المالك', !/ماذا تأخذ المنصّة/.test(txt));
  await ctx.close();
}

/* ── ٩ · لا حساب في طبقة الرسم ───────────────────────────────────────── */
head('٩ · الشاشة تُنسّق ولا تحسب');
{
  const src = fs.readFileSync('hissa-demo.html', 'utf8');
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const view = strip(src.slice(src.indexOf("VIEWS['own.project']"),
                               src.indexOf("VIEWS['own.funds']")));
  ok('لا proRata', !view.includes('proRata'));
  ok('ولا feeBps', !view.includes('feeBps'));
  ok('ولا قراءة التزامات أو صرف من STATE',
     !/STATE\.(orders|disbursements|distributions|reconciliations)/.test(view),
     (view.match(/STATE\.\w+/g) || []).join('،'));
  ok('وكل أرقامها من سيلكتورات',
     (view.match(/\bsel[A-Z]\w+\(/g) || []).length >= 6,
     (view.match(/\bsel[A-Z]\w+\(/g) || []).join('،'));
}

ok('بلا أخطاء تشغيل', errs.length === 0, errs.join(' · '));
console.log('\n' + (bad ? '✗ ' + bad + ' فاشلًا' : '✓ سطح المالك أخضر'));
await b.close();
process.exit(bad ? 1 : 0);
