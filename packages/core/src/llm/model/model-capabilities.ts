import capabilitiesData from './model-capabilities.generated.json';

export interface ModelCapabilityEntry {
  supportsVision: boolean;
  supportsPdf: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
}

const capabilities = capabilitiesData as Record<string, ModelCapabilityEntry>;

/**
 * Look up multimodal capabilities for a given model ID.
 *
 * Tries in order:
 * 1. Exact match (e.g. "gpt-4o")
 * 2. After stripping a provider prefix (e.g. "openai/gpt-4o" → "gpt-4o")
 * 3. Returns null if not found — callers should treat null as "allow all" to
 *    avoid false positives on unknown models.
 */
export function getModelCapabilities(modelId: string): ModelCapabilityEntry | null {
  if (!modelId) return null;

  // 1. Exact match
  if (capabilities[modelId]) return capabilities[modelId]!;

  // 2. Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o")
  const slashIndex = modelId.indexOf('/');
  if (slashIndex !== -1) {
    const withoutPrefix = modelId.slice(slashIndex + 1);
    if (capabilities[withoutPrefix]) return capabilities[withoutPrefix]!;
  }

  return null;
}
