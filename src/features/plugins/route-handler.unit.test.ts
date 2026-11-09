import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  setting: vi.fn(),
  graph: vi.fn()
}));
vi.mock('@/lib/auth-utils', () => ({ getActiveWorkspaceAccess: mocks.access }));
vi.mock('@/lib/db', () => ({
  db: { workspacePluginSetting: { findUnique: mocks.setting } }
}));
vi.mock('@/features/graph/server/manual-transform-guard', () => ({
  manualTransformGraphError: mocks.graph
}));
import { withTransformGate, withStreamingTransformGate } from './route-handler';
const request = (
  body = JSON.stringify({ graphId: 'graph', transformId: 'dns-a' })
) =>
  new NextRequest('http://localhost/api/transforms/dns', {
    method: 'POST',
    body
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    workspaceId: 'workspace',
    userId: 'member'
  });
  mocks.setting.mockResolvedValue({ enabled: true });
  mocks.graph.mockResolvedValue(null);
});
describe('transform route authorization and response handling', () => {
  it('requires an authenticated workspace member before execution', async () => {
    mocks.access.mockResolvedValue(null);
    const run = vi.fn();
    expect((await withTransformGate('dns-lookup', request(), run)).status).toBe(
      401
    );
    expect(run).not.toHaveBeenCalled();
    expect(mocks.setting).not.toHaveBeenCalled();
  });
  it('preserves a graph access or active-agent denial before execution', async () => {
    mocks.graph.mockResolvedValue(
      NextResponse.json({ error: 'graph_locked' }, { status: 409 })
    );
    const run = vi.fn();
    expect((await withTransformGate('dns-lookup', request(), run)).status).toBe(
      409
    );
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects disabled plugins for both JSON and streaming callers', async () => {
    mocks.setting.mockResolvedValue({ enabled: false });
    const run = vi.fn();
    expect((await withTransformGate('dns-lookup', request(), run)).status).toBe(
      403
    );
    expect(
      (await withStreamingTransformGate('dns-lookup', request(), run)).status
    ).toBe(403);
    expect(run).not.toHaveBeenCalled();
    expect(mocks.setting).toHaveBeenCalledWith({
      where: {
        workspaceId_pluginId: {
          workspaceId: 'workspace',
          pluginId: 'dns-lookup'
        }
      },
      select: { enabled: true }
    });
  });
  it('rejects oversized and invalid JSON bodies without dispatch', async () => {
    const run = vi.fn();
    expect(
      (
        await withTransformGate(
          'dns-lookup',
          request('x'.repeat(2 * 1024 * 1024)),
          run
        )
      ).status
    ).toBe(413);
    expect(
      (await withTransformGate('dns-lookup', request('{'), run)).status
    ).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('preserves the handler response after successful authorization', async () => {
    const response = NextResponse.json({ success: true });
    const run = vi.fn(async () => response);
    expect(await withTransformGate('dns-lookup', request(), run)).toBe(
      response
    );
    expect(run).toHaveBeenCalledOnce();
  });
  it('streams progress and one terminal result even after an execution error', async () => {
    const response = await withStreamingTransformGate(
      'dns-lookup',
      request(),
      async (progress) => {
        progress({ message: 'Resolving', progress: 20 });
        throw new Error('DNS unavailable');
      }
    );
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson'
    );
    expect(
      (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
      { type: 'progress', message: 'Resolving', progress: 20 },
      {
        type: 'result',
        response: { success: false, error: 'DNS unavailable', status: 'failed' }
      }
    ]);
  });
});
