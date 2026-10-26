import type { Candidate, ScriptLine } from '../../shared/types';
import type { Env } from './env';
import {
  type Clarification,
  validateClarification,
  validateScript,
} from './validate';

const clarifySchema = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['ok', 'ambiguous'] },
    candidates: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['title', 'description'],
      },
    },
  },
  required: ['status', 'candidates'],
};

const scriptSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      speaker: { type: 'STRING' },
      line: { type: 'STRING' },
    },
    required: ['speaker', 'line'],
  },
};

/** Canned responses so the game loop can be exercised without an API key. */
function mockGemini(schema: object): unknown {
  if (schema === clarifySchema) {
    return { status: 'ok', candidates: [{ title: 'Mock scene', description: 'A canned scene' }] };
  }
  return [
    { speaker: 'Vincent', line: 'Thou dost not tip, good sir?' },
    { speaker: 'Jules', line: 'Nay, for service was but common.' },
    { speaker: 'Vincent', line: 'Then let us part in peace.' },
    { speaker: 'Jules', line: 'Aye, and mind thy tongue.' },
  ];
}

async function callGemini(env: Env, prompt: string, schema: object): Promise<unknown> {
  if (env.GEMINI_API_KEY === 'mock') return mockGemini(schema);
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
  let res!: Response;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
        }),
      },
    );
    // 429/503 are transient capacity errors: back off and retry.
    if (res.status !== 429 && res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  return JSON.parse(text);
}

/** Retry once if the model output fails schema validation. */
async function withValidation<T>(
  run: () => Promise<unknown>,
  validate: (d: unknown) => T | null,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const v = validate(await run());
      if (v) return v;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  throw new Error('Gemini returned malformed output');
}

export function clarifyScene(env: Env, scene: string, style: string): Promise<Clarification> {
  const prompt =
    `A player wants this movie scene: "${scene}", written in the style of "${style}".\n` +
    `If the description clearly identifies a single scene, return status "ok" with exactly one candidate.\n` +
    `If it could match several distinct scenes (e.g. a film with multiple diner scenes), return status "ambiguous" ` +
    `with 2-5 candidates, each with a short title and a one-sentence description.`;
  return withValidation(() => callGemini(env, prompt, clarifySchema), validateClarification);
}

export function generateScript(
  env: Env,
  scene: string,
  style: string,
  chosen?: Candidate,
): Promise<ScriptLine[]> {
  const target = chosen ? `${chosen.title} (${chosen.description})` : scene;
  const prompt =
    `Write the movie scene "${target}" in the style of "${style}".\n` +
    `Use 2-5 speakers with consistent character names. Keep it playable aloud by friends: 12-30 lines, each line short. ` +
    `Return a JSON array of objects with "speaker" and "line" keys, in order. No stage directions in lines. ` +
    `Never say a character's name inside any line (no one addresses anyone by name), so the speakers can stay anonymous.`;
  return withValidation(() => callGemini(env, prompt, scriptSchema), validateScript);
}
