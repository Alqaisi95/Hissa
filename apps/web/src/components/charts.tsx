/**
 * Chart primitives.
 *
 * Colour is not hand-picked here. The categorical slots and the teal ordinal ramp
 * were both run through the palette validator (lightness band, chroma floor,
 * colour-vision separation, normal-vision floor, contrast) against this product's
 * own light and dark chart surfaces, and both modes were validated separately
 * rather than flipped. Slot 3 sits below 3:1 on the light surface, which is legal
 * only alongside a second channel — so every chart here ships direct labels and a
 * table view, and identity never rests on colour alone.
 *
 * Mark specs are fixed: bars cap at 24px with a 4px rounded data-end squared at the
 * baseline, lines are 2px, markers are at least 8px with a 2px surface ring, area
 * fills are a 10% wash, and gridlines are recessive hairlines.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';

/* ── palette ─────────────────────────────────────────────────────────────── */

export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark:  ['#3987e5', '#d95926', '#199e70'],
} as const;

/** Ordinal ramp for stages and bands, where order itself carries meaning. */
export const ORDINAL = {
  light: ['#7cbfc2', '#52a4a8', '#2b878b', '#136a6e', '#0a4649'],
  dark:  ['#1d7478', '#2b959a', '#43b0b4', '#67c8cb', '#96dee0'],
} as const;

/** Reserved status scale — never reused as a series colour. */
export const STATUS = {
  good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
} as const;

function useScheme(): 'light' | 'dark' {
  const [scheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  return scheme;
}

export function useSeriesColors(): { cat: readonly string[]; ord: readonly string[] } {
  const scheme = useScheme();
  return { cat: CATEGORICAL[scheme], ord: ORDINAL[scheme] };
}

/** Steps an ordinal ramp to exactly `n` stops without inventing hues between them. */
function rampFor(ramp: readonly string[], n: number): string[] {
  if (n <= 1) return [ramp[ramp.length - 1]];
  return Array.from({ length: n }, (_, i) =>
    ramp[Math.round((i * (ramp.length - 1)) / (n - 1))]);
}

/* ── shared chrome ───────────────────────────────────────────────────────── */

interface FrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  legend?: { label: string; color: string }[];
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  action?: ReactNode;
}

/**
 * Every chart carries its own table view. It is the accessibility channel and the
 * relief for the one categorical slot that sits under 3:1 on the light surface.
 */
function Frame({ title, subtitle, legend, table, children, action }: FrameProps) {
  const { locale } = useI18n();
  const [asTable, setAsTable] = useState(false);
  const id = useId();

  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <figcaption className="chart__head">
        <div>
          <div className="chart__title" id={`${id}-t`}>{title}</div>
          {subtitle ? <div className="chart__sub">{subtitle}</div> : null}
        </div>
        <div className="row" style={{ gap: '.4rem' }}>
          {action}
          <button
            type="button" className="btn btn--sm btn--ghost"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? (locale === 'ar' ? 'رسم' : 'Chart') : (locale === 'ar' ? 'جدول' : 'Table')}
          </button>
        </div>
      </figcaption>

      {legend && legend.length > 1 ? (
        <ul className="chart__legend">
          {legend.map((item) => (
            <li key={item.label}>
              <span className="chart__swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {asTable ? (
        <div className="scroller">
          <table className="data">
            <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => (
                  <td key={j} className={j === 0 ? '' : 'num'}>{cell}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : children}
    </figure>
  );
}

/** Short axis labels: the unit lives in the title, so ticks carry magnitude only. */
export function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`;
  if (abs >= 1_000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

/* ── line / area over time ───────────────────────────────────────────────── */

export interface SeriesPoint { label: string; value: number }

export function TrendChart({ title, subtitle, points, valueFormat, tickFormat, height = 190, area = true }: {
  title: ReactNode; subtitle?: ReactNode; points: SeriesPoint[];
  valueFormat: (v: number) => string; tickFormat?: (v: number) => string;
  height?: number; area?: boolean;
}) {
  const { locale } = useI18n();
  const { cat } = useSeriesColors();
  const colour = cat[0];
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();

  const tick = tickFormat ?? compactNumber;
  const W = 640, H = height, PAD = { t: 12, r: 14, b: 26, l: 46 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const x = (i: number) => points.length <= 1
    ? PAD.l
    : PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1);
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const fill = `${path}L${x(points.length - 1).toFixed(1)},${H - PAD.b}L${x(0).toFixed(1)},${H - PAD.b}Z`;
  const last = points.length - 1;

  if (points.length === 0) {
    return (
      <Frame title={title} subtitle={subtitle} table={{ head: [], rows: [] }}>
        <p className="muted small" style={{ padding: '1.5rem 0', textAlign: 'center' }}>
          {locale === 'ar' ? 'لا توجد بيانات في هذه الفترة.' : 'No data in this period.'}
        </p>
      </Frame>
    );
  }

  return (
    <Frame
      title={title} subtitle={subtitle}
      table={{
        head: [locale === 'ar' ? 'الفترة' : 'Period', locale === 'ar' ? 'القيمة' : 'Value'],
        rows: points.map((p) => [p.label, valueFormat(p.value)]),
      }}
    >
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }}
             onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart__grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart__tick">
                {tick(t)}
              </text>
            </g>
          ))}

          {area ? <path d={fill} fill={colour} opacity={0.1} /> : null}
          <path d={path} fill="none" stroke={colour} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />

          {/* End marker: 8px with a 2px ring in the surface colour. */}
          <circle cx={x(last)} cy={y(points[last].value)} r={4} fill={colour}
                  className="chart__marker" />

          {hover !== null ? (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="chart__crosshair" />
              <circle cx={x(hover)} cy={y(points[hover].value)} r={4.5} fill={colour} className="chart__marker" />
            </>
          ) : null}

          {/* Hit targets are wider than the marks. */}
          {points.map((p, i) => (
            <rect key={i} x={x(i) - (W / points.length) / 2} y={0}
                  width={W / points.length} height={H} fill="transparent"
                  onMouseEnter={() => setHover(i)}>
              <title>{`${p.label}: ${valueFormat(p.value)}`}</title>
            </rect>
          ))}

          <text x={PAD.l} y={H - 8} className="chart__tick">{points[0].label}</text>
          <text x={W - PAD.r} y={H - 8} textAnchor="end" className="chart__tick">{points[last].label}</text>
        </svg>

        {hover !== null ? (
          <div className="chart__tip" style={{ insetInlineStart: `${(x(hover) / W) * 100}%` }}>
            <strong>{points[hover].label}</strong>
            <span className="num">{valueFormat(points[hover].value)}</span>
          </div>
        ) : (
          <div className="chart__endlabel">
            <span className="num">{valueFormat(points[last].value)}</span>
          </div>
        )}
        <span className="visually-hidden" id={`${id}-desc`}>
          {`${points.length} points, ending at ${valueFormat(points[last].value)}`}
        </span>
      </div>
    </Frame>
  );
}

/* ── horizontal bars: nominal categories, one hue ────────────────────────── */

export function BarList({ title, subtitle, items, valueFormat, ordinal = false, action }: {
  title: ReactNode; subtitle?: ReactNode;
  items: { label: string; value: number; note?: string }[];
  valueFormat: (v: number) => string; ordinal?: boolean; action?: ReactNode;
}) {
  const { locale } = useI18n();
  const { cat, ord } = useSeriesColors();
  const max = Math.max(1, ...items.map((i) => i.value));
  // Nominal categories all take slot 1 — bar length already encodes the value, so
  // spending the identity channel on it would say nothing new.
  const colours = ordinal ? rampFor(ord, items.length) : items.map(() => cat[0]);

  return (
    <Frame
      title={title} subtitle={subtitle} action={action}
      table={{
        head: [locale === 'ar' ? 'الفئة' : 'Category', locale === 'ar' ? 'القيمة' : 'Value'],
        rows: items.map((i) => [i.label, valueFormat(i.value)]),
      }}
    >
      {items.length === 0 ? (
        <p className="muted small" style={{ padding: '1rem 0' }}>
          {locale === 'ar' ? 'لا توجد بيانات.' : 'No data.'}
        </p>
      ) : (
        <ul className="barlist">
          {items.map((item, i) => (
            <li key={item.label} className="barlist__row">
              <span className="barlist__label" title={item.label}>{item.label}</span>
              <span className="barlist__track">
                <span
                  className="barlist__bar"
                  style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%`, background: colours[i] }}
                />
              </span>
              <span className="barlist__value num">{valueFormat(item.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/* ── funnel: ordinal stages ──────────────────────────────────────────────── */

export function FunnelChart({ title, subtitle, stages }: {
  title: ReactNode; subtitle?: ReactNode;
  stages: { label: string; value: number }[];
}) {
  const { locale } = useI18n();
  const { ord } = useSeriesColors();
  const colours = rampFor(ord, stages.length);
  const top = Math.max(1, stages[0]?.value ?? 1);

  return (
    <Frame
      title={title} subtitle={subtitle}
      table={{
        head: [locale === 'ar' ? 'المرحلة' : 'Stage', locale === 'ar' ? 'العدد' : 'Count',
               locale === 'ar' ? 'من المرحلة السابقة' : 'From previous'],
        rows: stages.map((s, i) => [
          s.label, s.value,
          i === 0 ? '—' : `${stages[i - 1].value ? Math.round((s.value / stages[i - 1].value) * 100) : 0}%`,
        ]),
      }}
    >
      <ul className="funnel">
        {stages.map((stage, i) => {
          const prev = i === 0 ? null : stages[i - 1].value;
          const step = prev ? Math.round((stage.value / Math.max(1, prev)) * 100) : null;
          return (
            <li key={stage.label} className="funnel__row">
              <span className="funnel__label">{stage.label}</span>
              <span className="funnel__track">
                <span className="funnel__bar"
                      style={{ width: `${Math.max(2, (stage.value / top) * 100)}%`, background: colours[i] }} />
              </span>
              <span className="funnel__value num">
                {stage.value}
                {step !== null ? <em className="funnel__step">{step}%</em> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

/* ── grouped columns: actual vs forecast ─────────────────────────────────── */

export function ComparisonChart({ title, subtitle, points, labels, valueFormat, tickFormat }: {
  title: ReactNode; subtitle?: ReactNode;
  points: { label: string; a: number; b: number | null }[];
  labels: [string, string]; valueFormat: (v: number) => string; tickFormat?: (v: number) => string;
}) {
  const { locale } = useI18n();
  const { cat } = useSeriesColors();
  const [hover, setHover] = useState<number | null>(null);

  const tick = tickFormat ?? compactNumber;
  const W = 640, H = 210, PAD = { t: 14, r: 14, b: 30, l: 46 };
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b ?? 0]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);

  const band = (W - PAD.l - PAD.r) / Math.max(1, points.length);
  const barW = Math.min(24, (band - 10) / 2);   // capped at 24px, air either side

  return (
    <Frame
      title={title} subtitle={subtitle}
      legend={[{ label: labels[0], color: cat[0] }, { label: labels[1], color: cat[1] }]}
      table={{
        head: [locale === 'ar' ? 'الفترة' : 'Period', labels[0], labels[1]],
        rows: points.map((p) => [p.label, valueFormat(p.a), p.b === null ? '—' : valueFormat(p.b)]),
      }}
    >
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             style={{ width: '100%', height: 'auto', display: 'block', direction: 'ltr' }}
             onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart__grid" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart__tick">{tick(t)}</text>
            </g>
          ))}

          {points.map((p, i) => {
            const cx = PAD.l + band * i + band / 2;
            // The 2px gap between the pair is surface showing through, not a stroke.
            const ax = cx - barW - 1, bx = cx + 1;
            return (
              <g key={p.label} onMouseEnter={() => setHover(i)}>
                <rect x={ax} y={y(p.a)} width={barW} height={Math.max(0, H - PAD.b - y(p.a))}
                      fill={cat[0]} rx={4} />
                <rect x={ax} y={Math.max(y(p.a), H - PAD.b - 4)} width={barW}
                      height={Math.min(4, Math.max(0, H - PAD.b - y(p.a)))} fill={cat[0]} />
                {p.b !== null ? (
                  <>
                    <rect x={bx} y={y(p.b)} width={barW} height={Math.max(0, H - PAD.b - y(p.b))}
                          fill={cat[1]} rx={4} />
                    <rect x={bx} y={Math.max(y(p.b), H - PAD.b - 4)} width={barW}
                          height={Math.min(4, Math.max(0, H - PAD.b - y(p.b)))} fill={cat[1]} />
                  </>
                ) : null}
                <rect x={PAD.l + band * i} y={0} width={band} height={H} fill="transparent">
                  <title>{`${p.label} — ${labels[0]}: ${valueFormat(p.a)}${p.b === null ? '' : ` · ${labels[1]}: ${valueFormat(p.b)}`}`}</title>
                </rect>
                <text x={cx} y={H - 10} textAnchor="middle" className="chart__tick">{p.label}</text>
              </g>
            );
          })}
        </svg>

        {hover !== null ? (
          <div className="chart__tip chart__tip--static">
            <strong>{points[hover].label}</strong>
            <span><span className="chart__swatch" style={{ background: cat[0] }} />{labels[0]} <span className="num">{valueFormat(points[hover].a)}</span></span>
            {points[hover].b !== null
              ? <span><span className="chart__swatch" style={{ background: cat[1] }} />{labels[1]} <span className="num">{valueFormat(points[hover].b!)}</span></span>
              : null}
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

/* ── progress meter: one measure against a target ────────────────────────── */

export function ProgressMeter({ label, value, target, valueFormat, tone = 'brand' }: {
  label: ReactNode; value: number; target: number;
  valueFormat: (v: number) => string; tone?: 'brand' | 'good' | 'critical';
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const colour = tone === 'good' ? STATUS.good : tone === 'critical' ? STATUS.critical : undefined;

  return (
    <div className="meter-block">
      <div className="meter-block__head">
        <span>{label}</span>
        <span className="num">{valueFormat(value)} / {valueFormat(target)}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__bar" style={{ width: `${pct}%`, ...(colour ? { background: colour } : {}) }} />
      </div>
    </div>
  );
}

/* ── health tile: reserved status colours, always with a label ───────────── */

export function HealthTile({ label, value, state, hint }: {
  label: ReactNode; value: ReactNode;
  state: 'good' | 'warning' | 'serious' | 'critical'; hint?: ReactNode;
}) {
  const { locale } = useI18n();
  const words = {
    good:     locale === 'ar' ? 'سليم'   : 'Healthy',
    warning:  locale === 'ar' ? 'انتباه' : 'Watch',
    serious:  locale === 'ar' ? 'متأخر'  : 'Behind',
    critical: locale === 'ar' ? 'حرج'    : 'Critical',
  };
  const glyph = { good: '●', warning: '▲', serious: '▲', critical: '■' };

  return (
    <div className="health" data-state={state}>
      <div className="health__label">{label}</div>
      <div className="health__value num">{value}</div>
      {/* Status never rests on colour: a glyph and a word ride with it. */}
      <div className="health__state" style={{ color: STATUS[state] }}>
        <span aria-hidden="true">{glyph[state]}</span> {words[state]}
      </div>
      {hint ? <div className="health__hint">{hint}</div> : null}
    </div>
  );
}

/** Compact inline trend for a stat tile — no axes, no labels, one series. */
export function Sparkline({ values, height = 30 }: { values: number[]; height?: number }) {
  const { cat } = useSeriesColors();
  const path = useMemo(() => {
    if (values.length < 2) return '';
    const max = Math.max(...values), min = Math.min(...values);
    const span = max - min || 1;
    return values.map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('');
  }, [values, height]);

  if (!path) return null;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true"
         style={{ width: '100%', height, display: 'block' }}>
      <path d={path} fill="none" stroke={cat[0]} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
