/* يولّد أيقونات التطبيق في demo/pwa/icons/ باستخدام Chromium الموجود أصلًا
 * للاختبارات — بلا أي تبعية جديدة.
 *
 * العلامة هندسية بحتة، بلا حرف واحد: أيقونة تعتمد على خط عربي تُصبح مربّعات
 * فارغة على أي جهاز لا يحمله، وهذه أيقونة تُرسَم مرة وتُعرض في كل مكان.
 * وما تعرضه هو المنتج نفسه: حلقة مقسومة حصصًا غير متساوية، حصةٌ منها مميَّزة.
 *
 *   node demo/tools/make_icons.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'demo/pwa/icons';
const BRAND = '#0d5c58';
const SHARES = [
  { f: 0.38, c: '#ffffff' },
  { f: 0.26, c: '#d5a05c' },   // الحصة المميَّزة
  { f: 0.21, c: '#9fd2cd' },
  { f: 0.15, c: '#5aa9a3' },
];

/* `inset` هو هامش الأمان: أيقونة maskable تُقصّ دائريًا على بعض الأنظمة،
   فيجب أن يقع كل المعنى داخل ٨٠٪ الوسطى. */
function svg(size, inset) {
  const cx = size / 2;
  const usable = size * (1 - inset * 2);
  const r = usable * 0.34;
  const sw = usable * 0.20;
  const C = 2 * Math.PI * r;
  const gap = C * 0.022;
  let acc = 0;
  const arcs = SHARES.map(s => {
    const len = Math.max(0, s.f * C - gap);
    const seg = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${s.c}"`
      + ` stroke-width="${sw}" stroke-linecap="butt"`
      + ` stroke-dasharray="${len} ${C - len}"`
      + ` stroke-dashoffset="${-acc * C}"`
      + ` transform="rotate(-90 ${cx} ${cx})"/>`;
    acc += s.f;
    return seg;
  }).join('');
  /* مربّعة بحوافّ حادّة عمدًا: أندرويد وiOS يقصّان الأيقونة بشكلهما الخاص،
     فتدوير الحواف هنا يعني تدويرًا مضاعفًا وحوافّ مقضومة. */
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="${BRAND}"/>`
    + arcs
    + `</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.1 },
];

fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ deviceScaleFactor: 1 });
const p = await ctx.newPage();

for (const t of TARGETS) {
  await p.setViewportSize({ width: t.size, height: t.size });
  await p.setContent(`<style>html,body{margin:0;padding:0;background:${BRAND}}</style>`
    + svg(t.size, t.inset), { waitUntil: 'load' });
  await p.screenshot({ path: path.join(OUT, t.file), omitBackground: false });
  console.log('  ' + t.file + ' · ' + t.size + '×' + t.size
    + (t.inset ? ' · هامش أمان ' + (t.inset * 100) + '٪' : ''));
}
/* نسخة SVG تُحفظ للمرجع ولأي حجم مستقبلي */
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(512, 0));
await b.close();
console.log('تمّ توليد الأيقونات في ' + OUT);
