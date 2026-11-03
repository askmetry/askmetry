export type EngineKey = 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'google_aio' | 'google_ai_mode' | 'mock';

export const engineKeys: EngineKey[] = ['chatgpt', 'gemini', 'claude', 'perplexity', 'google_aio', 'google_ai_mode', 'mock'];

export const engineLabels: Record<EngineKey, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
  google_aio: 'Google AI Overviews',
  google_ai_mode: 'Google AI Mode',
  mock: 'Mock',
};

export type CitationKind = 'cited' | 'searched';

export interface EngineCitation {
  url: string;
  title?: string | null;
  kind: CitationKind;
}

export interface EngineResult {
  engine: string;
  /** Modell, wie von der API gemeldet */
  model: string;
  answer: string;
  citations: EngineCitation[];
  /** z. B. Google zeigt für die Suchanfrage keine AI Overview */
  noAiAnswer: boolean;
  /** Engine hat die Antwort verweigert (Claude refusal, Gemini-Sicherheitsfilter) – wird als answer_type 'refusal' gespeichert */
  refusal?: string | null;
  usage: Record<string, unknown> | null;
  costUsd: number;
  raw: unknown;
}

/** Marke, wie der Mock-Adapter und der lokale Analyzer sie brauchen */
export interface BrandRef {
  id?: string;
  name: string;
  aliases?: string[] | null;
  domains?: string[] | null;
  isOwn?: boolean;
  description?: string | null;
}

export interface RunContext {
  country: string;
  language: string;
  /** Engine-Einstellungen (Standard: engineDefaults[engine]) */
  options?: Record<string, unknown>;
  /** Für den Mock-Adapter: Marken des Workspace */
  brands?: BrandRef[];
  repetition?: number;
  /** Engine-Key, unter dem der Run läuft (Mock ersetzt im Mock-Modus alle Engines) */
  engineKey?: string;
}

export interface Engine {
  key: EngineKey;
  /** Anbieter für die Parallelitätsgrenze (max. 2 gleichzeitige Anfragen je Anbieter) */
  provider: string;
  enabled(): boolean;
  run(prompt: string, ctx: RunContext): Promise<EngineResult>;
}
