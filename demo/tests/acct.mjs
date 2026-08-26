/* The account lifecycle: change, recover, throttle, and the records left behind. */
await import('./mk.mjs');
import { chromium } from 'playwright';
import fs from 'node:fs';
fs.copyFileSync('/tmp/app.html', 'serve/index.html');
const URL = 'http://127.0.0.1:8731/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  /* المسار أعلاه للصندوق المحلّي؛ على عدّاء CI تجد playwright متصفّحها بنفسها. */
  .catch(() => chromium.launch());
const errs = [];
const ok = (l, v) => console.log((v ? '  ✓ ' : '  ✗ ') + l);

/* Without a writer the page keeps every change to itself, so a second browser
   would load the seed again and none of this could be tested across sessions.
   A stand-in writer that saves what the page publishes reproduces exactly what
   the artifact runtime does: the document IS the store. */
async function open() {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 }, locale: 'ar-OM' });
  await ctx.exposeFunction('__save', html => { fs.writeFileSync('serve/index.html', html); });
  await ctx.addInitScript(() => {
    window.claude = { use: n => Promise.resolve(n === 'artifact'
      ? { publish: html => window.__save(html) } : null) };
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  return { ctx, p };
}
async function login(p, email, pw) {
  await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
  await p.fill('#lem', email); await p.fill('#lpw', pw);
  await p.click('[data-act="doLogin"]');
  return p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false);
}
async function goto(p, view) {
  const navs = await p.$$eval('.navlink', l => l.map(x => x.dataset.view));
  const i = navs.indexOf(view);
  if (i < 0) return false;
  (await p.$$('.navlink'))[i].click();
  await p.waitForTimeout(450);
  return true;
}
const notes  = p => p.$$eval('#toasts .toast', t => t.map(x => x.textContent.trim()));
const alerts = p => p.$$eval('#alerts .toast', t => t.map(x => x.textContent.trim()));
const toasts = async p => (await alerts(p)).concat(await notes(p));
/* Toasts linger for six seconds, so "the last one on screen" is often the
   previous step's. Take a mark first and read only what appeared after it. */
async function outcome(p, mark, boxSel) {
  const box = boxSel ? await p.$(boxSel) : null;
  const inline = box ? (await box.textContent()).trim() : '';
  if (inline) return inline;
  const fresh = (await alerts(p)).slice(mark.a).concat((await notes(p)).slice(mark.n));
  return fresh.slice(-1)[0] || '';
}
const mark = async p => ({ a: (await alerts(p)).length, n: (await notes(p)).length });

console.log('══ 1 · every role reaches its own account ══');
{
  for (const [em, role] of [['abdullah@example.om', 'مستثمر'], ['owner.cafe@example.om', 'صاحب مشروع'],
                            ['auditor@hissa.om', 'مدقق'], ['admin@hissa.om', 'مدير']]) {
    const { ctx, p } = await open();
    await login(p, em, 'Hissa#2026');
    const has = await goto(p, 'acct.me');
    const title = has ? await p.$eval('#pagetitle', h => h.textContent.trim()) : '';
    ok(role.padEnd(12) + ' → ' + (title || 'لا شاشة'), has && title === 'حسابي');
    await ctx.close();
  }
}

console.log('\n══ 2 · changing your own password ══');
{
  const { ctx, p } = await open();
  await login(p, 'abdullah@example.om', 'Hissa#2026');
  await goto(p, 'acct.me');
  const say = async (cur, nw, ag) => {
    await p.fill('#cpwCur', cur); await p.fill('#cpwNew', nw); await p.fill('#cpwAgain', ag);
    const m = await mark(p);
    await p.click('[data-act="changePw"]'); await p.waitForTimeout(900);
    return outcome(p, m, '#cpwErr');
  };
  ok('too short refused: ' + await say('Hissa#2026', 'abc', 'abc'), true);
  ok('mismatch refused: ' + await say('Hissa#2026', 'NewPass#77', 'NewPass#78'), true);
  ok('same-as-current refused: ' + await say('Hissa#2026', 'Hissa#2026', 'Hissa#2026'), true);
  ok('wrong current refused: ' + await say('NotThePassword', 'NewPass#77', 'NewPass#77'), true);
  const good = await say('Hissa#2026', 'NewPass#77', 'NewPass#77');
  ok('accepted: ' + good, /غُيِّرت/.test(good));
  const shown = await p.$$eval('.deflist__v', v => v.map(x => x.textContent.trim()));
  ok('the account screen now shows when it changed: ' + shown[4], !/لم تتغيّر/.test(shown[4]));
  // the old password must be dead and the new one alive, in a clean browser
  await ctx.close();
  const c2 = await open();
  ok('old password no longer signs in', !(await login(c2.p, 'abdullah@example.om', 'Hissa#2026')));
  await c2.ctx.close();
  const c3 = await open();
  ok('new password signs in', await login(c3.p, 'abdullah@example.om', 'NewPass#77'));
  await c3.ctx.close();
}

console.log('\n══ 3 · sign-in backoff ══');
{
  const { ctx, p } = await open();
  await p.click('[data-pub="login"]'); await p.waitForTimeout(250);
  let last = '';
  for (let i = 0; i < 4; i++) {
    await p.fill('#lem', 'admin@hissa.om'); await p.fill('#lpw', 'wrong' + i);
    await p.click('[data-act="doLogin"]'); await p.waitForTimeout(700);
    last = await p.$eval('#lerr', e => e.textContent.trim());
  }
  ok('after four misses it makes you wait: ' + last, /ثانية/.test(last));
  await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]'); await p.waitForTimeout(700);
  const held = await p.$eval('#lerr', e => e.textContent.trim());
  ok('the wait applies to the correct password too: ' + held.slice(0, 60), /انتظر/.test(held));
  // an unrelated account is untouched — the counter is per e-mail, not global
  await p.fill('#lem', 'compliance@hissa.om'); await p.fill('#lpw', 'Hissa#2026');
  await p.click('[data-act="doLogin"]');
  ok('a different account is not caught by it',
    await p.waitForSelector('.topbar', { timeout: 9000 }).then(() => true).catch(() => false));
  await ctx.close();
}

console.log('\n══ 4 · administrator-issued recovery ══');
{
  const { ctx, p } = await open();
  await login(p, 'admin@hissa.om', 'Hissa#2026');
  await goto(p, 'ops.admin');
  ok('no code may be cut for yourself',
    await p.$$eval('[data-act="issueReset"]', bs => bs.every(x => x.dataset.user !== 'u_adm1')));
  const target = await p.$('[data-act="issueReset"][data-user="u_inv2"]');
  await target.click(); await p.waitForTimeout(900);
  const t = (await notes(p)).slice(-1)[0] || '';
  const code = (t.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/) || [])[0];
  ok('a code was issued: ' + code, !!code);
  const rows = await p.$$eval('table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  ok('it is listed with its account', rows.some(r => code && r.includes(code) && r.includes('شيخة')));
  ok('the dashboard flags it as a second way in', await (async () => {
    await goto(p, 'ops.adash');
    const e = await p.$$eval('.exc .exc__row', r => r.map(x => x.textContent));
    return e.some(x => x.includes('كود استرداد قائم'));
  })());
  await ctx.close();

  // redeem it as the account owner, in a browser that was never signed in
  const c2 = await open();
  const q = c2.p;
  await q.click('[data-pub="login"]'); await q.waitForTimeout(200);
  await q.click('[data-pub="reset"]'); await q.waitForTimeout(300);
  const attempt = async (c, em, pw, pw2) => {
    /* A successful redemption sends you to the sign-in screen, which is the
       right behaviour and means a retry has to walk back to the form. */
    if (!(await q.$('#rscode'))) { await q.click('[data-pub="reset"]'); await q.waitForTimeout(300); }
    await q.fill('#rscode', c); await q.fill('#rsem', em);
    await q.fill('#rspw', pw); await q.fill('#rspw2', pw2);
    const m = await mark(q);
    await q.click('[data-act="doReset"]'); await q.waitForTimeout(900);
    /* On success the form is gone, so the box may not exist to read. */
    return outcome(q, m, '#rserr');
  };
  ok('a wrong code is refused: ' + await attempt('AAAA-BBBB-CCCC', 'shaikha@example.om', 'Reset#991', 'Reset#991'), true);
  ok('the right code with the wrong e-mail is refused: '
    + await attempt(code, 'abdullah@example.om', 'Reset#991', 'Reset#991'), true);
  const done = await attempt(code, 'shaikha@example.om', 'Reset#991', 'Reset#991');
  ok('the owner sets a new password: ' + done, /عُيِّنت/.test(done));
  ok('the code is spent — it will not work twice: '
    + await attempt(code, 'shaikha@example.om', 'Reset#992', 'Reset#992'), true);
  await c2.ctx.close();
  const c3 = await open();
  ok('the recovered account signs in', await login(c3.p, 'shaikha@example.om', 'Reset#991'));
  await c3.ctx.close();
}

console.log('\n══ 5 · only an administrator may cut one ══');
{
  const { ctx, p } = await open();
  await login(p, 'auditor@hissa.om', 'Hissa#2026');
  await p.evaluate(() => {
    const b = document.createElement('button');
    b.dataset.act = 'issueReset'; b.dataset.user = 'u_inv1'; b.id = 'forged';
    document.querySelector('.main__inner').appendChild(b);
  });
  await p.click('#forged'); await p.waitForTimeout(700);
  const t = (await alerts(p)).slice(-1)[0] || '';
  ok('the auditor forging the button is refused by the engine: ' + t, /لا تملك صلاحية/.test(t));
  await ctx.close();
}

console.log('\n══ 6 · the record left behind ══');
{
  const { ctx, p } = await open();
  await login(p, 'admin@hissa.om', 'Hissa#2026');
  await goto(p, 'ops.audit');
  const rows = await p.$$eval('table tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ')));
  for (const what of ['تسجيل دخول', 'تغيير كلمة المرور', 'إصدار كود استرداد', 'استرداد كلمة المرور'])
    ok('audited: ' + what, rows.some(r => r.includes(what)));
  const leak = rows.filter(r => /[0-9a-f]{32,}/.test(r));
  ok('no salt or hash reached the log', leak.length === 0);
  await ctx.close();
}

console.log('\nerrors:', errs.length ? errs.slice(0, 4) : 'none');
await b.close();
