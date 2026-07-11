// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { UnitPanel } from "../src/renderer/src/report/components/UnitPanel";
import { nodeMaps } from "@gladlog/analysis";
import { loadMatchFixture } from "./fixtures/loadFixture";

const baseMatch = loadMatchFixture();

describe("UnitPanel talents", () => {
  it("renders named talent if resolved from real analysis data", () => {
    const specIds = Object.keys(nodeMaps).map(Number);
    const specId = specIds.find((id) => nodeMaps[id].classNodes.length > 0) as number;
    const node = nodeMaps[specId].classNodes[0];
    const entry = node.entries[0];

    const unitId = Object.keys(baseMatch.units)[0];
    const unit = baseMatch.units[unitId];
    const modifiedMatch = {
      ...baseMatch,
      units: {
        ...baseMatch.units,
        [unitId]: {
          ...unit,
          specId: specId,
          info: unit.info ? {
            ...unit.info,
            specId: specId,
            talents: [
              { id1: node.id, id2: entry.id, count: 1 }
            ]
          } : undefined
        }
      }
    };

    render(<UnitPanel source={modifiedMatch} unitId={unitId} />);

    expect(screen.getByText(entry.name)).toBeTruthy();
  });

  it("gracefully falls back when talents are unresolvable", () => {
    const unitId = Object.keys(baseMatch.units)[0];
    const unit = baseMatch.units[unitId];
    const modifiedMatch = {
      ...baseMatch,
      units: {
        ...baseMatch.units,
        [unitId]: {
          ...unit,
          info: unit.info ? {
            ...unit.info,
            specId: 999999,
            talents: [
              { id1: 999, id2: 999, count: 1 }
            ]
          } : undefined
        }
      }
    };

    render(<UnitPanel source={modifiedMatch} unitId={unitId} />);

    expect(screen.getByText(/天赋 1 项/)).toBeTruthy();
  });
});
