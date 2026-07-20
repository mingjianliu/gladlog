import { describe, expect, it } from "vitest";

import { parseModelJsonArray } from "./parseModelJson";

const body = JSON.stringify([{ a: 1 }, { a: 2 }]);

describe("parseModelJsonArray:该救的救", () => {
  it("裸数组", () => {
    expect(parseModelJsonArray(body)).toHaveLength(2);
  });

  it("```json 围栏 —— claude -p 对真实对局的实测形态", () => {
    expect(parseModelJsonArray("```json\n" + body + "\n```")).toHaveLength(2);
  });

  it("裸 ``` 围栏(无语言标注)", () => {
    expect(parseModelJsonArray("```\n" + body + "\n```")).toHaveLength(2);
  });

  it("围栏前后带散文(system 要求中文回复时常见)", () => {
    expect(
      parseModelJsonArray(
        "好的,要点如下:\n\n```json\n" + body + "\n```\n\n完毕。",
      ),
    ).toHaveLength(2);
  });

  it("无围栏但有前置散文 → 切最外层方括号", () => {
    expect(parseModelJsonArray("以下是结果:\n" + body)).toHaveLength(2);
  });

  it("首尾空白", () => {
    expect(parseModelJsonArray("\n\n  " + body + "  \n")).toHaveLength(2);
  });
});

describe("parseModelJsonArray:不该救的别救", () => {
  it("空 / 纯散文 → null", () => {
    expect(parseModelJsonArray("")).toBeNull();
    expect(parseModelJsonArray("   ")).toBeNull();
    expect(parseModelJsonArray("not json at all")).toBeNull();
  });

  it("截断的数组 → null,绝不吐半份", () => {
    expect(parseModelJsonArray('[{"a":1},{"a"')).toBeNull();
    expect(parseModelJsonArray('```json\n[{"a":1},{"a"')).toBeNull();
  });

  it("顶层是对象 → null(契约是数组,这是真违约)", () => {
    expect(parseModelJsonArray('{"findings":[]}')).toBeNull();
    expect(
      parseModelJsonArray('```json\n{"findings":[{"a":1}]}\n```'),
    ).toBeNull();
  });

  it("对象里嵌数组也不许被切出来当结果", () => {
    // 方括号切片对以 { 开头的文本必须关闭,否则 {"findings":[…]} 会被
    // 切成里面那个数组「救活」,悄悄改变契约
    expect(parseModelJsonArray('{"wrap":[{"a":1}]}')).toBeNull();
  });
});
