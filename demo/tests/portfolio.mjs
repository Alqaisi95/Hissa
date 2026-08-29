/* المرحلة ٣ — محفظتي على سيلكتورات METRICS. ما تثبته:
   ١ التوزيعة المزروعة بلا shares تصل صاحبها — العطل الذي كانت الشاشة تعرض فيه صفرًا
   ٢ ومجموع ما يراه المستثمرون يساوي إجمالي التوزيعة بالضبط
   ٣ الحدّ المتبقي بنافذة اثني عشر شهرًا لا تراكميًّا مدى الحياة
   ٤ «بلا حدّ منشور» تُقال نصًّا ولا تُعرض صفرًا
   ٥ القيمة المسجَّلة تُعلن أساسها بدل أن تتظاهر بتقييم
   ٦ مهلة العدول تظهر أولًا ومعها زرّها، وتختفي حين تنتهي
   ٧ محفظة مستثمر لا تُفتح بعنوان مستثمر آخر
   ٨ الشاشة تُرسم لحساب بلا التزامات: نصوص فراغ لا أصفار عارية
   ٩ لا حساب ماليّ في طبقة الرسم                                            */
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

/* التزام أقدم من سنة: يجب أن يخرج من نافذة الحدّ */
const aged = clone(seed);
aged.orders.push({ id: 'ORD-OLD-1', poolId: 'p_cafe', userId: 'u_inv1', amount: 4000000,
  status: 'confirmed', createdAt: '2024-02-01T00:00:00Z' });
write('aged.html', aged);

/* حساب مستثمر بلا أي التزام */
const bare = clone(seed);
bare.orders = bare.orders.filter(o => o.userId !== 'u_inv7');
bare.distributions = [];
write('bare.html', bare);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, x) => { if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (x ? ' — ' + x : '')); };
const head = t => console.log('\n══ ' + t + ' ══');

async function open(file, email, hash) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(350);
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', email); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]'); await p.waitForTimeout(1400);
  await p.goto('http://127.0.0.1:8731/' + file + (hash || '#/inv/portfolio'), { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { ctx, p, errs };
}
const money = t => { const m = String(t).match(/([\d,]+(?:\.\d{3})?)/);
  return m ? Number(m[1].replace(/,/g, '')) : null; };

/* ── ١ · التوزيعة بلا shares تصل صاحبها ───────────────────────────────── */
head('١ · التوزيعة المزروعة تصل المستثمر');
{
  const d = seed.distributions[0];
  ok('البذرة فعلًا بلا مصفوفة حصص', !Array.isArray(d.shares) || !d.shares.length,
     JSON.stringify(Object.keys(d)));

  const holders = seed.orders.filter(o => o.poolId === d.poolId && o.status === 'allocated');
  let total = 0;
  for (const h of new Set(holders.map(o => o.userId))) {
    const email = seed.users.find(u => u.id === h).email;
    const { ctx, p } = await open('index.html', email);
    const txt = await p.$eval('#root', e => e.textContent);
    const card = txt.match(/توزيعات وصلتك نقدًا([\s\S]{0,40})/);
    const got = card ? money(card[1]) : null;
    ok('يرى ' + email + ' حصته لا صفرًا', got !== null && got > 0, String(got));
    /* والمجموع يُقرأ من جدول التوزيعات نفسه */
    const rows = await p.$$eval('.card table tbody tr td.n', c => c.map(x => x.textContent));
    total += got || 0;
    await ctx.close();
  }
  ok('ومجموع ما يراه الثلاثة يساوي إجمالي التوزيعة',
     Math.round(total * 1000) === d.gross, `${Math.round(total * 1000)} / ${d.gross}`);
}

/* ── ٢ · نافذة الحدّ ──────────────────────────────────────────────────── */
head('٢ · الحدّ بنافذة اثني عشر شهرًا');
{
  const a = await open('index.html', 'abdullah@example.om');
  const base = money((await a.p.$eval('#root', e => e.textContent))
    .match(/المتبقي خلال 12 شهرًا([\s\S]{0,30})/)[1]);
  await a.ctx.close();

  const c = await open('aged.html', 'abdullah@example.om');
  const withOld = money((await c.p.$eval('#root', e => e.textContent))
    .match(/المتبقي خلال 12 شهرًا([\s\S]{0,30})/)[1]);
  ok('التزام عمره سنتان لا ينقص المتّسع', base === withOld, `${base} / ${withOld}`);
  ok('والنافذة معلَنة نصًّا', (await c.p.$eval('#root', e => e.textContent)).includes('نافذة متحرّكة'));
  await c.ctx.close();

  /* صنف بلا حدّ منشور: نصّ لا صفر */
  const s = await open('index.html', 'amal@example.om');       // متمرس
  const txt = await s.p.$eval('#root', e => e.textContent);
  ok('«بلا حدّ منشور» تُقال نصًّا', txt.includes('لا حدّ سنويّ منشور'));
  ok('ولا يظهر «المتبقي خلال 12 شهرًا» بصفر', !/المتبقي خلال 12 شهرًا[\s\S]{0,12}0[^\d]/.test(txt));
  await s.ctx.close();
}

/* ── ٣ · القيمة تُعلن أساسها ──────────────────────────────────────────── */
head('٣ · القيمة المسجَّلة صادقة في تسميتها');
{
  const { ctx, p } = await open('index.html', 'abdullah@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('تُسمّى «القيمة المسجَّلة» لا «القيمة السوقية»', txt.includes('القيمة المسجَّلة'));
  ok('ويُقال إنها بالتكلفة', txt.includes('بالتكلفة'));
  ok('ويُشرح لماذا', txt.includes('لا سوق ثانوية لحصتك ولا مقيِّم مستقل'));
  ok('والعائد موصوف بأنه نقديّ لا تقديريّ', txt.includes('العائد النقدي حتى الآن'));
  await ctx.close();
}

/* ── ٤ · مهلة العدول ──────────────────────────────────────────────────── */
head('٤ · المهلة تظهر أولًا ومعها مخرجها');
{
  const st = clone(seed);
  const o = st.orders.find(x => x.userId === 'u_inv1' && x.status === 'pending');
  o.createdAt = new Date(Date.now() - 3600000).toISOString();      // داخل المهلة
  write('cool.html', st);
  const { ctx, p } = await open('cool.html', 'abdullah@example.om');
  const first = await p.$eval('#root .note', e => e.textContent);
  ok('أول ما يظهر هو المهلة', /مهلة العدول|تغيّر جوهري/.test(first), first.slice(0, 50));
  ok('ومعها زرّ عدول في الجدول', (await p.$$('[data-act="withdrawOrder"]')).length > 0);
  await ctx.close();

  const st2 = clone(seed);
  const o2 = st2.orders.find(x => x.userId === 'u_inv1' && x.status === 'pending');
  o2.createdAt = '2026-01-01T00:00:00Z';                           // انتهت
  write('cold.html', st2);
  const c = await open('cold.html', 'abdullah@example.om');
  ok('وتختفي حين تنتهي', (await c.p.$$('[data-act="withdrawOrder"]')).length === 0);
  await c.ctx.close();
}

/* ── ٥ · لا محفظة غيرك ────────────────────────────────────────────────── */
head('٥ · عزل المحافظ في الشاشة نفسها');
{
  const a = await open('index.html', 'abdullah@example.om');
  const capA = money((await a.p.$eval('#root', e => e.textContent))
    .match(/رأس المال الملتزم به([\s\S]{0,30})/)[1]);
  await a.ctx.close();

  /* عنوان يسمّي فرصة غيره لا يغيّر صاحب المحفظة */
  const c = await open('index.html', 'abdullah@example.om', '#/inv/portfolio/u_inv4');
  const capB = money((await c.p.$eval('#root', e => e.textContent))
    .match(/رأس المال الملتزم به([\s\S]{0,30})/)[1]);
  ok('مُعرِّف في العنوان لا يفتح محفظة غيرك', capA === capB, `${capA} / ${capB}`);

  const d = await open('index.html', 'amal@example.om');
  const capC = money((await d.p.$eval('#root', e => e.textContent))
    .match(/رأس المال الملتزم به([\s\S]{0,30})/)[1]);
  ok('وحسابان مختلفان يريان رقمين مختلفين', capA !== capC, `${capA} / ${capC}`);
  await c.ctx.close(); await d.ctx.close();
}

/* ── ٦ · حساب بلا التزامات ────────────────────────────────────────────── */
head('٦ · محفظة فارغة');
{
  const { ctx, p, errs } = await open('bare.html', 'majid@example.om');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('الشاشة تُرسم', (await p.$eval('#pagetitle', e => e.textContent.trim())) === 'محفظتي');
  ok('وتقول «لا التزامات بعد» نصًّا', txt.includes('لا التزامات بعد'));
  ok('ولا خطأ وحدة تحكّم', errs.length === 0, errs.slice(0, 2).join(' | '));
  ok('ولا فيض أفقي', await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth === 0));
  await ctx.close();
}

/* ── ٧ · السقف عند حقل المبلغ ─────────────────────────────────────────── */
head('٧ · السقف قبل الالتزام لا بعده');
{
  const { ctx, p } = await open('index.html', 'abdullah@example.om', '#/inv/invest/p_clinic');
  /* p_cafe مكتتبة فوق سقفها في البذرة، فالمتاح فيها صفر ولا سقف يُعرض — وهو
     السلوك الصحيح: بطاقة الأهلية بجانبها تقول لماذا. فرصة فيها متّسع هي ما
     يختبر السطر نفسه. */
  const hint = await p.$eval('#iamt ~ .field__hint', e => e.textContent).catch(() => '');
  ok('حقل المبلغ يحمل أقصى ما يستطيعه', /أقصى ما تستطيعه الآن/.test(hint), hint.slice(0, 80));
  ok('ويسمّي القيد', /القيد:/.test(hint), hint.slice(0, 90));
  await ctx.close();
}

/* ── ٩ · الإشعار عن نفس التوزيعة ──────────────────────────────────────── */
head('٩ · شريط الإشعارات لا يُسقط دفعةً وصلت');
{
  const { ctx, p, errs } = await open('index.html', 'amal@example.om', '#/inv/inbox');
  const txt = await p.$eval('#root', e => e.textContent);
  /* العطب الذي كان: الشريط يقرأ d.shares مباشرةً، والتوزيعة المزروعة بلا
     مصفوفة — فالمال يصل، والمحفظة تعرضه، ولا يُخبَر صاحبه. */
  ok('يوجد إشعار توزيع', /وصلك توزيع/.test(txt),
     (txt.match(/وصلك توزيع[^.]*\./) || ['(لا شيء)'])[0]);
  ok('ويسمّي التوزيعة وفترتها',
     /DST-2026-0001/.test(txt) && /الربع الثاني 2026/.test(txt));
  ok('ومبلغه هو ما تعرضه المحفظة بالبايسة', /1,142\.857/.test(txt),
     (txt.match(/وصلك توزيع [\d,.]+/) || ['—'])[0]);
  ok('بلا أخطاء تشغيل', errs.length === 0, errs.join(' · '));
  await ctx.close();
}
{
  const { ctx, p } = await open('index.html', 'abdullah@example.om', '#/inv/inbox');
  const txt = await p.$eval('#root', e => e.textContent);
  ok('ومن لم تصله توزيعة لا يُخبَر بواحدة', !/وصلك توزيع/.test(txt));
  await ctx.close();
}

/* ── ٨ · لا حساب ماليّ في الرسم ───────────────────────────────────────── */
head('٨ · الحساب في METRICS والتنسيق في الشاشة');
{
  const src = body.match(/<script id="appscript">([\s\S]*?)<\/script>/)[1];
  const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const view = strip(src.slice(src.indexOf("VIEWS['inv.portfolio']"), src.indexOf("VIEWS['inv.inbox']")));
  ok('لا proRata في الشاشة', !view.includes('proRata'));
  ok('ولا feeBps', !view.includes('feeBps'));
  ok('ولا قراءة مباشرة من STATE.orders', !/STATE\.(orders|distributions)/.test(view),
     (view.match(/STATE\.\w+/g) || []).join('،'));
  ok('وكل أرقامها من سيلكتورات', (view.match(/\bsel[A-Z]\w+\(/g) || []).length >= 6,
     (view.match(/\bsel[A-Z]\w+\(/g) || []).join('،'));
}

console.log('\n' + (bad ? '✗ ' + bad + ' فاشلًا' : '✓ محفظتي خضراء'));
await b.close();
process.exit(bad ? 1 : 0);
