/**
 * NFR-008 — Arabic RTL and English LTR without mixing or clipping. The document
 * direction and language attributes follow the active locale so the whole tree
 * mirrors correctly, and the choice persists across sessions.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { STRINGS, type StringKey } from './strings.ts';

export type Locale = 'ar' | 'en';

interface I18nValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Picks the Arabic or English member of a bilingual pair coming from the API. */
  pick: (ar?: string | null, en?: string | null) => string;
  setLocale: (locale: Locale) => void;
  formatOmr: (baisa: number | null | undefined, options?: { decimals?: number }) => string;
  formatDate: (iso: string | null | undefined, withTime?: boolean) => string;
  formatPercent: (bps: number | null | undefined) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'hissa.locale';

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch { /* private mode or blocked storage — fall through to the default */ }
  return 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
  }, [locale, dir]);

  const t = useCallback((key: StringKey, vars?: Record<string, string | number>) => {
    const template = STRINGS[key]?.[locale] ?? String(key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? `{${name}}`));
  }, [locale]);

  const pick = useCallback((ar?: string | null, en?: string | null) =>
    (locale === 'ar' ? ar || en : en || ar) ?? '', [locale]);

  // OMR carries three decimals (PRD §10.1); amounts arrive as integer baisa.
  const formatOmr = useCallback((baisa: number | null | undefined, options?: { decimals?: number }) => {
    if (baisa === null || baisa === undefined || Number.isNaN(baisa)) return '—';
    const decimals = options?.decimals ?? 3;
    const value = baisa / 1000;
    // Latin digits in both locales: Omani financial documents and statements use
    // them, and mixing numeral systems across a page reads as an error.
    const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-OM', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value);
    return locale === 'ar' ? `${formatted} ر.ع` : `OMR ${formatted}`;
  }, [locale]);

  const formatDate = useCallback((iso: string | null | undefined, withTime = false) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', {
      // Times are stored UTC and presented in Asia/Muscat (PRD §10.1).
      timeZone: 'Asia/Muscat', dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' as const } : {}),
    }).format(date);
  }, [locale]);

  const formatPercent = useCallback((bps: number | null | undefined) => {
    if (bps === null || bps === undefined) return '—';
    const value = bps / 100;
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-OM', {
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(value) + '%';
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale, dir, t, pick, formatOmr, formatDate, formatPercent,
    setLocale: setLocaleState,
  }), [locale, dir, t, pick, formatOmr, formatDate, formatPercent]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
