/* لوحة إدارة النظام — ما تثبته هذه الاختبارات:
   ١ الحساب المميَّز الذي لم يُستخدم قط يظهر (الثقب الذي كان يبتلعه)
   ٢ تحليل فصل المهام ينطبق على حساب المدير، ويعرض الضابط المانع حيث يوجد
   ٣ لا اقتطاع صامت: عدد الأسطر المرسومة = العدد الذي تعلنه الشاشة نفسها
   ٤ المصفوفة تنقلب فوق ثمانية حسابات نشطة
   ٥ فعل يُنفَّذ من اللوحة يصل سجل التدقيق
   ٦ حساب المدقق لا يفتح اللوحة أصلًا                                        */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';

const body = fs.readFileSync('hissa-demo.html', 'utf8');
fs.copyFileSync('/tmp/app.html', 'serve/index.html');

/* نسخة ثانية باثني عشر حسابًا نشطًا، لإثبات انقلاب المصفوفة وحدها */
const st = JSON.parse(body.match(/<script id="appstate" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const seed = st.users.find(u => u.id === 'u_cmp1');
for (let i = 0; i < 5; i += 1) {
  st.users.push(Object.assign({}, seed, { id: 'u_bulk' + i, name: 'موظف كتلة ' + i,
    email: 'bulk' + i + '@hissa.om', lastSignInAt: new Date().toISOString() }));
}
fs.writeFileSync('serve/many.html', fs.readFileSync('/tmp/app.html', 'utf8').replace(
  /<script id="appstate" type="application\/json">[\s\S]*?<\/script>/,
  '<script id="appstate" type="application/json">'
    + JSON.stringify(st).replace(/</g, '\\u003c') + '</' + 'script>'));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
let bad = 0;
const ok = (l, v, extra) => {
  if (!v) bad += 1;
  console.log((v ? '  ✓ ' : '  ✗ ') + l + (extra ? ' — ' + extra : ''));
};

async function open(file, email, pw) {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 }, locale: 'ar-OM' });
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
  return { ctx, p, errs, inn };
}

/* ══ ١ · اللوحة بعين مدير النظام ══ */
console.log('\n══ لوحة الإدارة — مدير بكل الصلاحيات ══');
const A = await open('index.html', 'sysadmin@hissa.om', 'Hissa#2026');
ok('يدخل ويصل اللوحة', A.inn);
if (A.inn) {
  await A.p.click('[data-view="ops.adash"]');
  await A.p.waitForSelector('#pagetitle', { timeout: 5000 });
  await A.p.waitForTimeout(500);

  ok('العنوان «لوحة إدارة النظام»',
    (await A.p.$eval('#pagetitle', h => h.textContent.trim())) === 'لوحة إدارة النظام');

  const bands = await A.p.$$eval('.band__t', n => n.map(x => x.textContent.trim()));
  console.log('    الأشرطة: ' + bands.join(' · '));
  /* صارت أربعة: «من يملك ماذا» و«من يستطيع وحده» سؤال واحد عند القارئ، فدُمجا
     والمصفوفة طُويت داخل الثاني. المهمّ ألّا يسقط سؤال، لا أن يبقى العدد — فيُفحص
     أن الأسئلة الأربعة قائمة وأن المصفوفة ما زالت قابلة للفتح. */
  ok('أربعة أشرطة', bands.length === 4, bands.join(' · '));
  ok('الشريط الثاني هو سؤال فصل المهام', /وحده/.test(bands[1] || ''));
  ok('الشريط الثالث هو سؤال تغيّر الوصول', /تغيّر في الوصول/.test(bands[2] || ''));
  ok('والرابع هو تماسك السجل', /السجل/.test(bands[3] || ''));
  const fold = await A.p.$eval('.fold > summary', e => e.textContent.trim()).catch(() => '');
  ok('ومصفوفة الصلاحيات مطويّة لا محذوفة', /مصفوفة الصلاحيات/.test(fold), fold.slice(0, 50));
  await A.p.click('.fold > summary'); await A.p.waitForTimeout(250);
  ok('وتُفتح فتظهر', (await A.p.$$('.fold[open] .pmx')).length === 1);

  /* ٢ · لا اقتطاع صامت — الشاشة تعلن عددًا، فليُرسم كله */
  const note = await A.p.$$eval('.band p.xs.muted',
    n => (n.map(x => x.textContent).find(t => /معروض/.test(t)) || ''));
  const m = note.match(/معروض\s+(\d+)\s+من\s+(\d+)/);
  const drawn = await A.p.$$eval('.excg .exc__row', n => n.length);
  ok('كل بند محسوب مرسوم — لا اقتطاع', !!m && Number(m[1]) === drawn && Number(m[1]) === Number(m[2]),
    m ? 'أعلنت ' + m[1] + '/' + m[2] + ' ورسمت ' + drawn : 'لم يظهر سطر العدّ');

  const kinds = await A.p.$$eval('.excg__h', n => n.map(x => x.textContent.replace(/\d+$/, '').trim()));
  ok('البنود مجمَّعة بالنوع', kinds.length >= 2, kinds.join(' · '));

  /* ١ · الحساب المميَّز الذي لم يُستخدم قط */
  const whys = await A.p.$$eval('.excg .exc__row .exc__why', n => n.map(x => x.textContent));
  ok('يرصد حسابًا بصلاحيات حسّاسة لم يُستخدم قط',
    whys.some(t => /لم يُستخدم قط/.test(t)),
    whys.filter(t => /لم يُستخدم قط/.test(t)).length + ' حسابًا');

  /* الانحراف عن معيار الوظيفة — حساب المدير يزيد اثنتي عشرة صلاحية */
  ok('يرصد انحراف الصلاحيات عن معيار الوظيفة',
    whys.some(t => /لا تطابق معيار وظيفة/.test(t)));

  /* ٣ · فصل المهام */
  const sodNames = await A.p.$$eval('.sod__h strong', n => n.map(x => x.textContent.trim()));
  ok('حساب المدير يظهر في تحليل فصل المهام — بلا استثناء',
    sodNames.includes('المشرف العام'), sodNames.join(' · '));
  const marks = await A.p.$$eval('.sod__r .exc__age', n => n.map(x => x.textContent.trim()));
  ok('يعرض «محجوب» حيث يوجد ضابط', marks.includes('محجوب'));
  ok('ويعرض «مكشوف» حيث لا ضابط', marks.includes('مكشوف'));
  const mit = await A.p.$$eval('.sod__r .chip--pos', n => n.map(x => x.textContent));
  ok('يسمّي الضابط المانع نصًّا', mit.some(t => /لا يعتمد الطلبَ من أنشأه/.test(t)));

  /* ٤ · المصفوفة غير منقلبة عند ستة حسابات */
  ok('المصفوفة عمودية عند العدد الصغير', !(await A.p.$('.pmx--flip')));

  /* ٥ · فعل من اللوحة يصل السجل */
  /* الشارة تنطق الآن: نصّها «214 سطرًا» لقارئ الشاشة، والعدد وحده في data-n.
     فيُقرأ العدد من حيث هو عدد. */
  const before = await A.p.$eval('[data-view="ops.audit"] .navlink__badge',
    e => Number(e.dataset.n)).catch(() => 0);
  const btn = await A.p.$('.excg [data-act="revokeReset"], .excg [data-act="toggleSuspend"], .excg [data-act="revokeInvite"]');
  if (!btn) {
    console.log('    (لا فعل مباشر مطلوب في هذه الحالة — يُتخطّى)');
  } else {
    const what = await btn.getAttribute('data-act');
    await btn.click();
    await A.p.waitForTimeout(700);
    const after = await A.p.$eval('[data-view="ops.audit"] .navlink__badge',
      e => Number(e.dataset.n)).catch(() => 0);
    ok('فعل «' + what + '» من اللوحة يضيف سطرًا للتدقيق', after === before + 1,
      before + ' → ' + after);
  }

  /* السلسلة ما زالت سليمة بعد الفعل */
  await A.p.waitForTimeout(300);
  const chain = await A.p.$$eval('.hero__v', n => n.map(x => x.textContent.trim()));
  ok('سلسلة التدقيق سليمة', chain.includes('سليمة'), chain.join(' · '));

  ok('بلا أخطاء تشغيل', A.errs.length === 0, A.errs.join(' | '));
}
await A.ctx.close();

/* ══ ٤ · انقلاب المصفوفة عند اثني عشر حسابًا نشطًا ══ */
console.log('\n══ المصفوفة عند ١٢ حسابًا نشطًا ══');
const B = await open('many.html', 'sysadmin@hissa.om', 'Hissa#2026');
ok('يدخل', B.inn);
if (B.inn) {
  await B.p.click('[data-view="ops.adash"]');
  await B.p.waitForSelector('#pagetitle', { timeout: 5000 });
  await B.p.waitForTimeout(500);
  ok('المصفوفة انقلبت', !!(await B.p.$('.pmx--flip')));
  const rows = await B.p.$$eval('.pmx--flip tbody tr', n => n.length);
  /* سبعة حسابات فريق نشطة في البذرة + خمسة مضافة */
  ok('صفّ لكل حساب نشط', rows === 12, rows + ' صفًّا');
  const head = await B.p.$$eval('.pmx--flip thead th', n => n.map(x => x.textContent.trim()));
  ok('أعمدة المجالات لا الحسابات', head.includes('المال') && head.includes('مدى الوصول'),
    head.join(' · '));
  ok('بلا أخطاء تشغيل', B.errs.length === 0, B.errs.join(' | '));
}
await B.ctx.close();

/* ══ ٦ · المدقق لا يفتح اللوحة ══ */
console.log('\n══ المدقق المستقل ══');
const C = await open('index.html', 'auditor@hissa.om', 'Hissa#2026');
ok('يدخل', C.inn);
if (C.inn) {
  await C.p.waitForTimeout(400);
  const navs = await C.p.$$eval('.navlink', n => n.map(x => x.textContent));
  ok('لا يرى «لوحة إدارة النظام» في قائمته',
    !navs.some(t => /لوحة إدارة النظام/.test(t)), navs.length + ' شاشة');
  /* والمحرك يرفض حتى لو زُرع الزر */
  const forced = await C.p.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.act = 'toggleSuspend'; b.dataset.user = 'u_fin1'; b.dataset.on = '1';
    document.body.appendChild(b); b.click();
    return new Promise(r => setTimeout(() => r(
      [...document.querySelectorAll('#alerts .toast')].map(t => t.textContent).join(' | ')), 600));
  });
  ok('المحرك يرفض الفعل المزروع', /لا تملك صلاحية/.test(forced), forced || '(صامت)');
  ok('بلا أخطاء تشغيل', C.errs.length === 0, C.errs.join(' | '));
}
await C.ctx.close();

await b.close();
console.log(bad ? '\n✗ ' + bad + ' فحصًا فاشلًا\n' : '\n✓ كل الفحوص خضراء\n');
process.exit(bad ? 1 : 0);
