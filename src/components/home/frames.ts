/**
 * QA only (`?qa_frames=1`, development): records frame deltas while a moment plays and logs the
 * p95 and the worst, so a sequence can be held to 60 fps (spec §11: p95 ≤ 20 ms, worst ≤ 50 ms).
 * Results also land on `window.__homeFrames` for the browser pane's JS tool to read.
 */

export interface FrameStats {
  label: string;
  frames: number;
  p95: number;
  worst: number;
  /** When the worst frame ended, in ms from the start of the watch. */
  worstAt: number;
  mean: number;
}

declare global {
  interface Window {
    __homeFrames?: FrameStats[];
  }
}

/** Starts watching; the returned stop logs the stats, or with `keep = false` just stops (a cancelled run). */
export function watchFrames(label: string): (keep?: boolean) => FrameStats | null {
  const start = performance.now();
  let last = start;
  const deltas: { d: number; at: number }[] = [];
  let raf = requestAnimationFrame(function tick(now) {
    deltas.push({ d: now - last, at: now - start });
    last = now;
    raf = requestAnimationFrame(tick);
  });
  let stopped = false;
  return (keep = true) => {
    if (stopped) return null;
    stopped = true;
    cancelAnimationFrame(raf);
    if (!keep) return null;
    // The first delta measures the gap before the moment, not a frame of it.
    const sorted = deltas.slice(1).sort((a, b) => a.d - b.d);
    if (sorted.length === 0) return null;
    const d = sorted.map((x) => x.d);
    const worst = sorted[sorted.length - 1];
    const stats: FrameStats = {
      label,
      frames: d.length,
      p95: Math.round(d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] * 10) / 10,
      worst: Math.round(worst.d * 10) / 10,
      worstAt: Math.round(worst.at),
      mean: Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10,
    };
    (window.__homeFrames ??= []).push(stats);
    console.info(`[qa] frames ${label}: ${stats.frames} frames, p95 ${stats.p95} ms, worst ${stats.worst} ms at ${stats.worstAt} ms, mean ${stats.mean} ms`);
    return stats;
  };
}
