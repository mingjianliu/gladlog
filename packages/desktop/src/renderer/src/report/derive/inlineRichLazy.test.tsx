// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

import { makeRichText } from "./inlineRich";
import type { ReportSource } from "./types";

/** Hoisted above the import above: vi.mock is hoisted to the top of the file,
 * but the factory must still be able to see this spy. */
const { englishNameIndexMock } = vi.hoisted(() => ({
  englishNameIndexMock: vi.fn<
    () => ReadonlyMap<string, readonly string[]> | null
  >(),
}));

// Keep everything else real — SpellInline reads SPELL_ICONS_GENERATED from the
// same module and would otherwise render nothing.
vi.mock("@gladlog/analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gladlog/analysis")>()),
  englishNameIndex: englishNameIndexMock,
}));

const emptySource = { units: {} } as unknown as ReportSource;
const textOf = (node: ReactNode): string =>
  render(<span>{node}</span>).container.textContent ?? "";

describe("makeRichText 的默认依赖必须每次渲染重新取值", () => {
  test("字典未就绪时创建的 rich,加载完成后自愈", () => {
    englishNameIndexMock.mockReturnValue(null);
    // No explicit deps — the production path. A report mounts well before the
    // 12MB table finishes streaming in, so this is the real timing.
    const rich = makeRichText(emptySource, "zh");

    expect(textOf(rich("Tranquility 晚了"))).toBe("Tranquility 晚了");

    // The background load completes; nothing recreates `rich` in between.
    englishNameIndexMock.mockReturnValue(
      new Map<string, readonly string[]>([["Tranquility", ["740"]]]),
    );

    const { container } = render(<span>{rich("Tranquility 晚了")}</span>);
    expect(container.querySelector(".rpt-inline-spell")).not.toBeNull();
    expect(container.textContent).toContain("宁静");
  });

  test("显式传入的 deps 仍然一次冻结", () => {
    englishNameIndexMock.mockReturnValue(null);
    const rich = makeRichText(emptySource, "zh", {
      nameIndex: null,
      zhNames: {},
      observed: new Set<string>(),
      specByName: {},
      specZh: {},
    });

    englishNameIndexMock.mockReturnValue(
      new Map<string, readonly string[]>([["Tranquility", ["740"]]]),
    );

    expect(textOf(rich("Tranquility"))).toBe("Tranquility");
  });
});
