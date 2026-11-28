import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Build, Item } from '@webpob/core';
import {
  analyzeBuildDiagnostics,
  createEmptyCalcOutput,
  resolveItemEffectiveStats,
} from './lite.js';

describe('@webpob/calc/lite entry', () => {
  it('provides createEmptyCalcOutput, analyzeBuildDiagnostics, and resolveItemEffectiveStats', () => {
    const empty = createEmptyCalcOutput('poe1');
    expect(empty.game).toBe('poe1');
    expect(empty.offence.totalDps).toBe(0);
    expect(empty.defence.life).toBe(0);

    const minimalBuild = {
      id: 'lite-test',
      name: 'Lite Test',
      game: 'poe1',
      level: 90,
      classId: 'witch',
      activeWeaponSet: 1,
      tree: {
        allocatedNodeIds: [],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
      },
      skills: [],
      items: {},
      equipped: {},
      config: {
        enemyLevel: 84,
        enemyIsBoss: 'Pinnacle',
        customMods: '',
      },
      notes: '',
    } as unknown as Build;

    const diags = analyzeBuildDiagnostics(minimalBuild, empty);
    expect(Array.isArray(diags)).toBe(true);

    const item: Item = {
      id: 'w1',
      name: 'Test Sword',
      baseName: 'Jeweled Foil',
      rarity: 'RARE',
      slotType: 'Weapon 1',
      quality: 20,
      implicits: [],
      explicits: ['100% increased Physical Damage'],
      weaponStats: {
        physicalMin: 30,
        physicalMax: 60,
        attacksPerSecond: 1.6,
        critChance: 5.5,
        weaponType: 'Sword',
        twoHanded: false,
      },
    };
    const resolved = resolveItemEffectiveStats(item, 'poe1');
    expect(resolved.weaponStats).toBeDefined();
    expect(resolved.weaponStats!.physicalMin).toBe(30);
    expect(resolved.weaponStats!.physicalMax).toBe(60);
  });

  it('has zero static imports of heavy engine or modParser modules', () => {
    const liteSrc = fs.readFileSync(path.resolve(__dirname, 'lite.ts'), 'utf8');
    const diagSrc = fs.readFileSync(path.resolve(__dirname, 'diagnostics.ts'), 'utf8');
    const localSrc = fs.readFileSync(path.resolve(__dirname, 'localItem.ts'), 'utf8');
    const combined = `${liteSrc}\n${diagSrc}\n${localSrc}`;
    expect(combined).not.toMatch(/from\s+['"]\.\/(?:engine|modParser|modParserPoe1|modParserPoe2|compositionalModParser|ascendancyMods|clusterAndReservation|timelessAndTattooRuntime|uniqueMechanicsRuntime|skillActorRuntime)/);
  });
});
