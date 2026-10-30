import {
  deathPosition,
  deriveReplay,
  pathUpTo,
  type ReplayTrack,
  sampleAt,
} from "../src/renderer/src/report/derive/replay";
import { loadMatchFixture } from "./fixtures/loadFixture";

/** Linear reference implementation (a line-by-line copy of the original, as it
 * stood before the 2026-07-26 switch to binary search) — the binary-search
 * version must be point-for-point equivalent to it; that is the criterion for
 * "zero change in results". */
function sampleAtLinear(track: ReplayTrack, t: number) {
  const s = track.samples;
  if (s.length === 0) return null;
  if (track.deathT != null && t >= track.deathT) return null;
  const first = s[0]!;
  if (t <= first.t)
    return { x: first.x, y: first.y, hp: first.hp, maxHp: first.maxHp };
  const last = s[s.length - 1]!;
  if (t >= last.t)
    return { x: last.x, y: last.y, hp: last.hp, maxHp: last.maxHp };
  let hi = 1;
  while (hi < s.length && s[hi]!.t < t) hi++;
  const a = s[hi - 1]!;
  const b = s[hi]!;
  const f = (t - a.t) / (b.t - a.t || 1);
  const lerp = (p: number, q: number, k: number) => p + (q - p) * k;
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    hp: lerp(a.hp, b.hp, f),
    maxHp: lerp(a.maxHp, b.maxHp, f),
  };
}

function pathUpToLinear(track: ReplayTrack, t: number, windowMs = 6000) {
  const s = track.samples;
  if (s.length === 0) return [];
  const cut = track.deathT != null ? Math.min(t, track.deathT) : t;
  const from = cut - windowMs;
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of s) {
    if (p.t < from) continue;
    if (p.t > cut) break;
    pts.push({ x: p.x, y: p.y });
  }
  const cur = sampleAtLinear(track, cut);
  if (cur) pts.push({ x: cur.x, y: cur.y });
  return pts;
}

function deathPositionLinear(track: ReplayTrack) {
  if (track.deathT == null || track.samples.length === 0) return null;
  let p = track.samples[0]!;
  for (const s of track.samples) {
    if (s.t <= track.deathT) p = s;
    else break;
  }
  return { x: p.x, y: p.y };
}

describe("回放采样二分与线性参照逐点等价", () => {
  const m = loadMatchFixture();
  const data = deriveReplay(m);

  it("sampleAt / pathUpTo:真实 fixture 全 track × 密集时刻网格", () => {
    expect(data.tracks.length).toBeGreaterThan(0);
    for (const tr of data.tracks) {
      // Covers before the first sample, after the last sample, gaps between
      // samples, and exact hits on sample points
      const ts: number[] = [data.startTime - 1000, data.endTime + 1000];
      for (let t = data.startTime; t <= data.endTime; t += 137) ts.push(t);
      for (const s of tr.samples.slice(0, 200)) ts.push(s.t, s.t - 1, s.t + 1);
      for (const t of ts) {
        expect(sampleAt(tr, t)).toEqual(sampleAtLinear(tr, t));
        expect(pathUpTo(tr, t)).toEqual(pathUpToLinear(tr, t));
      }
    }
  });

  it("deathPosition:注入死亡的克隆 track(fixture 无死亡)", () => {
    const tr = data.tracks[0]!;
    const mid = tr.samples[Math.floor(tr.samples.length / 2)]!.t;
    for (const deathT of [
      mid,
      mid + 1,
      tr.samples[0]!.t - 1, // every sample later than deathT → first sample
      tr.samples[tr.samples.length - 1]!.t + 5000,
    ]) {
      const dead: ReplayTrack = { ...tr, deathT };
      expect(deathPosition(dead)).toEqual(deathPositionLinear(dead));
    }
  });

  it("边界:单样本 / 同 t 重复样本", () => {
    const base = data.tracks[0]!;
    const one: ReplayTrack = { ...base, samples: [base.samples[0]!] };
    expect(sampleAt(one, base.samples[0]!.t + 500)).toEqual(
      sampleAtLinear(one, base.samples[0]!.t + 500),
    );
    const t0 = base.samples[0]!.t;
    const dup: ReplayTrack = {
      ...base,
      samples: [
        { t: t0, x: 1, y: 1, hp: 10, maxHp: 10 },
        { t: t0 + 100, x: 2, y: 2, hp: 9, maxHp: 10 },
        { t: t0 + 100, x: 3, y: 3, hp: 8, maxHp: 10 },
        { t: t0 + 200, x: 4, y: 4, hp: 7, maxHp: 10 },
      ],
      deathT: null,
    };
    for (const t of [
      t0 - 1,
      t0,
      t0 + 50,
      t0 + 100,
      t0 + 150,
      t0 + 200,
      t0 + 300,
    ])
      expect(sampleAt(dup, t)).toEqual(sampleAtLinear(dup, t));
  });
});
