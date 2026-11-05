import { defineConfig } from 'vitest/config';

// Tests gegen die Testdatenbank askmetry_test (wird nicht neu angelegt: Daten mit Präfix, danach aufgeräumt)
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://askmetry:askmetry@localhost:5433/askmetry_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      ASKMETRY_MOCK_ENGINES: '1',
      ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', PERPLEXITY_API_KEY: '', DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '',
    },
  },
});
