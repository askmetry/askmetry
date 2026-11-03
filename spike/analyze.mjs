// Wertet eine Antwort aus: welche Marken, an welcher Stelle, mit welcher Tonalität.
import Anthropic from '@anthropic-ai/sdk';
import { settings } from './config.mjs';

let client;

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer_type', 'brands'],
  properties: {
    answer_type: { type: 'string', enum: ['list', 'single_recommendation', 'explanation', 'refusal', 'empty'] },
    brands: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'tracked', 'position', 'sentiment', 'recommended', 'snippet'],
        properties: {
          name: { type: 'string' },
          tracked: { type: ['string', 'null'] },
          position: { type: 'integer' },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          recommended: { type: 'boolean' },
          snippet: { type: 'string' },
        },
      },
    },
  },
};

export async function analyzeAnswer(answer, project) {
  if (!answer?.trim()) return { answer_type: 'empty', brands: [] };
  client ??= new Anthropic();
  const tracked = [project.brand, ...project.competitors]
    .map((b) => `- ${b.name}${b.aliases?.length ? ` (auch: ${b.aliases.join(', ')})` : ''}`)
    .join('\n');
  const res = await client.messages.create({
    model: settings.models.analyzer,
    max_tokens: 4000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema },
    },
    messages: [{
      role: 'user',
      content: `Analysiere die folgende Antwort einer KI-Suchmaschine.

Finde jede Marke, jedes Unternehmen und jedes Produkt, das genannt wird (keine Websites, die nur als Quelle dienen).
Für jede Marke:
- name: wie im Text genannt
- tracked: exakter Name aus der Liste unten, wenn es dieselbe Marke ist, sonst null
- position: Reihenfolge der ersten Nennung (1 = zuerst genannte Marke)
- sentiment: Tonalität gegenüber der Marke
- recommended: true, wenn die Antwort die Marke ausdrücklich empfiehlt oder als gute Wahl hervorhebt
- snippet: der Satz, in dem die Marke genannt wird (max. 200 Zeichen)

Getrackte Marken:
${tracked}

<antwort>
${answer.slice(0, 30000)}
</antwort>`,
    }],
  });
  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`Analyse ohne Ergebnis (stop_reason: ${res.stop_reason})`);
  return JSON.parse(text);
}
