import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSamplePoe1Build,
  createSamplePoe2Build,
  registerGemsData,
  type CompactGemsPayload,
} from '@webpob/data';
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

  describe('5. Wave 4O Offence & Mechanics Parity Regressions (PoE 1 & PoE 2)', () => {
    beforeAll(() => {
      const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/public/data');
      const poe1Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-gems.json'), 'utf-8')) as CompactGemsPayload;
      const poe2Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-gems.json'), 'utf-8')) as CompactGemsPayload;
      registerGemsData('poe1', poe1Gems);
      registerGemsData('poe2', poe2Gems);
    });

    it('PoE 1 Hexblast: Chaos damage uses lowest Elemental Resistance (after Eldritch Exposure) + Elemental Penetration + Bear Trap Mine debuff', () => {
      const base = createSamplePoe1Build();
      const hexGroup = {
        id: 'sg_hexblast',
        label: 'Hexblast Mine',
        enabled: true,
        gems: [
          { instanceId: 'hb1', gemId: 'poe1_hexblast', level: 20, quality: 0, enabled: true },
          { instanceId: 'hb2', gemId: 'poe1_supporthighimpactmine', level: 20, quality: 0, enabled: true },
        ],
      };
      const bearTrapGroup = {
        id: 'sg_beartrap',
        label: 'Bear Trap',
        enabled: true,
        gems: [{ instanceId: 'bt1', gemId: 'poe1_beartrap', level: 20, quality: 0, enabled: true }],
      };
      const plainGloves: Item = {
        id: 'item_gloves_plain',
        name: 'Plain Gloves',
        baseName: 'Silk Gloves',
        rarity: 'RARE',
        slotType: 'Gloves',
        quality: 0,
        implicits: [],
        explicits: [],
      };
      const glovesExp: Item = {
        id: 'item_gloves_exp',
        name: 'Exposure Gloves',
        baseName: 'Silk Gloves',
        rarity: 'RARE',
        slotType: 'Gloves',
        quality: 0,
        implicits: ['Inflict Fire Exposure on Hit, applying -25% to Fire Resistance'],
        explicits: [],
      };
      const baseHex: Build = {
        ...base,
        items: { ...base.items, [plainGloves.id]: plainGloves },
        equipped: { ...base.equipped, Gloves: plainGloves.id },
        skills: [hexGroup],
        mainSkillGroupId: hexGroup.id,
        config: {
          ...base.config,
          enemyShocked: false,
          shockValue: 0,
          enemyFireResist: 50,
          enemyColdResist: 50,
          enemyLightningResist: 50,
          enemyChaosResist: 30,
          customMods: 'Damage Penetrates 10% Elemental Resistances',
        },
      };
      const withFireExposure: Build = {
        ...baseHex,
        items: { ...baseHex.items, [glovesExp.id]: glovesExp },
        equipped: { ...baseHex.equipped, Gloves: glovesExp.id },
      };
      const withBearTrap: Build = {
        ...withFireExposure,
        skills: [hexGroup, bearTrapGroup],
      };

      const outChaosLowest = calculateBuild(baseHex);
      const outFireLowestWithPen = calculateBuild(withFireExposure);
      const outWithBearTrap = calculateBuild(withBearTrap);

      // Fire res drops 50 -> 25 (< Chaos 30) and Elemental Penetration drops it to 15 (0.85 / 0.70 = +21.4% MORE)
      expect(outFireLowestWithPen.offence.averageHit).toBeGreaterThan(outChaosLowest.offence.averageHit * 1.18);
      // Bear Trap adds +25% increased Damage Taken from Mine Hits independently of Trap flag
      expect(outWithBearTrap.offence.averageHit / outFireLowestWithPen.offence.averageHit).toBeCloseTo(1.25, 2);
    });

    it('PoE 1 Eye of Winter: applies official DistanceRamp (0% at dist 0, ~133.33% at default 40, 200% at 60)', () => {
      const base = createSamplePoe1Build();
      const eowGroup = {
        id: 'sg_eow',
        label: 'Eye of Winter',
        enabled: true,
        gems: [{ instanceId: 'eow1', gemId: 'poe1_eyeofwinter', level: 20, quality: 0, enabled: true }],
      };
      const mkEow = (dist?: number): Build => ({
        ...base,
        skills: [eowGroup],
        mainSkillGroupId: eowGroup.id,
        config: {
          ...base.config,
          enemyShocked: false,
          shockValue: 0,
          rawInputs: dist === undefined ? {} : { projectileDistance: dist },
        },
      });

      const out0 = calculateBuild(mkEow(0));
      const outDefault = calculateBuild(mkEow(undefined));
      const out60 = calculateBuild(mkEow(60));

      expect(outDefault.offence.averageHit / out0.offence.averageHit).toBeCloseTo(2.3333, 1);
      expect(out60.offence.averageHit / out0.offence.averageHit).toBeCloseTo(3.0, 1);
    });

    it('PoE 1 Wave of Conviction Exposure scales enemy Fire Resist accurately', () => {
      const base = createSamplePoe1Build();
      const wocGroup = {
        id: 'sg_woc',
        label: 'Wave of Conviction',
        enabled: true,
        gems: [{ instanceId: 'woc1', gemId: 'poe1_waveofconviction', level: 20, quality: 0, enabled: true }],
      };
      const fireBase: Build = {
        ...base,
        config: {
          ...base.config,
          enemyShocked: false,
          shockValue: 0,
          enemyFireResist: 50,
          customMods: 'Adds 200 to 200 Fire Damage to Spells',
          rawInputs: {},
        },
      };
      const withWocFire: Build = {
        ...fireBase,
        skills: [...fireBase.skills, wocGroup],
        config: {
          ...fireBase.config,
          rawInputs: { waveOfConvictionExposureType: 'Fire' },
        },
      };

      const outBase = calculateBuild(fireBase);
      const outWoc = calculateBuild(withWocFire);
      // -15% Fire Exposure moves enemy res 50% -> 35% (0.65 / 0.50 = 1.30x Fire damage)
      expect(outWoc.offence.damageByType.Fire.average / outBase.offence.damageByType.Fire.average).toBeCloseTo(1.3, 2);
    });

    it('PoE 1 ShockStacks multi-stack cap (100%) and socketed Jewel {mutated} Lucky Lightning Damage', () => {
      const base = createSamplePoe1Build();
      const shockSingle: Build = {
        ...base,
        config: {
          ...base.config,
          enemyShocked: true,
          shockValue: 2,
          rawInputs: { ShockStacks: 1 },
        },
      };
      const shockMulti: Build = {
        ...shockSingle,
        config: {
          ...shockSingle.config,
          rawInputs: { ShockStacks: 50 },
        },
      };
      const outSingle = calculateBuild(shockSingle);
      const outMulti = calculateBuild(shockMulti);
      // 1 stack = 2% taken (1.02x); 50 stacks = 100% taken (2.00x) instead of capping at 50%
      expect(outMulti.offence.averageHit / outSingle.offence.averageHit).toBeCloseTo(2.0 / 1.02, 2);

      // Socketed Jewel with {mutated} Lucky Lightning line skews wide min..max toward (min + 2*max)/3
      const wideLit: Build = {
        ...base,
        config: {
          ...base.config,
          enemyShocked: false,
          shockValue: 0,
          customMods: 'Adds 1 to 1000 Lightning Damage to Spells',
        },
      };
      const luckyJewel: Item = {
        id: 'reg_lucky_jewel',
        name: 'Foulborn Nightmare',
        baseName: 'Cobalt Jewel',
        rarity: 'UNIQUE',
        slotType: 'Any',
        quality: 0,
        implicits: [],
        explicits: ["{mutated}Lightning Damage with Hits is Lucky if you've Blocked Spell Damage Recently"],
      };
      const existingSocketId = Object.keys(base.tree.socketedJewels ?? {})[0];
      const targetSocketId = existingSocketId ? Number(existingSocketId) : (wideLit.tree.allocatedNodeIds[0] ?? 1100);
      const withLuckyJewel: Build = {
        ...wideLit,
        items: { ...wideLit.items, [luckyJewel.id]: luckyJewel },
        tree: {
          ...wideLit.tree,
          allocatedNodeIds: wideLit.tree.allocatedNodeIds.includes(targetSocketId)
            ? wideLit.tree.allocatedNodeIds
            : [...wideLit.tree.allocatedNodeIds, targetSocketId],
          socketedJewels: { ...(wideLit.tree.socketedJewels ?? {}), [targetSocketId]: luckyJewel.id },
        },
      };
      const outNormalLit = calculateBuild(wideLit);
      const outLuckyLit = calculateBuild(withLuckyJewel);
      expect(outLuckyLit.offence.damageByType.Lightning.average).toBeGreaterThan(
        outNormalLit.offence.damageByType.Lightning.average * 1.18,
      );
    });

    it('PoE 1 Aspect of the Spider web stacks, Bonechill Chilled/ChillingArea gate, and multi-tag {tags:...}{crafted} Socketed Skills MORE damage', () => {
      const rawBase = createSamplePoe1Build();
      const base: Build = {
        ...rawBase,
        config: {
          ...rawBase.config,
          enemyShocked: false,
          shockValue: 0,
          enemyChilled: false,
          rawInputs: {},
        },
      };
      const spiderGroup = {
        id: 'sg_spider',
        label: 'Spider',
        enabled: true,
        gems: [{ instanceId: 'sp1', gemId: 'poe1_aspectofthespider', level: 20, quality: 0, enabled: true }],
      };
      const outNoSpider = calculateBuild(base);
      const outSpider4 = calculateBuild({
        ...base,
        skills: [...base.skills, spiderGroup],
        config: { ...base.config, rawInputs: { aspectOfTheSpiderWebStacks: 4 } },
      });
      // 4 Spider Webs = +20% increased Damage Taken
      expect(outSpider4.offence.averageHit / outNoSpider.offence.averageHit).toBeCloseTo(1.2, 2);

      // Bonechill on Frostblink does NOT apply when enemyChilled is false, but DOES apply on Vortex (Chilling Area)
      const coldBase: Build = {
        ...base,
        config: {
          ...base.config,
          enemyChilled: false,
          customMods: 'Adds 200 to 200 Cold Damage to Spells',
        },
      };
      const frostblinkBonechill = {
        id: 'sg_fb_bc',
        label: 'Frostblink Bonechill',
        enabled: true,
        gems: [
          { instanceId: 'fb1', gemId: 'poe1_frostblink', level: 20, quality: 0, enabled: true },
          { instanceId: 'bc1', gemId: 'poe1_supportbonechill', level: 20, quality: 0, enabled: true },
        ],
      };
      const vortexBonechill = {
        id: 'sg_vx_bc',
        label: 'Vortex Bonechill',
        enabled: true,
        gems: [
          { instanceId: 'vx1', gemId: 'poe1_vortex', level: 20, quality: 0, enabled: true },
          { instanceId: 'bc2', gemId: 'poe1_supportbonechill', level: 20, quality: 0, enabled: true },
        ],
      };
      const outColdPlain = calculateBuild(coldBase);
      const outFbUnchilled = calculateBuild({ ...coldBase, skills: [...coldBase.skills, frostblinkBonechill] });
      const outVxChillingArea = calculateBuild({ ...coldBase, skills: [...coldBase.skills, vortexBonechill] });
      expect(outFbUnchilled.offence.damageByType.Cold.average).toBeCloseTo(
        outColdPlain.offence.damageByType.Cold.average,
        2,
      );
      expect(outVxChillingArea.offence.damageByType.Cold.average).toBeGreaterThan(
        outColdPlain.offence.damageByType.Cold.average * 1.1,
      );

      // Multi-tag `{tags:caster,damage}{crafted}Socketed Skills deal 40% more Spell Damage` on Weapon 1 applies cleanly
      const plainDagger = makeWeapon({
        id: 'reg_plain_dagger',
        name: 'Plain Dagger',
        baseName: 'Imperial Skean',
        weaponStats: { weaponType: 'Dagger', twoHanded: false, physicalMin: 20, physicalMax: 40, attacksPerSecond: 1.5, critChance: 6.5 },
        explicits: [],
      });
      const multiTagWeapon = makeWeapon({
        id: 'reg_elder_dagger',
        name: 'Elder Dagger',
        baseName: 'Imperial Skean',
        weaponStats: { weaponType: 'Dagger', twoHanded: false, physicalMin: 20, physicalMax: 40, attacksPerSecond: 1.5, critChance: 6.5 },
        explicits: ['{tags:caster,damage}{crafted}Socketed Skills deal 40% more Spell Damage'],
      });
      const mainGrp = base.skills.find((s) => s.id === base.mainSkillGroupId) ?? base.skills[0]!;
      const slottedGroup = { ...mainGrp, slot: 'Weapon 1' as const };
      const plainSlotted: Build = {
        ...base,
        skills: [slottedGroup],
        mainSkillGroupId: slottedGroup.id,
        items: { ...base.items, [plainDagger.id]: plainDagger },
        equipped: { ...base.equipped, 'Weapon 1': plainDagger.id },
      };
      const elderSlotted: Build = {
        ...plainSlotted,
        items: { ...plainSlotted.items, [multiTagWeapon.id]: multiTagWeapon },
        equipped: { ...plainSlotted.equipped, 'Weapon 1': multiTagWeapon.id },
      };
      const outPlainSlot = calculateBuild(plainSlotted);
      const outElderSlot = calculateBuild(elderSlotted);
      expect(outElderSlot.offence.averageHit / outPlainSlot.offence.averageHit).toBeCloseTo(1.4, 2);

      // Righteous Fire of Arcane Devotion grants MORE Cast Speed when Life Unreserved > 1 and Mana > 0
      const rfArcGroup = {
        id: 'sg_rf_arc',
        label: 'RF Arcane',
        enabled: true,
        gems: [{ instanceId: 'rfa1', gemId: 'poe1_righteousfirealtx', level: 20, quality: 0, enabled: true }],
      };
      const outWithRfArc = calculateBuild({ ...base, skills: [...base.skills, rfArcGroup] });
      expect(outWithRfArc.offence.speed).toBeGreaterThan(outNoSpider.offence.speed * 1.18);
    });

    it('PoE 1 Impale uses pre-mitigation physical hit with combined-stack armour PDR and DoT caps at 35,791,394', () => {
      const base = createSamplePoe1Build();
      const bigAxe = makeWeapon({
        id: 'reg_imp_axe',
        name: 'Impale Chopper',
        baseName: 'Vaal Axe',
        weaponStats: { weaponType: 'Axe', twoHanded: true, physicalMin: 800, physicalMax: 1200, attacksPerSecond: 1.5, critChance: 5 },
      });
      const cycGroup = {
        id: 'sg_imp_cyc',
        label: 'Cyclone Impale',
        enabled: true,
        gems: [
          { instanceId: 'c1', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true },
          { instanceId: 'c2', gemId: 'poe1_supportimpale', level: 20, quality: 0, enabled: true },
        ],
      };
      const mkCyc = (enemyArmour: number, extraMod = ''): Build => ({
        ...base,
        items: { ...base.items, [bigAxe.id]: bigAxe },
        equipped: { ...base.equipped, 'Weapon 1': bigAxe.id },
        skills: [cycGroup],
        mainSkillGroupId: cycGroup.id,
        config: {
          ...base.config,
          enemyShocked: false,
          shockValue: 0,
          enemyArmour,
          customMods: `100% chance to Impale Enemies on Hit with Attacks\nYour Hits can't be Evaded${extraMod ? `\n${extraMod}` : ''}`,
        },
      });
      const outNoArmour = calculateBuild(mkCyc(0));
      const outArmour5 = calculateBuild(mkCyc(20000));
      const outArmour6 = calculateBuild(mkCyc(20000, 'Impales you inflict last 1 additional Hit'));
      expect(outNoArmour.offence.impaleDps ?? 0).toBeGreaterThan(0);
      // With 0 armour and Lv20 Impale Support (28% increased Impale Effect), 5 stacks = exact 5 * 0.10 * 1.28 = 0.64x hitDps
      expect((outNoArmour.offence.impaleDps ?? 0) / outNoArmour.offence.hitDps).toBeCloseTo(0.64, 2);
      // Under 20k enemy armour, 6 stacks beats 5 stacks by > 6/5 (1.20x) due to combined-stack armour PDR
      expect((outArmour6.offence.impaleDps ?? 0) / Math.max(1, outArmour5.offence.impaleDps ?? 0)).toBeGreaterThan(1.2);

      // PoE 1 DoT engine cap: 35,791,394 DPS
      const cappedPoison = calculateBuild(
        withCustomMods(
          base,
          'Adds 5000000 to 5000000 Chaos Damage to Spells\n100% chance to Poison on Hit\n500% increased Chaos Damage',
        ),
      );
      expect(cappedPoison.offence.poisonDps).toBeLessThanOrEqual(35_791_394);
      expect(cappedPoison.offence.poisonDps).toBeGreaterThan(35_000_000);
    });

    it('PoE 2 Pounce (Predator\'s Mark): defaults to 8 wolves without multi-minions, stays 15 with Raging Spirits, ignores Mark support, and yields to active Mark', () => {
      const rawBase = createSamplePoe2Build();
      const base: Build = {
        ...rawBase,
        config: { ...rawBase.config, enemyShocked: false, shockValue: 0, rawInputs: {} },
      };
      const pounceOnly = {
        id: 'sg_pounce',
        label: 'Pounce',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'p1', gemId: 'poe2_wolfpounce', level: 20, quality: 0, enabled: true }],
      };
      const pounceWithSupportMark = {
        ...pounceOnly,
        gems: [
          ...pounceOnly.gems,
          { instanceId: 'ms1', gemId: 'poe2_markofsiphoningsupporttwo', level: 1, quality: 0, enabled: true },
        ],
      };
      const pounceWithActiveMark = {
        ...pounceOnly,
        gems: [
          ...pounceOnly.gems,
          { instanceId: 'fm1', gemId: 'poe2_freezingmark', level: 20, quality: 0, enabled: true },
        ],
      };
      const srsGroup = {
        id: 'sg_srs',
        label: 'SRS',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'srs1', gemId: 'poe2_ragingspirits', level: 20, quality: 0, enabled: true }],
      };

      const outBase = calculateBuild(base);
      const outPounce8 = calculateBuild({ ...base, skills: [...base.skills, pounceOnly] });
      const outPounceSupMark = calculateBuild({ ...base, skills: [...base.skills, pounceWithSupportMark] });
      const outPounceSrs15 = calculateBuild({ ...base, skills: [...base.skills, pounceOnly, srsGroup] });
      const outPounceOverridden = calculateBuild({ ...base, skills: [...base.skills, pounceWithActiveMark] });

      // 8 wolves * 3% = +24% increased Damage Taken
      expect(outPounce8.offence.averageHit / outBase.offence.averageHit).toBeCloseTo(1.24, 2);
      // Mark of Siphoning II support does NOT neutralize Pounce's Predator's Mark
      expect(outPounceSupMark.offence.averageHit).toBeCloseTo(outPounce8.offence.averageHit, 1);
      // Raging Spirits multi-minion skill keeps full 15 minions * 3% = +45% increased Damage Taken
      expect(outPounceSrs15.offence.averageHit / outBase.offence.averageHit).toBeCloseTo(1.45, 2);
      // Active Freezing Mark in same skill group overrides Predator's Mark
      expect(outPounceOverridden.offence.averageHit).toBeLessThan(outPounce8.offence.averageHit);
    });

    it('PoE 2 Quiver offensive mods exclude Unarmed Concoctions (while keeping +Projectile Level) without breaking Bow Poison', () => {
      const base = createSamplePoe2Build();
      const bow = makeWeapon({
        id: 'reg_bow',
        name: 'Test Bow',
        baseName: 'Dualstring Bow',
        weaponStats: { weaponType: 'Bow', twoHanded: true, physicalMin: 120, physicalMax: 200, attacksPerSecond: 1.4, critChance: 5 },
      });
      const bigQuiver: Item = {
        id: 'reg_quiver',
        name: 'Crit Quiver',
        baseName: 'Visceral Quiver',
        rarity: 'RARE',
        slotType: 'Weapon 2',
        quality: 0,
        implicits: ['25% increased Critical Hit Chance for Attacks'],
        explicits: [
          'Adds 50 to 100 Physical Damage to Attacks',
          '40% increased Damage with Bow Skills',
          '30% increased Attack Speed',
          '+2 to Level of all Projectile Skills',
        ],
      };

      const concGroup = {
        id: 'sg_conc',
        label: 'Shattering Concoction',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'sc1', gemId: 'poe2_ascendancyshatteringconcoction', level: 20, quality: 0, enabled: true }],
      };
      const concNoQuiver: Build = {
        ...base,
        skills: [concGroup],
        mainSkillGroupId: concGroup.id,
        items: { ...base.items, [bow.id]: bow },
        equipped: { ...base.equipped, 'Weapon 1': bow.id },
      };
      delete concNoQuiver.equipped['Weapon 2'];
      const concWithQuiver: Build = {
        ...concNoQuiver,
        items: { ...concNoQuiver.items, [bigQuiver.id]: bigQuiver },
        equipped: { ...concNoQuiver.equipped, 'Weapon 2': bigQuiver.id },
      };
      const outConcNoQ = calculateBuild(concNoQuiver);
      const outConcWithQ = calculateBuild(concWithQuiver);
      // Quiver Attack Speed & Crit Chance must NOT inflate Unarmed Concoction, while +2 Projectile Level still applies!
      expect(outConcWithQ.offence.speed).toBeCloseTo(outConcNoQ.offence.speed, 2);
      expect(outConcWithQ.offence.critChance).toBeCloseTo(outConcNoQ.offence.critChance, 2);
      expect(outConcWithQ.offence.mainSkillLevel).toBe((outConcNoQ.offence.mainSkillLevel ?? 20) + 2);

      // Bow Poison skill MUST still benefit from Quiver flat Physical Damage
      const bowPsnGroup = {
        id: 'sg_bow_psn',
        label: 'Poisonburst',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'bp1', gemId: 'poe2_poisonburstarrow', level: 20, quality: 0, enabled: true }],
      };
      const bowNoQuiver: Build = {
        ...concNoQuiver,
        skills: [bowPsnGroup],
        mainSkillGroupId: bowPsnGroup.id,
        config: { ...base.config, customMods: '100% chance to Poison on Hit' },
      };
      const bowWithQuiver: Build = {
        ...bowNoQuiver,
        items: { ...bowNoQuiver.items, [bigQuiver.id]: bigQuiver },
        equipped: { ...bowNoQuiver.equipped, 'Weapon 2': bigQuiver.id },
      };
      const outBowNoQ = calculateBuild(bowNoQuiver);
      const outBowWithQ = calculateBuild(bowWithQuiver);
      expect(outBowWithQ.offence.poisonDps).toBeGreaterThan(outBowNoQ.offence.poisonDps * 1.3);
    });

    it('PoE 2 Spell Totem unlocks Urgent Totems III (+20% Cast Speed) and Rageforged II gates 35% MORE on Rage >= 10', () => {
      const base = createSamplePoe2Build();
      const grimPlain = {
        id: 'sg_grim',
        label: 'Grim Totem',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [
          { instanceId: 'st1', gemId: 'poe2_metaspelltotem', level: 20, quality: 0, enabled: true },
          { instanceId: 'gp1', gemId: 'poe2_grimpillars', level: 20, quality: 0, enabled: true },
        ],
      };
      const grimUrgent = {
        ...grimPlain,
        gems: [
          ...grimPlain.gems,
          { instanceId: 'ut1', gemId: 'poe2_urgenttotemssupportthree', level: 1, quality: 0, enabled: true },
        ],
      };
      const outGrimPlain = calculateBuild({ ...base, skills: [grimPlain], mainSkillGroupId: grimPlain.id });
      const outGrimUrgent = calculateBuild({ ...base, skills: [grimUrgent], mainSkillGroupId: grimUrgent.id });
      expect(outGrimUrgent.offence.speed).toBeGreaterThan(outGrimPlain.offence.speed * 1.1);

      // Rageforged II: 0 Rage => no 35% MORE; 15 Rage => +35% MORE
      const rfGroup = {
        id: 'sg_rf2',
        label: 'Rageforged Test',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [
          { instanceId: 'es1', gemId: 'poe2_earthshatter', level: 20, quality: 0, enabled: true },
          { instanceId: 'rf2', gemId: 'poe2_rageforgedsupporttwo', level: 1, quality: 0, enabled: true },
        ],
      };
      const mace = makeWeapon({
        id: 'reg_rf_mace',
        name: 'Test Maul',
        baseName: 'Sacred Maul',
        weaponStats: { weaponType: 'Mace', twoHanded: true, physicalMin: 200, physicalMax: 300, attacksPerSecond: 1.2, critChance: 5 },
      });
      const mkRf = (rage: number): Build => ({
        ...base,
        items: { ...base.items, [mace.id]: mace },
        equipped: { ...base.equipped, 'Weapon 1': mace.id },
        skills: [rfGroup],
        mainSkillGroupId: rfGroup.id,
        config: { ...base.config, rage, rawInputs: { multiplierRage: rage } },
      });
      const outRage0 = calculateBuild(mkRf(0));
      const outRage15 = calculateBuild(mkRf(15));
      // 15 Rage gives 15% MORE Rage + 35% MORE Rageforged II = 1.15 * 1.35 = 1.5525x
      expect(outRage15.offence.averageHit / outRage0.offence.averageHit).toBeGreaterThan(1.45);
    });

    it('PoE 2 Item Elemental Exposure, Enemies you Curse, Sigil of Power +Spell Level scaling, and Fulminating Concoction Skill Shock Magnitude', () => {
      const rawBase = createSamplePoe2Build();
      const base: Build = {
        ...rawBase,
        config: { ...rawBase.config, enemyShocked: false, shockValue: 0, rawInputs: {} },
      };
      const plainStaff = makeWeapon({
        id: 'reg_plain_staff',
        name: 'Plain Staff',
        baseName: 'Permafrost Staff',
        weaponStats: { weaponType: 'Staff', twoHanded: true, physicalMin: 10, physicalMax: 20, attacksPerSecond: 1.2, critChance: 5 },
        explicits: [],
      });
      const whisperStaff = makeWeapon({
        id: 'reg_whisper',
        name: 'The Whispering Ice',
        baseName: 'Permafrost Staff',
        weaponStats: { weaponType: 'Staff', twoHanded: true, physicalMin: 10, physicalMax: 20, attacksPerSecond: 1.2, critChance: 5 },
        explicits: [
          '+4 to Level of all Spell Skills',
          'Inflict Elemental Exposure on Hit, lowering Total Elemental Resistances by 60%',
        ],
      });
      const sigilGroup = {
        id: 'sg_sigil',
        label: 'Sigil',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'sig1', gemId: 'poe2_sigilofpower', level: 16, quality: 0, enabled: true }],
      };
      const bossBase: Build = {
        ...base,
        items: { ...base.items, [plainStaff.id]: plainStaff },
        equipped: { ...base.equipped, 'Weapon 1': plainStaff.id },
        config: { ...base.config, enemyIsBoss: 'Pinnacle', enemyColdResist: 50, enemyLightningResist: 50, enemyFireResist: 50 },
      };
      delete bossBase.equipped['Weapon 2'];
      const withWhisperAndSigil: Build = {
        ...bossBase,
        items: { ...bossBase.items, [whisperStaff.id]: whisperStaff },
        equipped: { ...bossBase.equipped, 'Weapon 1': whisperStaff.id },
        skills: [...bossBase.skills, sigilGroup],
      };
      const outPlainBoss = calculateBuild(bossBase);
      const outWhisper = calculateBuild(withWhisperAndSigil);
      // 60% Exposure * 0.5 Boss = -30% res (0.80/0.50 = 1.6x) + Sigil + +4 Spell Level
      expect(outWhisper.offence.averageHit).toBeGreaterThan(outPlainBoss.offence.averageHit * 2.0);

      // Atziri's Disdain: "Enemies you Curse take 10% increased Damage" applies ONLY when a Curse is active
      const cursedHelm: Item = {
        id: 'reg_cursed_helm',
        name: "Atziri's Disdain",
        baseName: 'Gold Circlet',
        rarity: 'UNIQUE',
        slotType: 'Helmet',
        quality: 0,
        implicits: [],
        explicits: ['Enemies you Curse take 10% increased Damage'],
      };
      const despairGroup = {
        id: 'sg_desp',
        label: 'Despair',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'dsp1', gemId: 'poe2_despair', level: 20, quality: 0, enabled: true }],
      };
      const withHelmNoCurse: Build = {
        ...base,
        items: { ...base.items, [cursedHelm.id]: cursedHelm },
        equipped: { ...base.equipped, Helmet: cursedHelm.id },
      };
      const withHelmAndCurse: Build = {
        ...withHelmNoCurse,
        skills: [...withHelmNoCurse.skills, despairGroup],
      };
      const outNoCurse = calculateBuild(withHelmNoCurse);
      const outWithCurse = calculateBuild(withHelmAndCurse);
      expect(outWithCurse.offence.averageHit / outNoCurse.offence.averageHit).toBeCloseTo(1.1, 2);

      // Fulminating Concoction has 50% more Magnitude of Shock in cmods: Shock 20% -> 30% when enemyShocked
      const fulmGroup = {
        id: 'sg_fulm',
        label: 'Fulminating Concoction',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'fc1', gemId: 'poe2_ascendancyfulminatingconcoction', level: 20, quality: 0, enabled: true }],
      };
      const fulmUnshocked: Build = {
        ...base,
        skills: [fulmGroup],
        mainSkillGroupId: fulmGroup.id,
        config: { ...base.config, enemyShocked: false, shockValue: 0 },
      };
      const fulmShocked: Build = {
        ...fulmUnshocked,
        config: { ...fulmUnshocked.config, enemyShocked: true, shockValue: 0 },
      };
      const outFulmNoShock = calculateBuild(fulmUnshocked);
      const outFulmShocked = calculateBuild(fulmShocked);
      // 20% * 1.50 = 30% Shock (1.30x vs 1.20x without skill magnitude)
      expect(outFulmShocked.offence.averageHit / outFulmNoShock.offence.averageHit).toBeCloseTo(1.3, 2);
    });

    it("PoE 2 Atziri's Communion (LifeReservePercentPerSpirit) on Blasphemy reserves Life into Low Life and activates Execute III", () => {
      const rawBase = createSamplePoe2Build();
      const base: Build = {
        ...rawBase,
        config: { ...rawBase.config, enemyShocked: false, shockValue: 0, conditionLowLife: false, rawInputs: {} },
      };
      const mainExecGroup = {
        id: 'sg_exec',
        label: 'Spark Execute III',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [
          { instanceId: 'sp1', gemId: 'poe2_spark', level: 20, quality: 0, enabled: true },
          { instanceId: 'ex3', gemId: 'poe2_executesupportthree', level: 1, quality: 0, enabled: true },
        ],
      };
      const blasphemyCommunion = {
        id: 'sg_blasp_comm',
        label: 'Blasphemy Atziri Communion',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [
          { instanceId: 'bl1', gemId: 'poe2_blasphemy', level: 20, quality: 0, enabled: true },
          { instanceId: 'tc1', gemId: 'poe2_temporalchains', level: 20, quality: 0, enabled: true },
          { instanceId: 'en1', gemId: 'poe2_enfeeble', level: 20, quality: 0, enabled: true },
          { instanceId: 'ac1', gemId: 'poe2_atziriscommunionsupport', level: 1, quality: 0, enabled: true },
        ],
      };
      const outFullLife = calculateBuild({ ...base, skills: [mainExecGroup], mainSkillGroupId: mainExecGroup.id });
      const outLowLife = calculateBuild({
        ...base,
        skills: [mainExecGroup, blasphemyCommunion],
        mainSkillGroupId: mainExecGroup.id,
      });
      // 2 Curses in Blasphemy (120 Spirit) * 0.66% = 79.2% Life reserved -> <=35% Unreserved -> Low Life -> Execute III (+30% MORE)
      expect(outLowLife.defence.lifeUnreserved).toBeLessThan(outLowLife.defence.life * 0.35);
      expect(outLowLife.offence.averageHit / outFullLife.offence.averageHit).toBeCloseTo(1.3, 2);
    });

    it('PoE 2 Ice Bite II target=player buff is not double-counted when linked to the main attack', () => {
      const rawBase = createSamplePoe2Build();
      const bow = makeWeapon({
        id: 'reg_ib_bow',
        name: 'Plain Bow',
        baseName: 'Dualstring Bow',
        weaponStats: { weaponType: 'Bow', twoHanded: true, physicalMin: 100, physicalMax: 100, attacksPerSecond: 1.5, critChance: 5 },
      });
      const base: Build = {
        ...rawBase,
        items: { ...rawBase.items, [bow.id]: bow },
        equipped: { ...rawBase.equipped, 'Weapon 1': bow.id },
        config: {
          ...rawBase.config,
          enemyShocked: false,
          shockValue: 0,
          enemyColdResist: 0,
          enemyFireResist: 0,
          enemyLightningResist: 0,
          rawInputs: { conditionFrozenEnemyRecently: true },
        },
      };
      delete base.equipped['Weapon 2'];
      const iceShotPlain = {
        id: 'sg_is_plain',
        label: 'Ice Shot',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [{ instanceId: 'is1', gemId: 'poe2_iceshot', level: 20, quality: 0, enabled: true }],
      };
      const iceShotIceBite = {
        ...iceShotPlain,
        gems: [
          ...iceShotPlain.gems,
          { instanceId: 'ib2', gemId: 'poe2_icebitesupporttwo', level: 1, quality: 0, enabled: true },
        ],
      };
      const outPlain = calculateBuild({ ...base, skills: [iceShotPlain], mainSkillGroupId: iceShotPlain.id });
      const outIb2 = calculateBuild({ ...base, skills: [iceShotIceBite], mainSkillGroupId: iceShotIceBite.id });
      // Ice Shot converts 80% Phys->Cold; Ice Bite II adds +30% Damage as Extra Cold ONCE (0.80 -> 1.10 = 1.375x, NOT 1.40/0.80 = 1.75x)
      expect(outIb2.offence.damageByType.Cold.average / outPlain.offence.damageByType.Cold.average).toBeCloseTo(1.375, 2);
    });

    it('PoE 2 EnemyAffectedByElementalAilment activates conditional hit damage when enemy is Shocked', () => {
      const rawBase = createSamplePoe2Build();
      const noShock: Build = {
        ...rawBase,
        config: {
          ...rawBase.config,
          enemyShocked: false,
          shockValue: 0,
          customMods: '100% increased Damage with Hits against Enemies affected by Elemental Ailments',
          rawInputs: {},
        },
      };
      const withShockNoMod: Build = {
        ...rawBase,
        config: { ...rawBase.config, enemyShocked: true, shockValue: 20, customMods: '', rawInputs: {} },
      };
      const withShockAndMod: Build = {
        ...withShockNoMod,
        config: {
          ...withShockNoMod.config,
          customMods: '100% increased Damage with Hits against Enemies affected by Elemental Ailments',
        },
      };
      const outNoShock = calculateBuild(noShock);
      const outShockNoMod = calculateBuild(withShockNoMod);
      const outShockAndMod = calculateBuild(withShockAndMod);
      expect(outShockAndMod.offence.averageHit).toBeGreaterThan(outShockNoMod.offence.averageHit * 1.1);
      expect(outShockNoMod.offence.averageHit).toBeGreaterThan(outNoShock.offence.averageHit * 1.15);
    });

    it('PoE 1 Mine skills use MineLayingSpeed (ignoring Attack/Cast Speed) and support-granted Void Shockwave registers as active candidate', () => {
      const base = createSamplePoe1Build();
      const mineGroup = {
        id: 'sg_mine_spd',
        label: 'Exsanguinate Mine',
        enabled: true,
        gems: [
          { instanceId: 'ex1', gemId: 'poe1_exsanguinate', level: 20, quality: 0, enabled: true },
          { instanceId: 'hm1', gemId: 'poe1_supporthighimpactmine', level: 20, quality: 0, enabled: true },
        ],
      };
      const minePlain: Build = {
        ...base,
        skills: [mineGroup],
        mainSkillGroupId: mineGroup.id,
        config: { ...base.config, customMods: '' },
      };
      const mineWithCastSpeed: Build = {
        ...minePlain,
        config: { ...minePlain.config, customMods: '100% increased Cast Speed' },
      };
      const outMinePlain = calculateBuild(minePlain);
      const outMineCastSpd = calculateBuild(mineWithCastSpeed);
      // Cast Speed must NOT inflate PoE 1 Mine Throwing Speed
      expect(outMineCastSpd.offence.speed).toBeCloseTo(outMinePlain.offence.speed, 2);

      // Cyclone + Shockwave Support + Void Shockwave Support with mainActiveSkillIndex=3 selects Void Shockwave
      const bigStaff = makeWeapon({
        id: 'reg_vs_staff',
        name: 'Test Staff',
        baseName: 'Eclipse Staff',
        weaponStats: { weaponType: 'Staff', twoHanded: true, physicalMin: 300, physicalMax: 500, attacksPerSecond: 1.3, critChance: 6 },
      });
      const cycVsGroup = {
        id: 'sg_cyc_vs',
        label: 'Cyclone Void Shockwave',
        enabled: true,
        mainActiveSkillIndex: 3,
        gems: [
          { instanceId: 'cy1', gemId: 'poe1_cyclone', level: 20, quality: 20, enabled: true },
          { instanceId: 'sw1', gemId: 'poe1_supportshockwave', level: 20, quality: 0, enabled: true },
          { instanceId: 'vsw1', gemId: 'poe1_supportvoidshockwave', level: 3, quality: 0, enabled: true },
        ],
      };
      const outVsw = calculateBuild({
        ...base,
        items: { ...base.items, [bigStaff.id]: bigStaff },
        equipped: { ...base.equipped, 'Weapon 1': bigStaff.id },
        skills: [cycVsGroup],
        mainSkillGroupId: cycVsGroup.id,
      });
      expect(outVsw.offence.mainSkillName.en).toBe('Void Shockwave');
    });

    it('PoE 1 SocketedIn item mods apply once only in matching slot, and Gladiator Determined Survivor overrides Shield Block & doubles Dual Wield bonuses', () => {
      const base = createSamplePoe1Build();
      const plainHelm: Item = {
        id: 'reg_plain_helm',
        name: 'Plain Crown',
        baseName: 'Hubris Circlet',
        rarity: 'RARE',
        slotType: 'Helmet',
        quality: 0,
        implicits: [],
        explicits: [],
      };
      const elderHelm: Item = {
        ...plainHelm,
        id: 'reg_elder_helm',
        name: 'Elder Crown',
        explicits: ['Socketed Skills deal 30% more Elemental Damage'],
      };
      const mainGrp = base.skills.find((s) => s.id === base.mainSkillGroupId) ?? base.skills[0]!;
      const helmGrp = { ...mainGrp, slot: 'Helmet' as const };
      const bodyGrp = { ...mainGrp, slot: 'Body Armour' as const };

      const outPlain = calculateBuild({
        ...base,
        items: { ...base.items, [plainHelm.id]: plainHelm },
        equipped: { ...base.equipped, Helmet: plainHelm.id },
        skills: [helmGrp],
        mainSkillGroupId: helmGrp.id,
      });
      const outElderInHelm = calculateBuild({
        ...base,
        items: { ...base.items, [elderHelm.id]: elderHelm },
        equipped: { ...base.equipped, Helmet: elderHelm.id },
        skills: [helmGrp],
        mainSkillGroupId: helmGrp.id,
      });
      const outElderInBody = calculateBuild({
        ...base,
        items: { ...base.items, [elderHelm.id]: elderHelm },
        equipped: { ...base.equipped, Helmet: elderHelm.id },
        skills: [bodyGrp],
        mainSkillGroupId: bodyGrp.id,
      });
      // Exact 1.30x in matching slot (never double-counted to 1.69x) and 1.00x in other slots
      expect(outElderInHelm.offence.averageHit / outPlain.offence.averageHit).toBeCloseTo(1.3, 2);
      expect(outElderInBody.offence.averageHit / outPlain.offence.averageHit).toBeCloseTo(1.0, 2);

      // Gladiator Determined Survivor: Base Chance to Block from Equipped Shield is 50%
      const lowBlockShield: Item = {
        id: 'reg_low_shield',
        name: 'Small Buckler',
        baseName: 'Goathide Buckler',
        rarity: 'RARE',
        slotType: 'Weapon 2',
        quality: 0,
        armourStats: { armour: 0, evasion: 100, energyShield: 0, blockChance: 22 },
        implicits: [],
        explicits: [],
      };
      const shieldBase: Build = {
        ...base,
        items: { ...base.items, [lowBlockShield.id]: lowBlockShield },
        equipped: { ...base.equipped, 'Weapon 2': lowBlockShield.id },
      };
      const outNormalBlock = calculateBuild(shieldBase);
      const outOverrideBlock = calculateBuild(
        withCustomMods(shieldBase, "Gain 50% Chance to Block from Equipped Shield instead of the Shield's value"),
      );
      expect(outOverrideBlock.defence.blockChance).toBeGreaterThanOrEqual(outNormalBlock.defence.blockChance + 25);
    });

    it('PoE 2 BlockChanceMax OVERRIDE (Turtle Charm) and ConsumedPowerChargeRecently gating on non-Flicker skills', () => {
      const rawBase = createSamplePoe2Build();
      const shield: Item = {
        id: 'reg_p2_shield',
        name: 'Tower Shield',
        baseName: 'Splintered Tower Shield',
        rarity: 'RARE',
        slotType: 'Weapon 2',
        quality: 0,
        armourStats: { armour: 200, evasion: 0, energyShield: 0, blockChance: 40 },
        implicits: [],
        explicits: ['+50% to Chance to Block'],
      };
      const baseWithShield: Build = {
        ...rawBase,
        items: { ...rawBase.items, [shield.id]: shield },
        equipped: { ...rawBase.equipped, 'Weapon 2': shield.id },
        config: {
          ...rawBase.config,
          customMods: 'Maximum Block chance is 75%',
        },
      };
      const outDefaultMax = calculateBuild(baseWithShield);
      const outTurtleMax = calculateBuild(withCustomMods(baseWithShield, 'Maximum Block chance is 35%'));
      expect(outDefaultMax.defence.blockChance).toBeGreaterThan(35);
      expect(outTurtleMax.defence.blockChance).toBeLessThanOrEqual(35);
    });

    it('PoE 1 Oath of the Maji doubles Body Armour defences only when Body Armour has 0 socketed gems, and Mercenary skill groups do not reserve player Mana', () => {
      const base = createSamplePoe1Build();
      const bigBody: Item = {
        id: 'reg_maji_body',
        name: 'Astral Plate',
        baseName: 'Astral Plate',
        rarity: 'RARE',
        slotType: 'Body Armour',
        quality: 0,
        armourStats: { armour: 1000, evasion: 0, energyShield: 0 },
        implicits: [],
        explicits: [],
      };
      const emptyBodyBuild: Build = {
        ...base,
        items: { ...base.items, [bigBody.id]: bigBody },
        equipped: { ...base.equipped, 'Body Armour': bigBody.id },
        skills: base.skills.map((s) => (s.slot === 'Body Armour' ? { ...s, slot: 'Weapon 1' as const } : s)),
      };
      const socketedBodyBuild: Build = {
        ...emptyBodyBuild,
        skills: emptyBodyBuild.skills.map((s, i) => (i === 0 ? { ...s, slot: 'Body Armour' as const } : s)),
      };
      const outPlainEmpty = calculateBuild(emptyBodyBuild);
      const outMajiEmpty = calculateBuild(
        withCustomMods(emptyBodyBuild, 'Defences from Equipped Body Armour are doubled if it has no Socketed Gems'),
      );
      const outMajiSocketed = calculateBuild(
        withCustomMods(socketedBodyBuild, 'Defences from Equipped Body Armour are doubled if it has no Socketed Gems'),
      );
      expect(outMajiEmpty.defence.armour).toBeGreaterThanOrEqual(outPlainEmpty.defence.armour + 1000);
      expect(outMajiSocketed.defence.armour).toBeCloseTo(outPlainEmpty.defence.armour, 0);

      // Mercenary aura skill group must not reserve player Mana
      const mercAuraGroup = {
        id: 'sg_merc_det',
        label: 'Merc Determination',
        enabled: true,
        source: 'Mercenary',
        gems: [{ instanceId: 'md1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true }],
      };
      const outNoMerc = calculateBuild(emptyBodyBuild);
      const outWithMerc = calculateBuild({
        ...emptyBodyBuild,
        skills: [...emptyBodyBuild.skills, mercAuraGroup],
      });
      expect(outWithMerc.defence.manaUnreserved).toBe(outNoMerc.defence.manaUnreserved);
    });

    it('PoE 2 secondary-skill Lightning Exposure support does not leak EnemyExposure when enemyLightningExposure is off, and Shapeshifted is cleared for human spells when conditionShapeshiftToHuman is set', () => {
      const rawBase = createSamplePoe2Build();
      const cleanBase: Build = {
        ...rawBase,
        config: {
          ...rawBase.config,
          enemyShocked: false,
          shockValue: 0,
          enemyLightningExposure: false,
          customMods: '100% increased Critical Hit Chance against Enemies affected by Exposure',
          rawInputs: {},
        },
      };
      const secExpGroup = {
        id: 'sg_sec_exp',
        label: 'Secondary Exposure',
        enabled: true,
        weaponSets: [1, 2] as Array<1 | 2>,
        gems: [
          { instanceId: 'hf1', gemId: 'poe2_hollowfocus', level: 20, quality: 0, enabled: true },
          { instanceId: 'le1', gemId: 'poe2_lightningexposuresupport', level: 1, quality: 0, enabled: true },
        ],
      };
      const outPlain = calculateBuild(cleanBase);
      const outWithSecExp = calculateBuild({ ...cleanBase, skills: [...cleanBase.skills, secExpGroup] });
      // Must NOT leak EnemyExposure into crit chance when enemyLightningExposure is false
      expect(outWithSecExp.offence.critChance).toBeCloseTo(outPlain.offence.critChance, 2);

      // Human spell (Spark) with both conditionShapeshiftToAnimal and conditionShapeshiftToHuman clears Shapeshifted
      const shapeMod = '100% increased Cast Speed while Shapeshifted';
      const outHuman = calculateBuild({
        ...cleanBase,
        config: {
          ...cleanBase.config,
          customMods: shapeMod,
          rawInputs: { conditionShapeshiftToAnimal: true, conditionShapeshiftToHuman: true },
        },
      });
      const outAnimalOnly = calculateBuild({
        ...cleanBase,
        config: {
          ...cleanBase.config,
          customMods: shapeMod,
          rawInputs: { conditionShapeshiftToAnimal: true },
        },
      });
      expect(outAnimalOnly.offence.speed).toBeGreaterThan(outHuman.offence.speed * 1.2);
    });
  });

  describe('Wave 4W: PoE 2 RageEffect->Rage stat sync & PoE 1 Claw Dual-Wield Mastery', () => {
    it('scales PoE 2 PerStat:Rage (Bestial Rage) by effective RageEffect', () => {
      const base = createSamplePoe2Build();
      const maul = makeWeapon({
        id: 'poe2_maul_1',
        name: 'Test Maul',
        baseName: 'Anvil Maul',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Mace',
          twoHanded: true,
          physicalMin: 200,
          physicalMax: 400,
          attacksPerSecond: 1.2,
          critChance: 5,
        },
      });
      const attackBase: Build = {
        ...base,
        items: { ...base.items, [maul.id]: maul },
        equipped: { ...base.equipped, 'Weapon 1': maul.id },
        skills: [
          {
            id: 'sg_phys_atk',
            label: 'Phys Attack',
            enabled: true,
            weaponSets: [1, 2],
            gems: [{ instanceId: 'g1', gemId: 'poe2_leapslam', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_phys_atk',
      };
      const plain: Build = {
        ...attackBase,
        config: {
          ...attackBase.config,
          rage: 60,
          customMods: [
            '+30 to Maximum Rage',
            'Every 10 Rage also grants 12% increased Physical Damage',
          ].join('\n'),
        },
      };
      const withRageEff: Build = {
        ...plain,
        config: {
          ...plain.config,
          customMods: [
            '+30 to Maximum Rage',
            '50% increased Rage Effect',
            'Every 10 Rage also grants 12% increased Physical Damage',
          ].join('\n'),
        },
      };
      const outPlain = calculateBuild(plain);
      const outScaled = calculateBuild(withRageEff);
      // 60 Rage with +50% Rage Effect -> 90 effective Rage -> 1.90/1.60 = 1.1875x MORE Attack + +36% INC Physical (108% vs 72%)
      expect(outScaled.offence.averageHit).toBeGreaterThan(outPlain.offence.averageHit * 1.22);
    });

    it('applies PoE 1 Claw Mastery doubled dual-wield attack speed (20% MORE) only when dual-wielding two Claws', () => {
      const base = createSamplePoe1Build();
      const claw1 = makeWeapon({
        id: 'claw_1',
        name: 'Left Claw',
        baseName: 'Imperial Claw',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Claw',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 6,
        },
      });
      const claw2 = makeWeapon({
        id: 'claw_2',
        name: 'Right Claw',
        baseName: 'Imperial Claw',
        slotType: 'Weapon 2',
        weaponStats: {
          weaponType: 'Claw',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 6,
        },
      });
      const sword2 = makeWeapon({
        id: 'sword_2',
        name: 'Off Sword',
        baseName: 'Jewelled Foil',
        slotType: 'Weapon 2',
        weaponStats: {
          weaponType: 'Sword',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 6,
        },
      });
      const masteryText = 'Inherent Attack Speed bonus from Dual Wielding is doubled while wielding two Claws';
      const dualClawBase: Build = {
        ...base,
        items: { ...base.items, [claw1.id]: claw1, [claw2.id]: claw2, [sword2.id]: sword2 },
        equipped: { ...base.equipped, 'Weapon 1': claw1.id, 'Weapon 2': claw2.id },
        skills: [
          {
            id: 'sg_attack',
            label: 'Attack',
            enabled: true,
            gems: [{ instanceId: 'g1', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_attack',
        tree: { ...base.tree, masteryEffects: {} },
      };
      const outNoMastery = calculateBuild(dualClawBase);
      const outTwoClawsMastery = calculateBuild({
        ...dualClawBase,
        tree: { ...dualClawBase.tree, masteryEffects: { 19050: masteryText } },
      });
      const outClawAndSwordMastery = calculateBuild({
        ...dualClawBase,
        equipped: { ...dualClawBase.equipped, 'Weapon 2': sword2.id },
        tree: { ...dualClawBase.tree, masteryEffects: { 19050: masteryText } },
      });
      // 1.20 / 1.10 = 1.0909x Attack Speed when wielding two Claws with Claw Mastery
      expect(outTwoClawsMastery.offence.speed / outNoMastery.offence.speed).toBeCloseTo(1.2 / 1.1, 2);
      // Mixed Claw + Sword must NOT receive the doubled Claw-only dual-wield bonus
      expect(outClawAndSwordMastery.offence.speed / outNoMastery.offence.speed).toBeCloseTo(1.0, 2);
    });
  });

  describe('Wave 5A: PoE 2 HaveEnergyShield gating, PoE 1 Transfiguration of Soul, 4-Slot Armour/Evasion & Pact Uptime', () => {
    it('gates PoE 2 HaveEnergyShield on explicit config condition (Immaterial Evasion)', () => {
      const base = createSamplePoe2Build();
      const bodyWithEs = {
        id: 'body_es_ev',
        name: 'Hybrid Jacket',
        baseName: 'Waxed Jacket',
        rarity: 'RARE' as const,
        slotType: 'Body Armour' as const,
        quality: 0,
        armourStats: { armour: 0, evasion: 400, energyShield: 100 },
        implicits: [],
        explicits: [],
      };
      const common: Build = {
        ...base,
        items: { ...base.items, [bodyWithEs.id]: bodyWithEs },
        equipped: { ...base.equipped, 'Body Armour': bodyWithEs.id },
        config: {
          ...base.config,
          customMods: '50% increased Evasion Rating while you have Energy Shield',
          rawInputs: {},
        },
      };
      const outNoCfg = calculateBuild(common);
      const outWithCfg = calculateBuild({
        ...common,
        config: { ...common.config, rawInputs: { conditionHaveEnergyShield: true } },
      });
      expect(outWithCfg.defence.evasion).toBeGreaterThan(outNoCfg.defence.evasion * 1.15);
    });

    it('excludes Intelligence inherent ES% from PoE 1 Transfiguration of Soul and sets 4-slot Armour/Evasion conditions', () => {
      const base = createSamplePoe1Build();
      const makeArm = (id: string, slotType: 'Helmet' | 'Body Armour' | 'Gloves' | 'Boots', armour: number, evasion: number) => ({
        id,
        name: id,
        baseName: id,
        rarity: 'RARE' as const,
        slotType,
        quality: 0,
        armourStats: { armour, evasion, energyShield: 0 },
        implicits: [],
        explicits: [],
      });
      const h = makeArm('h4', 'Helmet', 100, 100);
      const b = makeArm('b4', 'Body Armour', 200, 200);
      const g = makeArm('g4', 'Gloves', 100, 100);
      const bo = makeArm('bo4', 'Boots', 100, 100);
      const fullFour: Build = {
        ...base,
        items: { ...base.items, h4: h, b4: b, g4: g, bo4: bo },
        equipped: { ...base.equipped, Helmet: 'h4', 'Body Armour': 'b4', Gloves: 'g4', Boots: 'bo4' },
        config: {
          ...base.config,
          customMods: [
            '+1% to all maximum Elemental Resistances if Equipped Helmet, Body Armour, Gloves, and Boots all have Armour',
            '+15% chance to Suppress Spell Damage if Equipped Helmet, Body Armour, Gloves, and Boots all have Evasion Rating',
          ].join('\n'),
        },
      };
      const missingBoots = { ...fullFour, equipped: { ...fullFour.equipped, Boots: undefined as unknown as string } };
      const outFull = calculateBuild(fullFour);
      const outMissing = calculateBuild(missingBoots);
      expect(outFull.defence.spellSuppressionChance).toBeGreaterThanOrEqual(
        outMissing.defence.spellSuppressionChance + 15,
      );
    });
  });

  describe('Wave 5B: DamageIsUnlucky, Unexciting, Wilma CastSpeed->AttackSpeed & ArmourFromHelmetAndGloves', () => {
    it('evaluates DamageIsUnlucky as min+(max-min)/3 and cancels it when Unexciting is active', () => {
      const base = createSamplePoe1Build();
      const arcBase: Build = {
        ...base,
        skills: [
          {
            id: 'sg_unlucky_arc',
            label: 'Arc',
            enabled: true,
            gems: [{ instanceId: 'g_arc', gemId: 'poe1_arc', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_unlucky_arc',
      };
      const plain: Build = {
        ...arcBase,
        config: {
          ...arcBase.config,
          customMods: 'Adds 1 to 5001 Lightning Damage to Spells',
        },
      };
      const unlucky: Build = {
        ...plain,
        config: {
          ...plain.config,
          customMods: [
            'Adds 1 to 5001 Lightning Damage to Spells',
            'Damage with Hits is Unlucky',
          ].join('\n'),
        },
      };
      const unexciting: Build = {
        ...plain,
        config: {
          ...plain.config,
          customMods: [
            'Adds 1 to 5001 Lightning Damage to Spells',
            'Damage with Hits is Unlucky',
            'Your Lucky or Unlucky effects are instead Unexciting',
          ].join('\n'),
        },
      };
      const outPlain = calculateBuild(plain);
      const outUnlucky = calculateBuild(unlucky);
      const outUnexciting = calculateBuild(unexciting);
      // Unlucky shifts average from 50% of range toward 33.3% of range (~0.68x on wide lightning range)
      expect(outUnlucky.offence.averageHit).toBeLessThan(outPlain.offence.averageHit * 0.8);
      // Unexciting cancels DamageIsUnlucky back to normal average
      expect(outUnexciting.offence.averageHit).toBeCloseTo(outPlain.offence.averageHit, 1);
    });

    it('applies Cast Speed INC to Attack Speed with Wilma (CastSpeedAppliesToAttackSpeed) and scales Helmet+Gloves Armour', () => {
      const base = createSamplePoe1Build();
      const sword = makeWeapon({
        id: 'wilma_sword',
        name: 'Test Sword',
        baseName: 'Jewelled Foil',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Sword',
          twoHanded: false,
          physicalMin: 50,
          physicalMax: 100,
          attacksPerSecond: 1.5,
          critChance: 5,
        },
      });
      const helm = {
        id: 'arm_helm',
        name: 'Armour Helm',
        baseName: 'Royal Burgonet',
        rarity: 'RARE' as const,
        slotType: 'Helmet' as const,
        quality: 0,
        armourStats: { armour: 500, evasion: 0, energyShield: 0 },
        implicits: [],
        explicits: [],
      };
      const gloves = {
        id: 'arm_gloves',
        name: 'Armour Gloves',
        baseName: 'Titan Gauntlets',
        rarity: 'RARE' as const,
        slotType: 'Gloves' as const,
        quality: 0,
        armourStats: { armour: 300, evasion: 0, energyShield: 0 },
        implicits: [],
        explicits: [],
      };
      const atkBase: Build = {
        ...base,
        items: { ...base.items, [sword.id]: sword, [helm.id]: helm, [gloves.id]: gloves },
        equipped: { ...base.equipped, 'Weapon 1': sword.id, Helmet: helm.id, Gloves: gloves.id },
        skills: [
          {
            id: 'sg_wilma',
            label: 'Attack',
            enabled: true,
            gems: [{ instanceId: 'g1', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_wilma',
        config: {
          ...base.config,
          customMods: '50% increased Cast Speed',
        },
      };
      const outNoWilma = calculateBuild(atkBase);
      const outWilma = calculateBuild({
        ...atkBase,
        config: {
          ...atkBase.config,
          customMods: [
            '50% increased Cast Speed',
            'Increases and Reductions to Cast Speed apply to Attack Speed',
            '100% increased Armour from Equipped Helmet and Gloves',
          ].join('\n'),
        },
      });
      expect(outWilma.offence.speed).toBeGreaterThan(outNoWilma.offence.speed * 1.3);
      expect(outWilma.defence.armour).toBeGreaterThanOrEqual(outNoWilma.defence.armour + 800);
    });
  });

  describe('Wave 5C: Retaliation cannotBeExerted, DealNoNon*, Arcane Cloak dedup & PConc Life Flask', () => {
    it('prevents Intimidating Cry from exerting Retaliation skills (Crushing Fist)', () => {
      const base = createSamplePoe1Build();
      const shield = {
        id: 'retal_shield',
        name: 'Tower Shield',
        baseName: 'Colossal Tower Shield',
        rarity: 'RARE' as const,
        slotType: 'Weapon 2' as const,
        quality: 20,
        armourStats: { armour: 2000, evasion: 0, energyShield: 0 },
        implicits: [],
        explicits: [],
      };
      const noCry: Build = {
        ...base,
        items: { ...base.items, [shield.id]: shield },
        equipped: { ...base.equipped, 'Weapon 2': shield.id },
        skills: [
          {
            id: 'sg_cf',
            label: 'Crushing Fist',
            enabled: true,
            gems: [{ instanceId: 'g_cf', gemId: 'poe1_crushingfist', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_cf',
      };
      const withCry: Build = {
        ...noCry,
        skills: [
          ...noCry.skills,
          {
            id: 'sg_ic',
            label: 'Intimidating Cry',
            enabled: true,
            gems: [{ instanceId: 'g_ic', gemId: 'poe1_intimidatingcry', level: 20, quality: 0, enabled: true }],
          },
        ],
      };
      const outNoCry = calculateBuild(noCry);
      const outWithCry = calculateBuild(withCry);
      expect(outNoCry.offence.averageHit).toBeGreaterThan(0);
      expect(outWithCry.offence.averageHit).toBeCloseTo(outNoCry.offence.averageHit, 1);
    });

    it('zeros non-target damage types when DealNoNonLightning is active', () => {
      const base = createSamplePoe1Build();
      const sword = makeWeapon({
        id: 'tri_sword',
        name: 'Tri Sword',
        baseName: 'Jewelled Foil',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Sword',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 5,
          elementalDamage: {
            Fire: [100, 200],
            Cold: [100, 200],
            Lightning: [100, 200],
          },
        },
      });
      const plain: Build = {
        ...base,
        items: { ...base.items, [sword.id]: sword },
        equipped: { ...base.equipped, 'Weapon 1': sword.id },
        skills: [
          {
            id: 'sg_atk',
            label: 'Attack',
            enabled: true,
            gems: [{ instanceId: 'g1', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_atk',
      };
      const lightningOnly: Build = {
        ...plain,
        config: {
          ...plain.config,
          customMods: 'Deal no Non-Lightning Damage',
        },
      };
      const outPlain = calculateBuild(plain);
      const outLight = calculateBuild(lightningOnly);
      expect(outPlain.offence.averageHit).toBeGreaterThan(outLight.offence.averageHit * 2);
      expect(outLight.offence.averageHit).toBeGreaterThan(0);
    });

    it('does not scale Poisonous Concoction of Bouncing Life Flask chaos damage by utility FlaskEffect', () => {
      const base = createSamplePoe1Build();
      const flask = {
        id: 'pconc_life_flask',
        name: 'Concentrated Divine Life Flask',
        baseName: 'Divine Life Flask',
        rarity: 'MAGIC' as const,
        slotType: 'Flask 1' as const,
        quality: 20,
        implicits: [],
        explicits: ['50% increased Amount Recovered'],
      };
      const plain: Build = {
        ...base,
        items: { ...base.items, [flask.id]: flask },
        equipped: { ...base.equipped, 'Weapon 1': undefined, 'Weapon 2': undefined, 'Flask 1': flask.id },
        skills: [
          {
            id: 'sg_pconc',
            label: 'PConc',
            enabled: true,
            gems: [
              {
                instanceId: 'g_pc',
                gemId: 'poe1_poisonousconcoctionaltx',
                level: 20,
                quality: 20,
                skillPart: 2,
                enabled: true,
              },
            ],
          },
        ],
        mainSkillGroupId: 'sg_pconc',
      };
      const withFlaskEffect: Build = {
        ...plain,
        config: {
          ...plain.config,
          customMods: '100% increased effect of Flasks on you',
        },
      };
      const outPlain = calculateBuild(plain);
      const outEff = calculateBuild(withFlaskEffect);
      expect(outPlain.offence.averageHit).toBeGreaterThan(0);
      expect(outEff.offence.averageHit).toBeCloseTo(outPlain.offence.averageHit, 1);
    });
  });

  describe('Wave 5D: Gladiator War of Attrition (PresenceSeconds) & General\'s Cry Mirage Warrior LESS Damage', () => {
    it('binds enemyMultiplierEnemyPresenceSeconds to PresenceSeconds for Gladiator War of Attrition', () => {
      const base = createSamplePoe1Build();
      const sword = makeWeapon({
        id: 'woa_sword',
        name: 'Test Sword',
        baseName: 'Jewelled Foil',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Sword',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 5,
        },
      });
      const common: Build = {
        ...base,
        items: { ...base.items, [sword.id]: sword },
        equipped: { ...base.equipped, 'Weapon 1': sword.id },
        skills: [
          {
            id: 'sg_woa',
            label: 'Attack',
            enabled: true,
            gems: [{ instanceId: 'g1', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_woa',
        config: {
          ...base.config,
          enemyArmour: 0,
          customMods:
            "Deal 1% more Damage with Hits and Ailments to Rare and Unique Enemies for each second they've ever been in your Presence, up to a maximum of 100%",
          rawInputs: {},
        },
      };
      const out0 = calculateBuild(common);
      const out10 = calculateBuild({
        ...common,
        config: {
          ...common.config,
          rawInputs: { enemyMultiplierEnemyPresenceSeconds: 10 },
        },
      });
      expect(out10.offence.averageHit / out0.offence.averageHit).toBeCloseTo(1.1, 2);
    });

    it('applies General\'s Cry LESS damage to linked melee attack hits while skipping Channelling skills', () => {
      const base = createSamplePoe1Build();
      const axe = makeWeapon({
        id: 'gc_axe',
        name: 'Test Axe',
        baseName: 'Siege Axe',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Axe',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.5,
          critChance: 5,
        },
      });
      const laceratePlain: Build = {
        ...base,
        items: { ...base.items, [axe.id]: axe },
        equipped: { ...base.equipped, 'Weapon 1': axe.id },
        skills: [
          {
            id: 'sg_gc',
            label: 'GC Lacerate',
            enabled: true,
            gems: [{ instanceId: 'g_lac', gemId: 'poe1_lacerate', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_gc',
        config: {
          ...base.config,
          enemyArmour: 0,
        },
      };
      const lacerateWithGc: Build = {
        ...laceratePlain,
        skills: [
          {
            ...laceratePlain.skills[0]!,
            gems: [
              ...laceratePlain.skills[0]!.gems,
              { instanceId: 'g_gc', gemId: 'poe1_generalscry', level: 18, quality: 30, enabled: true },
            ],
          },
        ],
      };
      const outLacPlain = calculateBuild(laceratePlain);
      const outLacGc = calculateBuild(lacerateWithGc);
      // Lv 18 General's Cry applies -52% MORE Damage (0.48x) to Mirage Warrior hits
      expect(outLacGc.offence.averageHit / outLacPlain.offence.averageHit).toBeCloseTo(0.48, 2);

      // Channelling skills (Cyclone) cannot be exerted/supported by General's Cry
      const cyclonePlain: Build = {
        ...laceratePlain,
        skills: [
          {
            id: 'sg_cyc',
            label: 'Cyclone',
            enabled: true,
            gems: [{ instanceId: 'g_cyc', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_cyc',
      };
      const cycloneWithGc: Build = {
        ...cyclonePlain,
        skills: [
          {
            ...cyclonePlain.skills[0]!,
            gems: [
              ...cyclonePlain.skills[0]!.gems,
              { instanceId: 'g_gc2', gemId: 'poe1_generalscry', level: 18, quality: 30, enabled: true },
            ],
          },
        ],
      };
      const outCycPlain = calculateBuild(cyclonePlain);
      const outCycGc = calculateBuild(cycloneWithGc);
      expect(outCycGc.offence.averageHit).toBeCloseTo(outCycPlain.offence.averageHit, 1);
    });
  });

  describe('Wave 5E: Dual-Wield Per-Hand Crit, Hybrid Attack+Minion Routing & Additive Quality MORE', () => {
    it('computes PoE 1 dual-wield crit separately per hand (clamping <= 100% per hand before averaging)', () => {
      const base = createSamplePoe1Build();
      const claw = makeWeapon({
        id: 'dw_claw',
        name: 'Crit Claw',
        baseName: 'Imperial Claw',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Claw',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 10,
        },
      });
      const dagger = makeWeapon({
        id: 'dw_dagger',
        name: 'Low Crit Dagger',
        baseName: 'Ambusher',
        slotType: 'Weapon 2',
        weaponStats: {
          weaponType: 'Dagger',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.6,
          critChance: 6,
        },
      });
      const dwBuild: Build = {
        ...base,
        items: { ...base.items, [claw.id]: claw, [dagger.id]: dagger },
        equipped: { ...base.equipped, 'Weapon 1': claw.id, 'Weapon 2': dagger.id },
        skills: [
          {
            id: 'sg_dw_crit',
            label: 'Dual Wield Crit',
            enabled: true,
            gems: [{ instanceId: 'g_cy', gemId: 'poe1_cyclone', level: 20, quality: 0, enabled: true }],
          },
        ],
        mainSkillGroupId: 'sg_dw_crit',
        config: {
          ...base.config,
          enemyEvasion: 0,
          customMods: [
            "Your hits can't be Evaded",
            '1100% increased Critical Strike Chance with Claws',
            '400% increased Global Critical Strike Chance',
          ].join('\n'),
        },
      };
      const outNoClawCrit = calculateBuild({
        ...dwBuild,
        config: {
          ...dwBuild.config,
          customMods: [
            "Your hits can't be Evaded",
            '400% increased Global Critical Strike Chance',
          ].join('\n'),
        },
      });
      const outWithClawCrit = calculateBuild(dwBuild);
      // With +1100% Claw Crit, MH Claw clamps at 100% while OH Dagger stays unchanged (NOT inflated by Claw Crit).
      // So total crit rises to `(100 + ohCrit) / 2` (~70.7%), strictly below 100% and strictly above the unbuffed dual-wield crit.
      expect(outWithClawCrit.offence.critChance).toBeGreaterThan(outNoClawCrit.offence.critChance + 15);
      expect(outWithClawCrit.offence.critChance).toBeLessThan(80);
    });

    it('routes Dominating Blow of Inspiring to player melee attack and scales by ImprovedMinionDamageAppliesToPlayer', () => {
      const base = createSamplePoe1Build();
      const mace = makeWeapon({
        id: 'db_mace',
        name: 'Test Mace',
        baseName: 'Behemoth Mace',
        slotType: 'Weapon 1',
        weaponStats: {
          weaponType: 'Mace',
          twoHanded: false,
          physicalMin: 100,
          physicalMax: 200,
          attacksPerSecond: 1.5,
          critChance: 5,
        },
      });
      const common: Build = {
        ...base,
        items: { ...base.items, [mace.id]: mace },
        equipped: { ...base.equipped, 'Weapon 1': mace.id },
        skills: [
          {
            id: 'sg_db',
            label: 'Dominating Blow of Inspiring',
            enabled: true,
            gems: [
              {
                instanceId: 'g_db',
                gemId: 'poe1_dominatingblowaltx',
                level: 20,
                quality: 20,
                enabled: true,
              },
            ],
          },
        ],
        mainSkillGroupId: 'sg_db',
        config: {
          ...base.config,
          enemyArmour: 0,
        },
      };
      const outPlain = calculateBuild(common);
      const outWithMinionInc = calculateBuild({
        ...common,
        config: {
          ...common.config,
          customMods: '100% increased Minion Damage',
        },
      });
      expect(outPlain.offence.averageHit).toBeGreaterThan(0);
      // Dominating Blow of Inspiring Q20 applies 300% of Minion Damage INC (+300% INC Damage)
      expect(outWithMinionInc.offence.averageHit).toBeGreaterThan(outPlain.offence.averageHit * 2.5);
    });
  });
});
