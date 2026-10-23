import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAttentionCount } from './api';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('getAttentionCount', () => {
  it('reads the workspace attention route as a background request and parses the answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WS, count: 3 }), { status: 200 }),
    );
    await expect(getAttentionCount(WS)).resolves.toEqual({ workspace_id: WS, count: 3 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/workspaces/${WS}/inbox/attention`);
    expect(new Headers(init.headers).get('x-background-request')).toBe('1');
  });

  it('rejects an answer that fails the shared schema', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ workspace_id: WS, count: -1 }), { status: 200 }),
    );
    await expect(getAttentionCount(WS)).rejects.toThrow();
  });
});
