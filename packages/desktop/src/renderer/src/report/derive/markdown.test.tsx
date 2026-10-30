// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";

import { renderMarkdown, type RichTextFn } from "./markdown";

const html = (src: string, rich?: RichTextFn): HTMLElement => {
  const { container } = render(renderMarkdown(src, rich) as ReactElement);
  return container.firstElementChild as HTMLElement;
};

describe("renderMarkdown", () => {
  test("行内:**粗体**/*斜体*/`代码` 不再原样输出星号和反引号", () => {
    const el = html("优先打断 **Chaos Bolt**,其次 *Fear*,最后是 `Kick`");
    expect(el.querySelector("strong")?.textContent).toBe("Chaos Bolt");
    expect(el.querySelector("em")?.textContent).toBe("Fear");
    expect(el.querySelector("code.coach-md-code")?.textContent).toBe("Kick");
    expect(el.textContent).not.toContain("**");
  });

  test("标题:# 变成 h3 且封顶在 h6", () => {
    const el = html("# 一级\n#### 四级");
    expect(el.querySelector("h3.coach-md-h")?.textContent).toBe("一级");
    expect(el.querySelector("h6.coach-md-h")?.textContent).toBe("四级");
  });

  test("列表:无序与有序分别渲染成 ul/ol,项数保留", () => {
    const el = html("- 先手\n- 爆发\n\n1. 打断\n2. 拉开");
    expect(el.querySelectorAll("ul.coach-md-list li")).toHaveLength(2);
    const ol = el.querySelectorAll("ol.coach-md-list li");
    expect(ol).toHaveLength(2);
    expect(ol[0]?.textContent).toBe("打断");
  });

  test("表格:表头与数据行分别落在 thead/tbody", () => {
    const el = html("| 技能 | 冷却 |\n| --- | --- |\n| Kick | 15s |\n| Fear | 30s |");
    expect(el.querySelectorAll("thead th")).toHaveLength(2);
    expect(el.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(el.querySelector("tbody td")?.textContent).toBe("Kick");
  });

  test("代码块:围栏内容不被当成行内 Markdown 解析", () => {
    const el = html("```\n**not bold**\n```");
    expect(el.querySelector("pre.coach-md-pre")?.textContent).toBe(
      "**not bold**",
    );
    expect(el.querySelector("strong")).toBeNull();
  });

  test("引用与分割线", () => {
    const el = html("结论\n\n> 注意 \n> 第二条\n\n---");
    expect(el.querySelector("blockquote.coach-md-quote")?.textContent).toContain(
      "第二条",
    );
    expect(el.querySelector("hr.coach-md-hr")).not.toBeNull();
  });

  test("保真:不含 Markdown 的段落一个字符都不丢", () => {
    const src = "你的 Tranquility 打断晚了 2 秒。\n第二行保留。";
    expect(html(src).textContent).toBe(src);
  });

  test("rich 叶子回调:文本节点接入技能图标", () => {
    const rich: RichTextFn = (t) => t.replace("Tranquility", "宁静");
    const el = html("**先手** 用 Tranquility", rich);
    expect(el.querySelector("strong")?.textContent).toBe("先手");
    expect(el.textContent).toContain("宁静");
  });

  test("安全:javascript: 链接降级为纯文本,http(s) 才生成 a", () => {
    const el = html("[点我](javascript:alert(1)) 和 [文档](https://example.com)");
    const links = [...el.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com");
    expect(el.textContent).toContain("[点我](javascript:alert(1))");
  });

  test("不带 rich 时依然是一棵合法的 React 树(纯文本兜底)", () => {
    expect(html("普通回答").textContent).toBe("普通回答");
  });
});
