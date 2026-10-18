import { createServer as createHttpServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createServer as createViteServer,
  loadConfigFromFile,
  type ProxyOptions,
  type ViteDevServer,
} from 'vite';
import { afterEach, expect, it } from 'vitest';

// The dev server proxies `/api` to the API. The inbox live socket is a WebSocket upgrade on
// `/api/workspaces/:id/inbox/live`, so the proxy must forward upgrades too (shared-inbox fix
// 2026-10-18-dev-proxy-websocket).

let api: Server | undefined;
let vite: ViteDevServer | undefined;

afterEach(async () => {
  await vite?.close();
  await new Promise((done) => (api ? api.close(done) : done(undefined)));
});

async function apiProxyOptions(): Promise<ProxyOptions> {
  const configFile = fileURLToPath(new URL('../../vite.config.ts', `file://${__filename}`));
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile);
  const proxy = loaded?.config.server?.proxy?.['/api'];
  if (proxy === undefined) throw new Error('no /api proxy in vite.config.ts');
  return typeof proxy === 'string' ? { target: proxy } : proxy;
}

it('forwards the live socket upgrade on /api to the API', async () => {
  const upgrades: string[] = [];
  api = createHttpServer();
  api.on('upgrade', (req, socket) => {
    upgrades.push(req.url ?? '');
    socket.destroy();
  });
  await new Promise<void>((done) => api!.listen(0, '127.0.0.1', done));
  const target = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  vite = await createViteServer({
    configFile: false,
    logLevel: 'silent',
    server: {
      port: 0,
      host: '127.0.0.1',
      proxy: { '/api': { ...(await apiProxyOptions()), target } },
    },
  });
  await vite.listen();
  const port = (vite.httpServer!.address() as AddressInfo).port;

  const path = '/api/workspaces/w1/inbox/live';
  await new Promise<void>((done) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (_res, socket) => (socket.destroy(), done()));
    req.on('response', () => done());
    req.on('error', () => done());
    req.on('close', () => done());
    req.setTimeout(3000, () => (req.destroy(), done()));
    req.end();
  });

  expect(upgrades).toEqual([path]);
});
