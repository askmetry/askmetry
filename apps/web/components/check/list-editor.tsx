'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { editCheckList, type CheckListState } from '@/lib/actions/check';
import { useI18n } from '@/lib/i18n/client';

type Kind = 'questions' | 'topics';

/**
 * Fragen (Liste) bzw. Themen (Chips) eines fertigen Checks vor dem Kauf ändern: ändern, entfernen, hinzufügen.
 * Jede Änderung ist eine Server Action mit dem Check-Token; der Kern prüft Grenzen, Duplikate und Ratenlimit und
 * liefert die neue Liste zurück. `expected` (alter Text) schützt vor veralteten Ansichten in einem zweiten Tab.
 * `collapsed` = so viele Einträge zeigen, Rest hinter „Alle anzeigen“.
 */
export function CheckListEditor({ token, kind, items, max, editable, collapsed, testId }: {
  token: string; kind: Kind; items: string[]; max: number; editable: boolean; collapsed?: number; testId?: string;
}) {
  const { t } = useI18n();
  const e = t.check.edit;
  const [list, setList] = useState(items);
  const [editing, setEditing] = useState<number | null>(null);
  const [all, setAll] = useState(!collapsed || items.length <= collapsed);
  const [state, run, pending] = useActionState<CheckListState, FormData>(editCheckList, null);
  const addRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && state.list) { setList(state.list); setEditing(null); addRef.current?.reset(); }
  }, [state]);
  // Seite neu geladen (z. B. nach Kauf) → Server-Stand übernehmen
  useEffect(() => { setList(items); }, [items]);

  const shown = all || !collapsed ? list : list.slice(0, collapsed);
  const hidden = list.length - shown.length;
  const hiddenFields = (action: string, i?: number) => (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="action" value={action} />
      {i !== undefined && <><input type="hidden" name="index" value={i} /><input type="hidden" name="expected" value={list[i]} /></>}
    </>
  );
  const error = state?.error ? <p role="alert" className="mt-2 text-sm text-bad" data-testid={`${testId}-error`}>{state.error}</p> : null;

  if (kind === 'topics') {
    return (
      <div data-testid={testId}>
        {list.length === 0 && <p className="text-sm text-muted">{t.check.topics.empty}</p>}
        <ul className="flex flex-wrap gap-2">
          {list.map((x, i) => (
            <li key={`${i}-${x}`} className="flex min-w-0 max-w-full items-center rounded-full bg-subtle text-sm">
              {editing === i ? (
                <form action={run} className="flex items-center gap-1 py-0.5 pl-1 pr-1">
                  {hiddenFields('edit', i)}
                  <input className="input !h-7 !w-40 !py-0 text-sm" name="text" defaultValue={x} aria-label={e.editLabel(x)} autoFocus maxLength={40} />
                  <button type="submit" className="btn btn-sm" disabled={pending}>{pending ? e.busy : e.save}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>{e.cancel}</button>
                </form>
              ) : (
                <>
                  {editable
                    ? <button type="button" className="min-w-0 truncate py-1 pl-3 pr-1 text-left hover:underline" onClick={() => setEditing(i)} title={e.editLabel(x)} aria-label={e.editLabel(x)}>{x}</button>
                    : <span className="min-w-0 truncate px-3 py-1">{x}</span>}
                  {editable && (
                    <form action={run} className="flex">
                      {hiddenFields('delete', i)}
                      <button type="submit" disabled={pending} aria-label={e.removeLabel(x)} title={e.remove}
                        className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-border/60 hover:text-fg">
                        <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </form>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {editable && list.length < max && (
          <form ref={addRef} action={run} className="mt-3 flex gap-2">
            {hiddenFields('add')}
            <input className="input min-w-0 flex-1 text-sm" name="text" placeholder={t.check.topics.addPlaceholder} aria-label={t.check.topics.addLabel} maxLength={40} required />
            <button type="submit" className="btn btn-sm shrink-0" disabled={pending}>{pending ? e.busy : t.check.topics.add}</button>
          </form>
        )}
        {error}
      </div>
    );
  }

  return (
    <div data-testid={testId}>
      <ol className="divide-y divide-border/70">
        {shown.map((x, i) => (
          <li key={`${i}-${x}`} className="flex items-start gap-3 py-2.5" data-question>
            <span aria-hidden className="w-5 shrink-0 pt-0.5 text-right text-[13px] tabular-nums text-muted">{i + 1}</span>
            {editing === i ? (
              <form action={run} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                {hiddenFields('edit', i)}
                <input className="input min-w-0 flex-1 text-[15px]" name="text" defaultValue={x} aria-label={e.editLabel(x)} autoFocus maxLength={300} />
                <span className="flex shrink-0 gap-2">
                  <button type="submit" className="btn btn-sm" disabled={pending}>{pending ? e.busy : e.save}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>{e.cancel}</button>
                </span>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere]">{x}</span>
                {editable && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" className="rounded-md px-1.5 py-0.5 text-[13px] text-accent hover:bg-accent-soft" onClick={() => setEditing(i)} aria-label={e.editLabel(x)}>{e.edit}</button>
                    <form action={run}>
                      {hiddenFields('delete', i)}
                      <button type="submit" disabled={pending} aria-label={e.removeLabel(x)} title={e.remove}
                        className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg">
                        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </form>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {collapsed && list.length > collapsed && (
        <button type="button" className="mt-1 text-sm text-accent hover:underline" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid={`${testId}-toggle`}>
          {all ? t.check.questions.showLess : t.check.questions.showAll(list.length)}
        </button>
      )}
      {editable && (all || hidden === 0) && list.length < max && (
        <form ref={addRef} action={run} className="mt-3 flex flex-col gap-2 sm:flex-row">
          {hiddenFields('add')}
          <input className="input min-w-0 flex-1 text-[15px]" name="text" placeholder={t.check.questions.addPlaceholder} aria-label={t.check.questions.addLabel} maxLength={300} required />
          <button type="submit" className="btn btn-sm shrink-0 justify-center" disabled={pending}>{pending ? e.busy : t.check.questions.add}</button>
        </form>
      )}
      <p className="mt-2 text-[13px] text-muted">{t.check.questions.count(list.length, max)}</p>
      {error}
    </div>
  );
}
