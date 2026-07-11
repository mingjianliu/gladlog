import { writeArtifact } from "./lib/emit";

export function validateTalentData(
  data: unknown,
  opts?: { minSpecs?: number; minSpellEntries?: number },
): void {
  if (!Array.isArray(data)) {
    throw new Error("Data must be an array");
  }

  const minSpecs = opts?.minSpecs ?? 30;
  if (data.length < minSpecs) {
    throw new Error(
      `Data length (${data.length}) is less than required ${minSpecs}`,
    );
  }

  const requiredArrays = [
    "classNodes",
    "specNodes",
    "heroNodes",
    "subTreeNodes",
  ] as const;

  for (const item of data) {
    if (!item || typeof item !== "object") {
      throw new Error("Spec data item is not an object");
    }

    if (typeof (item as any).specId !== "number") {
      throw new Error("specId must be a number");
    }

    for (const key of requiredArrays) {
      if (!(key in item)) {
        throw new Error(`Missing key: ${key}`);
      }
      if (!Array.isArray((item as any)[key])) {
        throw new Error(`Key '${key}' is not an array`);
      }
    }
  }

  // 聚合校验(节点类型多样,逐点结构抽样对真实数据过脆):
  // 全量统计"有 spellId+name+icon 的 entry"总数,低于下限即拒。
  const minSpellEntries = opts?.minSpellEntries ?? 2000;
  let qualifying = 0;
  for (const item of data) {
    for (const key of requiredArrays) {
      for (const node of (item as any)[key]) {
        for (const entry of node?.entries ?? []) {
          if (
            typeof entry?.spellId === "number" &&
            typeof entry?.name === "string" &&
            entry.name.trim() !== "" &&
            typeof entry?.icon === "string" &&
            entry.icon.trim() !== ""
          ) {
            qualifying++;
          }
        }
      }
    }
  }
  if (qualifying < minSpellEntries) {
    throw new Error(
      `Only ${qualifying} qualifying spell entries (spellId+name+icon); required ${minSpellEntries}`,
    );
  }
}

export function writeTalentIdMap(filePath: string, data: unknown): void {
  writeArtifact(filePath, JSON.stringify(data, null, 2));
}

export async function main(): Promise<void> {
  const res = await fetch(
    "https://www.raidbots.com/static/data/live/talents.json",
  );
  if (!res.ok) {
    throw new Error(`Fetch failed with status ${res.status}`);
  }
  const data = await res.json();
  validateTalentData(data);
  const outPath = new URL("../../src/data/talentIdMap.json", import.meta.url)
    .pathname;
  writeTalentIdMap(outPath, data);
  console.log(data.length);
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1]?.endsWith("fetchTalents.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
