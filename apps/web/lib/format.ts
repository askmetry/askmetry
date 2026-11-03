// Deutsche Formatierung (Altbestand). Neue Stellen nutzen die sprachabhängigen Formatierer:
// Server `const { f } = await getI18n()`, Client `const f = useFmt()` (lib/i18n/format.ts).
import { createFormat } from './i18n/format';

const de = createFormat('de');
/** @deprecated sprachabhängig: `f.pct` aus getI18n()/useFmt() */
export const fmtPct = (x: number | null | undefined, digits = 0) => de.pct(x, digits);
/** @deprecated sprachabhängig: `f.num` */
export const fmtNum = (x: number | null | undefined, digits = 1) => de.num(x, digits);
/** @deprecated sprachabhängig: `f.int` */
export const fmtInt = (x: number | null | undefined) => de.int(x);
/** @deprecated sprachabhängig: `f.usd` */
export const fmtUsd = (x: number | string | null | undefined, digits = 2) => de.usd(x, digits);
/** @deprecated sprachabhängig: `f.date` */
export const fmtDate = (d: Date | string | null | undefined, withTime = true) => de.date(d, withTime);
