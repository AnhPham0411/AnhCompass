import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export class LlmCallError extends Error {
  constructor(
    public readonly intentId: string,
    public readonly cause: unknown,
  ) {
    super(`LLM call failed for intent ${intentId}: ${String(cause)}`);
    this.name = 'LlmCallError';
  }
}

export class LlmClient {
  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.defaultModel = opts.model ?? 'claude-haiku-4-5';
  }

  async callWithSchema<T>(opts: {
    intentId: string;
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
    model?: string;
  }): Promise<{ result: T; usage: { inputTokens: number; outputTokens: number }; model: string }> {
    const model = opts.model ?? this.defaultModel;
    const maxTokens = opts.maxTokens ?? 1024;

    let rawText: string;
    let usage: { inputTokens: number; outputTokens: number };

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: opts.systemPrompt,
        messages: [{ role: 'user', content: opts.userPrompt }],
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
    } catch (err) {
      throw new LlmCallError(opts.intentId, err);
    }

    // Strip markdown code fences if present
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
