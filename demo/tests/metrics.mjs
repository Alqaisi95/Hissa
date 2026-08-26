/* المرحلة ١ من طبقة METRICS — معايير القبول التسعة.
 *
 * الاختبار يرفع الطبقة نفسها من الملف المشحون ويُشغّلها في نطاق واحد، بنمط
 * prop.mjs: ما يُختبر هو الكود الذي يُشحن، لا نسخة منه تنحرف عنه بصمت.
 *
 * ما يُرفع حقيقيًّا: كتلة METRICS كاملة، ومعها الدوالّ التي تعتمد عليها
 * (proRata · can · settingSet · ceilingOf · moneyPosition · auditIntegrity ·
 * DUAL). وما يُستبدل ببديل مصرَّح به: طبقة العرض (esc · dt · columnsSvg) و
 * checkApplication — لأن أيًّا منها ليس موضع الادعاء هنا، والبديل مُعلَن في
 * الإخراج فلا يُقرأ نجاحٌ على حساب تغطية لم تحدث.
 *
 *   node demo/tests/metrics.mjs
 */
import fs from 'node:fs';

const SRC = fs.readFileSync('demo/hissa-live.html', 'utf8');

/* ══ رفع الطبقة ودوالّها ═════════════════════════════════════════════════ */
const grab = (re, what) => {
  const m = SRC.match(re);
  if (!m) throw new Error('تعذّر رفع ' + what + ' من الملف المشحون');
  return m[0];
};

const METRICS = SRC.slice(
  SRC.indexOf('/* ── the five bases, in one place ──'),
  SRC.indexOf('/* ══ end METRICS'));

const DEPS = [
  grab(/const COUNTED  = new Set\(\[[^\]]*\]\);/, 'COUNTED'),
  grab(/const DAY = \d+;/, 'DAY'),
  grab(/function proRata\(total, weights\) \{[\s\S]*?\n\}/, 'proRata'),
  grab(/function h64\(str\) \{[\s\S]*?\n\}/, 'h64'),
  grab(/function can\(u, perm\) \{[\s\S]*?\n\}/, 'can'),
  grab(/function settingSet\(st, key, value\) \{[\s\S]*?\n\}/, 'settingSet'),
  grab(/const ceilingOf = \(p, s\) => [^;]+;/, 'ceilingOf'),
  grab(/const allocatedOf = [^;]+;/, 'allocatedOf'),
  grab(/function moneyPosition\(\) \{[\s\S]*?\n\}/, 'moneyPosition'),
  grab(/function auditIntegrity\(\) \{[\s\S]*?\n\}/, 'auditIntegrity'),
  grab(/const DUAL = \{[\s\S]*?\n\};/, 'DUAL'),
  grab(/const dualOpen = [\s\S]*?;\n/, 'dualOpen'),
].join('\n\n');

/* البدائل المصرَّح بها — طبقة العرض وحدها، ولا سيلكتور يعتمد عليها في رقم. */
const STUBS = `
  let STATE = null;
  const user = id => STATE.users.find(u => u.id === id);
  const esc = s => String(s == null ? '' : s);
  const dt = () => '';
  const fmt = v => String(v);
  const CAT = ['a', 'b', 'c', 'd', 'e'];
  const columnsSvg = () => '<svg></svg>';
  const checkApplication = () => ({ ok: true, bad: [] });
`;

const LAYER = new Function(`
  ${STUBS}
  ${DEPS}
  ${METRICS}
  return {
    setState: s => { STATE = s; },
    BASE, metricsParams, settingsAt, distributionShares, ceilingOf, proRata,
    DUAL, dualOpen, moneyPosition,
    builds: () => _baseBuilds,
    sel: {
      selInvestedCapital, selHoldingsByPool, selDistributionsReceived,
      selCurrentValue, selNetReturn, selRemainingAllowance, selCoolingOffState,
      selFundingProgress, selInvestorCount, selTicketStats,
      selDisbursementLedger, selReconciliationStatus, selFeesAccrued,
      selMyApprovalQueue, selPendingDisbursements, selKycQueue, selOpenCases,
      selApplicationsUnderReview, selPendingSettingProposals, selOpenVariances,
      selPlatformAum, selActivePools, selActiveUsers, selFeeRevenue,
      selConversionFunnel, selPoolHealth, selAuditIntegrity, selActivityByType,
    },
  };
`)();

/* حالة البذرة كما تُشحن، ومعها العدّاد الذي تضيفه migrateState. */
const SEED = (() => {
  const i = SRC.indexOf('<script id="appstate"');
  const raw = SRC.slice(SRC.indexOf('>', i) + 1, SRC.indexOf('</scr' + 'ipt>', i));
  const st = JSON.parse(raw);
  st.version = 0;
  ['users', 'pools', 'orders', 'disbursements', 'distributions', 'reports', 'cases',
   'audit', 'applications', 'invites', 'settingProposals', 'settingsHistory',
   'resets', 'reconciliations'].forEach(k => { if (!Array.isArray(st[k])) st[k] = []; });
  return st;
})();
const clone = s => JSON.parse(JSON.stringify(s));

const EMPTY = {
  version: 0, schema: 6,
  settings: clone(SEED.settings),
  users: [], pools: [], orders: [], disbursements: [], distributions: [], reports: [],
  cases: [], audit: [], applications: [], invites: [], settingProposals: [],
  settingsHistory: [], resets: [], reconciliations: [],
};

const NOW = Date.parse('2026-08-26T12:00:00Z');
const P = extra => Object.assign({ now: NOW }, extra || {});
const S = id => ({ authUserId: id });

/* ══ عدّاد ═══════════════════════════════════════════════════════════════ */
let pass = 0; const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const head = t => console.log('\n══ ' + t + ' ══');

LAYER.setState(SEED);
const base = LAYER.BASE(SEED);

/* ── ١ · لا حساب عشري يتسرّب من الطبقة ─────────────────────────────────── */
head('١ · الطبقة خالية من الحساب العشري');
{
  const block = SRC.slice(SRC.indexOf('║  METRICS'), SRC.indexOf('/* ══ end METRICS'));
  ok('لا toFixed داخل METRICS', !block.includes('toFixed'));
  ok('لا parseFloat داخل METRICS', !block.includes('parseFloat'));
}

/* ── ٢ · proRata يجمع إلى الإجمالي بالضبط ──────────────────────────────── */
head('٢ · proRata على ١٠٠٠ حالة عشوائية');
{
  let seed = 20260827;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const ri = n => Math.floor(rnd() * n);
  let bad = 0, sawZero = 0, sawSingle = 0;
  for (let t = 0; t < 1000; t += 1) {
    const n = t % 7 === 0 ? 1 : 1 + ri(10);
    if (n === 1) sawSingle += 1;
    const w = Array.from({ length: n }, () => (ri(5) === 0 ? (sawZero += 1, 0) : 1 + ri(9_000_000)));
    const total = 1 + ri(300_000_000);
    const parts = LAYER.proRata(total, w);
    const sum = parts.reduce((a, b) => a + b, 0);
    if (w.some(x => x > 0) && sum !== total) bad += 1;
    if (parts.some(x => !Number.isInteger(x) || x < 0)) bad += 1;
    if (parts.some((x, i) => w[i] === 0 && x !== 0)) bad += 1;
  }
  ok('المجموع يساوي الإجمالي بالضبط في كل الحالات', bad === 0, bad + ' حالة مخالفة');
  ok('شملت أوزانًا صفرية', sawZero > 0, String(sawZero));
  ok('شملت وزنًا واحدًا', sawSingle > 0, String(sawSingle));
}

/* ── ٣ · ممنوع الصلاحية ⇒ undefined لا صفر ─────────────────────────────── */
head('٣ · undefined ≠ صفر');
{
  const noPerm = S('u_inv1');                 // مستثمر: لا dashboard.read ولا audit.read
  const gated = ['selPlatformAum', 'selFeeRevenue', 'selActivePools', 'selPoolHealth',
                 'selConversionFunnel', 'selAuditIntegrity', 'selActivityByType',
                 'selPendingDisbursements', 'selKycQueue', 'selOpenCases',
                 'selPendingSettingProposals', 'selOpenVariances'];
  const wrong = gated.filter(k => LAYER.sel[k](base, noPerm, P()) !== undefined);
  ok('كل سيلكتور خلف صلاحية يُرجع undefined لمن لا يملكها', wrong.length === 0, wrong.join('، '));

  const admin = S('u_adm_omar');
  ok('ويُرجع قيمة فعلية لمن يملكها', LAYER.sel.selPlatformAum(base, admin, P()) !== undefined);

  /* والفرق الذي تقوم عليه القاعدة: لا بيانات ⇒ صفر، والبطاقة تُرسم. */
  LAYER.setState(EMPTY);
  const eb = LAYER.BASE(EMPTY);
  const aumEmpty = LAYER.sel.selPlatformAum(eb, S('u_adm_omar'), P());
  ok('حساب غير موجود في قاعدة فارغة ⇒ undefined', aumEmpty === undefined);
  LAYER.setState(SEED);
}

/* ── ٤ · لا وصول إلى محفظة غيرك بأي وسيط ───────────────────────────────── */
head('٤ · عزل المحافظ');
{
  const a = LAYER.sel.selInvestedCapital(base, S('u_inv1'), P());
  const b = LAYER.sel.selInvestedCapital(base, S('u_inv4'), P());
  ok('حسابان مختلفان يعطيان رقمين مختلفين', a !== b, `${a} / ${b}`);

  /* كل محاولة لتمرير هوية أخرى عبر params يجب أن تُتجاهَل تمامًا. */
  const attempts = [
    { userId: 'u_inv4' }, { authUserId: 'u_inv4' }, { subject: 'u_inv4' },
    { id: 'u_inv4' }, { user: 'u_inv4' },
  ];
  const leaked = attempts.filter(x =>
    LAYER.sel.selInvestedCapital(base, S('u_inv1'), P(x)) !== a);
  ok('لا وسيط في params يغيّر صاحب المحفظة', leaked.length === 0, JSON.stringify(leaked));

  const hA = LAYER.sel.selHoldingsByPool(base, S('u_inv1'), P());
  const leakedH = attempts.filter(x =>
    JSON.stringify(LAYER.sel.selHoldingsByPool(base, S('u_inv1'), P(x))) !== JSON.stringify(hA));
  ok('والحيازات كذلك', leakedH.length === 0);

  ok('جلسة بلا حساب ⇒ undefined', LAYER.sel.selInvestedCapital(base, S(null), P()) === undefined);
}

/* ── ٥ · الطابور لا يعرض ما سترفضه ACTS ────────────────────────────────── */
head('٥ · تقاطع الطابور مع الرقابة الثنائية');
{
  /* حالة مبنيّة لتضع الأشخاص على طرفَي كل قاعدة من الثلاث. */
  const st = clone(SEED);
  st.disbursements.push({ id: 'DSB-T-1', poolId: 'p_log', milestoneId: 'm3', amount: 500000,
    status: 'requested', requestedBy: 'u_fin2', requestedAt: '2026-08-20T08:00:00Z',
    approvedBy: null, approvedAt: null, evidence: 'اختبار' });
  st.settingProposals.push({ id: 'SET-T-1', key: 'minTicket', before: 100000, value: 200000,
    reason: 'اختبار', effectiveFrom: '2026-09-01', status: 'pending',
    proposedBy: 'u_adm1', proposedAt: '2026-08-21T08:00:00Z', decidedBy: null, decidedAt: null });
  st.reconciliations.push({ id: 'REC-T-1', periodFrom: '2026-08-01', periodTo: '2026-08-26',
    openingBalance: 0, closingBalance: 0, lines: [], rejected: [], matched: [], breaks: [],
    status: 'prepared', preparedBy: 'u_fin1', preparedAt: '2026-08-22T08:00:00Z',
    signedBy: null, signedAt: null });
  st.version = SEED.version + 1;
  LAYER.setState(st);
  const b2 = LAYER.BASE(st);

  const rows = { disbursement: st.disbursements, settingProposal: st.settingProposals,
                 reconciliation: st.reconciliations };
  const pick = { disbursement: 'DSB-T-1', settingProposal: 'SET-T-1', reconciliation: 'REC-T-1' };
  const parties = { disbursement: 'u_fin2', settingProposal: 'u_adm1', reconciliation: 'u_fin1' };

  /* المشارك في المعاملة لا يراها في طابوره إطلاقًا. */
  const selfSees = Object.keys(pick).filter(kind => {
    const q = LAYER.sel.selMyApprovalQueue(b2, S(parties[kind]), P()) || [];
    return q.some(x => x.id === pick[kind]);
  });
  ok('الطرف نفسه لا يرى معاملته في طابوره', selfSees.length === 0, selfSees.join('، '));

  /* والطرف الثاني يراها — وإلا صار الاختبار يمرّ بطابور فارغ دائمًا. */
  const second = { disbursement: 'u_fin1', settingProposal: 'u_adm_omar', reconciliation: 'u_fin2' };
  const secondMisses = Object.keys(pick).filter(kind => {
    const q = LAYER.sel.selMyApprovalQueue(b2, S(second[kind]), P()) || [];
    return !q.some(x => x.id === pick[kind]);
  });
  ok('والطرف الثاني المؤهَّل يراها', secondMisses.length === 0, secondMisses.join('، '));

  /* التقاطع الحقيقي: كل صف معروض يجب أن يجتاز نفس مُسنِدَي ACTS. */
  let offered = 0, wouldReject = 0;
  ['u_fin1', 'u_fin2', 'u_adm1', 'u_adm_omar', 'u_pf1', 'u_cmp1', 'u_aud1'].forEach(uid => {
    (LAYER.sel.selMyApprovalQueue(b2, S(uid), P()) || []).forEach(item => {
      offered += 1;
      const row = rows[item.kind].find(r => r.id === item.id);
      if (!LAYER.dualOpen(item.kind, row, uid)) wouldReject += 1;
    });
  });
  ok('لا صفّ معروض ترفضه مُسنِدات ACTS', wouldReject === 0, `${wouldReject} من ${offered}`);
  ok('والطابور ليس فارغًا فيمرّ الاختبار مجانًا', offered > 0, String(offered));

  /* ولا يُعرض صفّ لحساب لا يملك صلاحية الاعتماد أصلًا. */
  const investorQ = LAYER.sel.selMyApprovalQueue(b2, S('u_inv1'), P());
  ok('مستثمر لا يرى طابور اعتماد', Array.isArray(investorQ) && investorQ.length === 0);

  LAYER.setState(SEED);
  LAYER.BASE(SEED);
}

/* ── ٦ · BASE تُبنى مرّة واحدة لكل version ─────────────────────────────── */
head('٦ · بناء واحد لكل نسخة حالة');
{
  const st = clone(SEED); st.version = 900;
  LAYER.setState(st);
  const before = LAYER.builds();
  for (let i = 0; i < 40; i += 1) LAYER.BASE(st);          // أربعون بطاقة
  const afterCards = LAYER.builds();
  ok('أربعون استدعاءً ⇒ بناء واحد', afterCards - before === 1, String(afterCards - before));

  const st2 = clone(st); st2.version = 901;                // إجراء واحد
  LAYER.setState(st2);
  for (let i = 0; i < 40; i += 1) LAYER.BASE(st2);
  ok('نسخة جديدة ⇒ بناء واحد آخر', LAYER.builds() - afterCards === 1,
     String(LAYER.builds() - afterCards));
  LAYER.setState(SEED); LAYER.BASE(SEED);
}

/* ── ٧ · طبقة قراءة بحتة ───────────────────────────────────────────────── */
head('٧ · لا كتابة في الحالة');
{
  const block = SRC.slice(SRC.indexOf('║  METRICS'), SRC.indexOf('/* ══ end METRICS'));
  const writes = block.match(/\bst(?:ate)?\.\w+\s*=(?!=)/g) || [];
  ok('لا إسناد إلى الحالة داخل الطبقة', writes.length === 0, writes.join('، '));

  const snapshot = JSON.stringify(SEED);
  Object.keys(LAYER.sel).forEach(k => {
    try { LAYER.sel[k](base, S('u_adm_omar'), P({ poolId: 'p_log' })); } catch (e) { /* ٨ يمسكها */ }
  });
  ok('وتشغيل كل السيلكتورات لا يغيّر بايتًا من الحالة', JSON.stringify(SEED) === snapshot);
}

/* ── ٨ · قاعدة فارغة تمامًا ────────────────────────────────────────────── */
head('٨ · كل سيلكتور على قاعدة فارغة');
{
  LAYER.setState(EMPTY);
  const eb = LAYER.BASE(EMPTY);
  const broke = [];
  ['u_adm_omar', null].forEach(uid => {
    Object.keys(LAYER.sel).forEach(k => {
      try { LAYER.sel[k](eb, S(uid), P({ poolId: 'p_none' })); }
      catch (e) { broke.push(k + '(' + uid + '): ' + e.message); }
    });
  });
  ok('لا سيلكتور يرمي على قاعدة فارغة', broke.length === 0, broke.slice(0, 3).join(' | '));

  /* وحساب موجود بلا بيانات: صفر لا undefined — البطاقة تُرسم فارغة. */
  const st = clone(EMPTY);
  st.users.push({ id: 'u_x', name: 'حساب', role: 'staff', job: 'system_admin',
    perms: ['dashboard.read', 'audit.read'] });
  LAYER.setState(st);
  const b3 = LAYER.BASE(st);
  const aum = LAYER.sel.selPlatformAum(b3, S('u_x'), P());
  ok('حساب مخوَّل بلا بيانات ⇒ صفر لا undefined', aum !== undefined && aum.total === 0,
     JSON.stringify(aum));
  const funnel = LAYER.sel.selConversionFunnel(b3, S('u_x'), P());
  ok('والقمع يُرجع مراحله بأصفار', Array.isArray(funnel) && funnel.length === 4
     && funnel.every(s => s.value === 0));
  LAYER.setState(SEED); LAYER.BASE(SEED);
}

/* ── ٩ · إعداد قديم يُنتج رقمًا مختلفًا عبر settingsAt ──────────────────── */
head('٩ · التسعير بإعدادات وقتها');
{
  const st = clone(SEED);
  /* رسم المنصّة كان ٢٪ حتى مطلع أغسطس ثم صار ٤٪. p_log أُغلقت في مايو. */
  st.settings.feeBps.platform = 400;
  st.settingsHistory.push({ key: 'feeBps.platform', before: 200, after: 400,
    effectiveFrom: '2026-08-01', reason: 'اختبار', proposedBy: 'u_adm1',
    approvedBy: 'u_adm_omar', at: '2026-08-01T00:00:00Z' });
  st.version = 950;
  LAYER.setState(st);
  const b4 = LAYER.BASE(st);

  const then = LAYER.settingsAt(st, '2026-05-14');
  const now = LAYER.settingsAt(st, '2026-08-26');
  ok('settingsAt ترجع القيمة السارية وقتها', then.feeBps.platform === 200, String(then.feeBps.platform));
  ok('وتعطي القيمة الحالية للحظة حالية', now.feeBps.platform === 400, String(now.feeBps.platform));

  const fees = LAYER.sel.selFeesAccrued(b4, S('u_own2'), P({ poolId: 'p_log' }));
  const naive = Math.floor((fees.allocated * 400) / 10000);
  ok('رسم فرصة أُغلقت في مايو يُحتسب بـ٢٪ لا ٤٪',
     fees.platform === Math.floor((fees.allocated * 200) / 10000) && fees.platform !== naive,
     `platform=${fees.platform} naive=${naive} allocated=${fees.allocated}`);
  LAYER.setState(SEED); LAYER.BASE(SEED);
}

/* ── إضافي · التصحيحات التي كشفتها المواصفة ────────────────────────────── */
head('إضافي · سقف الاكتتاب ونافذة الحدّ');
{
  const p = base.poolsById.get('p_cafe');
  const cap = LAYER.ceilingOf(p, SEED.settings);
  ok('السقف ١٢٠٪ من الهدف لا الهدف زائد ١٢٠٪', cap === 78_000_000, String(cap));

  const fp = LAYER.sel.selFundingProgress(base, S('u_own1'), P({ poolId: 'p_cafe' }));
  ok('وتقدّم التمويل يستعمل نفس السقف', fp.overfundCap === 78_000_000, String(fp.overfundCap));
  ok('المتّسع = السقف ناقص المجموع', fp.headroom === Math.max(0, 78_000_000 - fp.raised));
  ok('ومالك آخر لا يرى الفرصة', LAYER.sel.selFundingProgress(base, S('u_own2'), P({ poolId: 'p_cafe' })) === undefined);

  /* نافذة الاثني عشر شهرًا: التزام أقدم من سنة يخرج من العدّ. */
  const st = clone(SEED);
  st.orders.push({ id: 'ORD-OLD', poolId: 'p_cafe', userId: 'u_inv1', amount: 5_000_000,
    status: 'confirmed', createdAt: '2024-01-01T00:00:00Z' });
  st.version = 960;
  LAYER.setState(st);
  const b5 = LAYER.BASE(st);
  const a1 = LAYER.sel.selRemainingAllowance(b5, S('u_inv1'), P());
  const a0 = LAYER.sel.selRemainingAllowance(base, S('u_inv1'), P());
  ok('التزام عمره سنتان لا يستهلك من حدّ الاثني عشر شهرًا', a1.used === a0.used,
     `${a1.used} مقابل ${a0.used}`);
  ok('والنافذة معلَنة مع الرقم', a1.window === 'ROLLING_12M');
  ok('و«بلا حدّ منشور» تُرجع null لا صفرًا',
     LAYER.sel.selRemainingAllowance(b5, S('u_inv4'), P()).remaining === null);
  LAYER.setState(SEED); LAYER.BASE(SEED);
}

head('إضافي · حصص توزيعة مزروعة بلا shares');
{
  const d = SEED.distributions[0];
  ok('البذرة فعلًا بلا مصفوفة حصص', !Array.isArray(d.shares) || !d.shares.length);
  const shares = LAYER.distributionShares(SEED, d);
  const sum = shares.reduce((s, x) => s + x.amount, 0);
  ok('تُقسَّم عند القراءة بـproRata', shares.length > 0);
  ok('ومجموع الحصص يساوي الإجمالي بالضبط', sum === d.gross, `${sum} / ${d.gross}`);

  const got = LAYER.sel.selDistributionsReceived(base, S('u_inv4'), P());
  ok('فالمستثمر يرى ما وصله لا صفرًا', got.total > 0, JSON.stringify(got.total));
}

head('إضافي · النسب تخرج bps صحيحة');
{
  const funnel = LAYER.sel.selConversionFunnel(base, S('u_adm_omar'), P());
  const bad = funnel.filter(s => !Number.isInteger(s.fromPrevBps) || !Number.isInteger(s.fromBaseBps));
  ok('كل نسبة عدد صحيح بالنقاط الأساسية', bad.length === 0, JSON.stringify(bad));
  ok('والأساس ١٠٠٠٠', funnel[0].fromPrevBps === 10000);

  const ret = LAYER.sel.selNetReturn(base, S('u_inv4'), P());
  ok('العائد يحمل أساسه معه', ret.basis === 'COST', ret.basis);
  ok('وكل مبالغه أعداد صحيحة',
     [ret.cost, ret.received, ret.value, ret.gain, ret.bps].every(Number.isInteger));
}

/* ══ الخلاصة ═════════════════════════════════════════════════════════════ */
console.log('\n' + '─'.repeat(58));
console.log(`مرفوع من الملف: كتلة METRICS + ${DEPS.split('\n\n').length} دوالّ تعتمد عليها`);
console.log('مُستبدَل ببديل مصرَّح: esc · dt · fmt · columnsSvg · checkApplication');
console.log(`${pass} تحقّقًا ناجحًا · ${fails.length} فاشلًا`);
if (fails.length) { fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('المرحلة ١ تجتاز معايير القبول التسعة.');
