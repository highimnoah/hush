/**
 * Deterministic pseudo-waveform used as a placeholder while real peak data is
 * being computed. Seeded by the track id so it stays stable between renders.
 */
export function fallbackPeaks(seed: string, count = 160): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const random = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return ((hash >>> 0) % 100000) / 100000;
  };

  const peaks: number[] = [];
  let smooth = 0.45;
  for (let i = 0; i < count; i += 1) {
    const noise = random();
    smooth = smooth * 0.6 + noise * 0.4;
    const envelope =
      0.3 + 0.7 * Math.sin((i / Math.max(1, count - 1)) * Math.PI);
    peaks.push(Math.min(1, Math.max(0.06, smooth * envelope)));
  }
  return peaks;
}
