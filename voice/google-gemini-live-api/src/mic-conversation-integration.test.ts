/**
 * Real microphone conversation integration test using @mastra/node-audio
 *
 * Captures audio from the system microphone, sends it to Gemini Live API,
 * and plays back the model's audio response through the speakers.
 *
 * Requirements:
 *   - GOOGLE_API_KEY environment variable
 *   - A working microphone + speakers
 *
 * Run interactively in your terminal:
 *   GOOGLE_API_KEY=... pnpm vitest run mic-conversation-integration.test.ts
 */

import { createTool } from '@mastra/core/tools';
import { getMicrophoneStream, playAudio } from '@mastra/node-audio';
import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { GeminiLiveVoice } from './index';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const hasApiKey = !!GOOGLE_API_KEY;
const testMode = hasApiKey ? describe : describe.skip;

/** Wait until a condition is met or deadline is reached. */
async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return condition();
}

testMode('GeminiLiveVoice - Real Microphone Conversation', () => {
  let voice: GeminiLiveVoice;

  afterEach(async () => {
    if (voice) {
      await voice.disconnect();
    }
  });

  it('should have a real voice conversation', async () => {
    voice = new GeminiLiveVoice({
      apiKey: GOOGLE_API_KEY,
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      speaker: 'Kore',
      instructions: 'You are a friendly assistant. Keep responses to one sentence.',
      debug: true,
    });

    let audioReceived = false;
    let turnComplete = false;

    // Play model audio responses through speakers
    voice.on('speaker', (stream: NodeJS.ReadableStream) => {
      audioReceived = true;
      playAudio(stream, { sampleRate: 24000, bitDepth: 16, channels: 1 });
    });

    voice.on('turnComplete', () => {
      turnComplete = true;
    });

    // Connect
    console.log('\n🔌 Connecting to Gemini Live API...');
    await voice.connect();
    console.log('✅ Connected!\n');

    // Capture microphone and send to Gemini (16 kHz for Gemini input)
    console.log('🎤 Recording from microphone for 5 seconds...');
    console.log('   Speak now! (e.g. "Hello, how are you?")\n');
    const micStream = getMicrophoneStream({ rate: 16000 });
    await voice.send(micStream);

    // Record for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Stop microphone by destroying the stream
    console.log('🛑 Stopping microphone...');
    (micStream as any).destroy?.();

    // Wait for response
    console.log('⏳ Waiting for model response...\n');
    await waitFor(() => turnComplete || audioReceived, 15_000);

    // Extra time for playback
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Results
    console.log('═══════════════════════════════════════');
    console.log('  Conversation Results');
    console.log('═══════════════════════════════════════');
    console.log(`  Audio received: ${audioReceived ? '✅' : '❌'}`);
    console.log(`  Turn complete:  ${turnComplete ? '✅' : '⏳ timeout'}`);
    console.log('═══════════════════════════════════════\n');

    expect(audioReceived).toBe(true);
  }, 30_000);

  it('should capture mic input, trigger tool call, and speak result', async () => {
    const toolCalled = { value: false, args: {} as Record<string, any> };

    const getWeatherTool = createTool({
      id: 'getWeather',
      description: 'Get the current weather for a location',
      inputSchema: z.object({
        location: z.string().describe('The city or location'),
      }),
      execute: async (args: { location: string }) => {
        console.log('🌤️  getWeather called:', args);
        toolCalled.value = true;
        toolCalled.args = args;
        return { location: args.location, temperature: 18, conditions: 'Sunny', humidity: 55 };
      },
    });

    voice = new GeminiLiveVoice({
      apiKey: GOOGLE_API_KEY,
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      speaker: 'Puck',
      instructions:
        'You are a weather assistant. When the user asks about weather, ALWAYS call the getWeather tool. Keep responses short.',
      debug: true,
    });

    voice.addTools({ getWeather: getWeatherTool });

    let audioReceived = false;

    voice.on('speaker', (stream: NodeJS.ReadableStream) => {
      audioReceived = true;
      playAudio(stream, { sampleRate: 24000, bitDepth: 16, channels: 1 });
    });

    console.log('\n🔌 Connecting...');
    await voice.connect();
    console.log('✅ Connected!\n');

    // Capture microphone
    console.log('🎤 Recording for 6 seconds...');
    console.log('   Say: "What is the weather in Tokyo?"\n');
    const micStream = getMicrophoneStream({ rate: 16000 });
    micStream.addListener('data', chunk => {
      console.log(`🎙️  Captured ${chunk.length} bytes of audio data...`);
    });
    await voice.send(micStream);

    await new Promise(resolve => setTimeout(resolve, 6000));
    (micStream as any).destroy?.();
    console.log('🛑 Mic stopped. Waiting for tool call + response...\n');

    // Wait for tool call
    const gotToolCall = await waitFor(() => toolCalled.value, 15_000);

    // Wait for audio response after tool result
    if (gotToolCall) {
      await waitFor(() => audioReceived, 10_000);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('═══════════════════════════════════════');
    console.log('  Tool Call + Voice Results');
    console.log('═══════════════════════════════════════');
    console.log(`  Tool called:    ${toolCalled.value ? '✅' : '❌'}`);
    console.log(`  Tool args:      ${JSON.stringify(toolCalled.args)}`);
    console.log(`  Audio received: ${audioReceived ? '✅' : '❌'}`);
    console.log('═══════════════════════════════════════\n');

    expect(toolCalled.value).toBe(true);
    expect(audioReceived).toBe(true);
  }, 45_000);
});

if (!hasApiKey) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Mic conversation tests SKIPPED — No API key                 ║
║                                                              ║
║  Run interactively:                                          ║
║  GOOGLE_API_KEY=... pnpm vitest run                          ║
║      mic-conversation-integration.test.ts                    ║
║                                                              ║
║  Requirements: working microphone + speakers                 ║
╚══════════════════════════════════════════════════════════════╝
`);
}
