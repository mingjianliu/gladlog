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
