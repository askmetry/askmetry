'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Auswahl, die einen Query-Parameter setzt (z. B. ?c=<collection>, ?engine=, ?topic=). */
export function ParamSelect({ param, value, options, label, allLabel }: {
  param: string; value: string; options: { value: string; label: string }[]; label: string; allLabel?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="whitespace-nowrap">{label}</span>
      <select
        className="input !w-auto !py-1.5"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(sp.toString());
          if (e.target.value) next.set(param, e.target.value);
          else next.delete(param);
          const q = next.toString();
          router.push(q ? `${path}?${q}` : path);
        }}
      >
        {allLabel !== undefined && <option value="">{allLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
