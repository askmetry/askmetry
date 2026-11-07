import { engineName } from '@askmetry/core/present';
import type { CheckFindings, FindingCase } from '@askmetry/core/hosted/types';
import { getI18n } from '@/lib/i18n/server';

/** „A, B und C“ */
function joinNames(names: string[], and: string): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

/**
 * Oben im Ergebnis: 2–3 konkrete Fälle mit echtem Antwort-Ausschnitt („Auf ‚<Frage>‘ nennt ChatGPT A und B – dich nicht.“).
 * Ohne Lücken: Antworten, die dich nennen; ohne beides ein ehrlicher Hinweis. Simulierte Messungen sind gekennzeichnet.
 * Ausschnitte sind reiner Text (im Kern von Markdown/HTML befreit) und werden von React escaped.
 */
export async function Findings({ findings }: { findings: CheckFindings }) {
  const { t, locale } = await getI18n();
  const c = t.check.findings;
  const gaps = findings.gaps.length > 0;
  const cases = gaps ? findings.gaps : findings.wins;
  const title = gaps ? c.title : cases.length ? c.winsTitle : c.noneTitle;
  const line = (x: FindingCase) => gaps
    ? c.gap(x.question, engineName(x.engine, locale), joinNames(x.competitors, c.and))
    : c.win(x.question, engineName(x.engine, locale));
  return (
    <section aria-labelledby="findings-title" className="mt-6" data-testid="check-findings" data-kind={gaps ? 'gaps' : cases.length ? 'wins' : 'none'}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="findings-title" className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {findings.simulated && <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[13px] font-medium text-muted">{c.simulated}</span>}
      </div>
      {gaps && <p className="mt-0.5 text-sm text-muted">{c.gapCount(findings.gapAnswers, findings.answers)}</p>}
      {!gaps && <p className="mt-0.5 text-sm text-muted">{cases.length ? c.winsText : c.noneText}</p>}
      {cases.length > 0 && (
        <ul className="mt-3 space-y-3">
          {cases.map((x, i) => (
            <li key={`${x.engine}-${i}`} className="rounded-2xl bg-subtle/60 p-4" data-testid="finding-case">
              <p className="text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{line(x)}</p>
              {x.excerpt && (
                <figure className="mt-2">
                  <figcaption className="sr-only">{c.excerpt}</figcaption>
                  <blockquote className="border-l-2 border-border pl-3 text-sm text-muted [overflow-wrap:anywhere]">{x.excerpt}</blockquote>
                </figure>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
