import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../src/lib/rateLimit';

afterEach(() => {
  vi.useRealTimers();
});

describe('createRateLimiter', () => {
  it('autorise jusqu\'au quota puis bloque', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(rl.check('ip')).toBe(true);
    expect(rl.check('ip')).toBe(true);
    expect(rl.check('ip')).toBe(false);
  });

  it('recharge le quota une fois la fenêtre écoulée', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check('ip')).toBe(true);
    expect(rl.check('ip')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rl.check('ip')).toBe(true);
  });

  it('borne le nombre de clés via un cap FIFO (maxKeys)', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2 });
    rl.check('a');
    rl.check('b');
    expect(rl.size()).toBe(2);
    rl.check('c'); // nouvelle clé au-delà du cap → évince la plus ancienne ('a')
    expect(rl.size()).toBe(2);
  });

  it('purge les clés stale lors du sweep périodique (1/100)', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter({ limit: 100, windowMs: 1000 });

    rl.check('stale'); // appel #1
    vi.advanceTimersByTime(2000); // 'stale' sort de la fenêtre

    // Appels #2..#99 sur une clé active : pas encore de sweep.
    for (let i = 0; i < 98; i += 1) rl.check('active');
    expect(rl.size()).toBe(2); // 'stale' encore présente

    rl.check('active'); // appel #100 → déclenche le sweep, purge 'stale'
    expect(rl.size()).toBe(1);
  });

  it('reset vide toutes les clés', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    rl.check('a');
    rl.check('b');
    expect(rl.size()).toBe(2);
    rl.reset();
    expect(rl.size()).toBe(0);
  });
});
