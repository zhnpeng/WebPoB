const ALLOWED_GET_HOSTS = new Set([
  'pobb.in',
  'www.pobb.in',
  'pastebin.com',
  'www.pastebin.com',
  'poe.ninja',
  'www.poe.ninja',
  'maxroll.gg',
  'www.maxroll.gg',
  'www.pathofexile.com',
  'pathofexile.com',
  'poe.game.qq.com',
]);

const ALLOWED_WEGAME_POE2_ENDPOINTS = new Set([
  '/api/v1/wegame.pallas.poe2.Profile/GetRoleInfo',
  '/api/v1/wegame.pallas.poe2.Profile/GetRoleProfile',
  '/api/v1/wegame.pallas.poe2.Profile/GetTalentTree',
  '/api/v1/wegame.pallas.poe2.Profile/GetEquipments',
  '/api/v1/wegame.pallas.poe2.Profile/GetSkills',
  '/api/v1/wegame.pallas.poe2.Profile/GetJewels',
]);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isAllowedWeGamePost(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === 'www.wegame.com.cn' &&
    ALLOWED_WEGAME_POE2_ENDPOINTS.has(url.pathname)
  );
}

export const onRequest = async (context: {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> => {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(request.url);
  const targetParam = reqUrl.searchParams.get('url');
  if (!targetParam) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetParam);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const edgeCache =
    typeof caches !== 'undefined'
      ? (caches as unknown as { default?: Cache }).default
      : undefined;

  // Dedicated read-only POST allowlist for public WeGame PoE 2 Helper share links
  if (request.method === 'POST') {
    if (!isAllowedWeGamePost(targetUrl)) {
      return new Response(JSON.stringify({ error: `POST target not allowed: ${targetUrl.hostname}${targetUrl.pathname}` }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const rawBody = await request.text();
    if (rawBody.length > 4096) {
      return new Response(JSON.stringify({ error: 'Request body too large' }), {
        status: 413,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const cacheUrl = new URL(reqUrl.origin + reqUrl.pathname);
    cacheUrl.searchParams.set('url', targetUrl.toString());
    cacheUrl.searchParams.set('body', rawBody);
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
    if (edgeCache) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set('X-WebPoB-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers: hitHeaders });
      }
    }

    const upstream = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.wegame.com.cn',
        'Referer': 'https://www.wegame.com.cn/helper/poe2/',
        'User-Agent': 'Mozilla/5.0 (compatible; WebPoB-Proxy/1.0; +https://webpob.pages.dev)',
      },
      body: rawBody,
    });

    const body = await upstream.text();
    const isCacheable = upstream.status === 200 && body.includes('"error_code":0');
    const response = new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
        'Cache-Control': isCacheable
          ? 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600'
          : 'no-store',
        'X-WebPoB-Cache': 'MISS',
      },
    });

    if (isCacheable && edgeCache) {
      const putPromise = edgeCache.put(cacheKey, response.clone()).catch(() => undefined);
      if (context.waitUntil) context.waitUntil(putPromise);
      else await putPromise;
    }

    return response;
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: `Method not allowed: ${request.method}` }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_GET_HOSTS.has(targetUrl.hostname)) {
    return new Response(JSON.stringify({ error: `Host not allowed: ${targetUrl.hostname}` }), {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Check Cloudflare Edge Cache first so popular share links return in <50ms without hitting upstream
  const cacheKey = new Request(reqUrl.toString(), { method: 'GET' });
  if (edgeCache) {
    const cached = await edgeCache.match(cacheKey);
    if (cached) {
      const hitHeaders = new Headers(cached.headers);
      hitHeaders.set('X-WebPoB-Cache', 'HIT');
      return new Response(cached.body, { status: cached.status, headers: hitHeaders });
    }
  }

  const upstream = await fetch(targetUrl.toString(), {
    headers: {
      'User-Agent': 'WebPoB-Proxy/1.0 (+https://webpob.pages.dev)',
    },
    // Cloudflare-specific upstream caching hint (ignored outside Workers runtime)
    ...({ cf: { cacheTtl: 3600, cacheEverything: true } } as Record<string, unknown>),
  });

  const body = await upstream.text();
  const isCacheable = upstream.status === 200 && body.length > 0;
  const response = new Response(body, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': upstream.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
      'Cache-Control': isCacheable
        ? 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400'
        : 'no-store',
      'X-WebPoB-Cache': 'MISS',
    },
  });

  if (isCacheable && edgeCache) {
    const putPromise = edgeCache.put(cacheKey, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(putPromise);
    else await putPromise;
  }

  return response;
};
