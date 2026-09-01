import { describe, it, expect } from 'vitest';
import {
  resolveLlmApiKey,
  resolveLlmProvider,
  inferProviderFromKey,
  providerWasInferred,
  UnknownLlmProviderError,
  LLM_PROVIDERS,
} from '../src/env.js';

describe('resolveLlmApiKey', () => {
  it('prefers the explicit override over vendor variables', () => {
    expect(resolveLlmApiKey({ LLM_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' })).toBe('a');
  });

  it('falls back through the vendor variables in order', () => {
    expect(resolveLlmApiKey({ OPENAI_API_KEY: 'o' })).toBe('o');
    expect(resolveLlmApiKey({ GEMINI_API_KEY: 'g' })).toBe('g');
  });

  it('treats a blank value as absent', () => {
    expect(resolveLlmApiKey({ LLM_API_KEY: '   ' })).toBeUndefined();
    expect(resolveLlmApiKey({})).toBeUndefined();
  });
});

describe('inferProviderFromKey', () => {
  it('reads the Anthropic prefix', () => {
    expect(inferProviderFromKey('sk-ant-abc')).toBe('anthropic');
  });

  it('reads a bare sk- prefix as OpenAI', () => {
    expect(inferProviderFromKey('sk-abc')).toBe('openai');
    expect(inferProviderFromKey('sk-proj-abc')).toBe('openai');
  });

  it('falls through to Gemini for anything else', () => {
    expect(inferProviderFromKey('AIzaSyABC')).toBe('gemini');
    // The documented weakness of guessing: an unknown key shape is not
    // reported as unknown, it is routed to the last branch.
    expect(inferProviderFromKey('totally-unrecognised')).toBe('gemini');
  });
});

describe('resolveLlmProvider', () => {
  it('lets an explicit argument win over the environment and the key', () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: 'gemini' }, 'sk-ant-x', 'openai')).toBe('openai');
  });

  it('reads LLM_PROVIDER when no argument is given', () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: 'anthropic' }, 'sk-abc')).toBe('anthropic');
  });

  it('accepts any casing and surrounding space', () => {
    expect(resolveLlmProvider({}, 'sk-abc', '  OpenAI ')).toBe('openai');
  });

  it('falls back to the key shape when nothing is declared', () => {
    expect(resolveLlmProvider({}, 'sk-ant-abc')).toBe('anthropic');
  });

  it('throws on a declared provider that does not exist', () => {
    expect(() => resolveLlmProvider({}, 'sk-abc', 'claude')).toThrow(UnknownLlmProviderError);
    expect(() => resolveLlmProvider({ LLM_PROVIDER: 'openai-ish' }, 'sk-abc')).toThrow(
      UnknownLlmProviderError,
    );
  });

  it('names the accepted values in the error, so the typo is fixable', () => {
    try {
      resolveLlmProvider({}, 'sk-abc', 'claude');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(String(err)).toContain('anthropic');
      expect(String(err)).toContain('LLM_PROVIDER');
    }
  });

  it('ignores a blank LLM_PROVIDER rather than rejecting it', () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: '  ' }, 'sk-ant-x')).toBe('anthropic');
  });

  it('resolves every provider it advertises', () => {
    for (const p of LLM_PROVIDERS) {
      expect(resolveLlmProvider({}, 'sk-abc', p)).toBe(p);
    }
  });
});

describe('providerWasInferred', () => {
  it('is false when the caller declared one', () => {
    expect(providerWasInferred({}, 'openai')).toBe(false);
    expect(providerWasInferred({ LLM_PROVIDER: 'openai' })).toBe(false);
  });

  it('is true when only the key was available to go on', () => {
    expect(providerWasInferred({})).toBe(true);
  });
});
