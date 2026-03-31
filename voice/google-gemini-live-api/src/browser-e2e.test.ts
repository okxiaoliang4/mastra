/**
 * Browser-based E2E voice conversation test
 *
 * Starts a local HTTP + WebSocket server that:
 *   - Serves an HTML page with mic capture + audio playback
 *   - Bridges browser audio ↔ GeminiLiveVoice in real-time
 *
 * Run:
 *   GOOGLE_API_KEY=... pnpm vitest run browser-e2e.test.ts
 *
 * Then open the URL printed in the console in your browser.
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { join, dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createTool } from '@mastra/core/tools';
import { describe, it, expect, afterAll } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { z } from 'zod';
import { GeminiLiveVoice } from './index';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const hasApiKey = !!GOOGLE_API_KEY;
const testMode = hasApiKey ? describe : describe.skip;
const __dirname = dirname(fileURLToPath(import.meta.url));

testMode('GeminiLiveVoice Browser E2E', () => {
  let server: Server;
  let wss: WebSocketServer;
  const voices: GeminiLiveVoice[] = [];

  afterAll(async () => {
    wss?.close();
    server?.close();
    for (const v of voices) {
      try {
        await v.disconnect();
      } catch {}
    }
  });

  it(
    'should serve the voice conversation page',
    async () => {
      const html = readFileSync(join(__dirname, 'browser-e2e.html'), 'utf-8');

      server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });

      wss = new WebSocketServer({ server });

      wss.on('connection', async ws => {
        console.log('[Server] Browser connected');

        const voice = new GeminiLiveVoice({
          apiKey: GOOGLE_API_KEY,
          model: 'gemini-3.1-flash-live-preview',
          instructions: 'You are a friendly assistant with tools. Keep responses short. ' + 'Spoken chinese.',
          debug: true,
        });

        // Register tools
        voice.addTools({
          getWeather: createTool({
            id: 'getWeather',
            description: 'Get the current weather for a specific location',
            inputSchema: z.object({
              location: z.string().describe('The city or location to get weather for'),
            }),
            execute: async (args: { location: string }) => {
              console.log('[Tool] getWeather called:', args);
              if (ws.readyState === WsWebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'toolCall', name: 'getWeather', args }));
              }
              // Simulated weather data
              const data = {
                location: args.location,
                temperature: Math.round(15 + Math.random() * 20),
                conditions: ['Sunny', 'Cloudy', 'Rainy', 'Partly cloudy'][Math.floor(Math.random() * 4)],
                humidity: Math.round(40 + Math.random() * 40),
              };
              console.log('[Tool] getWeather result:', data);
              return data;
            },
          }),
          calculate: createTool({
            id: 'calculate',
            description: 'Perform a mathematical calculation',
            inputSchema: z.object({
              operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The math operation'),
              a: z.number().describe('First number'),
              b: z.number().describe('Second number'),
            }),
            execute: async (args: { operation: string; a: number; b: number }) => {
              console.log('[Tool] calculate called:', args);
              if (ws.readyState === WsWebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'toolCall', name: 'calculate', args }));
              }
              let result: number;
              switch (args.operation) {
                case 'add':
                  result = args.a + args.b;
                  break;
                case 'subtract':
                  result = args.a - args.b;
                  break;
                case 'multiply':
                  result = args.a * args.b;
                  break;
                case 'divide':
                  result = args.a / args.b;
                  break;
                default:
                  result = 0;
              }
              console.log('[Tool] calculate result:', result);
              return { operation: args.operation, a: args.a, b: args.b, result };
            },
          }),
        });

        voices.push(voice);

        // Audio passthrough: browser mic chunks -> Gemini
        const micStream = new PassThrough();

        // Gemini audio -> browser
        voice.on('speaking', (data: { audioData?: Int16Array }) => {
          if (data.audioData && ws.readyState === WsWebSocket.OPEN) {
            const buf = Buffer.from(data.audioData.buffer, data.audioData.byteOffset, data.audioData.byteLength);
            ws.send(buf);
          }
        });

        voice.on('writing', (data: { text: string; role: string }) => {
          if (ws.readyState === WsWebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'writing', text: data.text, role: data.role }));
          }
        });

        voice.on('turnComplete', () => {
          if (ws.readyState === WsWebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'turnComplete' }));
          }
        });

        // Log tool calls from the model
        voice.on('toolCall', (data: { name: string; args: Record<string, any>; id: string }) => {
          console.log('[Server] toolCall event:', data.name, JSON.stringify(data.args));
          if (ws.readyState === WsWebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'toolCall', name: data.name, args: data.args }));
          }
        });

        voice.on('error', (err: { message?: string }) => {
          console.error('[Server] Voice error:', err);
          if (ws.readyState === WsWebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        });

        try {
          await voice.connect();
          console.log('[Server] Gemini connected');
          await voice.send(micStream);
        } catch (err) {
          console.error('[Server] Failed to connect:', err);
          ws.close();
          return;
        }

        // Browser messages -> Gemini
        ws.on('message', (data: Buffer, isBinary: boolean) => {
          if (isBinary) {
            // Binary = PCM audio from mic
            if (micStream.writable) {
              micStream.write(Buffer.from(data));
            }
          } else {
            // Text JSON = typed message from the text input
            try {
              const msg = JSON.parse(data.toString()) as { type: string; text?: string };
              if (msg.type === 'text' && msg.text) {
                console.log('[Server] Text message from browser:', msg.text);
                voice.speak(msg.text).catch((err: unknown) => {
                  console.error('[Server] speak error:', err);
                });
              }
            } catch {
              // ignore malformed JSON
            }
          }
        });

        ws.on('close', async () => {
          console.log('[Server] Browser disconnected');
          micStream.destroy();
          try {
            await voice.disconnect();
          } catch {}
        });
      });

      // Start on random port
      await new Promise<void>(resolve => {
        server.listen(0, () => resolve());
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3456;
      const url = `http://localhost:${port}`;

      console.log('\n');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log(`║  Open in your browser:  ${url.padEnd(25)}║`);
      console.log('║  Press Start, then speak into your microphone   ║');
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('\n');

      expect(server.listening).toBe(true);

      // Keep the server alive for manual testing
      await new Promise(resolve => setTimeout(resolve, 120_000));
    },
    1000 * 60 * 60,
  );
});

if (!hasApiKey) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Browser E2E test SKIPPED — No API key                       ║
║                                                              ║
║  GOOGLE_API_KEY=... pnpm vitest run browser-e2e.test.ts      ║
╚══════════════════════════════════════════════════════════════╝
`);
}
