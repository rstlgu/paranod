import { describe, expect, it } from 'vitest';
import { createSerialSaveQueue } from './serial-save-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('confirmed save queue', () => {
  it('starts one write at a time and preserves invocation order', async () => {
    const queue = createSerialSaveQueue();
    const gate = deferred();
    const calls: string[] = [];
    const first = queue.enqueue(async () => {
      calls.push('first');
      await gate.promise;
      return 'confirmed';
    });
    const second = queue.enqueue(async () => {
      calls.push('second');
      return true;
    });
    await Promise.resolve();
    expect(calls).toEqual(['first']);
    expect(queue.pending).toBe(2);
    gate.resolve();
    expect(await first).toBe('confirmed');
    expect(await second).toBe(true);
    await queue.idle();
    expect(calls).toEqual(['first', 'second']);
    expect(queue.pending).toBe(0);
  });

  it('reports a rejected write without poisoning later saves', async () => {
    const queue = createSerialSaveQueue();
    const failed = queue.enqueue(async () => {
      throw new Error('offline');
    });
    const next = queue.enqueue(async () => 'saved');
    await expect(failed).rejects.toThrow('offline');
    await expect(next).resolves.toBe('saved');
    await queue.idle();
    expect(queue.pending).toBe(0);
  });

  it('idle includes writes appended while an earlier write is pending', async () => {
    const queue = createSerialSaveQueue();
    const firstGate = deferred();
    const secondGate = deferred();
    let idle = false;
    void queue.enqueue(() => firstGate.promise);
    const waiting = queue.idle().then(() => {
      idle = true;
    });
    void queue.enqueue(() => secondGate.promise);
    firstGate.resolve();
    await firstGate.promise;
    await Promise.resolve();
    expect(idle).toBe(false);
    secondGate.resolve();
    await waiting;
    expect(idle).toBe(true);
    expect(queue.pending).toBe(0);
  });
});
