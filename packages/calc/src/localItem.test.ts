import { describe, expect, it } from 'vitest';
import type { Item } from '@webpob/core';
import { registerPoe2RunesData } from '@webpob/data';
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

  it('scales local shield % increased Block chance (both precomputed without header and uncomputed) while keeping non-shield Block global', () => {
    // 1. PoE 2 shield with localStatsPrecomputed=false (Chernobog's Pillar style: base 26, 27% inc Block -> floor(26 * 1.27) = 33)
    const chernobog: Item = {
      id: 'sh1',
      name: "Chernobog's Pillar",
      baseName: 'Blacksteel Tower Shield',
      rarity: 'UNIQUE',
      slotType: 'Weapon 2',
      quality: 20,
      localStatsPrecomputed: false,
      armourStats: { armour: 180, blockChance: 26 },
      implicits: [],
      explicits: ['27% increased Block chance', '100% increased Armour'],
    };
    const res1 = resolveItemEffectiveStats(chernobog, 'poe2');
    expect(res1.armourStats?.blockChance).toBe(33);
    expect(res1.globalExplicits).not.toContain('27% increased Block chance');

    // 2. PoE 1 shield with localStatsPrecomputed=true (Armour header present, NO Chance to Block header -> scales base block locally)
    const poe1Shield: Item = {
      id: 'sh2',
      name: 'Rift Ward',
      baseName: 'Heat-attuned Tower Shield',
      rarity: 'RARE',
      slotType: 'Weapon 2',
      quality: 20,
      localStatsPrecomputed: true,
      armourStats: { armour: 400, blockChance: 29 },
      implicits: [],
      explicits: ['79% increased Chance to Block', '+60 to maximum Life'],
      rawText: 'Rarity: RARE\nRift Ward\nHeat-attuned Tower Shield\nArmour: 400\nQuality: 20',
    };
    const res2 = resolveItemEffectiveStats(poe1Shield, 'poe1');
    // floor(29 * 1.79) = 51; line must NOT leak into globalExplicits
    expect(res2.armourStats?.blockChance).toBe(51);
    expect(res2.globalExplicits).toEqual(['+60 to maximum Life']);

    // 3. Shield WITH explicit Chance to Block header keeps precomputed header value without double-scaling
    const preBlockShield: Item = {
      ...poe1Shield,
      id: 'sh3',
      armourStats: { armour: 400, blockChance: 51 },
      rawText: 'Rarity: RARE\nRift Ward\nHeat-attuned Tower Shield\nChance to Block: 51%\nArmour: 400',
    };
    const res3 = resolveItemEffectiveStats(preBlockShield, 'poe1');
    expect(res3.armourStats?.blockChance).toBe(51);

    // 4. Non-shield Body Armour keeps global "% increased Block chance" in globalExplicits
    const bodyWithBlock: Item = {
      id: 'b-blk',
      name: 'Warden Plate',
      baseName: 'Full Plate',
      rarity: 'RARE',
      slotType: 'Body Armour',
      quality: 0,
      localStatsPrecomputed: false,
      armourStats: { armour: 200 },
      implicits: [],
      explicits: ['15% increased Chance to Block'],
    };
    const res4 = resolveItemEffectiveStats(bodyWithBlock, 'poe2');
    expect(res4.armourStats?.blockChance).toBeUndefined();
    expect(res4.globalExplicits).toEqual(['15% increased Chance to Block']);
  });

  it('keeps Iron Rune "Armour, Evasion and Energy Shield" from scaling Runic Ward while allowing "Defences" and Runeforged bases to compute Ward locally', () => {
    // 1. Runemastered Helmet with Iron Rune ("Armour, Evasion and Energy Shield") must NOT scale local Ward
    const starkonja: Item = {
      id: 'h-ward',
      name: "Starkonja's Head",
      baseName: 'Runemastered Leatherbound Hood',
      rarity: 'UNIQUE',
      slotType: 'Helmet',
      quality: 20,
      localStatsPrecomputed: false,
      armourStats: { evasion: 266, ward: 28 },
      implicits: ['18% increased Armour, Evasion and Energy Shield'],
      explicits: ['100% increased Evasion Rating'],
    };
    const rHelm = resolveItemEffectiveStats(starkonja, 'poe2');
    // Ward: round(28 * 1.0 * 1.20) = 34 (NOT round(28 * 1.18 * 1.20) = 40)
    expect(rHelm.armourStats?.ward).toBe(34);
    expect(rHelm.armourStats?.evasion).toBe(Math.round(266 * 2.18 * 1.2));

    // 2. Runeforged Champion Cuirass (no base armourStats, slotType='Any') still classifies as armour:
    //    consumes "528% increased Armour" locally (0 Armour) and computes local Runic Ward = round(892 * 1.60 * 1.20) = 1713
    const brassDomeRuneforged: Item = {
      id: 'bd-rf',
      name: 'The Brass Dome',
      baseName: 'Runeforged Champion Cuirass',
      rarity: 'UNIQUE',
      slotType: 'Any',
      quality: 20,
      localStatsPrecomputed: false,
      implicits: [
        '60% increased Runic Ward',
        'Bonded: Gain 6% of maximum Life as Extra maximum Runic Ward',
        '+892 to maximum Runic Ward',
      ],
      explicits: [
        '528% increased Armour',
        '-1% to all Maximum Elemental Resistances',
        'Take no Extra Damage from Critical Hits',
      ],
    };
    const rBody = resolveItemEffectiveStats(brassDomeRuneforged, 'poe2');
    expect(rBody.armourStats?.armour).toBeUndefined();
    expect(rBody.armourStats?.ward).toBe(1713);
    expect(rBody.globalExplicits).not.toContain('528% increased Armour');
    expect(rBody.globalImplicits).not.toContain('60% increased Runic Ward');
    expect(rBody.globalImplicits).not.toContain('+892 to maximum Runic Ward');
  });

  it('unlocks baked Idol Bonded lines (e.g. Fox Idol) when item grants socketed Idols their Bonded modifiers while keeping non-Idol Rune Bonded lines locked', () => {
    const darkness: Item = {
      id: 'belt-darkness',
      name: 'Darkness Enthroned',
      baseName: 'Fine Belt',
      rarity: 'UNIQUE',
      slotType: 'Belt',
      quality: 0,
      localStatsPrecomputed: false,
      runes: ['Fox Idol', 'Rune of the Blossom'],
      implicits: [
        '{enchant}{rune}+99 to Spirit',
        '{enchant}{rune}Bonded: +9% to Quality of all Skills',
        '{enchant}{rune}Bonded: 9% increased Spirit Reservation Efficiency',
        '{enchant}{rune}Idols socketed in this item gain the benefits of their Bonded modifiers',
      ],
      explicits: ['99% increased effect of Socketed Augment Items'],
    };

    const res = resolveItemEffectiveStats(darkness, 'poe2', { allowBonded: false });
    expect(res.globalImplicits).toContain('+9% to Quality of all Skills');
    expect(res.globalImplicits).toContain('{enchant}{rune}Bonded: 9% increased Spirit Reservation Efficiency');
  });

  it('injects PoE 2 Soul Core slot overrides (Atziri\'s Splendour) and scales unscaled Socketed Augment/Rune lines without double-scaling', () => {
    registerPoe2RunesData({
      version: '0_5',
      runes: {
        'Soul Core of Zalatl': {
          helmet: { type: 'SoulCore', lines: ['5% increased maximum Mana'] },
        },
        'Perfect Mind Rune': {
          armour: { type: 'Rune', lines: ['+50 to maximum Mana'], bonded: ['+20 to maximum Mana'] },
          staff: { type: 'Rune', lines: ['+90 to maximum Mana'], bonded: ['5% increased maximum Mana'] },
        },
      },
    });

    // 1. Atziri's Splendour: 6x Soul Core of Zalatl gains Helmet bonus (6 * 5% = 30% increased maximum Mana)
    const atziri: Item = {
      id: 'atziri-1',
      name: "Atziri's Splendour",
      baseName: 'Sacrificial Regalia',
      rarity: 'UNIQUE',
      slotType: 'Body Armour',
      quality: 20,
      localStatsPrecomputed: true,
      armourStats: { energyShield: 800 },
      runes: Array(6).fill('Soul Core of Zalatl'),
      implicits: ['+1 to Level of all Corrupted Skill Gems'],
      explicits: [
        'Only Soul Cores can be Socketed in this item',
        'This item gains bonuses from Socketed Soul Cores as though it was also a Helmet',
      ],
    };
    const resAtziri = resolveItemEffectiveStats(atziri, 'poe2');
    expect(resAtziri.globalImplicits.filter((l) => l === '5% increased maximum Mana')).toHaveLength(6);

    // 2. Boots with 60% increased effect of Socketed Augment Items and UNSCALED 3x Perfect Mind Rune (+150 -> +240)
    const boots: Item = {
      id: 'boots-1',
      name: 'Anarchy Pace',
      baseName: 'Luxurious Slippers',
      rarity: 'RARE',
      slotType: 'Boots',
      quality: 20,
      localStatsPrecomputed: true,
      armourStats: { energyShield: 250 },
      runes: ['Perfect Mind Rune', 'Perfect Mind Rune', 'Perfect Mind Rune'],
      implicits: ['+150 to maximum Mana'],
      explicits: ['60% increased effect of Socketed Augment Items'],
    };
    const resBoots = resolveItemEffectiveStats(boots, 'poe2');
    expect(resBoots.globalImplicits).toContain('+240 to maximum Mana');

    // 3. Staff with 200% increased effect of Socketed Runes and ALREADY-SCALED 3x Perfect Mind Rune (+810 stays +810)
    const staff: Item = {
      id: 'staff-1',
      name: "Runeseeker's Call",
      baseName: 'Runemastered Runic Fork',
      rarity: 'UNIQUE',
      slotType: 'Weapon 1',
      quality: 20,
      localStatsPrecomputed: true,
      weaponStats: { weaponType: 'Staff', twoHanded: true, physicalMin: 10, physicalMax: 20, attacksPerSecond: 1.2, critChance: 5 },
      runes: ['Perfect Mind Rune', 'Perfect Mind Rune', 'Perfect Mind Rune'],
      implicits: ['+810 to maximum Mana'],
      explicits: ['200% increased effect of Socketed Runes'],
    };
    const resStaff = resolveItemEffectiveStats(staff, 'poe2');
    expect(resStaff.globalImplicits).toContain('+810 to maximum Mana');
  });

  it('consumes PoE 1 Harvest Alternate Quality weapon enchants locally (no phys quality, local crit & attack speed per quality)', () => {
    const paradoxica: Item = {
      id: 'w-harvest-1',
      name: 'Paradoxica',
      baseName: 'Vaal Rapier',
      rarity: 'UNIQUE',
      slotType: 'Weapon 1',
      quality: 20,
      localStatsPrecomputed: false,
      weaponStats: {
        weaponType: 'Sword',
        twoHanded: false,
        physicalMin: 100,
        physicalMax: 200,
        attacksPerSecond: 1.3,
        critChance: 6.5,
      },
      implicits: [
        '{crafted}Quality does not increase Physical Damage',
        '{crafted}1% increased Critical Strike Chance per 4% Quality',
        '{crafted}1% increased Attack Speed per 8% Quality',
        '+25% to Global Critical Strike Multiplier',
      ],
      explicits: ['19% increased Attack Speed'],
    };

    const res = resolveItemEffectiveStats(paradoxica, 'poe1');
    // Quality does NOT scale physicalMin/Max (stays 100-200 instead of 120-240)
    expect(res.weaponStats?.physicalMin).toBe(100);
    expect(res.weaponStats?.physicalMax).toBe(200);
    // 20 / 4 = 5% local crit: round(6.5 * 1.05 * 100) / 100 = 6.83
    expect(res.weaponStats?.critChance).toBe(6.83);
    // 19% + floor(20 / 8) = 21% local attack speed: round(1.3 * 1.21 * 100) / 100 = 1.57
    expect(res.weaponStats?.attacksPerSecond).toBe(1.57);
    // None of the local Harvest quality lines leak into globalImplicits
    expect(res.globalImplicits).toEqual(['+25% to Global Critical Strike Multiplier']);
  });

  it('applies PoE 1 Harvest armour alternate quality enchants (disables Quality Defences scaling and expands Grants stat per N% Quality)', () => {
    const body: Item = {
      id: 'harvest-body',
      name: 'Bramble Shell',
      baseName: 'Synthetic Plate',
      rarity: 'RARE',
      slotType: 'Body Armour',
      quality: 20,
      localStatsPrecomputed: false,
      armourStats: { armour: 500 },
      implicits: [
        '{crafted}Quality does not increase Defences',
        '{crafted}Grants +1 to Strength per 2% Quality',
      ],
      explicits: ['100% increased Armour'],
    };

    const res = resolveItemEffectiveStats(body, 'poe1');
    // Quality does NOT scale Armour: 500 * 2.0 * 1.0 = 1000 (NOT 1200)
    expect(res.armourStats?.armour).toBe(1000);
    // Grants +1 to Strength per 2% Quality at Q20 -> +10 to Strength
    expect(res.globalImplicits).toEqual(['+10 to Strength']);
  });

  it('expands PoE 1 Harvest weapon Grants <stat> per <N>% Quality enchants into globalImplicits', () => {
    const weapon = mkWeapon({
      name: 'Tempest Wand',
      baseName: 'Imbued Wand',
      quality: 20,
      implicits: [
        '{crafted}Quality does not increase Physical Damage',
        '{crafted}Grants 1% increased Elemental Damage per 2% Quality',
        '{crafted}Grants 1% increased Accuracy per 2% Quality',
        '{crafted}Grants 1% increased Area of Effect per 4% Quality',
      ],
    });

    const res = resolveItemEffectiveStats(weapon, 'poe1');
    expect(res.globalImplicits).toEqual([
      '10% increased Elemental Damage',
      '10% increased Accuracy',
      '5% increased Area of Effect',
    ]);
  });

  it('consumes hybrid flat local armour mods (+N to Evasion Rating and Energy Shield) and Harvest local Weapon Range per Quality', () => {
    const hybridBody: Item = {
      id: 'hybrid-flat-body',
      name: 'Shadow Garb',
      baseName: 'Synthetic Garb',
      rarity: 'UNIQUE',
      slotType: 'Body Armour',
      quality: 20,
      localStatsPrecomputed: false,
      armourStats: { evasion: 400, energyShield: 100 },
      implicits: [],
      explicits: ['+150 to Evasion Rating and Energy Shield', '100% increased Evasion and Energy Shield'],
    };
    const aRes = resolveItemEffectiveStats(hybridBody, 'poe1');
    // (400 + 150) * 2.0 * 1.2 = 1320 Evasion; (100 + 150) * 2.0 * 1.2 = 600 ES
    expect(aRes.armourStats?.evasion).toBe(1320);
    expect(aRes.armourStats?.energyShield).toBe(600);
    expect(aRes.globalExplicits).toEqual([]);

    const rangeWeapon = mkWeapon({
      name: 'Reach Claw',
      baseName: 'Imperial Claw',
      quality: 20,
      implicits: ['{crafted}+0.1 metres to Weapon Range per 10% Quality'],
    });
    const wRes = resolveItemEffectiveStats(rangeWeapon, 'poe1');
    expect(wRes.globalImplicits).toEqual([]);
  });
});
