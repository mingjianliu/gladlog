import { readFileSync } from "fs";
import { parseCsv } from "../../scripts/datagen/lib/wagoCsv";
import { collectCandidateIds } from "../../scripts/datagen/lib/candidates";
import { mineSpellEffects } from "../../scripts/datagen/genSpellEffects";

const fx = (name: string) =>
  parseCsv(
    readFileSync(
      new URL(`./fixtures/${name}.mini.csv`, import.meta.url).pathname,
      "utf-8",
    ),
  ).rows;

const csv = {
  spellMisc: fx("SpellMisc"),
  spellDuration: fx("SpellDuration"),
  spellCooldowns: fx("SpellCooldowns"),
  spellCategories: fx("SpellCategories"),
  spellCategory: fx("SpellCategory"),
  spellName: fx("SpellName"),
};

const candidates = new Set(["118", "1714", "8122", "190319", "108271"]);

describe("mineSpellEffects(fixture goldens)", () => {
  const mined = mineSpellEffects(csv, candidates);

  it("Polymorph 118:dispelType Magic、时长 60s(DifficultyID≠0 行被忽略)、无 CD", () => {
    expect(mined["118"].dispelType).toBe("Magic");
    expect(mined["118"].durationSeconds).toBe(60);
    expect(mined["118"].cooldownSeconds).toBeUndefined();
    expect(mined["118"].name).toBe("Polymorph");
  });

  it("8122:PvPDurationIndex 优先(4s 而非 8s)、CD 30s", () => {
    expect(mined["8122"].durationSeconds).toBe(4);
    expect(mined["8122"].cooldownSeconds).toBe(30);
  });

  it("190319:CategoryRecoveryTime 作 CD(120s)、时长 10s", () => {
    expect(mined["190319"].cooldownSeconds).toBe(120);
    expect(mined["190319"].durationSeconds).toBe(10);
  });

  it("1714:dispelType Curse;非驱散值不产出 dispelType", () => {
    expect(mined["1714"].dispelType).toBe("Curse");
    expect(mined["108271"].dispelType).toBeUndefined();
  });

  it("108271:charges {2, 20s} 经 ChargeCategory→SpellCategory", () => {
    expect(mined["108271"].charges).toEqual({
      charges: 2,
      chargeCooldownSeconds: 20,
    });
    expect(mined["108271"].durationSeconds).toBe(6);
  });

  it("GCD 伪影(≤1.5s)不产出 cooldownSeconds", () => {
    const gcdCsv = {
      ...csv,
      spellCooldowns: [
        {
          ID: "9",
          DifficultyID: "0",
          CategoryRecoveryTime: "1500",
          RecoveryTime: "0",
          StartRecoveryTime: "1500",
          AuraSpellID: "0",
          SpellID: "1714",
        },
      ],
    };
    const m = mineSpellEffects(gcdCsv, new Set(["1714"]));
    expect(m["1714"].cooldownSeconds).toBeUndefined();
  });

  it("无 name 的候选被跳过", () => {
    const m = mineSpellEffects(csv, new Set(["999999"]));
    expect(m["999999"]).toBeUndefined();
  });
});

describe("collectCandidateIds", () => {
  it("并集含策展目录、真实天赋树与 PvpTalent 固件", () => {
    const ids = collectCandidateIds(fx("PvpTalent"));
    expect(ids.has("212182")).toBe(true); // PvpTalent 固件
    expect(ids.has("289655")).toBe(true);
    expect(ids.has("408")).toBe(true); // drCategories stun
    expect(ids.has("33206")).toBe(true); // spellIdLists external
    expect(ids.size).toBeGreaterThan(500); // 真实 talentIdMap actives
  });
});
