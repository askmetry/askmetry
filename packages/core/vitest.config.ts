import { defineConfig } from 'vitest/config';

// Unit-Tests: keine Datenbank, keine Netzwerkaufrufe
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    env: { OPENGEO_MOCK_ENGINES: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', PERPLEXITY_API_KEY: '', DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '' },
  },
});
