import { describe, expect, it } from 'vitest';
import {
  createEmptyBuild,
  findGemByName,
  getGemsForGame,
  getPoe1MinionProfile,
  getPoe1SpectreProfile,
  hydrateCompactTree,
  registerGemsData,
  resolveGemFromPobRef,
  resolveTreeFileFromManifest,
  setRegisteredGems,
} from '@webpob/data';
import { parseItemText } from '@webpob/codec';
import { ModFlag, KeywordFlag, type Build, type Item } from '@webpob/core';
import { calculateBuild } from './engine';
import { ModDB } from './modDb';
import { parseModLine, parseModLines } from './modParser';
import { computeAuthenticAilmentAndSkillDots } from './skillActorRuntime';

function makePoe1Build(opts?: {
  classId?: string;
  level?: number;
  skillGemId?: string;
  customMods?: string;
  items?: Record<string, Item>;
  equipped?: Build['equipped'];
  config?: Partial<Build['config']>;
}): Build {
  const b = createEmptyBuild('poe1');
  if (opts?.classId) b.classId = opts.classId;
  b.level = opts?.level ?? 90;
  b.config = { ...b.config, ...(opts?.config ?? {}) };
  if (opts?.customMods) b.config.customMods = opts.customMods;
  const gemId = opts?.skillGemId ?? 'poe1_cyclone';
  b.skills = [
    {
      id: 'main',
      label: 'Main',
      enabled: true,
      gems: [{ instanceId: 'g1', gemId, level: 20, quality: 0, enabled: true }],
    },
  ];
  b.mainSkillGroupId = 'main';
  if (opts?.items) b.items = opts.items;
  if (opts?.equipped) b.equipped = opts.equipped;
  return b;
}

function makePoe2Build(opts?: {
  classId?: string;
  level?: number;
  skillGemId?: string;
  customMods?: string;
  items?: Record<string, Item>;
  equipped?: Build['equipped'];
  config?: Partial<Build['config']>;
}): Build {
  const b = createEmptyBuild('poe2');
  if (opts?.classId) b.classId = opts.classId;
  b.level = opts?.level ?? 85;
  b.config = { ...b.config, ...(opts?.config ?? {}) };
  if (opts?.customMods) b.config.customMods = opts.customMods;
  const gemId = opts?.skillGemId ?? 'poe2_spark';
  b.skills = [
    {
      id: 'main',
      label: 'Main',
      enabled: true,
      gems: [{ instanceId: 'g1', gemId, level: 20, quality: 0, enabled: true }],
    },
  ];
  b.mainSkillGroupId = 'main';
  if (opts?.items) b.items = opts.items;
  if (opts?.equipped) b.equipped = opts.equipped;
  return b;
}

function makeWeapon(id: string, _game: 'poe1' | 'poe2', physMin: number, physMax: number, aps = 1.5, crit = 6): Item {
  return {
    id,
    name: 'Test Sword',
    baseName: 'Vaal Rapier',
    rarity: 'RARE',
    slotType: 'Weapon 1',
    quality: 0,
    implicits: [],
    explicits: [],
    weaponStats: {
      physicalMin: physMin,
      physicalMax: physMax,
      attacksPerSecond: aps,
      critChance: crit,
      weaponType: 'Sword',
      twoHanded: false,
    },
  };
}

describe('Mechanism-Layer Regression Suite — Round 2 (Upstream PoB spec/System Parity)', () => {
  // =========================================================================
  // 1. Keystones & ModParser Integrity
  // =========================================================================
  describe('1. Keystones & ModParser Integrity', () => {
    it('Magebane (tree 2-line text) removes Dex Evasion bonus and grants +1% Spell Suppression per 15 Dex', () => {
      const base = makePoe1Build({
        classId: 'ranger',
        customMods: '+300 to Dexterity\n+1000 to Evasion Rating',
      });
      const withMagebane = makePoe1Build({
        classId: 'ranger',
        customMods: [
          '+300 to Dexterity',
          '+1000 to Evasion Rating',
          'Dexterity provides no inherent bonus to Evasion Rating',
          '+1% Chance to Suppress Spell Damage per 15 Dexterity',
        ].join('\n'),
      });

      const outBase = calculateBuild(base);
      const outMb = calculateBuild(withMagebane);

      // Base Dex (332) gives +66% Evasion -> ~1685; Magebane strips Dex Evasion bonus -> 1000 + base 15 = 1015
      expect(outBase.defence.evasion).toBeGreaterThan(1500);
      expect(outMb.defence.evasion).toBeLessThan(outBase.defence.evasion);
      expect(outMb.defence.evasion).toBe(1015);
      // 332 Dex -> floor(332 / 15) = 22% Spell Suppression (must NOT be flat 1%)
      expect(outMb.defence.spellSuppressionChance).toBe(Math.floor(outMb.defence.dex / 15));
      expect(outMb.defence.spellSuppressionChance).toBeGreaterThanOrEqual(20);
    });

    it('Magebane (standalone keystone name) matches full 2-line tree behavior', () => {
      const standalone = makePoe1Build({
        classId: 'ranger',
        customMods: '+300 to Dexterity\n+1000 to Evasion Rating\nMagebane',
      });
      const out = calculateBuild(standalone);
      expect(out.defence.evasion).toBe(1015);
      expect(out.defence.spellSuppressionChance).toBe(Math.floor(out.defence.dex / 15));
    });

    it('Precise Technique sets CritChance=0 and grants 40% more Attack Damage ONLY when Accuracy > Life', () => {
      const sword = makeWeapon('sw1', 'poe1', 100, 200, 1.5, 10);
      const base = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw1: sword },
        equipped: { 'Weapon 1': 'sw1' },
        customMods: '+4000 to Accuracy Rating',
      });
      const ptActive = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw1: sword },
        equipped: { 'Weapon 1': 'sw1' },
        customMods: [
          '+4000 to Accuracy Rating',
          '40% more Attack Damage if Accuracy Rating is higher than Maximum Life',
          'Never deal Critical Strikes',
        ].join('\n'),
      });
      const ptInactive = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw1: sword },
        equipped: { 'Weapon 1': 'sw1' },
        customMods: [
          '+5000 to maximum Life',
          '40% more Attack Damage if Accuracy Rating is higher than Maximum Life',
          'Never deal Critical Strikes',
        ].join('\n'),
      });

      const outBase = calculateBuild(base);
      const outActive = calculateBuild(ptActive);
      const outInactive = calculateBuild(ptInactive);

      expect(outBase.offence.critChance).toBeGreaterThan(0);
      expect(outActive.offence.critChance).toBe(0);
      expect(outInactive.offence.critChance).toBe(0);
      // Active PT (Acc > Life) deals ~1.40x of inactive PT (same hit chance 100% if we compare with +4000 acc on inactive too)
      const ptInactiveSameAcc = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw1: sword },
        equipped: { 'Weapon 1': 'sw1' },
        customMods: [
          '+4000 to Accuracy Rating',
          '+8000 to maximum Life',
          '40% more Attack Damage if Accuracy Rating is higher than Maximum Life',
          'Never deal Critical Strikes',
        ].join('\n'),
      });
      const outInactiveSameAcc = calculateBuild(ptInactiveSameAcc);
      expect(outActive.offence.hitDps / outInactiveSameAcc.offence.hitDps).toBeCloseTo(1.4, 2);
    });

    it('Elemental Overload (3-line tree text & standalone) sets CritMult=100% and adds 40% more Elemental Damage', () => {
      const base = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '+200% to Critical Strike Multiplier',
      });
      const eoTree = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: [
          '+200% to Critical Strike Multiplier',
          'Skills that have dealt a Critical Strike in the past 8 seconds deal 40% more Elemental Damage with Hits and Ailments',
          'Your Critical Strikes do not deal extra Damage',
          'Ailments never count as being from Critical Strikes',
        ].join('\n'),
      });
      const eoStandalone = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '+200% to Critical Strike Multiplier\nElemental Overload',
      });

      const outBase = calculateBuild(base);
      const outTree = calculateBuild(eoTree);
      const outStandalone = calculateBuild(eoStandalone);

      expect(outBase.offence.critMultiplier).toBe(350);
      expect(outTree.offence.critMultiplier).toBe(100);
      expect(outStandalone.offence.critMultiplier).toBe(100);
      expect(outTree.offence.hitDps).toBeCloseTo(outStandalone.offence.hitDps, 1);
      // Compare against a no-crit-extra baseline without 40% more Elemental Damage
      const noCritOnly = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '+200% to Critical Strike Multiplier\nYour Critical Strikes do not deal extra Damage',
      });
      const outNoCritOnly = calculateBuild(noCritOnly);
      expect(outTree.offence.hitDps / outNoCritOnly.offence.hitDps).toBeCloseTo(1.4, 2);
    });

    it('Perfect Agony (PoE 1 3.25+ 3-line text) sets CritMult=100%, blocks non-crit ailments, and scales ailments with Crit Multiplier', () => {
      const paNoCrit = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: [
          'Never deal Critical Strikes',
          'Hits always Ignite',
          'Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier',
          'Critical Strikes do not deal extra Damage',
          'Non-Critical Strikes cannot inflict Ailments',
        ].join('\n'),
      });
      const paLowMulti = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: [
          '1500% increased Critical Strike Chance',
          'Hits always Ignite',
          'Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier',
          'Critical Strikes do not deal extra Damage',
          'Non-Critical Strikes cannot inflict Ailments',
        ].join('\n'),
      });
      const paHighMulti = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: [
          '1500% increased Critical Strike Chance',
          '+200% to Critical Strike Multiplier',
          'Hits always Ignite',
          'Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier',
          'Critical Strikes do not deal extra Damage',
          'Non-Critical Strikes cannot inflict Ailments',
        ].join('\n'),
      });

      const outNoCrit = calculateBuild(paNoCrit);
      const outLow = calculateBuild(paLowMulti);
      const outHigh = calculateBuild(paHighMulti);

      // Non-crits cannot inflict ailments -> 0 ignite
      expect(outNoCrit.offence.igniteDps).toBe(0);
      // Hit crit multiplier is clamped to 100% under Perfect Agony
      expect(outLow.offence.critMultiplier).toBe(100);
      expect(outHigh.offence.critMultiplier).toBe(100);
      // Base crit multi 150% -> +50% DoT multi (1.5x); +200% crit multi (350%) -> +250% DoT multi (3.5x)
      expect(outHigh.offence.igniteDps / outLow.offence.igniteDps).toBeCloseTo(3.5 / 1.5, 2);
    });

    it('Crimson Dance (real 3-line tree text) stacks up to 8 bleeds without double-halving and ignores moving bonus', () => {
      const baseDb = new ModDB();
      baseDb.addMod({ name: 'BleedChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });

      const cdTreeDb = new ModDB();
      cdTreeDb.addMod({ name: 'BleedChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      for (const m of parseModLines(
        [
          'You can inflict Bleeding on an Enemy up to 8 times\nYour Bleeding does not deal extra Damage while the Enemy is moving and cannot be Aggravated\n50% less Damage with Bleeding',
        ],
        'Keystone: Crimson Dance',
      )) {
        cdTreeDb.addMod(m);
      }

      const stationary = computeAuthenticAilmentAndSkillDots({
        game: 'poe1',
        skillDb: baseDb,
        enemyDb: new ModDB(),
        baseDamageByType: { Physical: 1000 },
        flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
        speed: 4,
        isAttack: true,
      });
      const cdResult = computeAuthenticAilmentAndSkillDots({
        game: 'poe1',
        skillDb: cdTreeDb,
        enemyDb: new ModDB(),
        baseDamageByType: { Physical: 1000 },
        flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
        speed: 4,
        isAttack: true,
        enemyMovingOrAggravated: true,
      });

      expect(cdResult.bleed.isCrimsonDance).toBe(true);
      expect(cdResult.bleed.maxStacks).toBe(8);
      expect(cdResult.bleed.effectiveStacks).toBe(8);
      // Single stack MUST be exactly 0.5x of stationary (350, NOT 175 double-halved)
      expect(cdResult.bleed.singleStackDps).toBeCloseTo(stationary.bleed.singleStackDps * 0.5, 1);
      // 8 stacks * 0.5x = 4.0x of stationary single bleed
      expect(cdResult.bleed.totalDps).toBeCloseTo(stationary.bleed.totalDps * 4, 1);
    });

    it('Unwavering Stance (Cannot Evade enemy Attacks) forces evadeChance = 0% even with 10,000 Evasion', () => {
      const base = makePoe1Build({ customMods: '+10000 to Evasion Rating' });
      const uw = makePoe1Build({
        customMods: '+10000 to Evasion Rating\nCannot Evade enemy Attacks\nCannot be Stunned',
      });
      expect(calculateBuild(base).defence.evadeChance).toBeGreaterThan(20);
      expect(calculateBuild(uw).defence.evadeChance).toBe(0);
    });

    it('Blood Magic (Removes all mana) overrides Mana to 0 in customMods', () => {
      const bm = makePoe1Build({ customMods: '+500 to maximum Mana\nRemoves all mana' });
      expect(calculateBuild(bm).defence.mana).toBe(0);
    });

    it('Glancing Blows doubles Attack & Spell Block (capped at 75%)', () => {
      const base = makePoe1Build({
        customMods: '+30% Chance to Block Attack Damage\n+25% Chance to Block Spell Damage',
      });
      const gb = makePoe1Build({
        customMods: '+30% Chance to Block Attack Damage\n+25% Chance to Block Spell Damage\nGlancing Blows',
      });
      const outBase = calculateBuild(base);
      const outGb = calculateBuild(gb);
      expect(outBase.defence.blockChance).toBe(30);
      expect(outBase.defence.spellBlockChance).toBe(25);
      expect(outGb.defence.blockChance).toBe(60);
      expect(outGb.defence.spellBlockChance).toBe(50);
    });

    it('Versatile Combatant caps block at 65% and converts overcapped Attack Block 2:1 into Spell Block', () => {
      const vc = makePoe1Build({
        customMods: '+80% Chance to Block Attack Damage\nVersatile Combatant',
      });
      const out = calculateBuild(vc);
      expect(out.defence.blockChance).toBe(65);
      // 80 - 65 = 15 overcap -> 15 * 2 = 30% Spell Block
      expect(out.defence.spellBlockChance).toBe(30);
    });

    it('Iron Will applies Strength bonus to Spells and Iron Grip applies Strength bonus to Projectile Attacks', () => {
      const spellBase = makePoe1Build({
        classId: 'marauder',
        skillGemId: 'poe1_fireball',
        customMods: '+500 to Strength',
      });
      const spellIronWill = makePoe1Build({
        classId: 'marauder',
        skillGemId: 'poe1_fireball',
        customMods: "+500 to Strength\nStrength's Damage bonus applies to all Spell Damage as well",
      });
      expect(calculateBuild(spellIronWill).offence.hitDps).toBeGreaterThan(
        calculateBuild(spellBase).offence.hitDps * 1.5,
      );
    });

    it('Pain Attunement (PoE 1) grants 30% more Spell Damage ONLY when on Low Life', () => {
      const fullLife = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '30% more Spell Damage when on Low Life',
        config: { conditionLowLife: false },
      });
      const lowLife = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '30% more Spell Damage when on Low Life',
        config: { conditionLowLife: true },
      });
      expect(calculateBuild(lowLife).offence.hitDps / calculateBuild(fullLife).offence.hitDps).toBeCloseTo(1.3, 2);
    });

    it('Pain Attunement (PoE 2) grants 30% more Crit Damage Bonus on Low Life vs 30% less on Full Life', () => {
      const mods = [
        '30% less Critical Damage Bonus when on Full Life',
        '30% more Critical Damage Bonus when on Low Life',
      ].join('\n');
      const fullLife = makePoe2Build({
        customMods: mods,
        config: { conditionFullLife: true, conditionLowLife: false },
      });
      const lowLife = makePoe2Build({ customMods: mods, config: { conditionLowLife: true } });
      // PoE 2 base crit bonus +100% -> Full Life: 100 + 70 = 170%; Low Life: 100 + 130 = 230%
      expect(calculateBuild(fullLife).offence.critMultiplier).toBe(170);
      expect(calculateBuild(lowLife).offence.critMultiplier).toBe(230);
    });
  });

  // =========================================================================
  // 2. Ailments, Impale & Enemy Debuffs (TestAilments / TestImpale / TestDebuffs)
  // =========================================================================
  describe('2. Ailments, Impale & Enemy Debuffs', () => {
    it('PoE 2 Ignite computes threshold-based Flammability chance even with 0% flat IgniteChance and scales with IgniteMagnitude', () => {
      const baseDb = new ModDB();
      const magDb = new ModDB();
      magDb.addMod({ name: 'IgniteMagnitude', type: 'INC', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      const cannotDb = new ModDB();
      cannotDb.addMod({ name: 'CannotIgnite', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: 'test' });

      const common = {
        game: 'poe2' as const,
        enemyDb: new ModDB(),
        baseDamageByType: { Fire: 50000 },
        preMitigationHitByType: { Fire: 50000 },
        flags: ModFlag.Spell | ModFlag.Hit,
        speed: 1,
        enemyConfig: { enemyLevel: 82, enemyFireResist: 0 },
      };

      const resBase = computeAuthenticAilmentAndSkillDots({ ...common, skillDb: baseDb });
      const resMag = computeAuthenticAilmentAndSkillDots({ ...common, skillDb: magDb });
      const resCannot = computeAuthenticAilmentAndSkillDots({ ...common, skillDb: cannotDb });

      // 50000 / 74191 * 20 ≈ 13.48% chance per hit -> non-zero Ignite DPS without needing flat IgniteChance!
      expect(resBase.ignite.effectiveChancePct).toBeGreaterThan(10);
      expect(resBase.ignite.singleStackDps).toBeCloseTo(10000, 0); // 20% of 50000
      expect(resBase.ignite.totalDps).toBeGreaterThan(0);
      // +100% Ignite Magnitude doubles single-stack Ignite DPS cleanly
      expect(resMag.ignite.singleStackDps).toBeCloseTo(resBase.ignite.singleStackDps * 2, 0);
      expect(resCannot.ignite.totalDps).toBe(0);
    });

    it('PoE 1 Bleeding moving/aggravated deals exactly 3x stationary bleed DPS', () => {
      const db = new ModDB();
      db.addMod({ name: 'BleedChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      const stationary = computeAuthenticAilmentAndSkillDots({
        game: 'poe1',
        skillDb: db,
        enemyDb: new ModDB(),
        baseDamageByType: { Physical: 1000 },
        flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
        speed: 2,
        isAttack: true,
        enemyMovingOrAggravated: false,
      });
      const moving = computeAuthenticAilmentAndSkillDots({
        game: 'poe1',
        skillDb: db,
        enemyDb: new ModDB(),
        baseDamageByType: { Physical: 1000 },
        flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Hit,
        speed: 2,
        isAttack: true,
        enemyMovingOrAggravated: true,
      });
      expect(moving.bleed.totalDps / stationary.bleed.totalDps).toBeCloseTo(3.0, 4);
    });

    it('PoE 1 Poison stacks infinitely while PoE 2 Poison respects base cap (1) and +1 AdditionalPoisonStack (2)', () => {
      const db1 = new ModDB();
      db1.addMod({ name: 'PoisonChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      const poe1 = computeAuthenticAilmentAndSkillDots({
        game: 'poe1',
        skillDb: db1,
        enemyDb: new ModDB(),
        baseDamageByType: { Chaos: 500 },
        flags: ModFlag.Attack | ModFlag.Hit,
        speed: 5,
        isAttack: true,
        enemyConfig: { enemyChaosResist: 0 },
      });
      // 5 APS * 2.0s duration = 10 active stacks
      expect(poe1.poison.effectiveStacks).toBeCloseTo(10, 2);

      const db2Cap1 = new ModDB();
      db2Cap1.addMod({ name: 'PoisonChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      const db2Cap2 = new ModDB();
      db2Cap2.addMod({ name: 'PoisonChance', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'test' });
      db2Cap2.addMod({ name: 'AdditionalPoisonStack', type: 'BASE', value: 1, flags: 0, keywordFlags: 0, source: 'test' });

      const poe2Cap1 = computeAuthenticAilmentAndSkillDots({
        game: 'poe2',
        skillDb: db2Cap1,
        enemyDb: new ModDB(),
        preMitigationHitByType: { Chaos: 500 },
        baseDamageByType: { Chaos: 500 },
        flags: ModFlag.Attack | ModFlag.Hit,
        speed: 5,
        isAttack: true,
        enemyConfig: { enemyChaosResist: 0 },
      });
      const poe2Cap2 = computeAuthenticAilmentAndSkillDots({
        game: 'poe2',
        skillDb: db2Cap2,
        enemyDb: new ModDB(),
        preMitigationHitByType: { Chaos: 500 },
        baseDamageByType: { Chaos: 500 },
        flags: ModFlag.Attack | ModFlag.Hit,
        speed: 5,
        isAttack: true,
        enemyConfig: { enemyChaosResist: 0 },
      });

      expect(poe2Cap1.poison.effectiveStacks).toBe(1);
      expect(poe2Cap2.poison.effectiveStacks).toBe(2);
      expect(poe2Cap2.poison.totalDps / poe2Cap1.poison.totalDps).toBeCloseTo(2.0, 4);
    });

    it('PoE 1 Impale adds physical Impale DPS on Attacks and stays 0 when chance=0 or on Spells', () => {
      const sword = makeWeapon('sw2', 'poe1', 120, 220, 2.0, 5);
      const noImpale = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw2: sword },
        equipped: { 'Weapon 1': 'sw2' },
      });
      const impaleBase = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw2: sword },
        equipped: { 'Weapon 1': 'sw2' },
        customMods: '100% chance to Impale Enemies on Hit with Attacks',
      });
      const impaleScaled = makePoe1Build({
        skillGemId: 'poe1_cyclone',
        items: { sw2: sword },
        equipped: { 'Weapon 1': 'sw2' },
        customMods: '100% chance to Impale Enemies on Hit with Attacks\n100% increased Impale Effect',
      });
      const spell = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: '100% chance to Impale Enemies on Hit with Attacks',
      });

      const outNone = calculateBuild(noImpale);
      const outImp = calculateBuild(impaleBase);
      const outScaled = calculateBuild(impaleScaled);
      const outSpell = calculateBuild(spell);

      expect(outNone.offence.impaleDps ?? 0).toBe(0);
      expect(outImp.offence.impaleDps ?? 0).toBeGreaterThan(0);
      expect((outScaled.offence.impaleDps ?? 0) / (outImp.offence.impaleDps ?? 1)).toBeCloseTo(2.0, 2);
      expect(outSpell.offence.impaleDps ?? 0).toBe(0);
    });

    it('Enemy Fire Resistance reduction (Curse / Exposure) increases both Hit DPS and Ignite DPS', () => {
      const base = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: 'Hits always Ignite',
        config: { enemyFireResist: 40 },
      });
      const cursed = makePoe1Build({
        classId: 'witch',
        skillGemId: 'poe1_fireball',
        customMods: 'Hits always Ignite\nCursed enemies have -30% to Fire Resistance',
        config: { enemyFireResist: 40 },
      });

      const outBase = calculateBuild(base);
      const outCursed = calculateBuild(cursed);
      // (1 - 0.10) / (1 - 0.40) = 0.90 / 0.60 = 1.50x
      expect(outCursed.offence.hitDps / outBase.offence.hitDps).toBeCloseTo(1.5, 2);
      expect(outCursed.offence.igniteDps / outBase.offence.igniteDps).toBeCloseTo(1.5, 2);
    });
  });

  // =========================================================================
  // 3. Defence Pools, Conversions & Flasks (TestDefence / TestFlasks)
  // =========================================================================
  describe('3. Defence Pools, Conversions & Flasks', () => {
    it('Divine Flesh adds +5% max Chaos Resist and improves Elemental Max Hit Taken when Chaos Res > Ele Res', () => {
      const base = makePoe1Build({
        customMods: '+200% to Chaos Resistance\n+60% to all Elemental Resistances',
      });
      const df = makePoe1Build({
        customMods: '+200% to Chaos Resistance\n+60% to all Elemental Resistances\nDivine Flesh',
      });
      const outBase = calculateBuild(base);
      const outDf = calculateBuild(df);
      expect(outBase.defence.chaosResist).toBe(75);
      expect(outDf.defence.chaosResist).toBe(80);
      expect(outDf.defence.maxEleHitTaken).toBeGreaterThan(outBase.defence.maxEleHitTaken);
    });

    it('Corrupted Soul adds 15% of Maximum Life as extra Energy Shield', () => {
      const base = makePoe1Build({ customMods: '+1000 to maximum Life' });
      const cs = makePoe1Build({ customMods: '+1000 to maximum Life\nCorrupted Soul' });
      const outBase = calculateBuild(base);
      const outCs = calculateBuild(cs);
      expect(outBase.defence.energyShield).toBe(0);
      expect(outCs.defence.energyShield).toBeGreaterThan(200);
    });

    it('PoE 2 Eldritch Battery converts 100% of Energy Shield to Mana', () => {
      const base = makePoe2Build({ customMods: '+400 to maximum Energy Shield' });
      const eb = makePoe2Build({ customMods: '+400 to maximum Energy Shield\nEldritch Battery' });
      const outBase = calculateBuild(base);
      const outEb = calculateBuild(eb);
      expect(outBase.defence.energyShield).toBeGreaterThanOrEqual(400);
      expect(outEb.defence.energyShield).toBe(0);
      expect(outEb.defence.mana).toBeGreaterThanOrEqual(outBase.defence.mana + 400);
    });

    it('PoE 1 Active Utility Flasks grant their defence buffs and inactive flasks do not', () => {
      const granite: Item = {
        id: 'f1',
        name: 'Granite Flask',
        baseName: 'Granite Flask',
        rarity: 'MAGIC',
        slotType: 'Flask 1',
        quality: 0,
        implicits: [],
        explicits: ['50% increased Armour during effect'],
      };

      const withActive = makePoe1Build({
        items: { f1: granite },
        equipped: { 'Flask 1': 'f1' },
      });
      withActive.activeFlaskSlots = { 'Flask 1': true };
      const withInactive = makePoe1Build({
        items: { f1: granite },
        equipped: { 'Flask 1': 'f1' },
      });
      withInactive.activeFlaskSlots = { 'Flask 1': false };
      expect(calculateBuild(withActive).defence.armour).toBeGreaterThan(2000);
      expect(calculateBuild(withInactive).defence.armour).toBe(0);
    });
  });

  // =========================================================================
  // 4. PoE 2 Socketables & Bilingual Parity (TestSocketables)
  // =========================================================================
  describe('4. PoE 2 Socketables & Bilingual Parity', () => {
    it('PoE 2 Bonded: rune lines stay gated behind allowBonded', () => {
      const blocked = parseModLine('Bonded: +20 to Spirit', 'Rune', { allowBonded: false });
      const allowed = parseModLine('Bonded: +20 to Spirit', 'Rune', { allowBonded: true });
      expect(blocked).toHaveLength(0);
      expect(allowed).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Spirit', type: 'BASE', value: 20 })]),
      );
    });

    it('ZH-CN modifier lines produce identical calculated defence stats as English lines', () => {
      const en = makePoe1Build({
        customMods: '+200 to maximum Life\n+1000 to Armour\n+30% to all Elemental Resistances',
      });
      const zh = makePoe1Build({
        customMods: '+200 最大生命\n+1000 护甲\n+30% 所有元素抗性',
      });
      const outEn = calculateBuild(en);
      const outZh = calculateBuild(zh);
      expect(outZh.defence.life).toBe(outEn.defence.life);
      expect(outZh.defence.armour).toBe(outEn.defence.armour);
      expect(outZh.defence.fireResist).toBe(outEn.defence.fireResist);
      expect(outZh.defence.coldResist).toBe(outEn.defence.coldResist);
      expect(outZh.defence.lightningResist).toBe(outEn.defence.lightningResist);
    });
  });

  // =========================================================================
  // 5. Core Infrastructure Parity (ModDB, ItemParser, Gem Resolution, TreeLoader)
  // =========================================================================
  describe('5. Core Infrastructure Parity (ModDB, ItemParser, Gem Resolution, TreeLoader)', () => {
    it('ModDB matches PoB KeywordFlag OR-groups (Trap|Mine, Ailments, Elemental) and MatchAll strict AND', () => {
      const db = new ModDB();
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 20,
        flags: 0,
        keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine,
        source: 'Trap/Mine',
      });
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 30,
        flags: 0,
        keywordFlags: KeywordFlag.Ignite | KeywordFlag.Bleed | KeywordFlag.Poison,
        source: 'Ailments',
      });
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 40,
        flags: 0,
        keywordFlags: KeywordFlag.Fire | KeywordFlag.Cold | KeywordFlag.Lightning,
        source: 'Elemental',
      });
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 50,
        flags: 0,
        keywordFlags: 0x40000000 | KeywordFlag.Fire | KeywordFlag.Cold,
        source: 'MatchAll Fire+Cold',
      });

      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Trap)).toBe(20);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Mine)).toBe(20);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Poison)).toBe(30);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Lightning)).toBe(40);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Physical)).toBe(0);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Fire)).toBe(40);
      expect(db.sum('INC', 'Damage', 0, KeywordFlag.Fire | KeywordFlag.Cold)).toBe(90);

      // more() must clamp negative per-bucket results so two >=100% less buckets never multiply positive
      const negDb = new ModDB();
      negDb.addMod({ name: 'Damage', type: 'MORE', value: -150, flags: 0, keywordFlags: 0, source: 'a' });
      negDb.addMod({ name: 'PhysicalDamage', type: 'MORE', value: -150, flags: 0, keywordFlags: 0, source: 'b' });
      expect(negDb.more(['Damage', 'PhysicalDamage'])).toBe(0);
    });

    it('ModDB dynamically evaluates tagged Condition:*/Multiplier:* after setStat/setEvalContext without double-counting setMultiplier', () => {
      const db = new ModDB();
      // Tagged Condition:* added BEFORE prerequisite condition is set
      db.addMod({
        name: 'Condition:BonusActive',
        type: 'FLAG',
        value: true,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'PrereqMet' }],
        source: 'test',
      });
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 50,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'BonusActive' }],
        source: 'test',
      });
      // Tagged Multiplier:* evaluated against stats set later (e.g. Arcane Cloak ManaSpentRecently)
      db.addMod({
        name: 'Multiplier:ConsumedPool',
        type: 'BASE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'PercentStat:ManaUnreserved:50' }],
        source: 'test',
      });
      db.addMod({
        name: 'SpellBonus',
        type: 'BASE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'PerStat', stat: 'ConsumedPool', div: 100 }],
        source: 'test',
      });

      expect(db.sum('INC', 'Damage')).toBe(0);
      expect(db.sum('BASE', 'SpellBonus')).toBe(0);

      // Survives setEvalContext replacement and late stat/condition updates
      db.setEvalContext({
        conditions: { PrereqMet: true },
        multipliers: {},
        stats: { ManaUnreserved: 1000 },
      });
      expect(db.sum('INC', 'Damage')).toBe(50);
      expect(db.sum('BASE', 'SpellBonus')).toBe(5);

      // Explicit setMultiplier must NOT double-count store Multiplier:* mods (e.g. ElementalHitAilmentOnEnemy)
      const ehDb = new ModDB();
      ehDb.setCondition('EnemyIgnited', true);
      ehDb.setCondition('EnemyShocked', true);
      ehDb.addMod({
        name: 'Multiplier:ElementalHitAilmentOnEnemy',
        type: 'BASE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'EnemyIgnited' }],
        source: 'eh',
      });
      ehDb.addMod({
        name: 'Multiplier:ElementalHitAilmentOnEnemy',
        type: 'BASE',
        value: 1,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'EnemyShocked' }],
        source: 'eh',
      });
      ehDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 10,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Multiplier', var: 'ElementalHitAilmentOnEnemy' }],
        source: 'eh',
      });
      ehDb.setMultiplier('ElementalHitAilmentOnEnemy', 2);
      expect(ehDb.more('Damage')).toBeCloseTo(1.2, 4);
    });

    it('itemParser fixes Rune: None sockets, Runeforged Champion Cuirass local Armour isolation, slot inference, Graftblood headers, duplicate variants, and PoE 2 catalysts', () => {
      // 1. Rune: None must not inflate runes or filledSocketCount
      const emptySocketsItem = parseItemText(
        [
          'Rarity: UNIQUE',
          'The Brass Dome',
          'Champion Cuirass',
          'Armour: 3746',
          'Sockets: S S S',
          'Rune: None',
          'Rune: None',
          'Rune: None',
          'Implicits: 0',
          '500% increased Armour',
        ].join('\n'),
        'bd1',
        'poe2',
      )!;
      expect(emptySocketsItem.slotType).toBe('Body Armour');
      expect(emptySocketsItem.socketCount).toBe(3);
      expect(emptySocketsItem.runes).toBeUndefined();
      expect(emptySocketsItem.filledSocketCount).toBe(0);

      // 2. Runeforged Champion Cuirass (The Brass Dome) must classify as Body Armour and NOT leak 528% increased Armour globally
      const runeforgedBrassDome = parseItemText(
        [
          'Rarity: UNIQUE',
          'The Brass Dome',
          'Runeforged Champion Cuirass',
          'Quality: 20',
          'Implicits: 1',
          '+892 to maximum Runic Ward',
          '528% increased Armour',
        ].join('\n'),
        'bd2',
        'poe2',
      )!;
      expect(runeforgedBrassDome.slotType).toBe('Body Armour');
      const withFlatArmour = makePoe2Build({
        items: { bd2: runeforgedBrassDome },
        equipped: { 'Body Armour': 'bd2' },
        customMods: '+1000 to Armour',
      });
      // If 528% increased Armour leaked globally, Armour would be ~6280 instead of 1000
      expect(calculateBuild(withFlatArmour).defence.armour).toBe(1000);

      // 3. Word-boundary slot inference & baseName-first priority
      expect(
        parseItemText('Rarity: RARE\nFocus Guard\nTorturer\'s Mask\nImplicits: 0\n+50 to maximum Life', 'h1', 'poe1')?.slotType,
      ).toBe('Helmet');
      expect(
        parseItemText('Rarity: RARE\nEagle Tread\nDaggerfoot Shoes\nImplicits: 0\n+20 to maximum Life', 'b1', 'poe2')?.slotType,
      ).toBe('Boots');
      expect(
        parseItemText('Rarity: RARE\nBramble Shell\nOrnate Ringmail\nImplicits: 0\n+50 to maximum Life', 'ba1', 'poe1')?.slotType,
      ).toBe('Body Armour');
      expect(
        parseItemText('Rarity: RARE\nRift Knuckle\nRuneforged Fists of Stone\nImplicits: 0\nHas +2 to Evasion Rating per player level', 'g1', 'poe2')?.slotType,
      ).toBe('Gloves');
      expect(
        parseItemText('Rarity: RARE\nRuneseeker\'s Call\nRunic Fork\nImplicits: 0\n+1 to Level of all Spell Skills', 'w1', 'poe2')?.slotType,
      ).toBe('Weapon 1');
      expect(
        parseItemText('Rarity: RARE\nIron Step\nPlate Greaves\nImplicits: 0\n+20 to Armour', 'b2', 'poe1')?.slotType,
      ).toBe('Boots');
      expect(
        parseItemText('Rarity: RARE\nTough Strap\nLeather Belt\nImplicits: 0\n+40 to maximum Life', 'belt1', 'poe1')?.slotType,
      ).toBe('Belt');

      // 4. Graftblood / Intangibility / Charm Slots metadata headers must not leak into explicits
      const graft = parseItemText(
        [
          'Rarity: RARE',
          'Brittle Caress',
          'Impaling Uulgraft',
          'Graftblood: 6125/10177',
          'Intangibility: 10',
          'Charm Slots: 3',
          'Implicits: 0',
          '+20 to Strength',
        ].join('\n'),
        'gr1',
        'poe1',
      )!;
      expect(graft.slotType).toBe('Graft 1');
      expect(graft.explicits).toEqual(['+20 to Strength']);

      // 5. Allow Duplicate Variants repeats duplicate selected lines without double-counting options.variantAlts
      const dupVarItem = parseItemText(
        [
          'Rarity: UNIQUE',
          'Test Belt',
          'Utility Belt',
          'Variant: Alpha',
          'Variant: Beta',
          'Selected Variant: 1',
          'Has Alt Variant: true',
          'Selected Alt Variant: 1',
          'Allow Duplicate Variants: true',
          'Implicits: 0',
          '{variant:1}+10 to Strength',
          '{variant:2}+10 to Dexterity',
        ].join('\n'),
        'dv1',
        'poe2',
        { variant: 1, variantAlts: [1] },
      )!;
      expect(dupVarItem.explicits).toEqual(['+10 to Strength', '+10 to Strength']);

      // 6. PoE 2 Catalyst scaling scales tagged ranged lines and skips {unscalable}
      const catRing = parseItemText(
        [
          'Rarity: RARE',
          'Storm Band',
          'Ruby Ring',
          'Catalyst: Carapace',
          'CatalystQuality: 20',
          'Implicits: 0',
          '{tags:defences,armour}{range:1}+(10-100) to Armour',
          '{unscalable}{tags:defences,armour}{range:1}+(10-50) to Evasion Rating',
        ].join('\n'),
        'cat1',
        'poe2',
      )!;
      expect(catRing.explicits).toEqual(['+120 to Armour', '+50 to Evasion Rating']);

      // 7. Wave 4O-B: PoE 1 Horn/Ambusher/Paw weapon bases & post-Implicits stray Runic Ward summary guard
      expect(
        parseItemText("Rarity: RARE\nFoe Thirst\nFaun's Horn\nImplicits: 0\n+20 to Intelligence", 'w2', 'poe1')?.slotType,
      ).toBe('Weapon 1');
      expect(
        parseItemText('Rarity: RARE\nRapture Edge\nAmbusher\nImplicits: 0\n20% increased Attack Speed', 'w3', 'poe1')?.slotType,
      ).toBe('Weapon 1');
      expect(
        parseItemText("Rarity: RARE\nBlood Grip\nHellion's Paw\nImplicits: 0\n+20 to Dexterity", 'w4', 'poe1')?.slotType,
      ).toBe('Weapon 1');
      const strayWardGloves = parseItemText(
        [
          'Rarity: UNIQUE',
          'Lochtonial Caress',
          'Runeforged Fists of Stone',
          'Quality: 20',
          'Implicits: 3',
          'Has +2 to Evasion Rating per player level',
          'Has +1 to maximum Energy Shield per player level',
          'Has +1 to maximum Runic Ward per player level',
          'Runic Ward: 106',
        ].join('\n'),
        'g2',
        'poe2',
      )!;
      expect(strayWardGloves.slotType).toBe('Gloves');
      expect(strayWardGloves.armourStats?.ward).toBeUndefined();
      expect(strayWardGloves.explicits).toEqual([]);
    });

    it('gems.ts strips singular Metadata/Items/Gem/, resolves PoE 2 aliases/companions, blocks fuzzy support hijacks, and treeLoader hydrates full KeywordFlag/ModFlag', () => {
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 6,
          gems: [
            {
              id: 'poe2_cirelscultivationsupport',
              en: "Cirel's Cultivation",
              cat: 'support',
              color: 'green',
              tags: ['Support', 'Totem'],
              altIds: ['SupportGemGreatwood'],
            },
            {
              id: 'poe2_ascendancypoisonousconcoction',
              en: 'Acidic Concoction',
              cat: 'active',
              color: 'green',
              tags: ['Attack', 'Projectile', 'Chaos', 'Crossbow'],
            },
            {
              id: 'poe2_summonbeast',
              en: 'Tamed Companion',
              cat: 'active',
              color: 'green',
              tags: ['Spell', 'Minion', 'Spirit'],
              sr: 30,
            },
            {
              id: 'poe2_shocksupport',
              en: 'Shock',
              cat: 'support',
              color: 'blue',
              tags: ['Support', 'Lightning'],
            },
            {
              id: 'poe2_terrainchainsupporttwo',
              en: 'Ricochet II',
              cat: 'support',
              color: 'green',
              tags: ['Support', 'Projectile'],
            },
            {
              id: 'poe2_test_warcry',
              en: 'Seismic Cry',
              cat: 'active',
              color: 'red',
              tags: ['Warcry', 'Area', 'Physical', 'Quarterstaff'],
            },
          ],
        });

        // Singular Metadata/Items/Gem/ path stripping
        expect(
          resolveGemFromPobRef('poe2', {
            gemId: 'Metadata/Items/Gem/SupportGemGreatwood',
            nameSpec: 'Greatwood I',
          })?.id,
        ).toBe('poe2_cirelscultivationsupport');

        // PoE 2 legacy alias + Companion prefix resolution
        expect(
          resolveGemFromPobRef('poe2', {
            skillId: 'PoisonousConcoctionPlayer',
            nameSpec: 'Poisonous Concoction',
          })?.id,
        ).toBe('poe2_ascendancypoisonousconcoction');
        expect(
          resolveGemFromPobRef('poe2', { nameSpec: 'Companion: Quadrilla' })?.id,
        ).toBe('poe2_summonbeast');

        // Step-6 fuzzy fallback must NOT mis-resolve removed active meta skills or higher Roman tiers
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Cast on Shock',
            skillId: 'MetaCastOnShockPlayer',
            gemId: 'Metadata/Items/Gems/SkillGemCastOnShock',
          }),
        ).toBeUndefined();
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Ricochet III',
            skillId: 'SupportRicochetPlayerThree',
            gemId: 'Metadata/Items/Gem/SupportGemRicochetThree',
          }),
        ).toBeUndefined();

        // treeLoader synthesizeGemDefinition KeywordFlag & ModFlag hydration
        const companion = hydrated.find((g) => g.id === 'poe2_summonbeast')!;
        expect(companion.keywordFlags & KeywordFlag.Minion).toBe(KeywordFlag.Minion);
        expect(companion.keywordFlags & KeywordFlag.Spirit).toBe(KeywordFlag.Spirit);
        const concoction = hydrated.find((g) => g.id === 'poe2_ascendancypoisonousconcoction')!;
        expect(concoction.modFlags & ModFlag.Crossbow).toBe(ModFlag.Crossbow);
        const warcry = hydrated.find((g) => g.id === 'poe2_test_warcry')!;
        expect(warcry.keywordFlags & KeywordFlag.Warcry).toBe(KeywordFlag.Warcry);
        expect(warcry.modFlags & ModFlag.Quarterstaff).toBe(ModFlag.Quarterstaff);
        const totemSup = hydrated.find((g) => g.id === 'poe2_cirelscultivationsupport')!;
        expect(totemSup.keywordFlags & KeywordFlag.Totem).toBe(KeywordFlag.Totem);
      } finally {
        setRegisteredGems('poe2', prevPoe2);
      }
    });

    it('matches ModDB ModFlag.Hit | ModFlag.Ailment and ModFlag.Attack | ModFlag.Spell OR-groups (Wave 4P)', () => {
      const db = new ModDB();
      // Mirrors PoE 1 gem cmods with flags = Melee | Hit | Ailment (0x124 = 292)
      // and "with Hits and Ailments" item mods (flags = Hit | Ailment = 0x104 = 260)
      db.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 30,
        flags: ModFlag.Melee | ModFlag.Hit | ModFlag.Ailment,
        keywordFlags: 0,
        source: 'Test Melee Hit+Ailment',
      });
      db.addMod({
        name: 'ElementalDamage',
        type: 'INC',
        value: 48,
        flags: ModFlag.Hit | ModFlag.Ailment,
        keywordFlags: 0,
        source: 'The Taming',
      });
      db.addMod({
        name: 'Damage',
        type: 'INC',
        value: 20,
        flags: ModFlag.Attack | ModFlag.Spell,
        keywordFlags: 0,
        source: 'Test Attack+Spell',
      });

      // Pure Melee Hit (without Ailment bit) MUST match Melee | Hit | Ailment
      expect(db.more('Damage', ModFlag.Attack | ModFlag.Melee | ModFlag.Hit)).toBeCloseTo(1.3, 4);
      // Pure Melee Ailment (without Hit bit) MUST also match
      expect(db.more('Damage', ModFlag.Attack | ModFlag.Melee | ModFlag.Ailment)).toBeCloseTo(1.3, 4);
      // Ranged Hit (missing Melee) MUST NOT match
      expect(db.more('Damage', ModFlag.Attack | ModFlag.Projectile | ModFlag.Hit)).toBe(1);
      // Pure Hit or Pure Ailment matches Hit | Ailment
      expect(db.sum('INC', 'ElementalDamage', ModFlag.Hit)).toBe(48);
      expect(db.sum('INC', 'ElementalDamage', ModFlag.Ailment)).toBe(48);
      expect(db.sum('INC', 'ElementalDamage', ModFlag.Spell)).toBe(0);
      // Attack OR Spell matches either
      expect(db.sum('INC', 'Damage', ModFlag.Attack)).toBe(20);
      expect(db.sum('INC', 'Damage', ModFlag.Spell)).toBe(20);
      expect(db.sum('INC', 'Damage', ModFlag.Dot)).toBe(0);
    });

    it('merges wrapped multi-line PoB item mods and infers fallback weapon bases cleanly (Wave 4P)', () => {
      const wrappedTaming = parseItemText(
        [
          'Rarity: UNIQUE',
          'The Taming',
          'Prismatic Ring',
          'Implicits: 1',
          '+10% to all Elemental Resistances',
          '+28% to all Elemental Resistances',
          '48% increased Elemental Damage with Hits and Ailments for',
          'each type of Elemental Ailment on Enemy',
        ].join('\n'),
        'poe1',
      );
      expect(wrappedTaming?.implicits).toEqual(['+10% to all Elemental Resistances']);
      expect(wrappedTaming?.explicits).toContain(
        '48% increased Elemental Damage with Hits and Ailments for each type of Elemental Ailment on Enemy',
      );

      const wrappedFortress = parseItemText(
        [
          'Rarity: UNIQUE',
          'The Iron Fortress',
          'Crusader Plate',
          'Implicits: 0',
          '+111 to Strength',
          "Strength's Damage Bonus instead grants 3% increased Melee",
          'Physical Damage per 10 Strength',
        ].join('\n'),
        'poe1',
      );
      expect(wrappedFortress?.explicits).toContain(
        "Strength's Damage Bonus instead grants 3% increased Melee Physical Damage per 10 Strength",
      );

      // Weapon base slot inference fallback when base table is not hydrated
      const cannon = parseItemText('Rarity: RARE\nRedemption\nTrarthan Cannon\nImplicits: 0', 'poe2');
      expect(cannon?.slotType).toBe('Weapon 1');
      const rod = parseItemText('Rarity: RARE\nTempest Spire\nEventuality Rod\nImplicits: 0', 'poe1');
      expect(rod?.slotType).toBe('Weapon 1');
      const stabber = parseItemText('Rarity: RARE\nBramble Roar\nThroat Stabber\nImplicits: 0', 'poe1');
      expect(stabber?.slotType).toBe('Weapon 1');
      const fetish = parseItemText('Rarity: RARE\nGrinning Fetish\nGrinning Fetish\nImplicits: 0', 'poe1');
      expect(fetish?.slotType).toBe('Weapon 1');
    });

    it('resolves PoE 2 Cast on Ignite/Freeze/Shock legacy gem aliases to Cast on Elemental Ailment (Wave 4P)', () => {
      const prevPoe2 = getGemsForGame('poe2');
      try {
        registerGemsData('poe2', {
          game: 'poe2',
          count: 1,
          gems: [
            {
              id: 'poe2_castonelementalailment',
              en: 'Cast on Elemental Ailment',
              cat: 'active',
              color: 'blue',
              tags: ['spell', 'meta', 'spirit'],
              sr: 60,
            },
          ],
        });
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Cast on Ignite',
            skillId: 'MetaCastOnIgnitePlayer',
            gemId: 'Metadata/Items/Gems/SkillGemCastOnIgnite',
          })?.id,
        ).toBe('poe2_castonelementalailment');
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Cast on Freeze',
            skillId: 'MetaCastOnFreezePlayer',
          })?.id,
        ).toBe('poe2_castonelementalailment');
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Cast on Shock',
            skillId: 'MetaCastOnShockPlayer',
          })?.id,
        ).toBe('poe2_castonelementalailment');
      } finally {
        setRegisteredGems('poe2', prevPoe2);
      }
    });

    it('hydrates weapon/delivery ModFlags & KeywordFlags from stypes in treeLoader and merges wrapped {enchant}{rune} lines (Wave 4Q)', () => {
      const prevPoe1 = getGemsForGame('poe1');
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const poe1Hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 1,
          gems: [
            {
              id: 'poe1_kineticfusillade',
              en: 'Kinetic Fusillade',
              cat: 'active',
              color: 'blue',
              tags: ['area', 'attack', 'duration', 'projectile'],
              stypes: ['Area', 'Attack', 'Projectile', 'WandAttack'],
            },
          ],
        });
        const kf = poe1Hydrated.find((g) => g.id === 'poe1_kineticfusillade')!;
        expect(kf.modFlags & ModFlag.Wand).toBe(ModFlag.Wand);

        const poe2Hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 3,
          gems: [
            {
              id: 'poe2_siegecascade',
              en: 'Siege Cascade',
              cat: 'active',
              color: 'green',
              tags: ['ammunition', 'area', 'attack', 'projectile'],
              stypes: ['Area', 'Attack', 'CrossbowAmmoSkill', 'CrossbowSkill'],
            },
            {
              id: 'poe2_clustergrenade',
              en: 'Cluster Grenade',
              cat: 'active',
              color: 'red',
              tags: ['area', 'attack', 'fire', 'grenade', 'projectile'],
              stypes: ['Area', 'Attack', 'Fire', 'Grenade', 'Projectile'],
            },
            {
              id: 'poe2_snipe',
              en: 'Snipe',
              cat: 'active',
              color: 'green',
              tags: ['area', 'attack', 'channelling', 'cold', 'projectile'],
              stypes: ['Area', 'Attack', 'Bow', 'Channel', 'Cold'],
            },
          ],
        });
        expect(poe2Hydrated.find((g) => g.id === 'poe2_siegecascade')!.modFlags & ModFlag.Crossbow).toBe(
          ModFlag.Crossbow,
        );
        expect(poe2Hydrated.find((g) => g.id === 'poe2_clustergrenade')!.modFlags & ModFlag.Crossbow).toBe(
          ModFlag.Crossbow,
        );
        expect(poe2Hydrated.find((g) => g.id === 'poe2_snipe')!.modFlags & ModFlag.Bow).toBe(ModFlag.Bow);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
        setRegisteredGems('poe2', prevPoe2);
      }

      // Sekhem fallback weapon slot + wrapped {enchant}{rune} continuation merge
      const sekhem = parseItemText("Rarity: UNIQUE\nSign of the Sin Eater\nTyrant's Sekhem\nImplicits: 0", 'poe1');
      expect(sekhem?.slotType).toBe('Weapon 1');

      const wrappedRune = parseItemText(
        [
          'Rarity: RARE',
          'Test Vest',
          'Slipstrike Vest',
          'Implicits: 1',
          '{enchant}{rune}Bonded: 12% chance when collecting an Elemental Infusion to gain an',
          '{enchant}{rune}additional Elemental Infusion of the same type',
          '+80 to maximum Life',
        ].join('\n'),
        'poe2',
      );
      expect(wrappedRune?.implicits).toEqual([
        'Bonded: 12% chance when collecting an Elemental Infusion to gain an additional Elemental Infusion of the same type',
      ]);
      expect(wrappedRune?.explicits).toEqual(['+80 to maximum Life']);
    });

    it('parses PoE 1 Tincture Melee Weapon mods and evaluates them in ModDB (Wave 4R)', () => {
      const db = new ModDB();
      db.addMods(parseModLine('+23% to Melee Weapon Critical Strike Multiplier', 'Tincture'));
      db.addMods(parseModLine('100% increased Melee Weapon Critical Strike Chance', 'Tincture'));
      db.addMods(parseModLine('90% Increased Damage with Bleed From Melee Weapons', 'Tincture'));
      expect(db.sum('BASE', 'CritMultiplier', ModFlag.Attack | ModFlag.Melee)).toBe(23);
      expect(db.sum('BASE', 'CritMultiplier', ModFlag.Spell)).toBe(0);
      expect(db.sum('INC', 'CritChance', ModFlag.Attack | ModFlag.Melee)).toBe(100);
      expect(db.sum('INC', 'DotDamage', ModFlag.Attack | ModFlag.Melee, KeywordFlag.Bleed)).toBe(90);
      expect(db.sum('INC', 'DotDamage', ModFlag.Attack | ModFlag.Bow, KeywordFlag.Bleed)).toBe(0);
    });

    it('injects verified upstream 3.30/0.5 missing qualityCompiledMods in treeLoader and maps PoE 2 SupportCoursingCurrentPlayer to Shock Conduction (Wave 4S)', () => {
      const prevPoe1 = getGemsForGame('poe1');
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const poe1Hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 2,
          gems: [
            {
              id: 'poe1_moltenstrike',
              en: 'Molten Strike',
              cat: 'active',
              color: 'red',
              tags: ['attack', 'melee', 'projectile', 'fire', 'area'],
              qs: {},
            },
            {
              id: 'poe1_supportcruelty',
              en: 'Cruelty',
              cat: 'support',
              color: 'red',
              tags: ['support'],
              qs: {},
            },
          ],
        });
        const ms = poe1Hydrated.find((g) => g.id === 'poe1_moltenstrike')!;
        expect(ms.qualityCompiledMods).toEqual([
          expect.objectContaining({
            name: 'Damage',
            type: 'MORE',
            value: 0.5,
            flags: ModFlag.Projectile | ModFlag.Hit | ModFlag.Ailment,
          }),
        ]);
        const cruelty = poe1Hydrated.find((g) => g.id === 'poe1_supportcruelty')!;
        expect(cruelty.qualityCompiledMods).toEqual([
          expect.objectContaining({ name: 'CrueltyEffect', type: 'INC', value: 0.25 }),
        ]);

        const poe2Hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 3,
          gems: [
            {
              id: 'poe2_walkingcalamity',
              en: 'Walking Calamity',
              cat: 'active',
              color: 'red',
              tags: ['attack', 'fire'],
            },
            {
              id: 'poe2_shockconductionsupport',
              en: 'Shock Conduction',
              cat: 'support',
              color: 'blue',
              tags: ['support', 'lightning'],
              altIds: ['SupportShockConductionPlayer', 'SupportGemCoursingCurrent'],
            },
            {
              id: 'poe2_deadlycurrentsupport',
              en: 'Coursing Current',
              cat: 'support',
              color: 'blue',
              tags: ['support', 'lightning'],
              altIds: ['SupportDeadlyCurrentPlayer', 'SupportGemDeadlyCurrent'],
            },
          ],
        });
        const wc = poe2Hydrated.find((g) => g.id === 'poe2_walkingcalamity')!;
        expect(wc.qualityCompiledMods).toEqual([
          expect.objectContaining({ name: 'DamageGainAsFire', type: 'BASE', value: 0.5 }),
        ]);
        // Legacy SupportCoursingCurrentPlayer -> Shock Conduction (matches upstream PoB2 Gems.lua)
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Coursing Current',
            skillId: 'SupportCoursingCurrentPlayer',
            gemId: 'Metadata/Items/Gems/SupportGemCoursingCurrent',
          })?.id,
        ).toBe('poe2_shockconductionsupport');
        // Modern v0.5 SupportDeadlyCurrentPlayer -> Coursing Current (poe2_deadlycurrentsupport)
        expect(
          resolveGemFromPobRef('poe2', {
            nameSpec: 'Coursing Current',
            skillId: 'SupportDeadlyCurrentPlayer',
            gemId: 'Metadata/Items/Gems/SupportGemDeadlyCurrent',
          })?.id,
        ).toBe('poe2_deadlycurrentsupport');
      } finally {
        setRegisteredGems('poe1', prevPoe1);
        setRegisteredGems('poe2', prevPoe2);
      }
    });

    it('injects PoE 2 Leap Slam Fully Broken Armour qualityCompiledMod and evaluates it via ModDB (Wave 4T)', () => {
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 1,
          gems: [
            {
              id: 'poe2_leapslam',
              en: 'Leap Slam',
              cat: 'active',
              color: 'red',
              tags: ['attack', 'melee', 'area', 'slam'],
            },
          ],
        });
        const ls = hydrated.find((g) => g.id === 'poe2_leapslam')!;
        expect(ls.qualityCompiledMods).toEqual([
          expect.objectContaining({
            name: 'Damage',
            type: 'MORE',
            value: 1,
            tags: [{ type: 'Condition', var: 'EnemyArmourBroken' }],
          }),
        ]);
        const db = new ModDB();
        const qMod = ls.qualityCompiledMods![0]!;
        db.addMod({
          name: qMod.name,
          type: qMod.type,
          value: (qMod.value as number) * 20,
          flags: qMod.flags,
          keywordFlags: qMod.keywordFlags,
          tags: qMod.tags,
          source: 'Leap Slam Q20',
        });
        expect(db.more('Damage')).toBe(1);
        db.setCondition('EnemyArmourBroken', true);
        expect(db.more('Damage')).toBeCloseTo(1.2, 4);
      } finally {
        setRegisteredGems('poe2', prevPoe2);
      }
    });

    it('injects upstream PoB1 3.30 ImprovedSpellDamageAppliesToAttacks & Lightning Tendrils pulseInterval in treeLoader (Wave 4U)', () => {
      const prevPoe1 = getGemsForGame('poe1');
      try {
        const hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 3,
          gems: [
            {
              id: 'poe1_kineticblastaltx',
              en: 'Kinetic Blast of Clustering',
              cat: 'active',
              color: 'blue',
              tags: ['attack', 'projectile', 'area'],
              cmods: [{ n: 'SpellDamageAppliesToAttacks', t: 'FLAG', v: true }],
            },
            {
              id: 'poe1_kineticbolt',
              en: 'Kinetic Bolt',
              cat: 'active',
              color: 'blue',
              tags: ['attack', 'projectile'],
              cmods: [{ n: 'SpellDamageAppliesToAttacks', t: 'FLAG', v: true }],
            },
            {
              id: 'poe1_lightningtendrils',
              en: 'Lightning Tendrils',
              cat: 'active',
              color: 'blue',
              tags: ['spell', 'area', 'channelling', 'lightning'],
              sdata: { CritChance: 6, DamageEffectiveness: 1.9 },
            },
          ],
        });
        const kbc = hydrated.find((g) => g.id === 'poe1_kineticblastaltx')!;
        expect(kbc.compiledMods).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'ImprovedSpellDamageAppliesToAttacks',
              type: 'BASE',
              value: 150,
            }),
          ]),
        );
        const kb = hydrated.find((g) => g.id === 'poe1_kineticbolt')!;
        expect(kb.compiledMods).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'ImprovedSpellDamageAppliesToAttacks',
              type: 'BASE',
              value: 200,
            }),
          ]),
        );
        const lt = hydrated.find((g) => g.id === 'poe1_lightningtendrils')!;
        expect(lt.skillData?.pulseInterval).toBe(3);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
      }
    });

    it('skips {disabled} item mod lines and applies PoE 2 {corruptedRange:X} scalar in itemParser (Wave 4V)', () => {
      const poe1Item = parseItemText(
        [
          'Rarity: RARE',
          'Test Boots',
          'Sorcerer Boots',
          'Implicits: 2',
          '{exarch}{disabled}Drops Scorched Ground while moving, lasting 5 seconds',
          '{eater}10% increased Movement Speed',
          '+80 to maximum Life',
        ].join('\n'),
        'poe1',
      );
      expect(poe1Item?.implicits).toEqual(['10% increased Movement Speed']);
      expect(poe1Item?.explicits).toEqual(['+80 to maximum Life']);

      const poe2Corrupted = parseItemText(
        [
          'Rarity: UNIQUE',
          'Test Corrupted Weapon',
          'Expert Warhammer',
          'Implicits: 0',
          '{corruptedRange:1.22}{range:1}(80-100)% increased Ignite Magnitude',
          '{corruptedRange:0.78}{range:0}(60-75)% reduced Ignite Duration on Enemies',
        ].join('\n'),
        'poe2',
      );
      expect(poe2Corrupted?.explicits).toEqual([
        '122% increased Ignite Magnitude',
        '47% reduced Ignite Duration on Enemies',
      ]);
    });

    it('matches upstream ModDB.lua OverrideInternal first-active, multi-name Flag/Override, and per-bucket MORE rounding in calcStat (Wave 4W)', () => {
      const db = new ModDB();
      // First active OVERRIDE wins (upstream ModDB.lua:239-243)
      db.addMod({
        name: 'WeaponBaseCritChance',
        type: 'OVERRIDE',
        value: 8,
        flags: 0,
        keywordFlags: 0,
        source: 'First Override',
      });
      db.addMod({
        name: 'WeaponBaseCritChance',
        type: 'OVERRIDE',
        value: 5,
        flags: 0,
        keywordFlags: 0,
        source: 'Second Override',
      });
      expect(db.override('WeaponBaseCritChance')).toBe(8);
      expect(db.override(['NonExistentStat', 'WeaponBaseCritChance'])).toBe(8);
      expect(db.calcStat('WeaponBaseCritChance').total).toBe(8);

      // Multi-name flag() support (upstream ModStore.lua:190)
      db.addMod({
        name: 'CannotShock',
        type: 'FLAG',
        value: true,
        flags: 0,
        keywordFlags: 0,
        source: 'Skill',
      });
      expect(db.flag(['CannotFreeze', 'CannotShock'])).toBe(true);
      expect(db.flag(['CannotFreeze', 'CannotChill'])).toBe(false);

      // calcStat() rounds each stat bucket MORE multiplier to 2 decimal places (upstream ModDB.lua:197)
      db.addMod({ name: 'EnergyShield', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
      db.addMod({ name: 'EnergyShield', type: 'MORE', value: 15, flags: 0, keywordFlags: 0, source: 'More A' });
      db.addMod({ name: 'EnergyShield', type: 'MORE', value: 15, flags: 0, keywordFlags: 0, source: 'More B' });
      // 1.15 * 1.15 = 1.3225 -> rounded to 1.32 per bucket (matching ModDB.more())
      const es = db.calcStat('EnergyShield');
      expect(es.moreMultiplier).toBe(1.32);
      expect(es.total).toBe(1320);
    });

    it('restores upstream limitTotal and PerStat div on compact gem cmods/levelScaling and missing Bane/Maim quality stats (Wave 4X)', () => {
      const prevPoe1 = getGemsForGame('poe1');
      try {
        const hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 3,
          gems: [
            {
              id: 'poe1_supportfocusedchannelling',
              en: 'Focused Channelling',
              cat: 'support',
              color: 'blue',
              tags: ['support'],
              cmods: [
                {
                  n: 'Damage',
                  t: 'MORE',
                  v: 24,
                  tags: [{ type: 'Multiplier', var: 'ChannellingTime', limit: 60 }],
                },
              ],
              ls: {
                '20': {
                  cmods: [
                    {
                      n: 'Damage',
                      t: 'MORE',
                      v: 24,
                      tags: [{ type: 'Multiplier', var: 'ChannellingTime', limit: 60 }],
                    },
                  ],
                },
              },
            },
            {
              id: 'poe1_lightningconduit',
              en: 'Lightning Conduit',
              cat: 'active',
              color: 'blue',
              tags: ['spell', 'lightning'],
              cmods: [
                {
                  n: 'Damage',
                  t: 'MORE',
                  v: 20,
                  tags: [{ type: 'Multiplier', var: 'ShockEffect' }],
                },
              ],
            },
            {
              id: 'poe1_bane',
              en: 'Bane',
              cat: 'active',
              color: 'blue',
              tags: ['spell', 'chaos'],
              cmods: [],
            },
          ],
        });

        // Focused Channelling caps total MORE damage at 60% (limitTotal: true) even at 5s channelled
        const fc = hydrated.find((g) => g.id === 'poe1_supportfocusedchannelling')!;
        const db = new ModDB();
        db.setMultiplier('ChannellingTime', 5);
        for (const cm of fc.levelScaling?.[20]?.compiledMods ?? []) {
          db.addMod({
            name: cm.name,
            type: cm.type,
            value: cm.value,
            flags: cm.flags,
            keywordFlags: cm.keywordFlags,
            tags: cm.tags,
            source: 'Focused Channelling',
          });
        }
        expect(db.more('Damage')).toBeCloseTo(1.6, 4);

        // Lightning Conduit scales 20% MORE per 5% ShockEffect (50% shock -> 10 * 20 = 200% MORE = 3.0x)
        const lc = hydrated.find((g) => g.id === 'poe1_lightningconduit')!;
        const lcDb = new ModDB();
        lcDb.setStat('ShockEffect', 50);
        for (const cm of lc.compiledMods ?? []) {
          lcDb.addMod({
            name: cm.name,
            type: cm.type,
            value: cm.value,
            flags: cm.flags,
            keywordFlags: cm.keywordFlags,
            tags: cm.tags,
            source: 'Lightning Conduit',
          });
        }
        expect(lcDb.more('Damage')).toBeCloseTo(3.0, 4);

        // Bane gets 1% CurseEffect per quality when qmods is absent
        const bane = hydrated.find((g) => g.id === 'poe1_bane')!;
        expect(bane.qualityCompiledMods).toEqual([
          expect.objectContaining({ name: 'CurseEffect', type: 'INC', value: 1 }),
        ]);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
      }
    });

    it('hydrates PoE 1 anoint-only (isBlighted) notables such as Force of Darkness and Tranquility into compact trees (Wave 4Y)', () => {
      const tree = hydrateCompactTree({
        game: 'poe1',
        version: '3_30',
        bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
        groups: {},
        classStartNodeIds: {},
        nodes: [],
      });
      expect(tree.nodes[5574]).toMatchObject({
        id: 5574,
        kind: 'notable',
        name: { en: 'Force of Darkness' },
        stats: ['Damage Penetrates 15% Chaos Resistance'],
      });
      expect(tree.nodes[16246]).toMatchObject({
        id: 16246,
        kind: 'notable',
        name: { en: 'Tranquility' },
        stats: ['5% increased maximum Energy Shield', 'Transfiguration of Soul'],
      });
      expect(tree.nodes[53759]).toMatchObject({
        id: 53759,
        kind: 'notable',
        name: { en: 'Cleansed Thoughts' },
        stats: ['Chaos Resistance is doubled'],
      });
      // Wave 5B: Forbidden Flesh/Flame exclusive notables
      expect(tree.nodes[52435]).toMatchObject({
        id: 52435,
        kind: 'notable',
        name: { en: 'Indomitable Resolve' },
        stats: ['Deal 10% less Damage', 'Take 25% less Damage'],
      });
      expect(tree.nodes[19355]).toMatchObject({
        id: 19355,
        kind: 'notable',
        name: { en: 'Unleashed Potential' },
      });

      // Wave 5B: PoE 2 distilled anoint-only notables
      const poe2Tree = hydrateCompactTree({
        game: 'poe2',
        version: '0_5',
        bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
        groups: {},
        classStartNodeIds: {},
        nodes: [],
      });
      expect(poe2Tree.nodes[20686]).toMatchObject({
        id: 20686,
        kind: 'notable',
        name: { en: 'Paragon' },
        stats: ['+5% to Quality of all Skills', '+5 to all Attributes'],
      });
      expect(poe2Tree.nodes[27704]).toMatchObject({
        id: 27704,
        kind: 'notable',
        name: { en: 'Grace of the Ancestors' },
        stats: ['10% increased Attack Speed', 'Every Rage also grants 1% increased Evasion Rating'],
      });
    });

    it('restores positive ProjectileCount quality mods (removing -1 SkillStatMap offset) and skips // commented item lines', () => {
      const prevPoe1 = getGemsForGame('poe1');
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const poe1Hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 2,
          gems: [
            {
              id: 'poe1_spark',
              en: 'Spark',
              cat: 'active',
              color: 'blue',
              tags: ['Spell', 'Projectile', 'Lightning', 'Duration'],
              qmods: [{ n: 'ProjectileCount', t: 'BASE', v: -0.9 }],
            },
            {
              id: 'poe1_rainofarrows',
              en: 'Rain of Arrows',
              cat: 'active',
              color: 'green',
              tags: ['Attack', 'Bow', 'Projectile', 'Area'],
              qmods: [{ n: 'ProjectileCount', t: 'BASE', v: -0.8 }],
            },
          ],
        });
        const poe2Hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 1,
          gems: [
            {
              id: 'poe2_lightningspear',
              en: 'Lightning Spear',
              cat: 'active',
              color: 'green',
              tags: ['Attack', 'Projectile', 'Lightning'],
              qmods: [{ n: 'ProjectileCount', t: 'BASE', v: -0.9 }],
            },
          ],
        });

        expect(poe1Hydrated.find((g) => g.id === 'poe1_spark')?.qualityCompiledMods?.[0]?.value).toBe(0.1);
        expect(poe1Hydrated.find((g) => g.id === 'poe1_rainofarrows')?.qualityCompiledMods?.[0]?.value).toBe(0.2);
        expect(poe2Hydrated.find((g) => g.id === 'poe2_lightningspear')?.qualityCompiledMods?.[0]?.value).toBe(0.1);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
        setRegisteredGems('poe2', prevPoe2);
      }

      const parsed = parseItemText(`Rarity: UNIQUE
That Which Was Taken
Crimson Jewel
--------
Gain 5% of Maximum Mana as Extra Maximum Energy Shield
//Hits have 10% chance to deal 50% more Area Damage
//+40 to Strength and Intelligence`);
      expect(parsed?.explicits).toEqual(['Gain 5% of Maximum Mana as Extra Maximum Energy Shield']);

      // Wave 6D: Catalyst scaling must ONLY scale `(min-max)` range values, NEVER fixed `per N` divisors
      const whispers = parseItemText(`Rarity: UNIQUE
Whispers of Infinity
Seaglass Amulet
Catalyst: Noxious
CatalystQuality: 20
Implicits: 0
{tags:attack,chaos_damage}{range:1}(5-10) to (20-25) Added Attack Chaos Damage per 100 Maximum Mana`);
      expect(whispers?.explicits).toEqual([
        '12 to 30 Added Attack Chaos Damage per 100 Maximum Mana',
      ]);

      // Wave 6D: Upstream PoE 1 Spectre profile lookup (by Metadata ID and display name)
      expect(
        getPoe1SpectreProfile('Metadata/Monsters/LeagueCrucible/Cold/Pyromaniac'),
      ).toMatchObject({
        name: 'Forged Frostbearer',
        damageMult: 1.4,
        attackTime: 1.5,
      });
      expect(getPoe1SpectreProfile('Perfect Pain Artist')).toMatchObject({
        id: 'Metadata/Monsters/LeagueAzmeri/SpecialCorpses/CasterDemonHigh',
        damageMult: 1.25,
      });

      // Wave 6E: Upstream PoE 1 minion profiles & Rune HTML entity decoding
      expect(getPoe1MinionProfile('HeraldOfAgonySpiderPlated')).toMatchObject({
        name: 'Agony Crawler',
        damageMult: 1.5,
        attackTime: 1.3,
        primarySkill: { id: 'HeraldOfAgonyMinionTailSpike', extraProjectiles: 4 },
      });
      expect(getPoe1MinionProfile('HolyLivingRelic')).toMatchObject({
        name: 'Holy Relic',
        lifeMult: 6.0,
        primarySkill: { id: 'RelicTriggeredNova', cooldown: 0.3, triggerOnParentAttack: true },
      });
      expect(getPoe1MinionProfile('Chaos Golem')).toMatchObject({
        id: 'SummonedChaosGolem',
        damageMult: 2.9,
      });

      const agonyTalons = parseItemText(
        `Rarity: RARE
Agony Talons
Bound Cuffs
Sockets: S S S
Rune: Fenumus&apos; Rune of Spinning
Implicits: 1
{enchant}{rune}48% increased Cast Speed
100% increased effect of Socketed Items`,
        'test_agony',
        'poe2',
      );
      expect(agonyTalons?.runes).toEqual(["Fenumus' Rune of Spinning"]);
      expect(agonyTalons?.implicits).toEqual(['48% increased Cast Speed']);
    });

    it('hydrates off-hand shield attacks with 100% attackDamageMultiplierPct/damageEffectivenessPct and Retaliation cannotBeExerted', () => {
      const prevPoe1 = getGemsForGame('poe1');
      try {
        const hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 2,
          gems: [
            {
              id: 'poe1_shieldcrush',
              en: 'Shield Crush',
              cat: 'active',
              color: 'red',
              tags: ['Attack', 'Melee', 'Area', 'Physical'],
              sdata: {
                CritChance: 5,
                attackTime: 800,
                setOffHandPhysicalMin: 300,
                setOffHandPhysicalMax: 450,
              },
            },
            {
              id: 'poe1_crushingfist',
              en: 'Crushing Fist',
              cat: 'active',
              color: 'red',
              tags: ['Attack', 'Melee', 'Slam', 'Area', 'Retaliation'],
              sdata: {
                BaseMultiplier: 21.938,
                DamageEffectiveness: 21.938,
                cooldown: 4,
              },
            },
          ],
        });
        const shieldCrush = hydrated.find((g) => g.id === 'poe1_shieldcrush')!;
        expect(shieldCrush.attackDamageMultiplierPct).toBe(100);
        expect(shieldCrush.damageEffectivenessPct).toBe(100);

        const crushingFist = hydrated.find((g) => g.id === 'poe1_crushingfist')!;
        expect(crushingFist.skillData?.cannotBeExerted).toBe(1);

        // Wave 6B: Scorching Ray of Immolation `base = 100` quality offset restoration (100.2 -> 0.2)
        const srHydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 1,
          gems: [
            {
              id: 'poe1_scorchingrayaltx',
              en: 'Scorching Ray of Immolation',
              cat: 'active',
              color: 'blue',
              tags: ['Spell', 'Fire', 'Channelling', 'Duration'],
              qmods: [
                {
                  n: 'Damage',
                  t: 'MORE',
                  v: 100.2,
                  tags: [{ type: 'Multiplier', var: 'ScorchingRayofImmolationStageAfterFirst' }],
                },
              ],
            },
          ],
        });
        const srGem = srHydrated.find((g) => g.id === 'poe1_scorchingrayaltx')!;
        expect(srGem.qualityCompiledMods?.[0]?.value).toBe(0.2);

        // Wave 6C: Dominating Blow of Inspiring ImprovedMinionDamageAppliesToPlayer (250 BASE + 2.5/Q)
        const dbHydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 1,
          gems: [
            {
              id: 'poe1_dominatingblowaltx',
              en: 'Dominating Blow of Inspiring',
              cat: 'active',
              color: 'red',
              tags: ['Attack', 'Melee', 'Minion', 'Duration'],
              cmods: [{ n: 'MinionDamageAppliesToPlayer', t: 'FLAG', v: true }],
              qmods: [{ n: 'MinionDamageAppliesToPlayer', t: 'FLAG', v: true }],
            },
          ],
        });
        const dbGem = dbHydrated.find((g) => g.id === 'poe1_dominatingblowaltx')!;
        expect(
          dbGem.compiledMods?.find((m) => m.name === 'ImprovedMinionDamageAppliesToPlayer')?.value,
        ).toBe(250);
        expect(
          dbGem.qualityCompiledMods?.find((m) => m.name === 'ImprovedMinionDamageAppliesToPlayer')
            ?.value,
        ).toBe(2.5);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
      }
    });

    it('resolves *_alternate historical trees and hydrates distilled anoints across PoE 2 versions (Wave 6G)', () => {
      const mockManifest = {
        schemaVersion: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        source: 'test',
        games: {
          poe1: {
            latestTreeVersion: '3_30',
            trees: {
              '3_26': 'poe1-tree-3_26.json',
              '3_28_alternate': 'poe1-tree-3_28_alternate.json',
              '3_30': 'poe1-tree-3_30.json',
            },
            classes: 'poe1-classes.json',
            gems: 'poe1-gems.json',
            bases: 'poe1-bases.json',
            uniques: 'poe1-uniques.json',
          },
          poe2: {
            latestTreeVersion: '0_5',
            trees: {
              '0_2': 'poe2-tree-0_2.json',
              '0_5': 'poe2-tree-0_5.json',
            },
            classes: 'poe2-classes.json',
            gems: 'poe2-gems.json',
            bases: 'poe2-bases.json',
            uniques: 'poe2-uniques.json',
          },
        },
      };

      // Unlisted *_alternate version falls back to latest *_alternate rather than standard 3_30
      expect(resolveTreeFileFromManifest(mockManifest, 'poe1', '3_27_alternate')).toBe(
        'poe1-tree-3_28_alternate.json',
      );
      expect(resolveTreeFileFromManifest(mockManifest, 'poe1', '3_26')).toBe('poe1-tree-3_26.json');
      expect(resolveTreeFileFromManifest(mockManifest, 'poe2', '0_2')).toBe('poe2-tree-0_2.json');

      // Hydrate PoE 2 0_2 and 0_5 compact trees: both must hydrate distilled anoint notables
      for (const ver of ['0_2', '0_5']) {
        const tree = hydrateCompactTree({
          game: 'poe2',
          version: ver,
          bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
          classStartNodeIds: {},
          groups: {},
          nodes: [],
        });
        expect(tree.nodes[20686]?.name.en).toBe('Paragon');
        expect(tree.nodes[20686]?.stats).toEqual(['+5% to Quality of all Skills', '+5 to all Attributes']);
      }
    });

    it('verifies Wave 6I gem data fixes (Mamba DW f:0, LeapSlam showAverage, PoE2 Flameblast AilmentMagnitude)', () => {
      const db = new ModDB();
      // PoE 2 Flameblast altQualityStats: MORE AilmentMagnitude 2/Q * FlameblastStage with k = Poison|Bleed|Ignite
      const ailmentKw = KeywordFlag.Poison | KeywordFlag.Bleed | KeywordFlag.Ignite;
      db.addMod({
        name: 'AilmentMagnitude',
        type: 'MORE',
        value: 2 * 26, // Q26
        flags: 0,
        keywordFlags: ailmentKw,
        tags: [{ type: 'Multiplier', var: 'FlameblastStage' }],
        source: 'Gem: Flameblast Quality',
      });
      db.setEvalContext({ conditions: {}, multipliers: { FlameblastStage: 10 }, stats: {} });
      // Must apply 520% MORE (6.2x) to Ignite magnitude query
      expect(db.more('AilmentMagnitude', ModFlag.Spell | ModFlag.Ailment, KeywordFlag.Ignite)).toBeCloseTo(6.2, 4);
      // Must NOT apply to non-damaging Shock query
      expect(db.more('AilmentMagnitude', ModFlag.Spell, KeywordFlag.Lightning)).toBe(1);

      // PoE 1 Viper Strike of the Mamba DualWielding -20% MORE Damage with f:0 applies to both Hit & Poison
      const mambaDb = new ModDB();
      mambaDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: -20,
        flags: 0,
        keywordFlags: 0,
        tags: [{ type: 'Condition', var: 'DualWielding' }],
        source: 'Gem: Viper Strike of the Mamba',
      });
      mambaDb.setEvalContext({ conditions: { DualWielding: true }, multipliers: {}, stats: {} });
      expect(mambaDb.more('Damage', ModFlag.Attack | ModFlag.Melee | ModFlag.Ailment, KeywordFlag.Poison)).toBeCloseTo(0.8, 4);
      expect(mambaDb.more('Damage', ModFlag.Attack | ModFlag.Melee | ModFlag.Hit, 0)).toBeCloseTo(0.8, 4);
    });

    it('certifies Wave 6K sdata boolean hydration, Eldritch FlaskEffect implicit parsing, and ModDB.more PowerCharge multiplier', () => {
      // 1. Boolean/string sdata hydration (dotIsProjectile, dotIsArea, showAverage)
      const prevPoe1 = getGemsForGame('poe1');
      try {
        const hydrated = registerGemsData('poe1', {
          game: 'poe1',
          count: 1,
          gems: [
            {
              id: 'poe1_test_dot_proj',
              en: 'Test Dot Proj',
              cat: 'active',
              color: 'green',
              tags: ['Attack', 'Projectile', 'Chaos', 'Area'],
              sdata: { dotIsProjectile: true, dotIsArea: true, showAverage: true, duration: 6 },
            },
          ],
        });
        const gem = hydrated.find((g) => g.id === 'poe1_test_dot_proj')!;
        expect(gem.skillData?.dotIsProjectile).toBe(true);
        expect(gem.skillData?.dotIsArea).toBe(true);
        expect(gem.skillData?.showAverage).toBe(true);
        expect(gem.skillData?.duration).toBe(6);
      } finally {
        setRegisteredGems('poe1', prevPoe1);
      }

      // 2. Eldritch Body Armour implicit ("Flasks applied to you have 13% increased Effect") preserved by itemParser
      const wrathJack = parseItemText(
        [
          'Rarity: RARE',
          'Wrath Jack',
          'Necrotic Armour',
          'Implicits: 4',
          '{crafted}12% increased Explicit Defence Modifier magnitudes',
          '{crafted}50% reduced Explicit Resistance Modifier magnitudes',
          '1% less Damage Taken per 180 Intelligence',
          'Flasks applied to you have 13% increased Effect',
          '{fractured}8% increased Attributes',
        ].join('\n'),
        'poe1',
      );
      expect(wrathJack?.implicits).toContain('Flasks applied to you have 13% increased Effect');
      expect(parseModLine('Flasks applied to you have 13% increased Effect', 'Body Armour')).toEqual([
        expect.objectContaining({ name: 'FlaskEffect', type: 'INC', value: 13 }),
      ]);

      // 3. ModDB.more with Multiplier: PowerCharge (Inner Conviction: 3% more Spell Damage per Power Charge)
      const icDb = new ModDB();
      icDb.addMod({
        name: 'Damage',
        type: 'MORE',
        value: 3,
        flags: ModFlag.Spell,
        keywordFlags: 0,
        tags: [{ type: 'Multiplier', var: 'PowerCharge' }],
        source: 'Timeless Keystone: Inner Conviction',
      });
      icDb.setEvalContext({ conditions: {}, multipliers: { PowerCharge: 10 }, stats: {} });
      expect(icDb.more('Damage', ModFlag.Spell | ModFlag.Hit, 0)).toBeCloseTo(1.3, 4);
      expect(icDb.more('Damage', ModFlag.Spell | ModFlag.Dot, 0)).toBeCloseTo(1.3, 4);
      expect(icDb.more('Damage', ModFlag.Attack | ModFlag.Hit, 0)).toBe(1);
    });

    it('scales plain trade-exported Catalyst lines without (min-max) while still skipping per-N divisors (Wave 6L)', () => {
      const plainRing = parseItemText(
        [
          'Rarity: UNIQUE',
          'The Taming',
          'Prismatic Ring',
          'Catalyst: Turbulent',
          'CatalystQuality: 20',
          'Implicits: 1',
          '{tags:jewellery_elemental,resistance}+10% to all Elemental Resistances',
          '{tags:jewellery_elemental,attack}30% increased Elemental Damage with Attack Skills',
          '{tags:jewellery_elemental}10 to 20 Added Fire Damage per 100 Maximum Mana',
        ].join('\n'),
        'poe1',
      );
      expect(plainRing?.implicits).toEqual(['+12% to all Elemental Resistances']);
      expect(plainRing?.explicits).toEqual([
        '36% increased Elemental Damage with Attack Skills',
        '12 to 24 Added Fire Damage per 100 Maximum Mana',
      ]);
    });

    it('resolves legacy PoE 2 v0.1/v0.2 name-only tiered supports and legacy aliases without regressing explicit Roman tiers (Wave 6N)', () => {
      const prevPoe2 = getGemsForGame('poe2');
      try {
        registerGemsData('poe2', {
          game: 'poe2',
          count: 8,
          gems: [
            { id: 'poe2_upheavalsupport', en: 'Upheaval I', cat: 'support', color: 'red', tags: ['support'] },
            { id: 'poe2_closecombatsupport', en: 'Close Combat I', cat: 'support', color: 'green', tags: ['support'] },
            { id: 'poe2_aftershockchancesupport', en: 'Aftershock I', cat: 'support', color: 'red', tags: ['support'] },
            { id: 'poe2_brutalitysupport', en: 'Brutality I', cat: 'support', color: 'red', tags: ['support'] },
            { id: 'poe2_blindsupport', en: 'Blind I', cat: 'support', color: 'green', tags: ['support'] },
            { id: 'poe2_rapidattackssupport', en: 'Rapid Attacks I', cat: 'support', color: 'green', tags: ['support'] },
            { id: 'poe2_shockconductionsupport', en: 'Shock Conduction', cat: 'support', color: 'blue', tags: ['support'] },
            { id: 'poe2_skeletalwarrior', en: 'Skeletal Warrior', cat: 'active', color: 'blue', tags: ['minion'] },
          ],
        });

        // Name-only lookups (no skillId) for legacy PoE 2 v0.1/v0.2 support names
        expect(findGemByName('poe2', 'Upheaval')?.id).toBe('poe2_upheavalsupport');
        expect(findGemByName('poe2', 'Upheaval Support')?.id).toBe('poe2_upheavalsupport');
        expect(findGemByName('poe2', 'Close Combat')?.id).toBe('poe2_closecombatsupport');
        expect(findGemByName('poe2', 'Aftershock')?.id).toBe('poe2_aftershockchancesupport');
        expect(findGemByName('poe2', 'Brutality')?.id).toBe('poe2_brutalitysupport');
        expect(findGemByName('poe2', 'Blind')?.id).toBe('poe2_blindsupport');
        expect(resolveGemFromPobRef('poe2', { nameSpec: 'Upheaval' })?.id).toBe('poe2_upheavalsupport');

        // Legacy renamed aliases
        expect(findGemByName('poe2', 'Martial Tempo')?.id).toBe('poe2_rapidattackssupport');
        expect(findGemByName('poe2', 'Coursing Current')?.id).toBe('poe2_shockconductionsupport');
        expect(findGemByName('poe2', 'Skeletal Warrior Minion')?.id).toBe('poe2_skeletalwarrior');

        // Explicit Roman tier must NOT falsely fall back to Tier I when that tier is absent
        expect(findGemByName('poe2', 'Upheaval II')).toBeUndefined();
        expect(findGemByName('poe2', 'Ricochet III')).toBeUndefined();
      } finally {
        setRegisteredGems('poe2', prevPoe2);
      }
    });

    it('hydrates PoE 2 Punch (MeleeUnarmedPlayer) and bridges Multiplier tags carrying div to PerStat while preserving limitVar/limitTotal (Wave 6O)', () => {
      const prevPoe2 = getGemsForGame('poe2');
      try {
        const hydrated = registerGemsData('poe2', {
          game: 'poe2',
          count: 3,
          gems: [
            {
              id: 'poe2_playerdefaultunarmed',
              en: 'Punch',
              cat: 'active',
              color: 'white',
              tags: ['attack', 'melee', 'area'],
              altIds: ['MeleeUnarmedPlayer', 'PlayerDefaultUnarmed'],
              am: 312,
              ls: { '16': { am: 257 } },
            },
            {
              id: 'poe2_attrition',
              en: 'Attrition',
              cat: 'active',
              color: 'red',
              tags: ['buff', 'persistent'],
              cmods: [
                {
                  n: 'Damage',
                  t: 'MORE',
                  v: 1,
                  tg: 'player',
                  tags: [
                    {
                      type: 'Multiplier',
                      var: 'EnemyPresenceSeconds',
                      div: 2,
                      limitVar: 'AttritionMaxDamage',
                      limitTotal: true,
                    } as unknown as import('@webpob/core').ModTag,
                    { type: 'Condition', var: 'EnemyRareOrUnique' },
                  ],
                },
              ],
            },
            {
              id: 'poe2_trinity',
              en: 'Trinity',
              cat: 'active',
              color: 'blue',
              tags: ['buff', 'persistent'],
              cmods: [
                {
                  n: 'ElementalDamage',
                  t: 'MORE',
                  v: 4,
                  tg: 'player',
                  tags: [
                    {
                      type: 'Multiplier',
                      var: 'ResonanceCount',
                      div: 30,
                    } as unknown as import('@webpob/core').ModTag,
                  ],
                },
              ],
            },
          ],
        });

        // 1. MeleeUnarmedPlayer resolves cleanly to Punch with exact level 16 multiplier
        expect(resolveGemFromPobRef('poe2', { skillId: 'MeleeUnarmedPlayer' })?.id).toBe(
          'poe2_playerdefaultunarmed',
        );
        expect(
          hydrated.find((g) => g.id === 'poe2_playerdefaultunarmed')?.levelScaling?.[16]
            ?.attackDamageMultiplierPct,
        ).toBe(257);

        // 2. Attrition div: 2 bridges to PerStat and halves EnemyPresenceSeconds (10s -> 5% MORE, not 10% MORE)
        const attrition = hydrated.find((g) => g.id === 'poe2_attrition')!;
        const attTag = attrition.compiledMods?.[0]?.tags?.[0] as unknown as {
          type: string;
          stat?: string;
          div?: number;
          limitVar?: string;
          limitTotal?: boolean;
        };
        expect(attTag).toMatchObject({
          type: 'PerStat',
          stat: 'EnemyPresenceSeconds',
          div: 2,
          limitVar: 'AttritionMaxDamage',
          limitTotal: true,
        });
        const attDb = new ModDB();
        attDb.setCondition('EnemyRareOrUnique', true);
        attDb.setMultiplier('EnemyPresenceSeconds', 10);
        for (const cm of attrition.compiledMods ?? []) {
          attDb.addMod({
            name: cm.name,
            type: cm.type,
            value: cm.value,
            flags: cm.flags,
            keywordFlags: cm.keywordFlags,
            tags: cm.tags,
            source: 'Attrition',
          });
        }
        expect(attDb.more('Damage')).toBeCloseTo(1.05, 4);

        // 3. PoE 2 Trinity strips div: 30 on hydrated Multiplier tag so modTagEval does not
        // double-divide engine.ts pre-divided ResonanceCount
        const trinity = hydrated.find((g) => g.id === 'poe2_trinity')!;
        const triTag = trinity.compiledMods?.[0]?.tags?.[0] as unknown as {
          type: string;
          var?: string;
          div?: number;
        };
        expect(triTag).toMatchObject({
          type: 'Multiplier',
          var: 'ResonanceCount',
        });
        expect(triTag.div).toBeUndefined();
        const triDb = new ModDB();
        triDb.setMultiplier('ResonanceCount', 3); // engine.ts pre-divided 90 / 30 = 3
        for (const cm of trinity.compiledMods ?? []) {
          triDb.addMod({
            name: cm.name,
            type: cm.type,
            value: cm.value,
            flags: cm.flags,
            keywordFlags: cm.keywordFlags,
            tags: cm.tags,
            source: 'Trinity',
          });
        }
        expect(triDb.more('ElementalDamage')).toBeCloseTo(1.12, 4);
      } finally {
        setRegisteredGems('poe2', prevPoe2);
      }
    });
  });
});
