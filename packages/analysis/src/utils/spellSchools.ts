export const SpellSchoolNames: Record<number, string> = {
  1: 'Physical',
  2: 'Holy',
  4: 'Fire',
  8: 'Nature',
  16: 'Frost',
  32: 'Shadow',
  64: 'Arcane',
};

export function getSpellSchoolName(schoolMask: number | string | null | undefined): string | null {
  if (schoolMask === null || schoolMask === undefined) return null;
  // B115: combat-log school masks arrive as HEX strings (e.g. "0x20" = Shadow). parseInt(_, 10) stopped
  // at the "x" and returned 0, so every school tag was silently dropped (kill/spike lines never showed
  // [Magic]/[Physical]). Number() parses both "0x20"→32 and "32"→32 and numeric 32.
  const mask = typeof schoolMask === 'string' ? Number(schoolMask) : schoolMask;
  if (isNaN(mask) || mask <= 0) return null;

  const activeSchools: string[] = [];

  // Check each bit (1, 2, 4, 8, 16, 32, 64)
  for (let bit = 1; bit <= 64; bit *= 2) {
    if ((mask & bit) === bit) {
      if (SpellSchoolNames[bit]) {
        activeSchools.push(SpellSchoolNames[bit]);
      }
    }
  }

  if (activeSchools.length === 0) return null;

  // Single school
  if (activeSchools.length === 1) {
    return activeSchools[0];
  }

  // Multi-school mapping
  if (mask === 124 || mask === 127 || mask === 126) return 'Chaos';

  // 2 schools
  if (activeSchools.length === 2) {
    if (activeSchools.includes('Fire') && activeSchools.includes('Frost')) return 'Frostfire';
    if (activeSchools.includes('Shadow') && activeSchools.includes('Frost')) return 'Shadowfrost';
    if (activeSchools.includes('Shadow') && activeSchools.includes('Fire')) return 'Shadowflame';
    if (activeSchools.includes('Nature') && activeSchools.includes('Fire')) return 'Volcanic';
    if (activeSchools.includes('Holy') && activeSchools.includes('Fire')) return 'Radiant';
    if (activeSchools.includes('Nature') && activeSchools.includes('Shadow')) return 'Plague';
    if (activeSchools.includes('Arcane') && activeSchools.includes('Fire')) return 'Spellfire';
    if (activeSchools.includes('Holy') && activeSchools.includes('Shadow')) return 'Twilight';
    if (activeSchools.includes('Arcane') && activeSchools.includes('Frost')) return 'Spellfrost';
  }

  return activeSchools.join('/');
}
