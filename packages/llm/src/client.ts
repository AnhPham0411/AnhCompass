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
  private readonly anthropicClient?: Anthropic;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly provider: 'anthropic' | 'openai' | 'gemini';

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    
    if (this.apiKey.startsWith('sk-ant-')) {
      this.provider = 'anthropic';
      this.anthropicClient = new Anthropic({ apiKey: this.apiKey });
      this.defaultModel = opts.model ?? 'claude-3-haiku-20240307';
    } else if (this.apiKey.startsWith('sk-')) {
      this.provider = 'openai';
      this.defaultModel = opts.model ?? 'gpt-4o-mini';
    } else {
      this.provider = 'gemini';
      this.defaultModel = opts.model ?? 'gemini-1.5-flash';
    }
  }

  async callWithSchema<T>(opts: {
    intentId: string;
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
    model?: string; // May be passed from budget routing (e.g., 'claude-haiku-4-5')
  }): Promise<{ result: T; usage: { inputTokens: number; outputTokens: number }; model: string }> {
    let model = opts.model ?? this.defaultModel;
    
    // Auto-map model names if they come from Anthropic budget routing
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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
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
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
        }

        const data = await response.json() as any;
        rawText = data.choices[0]?.message?.content || '';
        usage = {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
        };
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.systemPrompt }] },
            contents: [{ parts: [{ text: opts.userPrompt }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0,
              responseMimeType: "application/json",
            }
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status} ${await response.text()}`);
        }

        const data = await response.json() as any;
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        usage = {
          inputTokens: data.usageMetadata?.promptTokenCount || 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        };
      }
    } catch (err) {
      throw new LlmCallError(opts.intentId, err);
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
