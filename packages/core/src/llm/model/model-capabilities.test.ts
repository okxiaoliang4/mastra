import { describe, it, expect } from 'vitest';
import { getModelCapabilities, isMimeTypeSupported } from './model-capabilities';

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

describe('isMimeTypeSupported', () => {
  it('returns null for unknown model', () => {
    expect(isMimeTypeSupported('unknown-model-xyz', 'image/jpeg')).toBeNull();
  });

  it('returns true for image on vision-capable model', () => {
    expect(isMimeTypeSupported('gpt-4o', 'image/jpeg')).toBe(true);
  });

  it('returns false for image on non-vision model', () => {
    expect(isMimeTypeSupported('gpt-4o-audio-preview', 'image/png')).toBe(false);
  });

  it('returns true for text/* on any known model', () => {
    expect(isMimeTypeSupported('gpt-4o-audio-preview', 'text/csv')).toBe(true);
    expect(isMimeTypeSupported('gpt-4o', 'text/plain')).toBe(true);
  });

  it('returns false for docx on known model (unknown MIME = unsupported)', () => {
    expect(
      isMimeTypeSupported('gpt-4o', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(false);
  });

  it('returns null for docx on unknown model', () => {
    expect(
      isMimeTypeSupported(
        'unknown-model-xyz',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBeNull();
  });
});
