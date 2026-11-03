export interface LimitedTask {
  provider: string;
  fn: () => Promise<void>;
}

/** Führt Aufgaben aus: höchstens `total` gleichzeitig, je Anbieter höchstens `perProvider`. Reihenfolge bleibt erhalten, soweit möglich. */
export function runLimited(tasks: LimitedTask[], opts: { total: number; perProvider: number }): Promise<void> {
  const queue = [...tasks];
  const active = new Map<string, number>();
  let running = 0;
  return new Promise((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      if (!queue.length && running === 0) return resolve();
      while (running < opts.total) {
        const idx = queue.findIndex((t) => (active.get(t.provider) ?? 0) < opts.perProvider);
        if (idx < 0) break;
        const [t] = queue.splice(idx, 1);
        running++;
        active.set(t.provider, (active.get(t.provider) ?? 0) + 1);
        t.fn().then(() => {
          running--;
          active.set(t.provider, (active.get(t.provider) ?? 1) - 1);
          pump();
        }, (e) => { failed = true; reject(e); });
      }
    };
    pump();
  });
}
