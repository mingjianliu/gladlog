import { CJK_LEAK } from "@gladlog/analysis/src/utils/localizedText";
import { describe, expect, it } from "vitest";

import { GLOSSARY } from "./glossary";
import {
  bilingual,
  effectiveLanguage,
  enMessages,
  htmlLang,
  intlLocale,
  LANGUAGES,
  localeToLanguage,
  makeT,
  type MessageKey,
  type MessageParams,
  type MessageValue,
  placeholderNames,
  translate,
  zhMessages,
} from "./index";

describe("en 序数与复数(final review 1/2)", () => {
  it("百分位序数后缀:st/nd/rd/th,11–13 一律 th;zh 不变", () => {
    const cases: Array<[number, string]> = [
      [1, "1st"],
      [2, "2nd"],
      [3, "3rd"],
      [4, "4th"],
      [11, "11th"],
      [12, "12th"],
      [13, "13th"],
      [21, "21st"],
      [22, "22nd"],
      [23, "23rd"],
      [101, "101st"],
      [111, "111th"],
    ];
    for (const [n, want] of cases)
      expect(translate("en", "report.cohort.percentile", { n })).toBe(want);
    expect(translate("zh", "report.cohort.percentile", { n: 22 })).toBe(
      "第 22 百分位",
    );
  });

  it("backlash 窗口的 DoT 数与死亡回顾的跳数按 n 单复数", () => {
    const worth = (dots: number) =>
      translate("en", "report.mistakes.backlashWindowWorth", {
        t: 30,
        debuff: "Unstable Affliction",
        target: "Warr",
        targetHpPct: 40,
        dots,
        k: 120,
      });
    expect(worth(1)).toContain("(40%, 1 DoT)");
    expect(worth(2)).toContain("(40%, 2 DoTs)");
    expect(translate("en", "report.deathCard.ticks", { ticks: 1, s: 3 })).toBe(
      " ×1 tick/3s",
    );
    expect(translate("en", "report.deathCard.ticks", { ticks: 2, s: 3 })).toBe(
      " ×2 ticks/3s",
    );
  });
});

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

describe("effectiveLanguage", () => {
  it("存了 zh / en 就用存的,不看 locale", () => {
    expect(effectiveLanguage("en", "zh-CN")).toBe("en");
    expect(effectiveLanguage("zh", "en-US")).toBe("zh");
  });

  it("没存或存了无效值时按 locale 推断", () => {
    expect(effectiveLanguage(null, "zh-TW")).toBe("zh");
    expect(effectiveLanguage(undefined, "en-US")).toBe("en");
    expect(effectiveLanguage("fr" as never, "zh-CN")).toBe("zh");
    expect(effectiveLanguage(null, undefined)).toBe("en");
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
    params: new Set(placeholderNames(value)),
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

describe("namespace files", () => {
  // One prefix (report.common.*) is split across two namespace files, so a key
  // defined twice would silently resolve to whichever spread comes last. The
  // merged dictionary must be exactly the disjoint union of its files.
  it.each(["zh", "en"] as const)(
    "%s: no key is defined in two namespace files",
    async (lang) => {
      const { readdirSync } = await import("fs");
      const { join } = await import("path");
      const dir = join(__dirname, lang);
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".ts") && f !== "index.ts" && !f.includes(".test."),
      );
      const seen = new Map<string, string>();
      const dupes: string[] = [];
      for (const f of files) {
        const mod = (await import(
          `./${lang}/${f.replace(/\.ts$/, "")}`
        )) as Record<string, Record<string, unknown>>;
        for (const ns of Object.values(mod)) {
          for (const k of Object.keys(ns)) {
            const prev = seen.get(k);
            if (prev) dupes.push(`${k}: ${prev} + ${f}`);
            seen.set(k, f);
          }
        }
      }
      expect(dupes).toEqual([]);
      const merged = lang === "zh" ? zhMessages : enMessages;
      expect(seen.size).toBe(Object.keys(merged).length);
    },
  );
});
