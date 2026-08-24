import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { Loading } from './ui.tsx';
import { useI18n } from '../lib/i18n.tsx';

/** Sends an unauthenticated visitor to sign-in, remembering where they were headed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) return <Loading />;
  if (!auth.user) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

/** Mirrors the server's RBAC so the UI never offers an action the API will refuse. */
export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const auth = useAuth();
  const { locale } = useI18n();
  const location = useLocation();

  if (auth.loading) return <Loading />;
  if (!auth.user) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  if (!auth.has(...roles)) {
    return (
      <div className="notice notice--danger" role="alert">
        {locale === 'ar'
          ? 'لا تملك صلاحية للوصول إلى هذه الصفحة.'
          : 'You do not have permission to view this page.'}
      </div>
    );
  }
  return <>{children}</>;
}
