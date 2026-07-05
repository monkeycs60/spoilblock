import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPublishedIndex } from '../src/lib/publishedIndex';
import type { RssEntry, RssClient } from '../src/lib/rss';

afterEach(() => {
  vi.useRealTimers();
});

function entry(videoId: string, publishedAt: string): RssEntry {
  return { videoId, title: `t-${videoId}`, publishedAt, channel: 'Eurosport France' };
}

/** RssClient mocké : chaque chaîne renvoie le même jeu d'entrées. */
function makeRss(entries: RssEntry[]) {
  const fetchChannelFeed = vi.fn(async (_channelId: string) => entries);
  const client: RssClient = { fetchChannelFeed };
  return { client, fetchChannelFeed };
}

describe('createPublishedIndex', () => {
  it('résout publishedAt pour une vidéo connue, absente pour une inconnue', async () => {
    const { client } = makeRss([entry('AAA', '2026-07-05T10:00:00Z')]);
    const index = createPublishedIndex({ rssClient: client });

    const map = await index.lookup(['AAA', 'ZZZ']);
    expect(map.get('AAA')).toBe('2026-07-05T10:00:00Z');
    expect(map.has('ZZZ')).toBe(false);
  });

  it('ne fait AUCUN fetch si lookup([]) (refresh paresseux)', async () => {
    const { client, fetchChannelFeed } = makeRss([entry('AAA', '2026-07-05T10:00:00Z')]);
    const index = createPublishedIndex({ rssClient: client });

    const map = await index.lookup([]);
    expect(map.size).toBe(0);
    expect(fetchChannelFeed).not.toHaveBeenCalled();
  });

  it('ne rafraîchit qu\'une fois par fenêtre de 10 min', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T10:00:00Z'));
    const { client, fetchChannelFeed } = makeRss([entry('AAA', '2026-07-05T10:00:00Z')]);
    const index = createPublishedIndex({ rssClient: client });

    await index.lookup(['AAA']);
    const perRefresh = fetchChannelFeed.mock.calls.length;
    expect(perRefresh).toBeGreaterThan(0);

    // 2e lookup à +5 min : dans la fenêtre → aucun refetch.
    vi.advanceTimersByTime(5 * 60 * 1000);
    await index.lookup(['AAA']);
    expect(fetchChannelFeed.mock.calls.length).toBe(perRefresh);

    // 3e lookup au-delà de 10 min cumulées → un nouveau balayage.
    vi.advanceTimersByTime(6 * 60 * 1000);
    await index.lookup(['AAA']);
    expect(fetchChannelFeed.mock.calls.length).toBe(perRefresh * 2);
  });

  it('déduplique les refresh concurrents (un seul balayage partagé)', async () => {
    const { client, fetchChannelFeed } = makeRss([entry('AAA', '2026-07-05T10:00:00Z')]);
    const index = createPublishedIndex({ rssClient: client });

    const [m1, m2] = await Promise.all([index.lookup(['AAA']), index.lookup(['AAA'])]);
    expect(m1.get('AAA')).toBe('2026-07-05T10:00:00Z');
    expect(m2.get('AAA')).toBe('2026-07-05T10:00:00Z');
    // Chaque chaîne n'a été fetchée qu'une fois : les 2 lookups ont partagé le refresh.
    const uniqueChannels = new Set(fetchChannelFeed.mock.calls.map((c) => c[0]));
    expect(fetchChannelFeed.mock.calls.length).toBe(uniqueChannels.size);
  });

  it('échoue en silence : lookup ne rejette jamais si le RSS plante', async () => {
    const fetchChannelFeed = vi.fn(async () => {
      throw new Error('rss down');
    });
    const index = createPublishedIndex({ rssClient: { fetchChannelFeed } });

    // Ne doit PAS rejeter ; l'index reste simplement vide.
    const map = await index.lookup(['AAA']);
    expect(map.size).toBe(0);
  });
});
