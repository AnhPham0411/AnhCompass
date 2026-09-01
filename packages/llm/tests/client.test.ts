import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmClient, LlmCallError } from '../src/client.js';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn()
      }
    }
  };
});

describe('LlmClient', () => {
  const schema = z.object({ answer: z.string() });
  const schemaOpts = {
    intentId: 'test-intent',
    systemPrompt: 'sys',
    userPrompt: 'user',
    schema
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('Anthropic Provider', () => {
    let client: LlmClient;
    beforeEach(() => {
      client = new LlmClient({ apiKey: 'sk-ant-123', provider: 'anthropic' });
    });



    it('calls messages.create with correct params', async () => {
      const mockCreate = vi.spyOn((client as any).anthropicClient.messages, 'create').mockResolvedValue({
        content: [{ type: 'text', text: '{"answer":"hello"}' }],
        usage: { input_tokens: 10, output_tokens: 20 }
      });

      const res = await client.callWithSchema(schemaOpts);
      expect(res.result).toEqual({ answer: 'hello' });
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(res.model).toBe('claude-haiku-4-5');
      
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
          max_tokens: 1024,
          system: 'sys',
          messages: [{ role: 'user', content: 'user' }]
        }),
        expect.objectContaining({
          timeout: 30000,
          maxRetries: 3,
        })
      );
    });

    it('throws LlmCallError if json is invalid', async () => {
      vi.spyOn((client as any).anthropicClient.messages, 'create').mockResolvedValue({
        content: [{ type: 'text', text: 'not json' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      });
      await expect(client.callWithSchema(schemaOpts)).rejects.toThrow(LlmCallError);
    });

    it('throws LlmCallError if schema is invalid', async () => {
      vi.spyOn((client as any).anthropicClient.messages, 'create').mockResolvedValue({
        content: [{ type: 'text', text: '{"wrong":"key"}' }],
        usage: { input_tokens: 1, output_tokens: 1 }
      });
      await expect(client.callWithSchema(schemaOpts)).rejects.toThrow(LlmCallError);
    });
  });

  describe('OpenAI Provider', () => {
    let client: LlmClient;
    beforeEach(() => {
      client = new LlmClient({ apiKey: 'sk-123', provider: 'openai' });
    });

    it('calls fetch with retry wrapper on success', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"answer":"hello"}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 }
        })
      } as any);

      const res = await client.callWithSchema(schemaOpts);
      expect(res.result).toEqual({ answer: 'hello' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('maps anthropic models to openai models', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"answer":"hello"}' } }]
        })
      } as any);

      const res = await client.callWithSchema({ ...schemaOpts, model: 'claude-3-5-sonnet-20240620' });
      expect(res.model).toBe('gpt-4o');
    });

    it('retries on 429', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 429 } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"answer":"hello"}' } }]
          })
        } as any);

      const promise = client.callWithSchema(schemaOpts);
      promise.catch(() => {}); // prevent unhandled rejection
      await vi.runAllTimersAsync();
      const res = await promise;
      expect(res.result).toEqual({ answer: 'hello' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws if max retries exceeded', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, text: async () => 'error' } as any);

      const promise = client.callWithSchema(schemaOpts);
      promise.catch(() => {}); // prevent unhandled rejection
      await vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow(/OpenAI API error: 500/);
      // fetchWithRetry tries 4 times total (attempt 0, 1, 2, 3)
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Gemini Provider', () => {
    let client: LlmClient;
    beforeEach(() => {
      client = new LlmClient({ apiKey: 'AIzaSy123', provider: 'gemini' });
    });

    it('calls fetch with gemini schema', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"answer":"hello"}' }] } }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 }
        })
      } as any);

      const res = await client.callWithSchema(schemaOpts);
      expect(res.result).toEqual({ answer: 'hello' });
      expect(fetch).toHaveBeenCalledTimes(1);
      
      const args = vi.mocked(fetch).mock.calls[0];
      expect(args[0]).toContain('generativelanguage.googleapis.com');
      expect(args[0]).toContain('AIzaSy123');
    });

    it('retries on 503', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 503 } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '{"answer":"hello"}' }] } }]
          })
        } as any);

      const promise = client.callWithSchema(schemaOpts);
      promise.catch(() => {}); // prevent unhandled rejection
      await vi.runAllTimersAsync();
      await promise;
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Redaction', () => {
    it('redacts API key from error messages', async () => {
      const client = new LlmClient({ apiKey: 'SECRET_KEY_123', provider: 'openai' });
      
      vi.mocked(fetch).mockRejectedValue(new Error('Failed to connect to SECRET_KEY_123 server'));
      
      try {
        const promise = client.callWithSchema(schemaOpts);
        promise.catch(() => {}); // prevent unhandled rejection
        await vi.runAllTimersAsync();
        await promise;
        expect(true).toBe(false); // should not reach
      } catch (err: any) {
        expect(err.message).not.toContain('SECRET_KEY_123');
        expect(err.message).toContain('[REDACTED_API_KEY]');
      }
    });
  });
});
