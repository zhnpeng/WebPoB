import { describe, expect, it } from 'vitest';
import type { Build, Item } from '@webpob/core';
import { createDefaultConfig } from '@webpob/data';
import { calculateBuild } from './engine.js';

function makeBasePoe2Build(items: Record<string, Item>, equipped: Build['equipped']): Build {
  return {
    id: 'test_wegame_mechanics',
    name: 'WeGame Mechanics Regression',
    game: 'poe2',
    level: 90,
    classId: 'Mercenary',
    ascendancyId: 'Gemling Legionnaire',
    activeWeaponSet: 1,
    bandit: 'None',
    tree: {
      title: 'Empty',
      treeVersion: '0_5',
      allocatedNodeIds: [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
    },
    skills: [],
    mainSkillGroupId: '',
    items,
    equipped,
    config: createDefaultConfig(),
    notes: '',
  };
}

describe('PoE 2 WeGame CN mechanics regressions', () => {
  it('applies less maximum Life, signed negative max resist, and Your Maximum Resistances override', () => {
    const baseOut = calculateBuild(makeBasePoe2Build({}, {}));

    const items: Record<string, Item> = {
      wand: {
        id: 'wand',
        name: "Runeseeker's Call",
        baseName: 'Runic Fork',
        rarity: 'UNIQUE',
        slotType: 'Weapon 1',
        quality: 20,
        implicits: ['45% less maximum Life'],
        explicits: [],
      },
      amulet: {
        id: 'amulet',
        name: 'Cap Amulet',
        baseName: 'Gold Amulet',
        rarity: 'RARE',
        slotType: 'Amulet',
        quality: 0,
        implicits: [],
        explicits: [
          'Your Maximum Resistances are 79%',
          '+200% to all Elemental Resistances',
          '+200% to Chaos Resistance',
        ],
      },
    };

    const modOut = calculateBuild(makeBasePoe2Build(items, { 'Weapon 1': 'wand', Amulet: 'amulet' }));
    expect(modOut.defence.life).toBe(Math.round(baseOut.defence.life * 0.55));
    expect(modOut.defence.fireResist).toBe(79);
    expect(modOut.defence.coldResist).toBe(79);
    expect(modOut.defence.lightningResist).toBe(79);
    expect(modOut.defence.chaosResist).toBe(79);
  });

  it('unlocks Bonded modifiers per-item via Fox Idol even on non-Shaman ascendancies', () => {
    const bodyWithoutFox: Item = {
      id: 'body',
      name: 'Test Chest',
      baseName: 'Grand Regalia',
      rarity: 'UNIQUE',
      slotType: 'Body Armour',
      quality: 20,
      implicits: ['Bonded: +100 to maximum Life'],
      explicits: [],
    };
    const bodyWithFox: Item = {
      ...bodyWithoutFox,
      implicits: [
        'Idols socketed in this item gain the benefits of their Bonded modifiers',
        'Bonded: +100 to maximum Life',
      ],
    };

    const withoutFox = calculateBuild(makeBasePoe2Build({ body: bodyWithoutFox }, { 'Body Armour': 'body' }));
    const withFox = calculateBuild(makeBasePoe2Build({ body: bodyWithFox }, { 'Body Armour': 'body' }));
    // +100 flat maximum Life * (1 + 5% PoE 2 campaign baseline inc Life) = +105
    expect(withFox.defence.life - withoutFox.defence.life).toBe(105);
  });

  it("evaluates Estra's Path per equipped item with a Lightning Resistance modifier", () => {
    const items: Record<string, Item> = {
      ring1: {
        id: 'ring1',
        name: "Estra's Path",
        baseName: 'Ring',
        rarity: 'UNIQUE',
        slotType: 'Ring 1',
        quality: 0,
        implicits: [],
        explicits: [
          '+10% to Fire and Cold Resistances per Equipped Item with a Lightning Resistance Modifier',
        ],
      },
      helm: {
        id: 'helm',
        name: 'Res Helm',
        baseName: 'Gold Circlet',
        rarity: 'RARE',
        slotType: 'Helmet',
        quality: 0,
        implicits: [],
        explicits: ['+30% to Lightning Resistance'],
      },
      boots: {
        id: 'boots',
        name: 'Res Boots',
        baseName: 'Silk Slippers',
        rarity: 'RARE',
        slotType: 'Boots',
        quality: 0,
        implicits: [],
        explicits: ['+15% to all Elemental Resistances'],
      },
    };

    const baseOut = calculateBuild(
      makeBasePoe2Build(
        { helm: items.helm!, boots: items.boots! },
        { Helmet: 'helm', Boots: 'boots' },
      ),
    );
    const estraOut = calculateBuild(
      makeBasePoe2Build(items, { 'Ring 1': 'ring1', Helmet: 'helm', Boots: 'boots' }),
    );
    // 2 equipped items with Lightning Resistance (helm + boots) * +10% = +20% Fire & Cold Resistance
    expect(estraOut.defence.fireResist - baseOut.defence.fireResist).toBe(20);
    expect(estraOut.defence.coldResist - baseOut.defence.coldResist).toBe(20);
  });
});
