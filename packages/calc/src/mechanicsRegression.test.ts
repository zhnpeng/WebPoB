import { describe, expect, it } from 'vitest';
import { createSamplePoe1Build, createSamplePoe2Build } from '@webpob/data';
import {
  calculateBuild,
  canWieldTwoHandedMartialInOneHand,
  canWieldWeaponInOneHand,
  hasCantUseBodyArmour,
  resolvePoe2ItemLocalRuneLines,
} from './index.js';
import type { Build, Item } from '@webpob/core';

/**
 * Mechanism-Layer Regression Suite (modeled on upstream PoB `spec/System/`).
 *
 * Rules:
 * - Keep every test minimal, isolated, and deterministic (zero network / external files).
 * - Whenever a calculation, mod-parsing, equipment-slot, or unique-mechanic bug is fixed,
 *   add a dedicated regression case here in addition to any Golden Oracle snapshot.
 */

function makeWeapon(overrides: Partial<Item> & { id: string }): Item {
  return {
    name: 'Test Weapon',
    baseName: 'Vaal Axe',
    rarity: 'RARE',
    slotType: 'Weapon 1',
    quality: 20,
    weaponStats: {
      weaponType: 'Axe',
      twoHanded: false,
      physicalMin: 100,
      physicalMax: 200,
      attacksPerSecond: 1.5,
      critChance: 5,
    },
    implicits: [],
    explicits: [],
    ...overrides,
  };
}

function withCustomMods(build: Build, customMods: string): Build {
  return {
    ...build,
    config: {
      ...build.config,
      customMods,
    },
  };
}

describe('Mechanism-Layer Regression Suite (PoE 1 & PoE 2)', () => {
  describe('1. Equipment & Special Slot Mechanics', () => {
    it('PoE 2 The Bringer of Rain (祭礼之雨): unlocks 2H Axe/Mace/Sword in 1H, disables Body Armour, and resolves runes as Body Armour', () => {
      const base = createSamplePoe2Build();
      const mace1 = makeWeapon({
        id: 'reg_mace1',
        name: 'Maul One',
        baseName: 'Aberrant Sledge',
        weaponStats: { weaponType: 'Mace', twoHanded: true, physicalMin: 100, physicalMax: 180, attacksPerSecond: 1.1, critChance: 5 },
      });
      const mace2 = makeWeapon({
        id: 'reg_mace2',
        name: 'Maul Two',
        baseName: 'Cultist Greathammer',
        weaponStats: { weaponType: 'Mace', twoHanded: true, physicalMin: 220, physicalMax: 360, attacksPerSecond: 1.7, critChance: 5 },
      });
      const chest: Item = {
        id: 'reg_chest',
        name: 'Disabled Plate',
        baseName: 'Iron Cuirass',
        rarity: 'RARE',
        slotType: 'Body Armour',
        quality: 20,
        armourStats: { armour: 800 },
        implicits: [],
        explicits: ['+250 to maximum Life', '+40% to Fire Resistance'],
      };
      const bringer: Item = {
        id: 'reg_bringer',
        name: 'The Bringer of Rain',
        nameZh: '祭礼之雨',
        baseName: 'Decorated Helm',
        rarity: 'UNIQUE',
        slotType: 'Helmet',
        quality: 20,
        armourStats: { armour: 146, evasion: 132 },
        implicits: [],
        explicits: [
          '700% increased Armour and Evasion',
          "Can't use Body Armour",
          'You can wield Two-Handed Axes, Maces and Swords in one hand',
          'This item gains bonuses from Socketed Items as though it was a Body Armour',
        ],
      };

      const attackGroup = {
        id: 'sg_attack',
        label: 'Hammer',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'g1', gemId: 'poe2_hammer_of_the_gods', level: 20, quality: 0, enabled: true }],
      };

      const withoutBringer: Build = {
        ...base,
        items: { ...base.items, [mace1.id]: mace1, [mace2.id]: mace2, [chest.id]: chest },
        equipped: { ...base.equipped, 'Weapon 1': mace1.id, 'Weapon 2': mace2.id, 'Body Armour': chest.id },
        skills: [attackGroup],
        mainSkillGroupId: attackGroup.id,
      };
      delete withoutBringer.equipped.Helmet;

      const withBringer: Build = {
        ...withoutBringer,
        items: { ...withoutBringer.items, [bringer.id]: bringer },
        equipped: { ...withoutBringer.equipped, Helmet: bringer.id },
      };

      expect(canWieldTwoHandedMartialInOneHand(withoutBringer)).toBe(false);
      expect(canWieldTwoHandedMartialInOneHand(withBringer)).toBe(true);
      expect(hasCantUseBodyArmour(withoutBringer)).toBe(false);
      expect(hasCantUseBodyArmour(withBringer)).toBe(true);

      // Non-martial 2H weapons remain two-handed even with Bringer of Rain
      expect(canWieldWeaponInOneHand({ weaponType: 'Mace', twoHanded: true }, true)).toBe(true);
      expect(canWieldWeaponInOneHand({ weaponType: 'Axe', twoHanded: true }, true)).toBe(true);
      expect(canWieldWeaponInOneHand({ weaponType: 'Sword', twoHanded: true }, true)).toBe(true);
      expect(canWieldWeaponInOneHand({ weaponType: 'Bow', twoHanded: true }, true)).toBe(false);
      expect(canWieldWeaponInOneHand({ weaponType: 'Crossbow', twoHanded: true }, true)).toBe(false);
      expect(canWieldWeaponInOneHand({ weaponType: 'Quarterstaff', twoHanded: true }, true)).toBe(false);
      expect(canWieldWeaponInOneHand({ weaponType: 'Staff', twoHanded: true }, true)).toBe(false);

      const outWithout = calculateBuild(withoutBringer);
      const outWith = calculateBuild(withBringer);

      // Dual-wielding both 2H maces raises speed & average hit
      expect(outWith.offence.speed).toBeGreaterThan(outWithout.offence.speed);
      expect(outWith.offence.averageHit).toBeGreaterThan(outWithout.offence.averageHit);
      // Chest (+250 Life, +40% Fire Res) is disabled by Bringer of Rain
      expect(outWith.defence.life).toBeLessThan(outWithout.defence.life - 200);
      expect(outWith.defence.fireResist).toBeLessThan(outWithout.defence.fireResist);

      // Socketed rune resolution helper executes cleanly on Bringer of Rain
      const runeLines = resolvePoe2ItemLocalRuneLines('Helmet', bringer);
      expect(Array.isArray(runeLines)).toBe(true);
    });

    it("PoE 1 The Bringer of Rain: disables Body Armour ('Can't use Chest armour')", () => {
      const base = createSamplePoe1Build();
      const chest: Item = {
        id: 'poe1_chest',
        name: 'Life Chest',
        baseName: 'Astral Plate',
        rarity: 'RARE',
        slotType: 'Body Armour',
        quality: 20,
        armourStats: { armour: 700 },
        implicits: [],
        explicits: ['+180 to maximum Life', '+45% to Cold Resistance'],
      };
      const bringerPoe1: Item = {
        id: 'poe1_bringer',
        name: 'The Bringer of Rain',
        baseName: 'Nightmare Bascinet',
        rarity: 'UNIQUE',
        slotType: 'Helmet',
        quality: 20,
        armourStats: { armour: 200, evasion: 200 },
        implicits: [],
        explicits: ["Can't use Chest armour"],
      };

      const withChestOnly: Build = {
        ...base,
        items: { ...base.items, [chest.id]: chest },
        equipped: { ...base.equipped, 'Body Armour': chest.id },
      };
      delete withChestOnly.equipped.Helmet;

      const withBringer: Build = {
        ...withChestOnly,
        items: { ...withChestOnly.items, [bringerPoe1.id]: bringerPoe1 },
        equipped: { ...withChestOnly.equipped, Helmet: bringerPoe1.id },
      };

      expect(hasCantUseBodyArmour(withBringer)).toBe(true);
      const outNoBringer = calculateBuild(withChestOnly);
      const outBringer = calculateBuild(withBringer);
      expect(outBringer.defence.life).toBeLessThan(outNoBringer.defence.life - 150);
    });

    it('PoE 1 Dual Wielding grants inherent 10% more Attack Speed and 20% Attack Block', () => {
      const base = createSamplePoe1Build();
      const sword1 = makeWeapon({
        id: 'dw_s1',
        name: 'Foil One',
        baseName: 'Jewelled Foil',
        weaponStats: { weaponType: 'Sword', twoHanded: false, physicalMin: 100, physicalMax: 200, attacksPerSecond: 1.6, critChance: 5.5 },
      });
      const sword2 = makeWeapon({
        id: 'dw_s2',
        name: 'Foil Two',
        baseName: 'Jewelled Foil',
        weaponStats: { weaponType: 'Sword', twoHanded: false, physicalMin: 100, physicalMax: 200, attacksPerSecond: 1.6, critChance: 5.5 },
      });
      const strikeGroup = {
        id: 'sg_strike',
        label: 'Cyclone',
        enabled: true,
        gems: [{ instanceId: 'g_hs', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
      };

      const singleHand: Build = {
        ...base,
        items: { ...base.items, [sword1.id]: sword1, [sword2.id]: sword2 },
        equipped: { ...base.equipped, 'Weapon 1': sword1.id },
        skills: [strikeGroup],
        mainSkillGroupId: strikeGroup.id,
      };
      delete singleHand.equipped['Weapon 2'];

      const dualWield: Build = {
        ...singleHand,
        equipped: { ...singleHand.equipped, 'Weapon 2': sword2.id },
      };

      const out1H = calculateBuild(singleHand);
      const outDW = calculateBuild(dualWield);

      expect(outDW.offence.speed / out1H.offence.speed).toBeCloseTo(1.1, 2);
      expect(outDW.defence.blockChance - out1H.defence.blockChance).toBeGreaterThanOrEqual(20);
    });

    it("Kalandra's Touch mirrors opposite Ring stats and does not infinitely recurse when double-equipped", () => {
      const base = createSamplePoe1Build();
      const bigRing: Item = {
        id: 'ring_big',
        name: 'Big Ring',
        baseName: 'Two-Stone Ring',
        rarity: 'RARE',
        slotType: 'Ring 1',
        quality: 0,
        implicits: [],
        explicits: ['+80 to maximum Life', '+40% to Fire Resistance'],
      };
      const kalandra: Item = {
        id: 'ring_kalandra',
        name: "Kalandra's Touch",
        nameZh: '卡兰德之触',
        baseName: 'Ring',
        rarity: 'UNIQUE',
        slotType: 'Ring 1',
        quality: 0,
        implicits: [],
        explicits: ['Reflects your other Ring'],
      };
      const kalandra2: Item = { ...kalandra, id: 'ring_kalandra_2' };

      const oneRing: Build = {
        ...base,
        items: { ...base.items, [bigRing.id]: bigRing, [kalandra.id]: kalandra, [kalandra2.id]: kalandra2 },
        equipped: { ...base.equipped, 'Ring 1': bigRing.id },
      };
      delete oneRing.equipped['Ring 2'];

      const mirrored: Build = { ...oneRing, equipped: { ...oneRing.equipped, 'Ring 2': kalandra.id } };
      const doubleKalandra: Build = {
        ...oneRing,
        equipped: { ...oneRing.equipped, 'Ring 1': kalandra.id, 'Ring 2': kalandra2.id },
      };

      const outOne = calculateBuild(oneRing);
      const outMirrored = calculateBuild(mirrored);
      const outDouble = calculateBuild(doubleKalandra);

      expect(outMirrored.defence.life - outOne.defence.life).toBeGreaterThanOrEqual(80);
      expect(Number.isFinite(outDouble.defence.life)).toBe(true);
    });
  });

  describe('2. Defence Keystones, Pools & Hard Caps', () => {
    it('Chaos Inoculation locks Life to 1 and Chaos Resistance to 100% even with negative chaos res mods', () => {
      const base = createSamplePoe1Build();
      const out = calculateBuild(
        withCustomMods(base, 'Maximum Life becomes 1, Immune to Chaos Damage\n-80% to Chaos Resistance'),
      );
      expect(out.defence.life).toBe(1);
      expect(out.defence.chaosResist).toBe(100);
    });

    it('Iron Reflexes converts 100% of Evasion Rating into Armour and zeroes Evasion', () => {
      const base = createSamplePoe1Build();
      const withEva = calculateBuild(withCustomMods(base, '+2000 to Evasion Rating'));
      const withIr = calculateBuild(
        withCustomMods(base, '+2000 to Evasion Rating\nConverts all Evasion Rating to Armour'),
      );
      expect(withEva.defence.evasion).toBeGreaterThan(1500);
      expect(withIr.defence.evasion).toBe(0);
      expect(withIr.defence.armour).toBeGreaterThan(withEva.defence.armour + 1500);
    });

    it('Blood Magic removes all Mana (Mana === 0)', () => {
      const base = createSamplePoe1Build();
      const out = calculateBuild(
        withCustomMods(base, 'Removes all mana\nSkills Cost Life instead of Mana'),
      );
      expect(out.defence.mana).toBe(0);
    });

    it('Mind Over Matter increases Effective Hit Pool when Mana pool is available', () => {
      const base = createSamplePoe1Build();
      const noAuras: Build = {
        ...base,
        skills: base.skills.map((g) => (g.id === base.mainSkillGroupId ? g : { ...g, enabled: false })),
      };
      const noMom = calculateBuild(withCustomMods(noAuras, '+1500 to maximum Mana'));
      const withMom = calculateBuild(
        withCustomMods(noAuras, '+1500 to maximum Mana\n40% of Damage is taken from Mana before Life'),
      );
      expect(withMom.defence.effectiveHitPool).toBeGreaterThan(noMom.defence.effectiveHitPool * 1.15);
    });

    it('Elemental Resistance cap defaults to 75%, rises with +max res, and clamps at 90% hard cap', () => {
      const base = createSamplePoe1Build();
      const capped75 = calculateBuild(withCustomMods(base, '+200% to Fire Resistance'));
      const capped82 = calculateBuild(
        withCustomMods(base, '+200% to Fire Resistance\n+7% to maximum Fire Resistance'),
      );
      const clamped90 = calculateBuild(
        withCustomMods(base, '+200% to Fire Resistance\n+30% to maximum Fire Resistance'),
      );
      expect(capped75.defence.fireResist).toBe(75);
      expect(capped82.defence.fireResist).toBe(82);
      expect(clamped90.defence.fireResist).toBe(90);
    });

    it('Spell Suppression caps at 100% and Block Chance caps at 75% by default', () => {
      const base = createSamplePoe1Build();
      const out = calculateBuild(
        withCustomMods(base, '+160% chance to Suppress Spell Damage\n+120% Chance to Block Attack Damage'),
      );
      expect(out.defence.spellSuppressionChance).toBe(100);
      expect(out.defence.blockChance).toBe(75);
    });

    it('Ward scales cleanly with increased Global Defences', () => {
      const base = createSamplePoe1Build();
      const flatWard = calculateBuild(withCustomMods(base, '+300 to Ward'));
      const scaledWard = calculateBuild(withCustomMods(base, '+300 to Ward\n50% increased Global Defences'));
      expect(flatWard.defence.ward).toBeGreaterThanOrEqual(300);
      expect(scaledWard.defence.ward).toBeGreaterThan(flatWard.defence.ward! * 1.35);
    });
  });

  describe('3. Offence Isolation, Crit, Conversion & Ailments', () => {
    it('Resolute Technique locks Hit Chance to 100% and Crit Chance to 0% regardless of crit investment', () => {
      const base = createSamplePoe1Build();
      const axe = makeWeapon({ id: 'rt_axe', weaponStats: { weaponType: 'Axe', twoHanded: false, physicalMin: 120, physicalMax: 220, attacksPerSecond: 1.5, critChance: 8 } });
      const strikeGroup = {
        id: 'sg_rt',
        label: 'Cyclone',
        enabled: true,
        gems: [{ instanceId: 'g_rt', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
      };
      const build: Build = {
        ...base,
        items: { ...base.items, [axe.id]: axe },
        equipped: { ...base.equipped, 'Weapon 1': axe.id },
        skills: [strikeGroup],
        mainSkillGroupId: strikeGroup.id,
        config: {
          ...base.config,
          customMods: "Your hits can't be Evaded\nNever deal Critical Strikes\n500% increased Critical Strike Chance",
        },
      };
      const out = calculateBuild(build);
      expect(out.offence.hitChance).toBe(100);
      expect(out.offence.critChance).toBe(0);
    });

    it('isolates Attack vs Spell modifiers cleanly (Spell Damage never scales Attack; Attack Speed never scales Spell)', () => {
      const spellBase = createSamplePoe1Build();
      const spellNormal = calculateBuild(spellBase);
      const spellWithAtkSpeed = calculateBuild(withCustomMods(spellBase, '100% increased Attack Speed'));
      const spellWithSpellDmg = calculateBuild(withCustomMods(spellBase, '100% increased Spell Damage'));

      expect(spellWithAtkSpeed.offence.speed).toBeCloseTo(spellNormal.offence.speed, 4);
      expect(spellWithSpellDmg.offence.totalDps).toBeGreaterThan(spellNormal.offence.totalDps);

      const axe = makeWeapon({ id: 'iso_axe' });
      const atkGroup = {
        id: 'sg_iso',
        label: 'Cyclone',
        enabled: true,
        gems: [{ instanceId: 'g_iso', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
      };
      const atkBase: Build = {
        ...spellBase,
        items: { ...spellBase.items, [axe.id]: axe },
        equipped: { ...spellBase.equipped, 'Weapon 1': axe.id },
        skills: [atkGroup],
        mainSkillGroupId: atkGroup.id,
      };
      const atkNormal = calculateBuild(atkBase);
      const atkWithSpellDmg = calculateBuild(withCustomMods(atkBase, '200% increased Spell Damage'));
      const atkWithAtkDmg = calculateBuild(withCustomMods(atkBase, '200% increased Physical Damage'));

      expect(atkWithSpellDmg.offence.averageHit).toBeCloseTo(atkNormal.offence.averageHit, 2);
      expect(atkWithAtkDmg.offence.averageHit).toBeGreaterThan(atkNormal.offence.averageHit);
    });

    it('Avatar of Fire zeroes all non-Fire damage types', () => {
      const base = createSamplePoe1Build();
      const out = calculateBuild(
        withCustomMods(base, '50% of Physical, Cold and Lightning Damage Converted to Fire Damage\nDeal no Non-Fire Damage'),
      );
      expect(out.offence.damageByType.Fire.average).toBeGreaterThan(0);
      expect(out.offence.damageByType.Physical.average).toBe(0);
      expect(out.offence.damageByType.Cold.average).toBe(0);
      expect(out.offence.damageByType.Lightning.average).toBe(0);
      expect(out.offence.damageByType.Chaos.average).toBe(0);
    });

    it('Gain Damage as Extra Element stacks additively onto hit damage without reducing base type', () => {
      const base = createSamplePoe1Build();
      const outNormal = calculateBuild(base);
      const outExtra = calculateBuild(withCustomMods(base, 'Gain 50% of Lightning Damage as Extra Cold Damage'));
      expect(outExtra.offence.damageByType.Lightning.average).toBeCloseTo(
        outNormal.offence.damageByType.Lightning.average,
        2,
      );
      expect(outExtra.offence.damageByType.Cold.average).toBeGreaterThan(
        outNormal.offence.damageByType.Cold.average,
      );
      expect(outExtra.offence.totalDps).toBeGreaterThan(outNormal.offence.totalDps);
    });

    it('Ailments (Ignite / Poison) produce positive DoT DPS when chance & base damage exist', () => {
      const base = createSamplePoe1Build();
      const igniteOut = calculateBuild(
        withCustomMods(base, 'Adds 100 to 200 Fire Damage to Spells\n100% chance to Ignite'),
      );
      expect(igniteOut.offence.igniteDps).toBeGreaterThan(0);

      const poisonOut = calculateBuild(
        withCustomMods(base, 'Adds 100 to 200 Chaos Damage to Spells\n100% chance to Poison on Hit'),
      );
      expect(poisonOut.offence.poisonDps).toBeGreaterThan(0);
    });
  });

  describe('4. PoE 2 Spirit, Weapon Sets & Bilingual Parity', () => {
    it('PoE 2 Weapon Set 1 vs Set 2 swaps active weapons cleanly', () => {
      const base = createSamplePoe2Build();
      const weakWand = makeWeapon({
        id: 'ws_w1',
        name: 'Starter Wand',
        baseName: 'Attuned Wand',
        weaponStats: { weaponType: 'Wand', twoHanded: false, physicalMin: 10, physicalMax: 20, attacksPerSecond: 1.2, critChance: 5 },
        explicits: ['10% increased Spell Damage'],
      });
      const strongWand = makeWeapon({
        id: 'ws_w2',
        name: 'Endgame Wand',
        baseName: 'Attuned Wand',
        slotType: 'Weapon 1 Swap',
        weaponStats: { weaponType: 'Wand', twoHanded: false, physicalMin: 10, physicalMax: 20, attacksPerSecond: 1.2, critChance: 5 },
        explicits: ['180% increased Spell Damage', '+3 to Level of all Lightning Spell Skills'],
      });
      const ws1Build: Build = {
        ...base,
        activeWeaponSet: 1,
        items: { ...base.items, [weakWand.id]: weakWand, [strongWand.id]: strongWand },
        equipped: { ...base.equipped, 'Weapon 1': weakWand.id, 'Weapon 1 Swap': strongWand.id },
      };
      const ws2Build: Build = { ...ws1Build, activeWeaponSet: 2 };

      const out1 = calculateBuild(ws1Build);
      const out2 = calculateBuild(ws2Build);
      expect(out2.offence.totalDps).toBeGreaterThan(out1.offence.totalDps * 1.5);
    });

    it('EN and ZH-CN equivalent modifier lines yield bit-for-bit identical calculation outputs', () => {
      const base = createSamplePoe2Build();
      const enMods = [
        '+120 to maximum Life',
        '30% increased maximum Energy Shield',
        '+35% to Fire Resistance',
        '40% increased Spell Damage',
        '15% increased Cast Speed',
      ].join('\n');
      const zhMods = [
        '+120 最大生命',
        '最大能量护盾提高 30%',
        '+35% 火焰抗性',
        '法术伤害提高 40%',
        '施法速度提高 15%',
      ].join('\n');

      const outEn = calculateBuild(withCustomMods(base, enMods));
      const outZh = calculateBuild(withCustomMods(base, zhMods));

      expect(outZh.defence.life).toBe(outEn.defence.life);
      expect(outZh.defence.energyShield).toBe(outEn.defence.energyShield);
      expect(outZh.defence.fireResist).toBe(outEn.defence.fireResist);
      expect(outZh.offence.speed).toBe(outEn.offence.speed);
      expect(outZh.offence.totalDps).toBe(outEn.offence.totalDps);
    });
  });
});
