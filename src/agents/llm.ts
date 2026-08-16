/**
 * LLM provider adapter and grounded specialist agents — §9, §35, §67, §89.
 *
 * The governing constraint: **an LLM may never author a fact.** It is used only
 * to extract structure from text that already exists in the database, and every
 * extracted item must quote the source article verbatim. Anything that cannot be
 * traced back to a supplied article is discarded before it reaches storage.
 *
 * Enforcement is mechanical, not prompt-based:
 *   1. the prompt supplies numbered articles and forbids outside knowledge;
 *   2. the response must be JSON matching a strict schema, or it is rejected;
 *   3. every claim must carry an article index and a verbatim quote;
 *   4. `verifyGrounding()` checks each quote actually occurs in that article —
 *      a fabricated or paraphrased quote is dropped and counted;
 *   5. if too much is dropped, the whole run is marked `blocked`.
 *
 * With no API key configured, `isLlmAvailable()` is false and these agents report
 * status 'unavailable'. They never guess, and the UI shows the real state (§74).
 */
import type { Agent, AgentContext, AgentResult, ArticleRef } from './types.js';
import { getFlag, FLAGS } from '../core/flags.js';

export const PROMPT_VERSION = 'grounded-extract-1.0.0';

// ---------------------------------------------------------------- provider
export interface LlmProvider {
  name: string;
  model: string;
  complete(system: string, user: string, maxTokens: number): Promise<{ text: string; inputTokens?: number; outputTokens?: number }>;
}

export interface LlmUsage { calls: number; inputTokens: number; outputTokens: number }
const usage: LlmUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
export const getLlmUsage = (): LlmUsage => ({ ...usage });
export const resetLlmUsage = (): void => { usage.calls = 0; usage.inputTokens = 0; usage.outputTokens = 0; };

/** §67: a hard ceiling so a runaway loop cannot spend without bound. */
const MAX_CALLS_PER_CYCLE = Number(process.env.LLM_MAX_CALLS_PER_CYCLE ?? 50);

export function isLlmAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export function describeLlm(): string {
  if (process.env.ANTHROPIC_API_KEY) return `anthropic:${process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514'}`;
  if (process.env.OPENAI_API_KEY) return `openai:${process.env.LLM_MODEL ?? 'gpt-4o-mini'}`;
  return 'none';
}

/** Built lazily so the process starts fine with no key configured. */
export function getProvider(): LlmProvider | null {
  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? 30000);

  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514';
    return {
      name: 'anthropic', model,
      async complete(system, user, maxTokens) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', signal: ctrl.signal,
            headers: {
              'content-type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY!,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
          });
          if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j: any = await res.json();
          return {
            text: (j.content ?? []).map((c: any) => c.text ?? '').join(''),
            inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens,
          };
        } finally { clearTimeout(t); }
      },
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
    return {
      name: 'openai', model,
      async complete(system, user, maxTokens) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST', signal: ctrl.signal,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            body: JSON.stringify({
              model, max_tokens: maxTokens, temperature: 0,
              response_format: { type: 'json_object' },
              messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            }),
          });
          if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j: any = await res.json();
          return {
            text: j.choices?.[0]?.message?.content ?? '',
            inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens,
          };
        } finally { clearTimeout(t); }
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------- grounding
export interface ExtractedClaim {
  /** 1-based index into the supplied article list. */
  article: number;
  /** Text copied verbatim from that article. */
  quote: string;
  /** FACT | STATEMENT | CLAIMED | MEASUREMENT | OPINION */
  kind: string;
}

export interface GroundingResult {
  kept: ExtractedClaim[];
  dropped: Array<{ claim: ExtractedClaim; why: string }>;
}

function normalise(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const VALID_KINDS = new Set(['FACT', 'STATEMENT', 'CLAIMED', 'MEASUREMENT', 'OPINION']);

/**
 * Every quote must genuinely occur in the article it cites. This is what stops
 * a model inventing a plausible-sounding sentence and attributing it to a real
 * outlet — the single most dangerous failure mode for this product.
 */
export function verifyGrounding(claims: unknown, articles: ArticleRef[]): GroundingResult {
  const kept: ExtractedClaim[] = [];
  const dropped: Array<{ claim: ExtractedClaim; why: string }> = [];
  if (!Array.isArray(claims)) return { kept, dropped };

  const haystacks = articles.map((a) => normalise(`${a.title} ${a.summary ?? ''}`));

  for (const raw of claims.slice(0, 40)) {
    const c = raw as ExtractedClaim;
    if (!c || typeof c !== 'object') continue;
    const idx = Number((c as any).article);
    const quote = typeof c.quote === 'string' ? c.quote.trim() : '';
    const kind = String(c.kind ?? '').toUpperCase();

    if (!Number.isInteger(idx) || idx < 1 || idx > articles.length) {
      dropped.push({ claim: c, why: 'cites an article index that was not supplied' }); continue;
    }
    if (quote.length < 12) {
      dropped.push({ claim: c, why: 'quote too short to verify' }); continue;
    }
    if (!VALID_KINDS.has(kind)) {
      dropped.push({ claim: c, why: `unknown claim kind "${c.kind}"` }); continue;
    }
    const nq = normalise(quote);
    if (!nq || !haystacks[idx - 1].includes(nq)) {
      // The quote does not appear in the cited article: it was paraphrased or
      // invented. Either way it is not evidence, so it is discarded.
      dropped.push({ claim: c, why: 'quote does not appear verbatim in the cited article' }); continue;
    }
    kept.push({ article: idx, quote, kind });
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------- prompt
const SYSTEM = `You extract structure from news articles for a verification system.

ABSOLUTE RULES:
1. Use ONLY the text of the numbered articles provided. You have no other knowledge.
2. Every claim you output MUST include a quote copied character-for-character from the article you cite. Never paraphrase inside "quote".
3. If the articles do not support an item, omit it. Returning fewer items is correct; inventing one is a critical failure.
4. Do not infer causation, motive, consequences, or anything not stated.
5. Classify each claim:
   FACT        - stated by the article as established
   STATEMENT   - attributed to a named person or body ("X said ...")
   CLAIMED     - asserted by a party to a dispute, not independently confirmed
   MEASUREMENT - a number, magnitude, count or date
   OPINION     - analysis, prediction or judgement
6. Reply with JSON only, no prose, no markdown fences.

Schema:
{"claims":[{"article":1,"quote":"exact text from article 1","kind":"FACT"}],
 "unknowns":["what the articles do not establish"]}`;

function buildUserPrompt(ctx: AgentContext): string {
  const list = ctx.articles.slice(0, 8).map((a, i) =>
    `[${i + 1}] SOURCE: ${a.source_name}\nTITLE: ${a.title}\nSUMMARY: ${a.summary ?? '(none provided)'}`
  ).join('\n\n');
  return `Articles about one event (category: ${ctx.event.category}):\n\n${list}\n\n`
    + `Extract the claims these articles actually make, and list what they leave unknown. JSON only.`;
}

// ---------------------------------------------------------------- agent
export interface LlmExtractionOutput {
  claims: ExtractedClaim[];
  unknowns: string[];
  grounding: { proposed: number; kept: number; dropped: Array<{ quote: string; why: string }> };
  model: string;
  promptVersion: string;
  note: string;
}

export const llmExtractionAgent: Agent<LlmExtractionOutput> = {
  name: 'llm_extraction',
  version: '1.0.0',

  // Only worth running when there is enough text to extract from.
  appliesTo: (c) => c.articles.length >= 1 && c.articles.some((a) => (a.summary ?? '').length > 60),

  async run(ctx): Promise<AgentResult<LlmExtractionOutput>> {
    const base = { agent: llmExtractionAgent.name, agentVersion: llmExtractionAgent.version, mode: 'llm' as const };

    if ((await getFlag(FLAGS.AI_ANALYSIS)) !== 'on') {
      return { ...base, status: 'blocked', output: null, confidence: null,
        notes: ['AI analysis disabled by administrator (emergency control).'] };
    }
    const provider = getProvider();
    if (!provider) {
      // §74/§75: report the real state rather than degrading silently to a guess.
      return { ...base, status: 'unavailable', output: null, confidence: null,
        notes: ['No LLM provider configured. Deterministic agents remain active; no analysis is fabricated.'] };
    }
    if (usage.calls >= MAX_CALLS_PER_CYCLE) {
      return { ...base, status: 'unavailable', output: null, confidence: null,
        notes: [`LLM call budget for this cycle exhausted (${MAX_CALLS_PER_CYCLE}).`] };
    }

    let text: string;
    try {
      const r = await provider.complete(SYSTEM, buildUserPrompt(ctx), 1200);
      usage.calls++;
      usage.inputTokens += r.inputTokens ?? 0;
      usage.outputTokens += r.outputTokens ?? 0;
      text = r.text;
    } catch (err: any) {
      return { ...base, status: 'unavailable', output: null, confidence: null,
        notes: [`LLM call failed: ${String(err?.message ?? err).slice(0, 200)}`] };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return { ...base, status: 'blocked', output: null, confidence: null,
        notes: ['LLM returned unparsable output; discarded rather than guessed at.'] };
    }

    const { kept, dropped } = verifyGrounding(parsed?.claims, ctx.articles);
    const proposed = Array.isArray(parsed?.claims) ? parsed.claims.length : 0;

    // If the model largely failed to ground itself, distrust the whole response.
    if (proposed > 0 && kept.length / proposed < 0.5) {
      return { ...base, status: 'blocked', output: null, confidence: null,
        notes: [`${dropped.length}/${proposed} extracted claims were not verifiable against the source text; response rejected.`] };
    }
    if (!kept.length) {
      return { ...base, status: 'insufficient_data', output: null, confidence: null,
        notes: ['No claim could be verified verbatim against the supplied articles.'] };
    }

    // Unknowns are free text but harmless: they assert absence, not fact.
    const unknowns = Array.isArray(parsed?.unknowns)
      ? parsed.unknowns.filter((u: unknown) => typeof u === 'string').slice(0, 8).map((u: string) => u.slice(0, 240))
      : [];

    return {
      ...base, status: 'ok',
      output: {
        claims: kept, unknowns,
        grounding: {
          proposed, kept: kept.length,
          dropped: dropped.slice(0, 10).map((d) => ({ quote: String(d.claim.quote ?? '').slice(0, 120), why: d.why })),
        },
        model: `${provider.name}:${provider.model}`,
        promptVersion: PROMPT_VERSION,
        note: 'Cada citação foi verificada como presente no artigo citado. Afirmações não verificáveis foram descartadas.',
      },
      confidence: Math.round((kept.length / Math.max(proposed, 1)) * 100),
      notes: [`${kept.length}/${proposed} claims verified verbatim`, `model ${provider.name}:${provider.model}`],
    };
  },
};
