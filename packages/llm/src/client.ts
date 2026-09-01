import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import crypto from 'node:crypto';
import type { LlmProvider } from './env.js';

/** A conformance verdict is a short call. Past this, the model is not slow —
 *  something is wrong, and a check that hangs is worse than one that fails. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export class LlmCallError extends Error {
  constructor(
    public readonly intentId: string,
    public readonly cause: unknown,
  ) {
    super(`LLM call failed for intent ${intentId}: ${String(cause)}`);
    this.name = 'LlmCallError';
  }
}

const OpenAiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
});

export class LlmClient {
  private readonly anthropicClient?: Anthropic;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly provider: LlmProvider;

  constructor(opts: { apiKey: string; provider: LlmProvider; model?: string }) {
    this.apiKey = opts.apiKey;
    this.provider = opts.provider;
    
    if (this.provider === 'anthropic') {
      this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
      this.defaultModel = opts.model ?? 'claude-haiku-4-5';
    } else if (this.provider === 'openai') {
      this.defaultModel = opts.model ?? 'gpt-4o-mini';
    } else {
      this.defaultModel = opts.model ?? 'gemini-1.5-flash';
    }
  }

  private redact(msg: string): string {
    return msg.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  /** One HTTP call, retried on the failures that are worth retrying: a 429, a
   *  5xx, or a transport error. A 4xx other than 429 is the caller's fault and
   *  retrying it only burns the budget.
   *
   *  The request id travels into the thrown error so a failure in a CI log can
   *  be matched against the provider's own record of the request. */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    intentId: string,
    requestId: string,
  ): Promise<Response> {
    const maxRetries = MAX_RETRIES;
    let lastFailure = 'unknown';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxRetries) return response;
        // The body of a response we are about to throw away still holds a
        // socket; leaving three of them open across three retries leaks.
        lastFailure = `HTTP ${response.status}`;
        await response.body?.cancel().catch(() => undefined);
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const aborted = err instanceof Error && err.name === 'AbortError';
        lastFailure = aborted
          ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
          : this.redact(err instanceof Error ? err.message : String(err));
        if (attempt === maxRetries) {
          throw new LlmCallError(
            intentId,
            `${lastFailure} (request ${requestId}, ${attempt + 1} attempts)`,
          );
        }
      }

      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
    }

    // The loop returns or throws on its final attempt; this is unreachable, and
    // reported as such rather than as a provider error.
    throw new LlmCallError(
      intentId,
      `retry loop ended without a response after ${lastFailure} (request ${requestId})`,
    );
  }

  async callWithSchema<T>(opts: {
    intentId: string;
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    maxTokens?: number;
    model?: string;
  }): Promise<{ result: T; usage: { inputTokens: number; outputTokens: number }; model: string }> {
    let model = opts.model ?? this.defaultModel;
    const requestId = crypto.randomUUID();
    
    if (this.provider === 'openai') {
      if (model.includes('sonnet')) model = 'gpt-4o';
      else if (model.includes('haiku')) model = 'gpt-4o-mini';
    } else if (this.provider === 'gemini') {
      if (model.includes('sonnet')) model = 'gemini-1.5-pro';
      else if (model.includes('haiku')) model = 'gemini-1.5-flash';
    }

    const maxTokens = opts.maxTokens ?? 1024;
    let rawText: string;
    let usage: { inputTokens: number; outputTokens: number };

    try {
      if (this.provider === 'anthropic' && this.anthropicClient) {
        const response = await this.anthropicClient.messages.create({
          model,
          max_tokens: maxTokens,
          system: opts.systemPrompt,
          messages: [{ role: 'user', content: opts.userPrompt }],
        }, {
          timeout: REQUEST_TIMEOUT_MS,
          maxRetries: MAX_RETRIES,
          headers: { 'x-request-id': requestId }
        });

        const block = response.content[0];
        if (!block || block.type !== 'text') {
          throw new Error('No text content in LLM response');
        }
        rawText = block.text;
        usage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };
      } else if (this.provider === 'openai') {
        const response = await this.fetchWithRetry('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'x-request-id': requestId,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0,
            messages: [
              { role: 'system', content: opts.systemPrompt },
              { role: 'user', content: opts.userPrompt },
            ],
            response_format: { type: 'json_object' }
          }),
        }, opts.intentId, requestId);

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
        }

        const parsed = OpenAiResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error(`OpenAI response shape invalid: ${parsed.error.message}`);
        }
        rawText = parsed.data.choices[0]?.message.content ?? '';
        usage = {
          inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
          outputTokens: parsed.data.usage?.completion_tokens ?? 0,
        };
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const response = await this.fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.systemPrompt }] },
            contents: [{ parts: [{ text: opts.userPrompt }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0,
              responseMimeType: "application/json",
            }
          }),
        }, opts.intentId, requestId);

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status} ${await response.text()}`);
        }

        const parsed = GeminiResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error(`Gemini response shape invalid: ${parsed.error.message}`);
        }
        rawText = parsed.data.candidates[0]?.content?.parts?.[0]?.text ?? '';
        usage = {
          inputTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
        };
      }
    } catch (err: unknown) {
      // A retry failure already carries the request id and attempt count —
      // re-wrapping it would bury both behind a second prefix.
      if (err instanceof LlmCallError) throw err;
      throw new LlmCallError(
        opts.intentId,
        this.redact(err instanceof Error ? err.message : String(err)),
      );
    }

    const cleaned = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new LlmCallError(opts.intentId, `Invalid JSON response: ${cleaned.slice(0, 200)}`);
    }

    const result = opts.schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmCallError(opts.intentId, `Schema validation failed: ${result.error.message}`);
    }

    return { result: result.data, usage, model };
  }
}
