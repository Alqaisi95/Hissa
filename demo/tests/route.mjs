/* التوجيه: أن يكون لكل شاشة عنوان، ولكل سطر عنوان.
 *
 *   ١ كل شاشة يفتحها المستخدم تُفتح بعنوانها بعد تحميل بارد
 *   ٢ رجوع المتصفح وتقدّمه يعملان
 *   ٣ عنوان يسمّي سطرًا ⇒ يُفتح السطر مُبرَزًا داخل الشاشة لا رأس القائمة
 *   ٤ «افتح السطر» في اللوحة رابط حقيقي يحمل مُعرِّف السطر
 *   ٥ عنوان مجهول أو ممنوع ⇒ وجهة معقولة، والعنوان يُصحَّح لا يبقى كاذبًا
 *   ٦ عنوان تطبيق بلا حساب ⇒ الدخول حاملًا المقصد، ثم يُستأنف إليه
 *   ٧ إجراء داخل شاشة طويلة لا يحرّك التمرير
 *   ٨ زرّ التخطّي لا يغادر الشاشة
 *   ٩ parseHash/hrefFor ذهابًا وإيابًا — مرفوعتان من الملف المشحون
 */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const URL = 'http://127.0.0.1:8731/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());

let bad = 0;
const errs = [];
const ok = (l, v, extra) => { if (!v) bad += 1; console.log((v ? '  ✓ ' : '  ✗ ') + l + (v || !extra ? '' : '\n      ' + extra)); };

const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ar-OM' });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));

const hash = () => p.evaluate(() => location.hash);
const title = async () => (await p.textContent('#pagetitle')).trim();

async function login(email, pw) {
  await p.fill('#lem', email);
  await p.fill('#lpw', pw);
  await p.click('[data-act="doLogin"]');
  await p.waitForTimeout(1500);
}

/* ══ ٩ الدالّتان نفسهما، مرفوعتان من الملف المشحون ══════════════════════ */
{
  const src = fs.readFileSync('hissa-demo.html', 'utf8');
  const lift = name => {
    const at = src.indexOf('function ' + name + '(');
    if (at === -1) throw new Error(name + ' غير موجودة في الملف');
    let i = src.indexOf('{', at), depth = 0;
    for (let j = i; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') { depth -= 1; if (!depth) return src.slice(at, j + 1); }
    }
    throw new Error(name + ': لم يُغلق');
  };
  const mod = new Function('PUB_SCREENS', 'location',
    lift('parseHash') + '\n' + lift('hrefFor') + '\nreturn { parseHash, hrefFor };')
    (['landing', 'login', 'register', 'enrol', 'reset'], { hash: '' });

  const CASES = [
    { view: 'pub.landing', id: null, sub: null, query: {} },
    { view: 'pub.login', id: null, sub: null, query: {} },
    { view: 'ops.adash', id: null, sub: null, query: {} },
    { view: 'ops.adash', id: null, sub: null, query: { sev: '3' } },
    { view: 'ops.cases', id: 'CASE-2026-0004', sub: null, query: {} },
    { view: 'inv.pool', id: 'p_cafe', sub: 'uof', query: {} },
  ];
  const trips = CASES.map(r => {
    const back = mod.parseHash(mod.hrefFor(r));
    return JSON.stringify(back) === JSON.stringify(r);
  });
  ok('parseHash(hrefFor(r)) يعيد r نفسه في ' + CASES.length + ' حالة',
    trips.every(Boolean), 'فشل عند: ' + CASES.filter((_, i) => !trips[i]).map(r => r.view).join('، '));
  ok('مُعرِّف فيه محارف تحتاج ترميزًا يعود كما هو',
    mod.parseHash(mod.hrefFor({ view: 'ops.admin', id: 'a b/c' })).id === 'a b/c');
  ok('«#pagetitle» ليس مسارًا فيُرفض', mod.parseHash('#pagetitle') === null);
}

/* ══ ١ لكل شاشة عنوان ═══════════════════════════════════════════════════ */
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(400);
ok('الصفحة العامة عنوانها #/', (await hash()) === '#/');

await p.click('[data-pub="login"]');
await p.waitForTimeout(250);
ok('شاشة الدخول عنوانها #/login', (await hash()) === '#/login');

await login('sysadmin@hissa.local', 'Hissa#2026');
ok('الدخول يهبط على لوحة الإدارة بعنوانها', (await hash()) === '#/ops/adash', await hash());

const links = await p.$$eval('a.navlink', l => l.map(x => ({ href: x.getAttribute('href'), view: x.dataset.view })));
ok('كل عنصر تنقّل رابط <a> له href', links.length === 15 && links.every(l => l.href && l.href.startsWith('#/')),
  JSON.stringify(links.slice(0, 3)));

let reachable = 0, unreachable = [];
for (const l of links) {
  await p.goto(URL + l.href, { waitUntil: 'load' });
  await p.waitForTimeout(450);
  if ((await hash()) === l.href) reachable += 1; else unreachable.push(l.view + ' → ' + await hash());
}
ok('الخمس عشرة شاشة تُفتح بعناوينها بعد تحميل بارد', unreachable.length === 0,
  'تعذّرت: ' + unreachable.join(' · '));

/* ══ ٢ رجوع المتصفح ═════════════════════════════════════════════════════ */
await p.goto(URL + '#/ops/adash', { waitUntil: 'load' });
await p.waitForTimeout(400);
await p.click('a.navlink[href="#/ops/recon"]');
await p.waitForTimeout(400);
const wentTo = await hash();
await p.goBack(); await p.waitForTimeout(400);
const came = await hash();
await p.goForward(); await p.waitForTimeout(400);
ok('رجوع المتصفح يعود، والتقدّم يعيد',
  wentTo === '#/ops/recon' && came === '#/ops/adash' && (await hash()) === '#/ops/recon',
  wentTo + ' → ' + came + ' → ' + await hash());

/* ══ ٤ اللوحة تربط بالسطر لا بالشاشة ════════════════════════════════════ */
await p.goto(URL + '#/ops/adash', { waitUntil: 'load' });
await p.waitForTimeout(600);
const tails = await p.$$eval('.exc__row a.btn', a =>
  a.map(x => ({ href: x.getAttribute('href'), text: x.textContent.trim() })));
ok('أزرار «افتح» في اللوحة صارت روابط', tails.length > 0, 'لا رابط في صفوف الاستثناءات');
const withRec = tails.filter(t => (t.href.match(/\//g) || []).length >= 3);
ok('منها ما يحمل مُعرِّف السطر ويقول «افتح السطر»',
  withRec.length > 0 && withRec.every(t => t.text === 'افتح السطر'),
  JSON.stringify(tails.slice(0, 4)));

/* ══ ٣ عنوان يسمّي سطرًا يفتح السطر ═════════════════════════════════════ */
await p.goto(URL + '#/ops/dash', { waitUntil: 'load' });
await p.waitForTimeout(600);
const caseLink = await p.$eval('.exc__row a.btn[href*="/ops/cases/"]', a => a.getAttribute('href'))
  .catch(() => null);
ok('لوحة التشغيل تربط حالة متأخرة بسطرها', !!caseLink, 'لا رابط لحالة');

if (caseLink) {
  const id = decodeURIComponent(caseLink.split('/').pop());
  await p.goto(URL + caseLink, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  const seen = await p.evaluate(recId => {
    const el = document.getElementById('rec-' + recId);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, inView: r.top >= 0 && r.top < innerHeight, hit: el.classList.contains('rowhit') };
  }, id);
  ok('السطر ' + id + ' موجود في الشاشة', seen.found);
  ok('وهو داخل الشاشة لا خلف تمرير', seen.inView, JSON.stringify(seen));
  ok('ومُبرَز لحظة الوصول', seen.hit, JSON.stringify(seen));
}

/* ══ ٥ عنوان مجهول أو ممنوع ═════════════════════════════════════════════ */
await p.goto(URL + '#/ops/nonsense', { waitUntil: 'load' });
await p.waitForTimeout(500);
ok('عنوان مجهول يهبط على وجهة معقولة ويُصحَّح العنوان',
  (await hash()) === '#/ops/adash' && (await title()) === 'لوحة إدارة النظام', await hash());

/* ══ ٦ عنوان تطبيق بلا حساب ═════════════════════════════════════════════ */
await p.evaluate(() => localStorage.clear());
await p.goto(URL + '#/ops/recon', { waitUntil: 'load' });
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(500);
ok('عنوان تطبيق بلا حساب ⇒ الدخول حاملًا المقصد',
  (await hash()) === '#/login?next=%2Fops%2Frecon', await hash());
ok('ونموذج الدخول معروض', await p.isVisible('#lem'));
await login('sysadmin@hissa.local', 'Hissa#2026');
ok('وبعد الدخول يُستأنف إلى المقصد لا إلى الافتراضية',
  (await hash()) === '#/ops/recon' && (await title()) === 'المطابقة البنكية', await hash());

/* ══ ٧ الإجراء لا يحرّك التمرير ═════════════════════════════════════════ */
await p.goto(URL + '#/ops/cases', { waitUntil: 'load' });
await p.waitForTimeout(600);
await p.evaluate(() => window.scrollTo(0, 600));
const y0 = await p.evaluate(() => window.scrollY);
await p.evaluate(() => { const t = document.querySelector('[data-act="takeCase"]'); if (t) t.click(); });
await p.waitForTimeout(900);
const y1 = await p.evaluate(() => window.scrollY);
ok('إجراء داخل شاشة طويلة يُبقي القارئ في موضعه', y0 > 0 && Math.abs(y1 - y0) < 40, y0 + ' → ' + y1);

/* ══ ٨ زرّ التخطّي ══════════════════════════════════════════════════════ */
const beforeSkip = await hash();
await p.evaluate(() => document.querySelector('.skip').click());
await p.waitForTimeout(300);
ok('زرّ التخطّي ينقل التركيز ولا يغادر الشاشة',
  (await hash()) === beforeSkip && (await p.evaluate(() => document.activeElement.id)) === 'pagetitle',
  beforeSkip + ' → ' + await hash());

ok('لا أخطاء في الصفحة', errs.length === 0, errs.join(' · '));

console.log(bad ? '\n✗ ' + bad + ' فحصًا فشل\n' : '\n✓ كل الفحوص خضراء\n');
await b.close();
process.exit(bad ? 1 : 0);
