// Reel Gen Cloudflare Worker — authenticated application routes are not enabled until server-side auth is configured.
// This deployment is deliberately read-only while R2 activation and Next.js migration are pending.
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/health') {
      return new Response(JSON.stringify({error:'Not found'}),{status:404,headers});
    }
    try {
      const row = await env.DB.prepare('SELECT version FROM schema_migrations ORDER BY applied_at DESC LIMIT 1').first();
      return new Response(JSON.stringify({
        ok: Boolean(row),
        service: 'reel-gen-api',
        schemaVersion: row?.version ?? null,
        mediaStorageEnabled: Boolean(env.MEDIA_BUCKET)
      }),{status:row?200:503,headers});
    } catch {
      return new Response(JSON.stringify({ok:false,error:'Database unavailable'}),{status:503,headers});
    }
  }
};
