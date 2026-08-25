/**
 * FR-601 / §9 — users, roles and the segregation of duties that governs them.
 * The role matrix is shown alongside the grant form, because the constraint that
 * matters (who may approve money, who may decide an investment) is a property of
 * the role, not of the person.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, StatusBadge,
} from '../../components/ui.tsx';

const ROLE_AR: Record<string, string> = {
  investor: 'مستثمر', project_owner: 'صاحب مشروع', investment_analyst: 'محلل استثمار',
  committee_member: 'عضو لجنة', compliance: 'امتثال', finance_ops: 'عمليات مالية',
  portfolio_ops: 'إدارة محفظة', system_admin: 'مسؤول نظام', auditor: 'مدقق',
};

export function AdminUsers() {
  const { t, locale, formatDate } = useI18n();
  const [search, setSearch] = useState('');
  const users = useQuery<any>(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`, [search]);
  const roles = useQuery<any>('/admin/roles');
  const [creating, setCreating] = useState(false);

  const setRoles = useMutation((p: { id: string; roles: string[]; reason: string }) =>
    api.post(`/admin/users/${p.id}/roles`, { roles: p.roles, reason: p.reason }));

  return (
    <div className="stack">
      <Card title={locale === 'ar' ? 'مصفوفة الأدوار' : 'Role matrix'}>
        <p className="small muted">
          {locale === 'ar'
            ? 'مسؤول النظام لا يملك اعتمادًا ماليًا ولا استثماريًا. الرقابة المزدوجة على الأموال تُفرض على مستوى المعاملة: لا يعتمد أحد طلبًا أنشأه هو.'
            : 'System admin holds no financial or investment approval. Dual control on money is enforced per transaction: nobody approves a request they raised.'}
        </p>
        {roles.loading ? <Loading rows={3} /> : (
          <div className="table-wrap" style={{ marginBlockStart: '.8rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الدور' : 'Role'}</th>
                  <th>{locale === 'ar' ? 'اعتماد مالي' : 'Approves money'}</th>
                  <th>{locale === 'ar' ? 'قرار استثماري' : 'Decides investment'}</th>
                  <th>{locale === 'ar' ? 'الصلاحيات' : 'Permissions'}</th>
                </tr>
              </thead>
              <tbody>
                {(roles.data?.roles ?? []).map((r: any) => (
                  <tr key={r.role}>
                    <td>{locale === 'ar' ? (ROLE_AR[r.role] ?? r.role) : r.role}</td>
                    <td>{r.canApproveMoney
                      ? <Badge tone="warning">{locale === 'ar' ? 'نعم' : 'Yes'}</Badge>
                      : <span className="muted">—</span>}</td>
                    <td>{r.canDecideInvestment
                      ? <Badge tone="warning">{locale === 'ar' ? 'نعم' : 'Yes'}</Badge>
                      : <span className="muted">—</span>}</td>
                    <td className="small mono">{r.permissions.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating
        ? <CreateUser roleList={(roles.data?.roles ?? []).map((r: any) => r.role)}
                      onDone={() => { setCreating(false); users.reload(); }}
                      onCancel={() => setCreating(false)} />
        : (
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              {locale === 'ar' ? 'إضافة مستخدم' : 'Add a user'}
            </button>
          </div>
        )}

      <Card
        title={locale === 'ar' ? 'المستخدمون' : 'Users'}
        actions={
          <input type="text" placeholder={t('search')} value={search}
                 style={{ maxWidth: 220 }} onChange={(e) => setSearch(e.target.value)} />
        }
      >
        <ErrorNotice error={setRoles.error} />
        {users.loading ? <Loading rows={4} /> : (users.data?.items ?? []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('fullName')}</th><th>{t('email')}</th><th>{t('status')}</th>
                  <th>MFA</th><th>{locale === 'ar' ? 'الأدوار' : 'Roles'}</th><th>{t('date')}</th><th />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u: any) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td className="small" dir="ltr">{u.email ?? '—'}</td>
                    <td><StatusBadge status={u.status} /></td>
                    <td>{u.mfa_enabled === 1 ? <Badge tone="positive">✓</Badge> : <span className="muted">—</span>}</td>
                    <td>
                      <div className="row" style={{ gap: '.25rem' }}>
                        {u.roles.map((role: string) => (
                          <Badge key={role}>{locale === 'ar' ? (ROLE_AR[role] ?? role) : role}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="small">{formatDate(u.created_at)}</td>
                    <td>
                      <button type="button" className="btn btn--sm" disabled={setRoles.pending}
                              onClick={async () => {
                                const next = window.prompt(
                                  locale === 'ar' ? 'الأدوار مفصولة بفاصلة' : 'Roles, comma separated',
                                  u.roles.join(','));
                                if (next === null) return;
                                const reason = window.prompt(locale === 'ar' ? 'سبب التغيير (5 أحرف)' : 'Reason (5+)') ?? '';
                                if (reason.length < 5) return;
                                const list = next.split(',').map((r) => r.trim()).filter(Boolean);
                                if (await setRoles.run({ id: u.id, roles: list, reason })) users.reload();
                              }}>
                        {locale === 'ar' ? 'الأدوار' : 'Roles'}
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

function CreateUser({ roleList, onDone, onCancel }: {
  roleList: string[]; onDone: () => void; onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', locale: 'ar' });
  const [roles, setRoles] = useState<string[]>([]);
  const create = useMutation(() => api.post('/admin/users', { ...form, roles }));

  return (
    <Card title={locale === 'ar' ? 'مستخدم جديد' : 'New user'}
          actions={<button type="button" className="btn btn--sm" onClick={onCancel}>{t('cancel')}</button>}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await create.run()) onDone(); }}>
        <div className="grid grid--two">
          <Field label={t('fullName')} htmlFor="u-name">
            <input id="u-name" type="text" required minLength={3} value={form.fullName}
                   onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </Field>
          <Field label={t('email')} htmlFor="u-email">
            <input id="u-email" type="email" dir="ltr" required value={form.email}
                   onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label={t('password')} htmlFor="u-pass"
                 hint={locale === 'ar' ? '12 حرفًا على الأقل' : 'At least 12 characters'}>
            <input id="u-pass" type="password" required minLength={12} value={form.password}
                   onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'اللغة' : 'Locale'} htmlFor="u-loc">
            <select id="u-loc" value={form.locale}
                    onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}>
              <option value="ar">العربية</option><option value="en">English</option>
            </select>
          </Field>
        </div>

        <div>
          <strong className="small">{locale === 'ar' ? 'الأدوار' : 'Roles'}</strong>
          <div className="stack-sm" style={{ marginBlockStart: '.4rem' }}>
            {roleList.map((role) => (
              <label key={role} className="checkbox">
                <input type="checkbox" checked={roles.includes(role)}
                       onChange={(e) => setRoles((p) => e.target.checked ? [...p, role] : p.filter((r) => r !== role))} />
                <span>{locale === 'ar' ? (ROLE_AR[role] ?? role) : role}</span>
              </label>
            ))}
          </div>
        </div>

        <ErrorNotice error={create.error} />
        <button type="submit" className="btn btn--primary" disabled={create.pending || roles.length === 0}>
          {t('save')}
        </button>
      </form>
    </Card>
  );
}
