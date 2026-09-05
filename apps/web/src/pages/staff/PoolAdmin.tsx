/**
 * Pool management (FR-201 … FR-208, plus the monitoring actions of FR-501 … FR-509).
 *
 * This is where an approved application becomes a published opportunity and then
 * a monitored one. Every action is gated on the same permission the API checks,
 * and the destructive ones state their effect on existing commitments before
 * they run.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, Money, StatusBadge, Tabs, useReasonDialog,
} from '../../components/ui.tsx';
import { TrendChart, BarList, ComparisonChart, ProgressMeter, compactNumber } from '../../components/charts.tsx';

type Detail = 'insights' | 'disclosure' | 'lifecycle' | 'dataroom' | 'qa' | 'monitoring' | 'timeline';

export function PoolAdmin() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const pools = useQuery<any>('/pools?status=all&limit=50');

  if (pools.loading) return <Loading rows={6} />;
  if (pools.error) return <ErrorNotice error={pools.error} onRetry={pools.reload} />;

  if (selected) {
    return (
      <div className="stack">
        <div className="row">
          <button type="button" className="btn btn--sm" onClick={() => setSelected(null)}>
            ← {locale === 'ar' ? 'كل الفرص' : 'All pools'}
          </button>
        </div>
        <PoolDetail poolId={selected} onChanged={() => pools.reload()} />
      </div>
    );
  }

  return (
    <div className="stack">
      {auth.has('portfolio_ops') ? <PoolBuilder onCreated={() => pools.reload()} /> : null}

      <Card title={locale === 'ar' ? 'الفرص' : 'Pools'} actions={<Badge>{pools.data?.total ?? 0}</Badge>}>
        {(pools.data?.items ?? []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('reference')}</th><th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th>
                  <th>{t('status')}</th><th>{t('raised')}</th><th>{t('target')}</th>
                  <th>{locale === 'ar' ? 'يغلق' : 'Closes'}</th><th />
                </tr>
              </thead>
              <tbody>
                {pools.data.items.map((pool: any) => (
                  <tr key={pool.id}>
                    <td className="mono small">{pool.reference}</td>
                    <td>{pool.title_ar}</td>
                    <td><StatusBadge status={pool.status} /></td>
                    <td className="num"><Money baisa={pool.raisedAmount} decimals={0} /></td>
                    <td className="num"><Money baisa={pool.target_amount} decimals={0} /></td>
                    <td className="small">{formatDate(pool.closes_at)}</td>
                    <td>
                      <button type="button" className="btn btn--sm" onClick={() => setSelected(pool.id)}>
                        {t('viewDetails')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── FR-203 / FR-204: build a pool from a committee-approved application ─── */

function PoolBuilder({ onCreated }: { onCreated: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    applicationId: '', titleAr: '', structure: 'spv_equity', spvName: '',
    targetAmount: '', minAmount: '', maxAmount: '', ownerContribution: '',
    tenorMonths: '36', campaignDays: '45', allocationRule: 'pro_rata',
  });
  const create = useMutation(() => {
    const target = Math.round(Number(form.targetAmount) * 1000);
    const unitPrice = 100_000;                      // OMR 100 per unit
    return api.post('/pools', {
      applicationId: form.applicationId, titleAr: form.titleAr,
      structure: form.structure, spvName: form.spvName || undefined,
      // FR-204 — units × price must tie to the target, so it is derived, not typed.
      totalUnits: Math.round(target / unitPrice), unitPrice,
      targetAmount: target,
      minAmount: Math.round(Number(form.minAmount) * 1000),
      maxAmount: form.maxAmount ? Math.round(Number(form.maxAmount) * 1000) : undefined,
      ownerContribution: Math.round(Number(form.ownerContribution) * 1000),
      tenorMonths: Number(form.tenorMonths),
      campaignDays: Number(form.campaignDays),
      allocationRule: form.allocationRule,
    });
  });

  // Only committee-approved applications that do not already have a pool.
  const approved = useQuery<any>('/origination/applications/ready-for-pool');
  const candidates = approved.data?.items ?? [];

  if (!open) {
    return (
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
          {locale === 'ar' ? 'إنشاء فرصة من طلب معتمد' : 'Build a pool from an approved application'}
        </button>
      </div>
    );
  }

  const targetOmr = Number(form.targetAmount || 0);
  const contributionPct = targetOmr > 0
    ? (Number(form.ownerContribution || 0) / (targetOmr + Number(form.ownerContribution || 0))) * 100 : 0;
  const unitsPreview = targetOmr > 0 ? Math.round(targetOmr / 100) : 0;

  return (
    <Card
      title={locale === 'ar' ? 'منشئ الفرصة' : 'Pool builder'}
      actions={<button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>{t('cancel')}</button>}
    >
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await create.run()) { setOpen(false); onCreated(); }
        }}
      >
        <div className="notice notice--info small">
          {locale === 'ar'
            ? 'يتحقق النظام قبل الإنشاء من: حجم الفرصة داخل نطاق السياسة، وتطابق الوحدات مع الهدف، ومساهمة صاحب المشروع ضمن 20–30%، وحد عمر الكيان.'
            : 'Before creating, the system checks: pool size inside the policy band, units tying to the target, owner contribution within 20–30%, and the issuer age ceiling.'}
        </div>

        <Field label={locale === 'ar' ? 'الطلب المعتمد' : 'Approved application'} htmlFor="app">
          <select id="app" required value={form.applicationId}
                  onChange={(e) => {
                    const app = candidates.find((c: any) => c.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      applicationId: e.target.value,
                      titleAr: f.titleAr || (app?.title_ar ?? ''),
                      targetAmount: f.targetAmount || (app ? String(app.requested_amount / 1000) : ''),
                      ownerContribution: f.ownerContribution || (app ? String(app.owner_contribution / 1000) : ''),
                      tenorMonths: app?.tenor_months ? String(app.tenor_months) : f.tenorMonths,
                    }));
                  }}>
            <option value="">—</option>
            {candidates.map((app: any) => (
              <option key={app.id} value={app.id}>
                {app.reference} — {app.title_ar}
              </option>
            ))}
          </select>
        </Field>

        <Field label={locale === 'ar' ? 'عنوان الفرصة' : 'Pool title'} htmlFor="pool-title">
          <input id="pool-title" type="text" required minLength={5} value={form.titleAr}
                 onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))} />
        </Field>

        <div className="grid grid--two">
          <Field label={locale === 'ar' ? 'الهدف (ر.ع)' : 'Target (OMR)'} htmlFor="target"
                 hint={locale === 'ar' ? `${unitsPreview} وحدة بسعر 100 ر.ع` : `${unitsPreview} units at OMR 100`}>
            <input id="target" type="number" min={0} step="100" dir="ltr" required value={form.targetAmount}
                   onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'الحد الأدنى للإغلاق (ر.ع)' : 'Minimum to close (OMR)'} htmlFor="minamt">
            <input id="minamt" type="number" min={0} step="100" dir="ltr" required value={form.minAmount}
                   onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'سقف الاكتتاب (ر.ع)' : 'Overfunding ceiling (OMR)'} htmlFor="maxamt"
                 hint={locale === 'ar' ? 'اتركه فارغًا للسقف الافتراضي' : 'Leave blank for the policy default'}>
            <input id="maxamt" type="number" min={0} step="100" dir="ltr" value={form.maxAmount}
                   onChange={(e) => setForm((f) => ({ ...f, maxAmount: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'مساهمة صاحب المشروع (ر.ع)' : 'Owner contribution (OMR)'} htmlFor="owner"
                 hint={`${contributionPct.toFixed(1)}% ${locale === 'ar' ? '— السياسة 20–30%' : '— policy 20–30%'}`}
                 error={form.ownerContribution && (contributionPct < 20 || contributionPct > 30)
                   ? (locale === 'ar' ? 'خارج نطاق السياسة الداخلية' : 'Outside the internal policy band') : undefined}>
            <input id="owner" type="number" min={0} step="100" dir="ltr" required value={form.ownerContribution}
                   onChange={(e) => setForm((f) => ({ ...f, ownerContribution: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'المدة (شهر)' : 'Term (months)'} htmlFor="tenor">
            <input id="tenor" type="number" min={1} max={120} dir="ltr" required value={form.tenorMonths}
                   onChange={(e) => setForm((f) => ({ ...f, tenorMonths: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'مدة الحملة (يوم)' : 'Campaign window (days)'} htmlFor="camp">
            <input id="camp" type="number" min={1} max={120} dir="ltr" value={form.campaignDays}
                   onChange={(e) => setForm((f) => ({ ...f, campaignDays: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'الهيكل' : 'Structure'} htmlFor="structure">
            <select id="structure" value={form.structure}
                    onChange={(e) => setForm((f) => ({ ...f, structure: e.target.value }))}>
              <option value="spv_equity">{locale === 'ar' ? 'مساهمة عبر SPV' : 'SPV equity'}</option>
              <option value="profit_share">{locale === 'ar' ? 'مشاركة أرباح' : 'Profit share'}</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'قاعدة التخصيص' : 'Allocation rule'} htmlFor="alloc"
                 hint={locale === 'ar' ? 'تُعلن في الإفصاح قبل النشر' : 'Declared in the disclosure before publication'}>
            <select id="alloc" value={form.allocationRule}
                    onChange={(e) => setForm((f) => ({ ...f, allocationRule: e.target.value }))}>
              <option value="pro_rata">{locale === 'ar' ? 'تناسبي' : 'Pro rata'}</option>
              <option value="first_confirmed">{locale === 'ar' ? 'الأسبق تأكيدًا' : 'First confirmed'}</option>
            </select>
          </Field>
        </div>

        <Field label={locale === 'ar' ? 'اسم شركة الغرض الخاص' : 'SPV name'} htmlFor="spv">
          <input id="spv" type="text" value={form.spvName}
                 onChange={(e) => setForm((f) => ({ ...f, spvName: e.target.value }))} />
        </Field>

        <ErrorNotice error={create.error} />
        <button type="submit" className="btn btn--primary" disabled={create.pending}>
          {locale === 'ar' ? 'إنشاء مسودة الفرصة' : 'Create pool draft'}
        </button>
      </form>
    </Card>
  );
}

/* ── pool detail ─────────────────────────────────────────────────────────── */

function PoolDetail({ poolId, onChanged }: { poolId: string; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Detail>('insights');
  const pool = useQuery<any>(`/pools/${poolId}`, [poolId]);

  if (pool.loading) return <Loading rows={6} />;
  if (pool.error) return <ErrorNotice error={pool.error} onRetry={pool.reload} />;
  if (!pool.data) return null;

  const p = pool.data.pool;
  const reload = () => { pool.reload(); onChanged(); };

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="stack-sm">
          <div className="row" style={{ gap: '.4rem' }}>
            <StatusBadge status={p.status} />
            <Badge tone="info">{p.reference}</Badge>
            <Badge>{p.sector}</Badge>
          </div>
          <h2 style={{ margin: 0 }}>{p.title_ar}</h2>
        </div>
      </div>

      <Tabs<Detail>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'insights',   label: locale === 'ar' ? 'المؤشرات' : 'Insights' },
          { key: 'disclosure', label: locale === 'ar' ? 'الإفصاح' : 'Disclosure' },
          { key: 'lifecycle',  label: locale === 'ar' ? 'دورة الحياة' : 'Lifecycle' },
          { key: 'dataroom',   label: locale === 'ar' ? 'الأدلة' : 'Data room' },
          { key: 'qa',         label: locale === 'ar' ? 'الأسئلة' : 'Q&A' },
          { key: 'monitoring', label: locale === 'ar' ? 'إعداد المتابعة' : 'Monitoring setup' },
          { key: 'timeline',   label: locale === 'ar' ? 'السجل' : 'Timeline' },
        ]}
      />

      {tab === 'insights'   ? <PoolInsights poolId={poolId} />
       : tab === 'disclosure' ? <DisclosurePanel poolId={poolId} pool={p} onChanged={reload} />
       : tab === 'lifecycle'  ? <LifecyclePanel pool={p} onChanged={reload} />
       : tab === 'dataroom'   ? <DataRoomPanel poolId={poolId} documents={pool.data.dataRoom} onChanged={reload} />
       : tab === 'qa'         ? <QaPanel poolId={poolId} onChanged={reload} />
       : tab === 'monitoring' ? <MonitoringPanel pool={p} onChanged={reload} />
       : <TimelinePanel poolId={poolId} />}
    </div>
  );
}

/* ── per-pool dashboard ──────────────────────────────────────────────────── */

function PoolInsights({ poolId }: { poolId: string }) {
  const { locale, formatOmr, formatDate } = useI18n();
  const insights = useQuery<any>(`/analytics/pools/${poolId}`, [poolId]);
  const position = useQuery<any>(`/funds/pools/${poolId}/position`, [poolId]);

  if (insights.loading) return <Loading rows={6} />;
  if (insights.error) return <ErrorNotice error={insights.error} onRetry={insights.reload} />;
  if (!insights.data) return null;

  const d = insights.data;
  const omr0 = (v: number) => formatOmr(v, { decimals: 0 });
  const plain = (v: number) => String(Math.round(v));
  const CLASS: Record<string, string> = {
    retail: locale === 'ar' ? 'أفراد' : 'Retail',
    angel: locale === 'ar' ? 'ملائكي' : 'Angel',
    sophisticated: locale === 'ar' ? 'متمرس' : 'Sophisticated',
  };

  return (
    <div className="dash">
      <Card>
        <TrendChart
          title={locale === 'ar' ? 'منحنى التمويل' : 'Funding curve'}
          subtitle={locale === 'ar' ? 'الالتزامات التراكمية منذ النشر' : 'Cumulative commitments since publication'}
          points={d.fundingCurve.map((c: any) => ({ label: c.date.slice(5), value: c.cumulative }))}
          valueFormat={omr0}
          tickFormat={(v) => compactNumber(v / 1000)}
        />
      </Card>

      <div className="chart-grid">
        <Card>
          <BarList
            title={locale === 'ar' ? 'المستثمرون حسب التصنيف' : 'Investors by classification'}
            subtitle={locale === 'ar' ? 'المبالغ الملتزم بها' : 'Amounts committed'}
            items={d.investorMix.map((m: any) => ({ label: CLASS[m.classification] ?? m.classification, value: m.amount }))}
            valueFormat={omr0}
          />
        </Card>
        <Card>
          <BarList
            title={locale === 'ar' ? 'شرائح حجم الالتزام' : 'Ticket size bands'}
            subtitle={locale === 'ar' ? 'عدد الالتزامات في كل شريحة' : 'Commitments in each band'}
            items={d.ticketBands.map((b: any) => ({ label: b.band, value: b.investors }))}
            valueFormat={plain}
            ordinal
          />
        </Card>
      </div>

      {d.kpiSeries.length > 0 ? (
        <div className="chart-grid">
          {d.kpiSeries.map((series: any) => (
            <Card key={series.metric}>
              <ComparisonChart
                title={series.metric}
                subtitle={locale === 'ar' ? 'الفعلي مقابل المتوقع' : 'Actual against forecast'}
                points={series.points.map((pt: any) => ({ label: pt.period, a: pt.actual, b: pt.forecast }))}
                labels={[locale === 'ar' ? 'الفعلي' : 'Actual', locale === 'ar' ? 'المتوقع' : 'Forecast']}
                valueFormat={plain}
              />
            </Card>
          ))}
        </div>
      ) : null}

      <div className="chart-grid">
        <Card title={locale === 'ar' ? 'مراحل الصرف' : 'Disbursement milestones'}>
          {d.milestones.length === 0 ? <Empty /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>{locale === 'ar' ? 'المرحلة' : 'Milestone'}</th><th>{locale === 'ar' ? 'المبلغ' : 'Amount'}</th>
                      <th>{locale === 'ar' ? 'الحالة' : 'Status'}</th><th>{locale === 'ar' ? 'نُفّذ' : 'Executed'}</th></tr>
                </thead>
                <tbody>
                  {d.milestones.map((m: any) => (
                    <tr key={m.code}>
                      <td>{m.label}</td>
                      <td className="num"><Money baisa={m.amount} decimals={0} /></td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className="small">{m.executedAt ? formatDate(m.executedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={locale === 'ar' ? 'وضع حساب الضمان' : 'Escrow position'}>
          {position.loading ? <Loading rows={3} /> : !position.data ? <Empty /> : (
            <div className="stack">
              <dl className="kv" style={{ marginBlockEnd: 0 }}>
                <dt>{locale === 'ar' ? 'مرجع الحساب' : 'Account reference'}</dt>
                <dd className="mono small">{position.data.escrowAccountRef ?? '—'}</dd>
                <dt>{locale === 'ar' ? 'محصّل' : 'Collected'}</dt>
                <dd><Money baisa={position.data.external.settledCollections} decimals={0} /></dd>
                <dt>{locale === 'ar' ? 'مصروف' : 'Disbursed'}</dt>
                <dd><Money baisa={position.data.external.disbursed} decimals={0} /></dd>
                <dt>{locale === 'ar' ? 'مسترد' : 'Refunded'}</dt>
                <dd><Money baisa={position.data.external.refundsSettled} decimals={0} /></dd>
              </dl>
              <p className="small muted" style={{ margin: 0 }}>{position.data.note}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── FR-201 / FR-202: disclosure versions, diff and publication ──────────── */

function DisclosurePanel({ poolId, pool, onChanged }: { poolId: string; pool: any; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const { ask, dialog } = useReasonDialog();
  const auth = useAuth();
  const versions = useQuery<any>(`/pools/${poolId}/disclosures`, [poolId]);
  const [diff, setDiff] = useState<{ from: number; to: number } | null>(null);

  const publish = useMutation((payload: { disclosureId: string; escrowAccountRef: string; reason: string }) =>
    api.post(`/pools/${poolId}/publish`, payload));

  const canBuild = auth.has('portfolio_ops');
  const list = versions.data?.items ?? [];

  return (
    <div className="stack">
      {dialog}
      <Card title={locale === 'ar' ? 'نسخ الإفصاح' : 'Disclosure versions'}
            actions={<Badge tone="info">{locale === 'ar' ? 'غير قابلة للاستبدال' : 'Immutable'}</Badge>}>
        <p className="small muted">
          {locale === 'ar'
            ? 'النسخة المنشورة لا تُعدَّل. أي تغيير يُصدر نسخة جديدة تَحلّ محلها، وتبقى القديمة قابلة للمقارنة والمراجعة.'
            : 'A published version is never edited. A change issues a new version that supersedes it, and the old one stays comparable and auditable.'}
        </p>

        {versions.loading ? <Loading rows={3} /> : list.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'النسخة' : 'Version'}</th><th>{t('status')}</th>
                  <th>{locale === 'ar' ? 'تغيير جوهري' : 'Material'}</th>
                  <th>{locale === 'ar' ? 'السبب' : 'Reason'}</th>
                  <th>{locale === 'ar' ? 'البصمة' : 'Hash'}</th><th>{t('date')}</th><th />
                </tr>
              </thead>
              <tbody>
                {list.map((v: any) => (
                  <tr key={v.id}>
                    <td className="num">v{v.version}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>{v.material_change === 1 ? <Badge tone="warning">{locale === 'ar' ? 'نعم' : 'Yes'}</Badge> : '—'}</td>
                    <td className="small">{v.change_reason ?? '—'}</td>
                    <td className="mono small">{String(v.content_hash).slice(0, 12)}…</td>
                    <td className="small">{formatDate(v.published_at ?? v.created_at)}</td>
                    <td>
                      {v.status === 'draft' && canBuild ? (
                        <button
                          type="button" className="btn btn--sm btn--primary" disabled={publish.pending}
                          onClick={async () => {
                            /* Publishing binds every future order to this
                               document, so the escrow reference and the reason
                               are asked for together and validated in place. */
                            const known = pool.escrow_account_ref;
                            const r = await ask({
                              title: locale === 'ar' ? 'نشر الإفصاح' : 'Publish disclosure',
                              confirmText: locale === 'ar' ? 'نشر' : 'Publish',
                              fields: [
                                ...(known ? [] : [{ name: 'escrow', minLength: 3,
                                  label: locale === 'ar' ? 'مرجع حساب الضمان' : 'Escrow account reference' }]),
                                { name: 'reason', minLength: 5, multiline: true,
                                  label: locale === 'ar' ? 'سبب النشر' : 'Publication reason' },
                              ],
                            });
                            if (!r) return;
                            const escrow = known ?? r.escrow;
                            if (await publish.run({ disclosureId: v.id, escrowAccountRef: escrow, reason: r.reason })) onChanged();
                          }}
                        >
                          {locale === 'ar' ? 'نشر' : 'Publish'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ErrorNotice error={publish.error} />

        {list.length >= 2 ? (
          <div className="row" style={{ marginBlockStart: '.85rem' }}>
            <button type="button" className="btn btn--sm"
                    onClick={() => setDiff({ from: list[list.length - 1].version, to: list[0].version })}>
              {locale === 'ar' ? 'قارن النسختين الأولى والأخيرة' : 'Compare first and latest'}
            </button>
          </div>
        ) : null}
      </Card>

      {diff ? <DisclosureDiff poolId={poolId} from={diff.from} to={diff.to} onClose={() => setDiff(null)} /> : null}

      {canBuild ? <DisclosureEditor poolId={poolId} nextVersion={(list[0]?.version ?? 0) + 1} onSaved={() => { versions.reload(); onChanged(); }} /> : null}
    </div>
  );
}

function DisclosureDiff({ poolId, from, to, onClose }: { poolId: string; from: number; to: number; onClose: () => void }) {
  const { t, locale } = useI18n();
  const diff = useQuery<any>(`/pools/${poolId}/disclosures/diff?from=${from}&to=${to}`, [poolId, from, to]);

  return (
    <Card
      title={locale === 'ar' ? `مقارنة v${from} ← v${to}` : `Comparing v${from} → v${to}`}
      actions={<button type="button" className="btn btn--sm" onClick={onClose}>{t('close')}</button>}
    >
      {diff.loading ? <Loading rows={3} /> : (diff.data?.changes ?? []).length === 0 ? (
        <Empty>{locale === 'ar' ? 'لا فروق بين النسختين.' : 'No differences between these versions.'}</Empty>
      ) : (
        <div className="stack-sm">
          {diff.data.changes.map((change: any) => (
            <div key={change.path} className="panel">
              <div className="mono small" style={{ color: 'var(--ink-3)' }}>{change.path}</div>
              <div className="small" style={{ color: 'var(--danger)' }}>− {change.from ?? '—'}</div>
              <div className="small" style={{ color: 'var(--positive)' }}>+ {change.to ?? '—'}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** A guided editor — the API rejects an empty mandatory section, so the form asks for each. */
function DisclosureEditor({ poolId, nextVersion, onSaved }: {
  poolId: string; nextVersion: number; onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [material, setMaterial] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation(() => api.post(`/pools/${poolId}/disclosures`, {
    sections: {
      summary: { activityAr: f.activity ?? '', useOfFundsAr: f.uof ?? '', expansionRationaleAr: f.rationale ?? '' },
      financials: {
        historicalRevenue: (f.revenue ?? '').split('\n').filter(Boolean).map((line) => {
          const [period, amount] = line.split(':').map((x) => x.trim());
          return { period, amount: Math.round(Number(amount) * 1000) };
        }),
        assumptionsAr: f.assumptions ?? '',
        scenarios: {
          conservative: { annualCashYieldBps: Number(f.consBps ?? 0), narrativeAr: f.consText ?? '' },
          base:         { annualCashYieldBps: Number(f.baseBps ?? 0), narrativeAr: f.baseText ?? '' },
          optimistic:   { annualCashYieldBps: Number(f.optBps ?? 0),  narrativeAr: f.optText ?? '' },
        },
      },
      rights: {
        instrumentAr: f.instrument ?? '', distributionPolicyAr: f.distPolicy ?? '',
        votingAr: f.voting ?? '', restrictionsAr: f.restrictions ?? '',
        exitMechanismAr: f.exit ?? '', defaultHandlingAr: f.defaultHandling ?? '',
      },
      risks: {
        capitalLossAr: f.riskCapital ?? '', liquidityAr: f.riskLiquidity ?? '',
        operationalAr: f.riskOps ?? '', sectorAr: f.riskSector ?? '',
        conflictsAr: f.riskConflicts ?? '', dependenciesAr: f.riskDeps ?? '',
      },
      fees: {
        assessmentFee: 750_000, successFeeBps: 300, monitoringFeeBps: 100,
        investorFeeNoteAr: f.feeNote ?? 'لا توجد رسوم على المستثمر في المرحلة التجريبية.',
      },
      evidence: [],
    },
    ...(nextVersion > 1 ? { changeReason, materialChange: material } : {}),
  }));

  if (!open) {
    return (
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
          {locale === 'ar' ? `تحرير نسخة إفصاح v${nextVersion}` : `Draft disclosure v${nextVersion}`}
        </button>
      </div>
    );
  }

  const long = (k: string, label: string, hint?: string, rows = 3) => (
    <Field label={label} htmlFor={k} hint={hint}>
      <textarea id={k} rows={rows} value={f[k] ?? ''} onChange={set(k)} />
    </Field>
  );

  return (
    <Card
      title={locale === 'ar' ? `نسخة إفصاح v${nextVersion}` : `Disclosure v${nextVersion}`}
      actions={<button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>{t('cancel')}</button>}
    >
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await save.run()) { setOpen(false); onSaved(); } }}>
        <div className="notice notice--risk small">
          {locale === 'ar'
            ? 'يرفض النظام أي عبارة ضمان للعائد أو لرأس المال، ويشترط ترتيب السيناريوهات: متحفظ ≤ أساسي ≤ متفائل.'
            : 'The system rejects any guarantee wording, and requires scenarios ordered conservative ≤ base ≤ optimistic.'}
        </div>

        <h4 style={{ margin: 0 }}>{locale === 'ar' ? 'الملخص' : 'Summary'}</h4>
        {long('activity', locale === 'ar' ? 'النشاط والمشروع' : 'Activity and project')}
        {long('uof', locale === 'ar' ? 'استخدام الأموال' : 'Use of funds')}
        {long('rationale', locale === 'ar' ? 'مبرر التوسع' : 'Expansion rationale')}

        <h4 style={{ margin: 0 }}>{locale === 'ar' ? 'البيانات المالية' : 'Financials'}</h4>
        {long('revenue', locale === 'ar' ? 'الإيرادات التاريخية' : 'Historical revenue',
              locale === 'ar' ? 'سطر لكل فترة بصيغة  2025-Q4: 36000' : 'One line per period, as  2025-Q4: 36000', 4)}
        {long('assumptions', locale === 'ar' ? 'الافتراضات' : 'Assumptions')}

        <div className="grid grid--two">
          {(['cons', 'base', 'opt'] as const).map((key) => {
            const label = key === 'cons' ? (locale === 'ar' ? 'متحفظ' : 'Conservative')
              : key === 'base' ? (locale === 'ar' ? 'أساسي' : 'Base') : (locale === 'ar' ? 'متفائل' : 'Optimistic');
            return (
              <div key={key} className="stack-sm">
                <Field label={`${label} — ${locale === 'ar' ? 'نقطة أساس' : 'bps'}`} htmlFor={`${key}Bps`}>
                  <input id={`${key}Bps`} type="number" min={0} max={10000} dir="ltr"
                         value={f[`${key}Bps`] ?? ''} onChange={set(`${key}Bps`)} />
                </Field>
                <Field label={`${label} — ${locale === 'ar' ? 'الفرضية' : 'narrative'}`} htmlFor={`${key}Text`}>
                  <textarea id={`${key}Text`} rows={2} value={f[`${key}Text`] ?? ''} onChange={set(`${key}Text`)} />
                </Field>
              </div>
            );
          })}
        </div>

        <h4 style={{ margin: 0 }}>{locale === 'ar' ? 'الحقوق والخروج' : 'Rights and exit'}</h4>
        <div className="grid grid--two">
          {long('instrument', locale === 'ar' ? 'الأداة' : 'Instrument', undefined, 2)}
          {long('distPolicy', locale === 'ar' ? 'سياسة التوزيع' : 'Distribution policy', undefined, 2)}
          {long('voting', locale === 'ar' ? 'التصويت' : 'Voting', undefined, 2)}
          {long('restrictions', locale === 'ar' ? 'القيود' : 'Restrictions', undefined, 2)}
          {long('exit', locale === 'ar' ? 'آلية الخروج' : 'Exit mechanism', undefined, 2)}
          {long('defaultHandling', locale === 'ar' ? 'معالجة التعثر' : 'Default handling', undefined, 2)}
        </div>

        <h4 style={{ margin: 0 }}>{locale === 'ar' ? 'المخاطر' : 'Risks'}</h4>
        <div className="grid grid--two">
          {long('riskCapital', locale === 'ar' ? 'خسارة رأس المال' : 'Capital loss', undefined, 2)}
          {long('riskLiquidity', locale === 'ar' ? 'السيولة' : 'Liquidity', undefined, 2)}
          {long('riskOps', locale === 'ar' ? 'التشغيل' : 'Operational', undefined, 2)}
          {long('riskSector', locale === 'ar' ? 'القطاع' : 'Sector', undefined, 2)}
          {long('riskConflicts', locale === 'ar' ? 'تعارض المصالح' : 'Conflicts', undefined, 2)}
          {long('riskDeps', locale === 'ar' ? 'الاعتماديات' : 'Dependencies', undefined, 2)}
        </div>

        {nextVersion > 1 ? (
          <>
            <Field label={locale === 'ar' ? 'سبب إصدار النسخة' : 'Reason for this version'} htmlFor="reason">
              <textarea id="reason" rows={2} required value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)} />
            </Field>
            <label className="checkbox">
              <input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} />
              <span>
                {locale === 'ar'
                  ? 'تغيير جوهري — يُشعر كل مستثمر قائم ويفتح حالة موافقة'
                  : 'Material change — notifies every existing investor and opens an approval case'}
              </span>
            </label>
          </>
        ) : null}

        <ErrorNotice error={save.error} />
        <button type="submit" className="btn btn--primary" disabled={save.pending}>{t('save')}</button>
      </form>
    </Card>
  );
}

/* ── FR-208: pause / resume / extend / cancel, and the owner-first gate ──── */

function LifecyclePanel({ pool, onChanged }: { pool: any; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const { ask, dialog } = useReasonDialog();

  const pause = useMutation((reason: string) => api.post(`/pools/${pool.id}/pause`, { reason }));
  const resume = useMutation((reason: string) => api.post(`/pools/${pool.id}/resume`, { reason }));
  const extend = useMutation((p: { additionalDays: number; reason: string }) => api.post(`/pools/${pool.id}/extend`, p));
  const cancel = useMutation((reason: string) => api.post(`/pools/${pool.id}/cancel`, { reason }));
  const ownerPaid = useMutation((reference: string) => api.post(`/pools/${pool.id}/owner-contribution`, { reference }));

  const run = async (fn: Promise<any> | null) => { if (await fn) onChanged(); };

  return (
    <div className="stack">
      {dialog}
      <Card title={locale === 'ar' ? 'حالة الفرصة' : 'Pool state'}>
        <dl className="kv" style={{ marginBlockEnd: '1rem' }}>
          <dt>{t('status')}</dt><dd><StatusBadge status={pool.status} /></dd>
          <dt>{locale === 'ar' ? 'مساهمة صاحب المشروع' : 'Owner contribution'}</dt>
          <dd>
            {pool.owner_contribution_received_at
              ? <Badge tone="positive">{locale === 'ar' ? 'مستلمة' : 'Received'} · {formatDate(pool.owner_contribution_received_at)}</Badge>
              : <Badge tone="warning">{locale === 'ar' ? 'لم تُستلم — النشر محجوب' : 'Not received — publication blocked'}</Badge>}
          </dd>
          <dt>{locale === 'ar' ? 'يغلق في' : 'Closes'}</dt><dd>{formatDate(pool.closes_at)}</dd>
          <dt>{locale === 'ar' ? 'حساب الضمان' : 'Escrow'}</dt>
          <dd className="mono small">{pool.escrow_account_ref ?? '—'}</dd>
        </dl>

        <ErrorNotice error={pause.error ?? resume.error ?? extend.error ?? cancel.error ?? ownerPaid.error} />

        <div className="row">
          {!pool.owner_contribution_received_at && auth.has('finance_ops') ? (
            <button type="button" className="btn btn--primary btn--sm" disabled={ownerPaid.pending}
                    onClick={async () => {
                      const r = await ask({
                        title: locale === 'ar' ? 'تسجيل استلام المساهمة' : 'Record contribution received',
                        fields: [{ name: 'reference', minLength: 3,
                          label: locale === 'ar' ? 'مرجع إيداع المساهمة' : 'Deposit reference' }],
                      });
                      if (r) run(ownerPaid.run(r.reference));
                    }}>
              {locale === 'ar' ? 'تسجيل استلام المساهمة' : 'Record contribution received'}
            </button>
          ) : null}

          {pool.status === 'funding' && auth.has('compliance') ? (
            <button type="button" className="btn btn--sm" disabled={pause.pending}
                    onClick={async () => {
                      const r = await ask({
                        title: locale === 'ar' ? 'إيقاف الفرصة مؤقتًا' : 'Pause this pool',
                        fields: [{ name: 'reason', minLength: 10, multiline: true,
                          label: locale === 'ar' ? 'سبب الإيقاف' : 'Pause reason' }],
                      });
                      if (r) run(pause.run(r.reason));
                    }}>
              {locale === 'ar' ? 'إيقاف مؤقت' : 'Pause'}
            </button>
          ) : null}

          {pool.status === 'paused' && auth.has('portfolio_ops') ? (
            <button type="button" className="btn btn--sm" disabled={resume.pending}
                    onClick={async () => {
                      const r = await ask({
                        title: locale === 'ar' ? 'استئناف الفرصة' : 'Resume this pool',
                        fields: [{ name: 'reason', minLength: 10, multiline: true,
                          label: locale === 'ar' ? 'سبب الاستئناف' : 'Resume reason' }],
                      });
                      if (r) run(resume.run(r.reason));
                    }}>
              {locale === 'ar' ? 'استئناف' : 'Resume'}
            </button>
          ) : null}

          {['funding', 'paused'].includes(pool.status) && auth.has('portfolio_ops') ? (
            <button type="button" className="btn btn--sm" disabled={extend.pending}
                    onClick={async () => {
                      /* One dialog, not two prompts: answering the first and
                         cancelling the second used to leave nothing behind and
                         say nothing about it. */
                      const r = await ask({
                        title: locale === 'ar' ? 'تمديد مدة التمويل' : 'Extend the funding window',
                        fields: [
                          { name: 'days', type: 'number', minLength: 1,
                            label: locale === 'ar' ? 'عدد الأيام الإضافية' : 'Additional days' },
                          { name: 'reason', minLength: 10, multiline: true,
                            label: locale === 'ar' ? 'سبب التمديد' : 'Extension reason' },
                        ],
                      });
                      const days = Number(r?.days);
                      if (r && days > 0) run(extend.run({ additionalDays: days, reason: r.reason }));
                    }}>
              {locale === 'ar' ? 'تمديد المدة' : 'Extend'}
            </button>
          ) : null}

          {!['closed', 'cancelled'].includes(pool.status) && auth.has('compliance') ? (
            <button type="button" className="btn btn--sm btn--danger" disabled={cancel.pending}
                    onClick={async () => {
                      const warn = pool.raisedAmount > 0
                        ? (locale === 'ar'
                          ? 'توجد التزامات مؤكدة — سيتحول الإلغاء إلى مسار استرداد لكل مستثمر. متابعة؟'
                          : 'There are confirmed commitments — cancelling routes every investor to a refund. Continue?')
                        : (locale === 'ar' ? 'إلغاء الفرصة؟' : 'Cancel this pool?');
                      const r = await ask({
                        title: locale === 'ar' ? 'إلغاء الفرصة' : 'Cancel this pool',
                        intro: warn,
                        danger: true,
                        confirmText: locale === 'ar' ? 'تأكيد الإلغاء' : 'Confirm cancellation',
                        fields: [{ name: 'reason', minLength: 10, multiline: true,
                          label: locale === 'ar' ? 'سبب الإلغاء' : 'Cancellation reason' }],
                      });
                      if (r) run(cancel.run(r.reason));
                    }}>
              {locale === 'ar' ? 'إلغاء الفرصة' : 'Cancel pool'}
            </button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/* ── FR-206: data room ───────────────────────────────────────────────────── */

function DataRoomPanel({ poolId, documents, onChanged }: { poolId: string; documents: any[]; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const [category, setCategory] = useState('valuation');
  const [visibility, setVisibility] = useState('investor_verified');
  const upload = useMutation(async (file: File) => {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return api.post(`/pools/${poolId}/documents`, {
      category, fileName: file.name, mimeType: file.type || 'application/pdf',
      contentBase64: btoa(binary), visibility,
    });
  });

  return (
    <Card title={locale === 'ar' ? 'غرفة الأدلة' : 'Data room'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'كل تنزيل — ومحاولة تنزيل مرفوضة — يُسجَّل باسم المستخدم والوقت. الملفات المقيدة لا تظهر لغير المتحقق من هويته.'
          : 'Every download, and every refused attempt, is logged with the user and time. Restricted files never appear to an unverified viewer.'}
      </p>

      {auth.has('portfolio_ops') ? (
        <div className="filters" style={{ marginBlock: '.9rem' }}>
          <Field label={locale === 'ar' ? 'التصنيف' : 'Category'} htmlFor="doc-cat">
            <input id="doc-cat" type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label={locale === 'ar' ? 'الظهور' : 'Visibility'} htmlFor="doc-vis">
            <select id="doc-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="public">{locale === 'ar' ? 'عام' : 'Public'}</option>
              <option value="investor_verified">{locale === 'ar' ? 'مستثمر متحقق' : 'Verified investors'}</option>
              <option value="internal">{locale === 'ar' ? 'داخلي' : 'Internal'}</option>
            </select>
          </Field>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx"
                 onChange={async (e) => {
                   const file = e.target.files?.[0];
                   if (file && await upload.run(file)) onChanged();
                 }} />
        </div>
      ) : null}
      <ErrorNotice error={upload.error} />

      {documents.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{locale === 'ar' ? 'الملف' : 'File'}</th><th>{locale === 'ar' ? 'التصنيف' : 'Category'}</th>
                  <th>{locale === 'ar' ? 'الظهور' : 'Visibility'}</th><th>{locale === 'ar' ? 'النسخة' : 'Version'}</th>
                  <th>{t('date')}</th></tr>
            </thead>
            <tbody>
              {documents.map((d: any) => (
                <tr key={d.id}>
                  <td><a href={`/api/pools/${poolId}/documents/${d.id}`} target="_blank" rel="noreferrer">{d.file_name}</a></td>
                  <td className="small">{d.category}</td>
                  <td><Badge>{d.visibility}</Badge></td>
                  <td className="num">v{d.version}</td>
                  <td className="small">{formatDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── FR-207: Q&A moderation ─────────────────────────────────────────────── */

function QaPanel({ poolId, onChanged }: { poolId: string; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const { ask, dialog } = useReasonDialog();
  const pending = useQuery<any>(`/pools/${poolId}/questions/pending`, [poolId]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answer = useMutation((p: { id: string; answer: string; publish: boolean; rejectReason?: string }) =>
    api.post(`/pools/questions/${p.id}/answer`,
             { answer: p.answer, publish: p.publish, rejectReason: p.rejectReason }));

  const reload = () => { pending.reload(); onChanged(); };

  return (
    <Card title={locale === 'ar' ? 'أسئلة بانتظار المراجعة' : 'Questions awaiting review'}>
      {dialog}
      <p className="small muted">
        {locale === 'ar'
          ? 'لا يُنشر أي جواب قبل اعتماد الدور المخول، ويُفحص نص الجواب من عبارات الضمان قبل قبوله.'
          : 'No answer is published before the authorised role approves it, and the text is screened for guarantee wording first.'}
      </p>
      <ErrorNotice error={answer.error} />

      {pending.loading ? <Loading rows={3} /> : (pending.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="stack">
          {pending.data.items.map((q: any) => (
            <div key={q.id} className="panel stack-sm">
              <div className="row row--between">
                <strong className="small">{q.body}</strong>
                <StatusBadge status={q.status} />
              </div>
              <span className="small muted">{formatDate(q.created_at, true)}</span>
              {q.answer ? <p className="small" style={{ margin: 0 }}>{q.answer}</p> : null}

              <textarea rows={3} value={answers[q.id] ?? q.answer ?? ''}
                        onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} />
              <div className="row row--end">
                <button type="button" className="btn btn--sm" disabled={answer.pending}
                        onClick={async () => {
                          if (await answer.run({ id: q.id, answer: answers[q.id] ?? '', publish: false })) reload();
                        }}>
                  {locale === 'ar' ? 'حفظ دون نشر' : 'Save unpublished'}
                </button>
                <button type="button" className="btn btn--sm btn--primary" disabled={answer.pending}
                        onClick={async () => {
                          if (await answer.run({ id: q.id, answer: answers[q.id] ?? '', publish: true })) reload();
                        }}>
                  {locale === 'ar' ? 'اعتماد ونشر' : 'Approve & publish'}
                </button>
                <button type="button" className="btn btn--sm btn--danger" disabled={answer.pending}
                        onClick={async () => {
                          const r = await ask({
                            title: locale === 'ar' ? 'رفض السؤال' : 'Reject this question',
                            danger: true,
                            confirmText: locale === 'ar' ? 'تأكيد الرفض' : 'Confirm rejection',
                            fields: [{ name: 'why', minLength: 5, multiline: true,
                              label: locale === 'ar' ? 'سبب الرفض' : 'Rejection reason' }],
                          });
                          if (r && await answer.run({ id: q.id, answer: answers[q.id] ?? '—', publish: false, rejectReason: r.why })) reload();
                        }}>
                  {t('reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── FR-501/502/508/509: schedules, covenants and the workout path ───────── */

function MonitoringPanel({ pool, onChanged }: { pool: any; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [schedule, setSchedule] = useState({ frequency: 'monthly', startDate: '', periods: '6', graceDays: '15' });
  const [covenant, setCovenant] = useState({ code: '', labelAr: '', metric: '', operator: 'gte', threshold: '', breachAction: 'alert' });

  const addSchedule = useMutation(() => api.post(`/portfolio/pools/${pool.id}/report-schedule`, {
    frequency: schedule.frequency, startDate: `${schedule.startDate}T00:00:00.000Z`,
    periods: Number(schedule.periods), graceDays: Number(schedule.graceDays),
  }));
  const addCovenant = useMutation(() => api.post(`/portfolio/pools/${pool.id}/covenants`, {
    code: covenant.code, labelAr: covenant.labelAr, metric: covenant.metric,
    operator: covenant.operator, threshold: Number(covenant.threshold), breachAction: covenant.breachAction,
  }));
  const markDefault = useMutation((p: { reason: string; plan: string }) =>
    api.post(`/portfolio/pools/${pool.id}/default`, p));
  const workout = useMutation((reason: string) => api.post(`/portfolio/pools/${pool.id}/workout`, { reason }));
  const close = useMutation((p: { reason: string; finalSettlementNote: string }) =>
    api.post(`/portfolio/pools/${pool.id}/close`, p));

  const canAct = auth.has('portfolio_ops');
  const { ask, dialog } = useReasonDialog();

  return (
    <div className="stack">
      {dialog}
      {canAct ? (
        <Card title={locale === 'ar' ? 'جدول التقارير' : 'Report schedule'}>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await addSchedule.run()) onChanged(); }}>
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'ينشئ الجدول مهامًا وتذكيرات قبل الاستحقاق، ويحوّل أي تقرير يتجاوز موعده إلى إنذار وحالة تصعيد.'
                : 'The schedule creates tasks and reminders before the due date, and turns any overdue report into an alert and an escalation case.'}
            </p>
            <div className="filters">
              <Field label={locale === 'ar' ? 'الوتيرة' : 'Frequency'} htmlFor="freq">
                <select id="freq" value={schedule.frequency}
                        onChange={(e) => setSchedule((s) => ({ ...s, frequency: e.target.value }))}>
                  <option value="monthly">{locale === 'ar' ? 'شهري' : 'Monthly'}</option>
                  <option value="quarterly">{locale === 'ar' ? 'ربع سنوي' : 'Quarterly'}</option>
                </select>
              </Field>
              <Field label={locale === 'ar' ? 'تاريخ البدء' : 'Start date'} htmlFor="sdate">
                <input id="sdate" type="date" required value={schedule.startDate}
                       onChange={(e) => setSchedule((s) => ({ ...s, startDate: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'عدد الفترات' : 'Periods'} htmlFor="periods">
                <input id="periods" type="number" min={1} max={60} dir="ltr" value={schedule.periods}
                       onChange={(e) => setSchedule((s) => ({ ...s, periods: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'مهلة (يوم)' : 'Grace (days)'} htmlFor="grace">
                <input id="grace" type="number" min={0} max={30} dir="ltr" value={schedule.graceDays}
                       onChange={(e) => setSchedule((s) => ({ ...s, graceDays: e.target.value }))} />
              </Field>
              <button type="submit" className="btn btn--sm btn--primary" disabled={addSchedule.pending}>{t('save')}</button>
            </div>
            <ErrorNotice error={addSchedule.error} />
          </form>
        </Card>
      ) : null}

      {canAct ? (
        <Card title={locale === 'ar' ? 'التعهدات' : 'Covenants'}>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await addCovenant.run()) onChanged(); }}>
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'يُقاس التعهد على مؤشر التقرير المنشور، وتُنشئ المخالفة إنذارًا وحالة تلقائيًا.'
                : 'A covenant is measured against a published report metric; a breach raises an alert and a case automatically.'}
            </p>
            <div className="grid grid--two">
              <Field label={locale === 'ar' ? 'الرمز' : 'Code'} htmlFor="cov-code">
                <input id="cov-code" type="text" dir="ltr" required value={covenant.code}
                       onChange={(e) => setCovenant((c) => ({ ...c, code: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'الوصف' : 'Label'} htmlFor="cov-label">
                <input id="cov-label" type="text" required minLength={5} value={covenant.labelAr}
                       onChange={(e) => setCovenant((c) => ({ ...c, labelAr: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'المؤشر' : 'Metric'} htmlFor="cov-metric"
                     hint={locale === 'ar' ? 'يطابق مفتاح المؤشر في التقرير' : 'Must match the report KPI key'}>
                <input id="cov-metric" type="text" dir="ltr" required value={covenant.metric}
                       onChange={(e) => setCovenant((c) => ({ ...c, metric: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'الشرط' : 'Operator'} htmlFor="cov-op">
                <select id="cov-op" value={covenant.operator}
                        onChange={(e) => setCovenant((c) => ({ ...c, operator: e.target.value }))}>
                  <option value="gte">{locale === 'ar' ? 'لا يقل عن' : 'At least'}</option>
                  <option value="lte">{locale === 'ar' ? 'لا يزيد عن' : 'At most'}</option>
                </select>
              </Field>
              <Field label={locale === 'ar' ? 'الحد' : 'Threshold'} htmlFor="cov-th">
                <input id="cov-th" type="number" dir="ltr" required value={covenant.threshold}
                       onChange={(e) => setCovenant((c) => ({ ...c, threshold: e.target.value }))} />
              </Field>
              <Field label={locale === 'ar' ? 'إجراء المخالفة' : 'Breach action'} htmlFor="cov-act">
                <select id="cov-act" value={covenant.breachAction}
                        onChange={(e) => setCovenant((c) => ({ ...c, breachAction: e.target.value }))}>
                  <option value="alert">{locale === 'ar' ? 'إنذار' : 'Alert'}</option>
                  <option value="escalate">{locale === 'ar' ? 'تصعيد' : 'Escalate'}</option>
                  <option value="suspend_distribution">{locale === 'ar' ? 'تعليق التوزيع' : 'Suspend distribution'}</option>
                </select>
              </Field>
            </div>
            <ErrorNotice error={addCovenant.error} />
            <button type="submit" className="btn btn--sm" disabled={addCovenant.pending}>{t('save')}</button>
          </form>
        </Card>
      ) : null}

      {canAct ? (
        <Card title={locale === 'ar' ? 'إجراءات المحفظة' : 'Portfolio actions'}>
          <ErrorNotice error={markDefault.error ?? workout.error ?? close.error} />
          <div className="row">
            {pool.status === 'operating' ? (
              <button type="button" className="btn btn--sm btn--danger" disabled={markDefault.pending}
                      onClick={async () => {
                        const r = await ask({
                          title: locale === 'ar' ? 'تسجيل تعثر' : 'Record a default',
                          danger: true,
                          confirmText: locale === 'ar' ? 'تسجيل التعثر' : 'Record default',
                          fields: [
                            { name: 'reason', minLength: 20, multiline: true,
                              label: locale === 'ar' ? 'سبب التعثر' : 'Default reason' },
                            { name: 'plan', minLength: 20, multiline: true,
                              label: locale === 'ar' ? 'خطة المعالجة' : 'Workout plan' },
                          ],
                        });
                        if (r && await markDefault.run({ reason: r.reason, plan: r.plan })) onChanged();
                      }}>
                {locale === 'ar' ? 'تسجيل تعثر' : 'Record default'}
              </button>
            ) : null}
            {['operating', 'default'].includes(pool.status) ? (
              <button type="button" className="btn btn--sm" disabled={workout.pending}
                      onClick={async () => {
                        const r = await ask({
                          title: locale === 'ar' ? 'بدء المعالجة' : 'Start a workout',
                          fields: [{ name: 'reason', minLength: 20, multiline: true,
                            label: locale === 'ar' ? 'سبب بدء المعالجة' : 'Workout reason' }],
                        });
                        if (r && await workout.run(r.reason)) onChanged();
                      }}>
                {locale === 'ar' ? 'بدء المعالجة' : 'Start workout'}
              </button>
            ) : null}
            {['operating', 'default', 'workout'].includes(pool.status) ? (
              <button type="button" className="btn btn--sm" disabled={close.pending}
                      onClick={async () => {
                        const r = await ask({
                          title: locale === 'ar' ? 'إغلاق نهائي' : 'Final close',
                          danger: true,
                          confirmText: locale === 'ar' ? 'تأكيد الإغلاق' : 'Confirm close',
                          fields: [
                            { name: 'reason', minLength: 20, multiline: true,
                              label: locale === 'ar' ? 'سبب الإغلاق' : 'Closing reason' },
                            { name: 'note', minLength: 10, multiline: true,
                              label: locale === 'ar' ? 'ملاحظة التسوية النهائية' : 'Final settlement note' },
                          ],
                        });
                        if (r && await close.run({ reason: r.reason, finalSettlementNote: r.note })) onChanged();
                      }}>
                {locale === 'ar' ? 'إغلاق نهائي' : 'Final close'}
              </button>
            ) : null}
          </div>
          <p className="small muted" style={{ marginBlockStart: '.7rem', marginBlockEnd: 0 }}>
            {locale === 'ar'
              ? 'يرفض النظام الإغلاق النهائي ما دامت هناك حركة مالية غير مكتملة أو فرق مطابقة مفتوح.'
              : 'The system refuses a final close while any money movement is in flight or a reconciliation break is open.'}
          </p>
        </Card>
      ) : null}
    </div>
  );
}

/* ── PRD §5: the state trail ─────────────────────────────────────────────── */

function TimelinePanel({ poolId }: { poolId: string }) {
  const { locale, formatDate } = useI18n();
  const timeline = useQuery<any>(`/pools/${poolId}/timeline`, [poolId]);

  return (
    <Card title={locale === 'ar' ? 'سجل الحالات' : 'State history'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'كل انتقال يحمل سببًا وفاعلًا ووقتًا. الانتقال العكسي لا يُحذف — يُسجَّل كحدث جديد.'
          : 'Every transition carries a reason, an actor and a time. A reverse move is never deleted — it is recorded as a new event.'}
      </p>
      {timeline.loading ? <Loading rows={4} /> : (timeline.data?.events ?? []).length === 0 ? <Empty /> : (
        <ul className="timeline" style={{ marginBlockStart: '.9rem' }}>
          {timeline.data.events.map((event: any, i: number) => (
            <li key={i}>
              <span className="timeline__dot" aria-hidden="true" />
              <div>
                <div className="row" style={{ gap: '.4rem' }}>
                  {event.from_state ? <StatusBadge status={event.from_state} /> : null}
                  <span aria-hidden="true">→</span>
                  <StatusBadge status={event.to_state} />
                </div>
                <div className="small">{event.reason}</div>
                <div className="small muted">
                  {event.actor ?? (locale === 'ar' ? 'النظام' : 'System')} · {formatDate(event.created_at, true)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
