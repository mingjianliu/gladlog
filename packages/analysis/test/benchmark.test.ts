import { stratifiedSample, type SampleMeta } from "../src/benchmark/stratify";

const meta = (spec: string, arch: string, id: string): SampleMeta => ({ id, spec, archetype: arch });

describe("stratifiedSample", () => {
  it("按 spec×archetype 分层,每层均衡上限,尊重 minN 标记", () => {
    const pool: SampleMeta[] = [
      ...Array.from({ length: 50 }, (_, i) => meta("Holy Paladin", "melee-cleave", `a${i}`)),
      ...Array.from({ length: 10 }, (_, i) => meta("Holy Paladin", "caster", `b${i}`)),
      ...Array.from({ length: 3 }, (_, i) => meta("Devourer DH", "melee-cleave", `c${i}`)),
    ];
    const r = stratifiedSample(pool, { perStratumCap: 20, minN: 30 });
    const hpal = r.selected.filter((s) => s.spec === "Holy Paladin");
    expect(hpal.filter((s) => s.archetype === "melee-cleave").length).toBeLessThanOrEqual(20);
    expect(hpal.filter((s) => s.archetype === "caster").length).toBe(10);
    expect(r.perSpec["Holy Paladin"].n).toBe(hpal.length);
    expect(r.perSpec["Holy Paladin"].insufficient).toBe(false);
    expect(r.perSpec["Devourer DH"].n).toBe(3);
    expect(r.perSpec["Devourer DH"].insufficient).toBe(true);
  });
  it("空池不抛", () => {
    const r = stratifiedSample([], { perStratumCap: 5, minN: 2 });
    expect(r.selected).toEqual([]);
    expect(r.perSpec).toEqual({});
  });
});
