/**
 * The maker side of the money desk (FR-402, FR-404, FR-407).
 *
 * Everything here creates a request; nothing here approves one. That separation
 * is the point: the same person can prepare a movement and can approve a
 * colleague's, but never their own, and the screens say so where it matters.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, Money, StatusBadge,
} from '../../components/ui.tsx';

export function FundsCreate() {
  const { locale } = useI18n();
  const pools = useQuery<any>('/pools?status=all&limit=50');
  const [poolId, setPoolId] = useState('');

  const selectable = (pools.data?.items ?? []);
  const pool = selectable.find((p: any) => p.id === poolId);

  return (
    <div className="stack">
      <Card title={locale === 'ar' ? 'اختر الفرصة' : 'Select a pool'}>
        {pools.loading ? <Loading rows={2} /> : (
          <Field label={locale === 'ar' ? 'الفرصة' : 'Pool'} htmlFor="fpool">
            <select id="fpool" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
              <option value="">—</option>
              {selectable.map((p: any) => (
                <option key={p.id} value={p.id}>{p.reference} — {p.title_ar}</option>
              ))}
            </select>
          </Field>
        )}
      </Card>

      {pool ? (
        <>
          <EscrowPosition poolId={pool.id} />
          <DisbursementForm poolId={pool.id} poolStatus={pool.status} />
          <DistributionForm poolId={pool.id} poolStatus={pool.status} />
        </>
      ) : (
        <Card><Empty>{locale === 'ar' ? 'اختر فرصة لعرض حركاتها المالية.' : 'Select a pool to work its money movements.'}</Empty></Card>
      )}

      <ReconciliationPanel />
    </div>
  );
}

/* ── FR-401: the escrow view — external references, never an internal balance ─ */

function EscrowPosition({ poolId }: { poolId: string }) {
  const { locale } = useI18n();
  const position = useQuery<any>(`/funds/pools/${poolId}/position`, [poolId]);

  if (position.loading) return <Loading rows={3} />;
  if (!position.data) return null;
  const d = position.data;

  return (
    <Card title={locale === 'ar' ? 'وضع حساب الضمان' : 'Escrow position'}
          actions={<Badge tone="info" >{d.escrowAccountRef ?? '—'}</Badge>}>
      <div className="grid grid--stats">
        <div className="stat">
          <div className="stat__label">{locale === 'ar' ? 'التزامات مؤكدة' : 'Confirmed commitments'}</div>
          <div className="stat__value"><Money baisa={d.commitments.confirmed} decimals={0} /></div>
        </div>
        <div className="stat">
          <div className="stat__label">{locale === 'ar' ? 'محصّل فعليًا' : 'Actually collected'}</div>
          <div className="stat__value"><Money baisa={d.external.settledCollections} decimals={0} /></div>
        </div>
        <div className="stat">
          <div className="stat__label">{locale === 'ar' ? 'مصروف' : 'Disbursed'}</div>
          <div className="stat__value"><Money baisa={d.external.disbursed} decimals={0} /></div>
        </div>
        <div className="stat">
          <div className="stat__label">{locale === 'ar' ? 'مسترد' : 'Refunded'}</div>
          <div className="stat__value"><Money baisa={d.external.refundsSettled} decimals={0} /></div>
        </div>
      </div>
      <p className="small muted" style={{ marginBlockStart: '.8rem', marginBlockEnd: 0 }}>{d.note}</p>
    </Card>
  );
}

/* ── FR-404: milestone disbursement, with evidence before approval ───────── */

function DisbursementForm({ poolId, poolStatus }: { poolId: string; poolStatus: string }) {
  const { t, locale, formatDate } = useI18n();
  const existing = useQuery<any>(`/funds/pools/${poolId}/disbursements`, [poolId]);
  const [form, setForm] = useState({
    milestoneCode: '', milestoneLabel: '', beneficiary: '', beneficiaryIban: '',
    amount: '', conditionText: '',
  });

  const create = useMutation(() => api.post(`/funds/pools/${poolId}/disbursements`, {
    milestoneCode: form.milestoneCode, milestoneLabel: form.milestoneLabel,
    beneficiary: form.beneficiary, beneficiaryIban: form.beneficiaryIban || undefined,
    amount: Math.round(Number(form.amount) * 1000), conditionText: form.conditionText,
  }));

  const attach = useMutation(async (p: { id: string; file: File; met: boolean }) => {
    const buffer = await p.file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return api.post(`/funds/disbursements/${p.id}/evidence`, {
      fileName: p.file.name, mimeType: p.file.type || 'application/pdf',
      contentBase64: btoa(binary), conditionMet: p.met,
    });
  });

  const disbursable = ['funded', 'disbursement', 'operating'].includes(poolStatus);
  const reload = () => existing.reload();

  return (
    <Card title={locale === 'ar' ? 'طلب صرف مرحلي' : 'Milestone disbursement request'}>
      {!disbursable ? (
        <div className="notice notice--info small">
          {locale === 'ar'
            ? 'الصرف متاح بعد تمويل الفرصة فقط — لا تُصرف أموال قبل الإغلاق الناجح.'
            : 'Disbursement opens only once the pool is funded — no money moves before a successful close.'}
        </div>
      ) : (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          if (await create.run()) {
            setForm({ milestoneCode: '', milestoneLabel: '', beneficiary: '', beneficiaryIban: '', amount: '', conditionText: '' });
            reload();
          }
        }}>
          <div className="notice notice--info small">
            {locale === 'ar'
              ? 'يُصرف للمورد مباشرة أو وفق مرحلة موثقة. لن يُعتمد الطلب قبل إرفاق دليل استيفاء الشرط، ولا يعتمده من أنشأه.'
              : 'Payment goes to the supplier directly or against a documented milestone. It cannot be approved without evidence the condition is met, and never by the person who raised it.'}
          </div>

          <div className="grid grid--two">
            <Field label={locale === 'ar' ? 'رمز المرحلة' : 'Milestone code'} htmlFor="mcode">
              <input id="mcode" type="text" dir="ltr" required minLength={2} value={form.milestoneCode}
                     onChange={(e) => setForm((f) => ({ ...f, milestoneCode: e.target.value }))} />
            </Field>
            <Field label={locale === 'ar' ? 'وصف المرحلة' : 'Milestone label'} htmlFor="mlabel">
              <input id="mlabel" type="text" required minLength={3} value={form.milestoneLabel}
                     onChange={(e) => setForm((f) => ({ ...f, milestoneLabel: e.target.value }))} />
            </Field>
            <Field label={locale === 'ar' ? 'المستفيد' : 'Beneficiary'} htmlFor="benef">
              <input id="benef" type="text" required minLength={3} value={form.beneficiary}
                     onChange={(e) => setForm((f) => ({ ...f, beneficiary: e.target.value }))} />
            </Field>
            <Field label={locale === 'ar' ? 'الآيبان' : 'IBAN'} htmlFor="iban">
              <input id="iban" type="text" dir="ltr" value={form.beneficiaryIban}
                     onChange={(e) => setForm((f) => ({ ...f, beneficiaryIban: e.target.value }))} />
            </Field>
            <Field label={locale === 'ar' ? 'المبلغ (ر.ع)' : 'Amount (OMR)'} htmlFor="damount">
              <input id="damount" type="number" min={0} step="0.001" dir="ltr" required value={form.amount}
                     onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
          </div>

          <Field label={locale === 'ar' ? 'شرط الصرف' : 'Disbursement condition'} htmlFor="cond"
                 hint={locale === 'ar' ? 'ما الذي يجب إثباته قبل الصرف' : 'What must be evidenced before payment'}>
            <textarea id="cond" rows={2} required minLength={10} value={form.conditionText}
                      onChange={(e) => setForm((f) => ({ ...f, conditionText: e.target.value }))} />
          </Field>

          <ErrorNotice error={create.error} />
          <button type="submit" className="btn btn--primary" disabled={create.pending}>
            {locale === 'ar' ? 'إنشاء الطلب' : 'Create request'}
          </button>
        </form>
      )}

      <ErrorNotice error={attach.error} />

      {existing.loading ? <Loading rows={2} /> : (existing.data?.items ?? []).length === 0 ? null : (
        <div className="table-wrap" style={{ marginBlockStart: '1rem' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{locale === 'ar' ? 'المرحلة' : 'Milestone'}</th><th>{locale === 'ar' ? 'المستفيد' : 'Beneficiary'}</th>
                <th>{t('amount')}</th><th>{t('status')}</th>
                <th>{locale === 'ar' ? 'المنشئ' : 'Maker'}</th><th>{locale === 'ar' ? 'المعتمد' : 'Checker'}</th>
                <th>{locale === 'ar' ? 'الدليل' : 'Evidence'}</th>
              </tr>
            </thead>
            <tbody>
              {existing.data.items.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.milestone_label}</td>
                  <td className="small">{d.beneficiary}</td>
                  <td className="num"><Money baisa={d.amount} decimals={0} /></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="small">{d.created_by_name ?? '—'}</td>
                  <td className="small">{d.approved_by_name ?? '—'}</td>
                  <td>
                    {d.status === 'draft' ? (
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png"
                             onChange={async (e) => {
                               const file = e.target.files?.[0];
                               if (file && await attach.run({ id: d.id, file, met: true })) reload();
                             }} />
                    ) : d.condition_met === 1 ? (
                      <Badge tone="positive">{locale === 'ar' ? 'مرفق' : 'Attached'}</Badge>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── FR-407 / BR-015: distribution from evidenced realised cash ──────────── */

function DistributionForm({ poolId, poolStatus }: { poolId: string; poolStatus: string }) {
  const { t, locale } = useI18n();
  const existing = useQuery<any>(`/funds/pools/${poolId}/distributions`, [poolId]);
  const [form, setForm] = useState({ periodLabel: '', grossAmount: '', applyFee: true });
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);

  const create = useMutation(async () => {
    if (!file) throw new Error('evidence required');
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return api.post(`/funds/pools/${poolId}/distributions`, {
      periodLabel: form.periodLabel,
      grossAmount: Math.round(Number(form.grossAmount) * 1000),
      applyMonitoringFee: form.applyFee,
      cashEvidence: { fileName: file.name, mimeType: file.type || 'application/pdf', contentBase64: btoa(binary) },
    });
  });

  const operating = ['operating', 'workout'].includes(poolStatus);

  return (
    <Card title={locale === 'ar' ? 'إنشاء توزيع' : 'Create a distribution'}>
      {!operating ? (
        <div className="notice notice--info small">
          {locale === 'ar'
            ? 'التوزيع متاح للفرص قيد التشغيل فقط.'
            : 'Distributions are available only for operating pools.'}
        </div>
      ) : (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault();
          const r = await create.run();
          if (r) { setResult(r); setForm({ periodLabel: '', grossAmount: '', applyFee: true }); setFile(null); existing.reload(); }
        }}>
          <div className="notice notice--risk small">
            {locale === 'ar'
              ? 'لا توزيع من أرباح محاسبية غير محصلة. يلزم دليل نقد محقق، ويعتمده مستخدم ثانٍ بعد التحقق من تطابق الحصص مع المبلغ.'
              : 'No distribution from unrealised accounting profit. Evidence of realised cash is required, and a second user approves it after checking the shares tie to the amount.'}
          </div>

          <div className="grid grid--two">
            <Field label={locale === 'ar' ? 'الفترة' : 'Period'} htmlFor="dperiod"
                   hint={locale === 'ar' ? 'مثال: 2026-H2' : 'e.g. 2026-H2'}>
              <input id="dperiod" type="text" dir="ltr" required minLength={4} value={form.periodLabel}
                     onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} />
            </Field>
            <Field label={locale === 'ar' ? 'الإجمالي المحقق (ر.ع)' : 'Realised gross (OMR)'} htmlFor="dgross">
              <input id="dgross" type="number" min={0} step="0.001" dir="ltr" required value={form.grossAmount}
                     onChange={(e) => setForm((f) => ({ ...f, grossAmount: e.target.value }))} />
            </Field>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={form.applyFee}
                   onChange={(e) => setForm((f) => ({ ...f, applyFee: e.target.checked }))} />
            <span>{locale === 'ar' ? 'خصم رسوم المتابعة 1% وفق العقد' : 'Deduct the 1% monitoring fee per the contract'}</span>
          </label>

          <Field label={locale === 'ar' ? 'دليل النقد المحقق' : 'Realised-cash evidence'} htmlFor="devidence">
            <input id="devidence" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx" required
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>

          <ErrorNotice error={create.error} />
          {result ? (
            <div className={`notice notice--${result.balanced ? 'success' : 'danger'} small`}>
              {locale === 'ar'
                ? `أُنشئ التوزيع لـ ${result.investors} مستثمرًا. تطابق الحصص مع المبلغ: ${result.balanced ? 'تام' : 'غير مطابق'}.`
                : `Created for ${result.investors} investors. Shares tie to the amount: ${result.balanced ? 'exact' : 'MISMATCH'}.`}
            </div>
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={create.pending || !file}>
            {locale === 'ar' ? 'إنشاء التوزيع' : 'Create distribution'}
          </button>
        </form>
      )}

      {(existing.data?.items ?? []).length > 0 ? (
        <div className="table-wrap" style={{ marginBlockStart: '1rem' }}>
          <table className="data">
            <thead>
              <tr><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th><th>{locale === 'ar' ? 'الإجمالي' : 'Gross'}</th>
                  <th>{locale === 'ar' ? 'الرسوم' : 'Fee'}</th><th>{locale === 'ar' ? 'الصافي' : 'Net'}</th>
                  <th>{t('status')}</th><th>{locale === 'ar' ? 'مستثمرون' : 'Investors'}</th></tr>
            </thead>
            <tbody>
              {existing.data.items.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.period_label}</td>
                  <td className="num"><Money baisa={d.gross_amount} decimals={0} /></td>
                  <td className="num"><Money baisa={d.fee_amount} decimals={0} /></td>
                  <td className="num"><Money baisa={d.net_amount} decimals={0} /></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="num">{(d.lines ?? []).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

/* ── FR-402: run the daily reconciliation ────────────────────────────────── */

function ReconciliationPanel() {
  const { t, locale, formatDate } = useI18n();
  const runs = useQuery<any>('/funds/reconciliation/runs');
  const [statement, setStatement] = useState('');
  const [outcome, setOutcome] = useState<any>(null);

  const run = useMutation(() => {
    // One line per statement entry: providerRef, amount in OMR, status.
    const externalLines = statement.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [providerRef, amount, status] = line.split(',').map((x) => x.trim());
      return { providerRef, amount: Math.round(Number(amount) * 1000), status: status || 'settled' };
    });
    return api.post('/funds/reconciliation/run', { scope: 'manual-upload', externalLines });
  });

  return (
    <Card title={locale === 'ar' ? 'تشغيل المطابقة' : 'Run reconciliation'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'تُقارن سجلات النظام بكشف الشريك أو البنك. أي فرق يفتح حالة بمهلة محددة، ولا يُغلق تلقائيًا أبدًا.'
          : 'Internal records are compared against the partner or bank statement. Any difference opens a case with an SLA, and is never auto-closed.'}
      </p>

      <form className="stack" style={{ marginBlockStart: '.9rem' }}
            onSubmit={async (e) => { e.preventDefault(); const r = await run.run(); if (r) { setOutcome(r); runs.reload(); } }}>
        <Field label={locale === 'ar' ? 'كشف الشريك' : 'Partner statement'} htmlFor="stmt"
               hint={locale === 'ar'
                 ? 'سطر لكل حركة:  المرجع، المبلغ بالريال، الحالة'
                 : 'One line per movement:  reference, amount in OMR, status'}>
          <textarea id="stmt" rows={6} dir="ltr" className="mono" required value={statement}
                    placeholder={'PR-SEED-0001, 1500, settled\nPR-SEED-0002, 2900, settled'}
                    onChange={(e) => setStatement(e.target.value)} />
        </Field>

        <ErrorNotice error={run.error} />
        {outcome ? (
          <div className={`notice notice--${outcome.breaks.length ? 'risk' : 'success'} small`}>
            {locale === 'ar'
              ? `طوبقت ${outcome.matched} حركة، وفتحت ${outcome.breaks.length} فروقات.`
              : `${outcome.matched} matched, ${outcome.breaks.length} breaks opened.`}
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={run.pending}>
          {locale === 'ar' ? 'تشغيل المطابقة' : 'Run reconciliation'}
        </button>
      </form>

      {(runs.data?.items ?? []).length > 0 ? (
        <div className="table-wrap" style={{ marginBlockStart: '1rem' }}>
          <table className="data">
            <thead>
              <tr><th>{t('date')}</th><th>{locale === 'ar' ? 'النطاق' : 'Scope'}</th>
                  <th>{locale === 'ar' ? 'مطابق' : 'Matched'}</th><th>{locale === 'ar' ? 'فروقات' : 'Breaks'}</th></tr>
            </thead>
            <tbody>
              {runs.data.items.slice(0, 12).map((r: any) => (
                <tr key={r.id}>
                  <td className="small">{formatDate(r.created_at, true)}</td>
                  <td className="small">{r.scope}</td>
                  <td className="num">{r.matched}</td>
                  <td className="num">
                    {r.breaks > 0 ? <Badge tone="warning">{r.breaks}</Badge> : '0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
