import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerErrorHandler } from '../../../platform/errors.js';
import { ownerOnly } from './guard.js';

async function callAs(role: 'owner' | 'operator', message: string) {
  const app = Fastify();
  registerErrorHandler(app);
  app.addHook('onRequest', async (request) => {
    request.workspace = { workspaceId: 'w', role, activeSince: new Date(0) };
  });
  app.get('/x', { preHandler: ownerOnly(message) }, () => ({ ok: true }));
  return app.inject('/x');
}

describe('ownerOnly(message)', () => {
  it('lets an owner through', async () => {
    expect((await callAs('owner', 'Only business owners manage the bot')).statusCode).toBe(200);
  });

  it.each(['Only business owners manage the bot', 'Only business owners manage the team'])(
    'refuses an operator with OWNER_ONLY and the route family message "%s"',
    async (message) => {
      const res = await callAs('operator', message);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: { code: 'OWNER_ONLY', message } });
    },
  );
});
