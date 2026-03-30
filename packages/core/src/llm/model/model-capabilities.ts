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

/**
 * Check whether a model supports a given MIME type.
 *
 * @returns
 *  - `true`  — model is known and supports this MIME type
 *  - `false` — model is known and does NOT support this MIME type
 *  - `null`  — model is unknown (caller decides how to handle)
 *
 * MIME classification:
 *  - `text/*`          → always supported (returns true)
 *  - `image/*`         → requires supportsVision
 *  - `application/pdf` → requires supportsPdf
 *  - `audio/*`         → requires supportsAudio
 *  - `video/*`         → requires supportsVideo
 *  - anything else     → returns false (unknown MIME on known model)
 */
export function isMimeTypeSupported(modelId: string, mimeType: string): boolean | null {
  const caps = getModelCapabilities(modelId);
  if (!caps) return null;

  // text/* is safe for all text models
  if (mimeType.startsWith('text/')) return true;

  if (mimeType.startsWith('image/') || mimeType === 'image/*') return caps.supportsVision;
  if (mimeType === 'application/pdf') return caps.supportsPdf;
  if (mimeType.startsWith('audio/') || mimeType === 'audio/*') return caps.supportsAudio;
  if (mimeType.startsWith('video/') || mimeType === 'video/*') return caps.supportsVideo;

  // Unknown MIME type on a known model — assume unsupported
  return false;
}
