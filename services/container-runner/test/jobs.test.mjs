import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// Real runner HTTP plus a disposable Docker API double; never uses a host socket.
test('runner pins images, bounds jobs and stops containers on disconnect', async (t) => {
  const dir = await fs.mkdtemp('/tmp/paranod-runner-');
  const socket = `${dir}/d.sock`;
  const records = [];
  let delayedImage;
  const imageId = `sha256:${'a'.repeat(64)}`;
  const engine = http.createServer(async (req, res) => {
    const route = new URL(req.url, 'http://docker').pathname.replace(
      /^\/v[\d.]+/,
      ''
    );
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const reply = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (route.startsWith('/images/') && route.endsWith('/json')) {
      if (delayedImage) await delayedImage;
      return reply({ Id: imageId });
    }
    if (route === '/containers/create') {
      const record = {
        id: `job${records.length}`,
        spec: JSON.parse(Buffer.concat(chunks).toString()),
        started: false,
        killed: false,
        removed: false
      };
      records.push(record);
      return reply({ Id: record.id, Warnings: [] }, 201);
    }
    const match = route.match(/^\/containers\/(job\d+)(?:\/(.+))?$/);
    const record = records.find((r) => r.id === match?.[1]);
    if (!record) return reply({ message: 'unexpected Docker request' }, 404);
    if (match[2] === 'start') {
      record.started = true;
      return reply({}, 204);
    }
    if (match[2] === 'wait') {
      record.finish = () => reply({ StatusCode: record.killed ? 137 : 0 });
      return;
    }
    if (match[2] === 'kill') {
      record.killed = true;
      record.finish?.();
      return reply({}, 204);
    }
    if (match[2] === 'logs') {
      const text = Buffer.from('[+] Test: https://example.org/test\n');
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(text.length, 4);
      res.end(Buffer.concat([header, text]));
      return;
    }
    if (req.method === 'DELETE') {
      record.removed = true;
      return reply({}, 204);
    }
    reply({ message: 'unexpected Docker operation' }, 404);
  });
  await new Promise((resolve) => engine.listen(socket, resolve));
  const token = 'isolated-runner-token-'.repeat(3);
  const runner = spawn(
    process.execPath,
    [new URL('../index.mjs', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        PORT: '0',
        RUNNER_TOKEN: token,
        DOCKER_SOCKET_PATH: socket,
        RUNNER_INSTANCE: 'isolated-test',
        RUNNER_JOB_NETWORK: 'bridge',
        RUNNER_MAX_CONCURRENT_JOBS: '1',
        RUNNER_ALLOWED_IMAGES: 'sherlock/sherlock:latest'
      }
    }
  );
  runner.stderr.resume();
  t.after(async () => {
    runner.kill();
    await once(runner, 'exit');
    engine.closeAllConnections();
    await new Promise((resolve) => engine.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/listening on :(\d+)/);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    runner.once('exit', (code) => reject(new Error(`Runner exited ${code}`)));
  });
  const submit = (signal, timeoutMs = 10000) =>
    fetch(`${base}/jobs/run`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        image: 'sherlock/sherlock:latest',
        cmd: ['test_user', '--print-found'],
        timeoutMs
      })
    });
  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await delay(20);
    }
    assert.fail('Runner did not reach the expected state');
  }
  await t.test(
    'uses immutable image identity and removes a successful job',
    async () => {
      const pending = submit();
      await until(() => records[0]?.finish);
      records[0].finish();
      const result = await pending;
      assert.equal(result.status, 200);
      assert.equal((await result.json()).exitCode, 0);
      assert.equal(records[0].spec.Image, imageId);
      assert.equal(records[0].spec.Labels['paranod.instance'], 'isolated-test');
      assert.deepEqual(records[0].spec.HostConfig.CapDrop, ['ALL']);
      assert.equal(records[0].spec.HostConfig.NetworkMode, 'bridge');
      assert.equal(records[0].removed, true);
    }
  );
  await t.test(
    'disconnect kills only that running container and rejects concurrent jobs',
    async () => {
      const controller = new AbortController();
      const pending = submit(controller.signal).catch((error) => error);
      await until(() => records[1]?.finish);
      assert.equal((await submit()).status, 429);
      controller.abort();
      await pending;
      await until(() => records[1].removed);
      assert.equal(records[1].killed, true);
      assert.equal(records[0].killed, false);
    }
  );
  await t.test(
    'deadline kills a job and cannot report a successful empty result',
    async () => {
      const result = await submit(undefined, 100);
      assert.equal(result.status, 500);
      assert.equal(records[2].killed, true);
      assert.equal(records[2].removed, true);
    }
  );
  await t.test(
    'disconnect during image resolution cannot start a late container',
    async () => {
      let release;
      delayedImage = new Promise((resolve) => {
        release = resolve;
      });
      const controller = new AbortController();
      const pending = submit(controller.signal).catch((error) => error);
      await delay(50);
      controller.abort();
      await pending;
      await delay(50);
      release();
      delayedImage = undefined;
      await delay(100);
      assert.equal(records.length, 3);
    }
  );
});
