import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const entry = new URL('../index.mjs', import.meta.url);

test('runner refuses startup without a strong token', async () => {
  const processUnderTest = spawn(process.execPath, [entry.pathname], {
    env: {
      ...process.env,
      RUNNER_TOKEN: '',
      DOCKER_SOCKET_PATH: '/nonexistent/paranod-test.sock'
    }
  });
  let error = '';
  processUnderTest.stderr.on('data', (chunk) => {
    error += chunk;
  });
  const [code] = await once(processUnderTest, 'exit');
  assert.equal(code, 1);
  assert.match(error, /RUNNER_TOKEN must contain at least 32 characters/);
});

test('runner HTTP authentication and resource validation require no Docker access', async (t) => {
  const token = 'test-only-'.repeat(4);
  const processUnderTest = spawn(process.execPath, [entry.pathname], {
    env: {
      ...process.env,
      PORT: '0',
      RUNNER_TOKEN: token,
      DOCKER_SOCKET_PATH: '/nonexistent/paranod-test.sock'
    }
  });
  t.after(async () => {
    processUnderTest.kill();
    await once(processUnderTest, 'exit');
  });
  const base = await new Promise((resolve, reject) => {
    processUnderTest.once('error', reject);
    processUnderTest.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/listening on :(\d+)/);
      if (match) resolve('http://127.0.0.1:' + match[1]);
    });
    processUnderTest.once('exit', (code) => reject(Error('Exited ' + code)));
  });
  assert.equal((await fetch(base + '/healthz')).status, 401);
  const headers = {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  };
  assert.equal((await fetch(base + '/healthz', { headers })).status, 200);
  for (const resources of [
    { memoryBytes: 1 },
    { nanoCpus: 999999999999 },
    { timeoutMs: 3600000 }
  ]) {
    const response = await fetch(base + '/jobs/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: 'python:3.11-slim',
        cmd: ['true'],
        ...resources
      })
    });
    assert.equal(response.status, 400);
  }
});
