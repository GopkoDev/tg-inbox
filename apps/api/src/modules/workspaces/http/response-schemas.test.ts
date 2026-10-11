import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { InvitationPreview, Me, WorkspaceSummary, WorkspaceSummaryPage } from '@tg/shared';
import { registerWorkspaces } from './routes.js';

/** Pins the `response` schema of the five self-service routes: it is what strips unknown fields. */
describe('workspaces response schemas', () => {
  it('registers the shared 200 response schema on each self-service route', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const captured = new Map<string, unknown>();
    app.addHook('onRoute', (route) => {
      const response = (route.schema as { response?: Record<number, unknown> } | undefined)
        ?.response;
      captured.set(`${String(route.method)} ${route.url}`, response?.[200]);
    });
    const noop = async () => undefined;
    await registerWorkspaces(app, {
      access: {} as never,
      team: {} as never,
      authenticate: noop,
      invitationRoutes: {} as never,
    });

    expect(captured.get('GET /me')).toBe(Me);
    expect(captured.get('GET /me/workspaces')).toBe(WorkspaceSummaryPage);
    expect(captured.get('POST /workspaces/:workspaceId/enter')).toBe(WorkspaceSummary);
    expect(captured.get('POST /invitations/lookup')).toBe(InvitationPreview);
    expect(captured.get('POST /invitations/accept')).toBe(WorkspaceSummary);
    await app.close();
  });
});
