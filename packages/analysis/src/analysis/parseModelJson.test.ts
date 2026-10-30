import { describe, expect, it } from "vitest";

import { parseModelJsonArray, parseModelJsonObject } from "./parseModelJson";

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
    // Bracket slicing must be disabled for text starting with {, otherwise
    // {"findings":[...]} gets "rescued" by slicing out the inner array, quietly
    // changing the contract
    expect(parseModelJsonArray('{"wrap":[{"a":1}]}')).toBeNull();
  });
});

describe("parseModelJsonObject(AI 自查的回复契约 {findings, changes}):同一套只定位不修复", () => {
  const obj = JSON.stringify({ findings: [{ a: 1 }], changes: [] });
  it("裸对象 / 围栏 / 围栏外散文 / 无围栏前置散文 都能取到", () => {
    expect(parseModelJsonObject(obj)?.findings).toHaveLength(1);
    expect(parseModelJsonObject("```json\n" + obj + "\n```")).not.toBeNull();
    expect(
      parseModelJsonObject("核对完毕:\n```json\n" + obj + "\n```\n以上。"),
    ).not.toBeNull();
    expect(parseModelJsonObject("核对完毕:\n" + obj)).not.toBeNull();
  });
  it("顶层是数组 → null(违约,不把数组当结果)", () => {
    expect(parseModelJsonObject("[{\"findings\":[]}]")).toBeNull();
    expect(parseModelJsonObject("```json\n[1,2]\n```")).toBeNull();
  });
  it("截断 / 空 / 纯散文 → null", () => {
    expect(parseModelJsonObject('{"findings":[{"a":1}')).toBeNull();
    expect(parseModelJsonObject("")).toBeNull();
    expect(parseModelJsonObject("不好意思,我做不到")).toBeNull();
  });
});
