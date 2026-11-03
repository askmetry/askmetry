import { defineConfig } from 'vitest/config';

// Integrationstest gegen die separate Datenbank opengeo_test (wird bei jedem Lauf neu angelegt und migriert)
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://opengeo:opengeo@localhost:5433/opengeo_test';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      OPENGEO_MOCK_ENGINES: '1',
      ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', PERPLEXITY_API_KEY: '', DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '',
    },
  },
});
