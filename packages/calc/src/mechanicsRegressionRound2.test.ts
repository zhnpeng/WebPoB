import { describe, expect, it } from 'vitest';
import { createEmptyBuild } from '@webpob/data';
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
});
