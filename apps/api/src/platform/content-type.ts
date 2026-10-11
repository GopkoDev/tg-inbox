import type { FastifyInstance } from 'fastify';
import { ErrorCode } from '@tg/shared';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF row of the SAD: mutating `/api` routes accept only `application/json` bodies. A request
 * with no content-type (body-less POST from the panel's fetch client) passes; a body with no content-type is refused. Runs on `onRequest`,
 * i.e. before Fastify parses the body or the handler runs.
 */
export function requireJsonBodies(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '';
    if (path !== '/api' && !path.startsWith('/api/')) return;
    const type = request.headers['content-type'];
    if (type === undefined) {
      const length = Number(request.headers['content-length'] ?? 0);
      const hasBody = length > 0 || request.headers['transfer-encoding'] !== undefined;
      if (!hasBody) return;
    } else if (type.split(';')[0]?.trim().toLowerCase() === 'application/json') {
      return;
    }
    return reply.status(415).send({
      error: {
        code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        message: 'Only application/json request bodies are accepted',
      },
    });
  });
}
