import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

interface ModelCapabilityEntry {
  supportsVision: boolean;
  supportsPdf: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
}

type ModelCapabilitiesMap = Record<string, ModelCapabilityEntry>;

async function fetchModelCapabilities(): Promise<ModelCapabilitiesMap> {
  const response = await fetch(LITELLM_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch LiteLLM model data: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as Record<string, Record<string, unknown>>;
  const result: ModelCapabilitiesMap = {};

  const EXCLUDED_KEYS = new Set(['sample_spec']);

  for (const [modelId, info] of Object.entries(raw)) {
    if (EXCLUDED_KEYS.has(modelId)) continue;
    // Skip non-model entries (e.g. the "sample_spec" key)
    if (typeof info !== 'object' || info === null) continue;
    if (
      info['supports_vision'] === undefined &&
      info['supports_pdf_input'] === undefined &&
      info['supports_audio_input'] === undefined &&
      info['supports_video_input'] === undefined
    ) {
      continue;
    }

    result[modelId] = {
      supportsVision: Boolean(info['supports_vision']),
      supportsPdf: Boolean(info['supports_pdf_input']),
      supportsAudio: Boolean(info['supports_audio_input']),
      supportsVideo: Boolean(info['supports_video_input']),
    };
  }

  return result;
}

async function main() {
  console.info('Fetching LiteLLM model capability data...');
  const capabilities = await fetchModelCapabilities();

  const outputPath = path.join(__dirname, '..', 'src', 'llm', 'model', 'model-capabilities.generated.json');

  const content = JSON.stringify(capabilities, null, 2) + '\n';
  await fs.writeFile(outputPath, content, 'utf-8');

  console.info(`Written ${Object.keys(capabilities).length} model entries to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
