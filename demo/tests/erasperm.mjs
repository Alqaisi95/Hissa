await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
const p = await (await b.newContext({ viewport:{width:1400,height:1000}, locale:'ar-OM' })).newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8731/', { waitUntil:'load' }); await p.waitForTimeout(400);
await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
await p.fill('#lem','auditor@hissa.om'); await p.fill('#lpw','Hissa#2026');
await p.click('[data-act="doLogin"]');
await p.waitForSelector('.topbar',{timeout:9000}); await p.waitForTimeout(400);
await p.evaluate(() => {
  const b=document.createElement('button');
  b.dataset.act='erasePerson'; b.dataset.user='u_inv2'; b.id='forged';
  document.querySelector('.main__inner').appendChild(b);
});
await p.click('#forged'); await p.waitForTimeout(700);
const a = await p.$$eval('#alerts .toast', t=>t.map(x=>x.textContent.trim()));
console.log((/لا تملك صلاحية/.test(a.slice(-1)[0]||'') ? '  ✓ ' : '  ✗ ')
  + 'المدقق يزرع زر الطمس فيرفضه المحرك: ' + (a.slice(-1)[0]||'(لا شيء)'));
console.log('errors:', errs.length?errs:'none');
await b.close();
