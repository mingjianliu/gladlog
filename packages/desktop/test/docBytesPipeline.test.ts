import { mkdirSync,mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { MatchStore } from "../src/main/matchStore";
import { parseDocBytes } from "../src/shared/parseDocBytes";
import { slimStoredDoc } from "../src/shared/slimDoc";
import { loadMatchFixture } from "./fixtures/loadFixture";

/** End-to-end equivalence of the direct doc-bytes path (root-caused 2026-07-26):
 * new pipeline = store.get() bytes → parseDocBytes (parse + slim fallback)
 * old pipeline = parse the file → slimStoredDoc (what main sent after self-heal)
 * The two must be deep-equal — including the "fat doc" case (params not
 * trimmed, crit not materialised). */
describe("doc 字节直传管线等价", () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-bytes-"));

  const putDoc = (id: string, doc: unknown) => {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "match.json"), JSON.stringify(doc));
    writeFileSync(
      join(dir, id, "meta.json"),
      JSON.stringify({ id, kind: "match", startTime: 1, endTime: 2 }),
    );
  };

  it("真实 fixture:get 字节 → parseDocBytes == 旧管线(parse+slim)", async () => {
    const m = loadMatchFixture();
    const doc = { schemaVersion: 1, kind: "match", data: m };
    putDoc("real1", doc);
    const s = new MatchStore(dir);
    (s as unknown as { index: Map<string, unknown> }).index.set("real1", {
      id: "real1",
      slimmed: true,
    });
    const buf = await s.get("real1");
    expect(buf).toBeInstanceOf(Buffer);
    const viaBytes = parseDocBytes(buf);
    // Old main pipeline: parse, then run the same slim predicate before
    // sending (fixture events carry fat params; the predicate is idempotent —
    // already-slim parts are untouched and fat parts are trimmed identically by
    // both pipelines)
    const legacy = JSON.parse(
      readFileSync(join(dir, "real1", "match.json"), "utf-8"),
    );
    slimStoredDoc(legacy);
    expect(viaBytes).toEqual(legacy);
  });

  it("肥档:parseDocBytes 输出 == 旧管线(parse+slimStoredDoc)输出", async () => {
    // Build a fat event: 14+ params, no crit (triggers crit materialisation +
    // trimming)
    const m = loadMatchFixture() as unknown as {
      units: Record<string, { damageOut?: Array<Record<string, unknown>>[] }>;
    };
    const fat = JSON.parse(JSON.stringify(m));
    const anyUnit = Object.values(fat.units)[0] as {
      damageOut?: Array<Record<string, unknown>>;
    };
    anyUnit.damageOut = [
      {
        eventName: "SPELL_DAMAGE",
        timestamp: 1,
        params: Array.from({ length: 20 }, (_, i) => `p${i}`),
      },
    ];
    const doc = { schemaVersion: 1, kind: "match", data: fat };
    putDoc("fat1", doc);
    const s = new MatchStore(dir);
    (s as unknown as { index: Map<string, unknown> }).index.set("fat1", {
      id: "fat1",
      // Deliberately no `slimmed` flag: take the fat-doc path (the self-heal
      // worker fails gracefully under vitest, which does not affect this
      // criterion — the consumer-side fallback must hold on its own)
    });
    const viaBytes = parseDocBytes(await s.get("fat1"));

    const legacy = JSON.parse(
      readFileSync(join(dir, "fat1", "match.json"), "utf-8"),
    );
    slimStoredDoc(legacy); // the old main pipeline's self-heal
    expect(viaBytes).toEqual(legacy);
    // And trimming really happened (params ≤13 entries, first one an empty string)
    const e = (
      (viaBytes as { data: typeof fat }).data.units[
        Object.keys(fat.units)[0]!
      ] as { damageOut: Array<{ params: string[] }> }
    ).damageOut[0]!;
    expect(e.params.length).toBeLessThanOrEqual(13);
    expect(e.params[0]).toBe("");
  });
});
