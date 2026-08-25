import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../lib/i18n.tsx';
import { useAuth, STAFF_ROLES } from '../lib/auth.tsx';
import { useQuery } from '../lib/useApi.ts';

export function Layout() {
  const { t, locale, setLocale, pick } = useI18n();
  const auth = useAuth();
  const location = useLocation();
  const banner = useQuery<{ banner: any }>('/public/banner', [auth.user?.id]);

  const isStaff = auth.has(...STAFF_ROLES);
  const isOwner = auth.has('project_owner');

  return (
    <div className="app">
      {/* BR-013 — the capital-loss warning is present platform-wide, not only at checkout. */}
      <div className="risk-banner">{t('riskBanner')}</div>

      {banner.data?.banner ? (
        <div className={`risk-banner notice--${banner.data.banner.severity === 'critical' ? 'danger' : 'info'}`}
             style={{ background: 'var(--info-soft)', color: 'var(--info)', borderColor: '#cfe0ef' }} role="status">
          {pick(banner.data.banner.message_ar, banner.data.banner.message_en)}
        </div>
      ) : null}

      <header className="header">
        <div className="header__inner">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true">ح</span>
            <span>
              {t('brand')}
              <span className="brand__tag">{t('brandTagline')}</span>
            </span>
          </Link>

          <nav className="nav" aria-label="main">
            <NavLink to="/opportunities">{t('navOpportunities')}</NavLink>
            <NavLink to="/how-it-works">{t('navHowItWorks')}</NavLink>
            <NavLink to="/risks">{t('navRisks')}</NavLink>
            <NavLink to="/fees">{t('navFees')}</NavLink>
            <NavLink to="/faq">{t('navFaq')}</NavLink>
            {auth.user && !isStaff ? <NavLink to="/portfolio">{t('navPortfolio')}</NavLink> : null}
            {auth.user ? <NavLink to="/notifications">{t('navNotifications')}</NavLink> : null}
            {auth.user ? <NavLink to="/complaints">{t('navComplaints')}</NavLink> : null}
            {isOwner ? <NavLink to="/project">{t('navProjectPortal')}</NavLink> : null}
            {isStaff ? <NavLink to="/console">{t('navConsole')}</NavLink> : null}
          </nav>

          <div className="spacer" />

          <div className="row" style={{ gap: '.4rem' }}>
            <button type="button" className="btn btn--ghost btn--sm"
                    onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
                    lang={locale === 'ar' ? 'en' : 'ar'}>
              {t('languageToggle')}
            </button>

            {auth.user ? (
              <>
                <NavLink to="/account" className="btn btn--sm">{auth.user.full_name.split(' ')[0]}</NavLink>
                <button type="button" className="btn btn--sm" onClick={() => void auth.signOut()}>{t('signOut')}</button>
              </>
            ) : (
              <>
                <Link to="/sign-in" className="btn btn--sm"
                      state={{ from: location.pathname }}>{t('signIn')}</Link>
                <Link to="/register" className="btn btn--primary btn--sm">{t('register')}</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <p style={{ margin: 0 }}>{t('regulatoryNote')}</p>
          <p style={{ margin: 0 }}>{t('footerRegulator')}</p>
          <p style={{ margin: 0 }}>{t('footerData')}</p>
          <p style={{ margin: 0 }}>{t('footerNotAdvice')}</p>
          <p style={{ margin: 0 }} className="small">
            © {new Date().getFullYear()} {t('brand')} — Hissa Pools
          </p>
        </div>
      </footer>
    </div>
  );
}
