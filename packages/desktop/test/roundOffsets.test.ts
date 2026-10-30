import { parseDocBytes } from "../src/shared/parseDocBytes";
import { composeLazyDoc, parseRoundBytes } from "../src/shared/parseLazyDoc";
import {
  buildShellText,
  nullFiller,
  scanRoundOffsets,
} from "../src/shared/roundOffsets";
import { loadMatchFixture } from "./fixtures/loadFixture";

const enc = (s: string) => Buffer.from(s, "utf-8");

/** 判据:扫出的每轮字节段独立 JSON.parse,与整档 JSON.parse 的 rounds 深等 */
function roundTripEquals(doc: unknown): void {
  const buf = enc(JSON.stringify(doc));
  const off = scanRoundOffsets(buf);
  expect(off).not.toBeNull();
  const truth = JSON.parse(buf.toString("utf-8")) as {
    data: { rounds: unknown[] };
  };
  expect(off!.rounds.length).toBe(truth.data.rounds.length);
  for (const [i, [s, e]] of off!.rounds.entries()) {
    expect(JSON.parse(buf.subarray(s, e).toString("utf-8"))).toEqual(
      truth.data.rounds[i],
    );
  }
  // shell:rounds 全部换成 null,其余字段不变
  const shell = JSON.parse(buildShellText(buf, off!)) as {
    data: { rounds: unknown[] };
  };
  expect(shell.data.rounds).toEqual(truth.data.rounds.map(() => null));
  expect({
    ...shell,
    data: { ...shell.data, rounds: undefined },
  }).toEqual({ ...truth, data: { ...truth.data, rounds: undefined } });
}

const shuffleDoc = (
  rounds: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  storedAt: 123,
  kind: "shuffle",
  data: {
    kind: "shuffle",
    startTime: 1,
    endTime: 2,
    result: "3/6",
    rounds,
    ...extra,
  },
});

describe("scanRoundOffsets", () => {
  it("典型 shuffle:每轮字节段与整档 parse 深等", () => {
    roundTripEquals(
      shuffleDoc([
        { id: "r1", sequenceNumber: 0, units: { a: { casts: [1, 2] } } },
        { id: "r2", sequenceNumber: 1, units: { b: { casts: [] } } },
        { id: "r3", sequenceNumber: 2, units: {} },
      ]),
    );
  });

  it('字符串陷阱:值里含 "rounds":[、转义引号、括号、CJK', () => {
    roundTripEquals(
      shuffleDoc(
        [
          {
            id: "r1",
            note: 'evil "rounds":[{"x":1}] inside a string',
            name: '逃跑的"术士\\\\',
            weird: "}]{[",
            units: {},
          },
          { id: "r2", cjk: "回合②·测试", units: {} },
        ],
        { desc: 'top "rounds": not the real key' },
      ),
    );
  });

  it("真实 fixture 作为一轮:往返深等", () => {
    const m = loadMatchFixture();
    roundTripEquals(shuffleDoc([m, { id: "r2", units: {} }]));
  });

  it("空 rounds 数组:返回 0 轮", () => {
    const buf = enc(JSON.stringify(shuffleDoc([])));
    const off = scanRoundOffsets(buf);
    expect(off).not.toBeNull();
    expect(off!.rounds).toEqual([]);
  });

  it("非 shuffle(无 rounds 键):返回 null", () => {
    const buf = enc(
      JSON.stringify({ schemaVersion: 1, kind: "match", data: { units: {} } }),
    );
    expect(scanRoundOffsets(buf)).toBeNull();
  });

  it("截断档:返回 null 而非抛错", () => {
    const full = enc(JSON.stringify(shuffleDoc([{ id: "r1", units: {} }])));
    expect(scanRoundOffsets(full.subarray(0, full.length - 10))).toBeNull();
  });

  it("nullFiller:0/1/3", () => {
    expect(nullFiller(0)).toBe("");
    expect(nullFiller(1)).toBe("null");
    expect(nullFiller(3)).toBe("null,null,null");
  });
});

describe("composeLazyDoc / parseRoundBytes 与整档路径等价", () => {
  it("shell+round0 组合 == parseDocBytes 整档(除未加载轮为 null)", () => {
    const m = loadMatchFixture();
    const doc = shuffleDoc([m, { id: "r2", units: {} }]);
    const buf = enc(JSON.stringify(doc));
    const off = scanRoundOffsets(buf)!;
    const shell = enc(buildShellText(buf, off));
    const [s0, e0] = off.rounds[0]!;
    const composed = composeLazyDoc(
      shell,
      buf.subarray(s0, e0),
      off.rounds.length,
    ) as { data: { rounds: unknown[] } };
    const whole = parseDocBytes(enc(JSON.stringify(doc))) as {
      data: { rounds: unknown[] };
    };
    // 判据:round0 与整档路径(含 slim 谓词)逐字段深等
    expect(composed.data.rounds[0]).toEqual(whole.data.rounds[0]);
    expect(composed.data.rounds[1]).toBeNull();
    // 懒加载第 2 轮后与整档深等
    const [s1, e1] = off.rounds[1]!;
    composed.data.rounds[1] = parseRoundBytes(buf.subarray(s1, e1));
    expect(composed).toEqual(whole);
  });

  it("坏字节 fail-open:composeLazyDoc/parseRoundBytes 返回 null", () => {
    expect(composeLazyDoc(enc("{oops"), enc("{}"), 2)).toBeNull();
    expect(composeLazyDoc(null, enc("{}"), 2)).toBeNull();
    expect(parseRoundBytes(enc("{nope"))).toBeNull();
    // roundCount 与 shell 不符 → null(防 sidecar 与档案漂移)
    const doc = shuffleDoc([{ id: "r1", units: {} }]);
    const buf = enc(JSON.stringify(doc));
    const off = scanRoundOffsets(buf)!;
    const shell = enc(buildShellText(buf, off));
    const [s0, e0] = off.rounds[0]!;
    expect(composeLazyDoc(shell, buf.subarray(s0, e0), 5)).toBeNull();
  });
});
