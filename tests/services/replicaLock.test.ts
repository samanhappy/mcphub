import { withKeyedLock } from '../../src/services/replicaLock.js';

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('serializes concurrent actions with the same key in FIFO order', async () => {
  const order: string[] = [];
  const first = deferred<void>();
  const second = deferred<void>();
  const run = (label: string, gate: Promise<void>) =>
    withKeyedLock('server-a', async () => {
      order.push(`${label}-start`);
      await gate;
      order.push(`${label}-end`);
    });
  const a = run('a', first.promise);
  const b = run('b', second.promise);
  first.resolve();
  await a;
  second.resolve();
  await b;
  expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
});

test('does not serialize actions with different keys', async () => {
  const gate = deferred<void>();
  const a = withKeyedLock('server-a', async () => gate.promise);
  const b = withKeyedLock('server-b', async () => 'done');
  await expect(b).resolves.toBe('done');
  gate.resolve();
  await expect(a).resolves.toBeUndefined();
});

test('a rejected action does not poison the queue', async () => {
  const run = withKeyedLock('server-a', async () => {
    throw new Error('boom');
  });
  await expect(run).rejects.toThrow('boom');
  const next = withKeyedLock('server-a', async () => 'recovered');
  await expect(next).resolves.toBe('recovered');
});

test('nested acquisition of the same key is reentrant', async () => {
  const outer = withKeyedLock('server-a', async () =>
    withKeyedLock('server-a', async () => 'nested'),
  );
  await expect(outer).resolves.toBe('nested');
});
