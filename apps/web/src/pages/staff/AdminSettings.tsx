/** FR-603 / FR-606 / FR-607 — effective-dated settings, audit log and exports. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Field, Loading, StatusBadge, Tabs } from '../../components/ui.tsx';
import { AdminUsers } from './AdminUsers.tsx';
import { AdminContent } from './AdminContent.tsx';

export function AdminSettings() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'settings' | 'users' | 'content' | 'audit' | 'exports'>('settings');

  return (
    <div className="stack">
      <Tabs<'settings' | 'users' | 'content' | 'audit' | 'exports'>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'settings', label: t('settingsTitle') },
          { key: 'users', label: locale === 'ar' ? 'المستخدمون' : 'Users' },
          { key: 'content', label: locale === 'ar' ? 'المحتوى والمهام' : 'Content & jobs' },
          { key: 'audit', label: t('auditLog') },
          { key: 'exports', label: t('exportsTitle') },
        ]}
      />
      {tab === 'settings' ? <Settings />
        : tab === 'users' ? <AdminUsers />
        : tab === 'content' ? <AdminContent />
        : tab === 'audit' ? <AuditLog /> : <Exports />}
    </div>
  );
}

function Settings() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const settings = useQuery<any>('/admin/settings');
  const [draft, setDraft] = useState({ key: '', value: '', effectiveFrom: '', note: '' });

  const propose = useMutation(() => api.post('/admin/settings', {
    key: draft.key, value: JSON.parse(draft.value),
    effectiveFrom: new Date(draft.effectiveFrom).toISOString(), note: draft.note,
  }));
  const approve = useMutation((id: string) => api.post(`/admin/settings/${id}/approve`));

  if (settings.loading) return <Loading rows={5} />;
  if (settings.error) return <ErrorNotice error={settings.error} onRetry={settings.reload} />;

  return (
    <div className="stack">
      <div className="notice notice--info small">
        {locale === 'ar'
          ? 'الحدود والرسوم والقوالب إعدادات مؤرخة النفاذ. لا يطبَّق أي تغيير بأثر رجعي، ويلزم اعتماد مستخدم ثانٍ.'
          : 'Limits, fees and templates are effective-dated settings. No change applies retroactively, and a second user must approve it.'}
      </div>

      <Card title={locale === 'ar' ? 'الإعدادات السارية' : 'Active settings'}>
        <div className="stack-sm">
          {settings.data.active.map((setting: any) => (
            <details key={setting.key} className="panel">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{setting.key}</summary>
              <pre className="small mono" style={{ overflowX: 'auto', marginBlockEnd: 0 }}>
                {JSON.stringify(setting.value, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </Card>

      <Card title={locale === 'ar' ? 'مقترحات بانتظار الاعتماد' : 'Proposals pending approval'}>
        <ErrorNotice error={approve.error} />
        {settings.data.pending.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'المفتاح' : 'Key'}</th><th>{locale === 'ar' ? 'يسري من' : 'Effective from'}</th>
                  <th>{locale === 'ar' ? 'المبرر' : 'Note'}</th><th />
                </tr>
              </thead>
              <tbody>
                {settings.data.pending.map((item: any) => (
                  <tr key={item.id}>
                    <td className="small">{item.key}</td>
                    <td className="small">{formatDate(item.effective_from)}</td>
                    <td className="small">{item.note}</td>
                    <td>
                      {item.created_by === auth.user?.id ? (
                        <span className="small muted">{locale === 'ar' ? 'أنت المقترح' : 'You proposed this'}</span>
                      ) : (
                        <button type="button" className="btn btn--sm btn--primary" disabled={approve.pending}
                                onClick={async () => { if (await approve.run(item.id)) settings.reload(); }}>
                          {t('approve')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={locale === 'ar' ? 'اقتراح تغيير' : 'Propose a change'}>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await propose.run()) { setDraft({ key: '', value: '', effectiveFrom: '', note: '' }); settings.reload(); }
          }}
        >
          <Field label={locale === 'ar' ? 'المفتاح' : 'Key'} htmlFor="setting-key">
            <select id="setting-key" value={draft.key} required
                    onChange={(e) => {
                      const key = e.target.value;
                      const current = settings.data.active.find((s: any) => s.key === key);
                      setDraft((d) => ({ ...d, key, value: current ? JSON.stringify(current.value, null, 2) : '' }));
                    }}>
              <option value="">—</option>
              {settings.data.active.map((setting: any) => <option key={setting.key} value={setting.key}>{setting.key}</option>)}
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'القيمة (JSON)' : 'Value (JSON)'} htmlFor="setting-value">
            <textarea id="setting-value" rows={8} dir="ltr" className="mono" required value={draft.value}
                      onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'تاريخ النفاذ' : 'Effective from'} htmlFor="effective"
                 hint={locale === 'ar' ? 'يجب أن يكون في المستقبل' : 'Must be in the future'}>
            <input id="effective" type="date" required value={draft.effectiveFrom}
                   onChange={(e) => setDraft((d) => ({ ...d, effectiveFrom: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'المبرر' : 'Justification'} htmlFor="setting-note">
            <textarea id="setting-note" rows={2} minLength={10} required value={draft.note}
                      onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
          </Field>
          <ErrorNotice error={propose.error} />
          <button type="submit" className="btn btn--primary" disabled={propose.pending}>{t('submit')}</button>
        </form>
      </Card>
    </div>
  );
}

function AuditLog() {
  const { t, locale, formatDate } = useI18n();
  const [filters, setFilters] = useState({ entityType: '', action: '' });
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== '') as [string, string][],
  ).toString();
  const audit = useQuery<any>(`/admin/audit?${query}&limit=150`, [query]);

  return (
    <Card
      title={t('auditLog')}
      actions={<Badge tone="info">{locale === 'ar' ? 'غير قابل للتعديل' : 'Append-only'}</Badge>}
    >
      <div className="filters" style={{ marginBlockEnd: '1rem' }}>
        <Field label={locale === 'ar' ? 'نوع الكيان' : 'Entity type'} htmlFor="entity-type">
          <input id="entity-type" type="text" dir="ltr" value={filters.entityType}
                 onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} />
        </Field>
        <Field label={locale === 'ar' ? 'الإجراء' : 'Action'} htmlFor="action">
          <input id="action" type="text" dir="ltr" value={filters.action}
                 onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
        </Field>
      </div>

      {audit.loading ? <Loading /> : (audit.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('date')}</th><th>{locale === 'ar' ? 'الفاعل' : 'Actor'}</th>
                <th>{locale === 'ar' ? 'الإجراء' : 'Action'}</th><th>{locale === 'ar' ? 'الكيان' : 'Entity'}</th>
                <th>{t('reason')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.items.map((event: any) => (
                <tr key={event.id}>
                  <td className="small">{formatDate(event.created_at, true)}</td>
                  <td className="small">{event.actor_name ?? (locale === 'ar' ? 'النظام' : 'System')}</td>
                  <td className="small mono">{event.action}</td>
                  <td className="small mono">{event.entity_type}/{String(event.entity_id).slice(0, 8)}</td>
                  <td className="small">{event.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Exports() {
  const { t, locale } = useI18n();
  const exports = useQuery<any>('/admin/exports');
  const [range, setRange] = useState({ from: '', to: '' });

  if (exports.loading) return <Loading rows={4} />;

  const params = new URLSearchParams();
  if (range.from) params.set('from', `${range.from}T00:00:00.000Z`);
  if (range.to) params.set('to', `${range.to}T23:59:59.999Z`);

  return (
    <Card title={t('exportsTitle')}>
      <div className="filters" style={{ marginBlockEnd: '1rem' }}>
        <Field label={locale === 'ar' ? 'من' : 'From'} htmlFor="export-from">
          <input id="export-from" type="date" value={range.from}
                 onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </Field>
        <Field label={locale === 'ar' ? 'إلى' : 'To'} htmlFor="export-to">
          <input id="export-to" type="date" value={range.to}
                 onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </Field>
      </div>

      <div className="stack-sm">
        {(exports.data?.available ?? []).map((item: any) => (
          <div key={item.key} className="row row--between panel">
            <span>{item.label}</span>
            <div className="row" style={{ gap: '.4rem' }}>
              <a className="btn btn--sm" href={`/api/admin/exports/${item.key}?${params}&format=csv`}>CSV</a>
              <a className="btn btn--sm" href={`/api/admin/exports/${item.key}?${params}&format=json`}
                 target="_blank" rel="noreferrer">JSON</a>
            </div>
          </div>
        ))}
      </div>

      <p className="small muted" style={{ marginBlockStart: '1rem', marginBlockEnd: 0 }}>
        {locale === 'ar'
          ? 'يحمل كل تصدير الفلاتر والفترة ووقت الاستخراج، ويُسجل في سجل التدقيق ليكون قابلًا لإعادة الإنتاج.'
          : 'Every export carries its filters, period and extraction time, and is recorded in the audit log so it can be reproduced.'}
      </p>
    </Card>
  );
}
