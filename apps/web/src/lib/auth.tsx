/** Session context: current user, roles and the outstanding onboarding steps. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, getToken, ApiError } from './api.ts';

export interface SessionUser {
  id: string; full_name: string; email: string | null; phone: string | null;
  locale: 'ar' | 'en'; status: string; mfaEnabled: boolean;
}

export interface InvestorProfile {
  classification: string; kycStatus: string;
  suitabilityResult: string | null; suitabilityTakenAt: string | null; kycExpiresAt: string | null;
}

interface AuthValue {
  user: SessionUser | null;
  roles: string[];
  investorProfile: InvestorProfile | null;
  outstanding: string[];
  entities: any[];
  mfaPassed: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<{ mfaRequired: boolean; devOtp?: string }>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  has: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    user: SessionUser | null; roles: string[]; investorProfile: InvestorProfile | null;
    outstanding: string[]; entities: any[]; mfaPassed: boolean;
  }>({ user: null, roles: [], investorProfile: null, outstanding: [], entities: [], mfaPassed: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setState({ user: null, roles: [], investorProfile: null, outstanding: [], entities: [], mfaPassed: false });
      setLoading(false);
      return;
    }
    try {
      const me = await api.get('/identity/me');
      setState({
        user: me.user, roles: me.roles, investorProfile: me.investorProfile,
        outstanding: me.outstanding ?? [], entities: me.entities ?? [], mfaPassed: me.mfaPassed,
      });
    } catch (error) {
      // An expired or revoked session clears itself rather than looping.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setToken(null);
      setState({ user: null, roles: [], investorProfile: null, outstanding: [], entities: [], mfaPassed: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const result = await api.post('/identity/login', { identifier, password });
    setToken(result.token);
    await refresh();
    return { mfaRequired: Boolean(result.mfaRequired), devOtp: result.devOtp };
  }, [refresh]);

  const verifyMfa = useCallback(async (code: string) => {
    await api.post('/identity/mfa/verify', { code });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try { await api.post('/identity/logout'); } catch { /* the local session is cleared regardless */ }
    setToken(null);
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthValue>(() => ({
    ...state, loading, refresh, signIn, verifyMfa, signOut,
    has: (...roles: string[]) => roles.some((role) => state.roles.includes(role)),
  }), [state, loading, refresh, signIn, verifyMfa, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export const STAFF_ROLES = [
  'investment_analyst', 'committee_member', 'compliance',
  'finance_ops', 'portfolio_ops', 'system_admin', 'auditor',
];
