// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FindingsList, findingKey } from "./FindingsList";

const findings = [
  {
    eventIds: ["e1"],
    severity: "high",
    category: "survival",
    title: "Death",
    explanation: "You died at 30s.",
  },
  {
    eventIds: ["e2"],
    severity: "low",
    category: "cd",
    title: "CD",
    explanation: "Held Barkskin.",
  },
];

describe("FindingsList", () => {
  it("renders finding cards in the given order with title + explanation + severity", () => {
    render(<FindingsList findings={findings as any} onSelect={() => {}} />);
    expect(screen.getByText(/You died at 30s/)).toBeTruthy();
    expect(screen.getByText(/Held Barkskin/)).toBeTruthy();
    expect(screen.getByText(/survival/i)).toBeTruthy();
    expect(screen.getByText(/high/i)).toBeTruthy();
  });
  it("renders an empty state when there are no findings", () => {
    render(<FindingsList findings={[]} onSelect={() => {}} />);
    expect(screen.getByText(/no findings|nothing/i)).toBeTruthy();
  });
  it("long explanation clamps to 2 lines with 展开全文/收起 toggle", () => {
    const long = [
      {
        eventIds: [],
        severity: "med",
        category: "positioning",
        title: "Spread",
        explanation: "站位".repeat(80),
      },
    ];
    const { container } = render(
      <FindingsList findings={long as any} onSelect={() => {}} />,
    );
    expect(container.querySelector(".rpt-finding-body.clamp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /展开全文/ }));
    expect(container.querySelector(".rpt-finding-body.clamp")).toBeNull();
    expect(screen.getByRole("button", { name: /收起/ })).toBeTruthy();
  });
});

describe("finding 标记按钮(phase3 #3a)", () => {
  it("findingKey 语言无关(与 title 无关,eventIds 排序)", () => {
    const a = {
      eventIds: ["e2", "e1"],
      category: "survival",
      title: "死亡",
      severity: "high",
      explanation: "x",
    };
    const b = {
      eventIds: ["e1", "e2"],
      category: "survival",
      title: "Death",
      severity: "high",
      explanation: "y",
    };
    expect(findingKey(a as never)).toBe(findingKey(b as never));
  });

  it("点「已跟进」回调 done,再点清除;active 态跟随 flags", () => {
    const calls: Array<[string, string | null]> = [];
    const key = findingKey(findings[0] as never);
    const { rerender } = render(
      <FindingsList
        findings={findings as never}
        onSelect={() => {}}
        flags={{}}
        onFlag={(k, f) => calls.push([k, f])}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /已跟进/ })[0]!);
    expect(calls).toEqual([[key, "done"]]);
    rerender(
      <FindingsList
        findings={findings as never}
        onSelect={() => {}}
        flags={{ [key]: "done" }}
        onFlag={(k, f) => calls.push([k, f])}
      />,
    );
    const btn = screen.getAllByRole("button", { name: /已跟进/ })[0]!;
    expect(btn.className).toContain("active");
    fireEvent.click(btn);
    expect(calls[1]).toEqual([key, null]);
  });
});

describe("chip 技能图标", () => {
  // SpellIcon 通过 bridge().icon.get 拿 dataURL;桩缺面时组件内已 optional,
  // 这里给一个假的以便断言 <img> 真的渲染出来。
  beforeEach(() => {
    (window as any).__gladlogFixture = {
      icon: { get: async () => "data:image/png;base64,iVBORw0KGgo=" },
    };
  });

  const withSpell = [
    {
      eventIds: ["e1"],
      severity: "high",
      category: "cc",
      title: "被控",
      explanation: "变形术开场。",
      deepDive: {
        text: "深挖正文",
        chips: [
          { t: 83, label: "变形术", unitNames: ["A"], spellId: "118" },
          { t: 90, label: "脱靶", unitNames: ["A"] }, // 无技能 → 无图标
        ],
      },
    },
  ];
  const candidates = [
    {
      id: "e1",
      type: "cc",
      t: 83,
      unitNames: ["A"],
      spell: "变形术",
      spellId: "118",
      facts: {},
    },
  ];

  it("Evidence chip:有 spellId → 出图标;技能名进 tooltip", async () => {
    const { container } = render(
      <FindingsList
        findings={withSpell as any}
        candidates={candidates as any}
        onSelect={() => {}}
        onJump={() => {}}
      />,
    );
    const evChip = container.querySelector(
      ".rpt-finding-ev .rpt-finding-evt",
    ) as HTMLElement;
    expect(evChip.getAttribute("title")).toContain("变形术");
    // alt="" 是刻意的(装饰性),所以按标签等而不是按 role="img" 等
    await waitFor(() => expect(evChip.querySelector("img")).toBeTruthy());
  });

  it("深挖 chip:有技能的出图标,没技能的不留占位", async () => {
    const { container } = render(
      <FindingsList
        findings={withSpell as any}
        candidates={candidates as any}
        onSelect={() => {}}
        onJump={() => {}}
        onJumpT={() => {}}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".rpt-finding-deep-chips img")).toBeTruthy(),
    );
    const deepChips = Array.from(
      container.querySelectorAll(".rpt-finding-deep-chips .rpt-finding-evt"),
    );
    expect(deepChips).toHaveLength(2);
    expect(deepChips[0].querySelector("img")).toBeTruthy(); // 变形术
    expect(deepChips[1].querySelector("img")).toBeNull(); // 脱靶:无 spellId
    // 文字没被图标挤掉
    expect(deepChips[0].textContent).toContain("变形术");
  });

  it("取图失败时不冒出首字母兜底 —— 否则会读成「变⏱ 0:38 变形术」", async () => {
    // bridge 的 icon 面返回 null(图标文件缺失/缓存未命中):SpellIcon 会退化
    // 成 label 首字母,chip 场景下那是与紧邻技能名重复的噪音。试验台上实测到过。
    (window as any).__gladlogFixture = { icon: { get: async () => null } };
    const { container } = render(
      <FindingsList
        findings={withSpell as any}
        candidates={candidates as any}
        onSelect={() => {}}
        onJump={() => {}}
        onJumpT={() => {}}
      />,
    );
    const chip = container.querySelector(
      ".rpt-finding-deep-chips .rpt-finding-evt",
    ) as HTMLElement;
    // 允许有空的占位 span,但里面不能有任何可见字符
    const iconSpan = chip.querySelector(".rpt-spellicon-fallback");
    expect(iconSpan?.textContent ?? "").toBe("");
    expect(chip.textContent?.startsWith("变形")).toBe(false);
  });

  it("spellId 不在生成表里 → 静默不渲染,不出问号占位", () => {
    const unknown = [
      {
        ...withSpell[0],
        deepDive: {
          text: "x",
          chips: [
            { t: 1, label: "怪技能", unitNames: [], spellId: "99999999" },
          ],
        },
      },
    ];
    const { container } = render(
      <FindingsList
        findings={unknown as any}
        onSelect={() => {}}
        onJumpT={() => {}}
      />,
    );
    const chip = container.querySelector(
      ".rpt-finding-deep-chips .rpt-finding-evt",
    ) as HTMLElement;
    expect(chip.querySelector("img")).toBeNull();
    expect(chip.textContent).toContain("怪技能");
  });
});
