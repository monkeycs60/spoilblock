import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app';
import { TTLCache } from '../src/lib/cache';
import { createRateLimiter } from '../src/lib/rateLimit';
import { fallbackResult, type Classification, type ClassifyFn } from '../src/lib/classifier';

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request('/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /classify — validation', () => {
  const app = createApp({ classify: async () => [] });

  it('400 si videos manquant', async () => {
    const res = await post(app, { competitions: ['tdf-2026'] });
    expect(res.status).toBe(400);
  });

  it('400 si batch > 30', async () => {
    const videos = Array.from({ length: 31 }, (_, i) => ({ videoId: `v${i}`, title: 't' }));
    const res = await post(app, { competitions: ['tdf-2026'], videos });
    expect(res.status).toBe(400);
  });

  it('400 si videoId trop long (> 20)', async () => {
    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'x'.repeat(21), title: 't' }],
    });
    expect(res.status).toBe(400);
  });

  it('400 si JSON invalide', async () => {
    const res = await app.request('/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /classify — cache', () => {
  it('sert un cache hit sans rappeler le LLM', async () => {
    const classify = vi.fn<ClassifyFn>(async (_c, videos) =>
      videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null }))
    );
    const cache = new TTLCache<Classification>();
    const app = createApp({ classify, cache });

    const body = { competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: 'Étape 3' }] };

    const res1 = await post(app, body);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-Cache-Misses')).toBe('1');
    expect(classify).toHaveBeenCalledTimes(1);

    const res2 = await post(app, body);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Cache-Hits')).toBe('1');
    expect(res2.headers.get('X-Cache-Misses')).toBe('0');
    // Toujours 1 appel : le 2e a été servi par le cache.
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('ne partage PAS le cache entre compétitions différentes (anti-contamination C1)', async () => {
    const classify = vi.fn<ClassifyFn>(async (_c, videos) =>
      videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null }))
    );
    const cache = new TTLCache<Classification>();
    const app = createApp({ classify, cache });

    const videos = [{ videoId: 'v1', title: 'Étape 3' }];
    // 1er appel : compétitions [tdf-2026] → miss → 1 appel LLM.
    const r1 = await post(app, { competitions: ['tdf-2026'], videos });
    expect(r1.headers.get('X-Cache-Misses')).toBe('1');
    expect(classify).toHaveBeenCalledTimes(1);

    // Même videoId mais compétitions DIFFÉRENTES → clé de cache distincte → 2e appel LLM.
    const r2 = await post(app, { competitions: ['wimbledon-2026'], videos });
    expect(r2.headers.get('X-Cache-Misses')).toBe('1');
    expect(classify).toHaveBeenCalledTimes(2);

    // Re-jouer la 1re compétition sert bien le cache (clé scopée réutilisée).
    const r3 = await post(app, { competitions: ['tdf-2026'], videos });
    expect(r3.headers.get('X-Cache-Hits')).toBe('1');
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it('ne met PAS en cache un résultat de fallback (LLM indisponible)', async () => {
    const classify = vi.fn<ClassifyFn>(async (_c, videos) => videos.map(fallbackResult));
    const cache = new TTLCache<Classification>();
    const app = createApp({ classify, cache });

    const body = { competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: 'Étape 3' }] };

    const res1 = await post(app, body);
    expect(res1.status).toBe(200);
    expect(classify).toHaveBeenCalledTimes(1);

    // Le fallback ne doit pas empoisonner le cache : le 2e appel repasse par le LLM.
    const res2 = await post(app, body);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-Cache-Misses')).toBe('1');
    expect(classify).toHaveBeenCalledTimes(2);
  });
});

describe('POST /classify — fallback + safeTitle générique', () => {
  it('remplace un safeTitle null par un titre générique quand spoiler=true', async () => {
    // classify simule un échec LLM → fallback voilé (safeTitle null).
    const classify: ClassifyFn = async (_c, videos) => videos.map(fallbackResult);
    const app = createApp({ classify });

    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'v1', title: 'Étape mystère' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results[0].spoiler).toBe(true);
    expect(body.results[0].safeTitle).toBe('🚴 Tour de France – contenu récent');
  });

  it('renvoie safeTitle null quand spoiler=false', async () => {
    const classify: ClassifyFn = async (_c, videos) =>
      videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null }));
    const app = createApp({ classify });
    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'v1', title: 'Recette de crêpes' }],
    });
    const body = await res.json() as any;
    // publishedAt:null quand aucun index n'est branché (best-effort).
    expect(body.results[0]).toEqual({ videoId: 'v1', spoiler: false, safeTitle: null, publishedAt: null });
  });
});

describe('POST /classify — publishedAt (index RSS)', () => {
  const classify: ClassifyFn = async (_c, videos) =>
    videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null }));

  it('renvoie publishedAt quand l\'index connaît la vidéo, null sinon', async () => {
    const publishedIndex = {
      lookup: async (ids: string[]) => {
        const map = new Map<string, string>();
        if (ids.includes('known')) map.set('known', '2026-07-05T18:00:00Z');
        return map;
      },
    };
    const app = createApp({ classify, publishedIndex });

    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'known', title: 't1' }, { videoId: 'unknown', title: 't2' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const byId = Object.fromEntries(body.results.map((r: any) => [r.videoId, r.publishedAt]));
    expect(byId.known).toBe('2026-07-05T18:00:00Z');
    expect(byId.unknown).toBeNull();
  });

  it('publishedAt:null partout si l\'index échoue (best-effort strict, /classify ne casse pas)', async () => {
    const publishedIndex = {
      lookup: async () => {
        throw new Error('rss boom');
      },
    };
    const app = createApp({ classify, publishedIndex });

    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'v1', title: 't1' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results[0].publishedAt).toBeNull();
  });

  it('publishedAt TOUJOURS recalculé à la réponse, jamais servi depuis le cache', async () => {
    // 1er appel : index vide. 2e appel (servi par le cache de classification) :
    // l'index connaît la vidéo → publishedAt doit apparaître malgré le cache hit.
    let known = false;
    const publishedIndex = {
      lookup: async (ids: string[]) => {
        const map = new Map<string, string>();
        if (known && ids.includes('v1')) map.set('v1', '2026-07-05T20:00:00Z');
        return map;
      },
    };
    const cache = new TTLCache<Classification>();
    const app = createApp({ classify, cache, publishedIndex });
    const body = { competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: 't' }] };

    const r1 = await post(app, body);
    expect(((await r1.json()) as any).results[0].publishedAt).toBeNull();

    known = true;
    const r2 = await post(app, body);
    // Cache hit sur la classification, mais publishedAt frais.
    expect(r2.headers.get('X-Cache-Hits')).toBe('1');
    expect(((await r2.json()) as any).results[0].publishedAt).toBe('2026-07-05T20:00:00Z');
  });
});

describe('POST /classify — rate limit', () => {
  it('429 au-delà du quota', async () => {
    const app = createApp({
      classify: async (_c, videos) =>
        videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null })),
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });
    const body = { competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: 't' }] };

    expect((await post(app, body)).status).toBe(200);
    expect((await post(app, body)).status).toBe(200);
    expect((await post(app, body)).status).toBe(429);
  });

  it('clé = DERNIÈRE entrée du X-Forwarded-For (anti-spoof)', async () => {
    // Traefik (proxy de confiance) APPEND la vraie IP en fin de liste. Un client
    // qui forge un 1er élément différent partage quand même le quota s'il a la
    // même dernière IP.
    const app = createApp({
      classify: async (_c, videos) =>
        videos.map((v) => ({ videoId: v.videoId, spoiler: false, safeTitle: null })),
      rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    const body = { competitions: ['tdf-2026'], videos: [{ videoId: 'v1', title: 't' }] };

    const send = (xff: string) =>
      app.request('/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
        body: JSON.stringify(body),
      });

    // Premiers éléments différents, même dernière IP réelle → quota partagé.
    expect((await send('1.1.1.1, 203.0.113.9')).status).toBe(200);
    expect((await send('2.2.2.2, 203.0.113.9')).status).toBe(429);
  });
});

describe('POST /classify — clamp safeTitle', () => {
  it('tronque un safeTitle géant renvoyé par le LLM à 300 caractères', async () => {
    const huge = 'A'.repeat(10_000);
    const classify: ClassifyFn = async (_c, videos) =>
      videos.map((v) => ({ videoId: v.videoId, spoiler: true, safeTitle: huge }));
    const app = createApp({ classify });

    const res = await post(app, {
      competitions: ['tdf-2026'],
      videos: [{ videoId: 'v1', title: 'Étape 3' }],
    });
    const body = (await res.json()) as any;
    expect(body.results[0].spoiler).toBe(true);
    expect(body.results[0].safeTitle.length).toBeLessThanOrEqual(300);
  });
});
