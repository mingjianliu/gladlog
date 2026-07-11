export function transformSpellNames(csv: string): Record<string, string> {
  const lines = csv.split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("ID,")) continue;
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex === -1) continue;
    const id = trimmed.substring(0, commaIndex).trim();
    let name = trimmed.substring(commaIndex + 1).trim();
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }
    result[id] = name;
  }
  return result;
}
