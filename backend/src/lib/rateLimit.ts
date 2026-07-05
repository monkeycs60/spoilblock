// Rate limiter in-memory à fenêtre glissante, par clé (IP).
// Suffisant pour une seule instance ; à remplacer par un store partagé si scale.
//
// Bornage mémoire (la Map ne doit pas croître indéfiniment) :
// - à chaque accès, une clé dont tous les timestamps sont périmés est supprimée ;
// - sweep périodique léger (1 appel sur 100) qui purge les clés stale ;
// - cap dur maxKeys (défaut 10 000) avec éviction FIFO de la plus ancienne clé.

export type RateLimiterOptions = {
  /** Nombre de requêtes autorisées par fenêtre (défaut 60). */
  limit?: number;
  /** Taille de la fenêtre en ms (défaut 60 000 = 1 min). */
  windowMs?: number;
  /** Nombre max de clés suivies avant éviction FIFO (défaut 10 000). */
  maxKeys?: number;
};

export type RateLimiter = {
  /** true si la requête est autorisée (et comptée), false si quota dépassé. */
  check: (key: string) => boolean;
  reset: () => void;
  /** Nombre de clés actuellement suivies (observabilité / bornage mémoire). */
  size: () => number;
};

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const hits = new Map<string, number[]>();
  let callCount = 0;

  // Purge toute clé dont plus aucun timestamp n'est dans la fenêtre courante.
  function sweep(now: number): void {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(key);
    }
  }

  return {
    check(key: string): boolean {
      const now = Date.now();

      // Sweep périodique léger : 1 appel sur 100.
      callCount += 1;
      if (callCount % 100 === 0) sweep(now);

      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

      // Plus aucun timestamp récent : on ne laisse pas traîner une clé morte.
      if (recent.length === 0) hits.delete(key);

      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }

      // Cap dur : avant d'ajouter une NOUVELLE clé au-delà du cap, on évince la
      // plus ancienne (la Map conserve l'ordre d'insertion → FIFO).
      if (!hits.has(key) && hits.size >= maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }

      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset() {
      hits.clear();
      callCount = 0;
    },
    size() {
      return hits.size;
    },
  };
}
