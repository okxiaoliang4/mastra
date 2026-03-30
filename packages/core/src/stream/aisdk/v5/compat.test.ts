import { describe, it, expect } from 'vitest';
import { convertFullStreamChunkToUIMessageStream } from './compat';

describe('convertFullStreamChunkToUIMessageStream', () => {
  it('should convert tool-output part into UI message with correct format', () => {
    // Arrange: Create a tool-output part with sample data
    const toolOutput = {
      type: 'tool-output' as const,
      toolCallId: 'test-tool-123',
      output: {
        content: 'Sample tool output content',
        timestamp: 1234567890,
        metadata: {
          source: 'test',
          version: '1.0',
        },
        status: 'success',
      },
    };

    // Act: Convert the tool output to UI message
    const result = convertFullStreamChunkToUIMessageStream({
      part: toolOutput,
      onError: error => `Error: ${error}`,
    });

    // Assert: Verify the transformation
    expect(result).toBeDefined();
    expect(result).toEqual({
      content: 'Sample tool output content',
      timestamp: 1234567890,
      metadata: {
        source: 'test',
        version: '1.0',
      },
      status: 'success',
    });
  });

  it('should preserve provider metadata on file parts', () => {
    const result = convertFullStreamChunkToUIMessageStream({
      part: {
        type: 'file',
        file: {
          mediaType: 'image/jpeg',
          base64: '/9j/4AAQSkZJRgABAQEA',
        },
        providerMetadata: {
          google: {
            thoughtSignature: 'sig-image-1',
          },
        },
      } as any,
      onError: error => `Error: ${error}`,
    });

    expect(result).toEqual({
      type: 'file',
      mediaType: 'image/jpeg',
      url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA',
      providerMetadata: {
        google: {
          thoughtSignature: 'sig-image-1',
        },
      },
    });
  });
});
