import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { describe, expect, it } from "vitest";

import { GLOSSARY } from "./glossary";
import {
  bilingual,
  enMessages,
  htmlLang,
  intlLocale,
  LANGUAGES,
  localeToLanguage,
  makeT,
  type MessageKey,
  type MessageParams,
  type MessageValue,
  translate,
  zhMessages,
} from "./index";

describe("translate", () => {
  it("按语言取普通文案", () => {
    expect(translate("zh", "common.save")).toBe("保存");
    expect(translate("en", "common.save")).toBe("Save");
  });

  it("插值替换 {name} 占位符", () => {
    expect(translate("zh", "common.matchCount", { n: 3 })).toBe("3 场");
    expect(translate("en", "common.matchCount", { n: 3 })).toBe("3 matches");
  });

  it("函数形式的值按参数生成", () => {
    expect(translate("en", "common.matchCountPlural", { n: 1 })).toBe(
      "1 match",
    );
    expect(translate("en", "common.matchCountPlural", { n: 2 })).toBe(
      "2 matches",
    );
    expect(translate("zh", "common.matchCountPlural", { n: 2 })).toBe("2 场");
  });

  it("缺参数时占位符原样保留", () => {
    expect(translate("en", "common.matchCount")).toBe("{n} matches");
    expect(translate("en", "common.matchCount", { m: 1 })).toBe("{n} matches");
  });

  it("makeT 绑定语言", () => {
    const t = makeT("en");
    expect(t("common.save")).toBe("Save");
    expect(t("common.matchCount", { n: 5 })).toBe("5 matches");
    expect(makeT("zh")("common.save")).toBe("保存");
  });
});

describe("bilingual", () => {
  it("中文在前、英文在后,各取自己的词典", () => {
    expect(bilingual("settings.language.label")).toBe("语言 / Language");
    expect(bilingual("settings.language.pickerTitle")).toBe(
      "选择语言 / Choose language",
    );
  });
});

describe("localeToLanguage", () => {
  it("zh 开头的 locale 映射到 zh,其余都是 en", () => {
    expect(localeToLanguage("zh-CN")).toBe("zh");
    expect(localeToLanguage("zh-TW")).toBe("zh");
    expect(localeToLanguage("ZH")).toBe("zh");
    expect(localeToLanguage("en-US")).toBe("en");
    expect(localeToLanguage("ja")).toBe("en");
    expect(localeToLanguage(undefined)).toBe("en");
    expect(localeToLanguage(null)).toBe("en");
    expect(localeToLanguage("")).toBe("en");
  });
});

describe("语言辅助", () => {
  it("LANGUAGES 只有 zh / en", () => {
    expect([...LANGUAGES]).toEqual(["zh", "en"]);
  });

  it("htmlLang / intlLocale", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
    expect(intlLocale("zh")).toBe("zh-CN");
    expect(intlLocale("en")).toBe("en-US");
  });

  it("zh 与 en 词典 key 集合一致", () => {
    expect(Object.keys(enMessages).sort()).toEqual(
      Object.keys(zhMessages).sort(),
    );
  });
});

describe("GLOSSARY", () => {
  it("每条都有 id / zh / en / source,id 不重复", () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const g of GLOSSARY) {
      expect(g.id).toMatch(/\S/);
      expect(g.zh).toMatch(/\S/);
      expect(g.en).toMatch(/\S/);
      expect(g.source).toMatch(/\S/);
      expect(ids.has(g.id)).toBe(false);
      ids.add(g.id);
    }
  });
});

// §6.9 checks 2–4. Keys whose en value may equal the zh value (pure numbers,
// symbols, proper nouns), each with a one-line reason. Keep it small.
const IDENTICAL_OK: Partial<Record<MessageKey, string>> = {};

const KEYS = Object.keys(zhMessages) as MessageKey[];
const TEMPLATE_PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Call a function-valued entry with sample params: `n` (and every other
 * param it reads) is 1, then 2. Returns each output and the param names read.
 */
function runWithSamples(fn: (p: MessageParams) => string): {
  outputs: string[];
  params: Set<string>;
} {
  const params = new Set<string>();
  const outputs = [1, 2].map((sample) =>
    fn(
      new Proxy({} as MessageParams, {
        get: (_t, name) => {
          if (typeof name === "string") params.add(name);
          return sample;
        },
        has: () => true,
      }),
    ),
  );
  return { outputs, params };
}

/** Rendered samples and the `{name}` placeholder set of one dictionary value. */
function inspect(value: MessageValue): {
  outputs: string[];
  params: Set<string>;
} {
  if (typeof value === "function") return runWithSamples(value);
  return {
    outputs: [value],
    params: new Set([...value.matchAll(TEMPLATE_PLACEHOLDER)].map((m) => m[1])),
  };
}

describe("词典完整性(§6.9 第 2–4 条)", () => {
  it("en 的值(函数用样例参数跑出的结果)不含 CJK", () => {
    const leaks: string[] = [];
    for (const key of KEYS) {
      for (const out of inspect(enMessages[key]).outputs) {
        if (CJK_LEAK.test(out)) leaks.push(`${key}: ${JSON.stringify(out)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("en 的值不等于 zh 的值(IDENTICAL_OK 除外)", () => {
    const same: string[] = [];
    for (const key of KEYS) {
      const zh = inspect(zhMessages[key]).outputs;
      const en = inspect(enMessages[key]).outputs;
      const identical =
        zh.length === en.length && zh.every((z, i) => z === en[i]);
      if (identical && !(key in IDENTICAL_OK)) same.push(key);
    }
    expect(same).toEqual([]);
  });

  it("IDENTICAL_OK 每条都有理由、key 存在且两侧确实相同", () => {
    for (const [key, reason] of Object.entries(IDENTICAL_OK)) {
      expect(reason, key).toMatch(/\S/);
      expect(KEYS, key).toContain(key);
      const k = key as MessageKey;
      expect(inspect(enMessages[k]).outputs, key).toEqual(
        inspect(zhMessages[k]).outputs,
      );
    }
  });

  it("同一个 key 中英两侧的 {name} 占位符集合相同", () => {
    const mismatched: string[] = [];
    for (const key of KEYS) {
      const zh = [...inspect(zhMessages[key]).params].sort();
      const en = [...inspect(enMessages[key]).params].sort();
      if (zh.join() !== en.join()) {
        mismatched.push(`${key}: zh {${zh.join()}} en {${en.join()}}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe("词典完整性检查的变异测试", () => {
  it("函数值读到的参数名都被收集,样例 n=1 / n=2 都会跑", () => {
    const r = inspect((p) => `${p.n} ${p.who}`);
    expect([...r.params].sort()).toEqual(["n", "who"]);
    expect(r.outputs).toEqual(["1 1", "2 2"]);
  });

  it("字符串值取 {name} 占位符", () => {
    expect([...inspect("{a} and {b}{a}").params].sort()).toEqual(["a", "b"]);
  });

  it("只有复数分支漏翻的函数值也会被抓到", () => {
    const enFn = (p: MessageParams) => (p.n === 1 ? "1 match" : `${p.n} 场`);
    expect(inspect(enFn).outputs.some((o) => CJK_LEAK.test(o))).toBe(true);
  });
});
