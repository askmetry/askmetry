import type { Engine, EngineKey } from '../types.ts';
import { chatgpt } from './chatgpt.ts';
import { claude } from './claude.ts';
import { gemini } from './gemini.ts';
import { googleAiMode, googleAio } from './google.ts';
import { mock } from './mock.ts';
import { perplexity } from './perplexity.ts';

export const engines: Record<EngineKey, Engine> = {
  chatgpt, gemini, claude, perplexity, google_aio: googleAio, google_ai_mode: googleAiMode, mock,
};

export const isMockMode = () => process.env.ASKMETRY_MOCK_ENGINES === '1';

/** Adapter für einen Engine-Key; im Mock-Modus (ASKMETRY_MOCK_ENGINES=1) immer der Mock. */
export function getEngine(key: string): Engine {
  if (isMockMode() || key === 'mock') return mock;
  const e = engines[key as EngineKey];
  if (!e) throw new Error(`Unbekannte Engine: ${key}`);
  return e;
}

export { chatgpt, claude, gemini, googleAio, googleAiMode, mock, perplexity };
