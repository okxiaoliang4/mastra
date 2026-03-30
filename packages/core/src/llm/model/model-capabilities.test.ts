import { describe, it, expect } from 'vitest';
import { getModelCapabilities } from './model-capabilities';

describe('getModelCapabilities', () => {
  it('returns null for unknown model', () => {
    expect(getModelCapabilities('totally-unknown-model-xyz-9999')).toBeNull();
  });

  it('looks up gpt-4o as vision-capable', () => {
    const caps = getModelCapabilities('gpt-4o');
    expect(caps).not.toBeNull();
    expect(caps!.supportsVision).toBe(true);
  });

  it('strips provider prefix when looking up "openai/gpt-4o"', () => {
    const withPrefix = getModelCapabilities('openai/gpt-4o');
    const withoutPrefix = getModelCapabilities('gpt-4o');
    expect(withPrefix).toEqual(withoutPrefix);
  });

  it('returns null (not throws) for empty string', () => {
    expect(getModelCapabilities('')).toBeNull();
  });
});
