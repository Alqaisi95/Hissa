/* تشخيص الواجهة — أداة تُشغَّل لا وثيقة تُقرأ.
 *
 * تقود متصفّحًا حقيقيًّا عبر كل شاشة يفتحها كل حساب، على ثلاثة مقاسات،
 * وتقيس ما لا يُقاس بالنظر: الفيض الأفقي، وتمرير التنقّل، وأهداف اللمس
 * الصغيرة، والضوابط بلا اسم مقروء، وترتيب العناوين، وكم من الشاشة يُستهلك
 * قبل أول معلومة.
 *
 * تُخرج تقريرًا ولقطات في .demo-work/audit/.
 *
 *   npm run demo:audit
 *
 * الثوابت الصارمة منها مكرّرة في demo/tests/a11y.mjs فتُفشل الدفعة عند
 * الارتداد. هذه الأداة أوسع: تصف الحال كاملًا، والاختبار يحرس الحدّ.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORK = path.join(ROOT, '.demo-work', 'audit');
const SERVE = path.join(WORK, 'serve');
const PORT = 8756;
const BASE = 'http://127.0.0.1:' + PORT + '/';

fs.mkdirSync(SERVE, { recursive: true });
fs.mkdirSync(path.join(WORK, 'shots'), { recursive: true });
/* نفس الغلاف الذي يبنيه make_public.py و mk.mjs — بلا viewport لا معنى لأي
   قياس على الهاتف. */
const body = fs.readFileSync(path.join(ROOT, 'demo/hissa-live.html'), 'utf8');
fs.writeFileSync(path.join(SERVE, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
  + body + '</body></html>');

const VIEWPORTS = [
  { k: 'phone',   w: 390,  h: 844,  touch: true },
  { k: 'tablet',  w: 768,  h: 1024, touch: true },
  { k: 'desktop', w: 1440, h: 900,  touch: false },
];
const ACCOUNTS = [
  { k: 'admin',    email: 'sysadmin@hissa.om', pw: 'Hissa#2026' },
  { k: 'finance',  email: 'maryam@hissa.om',      pw: 'Hissa#2026' },
  { k: 'investor', email: 'abdullah@example.om',  pw: 'Hissa#2026' },
  { k: 'owner',    email: 'owner.cafe@example.om', pw: 'Hissa#2026' },
];

const srv = spawn(process.execPath, [path.join(ROOT, 'demo/tools/serve.mjs'), SERVE, String(PORT)],
  { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());

/* كل ما يُقاس داخل الصفحة، في مكان واحد فلا تتفرّق التعريفات. */
const PROBE = () => {
  /* «مرئي» يعني في الشاشة فعلًا: زرّ التخطّي مثبَّت خارجها حتّى يُركَّز عليه،
     وعدّه هدفًا صغيرًا كان يقيس شيئًا لا يراه أحد. */
  const vis = e => {
    if (e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
      && r.top < innerHeight + scrollY + 4000;
  };
  const side = document.querySelector('.side');
  const bar = document.querySelector('.tabbar');
  const nav = [side, bar].find(e => e && getComputedStyle(e).display !== 'none');
  const tables = [...document.querySelectorAll('.tablewrap')]
    .filter(vis).map(w => w.scrollWidth - w.clientWidth);
  const controls = [...document.querySelectorAll('a[href],button,select,input,textarea,summary')]
    .filter(vis);
  const small = controls
    .map(e => ({ r: e.getBoundingClientRect(), t: (e.textContent || e.getAttribute('aria-label') || e.id || e.className).trim().slice(0, 28) }))
    .filter(x => x.r.width > 0 && x.r.height > 0 && x.r.height < 44);
  const unnamed = controls.filter(e => {
    if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT')
      return !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.id;
    return !(e.textContent || '').trim() && !e.getAttribute('aria-label') && !e.title;
  }).length;
  const levels = [...document.querySelectorAll('h1,h2,h3,h4')].map(h => Number(h.tagName[1]));
  let jumps = 0;
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) jumps += 1;
  const h1 = document.getElementById('pagetitle');
  return {
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
    tableOverflow: Math.max(0, ...tables, 0),
    smallTargets: small.length,
    smallest: small.slice(0, 3).map(x => x.t + ' (' + Math.round(x.r.height) + 'px)'),
    unnamed,
    headingJumps: jumps,
    h1Count: document.querySelectorAll('h1').length,
    chrome: h1 ? Math.round(h1.getBoundingClientRect().top + scrollY) : null,
  };
};

const rows = [];
const worst = {};
const note = (k, v) => { if (v != null && (worst[k] == null || v > worst[k])) worst[k] = v; };

for (const vp of VIEWPORTS) {
  for (const acct of ACCOUNTS) {
    const ctx = await b.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2,
      hasTouch: vp.touch, isMobile: vp.touch, locale: 'ar-OM',
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).split('\n')[0]));
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForTimeout(350);
    await p.click('[data-pub="login"]');
    await p.waitForTimeout(200);
    await p.fill('#lem', acct.email);
    await p.fill('#lpw', acct.pw);
    await p.click('[data-act="doLogin"]');
    await p.waitForTimeout(1500);

    const screens = await p.$$eval('a.navlink, .sheet a.navlink',
      l => [...new Set(l.map(x => x.dataset.view))]);
    /* على الهاتف القائمة الكاملة خلف «المزيد»، فتُفتح مرّة لتُقرأ */
    let all = screens;
    if (vp.touch) {
      await p.click('[data-act="moreNav"]').catch(() => {});
      await p.waitForTimeout(300);
      all = await p.$$eval('a.navlink', l => [...new Set(l.map(x => x.dataset.view))]);
      await p.click('[data-act="moreNav"]').catch(() => {});
      await p.waitForTimeout(200);
    }

    for (const v of all) {
      await p.goto(BASE + '#/' + v.replace('.', '/'), { waitUntil: 'load' });
      await p.waitForTimeout(420);
      const m = await p.evaluate(PROBE);
      rows.push(Object.assign({ vp: vp.k, acct: acct.k, view: v }, m));
      note('docOverflow', m.docOverflow);
      note('navOverflow', m.navOverflow);
      note('tableOverflow', m.tableOverflow);
      if (vp.touch) note('smallTargets', m.smallTargets);
      note('unnamed', m.unnamed);
      note('headingJumps', m.headingJumps);
      if (vp.touch) note('chrome', m.chrome);
      if (acct.k === 'admin' && ['ops.adash', 'ops.dash', 'ops.recon', 'ops.audit'].includes(v))
        await p.screenshot({ path: path.join(WORK, 'shots', vp.k + '-' + v + '.png') });
    }
    if (errs.length) rows.push({ vp: vp.k, acct: acct.k, view: '(أخطاء)', errors: errs.join(' | ') });
    await ctx.close();
  }
}

await b.close();
srv.kill();

/* ══ التقرير ══ */
const bad = rows.filter(r => r.errors
  || r.docOverflow > 0 || r.navOverflow > 0 || r.tableOverflow > 0
  || r.unnamed > 0 || r.headingJumps > 0 || r.h1Count !== 1
  || (r.vp !== 'desktop' && r.smallTargets > 0));

const lines = [];
lines.push('# تشخيص الواجهة — ' + rows.length + ' قياسًا على ' + VIEWPORTS.length
  + ' مقاسات و' + ACCOUNTS.length + ' صفات\n');
lines.push('## الأسوأ عبر كل شيء\n');
Object.keys(worst).sort().forEach(k => lines.push('- ' + k + ': ' + worst[k]));
lines.push('\n## ما يستحقّ نظرة (' + bad.length + ')\n');
if (!bad.length) lines.push('لا شيء: لا فيض، ولا تمرير في التنقّل، ولا هدف لمس صغير على الهاتف، '
  + 'ولا ضابط بلا اسم، ولا قفزة في ترتيب العناوين.');
bad.forEach(r => lines.push('- **' + r.vp + ' · ' + r.acct + ' · ' + r.view + '** — '
  + (r.errors ? 'أخطاء: ' + r.errors
    : ['docOverflow', 'navOverflow', 'tableOverflow', 'smallTargets', 'unnamed', 'headingJumps']
      .filter(k => r[k]).map(k => k + '=' + r[k]).join(' · ')
      + (r.h1Count !== 1 ? ' · h1=' + r.h1Count : '')
      + (r.smallest && r.smallest.length ? ' · ' + r.smallest.join('، ') : ''))));

fs.writeFileSync(path.join(WORK, 'report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify({ worst, rows }, null, 2));

console.log(lines.join('\n'));
console.log('\nاللقطات والتقرير في ' + path.relative(ROOT, WORK));
process.exit(bad.length ? 1 : 0);
