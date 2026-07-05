// Index videoId → publishedAt (ISO 8601), alimenté par les flux RSS des chaînes
// mappées de TOUTES les compétitions ACTIVES.
//
// Objectif : permettre à /classify de renvoyer la date de publication d'une vidéo
// SANS que l'extension ait à la fournir (elle ne la connaît pas toujours) et sans
// la stocker dans le cache de classification (elle doit rester fraîche et ne pas
// invalider les verdicts en cache).
//
// Le gros du travail est fait par le cache 10 min du RssClient (./rss) : le refresh
// paresseux ci-dessous ne déclenche au plus qu'un balayage des chaînes toutes les
// 10 min, et chaque `fetchChannelFeed` retombe sur le cache RSS s'il est chaud.
//
// BEST-EFFORT STRICT : `lookup` ne rejette JAMAIS. Un échec RSS => l'index n'est
// pas alimenté => la vidéo est simplement absente de la Map renvoyée (publishedAt
// inconnu côté appelant), jamais une exception qui casserait /classify.

import { COMPETITIONS } from '../data/competitions';
import { resolveChannelId, type RssClient } from './rss';

export type PublishedIndex = {
  /**
   * Renvoie une Map videoId → publishedAt (ISO) pour les videoIds connus des
   * chaînes RSS mappées. Un videoId inconnu est simplement absent de la Map.
   * Déclenche un refresh paresseux (au plus toutes les `refreshIntervalMs`) ;
   * ne fait AUCUN fetch si `videoIds` est vide. Ne rejette jamais.
   */
  lookup(videoIds: string[]): Promise<Map<string, string>>;
};

export type PublishedIndexOptions = {
  /** Client RSS partagé (mêmes flux/cache que /feed en prod). */
  rssClient: RssClient;
  /** Intervalle minimal entre deux refresh de l'index (défaut 10 min). */
  refreshIntervalMs?: number;
};

const DEFAULT_REFRESH_MS = 10 * 60 * 1000; // 10 min

/**
 * channelIds (dédupliqués) des chaînes mappées de toutes les compétitions ACTIVES.
 * Les noms de chaîne non présents dans CHANNEL_ID_MAP (resolveChannelId) sont ignorés.
 */
function activeChannelIds(): string[] {
  return [
    ...new Set(
      COMPETITIONS.filter((c) => c.active)
        .flatMap((c) => c.channels)
        .map((name) => resolveChannelId(name))
        .filter((id): id is string => id !== undefined)
    ),
  ];
}

export function createPublishedIndex(options: PublishedIndexOptions): PublishedIndex {
  const { rssClient } = options;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_MS;

  // Index cumulatif videoId → publishedAt. On n'évince pas : il est borné de fait
  // par le nombre d'entrées servies par les flux RSS (quelques centaines).
  const index = new Map<string, string>();
  let lastRefresh = 0;
  // Déduplique les refresh concurrents : plusieurs lookups simultanés partagent
  // un seul balayage des chaînes.
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const ids = activeChannelIds();
    // fetchChannelFeed ne rejette jamais (retourne [] en cas d'échec réseau).
    const feeds = await Promise.all(ids.map((id) => rssClient.fetchChannelFeed(id)));
    for (const entries of feeds) {
      for (const e of entries) {
        if (e.publishedAt) index.set(e.videoId, e.publishedAt);
      }
    }
    lastRefresh = Date.now();
  }

  return {
    async lookup(videoIds: string[]): Promise<Map<string, string>> {
      // Pas de fetch si rien à résoudre (refresh paresseux).
      if (videoIds.length === 0) return new Map();

      // Refresh au plus toutes les refreshIntervalMs.
      if (Date.now() - lastRefresh >= refreshIntervalMs) {
        if (!inFlight) {
          inFlight = refresh()
            .catch((err) => {
              // Best-effort strict : un échec ne remonte jamais à l'appelant.
              console.error('[publishedIndex] refresh échoué:', err);
            })
            .finally(() => {
              inFlight = null;
            });
        }
        await inFlight;
      }

      const out = new Map<string, string>();
      for (const id of videoIds) {
        const iso = index.get(id);
        if (iso) out.set(id, iso);
      }
      return out;
    },
  };
}
