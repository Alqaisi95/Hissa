/* عدّاء الاختبارات.
 *
 * سبب وجوده: كل مُشغِّل في هذا المجلد كُتب ليعمل داخل مجلد عملٍ يحتوي
 * `hissa-demo.html` و`serve/`، فكان يُشغَّل يدويًّا من مكان غير المستودع ولا
 * يعمل من جذره. فبدل تعديل ثمانية مُشغِّلات، يُهيّئ هذا الملف ذلك المجلد
 * ويشغّلها فيه.
 *
 * ومجلد العمل داخل المستودع لا في /tmp عمدًا: Node يحلّ `playwright` بصعوده
 * من موضع الملف، فمجلد في /tmp لا يجد node_modules ويفشل الاستيراد.
 *
 *   node demo/tests/run.mjs           كل الاختبارات
 *   node demo/tests/run.mjs pwa adash   اختبارات بعينها
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORK = path.join(ROOT, '.demo-work');
const PORT = 8731;

/* المُشغِّلات التي تحتاج مجلد العمل والخادم، بترتيب التكلفة */
const BROWSER = ['route', 'adash', 'recon', 'omaradmin', 'mig', 'erasperm', 'a11y', 'rt4', 'rights', 'acct', 'prop'];
/* ومُشغِّلات تعمل من جذر المستودع مباشرة */
const ROOTED = ['pwa'];

const want = process.argv.slice(2);
const pick = list => (want.length ? list.filter(n => want.includes(n)) : list);

function prepare() {
  fs.mkdirSync(path.join(WORK, 'serve'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'demo/hissa-live.html'), path.join(WORK, 'hissa-demo.html'));
  for (const f of fs.readdirSync(path.join(ROOT, 'demo/tests'))) {
    if (f.endsWith('.mjs') && f !== 'run.mjs') {
      fs.copyFileSync(path.join(ROOT, 'demo/tests', f), path.join(WORK, f));
    }
  }
  /* حالات الهجرة التي يقرؤها mig.mjs */
  for (const f of ['state.ancient.json', 'state.gutted.json']) {
    const src = path.join(ROOT, 'demo/tests/fixtures', f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WORK, f));
  }
}

const results = [];
/* المسار صريح: مُشغِّلات مجلد العمل مسطَّحة بجانب الحالة، والمُشغِّلات
   الجذرية تبقى في مكانها وتعمل من جذر المستودع. */
function run(name, script, cwd) {
  process.stdout.write('\n════ ' + name + '\n');
  const r = spawnSync(process.execPath, [script], { cwd, stdio: 'inherit', timeout: 600000 });
  results.push({ name, ok: r.status === 0 });
  return r.status === 0;
}

const browser = pick(BROWSER);
const rooted = pick(ROOTED);

if (browser.length) {
  prepare();
  const srv = spawn(process.execPath, [path.join(ROOT, 'demo/tools/serve.mjs'),
    path.join(WORK, 'serve'), String(PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  try {
    for (const n of browser) {
      if (!fs.existsSync(path.join(WORK, n + '.mjs'))) {
        console.log('\n════ ' + n + '\n  (غير موجود — يُتخطّى)');
        continue;
      }
      run(n, n + '.mjs', WORK);
    }
  } finally { srv.kill(); }
}
for (const n of rooted) {
  if (fs.existsSync(path.join(ROOT, 'demo/tests', n + '.mjs')))
    run(n, path.join('demo/tests', n + '.mjs'), ROOT);
}

const failed = results.filter(r => !r.ok);
console.log('\n════════════════════════════════════');
results.forEach(r => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name));
console.log(failed.length ? '\n✗ ' + failed.length + ' من ' + results.length + ' فشل\n'
                          : '\n✓ ' + results.length + ' اختبارًا — كلها خضراء\n');
process.exit(failed.length ? 1 : 0);
