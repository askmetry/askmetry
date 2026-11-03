// Einzelner Funktionstest: chat-latest mit Websuche, gpt-5.5 mit flex
import { chatgpt } from '../../packages/core/src/engines/chatgpt.ts';
const prompt = 'Welches EC-Kartengerät ist für ein kleines Café am günstigsten?';
for (const options of [
  { model: 'chat-latest' },
  { model: 'gpt-5.5', searchContextSize: 'low', reasoningEffort: 'low', serviceTier: 'flex' },
]) {
  const t = Date.now();
  try {
    const r = await chatgpt.run(prompt, { country: 'DE', language: 'de', options });
    const raw: any = r.raw;
    console.log(JSON.stringify({ options, served: r.model, sec: (Date.now() - t) / 1000, usage: r.usage, cited: r.citations.filter((c) => c.kind === 'cited').length, searched: r.citations.length, tools: (raw.output ?? []).map((i: any) => i.type), answer: r.answer.slice(0, 300) }, null, 1));
  } catch (e: any) { console.log('FEHLER', options.model, e.message); }
}
