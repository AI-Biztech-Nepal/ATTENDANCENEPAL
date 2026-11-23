// Small SVG charts for the KPI pages, drawn by hand so there is nothing to load. The colours are the set
// that was checked for colour-blind readers: on time / late / absent (and would recommend / neutral / not
// likely) are three hues that stay apart, and every chart is read out through its aria-label and has its
// numbers written beside it, so nothing depends on colour alone.

import { niceScale } from '@/lib/serviceKpi';

export const KPI_COLORS = {
  good: '#0d9488',
  warn: '#d97706',
  bad: '#e11d48',
  /** The single-series colour (rings and bars). */
  accent: '#0f766e',
  track: '#e2e8f0',
};

/** A point on a circle, angles in degrees clockwise from twelve o'clock. */
function point(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

function slicePath(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number) {
  const p0 = point(cx, cy, ro, a0);
  const p1 = point(cx, cy, ro, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  if (ri <= 0) return `M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${ro},${ro} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z`;
  const p2 = point(cx, cy, ri, a1);
  const p3 = point(cx, cy, ri, a0);
  return `M${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${ro},${ro} 0 ${large} 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} L${p2.x.toFixed(2)},${p2.y.toFixed(2)} A${ri},${ri} 0 ${large} 0 ${p3.x.toFixed(2)},${p3.y.toFixed(2)} Z`;
}

export type PieSlice = { value: number; color: string };

/** A pie (`hole` 0) or a donut (`hole` > 0) of the slices, clockwise from the top. A white edge keeps
 * touching slices apart. The biggest slice carries its number when it is wide enough to hold it. */
export function Pie({ slices, size = 168, hole = 0, gap = 0, label, aria, children }: {
  slices: PieSlice[];
  size?: number;
  hole?: number;
  /** Extra space between slices, in degrees (donuts). */
  gap?: number;
  /** Write each slice's number inside the biggest one (pies only). */
  label?: boolean;
  aria: string;
  /** Drawn in the middle, for a donut. */
  children?: React.ReactNode;
}) {
  const parts = slices.filter(s => s.value > 0);
  const total = parts.reduce((n, s) => n + s.value, 0);
  const c = size / 2;
  const ro = size / 2 - 2;
  let angle = 0;
  const biggest = parts.reduce<PieSlice | null>((m, s) => (!m || s.value > m.value ? s : m), null);
  const shapes = parts.map((s, i) => {
    const span = (360 * s.value) / total;
    const a0 = angle + gap / 2;
    const a1 = angle + span - gap / 2;
    const mid = angle + span / 2;
    angle += span;
    if (parts.length === 1) {
      return hole > 0 ? (
        <circle key={i} cx={c} cy={c} r={(ro + hole) / 2} fill="none" stroke={s.color} strokeWidth={ro - hole} />
      ) : (
        <g key={i}>
          <circle cx={c} cy={c} r={ro} fill={s.color} />
          {label && (
            <text x={c} y={c + 8} textAnchor="middle" fontSize={24} fontWeight={800} fill="#ffffff">
              {s.value}
            </text>
          )}
        </g>
      );
    }
    const text =
      label && s === biggest && s.value / total >= 0.25 ? (
        <text key={`t${i}`} x={point(c, c, ro * 0.58, mid).x} y={point(c, c, ro * 0.58, mid).y + 7} textAnchor="middle" fontSize={22} fontWeight={800} fill="#ffffff">
          {s.value}
        </text>
      ) : null;
    return (
      <g key={i}>
        <path d={slicePath(c, c, ro, hole, a0, a1)} fill={s.color} stroke="#ffffff" strokeWidth={2} strokeLinejoin="round" />
        {text}
      </g>
    );
  });
  return (
    <svg role="img" aria-label={aria} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block shrink-0">
      {shapes}
      {children}
    </svg>
  );
}

/** A progress ring: `pct` of the circle filled, the rest a pale track. */
export function Ring({ pct, size = 156, stroke = 16, aria, big, small }: {
  pct: number;
  size?: number;
  stroke?: number;
  aria: string;
  big: string;
  small?: string;
}) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct)) * len / 100;
  return (
    <svg role="img" aria-label={aria} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke={KPI_COLORS.track} strokeWidth={stroke} />
      {/* A zero-length round-capped stroke still paints a dot, so a ring with nothing in it draws only the track. */}
      {filled > 0 && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={KPI_COLORS.accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(2)} ${(len - filled).toFixed(2)}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      )}
      <text x={c} y={c + 2} textAnchor="middle" fontSize={28} fontWeight={800} fill="#0f172a">
        {big}
      </text>
      {small && (
        <text x={c} y={c + 20} textAnchor="middle" fontSize={12} fill="#475569">
          {small}
        </text>
      )}
    </svg>
  );
}

export type Bar = { label: string; value: number; /** Still going, so it will grow: drawn pale with a dashed edge. */ partial?: boolean };

/** Bars of one series, one per label, with the number above each bar and a light grid behind. The axis tops out at a
 * tidy number that holds the tallest bar. Written out in full through its aria-label. */
export function Bars({ bars, aria }: { bars: Bar[]; aria: string }) {
  const W = 520;
  const H = 176;
  const L = 34;
  const R = 8;
  const T = 18;
  const B = 30;
  const pw = W - L - R;
  const ph = H - T - B;
  const { max, ticks } = niceScale(Math.max(0, ...bars.map(b => b.value)));
  const y = (v: number) => T + ph - (v / max) * ph;
  const slot = pw / Math.max(bars.length, 1);
  const barW = Math.min(68, slot * 0.62);
  return (
    <svg role="img" aria-label={aria} width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {ticks.map(t => (
        <g key={t}>
          <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} stroke={KPI_COLORS.track} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#475569">
            {t}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const cx = L + slot * (i + 0.5);
        return (
          <g key={i}>
            {b.value > 0 && (
              <rect
                x={cx - barW / 2}
                y={y(b.value)}
                width={barW}
                height={y(0) - y(b.value)}
                rx={5}
                fill={b.partial ? '#99d6cf' : KPI_COLORS.accent}
                stroke={b.partial ? KPI_COLORS.accent : undefined}
                strokeWidth={b.partial ? 1.5 : undefined}
                strokeDasharray={b.partial ? '4 3' : undefined}
              />
            )}
            <text x={cx} y={y(b.value) - 6} textAnchor="middle" fontSize={13} fontWeight={800} fill="#0f172a">
              {b.value}
            </text>
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill="#475569">
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
