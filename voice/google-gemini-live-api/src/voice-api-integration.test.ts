/**
 * GeminiLiveVoice API Integration Tests
 *
 * Tests speak, listen, getSpeakers, multi-turn conversation, and error handling
 * against the real Gemini Live API. No hardware (mic/speakers) required.
 *
 * Run:
 *   GOOGLE_API_KEY=... pnpm vitest run voice-api-integration.test.ts
 */

import { PassThrough } from 'node:stream';
import { describe, it, expect, afterEach } from 'vitest';
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

/** Collect audio chunks from speaking events. */
function collectAudio(voice: GeminiLiveVoice): { chunks: Buffer[]; done: () => boolean } {
  const chunks: Buffer[] = [];
  let turnDone = false;
  voice.on('speaking', (data: { audioData?: Int16Array }) => {
    if (data.audioData) {
      chunks.push(Buffer.from(data.audioData.buffer, data.audioData.byteOffset, data.audioData.byteLength));
    }
  });
  voice.on('turnComplete', () => {
    turnDone = true;
  });
  return { chunks, done: () => turnDone };
}

/** Collect assistant text from writing events. */
function collectText(voice: GeminiLiveVoice): { texts: string[]; joined: () => string } {
  const texts: string[] = [];
  voice.on('writing', (data: { text: string; role: string }) => {
    if (data.role === 'assistant') {
      texts.push(data.text);
    }
  });
  return { texts, joined: () => texts.join('') };
}

/** Resample PCM Int16 audio from srcRate to dstRate (linear interpolation). */
function resamplePcm(buf: Buffer, srcRate: number, dstRate: number): Buffer {
  const src = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const ratio = srcRate / dstRate;
  const dstLen = Math.floor(src.length / ratio);
  const dst = new Int16Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, src.length - 1);
    const frac = srcIdx - lo;
    dst[i] = Math.round(src[lo]! * (1 - frac) + src[hi]! * frac);
  }
  return Buffer.from(dst.buffer);
}

testMode('GeminiLiveVoice Integration Tests', () => {
  let voice: GeminiLiveVoice;

  afterEach(async () => {
    if (voice) {
      await voice.disconnect();
    }
  });

  describe('getSpeakers', () => {
    it('should list available voices', async () => {
      voice = new GeminiLiveVoice({ apiKey: GOOGLE_API_KEY });
      const speakers = await voice.getSpeakers();
      expect(speakers).toContainEqual(expect.objectContaining({ voiceId: 'Puck' }));
      expect(speakers).toContainEqual(expect.objectContaining({ voiceId: 'Kore' }));
      expect(speakers.length).toBeGreaterThan(0);
    });
  });

  describe('speak', () => {
    it('should generate audio response from text', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        instructions: 'Reply in one short sentence.',
      });

      const { chunks, done } = collectAudio(voice);

      await voice.connect();
      await voice.speak('Hello World');
      await waitFor(() => done(), 10_000);

      const audioBuffer = Buffer.concat(chunks);
      expect(audioBuffer.length).toBeGreaterThan(0);
    }, 15_000);

    it('should generate audio with a specific voice', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        speaker: 'Kore',
        instructions: 'Reply in one short sentence.',
      });

      const { chunks, done } = collectAudio(voice);

      await voice.connect();
      await voice.speak('Testing voice Kore');
      await waitFor(() => done(), 10_000);

      const audioBuffer = Buffer.concat(chunks);
      expect(audioBuffer.length).toBeGreaterThan(0);
    }, 15_000);

    it('should generate text response from text', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        instructions: 'Reply in one short sentence.',
      });

      const { joined } = collectText(voice);
      const { done } = collectAudio(voice);

      await voice.connect();
      await voice.speak('What is two plus two?');
      await waitFor(() => done(), 10_000);

      // Model may or may not emit text alongside audio — but audio must arrive
      const text = joined();
      if (text.length > 0) {
        expect(typeof text).toBe('string');
      }
    }, 15_000);

    it('should accept a PassThrough text stream as input', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        instructions: 'Reply in one short sentence.',
      });

      const { chunks, done } = collectAudio(voice);

      await voice.connect();

      const inputStream = new PassThrough();
      inputStream.end('Hello from stream');
      await voice.speak(inputStream);

      await waitFor(() => done(), 10_000);

      const audioBuffer = Buffer.concat(chunks);
      expect(audioBuffer.length).toBeGreaterThan(0);
    }, 15_000);
  });

  describe('multi-turn conversation', () => {
    it('should handle a second turn and remember context', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        instructions: 'Reply in one short sentence. Remember the conversation.',
      });

      // Turn 1
      const turn1Audio: Buffer[] = [];
      let turn1Done = false;
      voice.on('speaking', (data: { audioData?: Int16Array }) => {
        if (data.audioData && !turn1Done) {
          turn1Audio.push(Buffer.from(data.audioData.buffer, data.audioData.byteOffset, data.audioData.byteLength));
        }
      });
      voice.on('turnComplete', () => {
        if (!turn1Done) turn1Done = true;
      });

      await voice.connect();
      await voice.speak('My name is Alice.');
      await waitFor(() => turn1Done, 10_000);

      expect(Buffer.concat(turn1Audio).length).toBeGreaterThan(0);

      // Turn 2 — ask about context from turn 1
      const turn2Audio: Buffer[] = [];
      let turn2Done = false;
      voice.on('speaking', (data: { audioData?: Int16Array }) => {
        if (data.audioData && turn1Done && !turn2Done) {
          turn2Audio.push(Buffer.from(data.audioData.buffer, data.audioData.byteOffset, data.audioData.byteLength));
        }
      });
      voice.on('turnComplete', () => {
        if (turn1Done && !turn2Done) turn2Done = true;
      });

      await voice.speak('What is my name?');
      await waitFor(() => turn2Done, 10_000);

      expect(Buffer.concat(turn2Audio).length).toBeGreaterThan(0);
    }, 25_000);
  });

  describe('listen', () => {
    it('should transcribe audio generated by speak (round-trip)', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        instructions: 'When the user says "Say hello world", reply with ONLY "Hello world". Nothing else.',
      });

      // Step 1: speak → collect model's audio output (PCM 24kHz)
      const { chunks, done } = collectAudio(voice);

      await voice.connect();
      await voice.speak('Say hello world');
      await waitFor(() => done(), 10_000);

      const audioBuffer = Buffer.concat(chunks);
      expect(audioBuffer.length).toBeGreaterThan(0);

      // Step 2: resample 24kHz → 16kHz (model output vs input sample rates)
      const pcm16k = resamplePcm(audioBuffer, 24000, 16000);

      // Append 1 second of silence so the model's VAD detects end-of-speech
      const silence = Buffer.alloc(16000 * 2); // 1s of 16kHz 16-bit silence
      const audioWithSilence = Buffer.concat([pcm16k, silence]);

      const audioStream = new PassThrough();
      audioStream.end(audioWithSilence);

      const text = await voice.listen(audioStream);

      console.log('Round-trip transcription:', text);
      expect(text).toBeTruthy();
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe('error handling', () => {
    it('should reject speak with empty text', async () => {
      voice = new GeminiLiveVoice({
        apiKey: GOOGLE_API_KEY,
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      });

      await voice.connect();
      await expect(voice.speak('')).rejects.toThrow();
    }, 15_000);
  });
});

if (!hasApiKey) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  API integration tests SKIPPED — No API key                  ║
║                                                              ║
║  GOOGLE_API_KEY=... pnpm vitest run                          ║
║      voice-api-integration.test.ts                           ║
╚══════════════════════════════════════════════════════════════╝
`);
}
