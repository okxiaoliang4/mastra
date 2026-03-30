import type { LanguageModelV2Prompt } from '@ai-sdk/provider-v5';
import { describe, it, expect } from 'vitest';
import { filterUnsupportedContentParts } from './provider-compat';

const imageFilePart = {
  type: 'file' as const,
  mediaType: 'image/jpeg',
  data: new Uint8Array([1, 2, 3]),
  filename: undefined,
};

const pdfFilePart = {
  type: 'file' as const,
  mediaType: 'application/pdf',
  data: new Uint8Array([1, 2, 3]),
  filename: 'doc.pdf',
};

const textPart = {
  type: 'text' as const,
  text: 'Hello',
};

describe('filterUnsupportedContentParts', () => {
  it('returns messages unchanged when modelId is undefined', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [imageFilePart] }];
    expect(filterUnsupportedContentParts(messages, undefined)).toEqual(messages);
  });

  it('returns messages unchanged when model is unknown', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [imageFilePart] }];
    expect(filterUnsupportedContentParts(messages, 'totally-unknown-model-xyz-9999')).toEqual(messages);
  });

  it('replaces image part with text placeholder when model does not support vision', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [textPart, imageFilePart] }];
    // gpt-4o-audio-preview does not support vision (supportsVision: false in capabilities data)
    const result = filterUnsupportedContentParts(messages, 'gpt-4o-audio-preview');
    const content = (result[0] as { content: unknown[] }).content;
    expect(content[0]).toEqual(textPart);
    expect((content[1] as { type: string }).type).toBe('text');
    expect((content[1] as { text: string }).text).toContain('image/jpeg');
  });

  it('keeps image part when model supports vision', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [imageFilePart] }];
    // gpt-4o supports vision
    const result = filterUnsupportedContentParts(messages, 'gpt-4o');
    expect((result[0] as { content: unknown[] }).content[0]).toEqual(imageFilePart);
  });

  it('replaces pdf part with text placeholder that includes filename', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [pdfFilePart] }];
    // gpt-4o-audio-preview does not support pdf
    const result = filterUnsupportedContentParts(messages, 'gpt-4o-audio-preview');
    const content = (result[0] as { content: unknown[] }).content;
    const placeholder = content[0] as { type: string; text: string };
    expect(placeholder.type).toBe('text');
    expect(placeholder.text).toContain('doc.pdf');
    expect(placeholder.text).toContain('application/pdf');
  });

  it('does not touch system or assistant messages', () => {
    const messages: LanguageModelV2Prompt = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    ];
    const result = filterUnsupportedContentParts(messages, 'gpt-4o-audio-preview');
    expect(result).toEqual(messages);
  });
});
