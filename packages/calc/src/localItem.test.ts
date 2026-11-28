import { describe, expect, it } from 'vitest';
import type { Item } from '@webpob/core';
import { resolveItemEffectiveStats } from './localItem.js';

function mkWeapon(partial: Partial<Item> & Pick<Item, 'name' | 'baseName'>): Item {
  return {
    id: 'w1',
    rarity: 'RARE',
    slotType: 'Weapon 1',
    quality: 20,
    implicits: [],
    explicits: [],
    localStatsPrecomputed: false,
    weaponStats: {
      physicalMin: 77,
      physicalMax: 105,
      attacksPerSecond: 1.1,
      critChance: 5,
      weaponType: 'Mace',
      twoHanded: true,
    },
    ...partial,
  };
}

describe('localItem — resolveItemEffectiveStats', () => {
  it('keeps "increased Elemental Damage with Attacks" and "with Attack Skills" strictly global on weapons', () => {
    const hateCrusher = mkWeapon({
      name: 'Hate Crusher',
      baseName: 'Totemic Greatclub',
      quality: 20,
      implicits: ['Crushes Enemies on Hit'],
      explicits: [
        '74% increased Physical Damage',
        'Adds 70 to 104 Fire Damage',
        '83% increased Elemental Damage with Attacks',
        '42% increased Elemental Damage with Attack Skills',
        '20% increased Attack Speed',
        '+4 to Level of all Melee Skills',
      ],
    });

    const res = resolveItemEffectiveStats(hateCrusher, 'poe2');

    // Exact PoB 2 local phys: round(77 * 1.74 * 1.20) = 161, round(105 * 1.74 * 1.20) = 219
    expect(res.weaponStats?.physicalMin).toBe(161);
    expect(res.weaponStats?.physicalMax).toBe(219);
    expect(res.weaponStats?.attacksPerSecond).toBe(1.32);
    // Local Fire damage must remain unscaled 70-104 (WED must NEVER scale local weapon ele!)
    expect(res.weaponStats?.elementalDamage).toEqual({ Fire: [70, 104] });
    // WED lines must stay in globalExplicits
    expect(res.globalExplicits).toContain('83% increased Elemental Damage with Attacks');
    expect(res.globalExplicits).toContain('42% increased Elemental Damage with Attack Skills');
    expect(res.globalExplicits).toContain('+4 to Level of all Melee Skills');
    // Local mods must not leak into globalExplicits
    expect(res.globalExplicits).not.toContain('74% increased Physical Damage');
    expect(res.globalExplicits).not.toContain('Adds 70 to 104 Fire Damage');
    expect(res.globalExplicits).not.toContain('20% increased Attack Speed');
  });

  it('keeps Global / to Attacks / to Spells / for Spells weapon mods strictly global', () => {
    const wand = mkWeapon({
      name: 'Storm Wand',
      baseName: 'Attuned Wand',
      quality: 0,
      weaponStats: {
        physicalMin: 10,
        physicalMax: 20,
        attacksPerSecond: 1.5,
        critChance: 8,
        weaponType: 'Wand',
        twoHanded: false,
      },
      explicits: [
        'Adds 15 to 30 Lightning Damage to Attacks',
        'Adds 20 to 40 Cold Damage to Spells',
        '50% increased Global Physical Damage',
        '40% increased Critical Strike Chance for Spells',
        '25% increased Critical Hit Chance',
      ],
    });

    const res = resolveItemEffectiveStats(wand, 'poe2');

    expect(res.weaponStats?.physicalMin).toBe(10);
    expect(res.weaponStats?.physicalMax).toBe(20);
    expect(res.weaponStats?.elementalDamage).toBeUndefined();
    expect(res.weaponStats?.critChance).toBe(10); // 8 * 1.25 = 10
    expect(res.globalExplicits).toEqual([
      'Adds 15 to 30 Lightning Damage to Attacks',
      'Adds 20 to 40 Cold Damage to Spells',
      '50% increased Global Physical Damage',
      '40% increased Critical Strike Chance for Spells',
    ]);
  });

  it('applies multiplicative quality on local armour defences and respects allowBonded', () => {
    const body: Item = {
      id: 'b1',
      name: 'Iron Plate',
      baseName: 'Full Plate',
      rarity: 'RARE',
      slotType: 'Body Armour',
      quality: 20,
      localStatsPrecomputed: false,
      armourStats: { armour: 200 },
      implicits: ['Bonded: 20% increased Armour'],
      explicits: ['+100 to Armour', '50% increased Armour', '+80 to maximum Life'],
    };

    const withoutBonded = resolveItemEffectiveStats(body, 'poe2', { allowBonded: false });
    // (200 + 100) * 1.5 * 1.2 = 540
    expect(withoutBonded.armourStats?.armour).toBe(540);
    expect(withoutBonded.globalImplicits).toEqual(['Bonded: 20% increased Armour']);
    expect(withoutBonded.globalExplicits).toEqual(['+80 to maximum Life']);

    const withBonded = resolveItemEffectiveStats(body, 'poe2', { allowBonded: true });
    // (200 + 100) * 1.7 * 1.2 = 612
    expect(withBonded.armourStats?.armour).toBe(612);
    expect(withBonded.globalImplicits).toEqual([]);
  });
});
