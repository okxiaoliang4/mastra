# Model Capability Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch LiteLLM's model capability database and use it to filter unsupported image/file parts from conversation history before sending to the LLM, converting them to descriptive text placeholders.

**Architecture:** A fetch script downloads LiteLLM's `model_prices_and_context_window.json`, extracts only the multimodal capability fields, and saves a generated JSON to `packages/core/src/llm/model/`. A runtime module reads this JSON to look up capabilities by model ID. A new filter function in `provider-compat.ts` converts unsupported file/image parts to text placeholders. The `llmPrompt()` method receives a `modelId` option and applies the filter before returning.

**Tech Stack:** Node.js fetch, TypeScript, existing `LanguageModelV2Prompt` types from `@ai-sdk/provider-v5`

---

## File Map

| Action | Path                                                                       | Purpose                                                     |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Create | `packages/core/scripts/fetch-model-capabilities.ts`                        | Fetch + transform LiteLLM JSON, write generated file        |
| Create | `packages/core/src/llm/model/model-capabilities.generated.json`            | Generated capability data (committed, refreshed via script) |
| Create | `packages/core/src/llm/model/model-capabilities.ts`                        | Runtime lookup: `getModelCapabilities(modelId)`             |
| Modify | `packages/core/src/agent/message-list/utils/provider-compat.ts`            | Add `filterUnsupportedContentParts()`                       |
| Modify | `packages/core/src/agent/message-list/message-list.ts`                     | Pass `modelId` to `llmPrompt()`, apply filter               |
| Modify | `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts` | Pass `model.modelId` into `messageListPromptArgs`           |
| Modify | `packages/core/package.json`                                               | Add `generate:model-capabilities` script                    |

---

### Task 1: Fetch script

**Files:**

- Create: `packages/core/scripts/fetch-model-capabilities.ts`
- Modify: `packages/core/package.json` (add script entry)

The LiteLLM URL is:
`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`

Fields to extract per model:

- `supports_vision` → image/\* MIME types
- `supports_pdf_input` → application/pdf
- `supports_audio_input` → audio/\* MIME types
- `supports_video_input` → video/\* MIME types

- [ ] **Step 1: Write the failing test (build + run check)**

This script has no unit tests — verify by running it after writing. Skip to Step 2.

- [ ] **Step 2: Write the script**

Create `packages/core/scripts/fetch-model-capabilities.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

export interface ModelCapabilityEntry {
  supportsVision: boolean
  supportsPdf: boolean
  supportsAudio: boolean
  supportsVideo: boolean
}

export type ModelCapabilitiesMap = Record<string, ModelCapabilityEntry>

async function fetchModelCapabilities(): Promise<ModelCapabilitiesMap> {
  const response = await fetch(LITELLM_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch LiteLLM model data: ${response.status} ${response.statusText}`)
  }

  const raw = (await response.json()) as Record<string, Record<string, unknown>>
  const result: ModelCapabilitiesMap = {}

  for (const [modelId, info] of Object.entries(raw)) {
    // Skip non-model entries (e.g. the "sample_spec" key)
    if (typeof info !== 'object' || info === null) continue
    if (
      info['supports_vision'] === undefined &&
      info['supports_pdf_input'] === undefined &&
      info['supports_audio_input'] === undefined &&
      info['supports_video_input'] === undefined
    ) {
      continue
    }

    result[modelId] = {
      supportsVision: Boolean(info['supports_vision']),
      supportsPdf: Boolean(info['supports_pdf_input']),
      supportsAudio: Boolean(info['supports_audio_input']),
      supportsVideo: Boolean(info['supports_video_input']),
    }
  }

  return result
}

async function main() {
  console.info('Fetching LiteLLM model capability data...')
  const capabilities = await fetchModelCapabilities()

  const outputPath = path.join(__dirname, '..', 'src', 'llm', 'model', 'model-capabilities.generated.json')

  const content = JSON.stringify(capabilities, null, 2)
  await fs.writeFile(outputPath, content, 'utf-8')

  console.info(`Written ${Object.keys(capabilities).length} model entries to ${outputPath}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 3: Add script to `package.json`**

In `packages/core/package.json`, inside `"scripts"`, add after `"generate:model-router"`:

```json
"generate:model-capabilities": "pnpx tsx scripts/fetch-model-capabilities.ts",
```

- [ ] **Step 4: Run the script to generate the JSON**

```bash
cd packages/core && pnpm generate:model-capabilities
```

Expected output:

```
Fetching LiteLLM model capability data...
Written NNNN model entries to .../model-capabilities.generated.json
```

Verify the file exists and has entries like:

```json
{
  "gpt-4o": {
    "supportsVision": true,
    "supportsPdf": false,
    "supportsAudio": false,
    "supportsVideo": false
  },
  ...
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/scripts/fetch-model-capabilities.ts packages/core/package.json packages/core/src/llm/model/model-capabilities.generated.json
git commit -m "feat(core): add script to fetch LiteLLM model capability data"
```

---

### Task 2: Runtime capability lookup module

**Files:**

- Create: `packages/core/src/llm/model/model-capabilities.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/llm/model/model-capabilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getModelCapabilities } from './model-capabilities'

describe('getModelCapabilities', () => {
  it('returns null for unknown model', () => {
    expect(getModelCapabilities('totally-unknown-model-xyz-9999')).toBeNull()
  })

  it('looks up gpt-4o as vision-capable', () => {
    const caps = getModelCapabilities('gpt-4o')
    // gpt-4o is a real model in LiteLLM — should have supportsVision: true
    expect(caps).not.toBeNull()
    expect(caps!.supportsVision).toBe(true)
  })

  it('strips provider prefix when looking up "openai/gpt-4o"', () => {
    const withPrefix = getModelCapabilities('openai/gpt-4o')
    const withoutPrefix = getModelCapabilities('gpt-4o')
    // Both should resolve (may both be null if data changes, but should be equal)
    expect(withPrefix).toEqual(withoutPrefix)
  })

  it('returns null (not throws) for empty string', () => {
    expect(getModelCapabilities('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test:unit -- model-capabilities.test
```

Expected: FAIL — `Cannot find module './model-capabilities'`

- [ ] **Step 3: Write the module**

Create `packages/core/src/llm/model/model-capabilities.ts`:

```ts
import capabilitiesData from './model-capabilities.generated.json' assert { type: 'json' }

export interface ModelCapabilityEntry {
  supportsVision: boolean
  supportsPdf: boolean
  supportsAudio: boolean
  supportsVideo: boolean
}

const capabilities = capabilitiesData as Record<string, ModelCapabilityEntry>

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
  if (!modelId) return null

  // 1. Exact match
  if (capabilities[modelId]) return capabilities[modelId]!

  // 2. Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o")
  const slashIndex = modelId.indexOf('/')
  if (slashIndex !== -1) {
    const withoutPrefix = modelId.slice(slashIndex + 1)
    if (capabilities[withoutPrefix]) return capabilities[withoutPrefix]!
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && pnpm test:unit -- model-capabilities.test
```

Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/model/model-capabilities.ts packages/core/src/llm/model/model-capabilities.test.ts
git commit -m "feat(core): add model capability lookup from generated LiteLLM data"
```

---

### Task 3: Filter function in provider-compat.ts

**Files:**

- Modify: `packages/core/src/agent/message-list/utils/provider-compat.ts`

The filter operates on `LanguageModelV2Prompt` (array of `LanguageModelV2Message`). After `llmPrompt()` processing, all image parts have been converted to `type: 'file'` with a `mediaType` field. The filter replaces unsupported file parts with a `type: 'text'` placeholder.

MIME type → capability mapping:

- `image/*` or `image/...` → `supportsVision`
- `application/pdf` → `supportsPdf`
- `audio/*` or `audio/...` → `supportsAudio`
- `video/*` or `video/...` → `supportsVideo`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/agent/message-list/utils/convert-messages.test.ts` (or create a new file `provider-compat.test.ts` in the same directory if it doesn't already test this module):

Check if a test file for `provider-compat.ts` exists first. If not, create `packages/core/src/agent/message-list/utils/provider-compat.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { LanguageModelV2Prompt } from '@ai-sdk/provider-v5'
import { filterUnsupportedContentParts } from './provider-compat'

const imageFilePart = {
  type: 'file' as const,
  mediaType: 'image/jpeg',
  data: new Uint8Array([1, 2, 3]),
  filename: undefined,
}

const pdfFilePart = {
  type: 'file' as const,
  mediaType: 'application/pdf',
  data: new Uint8Array([1, 2, 3]),
  filename: 'doc.pdf',
}

const textPart = {
  type: 'text' as const,
  text: 'Hello',
}

describe('filterUnsupportedContentParts', () => {
  it('returns messages unchanged when modelId is unknown', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [imageFilePart] }]
    const result = filterUnsupportedContentParts(messages, 'unknown-model-xyz')
    expect(result).toEqual(messages)
  })

  it('replaces image part with text placeholder when model does not support vision', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [textPart, imageFilePart] }]
    // gpt-3.5-turbo does not support vision
    const result = filterUnsupportedContentParts(messages, 'gpt-3.5-turbo')
    const content = (result[0] as { content: unknown[] }).content
    expect(content[0]).toEqual(textPart)
    expect((content[1] as { type: string }).type).toBe('text')
    expect((content[1] as { text: string }).text).toContain('image/jpeg')
  })

  it('keeps image part when model supports vision', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [imageFilePart] }]
    // gpt-4o supports vision
    const result = filterUnsupportedContentParts(messages, 'gpt-4o')
    expect((result[0] as { content: unknown[] }).content[0]).toEqual(imageFilePart)
  })

  it('replaces pdf part with text placeholder when model does not support pdf', () => {
    const messages: LanguageModelV2Prompt = [{ role: 'user', content: [pdfFilePart] }]
    const result = filterUnsupportedContentParts(messages, 'gpt-4o')
    const content = (result[0] as { content: unknown[] }).content
    // gpt-4o does not support PDF
    expect((content[0] as { type: string }).type).toBe('text')
    expect((content[0] as { text: string }).text).toContain('doc.pdf')
    expect((content[0] as { text: string }).text).toContain('application/pdf')
  })

  it('does not touch system or assistant messages', () => {
    const messages: LanguageModelV2Prompt = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    ]
    const result = filterUnsupportedContentParts(messages, 'gpt-3.5-turbo')
    expect(result).toEqual(messages)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && pnpm test:unit -- provider-compat.test
```

Expected: FAIL — `filterUnsupportedContentParts is not exported`

- [ ] **Step 3: Write the filter function**

Add to `packages/core/src/agent/message-list/utils/provider-compat.ts` (append at the bottom, after existing sections):

```ts
// ============================================================================
// Model Capability Filtering
// ============================================================================

import type { LanguageModelV2Prompt, LanguageModelV2Message } from '@ai-sdk/provider-v5'
import { getModelCapabilities } from '../../../llm/model/model-capabilities'

/**
 * Classifies a MIME type against model capability fields.
 */
function getRequiredCapability(
  mediaType: string,
): keyof import('../../../llm/model/model-capabilities').ModelCapabilityEntry | null {
  if (mediaType.startsWith('image/') || mediaType === 'image/*') return 'supportsVision'
  if (mediaType === 'application/pdf') return 'supportsPdf'
  if (mediaType.startsWith('audio/') || mediaType === 'audio/*') return 'supportsAudio'
  if (mediaType.startsWith('video/') || mediaType === 'video/*') return 'supportsVideo'
  return null
}

/**
 * Builds a descriptive text placeholder for a file part that cannot be sent.
 */
function buildPlaceholderText(part: { mediaType: string; filename?: string }): string {
  const label = part.filename ? `"${part.filename}" (${part.mediaType})` : part.mediaType
  return `[File ${label} was not sent — the current model does not support this content type]`
}

/**
 * Filters unsupported image/file content parts from a LanguageModelV2Prompt
 * based on the target model's known capabilities.
 *
 * When the model is unknown (not in the capabilities database), messages are
 * returned unchanged to avoid false positives.
 *
 * Unsupported parts are replaced with a descriptive text placeholder so the
 * model is aware that content was present but could not be included.
 *
 * @param messages - The prompt messages to filter
 * @param modelId  - The model ID (e.g. "gpt-4o", "openai/gpt-4o")
 * @returns Filtered prompt messages
 */
export function filterUnsupportedContentParts(
  messages: LanguageModelV2Prompt,
  modelId: string | undefined,
): LanguageModelV2Prompt {
  if (!modelId) return messages

  const caps = getModelCapabilities(modelId)
  if (!caps) return messages // unknown model — allow all

  return messages.map((message): LanguageModelV2Message => {
    // Only filter user messages; leave system/assistant/tool as-is
    if (message.role !== 'user') return message
    if (typeof message.content === 'string') return message

    const filteredContent = message.content.map(part => {
      if (part.type !== 'file') return part

      const requiredCap = getRequiredCapability(part.mediaType)
      if (!requiredCap) return part // unknown MIME type — pass through

      if (caps[requiredCap]) return part // supported — keep

      // Not supported — replace with text placeholder
      return {
        type: 'text' as const,
        text: buildPlaceholderText(part),
      }
    })

    return { ...message, content: filteredContent }
  })
}
```

Note: The `import` statements at the top of the block need to be added to the top-level imports of the file, not inline. Move the two import lines to the top of `provider-compat.ts` alongside existing imports.

- [ ] **Step 4: Fix imports — add to top of `provider-compat.ts`**

At the top of the file, the existing imports are:

```ts
import type { CoreMessage as CoreMessageV4 } from '@internal/ai-sdk-v4'
import type { ModelMessage, ToolResultPart } from '@internal/ai-sdk-v5'
import type { IMastraLogger } from '../../../logger'
import type { MastraDBMessage } from '../state/types'
```

Add:

```ts
import type { LanguageModelV2Prompt, LanguageModelV2Message } from '@ai-sdk/provider-v5'
import { getModelCapabilities } from '../../../llm/model/model-capabilities'
import type { ModelCapabilityEntry } from '../../../llm/model/model-capabilities'
```

And in the function body, replace the inline `import(...)` type with `keyof ModelCapabilityEntry`.

Final signature of `getRequiredCapability`:

```ts
function getRequiredCapability(mediaType: string): keyof ModelCapabilityEntry | null {
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/core && pnpm test:unit -- provider-compat.test
```

Expected: PASS

- [ ] **Step 6: Run typecheck**

```bash
cd packages/core && pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agent/message-list/utils/provider-compat.ts packages/core/src/agent/message-list/utils/provider-compat.test.ts
git commit -m "feat(core): filter unsupported multimodal parts based on model capabilities"
```

---

### Task 4: Wire modelId through llmPrompt()

**Files:**

- Modify: `packages/core/src/agent/message-list/message-list.ts`
- Modify: `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts`

- [ ] **Step 1: Add `modelId` to `llmPrompt()` options and apply filter**

In `packages/core/src/agent/message-list/message-list.ts`, the `llmPrompt` function signature at line ~373:

```ts
llmPrompt: async (
  options: {
    downloadConcurrency?: number;
    downloadRetries?: number;
    supportedUrls?: Record<string, RegExp[]>;
  } = { ... }
```

Change to:

```ts
llmPrompt: async (
  options: {
    downloadConcurrency?: number;
    downloadRetries?: number;
    supportedUrls?: Record<string, RegExp[]>;
    modelId?: string;
  } = {
    downloadConcurrency: 10,
    downloadRetries: 3,
  },
```

At the end of `llmPrompt`, just before `return messages`, the existing code is:

```ts
return messages
  .map(aiV5ModelMessageToV2PromptMessage)
  .filter(message => message.role === 'system' || typeof message.content === 'string' || message.content.length > 0)
```

Change to:

```ts
const prompt = messages
  .map(aiV5ModelMessageToV2PromptMessage)
  .filter(message => message.role === 'system' || typeof message.content === 'string' || message.content.length > 0)

return filterUnsupportedContentParts(prompt, options.modelId)
```

Add the import at the top of `message-list.ts`:

```ts
import { ensureGeminiCompatibleMessages, filterUnsupportedContentParts } from './utils/provider-compat'
```

(Replace the existing import of `ensureGeminiCompatibleMessages` if it's separate.)

- [ ] **Step 2: Pass `modelId` from `llm-execution-step.ts`**

In `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts`, around line 898:

Existing:

```ts
const messageListPromptArgs = {
  downloadRetries,
  downloadConcurrency,
  supportedUrls: resolvedSupportedUrls,
}
```

Change to:

```ts
const messageListPromptArgs = {
  downloadRetries,
  downloadConcurrency,
  supportedUrls: resolvedSupportedUrls,
  modelId: currentStep.model?.modelId,
}
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

```bash
cd packages/core && pnpm test:unit -- message-list
```

Expected: all existing tests pass

- [ ] **Step 4: Run typecheck**

```bash
cd packages/core && pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/message-list/message-list.ts packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts
git commit -m "feat(core): pass modelId to llmPrompt and apply capability filtering"
```

---

### Task 5: Export from llm/model index and add changeset

**Files:**

- Modify: `packages/core/src/llm/model/index.ts`
- Create: `.changeset/<auto-generated>.md`

- [ ] **Step 1: Export from index**

In `packages/core/src/llm/model/index.ts`, add:

```ts
export { getModelCapabilities, type ModelCapabilityEntry } from './model-capabilities'
```

- [ ] **Step 2: Create changeset**

```bash
cd /Volumes/data/projects/mastra && pnpm changeset
```

Select `@mastra/core` as the affected package, type `patch`, and enter:

```
feat: filter unsupported multimodal content parts (images, PDFs, audio, video) from conversation history based on model capabilities sourced from LiteLLM
```

- [ ] **Step 3: Run full core test suite**

```bash
cd packages/core && pnpm test:unit
```

Expected: all tests pass

- [ ] **Step 4: Final commit**

```bash
git add packages/core/src/llm/model/index.ts .changeset/
git commit -m "chore: export getModelCapabilities and add changeset"
```

---

## Self-Review

**Spec coverage:**

- ✅ Fetch script in `scripts/` that writes to `packages/core/src/llm/model/`
- ✅ Reads LiteLLM JSON capability fields
- ✅ Filters unsupported image parts
- ✅ Filters unsupported file parts
- ✅ Converts unsupported parts to descriptive text (not silently dropped)
- ✅ Unknown models pass through unchanged (safe default)
- ✅ `modelId` flows from the model execution step into `llmPrompt()`

**Placeholder scan:** No TBDs, all code is complete.

**Type consistency:**

- `ModelCapabilityEntry` defined in Task 2, imported in Task 3 — consistent
- `filterUnsupportedContentParts(prompt, modelId)` signature used in Task 3 and Task 4 — consistent
- `options.modelId` added to `llmPrompt` in Task 4, passed from `llm-execution-step.ts` in same task — consistent
