/** Symbol eines Arbeitsschritts: Haken (erledigt), drehender Ring (läuft), leerer Kreis (kommt noch). Gleiche Optik wie die Check-Warteseite. */
export function StepIcon({ state }: { state: 'done' | 'current' | 'todo' }) {
  if (state === 'done') {
    return (
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span aria-hidden className="relative flex size-6 shrink-0 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-accent/25" />
        <span className="agent-spin absolute inset-0 rounded-full border-2 border-transparent border-t-accent" />
        <span className="size-2 rounded-full bg-accent" />
      </span>
    );
  }
  return <span aria-hidden className="size-6 shrink-0 rounded-full border-2 border-border" />;
}
