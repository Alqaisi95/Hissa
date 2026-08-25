/**
 * The staff console (PRD §6 Investment Ops / Funds Ops / Compliance / Admin).
 * Every action here mirrors a server-side permission; the UI never offers a
 * button the API would refuse, and dual-control steps say so plainly.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { Tabs } from '../../components/ui.tsx';
import { DueDiligence } from './DueDiligence.tsx';
import { Committee } from './Committee.tsx';
import { FundsOps } from './FundsOps.tsx';
import { ComplianceOps } from './ComplianceOps.tsx';
import { Monitoring } from './Monitoring.tsx';
import { AdminSettings } from './AdminSettings.tsx';
import { Dashboard } from './Dashboard.tsx';
import { PoolAdmin } from './PoolAdmin.tsx';

type TabKey = 'overview' | 'pools' | 'dd' | 'committee' | 'funds' | 'monitoring' | 'compliance' | 'admin';

export function Console() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'overview', label: locale === 'ar' ? 'اللوحة' : 'Dashboard', visible: true },
    { key: 'pools', label: locale === 'ar' ? 'الفرص' : 'Pools',
      visible: auth.has('portfolio_ops', 'compliance', 'investment_analyst', 'auditor') },
    { key: 'dd', label: t('queueDd'), visible: auth.has('investment_analyst', 'compliance', 'auditor') },
    { key: 'committee', label: t('queueCommittee'), visible: auth.has('committee_member', 'investment_analyst', 'compliance', 'auditor') },
    { key: 'funds', label: t('queueFunds'), visible: auth.has('finance_ops', 'compliance', 'auditor') },
    { key: 'monitoring', label: locale === 'ar' ? 'المتابعة' : 'Monitoring', visible: auth.has('portfolio_ops', 'compliance', 'auditor') },
    { key: 'compliance', label: locale === 'ar' ? 'الامتثال' : 'Compliance', visible: auth.has('compliance', 'auditor') },
    { key: 'admin', label: t('settingsTitle'), visible: auth.has('system_admin', 'compliance', 'auditor') },
  ];

  return (
    <div className="stack">
      <h1>{t('consoleTitle')}</h1>

      <Tabs<TabKey> active={tab} onChange={setTab}
                    tabs={tabs.filter((item) => item.visible).map(({ key, label }) => ({ key, label }))} />

      {tab === 'overview' ? <Dashboard />
        : tab === 'pools' ? <PoolAdmin />
        : tab === 'dd' ? <DueDiligence />
        : tab === 'committee' ? <Committee />
        : tab === 'funds' ? <FundsOps />
        : tab === 'monitoring' ? <Monitoring />
        : tab === 'compliance' ? <ComplianceOps />
        : <AdminSettings />}
    </div>
  );
}
