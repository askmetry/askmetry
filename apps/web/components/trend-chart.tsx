'use client';
import { useI18n } from '@/lib/i18n/client';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Point = { label: string; visibility: number | null; shareOfVoice: number | null; ownSiteRate: number | null };
const SERIES = [
  { key: 'visibility', name: 'visibility', color: 'var(--series-1)' },
  { key: 'shareOfVoice', name: 'sov', color: 'var(--series-2)' },
  { key: 'ownSiteRate', name: 'ownSite', color: 'var(--series-3)' },
] as const;

export function TrendChart({ data }: { data: Point[] }) {
  const { t, f } = useI18n();
  const pct = (v: unknown) => (typeof v === 'number' ? f.pct(v) : '–');
  const max = Math.max(0.1, ...data.flatMap((d) => [d.visibility ?? 0, d.shareOfVoice ?? 0, d.ownSiteRate ?? 0]));
  const top = Math.min(1, Math.ceil(max * 5) / 5);
  const ticks = Array.from({ length: Math.round(top / (top > 0.6 ? 0.2 : 0.1)) + 1 }, (_, i) => Number((i * (top > 0.6 ? 0.2 : 0.1)).toFixed(2)));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
          <YAxis tickFormatter={pct} domain={[0, top]} ticks={ticks}
            tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(v, n) => [pct(v), n]}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--fg)' }}
            labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
            cursor={{ stroke: 'var(--faint)', strokeDasharray: '3 3' }}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 13, color: 'var(--muted)' }} />
          {SERIES.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={t.analysis.chart[s.name]} stroke={s.color} strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)', fill: s.color }} activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
