// Construction de l'app Hono (séparée de server.ts pour être testable sans
// démarrer de serveur HTTP).

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { createClassifyRoute, type ClassifyRouteDeps } from './routes/classify';
import { createCompetitionsRoute } from './routes/competitions';
import { createFeedRoute, type FeedRouteDeps } from './routes/feed';
import { TTLCache } from './lib/cache';
import { createRateLimiter } from './lib/rateLimit';
import type { Classification, ClassifyFn } from './lib/classifier';

export type AppDeps = {
  classify: ClassifyFn;
  cache?: ClassifyRouteDeps['cache'];
  rateLimiter?: ClassifyRouteDeps['rateLimiter'];
  rateLimit?: ClassifyRouteDeps['rateLimit'];
  /** RSS injectable (mock en test) — sinon client RSS réel. */
  fetchChannelFeed?: FeedRouteDeps['fetchChannelFeed'];
  feedCache?: FeedRouteDeps['feedCache'];
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  // CORS permissif : reflète l'origine (chrome-extension://…, http://localhost,
  // web app companion) et autorise les requêtes sans origine (curl, RSS).
  // Reflection d'origine OK car aucune credential/cookie — à revoir si de l'auth arrive.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86_400,
    })
  );

  // Logging simple : méthode, path, statut, durée, + cache hits/misses sur classify.
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const { method, path } = c.req;
    let extra = '';
    if (path === '/classify') {
      const hits = c.res.headers.get('X-Cache-Hits');
      const misses = c.res.headers.get('X-Cache-Misses');
      if (hits !== null || misses !== null) {
        extra = ` cache(hits=${hits ?? 0}, misses=${misses ?? 0})`;
      }
    }
    console.log(`${method} ${path} ${c.res.status} ${ms}ms${extra}`);
  });

  app.get('/health', (c) => c.json({ ok: true, uptime: process.uptime() }));

  // Cache de classification + rate limiter PARTAGÉS entre /classify et /feed :
  // une vidéo classée par un flux profite au batch de l'extension, et vice versa.
  const classifyCache = deps.cache ?? new TTLCache<Classification>();
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter(deps.rateLimit ?? { limit: 60, windowMs: 60_000 });

  app.route('/classify', createClassifyRoute({ ...deps, cache: classifyCache, rateLimiter }));
  app.route('/competitions', createCompetitionsRoute());
  app.route(
    '/feed',
    createFeedRoute({
      classify: deps.classify,
      cache: classifyCache,
      rateLimiter,
      fetchChannelFeed: deps.fetchChannelFeed,
      feedCache: deps.feedCache,
    })
  );

  // Landing marketing servie sur /landing. Deux emplacements possibles :
  // - repo complet (dev local) : spoilguard/landing/index.html (source de vérité) ;
  // - conteneur Coolify (Base Directory /backend) : le repo au-dessus n'existe PAS →
  //   repli sur la copie committée backend/public/landing/index.html (synchro via
  //   `npm run sync-landing` à la racine). Cache mémoire 5 min.
  // Enregistré AVANT le static '/*' : Hono compose dans l'ordre, /landing gagne.
  const srcDir = path.dirname(fileURLToPath(import.meta.url));
  const landingCandidates = [
    path.resolve(srcDir, '../../landing/index.html'),
    path.resolve(srcDir, '../public/landing/index.html'),
  ];
  const LANDING_TTL_MS = 5 * 60 * 1000;
  let landingCache: { html: string; expires: number } | null = null;
  app.get('/landing', async (c) => {
    const now = Date.now();
    if (!landingCache || landingCache.expires <= now) {
      let html: string | null = null;
      for (const file of landingCandidates) {
        try {
          html = await readFile(file, 'utf8');
          break;
        } catch {
          /* candidat suivant */
        }
      }
      if (html === null) {
        console.error('[landing] introuvable dans', landingCandidates);
        return c.text('Landing indisponible', 500);
      }
      landingCache = { html, expires: now + LANDING_TTL_MS };
    }
    return c.html(landingCache.html);
  });

  // Companion web app (Phase 3) : servie en statique sur / depuis backend/public/.
  // Enregistré APRÈS les routes API : leurs handlers répondent avant ce middleware
  // (Hono compose les handlers dans l'ordre d'enregistrement).
  //
  // serveStatic (@hono/node-server) résout `root`/`path` relativement au cwd du
  // process. Or le serveur peut être lancé depuis n'importe quel dossier. On calcule
  // donc le chemin ABSOLU de public/ à partir de ce fichier source (import.meta.url),
  // puis on le convertit en chemin RELATIF au cwd réel (ce que serveStatic attend) —
  // ainsi GET / sert le HTML quel que soit le dossier de lancement.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  const publicRoot = path.relative(process.cwd(), publicDir) || '.';
  app.use('/*', serveStatic({ root: publicRoot, index: 'index.html' }));
  // Fallback SPA : tout chemin non résolu retombe sur index.html.
  app.get('*', serveStatic({ path: `${publicRoot}/index.html` }));

  return app;
}
