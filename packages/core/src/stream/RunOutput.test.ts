import { ReadableStream } from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import { WorkflowRunOutput } from './RunOutput';
import { ChunkFrom } from './types';
import type { WorkflowStreamEvent } from './types';

function createChunkStream(chunks: WorkflowStreamEvent[]): ReadableStream<WorkflowStreamEvent> {
  return new ReadableStream<WorkflowStreamEvent>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe('WorkflowRunOutput', () => {
  it('should clear fullStream replay buffer after dispose', async () => {
    const runId = 'workflow-run';
    const workflowId = 'workflow-id';

    const stream = createChunkStream([
      {
        type: 'workflow-paused',
        runId,
        from: ChunkFrom.WORKFLOW,
        payload: {},
      } as WorkflowStreamEvent,
    ]);

    const output = new WorkflowRunOutput({
      runId,
      workflowId,
      stream,
    });

    const consumed: WorkflowStreamEvent[] = [];
    for await (const chunk of output.fullStream) {
      consumed.push(chunk);
    }

    expect(consumed.length).toBeGreaterThan(0);

    output.dispose();

    const replay: WorkflowStreamEvent[] = [];
    for await (const chunk of output.fullStream) {
      replay.push(chunk);
    }

    expect(replay).toEqual([]);
  });
});
