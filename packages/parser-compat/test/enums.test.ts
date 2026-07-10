import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import * as Enums from '../src/enums';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../data/legacy-enum-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

function getEnumMemberNames(tsEnum: any): string[] {
  return Object.keys(tsEnum).filter(key => isNaN(Number(key)));
}

describe('Legacy Enum Compatibility', () => {
  it('should match the manifest exactly for LogEvent', () => {
    const manifestEnum = manifest.LogEvent;
    const tsEnum = Enums.LogEvent;

    expect(getEnumMemberNames(tsEnum).length).toBe(51);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatUnitSpec', () => {
    const manifestEnum = manifest.CombatUnitSpec;
    const tsEnum = Enums.CombatUnitSpec;

    expect(getEnumMemberNames(tsEnum).length).toBe(41);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatUnitClass', () => {
    const manifestEnum = manifest.CombatUnitClass;
    const tsEnum = Enums.CombatUnitClass;

    expect(getEnumMemberNames(tsEnum).length).toBe(14);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatUnitReaction', () => {
    const manifestEnum = manifest.CombatUnitReaction;
    const tsEnum = Enums.CombatUnitReaction;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatUnitType', () => {
    const manifestEnum = manifest.CombatUnitType;
    const tsEnum = Enums.CombatUnitType;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatResult', () => {
    const manifestEnum = manifest.CombatResult;
    const tsEnum = Enums.CombatResult;

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      expect((tsEnum as any)[key]).toBe(manifestVal);
    }
  });

  it('should match the manifest exactly for CombatUnitPowerType', () => {
    const manifestEnum = manifest.CombatUnitPowerType;
    const tsEnum = Enums.CombatUnitPowerType;

    expect(getEnumMemberNames(tsEnum).length).toBe(22);

    for (const key of Object.keys(manifestEnum)) {
      const manifestVal = manifestEnum[key];
      // Convert to number because manifest has string values for CombatUnitPowerType (e.g. "-2")
      const expectedVal = Number(manifestVal);
      expect((tsEnum as any)[key]).toBe(expectedVal);
    }
  });
});
