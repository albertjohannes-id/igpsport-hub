import { secureResponse } from './security';

async function route(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json(
      { error: 'Cloud account operations are not enabled.' },
      { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } },
    );
  }
  if (path === '/api/status') {
    return Response.json(
      {
        mode: 'cloud-preview',
        capabilities: { login: false, transfer: false },
        sessions: {
          igpsport: { state: 'unavailable', message: 'Cloud integration is not connected yet.' },
          garmin: { state: 'unavailable', message: 'Cloud integration is not connected yet.' },
        },
        history: [],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (path.startsWith('/api/')) {
    return Response.json(
      {
        error:
          'This preview has no connected activity service. Use the local app to connect accounts.',
        code: 'NOT_CONFIGURED',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    return secureResponse(await route(request, env), request);
  },
} satisfies ExportedHandler<Env>;
