import { chromium } from 'playwright';
import fs from 'node:fs';
const page = fs.readFileSync('hissa-demo.html', 'utf8');
const wrap = st => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${
  page.replace(/<script id="appstate" type="application\/json">[\s\S]*?<\/script>/,
    '<script id="appstate" type="application/json">' + st + '</' + 'script>')}</body></html>`;
fs.writeFileSync('serve/ancient.html', wrap(fs.readFileSync('state.ancient.json', 'utf8')));
fs.writeFileSync('serve/gutted.html',  wrap(fs.readFileSync('state.gutted.json', 'utf8')));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
for (const [name, file] of [['ancient (the previously published shape)', 'ancient.html'],
                            ['gutted  (every assumed field removed)', 'gutted.html']]) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ar-OM' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|404|ERR_/i.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8731/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  console.log('\n══ ' + name + ' ══');
  console.log('  public site renders:', !!(await p.$('.hero')));
  // walk every staff screen on the migrated state
  await p.click('[data-pub="login"]'); await p.waitForTimeout(200);
  await p.fill('#lem', 'admin@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]');
  const ok = await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
  console.log('  signs in:', ok);
  if (ok) {
    /* Land on the administration dashboard and let it settle. The first
       version of this check read the DOM straight after sign-in, caught it
       mid-render, and reported "nothing needed filling" against a state that
       demonstrably needed it — the test was wrong, not the migration. */
    await p.click('[data-view="ops.adash"]');
    await p.waitForSelector('#pagetitle', { timeout: 5000 });
    await p.waitForTimeout(400);
    /* Read the whole row, not one span: the headline lives in .exc__what and
       the explanation in .exc__why, and searching only the latter for a word
       from the former is how this check came back empty on a state that had
       plainly been migrated. */
    const rows = await p.$$eval('.exc .exc__row', w => w.map(x => x.textContent.replace(/\s+/g, ' ')));
    const migrated = rows.find(t => t.includes('رُقِّعت')) || '';
    const tail = await p.$$eval('p.xs.muted', w => w.map(x => x.textContent)
      .filter(t => /بندًا آخر/.test(t)));
    console.log('  exception rows shown:', rows.length, tail.length ? '· ' + tail[0].trim() : '');
    console.log('  migration reported:',
      migrated ? 'row ' + (rows.indexOf(migrated) + 1) + ' — ' + migrated.trim().slice(0, 100)
               : '*** NOT SHOWN ***');
    const n = await p.$$eval('.navlink', l => l.length);
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const links = await p.$$('.navlink');
      await links[i].click(); await p.waitForTimeout(220);
      if (!(await p.$('h1'))) bad++;
    }
    console.log(`  walked ${n} screens · broken: ${bad}`);
  }
  console.log('  errors:', errs.length ? errs.slice(0, 3) : 'none');
  await ctx.close();
}
await b.close();
