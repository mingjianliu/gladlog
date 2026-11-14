// @vitest-environment jsdom
import { ensureAnalysisData } from "@gladlog/analysis";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openMatchDoc } from "../src/renderer/src/matchDocLoader";
import { buildAnalysisInput } from "../src/renderer/src/report/derive/analysisInput";
import {
  ID_MEMO_MAX,
  idMemo,
  idMemoGet,
  idMemoPut,
  noteLoadedSource,
  resetIdMemoForTest,
  sourceIdentity,
} from "../src/renderer/src/report/derive/idMemo";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import { setDeriveWorkerForTest } from "../src/renderer/src/report/derive/offThread/offThreadDerive";
import { resetSourceMemoForTest } from "../src/renderer/src/report/derive/sourceMemo";
import type { ReportSource } from "../src/renderer/src/report/derive/types";
import { loadRealMatchFixture } from "./fixtures/loadFixture";

// Re-opening a match parses it into a new object, so the object-keyed derive
// cache starts empty for it; the id-keyed one keeps the small results
// (Windows field run 2026-11-14: a 778 s 3v3 re-opened paid ~2.1 s of mistakes
// and ~5.5 s of AI-tab input again). Only what was read from the store takes
// part: an object built or edited in memory never hits another one's results.

const json = JSON.stringify(loadRealMatchFixture());
const bytes = new TextEncoder().encode(
  JSON.stringify({ data: JSON.parse(json) }),
);
/** A re-open of the stored match "m1": a new object, registered as read. */
const reopen = (byteLength = bytes.byteLength) => {
  const s = JSON.parse(json) as ReportSource;
  noteLoadedSource(s, "m1", "data", byteLength);
  return s;
};

beforeAll(async () => {
  await ensureAnalysisData();
});
beforeEach(() => {
  resetSourceMemoForTest(true);
  resetIdMemoForTest();
  setDeriveWorkerForTest(null);
});

describe("idMemo", () => {
  it("同一文件重开(新对象)身份相同;字节数不同或不是读进来的,身份不同/没有", () => {
    const a = reopen();
    const b = reopen();
    expect(a).not.toBe(b);
    expect(sourceIdentity(a)).toBeDefined();
    expect(sourceIdentity(a)).toBe(sourceIdentity(b));
    expect(sourceIdentity(reopen(bytes.byteLength + 1))).not.toBe(
      sourceIdentity(a),
    );
    expect(sourceIdentity(JSON.parse(json) as ReportSource)).toBeUndefined();
  });

  it("重开后失误清单与分析输入直接命中,不再重算", () => {
    const first = deriveMistakes(reopen());
    const input = buildAnalysisInput(reopen(), "m");
    expect(deriveMistakes(reopen())).toBe(first);
    expect(buildAnalysisInput(reopen(), "m")).toBe(input);
    // another match id is another prompt input
    expect(buildAnalysisInput(reopen(), "other")).not.toBe(input);
  });

  it("不是从库里读的对象(内存里改出来的变体)永远不命中", () => {
    const first = deriveMistakes(reopen());
    const edited = JSON.parse(json) as ReportSource;
    expect(deriveMistakes(edited)).not.toBe(first);
  });

  it("从库里打开(openMatchDoc)的对象登记了身份,再开一次就命中", async () => {
    (window as unknown as { __gladlogFixture: unknown }).__gladlogFixture = {
      matches: {
        get: async () => null,
        getLazyRaw: async () => ({ mode: "full", bytes: bytes.slice() }),
      },
    };
    const open = async () =>
      ((await openMatchDoc("m1")) as { data: ReportSource }).data;
    const a = await open();
    const first = deriveMistakes(a);
    const b = await open();
    expect(b).not.toBe(a);
    expect(deriveMistakes(b)).toBe(first);
  });

  it("输入不同不命中;超过上限按最久未用淘汰", () => {
    const s = reopen();
    idMemoPut(s, "k", ["x"], 1);
    expect(idMemoGet(s, "k", ["x"])).toBe(1);
    expect(idMemoGet(s, "k", ["y"])).toBeUndefined();
    const other = (i: number) => {
      const o = JSON.parse(json) as ReportSource;
      noteLoadedSource(o, `other-${i}`, "data", 1);
      return o;
    };
    const others = Array.from({ length: ID_MEMO_MAX }, (_, i) => other(i));
    others.forEach((o, i) => idMemoPut(o, "k", ["x"], i));
    expect(idMemoGet(s, "k", ["x"])).toBeUndefined();
    expect(idMemoGet(others[0]!, "k", ["x"])).toBe(0);
  });

  it("分析数据没加载好时什么都不留", () => {
    resetSourceMemoForTest(false);
    const s = reopen();
    let n = 0;
    idMemo(s, "k", [], () => ++n);
    idMemo(s, "k", [], () => ++n);
    expect(n).toBe(2);
  });
});
