import { describe, expect, it } from 'vitest';
import type { GemDefinition, Mod, ModTag } from '@webpob/core';
import { ModDB } from './modDb.js';
import { resolveGemBonuses, resolveSupportGemLevelBonus } from './gemBonus.js';
import {
  applyModTagEval,
  createEmptyEvalContext,
  evaluateModTags,
  parseConditionalSuffix,
  type ModEvalContext,
} from './modTagEval.js';

function makeMod(overrides: Partial<Mod> & { tags?: ModTag[] }): Mod {
  return {
    name: 'Damage',
    type: 'INC',
    value: 10,
    flags: 0,
    keywordFlags: 0,
    source: 'Test',
    ...overrides,
  };
}

describe('evaluateModTags', () => {
  it('returns active=true, scale=1 for mods without tags', () => {
    expect(evaluateModTags(makeMod({}))).toEqual({ active: true, scale: 1 });
    expect(evaluateModTags(makeMod({ tags: [] }))).toEqual({ active: true, scale: 1 });
  });

  it('evaluates Condition tags including neg and missing context', () => {
    const lowLifeMod = makeMod({ tags: [{ type: 'Condition', var: 'LowLife' }] });
    const notLowLifeMod = makeMod({ tags: [{ type: 'Condition', var: 'LowLife', neg: true }] });

    expect(evaluateModTags(lowLifeMod)).toEqual({ active: false, scale: 0 });
    expect(evaluateModTags(notLowLifeMod)).toEqual({ active: true, scale: 1 });

    const ctx: ModEvalContext = {
      ...createEmptyEvalContext(),
      conditions: { LowLife: true },
    };
    expect(evaluateModTags(lowLifeMod, ctx)).toEqual({ active: true, scale: 1 });
    expect(evaluateModTags(notLowLifeMod, ctx)).toEqual({ active: false, scale: 0 });
  });

  it('evaluates SkillType and SocketedIn tags', () => {
    const skillMod = makeMod({ tags: [{ type: 'SkillType', skillType: 'Projectile' }] });
    const notSkillMod = makeMod({
      tags: [{ type: 'SkillType', skillType: 'Projectile', neg: true }],
    });
    const socketMod = makeMod({
      tags: [{ type: 'SocketedIn', slotName: 'Body Armour' }],
    });

    const ctx: ModEvalContext = {
      ...createEmptyEvalContext(),
      skillTypes: { Projectile: true },
      socketedIn: 'Body Armour',
    };

    expect(evaluateModTags(skillMod, ctx)).toEqual({ active: true, scale: 1 });
    expect(evaluateModTags(notSkillMod, ctx)).toEqual({ active: false, scale: 0 });
    expect(evaluateModTags(socketMod, ctx)).toEqual({ active: true, scale: 1 });
    expect(
      evaluateModTags(socketMod, { ...ctx, socketedIn: 'Helmet' }),
    ).toEqual({ active: false, scale: 0 });
  });

  it('evaluates Multiplier tags with limit and base offset', () => {
    const chargeMod = makeMod({
      value: 4,
      tags: [{ type: 'Multiplier', var: 'PowerCharge', limit: 6 }],
    });
    const ctx: ModEvalContext = {
      ...createEmptyEvalContext(),
      multipliers: { PowerCharge: 4 },
    };

    expect(evaluateModTags(chargeMod, ctx)).toEqual({ active: true, scale: 4 });
    // Clamped to limit=6
    expect(
      evaluateModTags(chargeMod, { ...ctx, multipliers: { PowerCharge: 9 } }),
    ).toEqual({ active: true, scale: 6 });
    // Missing multiplier defaults to 0
    expect(evaluateModTags(chargeMod, createEmptyEvalContext())).toEqual({
      active: true,
      scale: 0,
    });

    // Multiplier with PoB-style additive base (e.g. Life per Level: 12 * Level + 38)
    const lifePerLevelMod = makeMod({
      name: 'Life',
      type: 'BASE',
      value: 12,
      tags: [{ type: 'Multiplier', var: 'Level', base: 38 }],
    });
    const res = evaluateModTags(lifePerLevelMod, {
      ...createEmptyEvalContext(),
      multipliers: { Level: 90 },
    });
    expect(res).toEqual({ active: true, scale: 90, offset: 38 });
    expect(applyModTagEval(12, res)).toBe(1118);
  });

  it('evaluates PerStat tags with floor division and optional limit', () => {
    const strMod = makeMod({
      value: 2,
      tags: [{ type: 'PerStat', stat: 'Str', div: 10 }],
    });
    const cappedMod = makeMod({
      value: 1,
      tags: [{ type: 'PerStat', stat: 'BodyArmourEvasion', div: 15, limit: 100 }],
    });

    const ctx: ModEvalContext = {
      ...createEmptyEvalContext(),
      stats: { Str: 259, BodyArmourEvasion: 2400 },
    };

    // Math.floor(259 / 10) = 25
    expect(evaluateModTags(strMod, ctx)).toEqual({ active: true, scale: 25 });
    // Math.floor(2400 / 15) = 160, clamped to limit=100
    expect(evaluateModTags(cappedMod, ctx)).toEqual({ active: true, scale: 100 });
    // Below divisor -> 0
    expect(
      evaluateModTags(strMod, { ...createEmptyEvalContext(), stats: { Str: 9 } }),
    ).toEqual({ active: true, scale: 0 });
  });

  it('evaluates stacked Condition + Multiplier + PerStat tags together', () => {
    const stackedMod = makeMod({
      value: 5,
      tags: [
        { type: 'Condition', var: 'DualWielding' },
        { type: 'Condition', var: 'EnemyShocked' },
        { type: 'Multiplier', var: 'FrenzyCharge' },
        { type: 'PerStat', stat: 'Dex', div: 100 },
      ],
    });

    const activeCtx: ModEvalContext = {
      conditions: { DualWielding: true, EnemyShocked: true },
      multipliers: { FrenzyCharge: 3 },
      stats: { Dex: 250 },
    };
    // scale = 3 * floor(250/100) = 3 * 2 = 6
    expect(evaluateModTags(stackedMod, activeCtx)).toEqual({ active: true, scale: 6 });

    // Any failing condition short-circuits to inactive
    const inactiveCtx: ModEvalContext = {
      ...activeCtx,
      conditions: { DualWielding: true, EnemyShocked: false },
    };
    expect(evaluateModTags(stackedMod, inactiveCtx)).toEqual({ active: false, scale: 0 });
  });
});

describe('ModDB with ModTag evaluation', () => {
  it('remains 100% backward compatible for untagged mods', () => {
    const db = new ModDB();
    db.addMod(makeMod({ name: 'Life', type: 'BASE', value: 100 }));
    db.addMod(makeMod({ name: 'Life', type: 'INC', value: 50 }));
    db.addMod(makeMod({ name: 'Life', type: 'MORE', value: 20 }));

    expect(db.sum('BASE', 'Life')).toBe(100);
    expect(db.sum('INC', 'Life')).toBe(50);
    expect(db.more('Life')).toBeCloseTo(1.2, 6);
    expect(db.calcStat('Life').total).toBeCloseTo(180, 6);
  });

  it('evaluates Condition, Multiplier, and PerStat tags in sum(), more(), flag(), override(), calcStat()', () => {
    const db = new ModDB();
    db.setCondition('LowLife', true);
    db.setCondition('UsingShield', false);
    db.setMultiplier('PowerCharge', 5);
    db.setMultiplier('FrenzyCharge', 3);
    db.setStat('Str', 350);

    // Condition-gated INC
    db.addMod(
      makeMod({
        name: 'Damage',
        type: 'INC',
        value: 50,
        source: 'LowLifeNode',
        tags: [{ type: 'Condition', var: 'LowLife' }],
      }),
    );
    db.addMod(
      makeMod({
        name: 'Damage',
        type: 'INC',
        value: 80,
        source: 'ShieldNode',
        tags: [{ type: 'Condition', var: 'UsingShield' }],
      }),
    );
    // Multiplier-scaled INC: 4% per Power Charge * 5 = 20%
    db.addMod(
      makeMod({
        name: 'Damage',
        type: 'INC',
        value: 4,
        source: 'PowerChargeNode',
        tags: [{ type: 'Multiplier', var: 'PowerCharge' }],
      }),
    );
    // PerStat BASE: +1 per 10 Str -> +35
    db.addMod(
      makeMod({
        name: 'Damage',
        type: 'BASE',
        value: 1,
        source: 'StrStack',
        tags: [{ type: 'PerStat', stat: 'Str', div: 10 }],
      }),
    );
    // Multiplier-scaled MORE: 4% more per Frenzy Charge * 3 = 12% more
    db.addMod(
      makeMod({
        name: 'Damage',
        type: 'MORE',
        value: 4,
        source: 'FrenzyChargeMore',
        tags: [{ type: 'Multiplier', var: 'FrenzyCharge' }],
      }),
    );
    // Condition-gated FLAG
    db.addMod(
      makeMod({
        name: 'PainAttunementActive',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'LowLife' }],
      }),
    );
    db.addMod(
      makeMod({
        name: 'ShieldOnlyFlag',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'UsingShield' }],
      }),
    );
    // Condition-gated OVERRIDE
    db.addMod(
      makeMod({
        name: 'CritChance',
        type: 'OVERRIDE',
        value: 100,
        tags: [{ type: 'Condition', var: 'UsingShield' }],
      }),
    );
    db.addMod(
      makeMod({
        name: 'BlockChance',
        type: 'OVERRIDE',
        value: 50,
        tags: [{ type: 'Condition', var: 'LowLife' }],
      }),
    );

    expect(db.sum('BASE', 'Damage')).toBe(35);
    expect(db.sum('INC', 'Damage')).toBe(70); // 50 + 20 (ShieldNode skipped)
    expect(db.more('Damage')).toBeCloseTo(1.12, 6);
    expect(db.flag('PainAttunementActive')).toBe(true);
    expect(db.flag('ShieldOnlyFlag')).toBe(false);
    expect(db.override('CritChance')).toBeNull();
    expect(db.override('BlockChance')).toBe(50);

    const stat = db.calcStat('Damage');
    expect(stat.base).toBe(35);
    expect(stat.incPct).toBe(70);
    expect(stat.moreMultiplier).toBeCloseTo(1.12, 6);
    expect(stat.total).toBeCloseTo(35 * 1.7 * 1.12, 6);
    expect(stat.sources.map((s) => s.source)).toEqual([
      'LowLifeNode',
      'PowerChargeNode',
      'StrStack',
      'FrenzyChargeMore',
    ]);
  });

  it('clones evalContext independently without mutating original ModDB', () => {
    const db = new ModDB();
    db.setCondition('LowLife', false);
    db.addMod(
      makeMod({
        name: 'SpellDamage',
        type: 'MORE',
        value: 30,
        tags: [{ type: 'Condition', var: 'LowLife' }],
      }),
    );

    const cloned = db.clone();
    cloned.setCondition('LowLife', true);

    expect(db.more('SpellDamage')).toBe(1);
    expect(cloned.more('SpellDamage')).toBeCloseTo(1.3, 6);
    expect(db.getEvalContext().conditions.LowLife).toBe(false);
    expect(cloned.getEvalContext().conditions.LowLife).toBe(true);
  });
});

describe('parseConditionalSuffix', () => {
  it('returns original line with empty tags when no conditional clause is present', () => {
    expect(parseConditionalSuffix('20% increased Maximum Life')).toEqual({
      baseLine: '20% increased Maximum Life',
      tags: [],
    });
  });

  it('extracts common Condition suffixes', () => {
    const cases: Array<[string, string, ModTag]> = [
      [
        '10% increased Attack Speed while Dual Wielding',
        '10% increased Attack Speed',
        { type: 'Condition', var: 'DualWielding' },
      ],
      [
        '25% increased Armour while holding a Shield',
        '25% increased Armour',
        { type: 'Condition', var: 'UsingShield' },
      ],
      [
        '30% increased Global Critical Strike Chance while wielding a Staff',
        '30% increased Global Critical Strike Chance',
        { type: 'Condition', var: 'UsingStaff' },
      ],
      [
        '20% increased Damage while wielding a Two Handed Weapon',
        '20% increased Damage',
        { type: 'Condition', var: 'UsingTwoHandedWeapon' },
      ],
      [
        '15% increased Attack Speed while wielding a Bow',
        '15% increased Attack Speed',
        { type: 'Condition', var: 'UsingBow' },
      ],
      [
        '12% increased Damage while wielding a Claw',
        '12% increased Damage',
        { type: 'Condition', var: 'UsingClaw' },
      ],
      [
        '16% increased Spell Damage while wielding a Wand',
        '16% increased Spell Damage',
        { type: 'Condition', var: 'UsingWand' },
      ],
      [
        '18% increased Attack Damage while wielding a Quarterstaff',
        '18% increased Attack Damage',
        { type: 'Condition', var: 'UsingQuarterstaff' },
      ],
      [
        '30% more Spell Damage when on Low Life',
        '30% more Spell Damage',
        { type: 'Condition', var: 'LowLife' },
      ],
      [
        '20% increased Damage while on Full Life',
        '20% increased Damage',
        { type: 'Condition', var: 'FullLife' },
      ],
      [
        '10% increased Movement Speed while not on Low Life',
        '10% increased Movement Speed',
        { type: 'Condition', var: 'LowLife', neg: true },
      ],
      [
        '25% increased Elemental Damage while affected by a Herald',
        '25% increased Elemental Damage',
        { type: 'Condition', var: 'AffectedByHerald' },
      ],
      [
        '15% increased Spell Damage while Channelling',
        '15% increased Spell Damage',
        { type: 'Condition', var: 'Channelling' },
      ],
      [
        '20% increased Damage while Leeching',
        '20% increased Damage',
        { type: 'Condition', var: 'Leeching' },
      ],
      [
        '30% increased Critical Strike Chance against Dazed Enemies',
        '30% increased Critical Strike Chance',
        { type: 'Condition', var: 'EnemyDazed' },
      ],
      [
        '20% increased Damage against Shocked Enemies',
        '20% increased Damage',
        { type: 'Condition', var: 'EnemyShocked' },
      ],
    ];

    for (const [raw, expectedBase, expectedTag] of cases) {
      expect(parseConditionalSuffix(raw)).toEqual({
        baseLine: expectedBase,
        tags: [expectedTag],
      });
    }
  });

  it('extracts Multiplier suffixes', () => {
    const cases: Array<[string, string, ModTag]> = [
      [
        '4% increased Spell Damage per Power Charge',
        '4% increased Spell Damage',
        { type: 'Multiplier', var: 'PowerCharge' },
      ],
      [
        '4% more Damage per Frenzy Charge',
        '4% more Damage',
        { type: 'Multiplier', var: 'FrenzyCharge' },
      ],
      [
        '+4% to all Elemental Resistances per Endurance Charge',
        '+4% to all Elemental Resistances',
        { type: 'Multiplier', var: 'EnduranceCharge' },
      ],
      [
        '1% more Attack Damage per Rage',
        '1% more Attack Damage',
        { type: 'Multiplier', var: 'Rage' },
      ],
      [
        '+2% to all Elemental Resistances for each Corrupted Item Equipped',
        '+2% to all Elemental Resistances',
        { type: 'Multiplier', var: 'CorruptedItem' },
      ],
      [
        '+10 to Maximum Life per Socket filled',
        '+10 to Maximum Life',
        { type: 'Multiplier', var: 'SocketFilled' },
      ],
      [
        '3% more Damage per Allocated Mastery',
        '3% more Damage',
        { type: 'Multiplier', var: 'AllocatedMastery' },
      ],
      [
        '15% increased Damage per Summoned Golem',
        '15% increased Damage',
        { type: 'Multiplier', var: 'ActiveGolem' },
      ],
      [
        '5% increased Spell Damage per Blue Support Gem',
        '5% increased Spell Damage',
        { type: 'Multiplier', var: 'BlueSupportGem' },
      ],
    ];

    for (const [raw, expectedBase, expectedTag] of cases) {
      expect(parseConditionalSuffix(raw)).toEqual({
        baseLine: expectedBase,
        tags: [expectedTag],
      });
    }
  });

  it('extracts PerStat suffixes including Body Armour / Shield equipment stats', () => {
    const cases: Array<[string, string, ModTag]> = [
      [
        '1% increased Melee Physical Damage per 5 Strength',
        '1% increased Melee Physical Damage',
        { type: 'PerStat', stat: 'Str', div: 5 },
      ],
      [
        '2% increased Evasion Rating per 10 Dexterity',
        '2% increased Evasion Rating',
        { type: 'PerStat', stat: 'Dex', div: 10 },
      ],
      [
        '1% increased Spell Damage per 16 Intelligence',
        '1% increased Spell Damage',
        { type: 'PerStat', stat: 'Int', div: 16 },
      ],
      [
        '1% increased Attack Speed per 200 Accuracy Rating',
        '1% increased Attack Speed',
        { type: 'PerStat', stat: 'Accuracy', div: 200 },
      ],
      [
        '+1 to Maximum Energy Shield per 15 Item Evasion on Equipped Body Armour',
        '+1 to Maximum Energy Shield',
        { type: 'PerStat', stat: 'BodyArmourEvasion', div: 15 },
      ],
      [
        '+2 to Evasion Rating per 1 Item Energy Shield on Equipped Body Armour',
        '+2 to Evasion Rating',
        { type: 'PerStat', stat: 'BodyArmourES', div: 1 },
      ],
      [
        '+1 to Maximum Energy Shield for every 10 Item Evasion Rating on Equipped Body Armour',
        '+1 to Maximum Energy Shield',
        { type: 'PerStat', stat: 'BodyArmourEvasion', div: 10 },
      ],
      [
        '+2 to Armour for every 5 Energy Shield on Equipped Body Armour',
        '+2 to Armour',
        { type: 'PerStat', stat: 'BodyArmourES', div: 5 },
      ],
      [
        '+1 to Maximum Life for every 20 Armour on Equipped Body Armour',
        '+1 to Maximum Life',
        { type: 'PerStat', stat: 'BodyArmourArmour', div: 20 },
      ],
      [
        '1% increased Spell Damage per 2% Chance to Block on Equipped Shield',
        '1% increased Spell Damage',
        { type: 'PerStat', stat: 'ShieldBlock', div: 2 },
      ],
    ];

    for (const [raw, expectedBase, expectedTag] of cases) {
      expect(parseConditionalSuffix(raw)).toEqual({
        baseLine: expectedBase,
        tags: [expectedTag],
      });
    }
  });

  it('handles leading conditional prefixes and stacked clauses', () => {
    expect(parseConditionalSuffix('While on Low Life, 30% more Spell Damage')).toEqual({
      baseLine: '30% more Spell Damage',
      tags: [{ type: 'Condition', var: 'LowLife' }],
    });

    expect(
      parseConditionalSuffix('4% increased Spell Damage per Power Charge while on Low Life'),
    ).toEqual({
      baseLine: '4% increased Spell Damage',
      tags: [
        { type: 'Multiplier', var: 'PowerCharge' },
        { type: 'Condition', var: 'LowLife' },
      ],
    });

    expect(
      parseConditionalSuffix('While holding a Shield, 2% increased Armour per 10 Strength'),
    ).toEqual({
      baseLine: '2% increased Armour',
      tags: [
        { type: 'Condition', var: 'UsingShield' },
        { type: 'PerStat', stat: 'Str', div: 10 },
      ],
    });
  });

  it('evaluates PoB DistanceRamp tags (explicit ramp & poe2-gems.json Close Combat / Longshot / Point Blank fallback)', () => {
    const cc1: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 20,
      flags: 0,
      keywordFlags: 0,
      source: 'Skill: Close Combat I',
      tags: [{ type: 'Condition', var: 'DistanceRamp' }],
    };
    const cc2: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 30,
      flags: 0,
      keywordFlags: 0,
      source: 'Skill: Close Combat II',
      tags: [{ type: 'Condition', var: 'DistanceRamp' }],
    };
    // Default PoE 2 combat distance = 20 units (2.0m) -> 60% of Close Combat ramp = 12% / 18% MORE
    const r1 = evaluateModTags(cc1, createEmptyEvalContext());
    expect(r1.active).toBe(true);
    expect(applyModTagEval(20, r1)).toBeCloseTo(12, 4);

    const r2 = evaluateModTags(cc2, createEmptyEvalContext());
    expect(r2.active).toBe(true);
    expect(applyModTagEval(30, r2)).toBeCloseTo(18, 4);

    // At 10 units (1m) -> full 30% MORE; at 35 units (3.5m) -> 0% (inactive)
    const ctxClose = createEmptyEvalContext();
    ctxClose.stats.EnemyDistance = 10;
    expect(applyModTagEval(30, evaluateModTags(cc2, ctxClose))).toBeCloseTo(30, 4);

    const ctxFar = createEmptyEvalContext();
    ctxFar.stats.EnemyDistance = 35;
    expect(evaluateModTags(cc2, ctxFar).active).toBe(false);

    // Longshot I (ramp [[35,0],[70,1]]): 0% at 2m, 12.5% at 5.25m, 25% at 7m+
    const longshot: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 25,
      flags: 0,
      keywordFlags: 0,
      source: 'Skill: Longshot I',
      tags: [{ type: 'Condition', var: 'DistanceRamp' }],
    };
    expect(evaluateModTags(longshot, createEmptyEvalContext()).active).toBe(false);
    const ctxMid = createEmptyEvalContext();
    ctxMid.stats.EnemyDistance = 52.5;
    expect(applyModTagEval(25, evaluateModTags(longshot, ctxMid))).toBeCloseTo(12.5, 4);
    const ctx70 = createEmptyEvalContext();
    ctx70.stats.EnemyDistance = 70;
    expect(applyModTagEval(25, evaluateModTags(longshot, ctx70))).toBeCloseTo(25, 4);

    // Explicit PoB DistanceRamp tag shape
    const explicitPb: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 20,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree: Point Blank',
      tags: [{ type: 'DistanceRamp', ramp: [[35, 1], [70, 0]] } as unknown as ModTag],
    };
    expect(applyModTagEval(20, evaluateModTags(explicitPb, createEmptyEvalContext()))).toBeCloseTo(20, 4);
    expect(applyModTagEval(20, evaluateModTags(explicitPb, ctxMid))).toBeCloseTo(10, 4);
  });

  it('parses & evaluates specific Herald conditions, distance thresholds, Power Charge Recently, Rage PerStat & ShieldArmourAndEvasion', () => {
    expect(parseConditionalSuffix('100% increased Lightning Damage while affected by Herald of Thunder')).toEqual({
      baseLine: '100% increased Lightning Damage',
      tags: [{ type: 'Condition', var: 'AffectedByHeraldOfThunder' }],
    });
    expect(parseConditionalSuffix('40% increased Projectile Damage with Spears while there are no Enemies within 3m')).toEqual({
      baseLine: '40% increased Projectile Damage with Spears',
      tags: [{ type: 'Condition', var: 'EnemyDistanceGt:30' }],
    });
    expect(parseConditionalSuffix('20% increased Damage further than 4m')).toEqual({
      baseLine: '20% increased Damage',
      tags: [{ type: 'Condition', var: 'EnemyDistanceGt:40' }],
    });
    expect(parseConditionalSuffix("20% increased Critical Damage Bonus if you've consumed a Power Charge Recently")).toEqual({
      baseLine: '20% increased Critical Damage Bonus',
      tags: [{ type: 'Condition', var: 'ConsumedPowerChargeRecently' }],
    });
    expect(parseConditionalSuffix('4% increased Attack Damage per 75 Item Armour and Evasion Rating on Equipped Shield')).toEqual({
      baseLine: '4% increased Attack Damage',
      tags: [{ type: 'PerStat', stat: 'ShieldArmourAndEvasion', div: 75 }],
    });

    // EnemyDistanceGt:30 false at default 2m (20), true at 3.5m (35)
    const farMod: Mod = {
      name: 'Damage',
      type: 'INC',
      value: 40,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree',
      tags: [{ type: 'Condition', var: 'EnemyDistanceGt:30' }],
    };
    expect(evaluateModTags(farMod, createEmptyEvalContext()).active).toBe(false);
    const ctxFar = createEmptyEvalContext();
    ctxFar.stats.EnemyDistance = 35;
    expect(evaluateModTags(farMod, ctxFar).active).toBe(true);

    // PerStat falls back to multipliers (Rage) and composites ShieldArmour + ShieldEvasion
    const rageSpellMod: Mod = {
      name: 'Damage',
      type: 'MORE',
      value: 1,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree: Druidic Champion',
      tags: [{ type: 'PerStat', stat: 'Rage', div: 2 }],
    };
    const ctxRage = createEmptyEvalContext();
    ctxRage.multipliers.Rage = 36;
    expect(applyModTagEval(1, evaluateModTags(rageSpellMod, ctxRage))).toBe(18);

    const shieldMod: Mod = {
      name: 'Damage',
      type: 'INC',
      value: 4,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree: Greatest Defence',
      tags: [{ type: 'PerStat', stat: 'ShieldArmourAndEvasion', div: 75 }],
    };
    const ctxShield = createEmptyEvalContext();
    ctxShield.stats.ShieldArmour = 300;
    ctxShield.stats.ShieldEvasion = 150;
    expect(applyModTagEval(4, evaluateModTags(shieldMod, ctxShield))).toBe(24);
  });

  it('caps total value (not multiplier count) when limitTotal is true (Atalui Bloodletting & Escalating Mayhem)', () => {
    // Explicit limitTotal on PerStat (Atalui's Bloodletting: 2% per 20 LifeCost, max 40% total)
    const ataluiExplicit: Mod = {
      name: 'DamageGainAsPhysical',
      type: 'BASE',
      value: 2,
      flags: 0,
      keywordFlags: 0,
      source: "Support: Atalui's Bloodletting",
      tags: [
        { type: 'PerStat', stat: 'LifeCost', div: 20, limit: 40, limitTotal: true } as unknown as ModTag,
      ],
    };
    const ctxLow = createEmptyEvalContext();
    ctxLow.stats.LifeCost = 240; // floor(240/20) = 12 -> 24%
    expect(applyModTagEval(2, evaluateModTags(ataluiExplicit, ctxLow))).toBe(24);

    const ctxHigh = createEmptyEvalContext();
    ctxHigh.stats.LifeCost = 1150; // floor(1150/20) = 57 -> capped at 40% total (NOT 40*2=80%!)
    expect(applyModTagEval(2, evaluateModTags(ataluiExplicit, ctxHigh))).toBe(40);

    // Legacy poe2-gems.json cmod bridge (limitTotal omitted on Atalui's Bloodletting LifeCost PerStat)
    const ataluiLegacy: Mod = {
      ...ataluiExplicit,
      tags: [{ type: 'PerStat', stat: 'LifeCost', div: 20, limit: 40 }],
    };
    expect(applyModTagEval(2, evaluateModTags(ataluiLegacy, ctxHigh))).toBe(40);

    // Explicit limitTotal on Multiplier (Escalating Mayhem: 10% per Hazard, max 50% total)
    const mayhemMod: Mod = {
      name: 'Damage',
      type: 'INC',
      value: 10,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree: Escalating Mayhem',
      tags: [
        {
          type: 'Multiplier',
          var: 'HazardTriggeredRecently',
          limit: 50,
          limitTotal: true,
        } as unknown as ModTag,
      ],
    };
    const ctxMayhem = createEmptyEvalContext();
    ctxMayhem.multipliers.HazardTriggeredRecently = 8;
    expect(applyModTagEval(10, evaluateModTags(mayhemMod, ctxMayhem))).toBe(50);

    // Non-limitTotal limit continues clamping multiplier count (4 * min(9, 6) = 24)
    const nonTotalMod = makeMod({
      value: 4,
      tags: [{ type: 'Multiplier', var: 'PowerCharge', limit: 6 }],
    });
    const ctxCharges = createEmptyEvalContext();
    ctxCharges.multipliers.PowerCharge = 9;
    expect(applyModTagEval(4, evaluateModTags(nonTotalMod, ctxCharges))).toBe(24);
  });

  it('evaluates Wave 4M PoE 2 conditions, BlockChance PerStat, composite ailments/exposure, and Herald of Blood', () => {
    // Lay Siege / Offensive Stance PerStat BlockChance
    expect(parseConditionalSuffix('1% increased Damage per 1% Chance to Block')).toEqual({
      baseLine: '1% increased Damage',
      tags: [{ type: 'PerStat', stat: 'BlockChance', div: 1 }],
    });
    const blockMod = makeMod({
      value: 1,
      tags: [{ type: 'PerStat', stat: 'BlockChance', div: 1 }],
    });
    const ctxBlock = createEmptyEvalContext();
    ctxBlock.stats.BlockChance = 65;
    expect(applyModTagEval(1, evaluateModTags(blockMod, ctxBlock))).toBe(65);

    // New suffix conditions
    expect(parseConditionalSuffix("15% increased Damage if you've dealt a Critical Hit in the past 8 seconds")).toEqual({
      baseLine: '15% increased Damage',
      tags: [{ type: 'Condition', var: 'CritInPast8Sec' }],
    });
    expect(parseConditionalSuffix('15% increased Critical Hit Chance against enemies with Exposure')).toEqual({
      baseLine: '15% increased Critical Hit Chance',
      tags: [{ type: 'Condition', var: 'EnemyExposure' }],
    });
    expect(parseConditionalSuffix('15% increased Attack Speed while not on Low Mana')).toEqual({
      baseLine: '15% increased Attack Speed',
      tags: [{ type: 'Condition', var: 'LowMana', neg: true }],
    });
    expect(parseConditionalSuffix('15% more Critical Damage Bonus against Blinded Enemies')).toEqual({
      baseLine: '15% more Critical Damage Bonus',
      tags: [{ type: 'Condition', var: 'EnemyBlinded' }],
    });
    expect(parseConditionalSuffix('24% increased Damage with Hits against Enemies affected by Elemental Ailments')).toEqual({
      baseLine: '24% increased Damage with Hits',
      tags: [{ type: 'Condition', var: 'EnemyAffectedByElementalAilment' }],
    });
    expect(parseConditionalSuffix('33% increased Damage with Hits against Enemies affected by Ailments')).toEqual({
      baseLine: '33% increased Damage with Hits',
      tags: [{ type: 'Condition', var: 'EnemyAffectedByAilment' }],
    });
    expect(parseConditionalSuffix('20% increased Damage for each type of Elemental Ailment on Enemy')).toEqual({
      baseLine: '20% increased Damage',
      tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
    });
    expect(parseConditionalSuffix('40% increased Physical Damage while affected by Herald of Blood')).toEqual({
      baseLine: '40% increased Physical Damage',
      tags: [{ type: 'Condition', var: 'AffectedByHeraldOfBlood' }],
    });

    // Composite condition & derived multiplier evaluations
    const ctxAil = createEmptyEvalContext();
    ctxAil.conditions.EnemyShocked = true;
    ctxAil.conditions.EnemyChilled = true;
    ctxAil.conditions.EnemyLightningExposure = true;
    ctxAil.conditions.AffectedByHeraldofBlood = true;

    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyExposure' }] }), ctxAil).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'EnemyAffectedByElementalAilment' }] }),
        ctxAil,
      ).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'EnemyAffectedByAilment' }] }),
        ctxAil,
      ).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'AffectedByHeraldOfBlood' }] }),
        ctxAil,
      ).active,
    ).toBe(true);
    expect(
      applyModTagEval(
        20,
        evaluateModTags(
          makeMod({ value: 20, tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }] }),
          ctxAil,
        ),
      ),
    ).toBe(40);
  });

  it('scales PercentStat multiplier (Arcane Cloak 0.64), EnemyFrozen->EnemyChilled, and Wave 4N conditions', () => {
    // PoE 1 Arcane Cloak: cmod has v=10 (10% of consumed mana) / v=100 (100% guard limit) with ArcaneCloakConsumedMana=0.64
    const cloakMod: Mod = {
      name: 'LightningMax',
      type: 'BASE',
      value: 10,
      flags: 0,
      keywordFlags: 0,
      source: 'Skill: Arcane Cloak',
      tags: [{ type: 'Condition', var: 'PercentStat:ManaUnreserved:ArcaneCloakConsumedMana' }],
    };
    const ctxCloak = createEmptyEvalContext();
    ctxCloak.stats.ManaUnreserved = 10000;
    ctxCloak.multipliers.ArcaneCloakConsumedMana = 0.64;
    const cloakRes = evaluateModTags(cloakMod, ctxCloak);
    expect(cloakRes.active).toBe(true);
    expect(cloakRes.scale).toBeCloseTo(64, 4);
    expect(applyModTagEval(10, cloakRes)).toBeCloseTo(640, 4);
    expect(applyModTagEval(100, cloakRes)).toBeCloseTo(6400, 4);

    // Literal PercentStat numeric percent (e.g. 0.5%) divides by 100
    ctxCloak.stats.Mana = 10000;
    const litPctMod = makeMod({
      value: 1,
      tags: [{ type: 'Condition', var: 'PercentStat:Mana:0.5' }],
    });
    expect(evaluateModTags(litPctMod, ctxCloak).scale).toBeCloseTo(50, 4);

    // EnemyFrozen implies EnemyChilled (#52 Glacial Hammer); Frozen implies Chilled
    const ctxFrozen = createEmptyEvalContext();
    ctxFrozen.conditions.EnemyFrozen = true;
    ctxFrozen.conditions.Frozen = true;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyChilled' }] }), ctxFrozen).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Chilled' }] }), ctxFrozen).active,
    ).toBe(true);

    // Wave 4N conditions: Surrounded suffix, TwisterLightning, AtMostOneNearbyRareOrUniqueEnemy, Shapeshifted
    expect(parseConditionalSuffix('100% increased Attack Damage while Surrounded')).toEqual({
      baseLine: '100% increased Attack Damage',
      tags: [{ type: 'Condition', var: 'Surrounded' }],
    });
    const ctxW4N = createEmptyEvalContext();
    ctxW4N.conditions.twisterLightning = true;
    ctxW4N.conditions.ShapeshiftToAnimal = true;
    ctxW4N.multipliers.NearbyRareOrUniqueEnemies = 1;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'TwisterLightning' }] }), ctxW4N).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Shapeshifted' }] }), ctxW4N).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'AtMostOneNearbyRareOrUniqueEnemy' }] }),
        ctxW4N,
      ).active,
    ).toBe(true);
  });

  it('evaluates Wave 4O PoE 2 conditions, aliases (Infusion, Totem, EnemySlowed/Cursed/Marked/ArmourBroken), and capped Accuracy PerStat', () => {
    // Suffix parsing for PoE 2 conditionals
    expect(
      parseConditionalSuffix("25% increased Critical Damage Bonus if you've dealt a Non-Critical Hit Recently"),
    ).toEqual({
      baseLine: '25% increased Critical Damage Bonus',
      tags: [{ type: 'Condition', var: 'NonCritRecently' }],
    });
    expect(parseConditionalSuffix("40% increased Damage if you've Triggered a Skill Recently")).toEqual({
      baseLine: '40% increased Damage',
      tags: [{ type: 'Condition', var: 'TriggeredSkillRecently' }],
    });
    expect(parseConditionalSuffix('25% increased Damage while you have a Totem')).toEqual({
      baseLine: '25% increased Damage',
      tags: [{ type: 'Condition', var: 'HaveTotem' }],
    });
    expect(parseConditionalSuffix('40% increased Duration of Poisons against Slowed Enemies')).toEqual({
      baseLine: '40% increased Duration of Poisons',
      tags: [{ type: 'Condition', var: 'EnemySlowed' }],
    });
    expect(parseConditionalSuffix('20% increased duration of Ailments against Cursed Enemies')).toEqual({
      baseLine: '20% increased duration of Ailments',
      tags: [{ type: 'Condition', var: 'EnemyCursed' }],
    });
    expect(parseConditionalSuffix('25% increased Magnitude of Ailments against Marked Enemies')).toEqual({
      baseLine: '25% increased Magnitude of Ailments',
      tags: [{ type: 'Condition', var: 'EnemyMarked' }],
    });
    expect(parseConditionalSuffix('20% increased Damage against Enemies with Fully Broken Armour')).toEqual({
      baseLine: '20% increased Damage',
      tags: [{ type: 'Condition', var: 'EnemyArmourBroken' }],
    });
    expect(
      parseConditionalSuffix('4% increased Attack Speed while a Rare or Unique Enemy is in your Presence'),
    ).toEqual({
      baseLine: '4% increased Attack Speed',
      tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
    });
    expect(parseConditionalSuffix('1% increased Attack Speed per 400 Accuracy Rating, up to 20%')).toEqual({
      baseLine: '1% increased Attack Speed',
      tags: [{ type: 'PerStat', stat: 'Accuracy', div: 400, limit: 20, limitTotal: true }],
    });

    // Condition & multiplier aliases
    const ctx = createEmptyEvalContext();
    ctx.conditions.InfusionConsumedRecently = true;
    ctx.conditions.EnemyMaimed = true;
    ctx.conditions.Marked = true;
    ctx.conditions.ArmourFullyBroken = true;
    ctx.multipliers.SummonedTotem = 6;
    ctx.multipliers.CurseOnEnemy = 1;
    ctx.multipliers.NearbyAlly = 2;
    ctx.stats.Accuracy = 10000;

    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'ConsumedElementalInfusionRecently' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'HaveTotem' }] }), ctx).active,
    ).toBe(true);
    expect(
      applyModTagEval(3, evaluateModTags(makeMod({ value: 3, tags: [{ type: 'Multiplier', var: 'ActiveTotem' }] }), ctx)),
    ).toBe(18);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemySlowed' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyCursed' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyMarked' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyArmourBroken' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:NearbyAlly:1|CompanionInPresence' }] }),
        ctx,
      ).active,
    ).toBe(true);

    // Falcon Dive capped Accuracy PerStat (floor(10000/400) = 25 -> capped at 20 total)
    const falconMod = makeMod({
      value: 1,
      tags: [{ type: 'PerStat', stat: 'Accuracy', div: 400, limit: 20, limitTotal: true } as unknown as ModTag],
    });
    expect(applyModTagEval(1, evaluateModTags(falconMod, ctx))).toBe(20);
  });

  it('parses and evaluates Wave 4O-B suffixes (Summoned Totem in Presence, Electrocuted, Open Weakness, Shapeshifted to Human, Affected by Ailment)', () => {
    expect(
      parseConditionalSuffix('10% increased Attack Damage per Summoned Totem in your Presence'),
    ).toEqual({
      baseLine: '10% increased Attack Damage',
      tags: [{ type: 'Multiplier', var: 'ActiveTotem' }],
    });
    expect(parseConditionalSuffix('25% increased Damage against Electrocuted Enemies')).toEqual({
      baseLine: '25% increased Damage',
      tags: [{ type: 'Condition', var: 'EnemyElectrocuted' }],
    });
    expect(
      parseConditionalSuffix('50% more Damage against Enemies with an Open Weakness'),
    ).toEqual({
      baseLine: '50% more Damage',
      tags: [{ type: 'Condition', var: 'EnemyHasOpenWeakness|EnemyOpenWeakness' }],
    });
    expect(
      parseConditionalSuffix('15% increased Movement Speed if you have Shapeshifted to Human form Recently'),
    ).toEqual({
      baseLine: '15% increased Movement Speed',
      tags: [{ type: 'Condition', var: 'ShapeshiftedToHumanRecently' }],
    });
    expect(parseConditionalSuffix('20% increased Armour while affected by an Ailment')).toEqual({
      baseLine: '20% increased Armour',
      tags: [
        {
          type: 'Condition',
          var: 'Bleeding|Poisoned|Ignited|Chilled|Frozen|Shocked|Electrocuted',
        },
      ],
    });

    const ctx = createEmptyEvalContext();
    ctx.conditions.Electrocuted = true;
    ctx.conditions.EnemyOpenWeakness = true;
    ctx.conditions.ShapeshiftToHuman = true;
    ctx.conditions.Ignited = true;

    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyElectrocuted' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyHasOpenWeakness' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'ShapeshiftedToHumanRecently' }] }), ctx)
        .active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({
          tags: [
            {
              type: 'Condition',
              var: 'Bleeding|Poisoned|Ignited|Chilled|Frozen|Shocked|Electrocuted',
            },
          ],
        }),
        ctx,
      ).active,
    ).toBe(true);
  });

  it('parses and evaluates Wave 4P suffixes (different Spells cast recently, consumed/gained Charge recently)', () => {
    expect(
      parseConditionalSuffix("6% increased Cast Speed for each different Spell you've Cast in the last eight seconds"),
    ).toEqual({
      baseLine: '6% increased Cast Speed',
      tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }],
    });
    expect(
      parseConditionalSuffix("20% increased Energy Shield if you've consumed a Power Charge Recently"),
    ).toEqual({
      baseLine: '20% increased Energy Shield',
      tags: [{ type: 'Condition', var: 'ConsumedPowerChargeRecently' }],
    });
    expect(
      parseConditionalSuffix("15% increased Attack Speed if you've gained a Frenzy Charge Recently"),
    ).toEqual({
      baseLine: '15% increased Attack Speed',
      tags: [{ type: 'Condition', var: 'GainedFrenzyChargeRecently' }],
    });

    const ctx = createEmptyEvalContext();
    ctx.multipliers.DifferentSpellsCastRecently = 3;
    ctx.conditions.ConsumedPowerChargeRecently = true;
    ctx.conditions.GainedFrenzyChargeRecently = true;

    expect(
      applyModTagEval(
        6,
        evaluateModTags(
          makeMod({ value: 6, tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }] }),
          ctx,
        ),
      ),
    ).toBe(18);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'ConsumedPowerChargeRecently' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'GainedFrenzyChargeRecently' }] }), ctx).active,
    ).toBe(true);
  });

  it('parses and evaluates Wave 4Q suffixes (Open Weakness in Presence, per Enemy Ignited Recently capped)', () => {
    expect(
      parseConditionalSuffix('20% increased Movement Speed while an Enemy with an Open Weakness is in your Presence'),
    ).toEqual({
      baseLine: '20% increased Movement Speed',
      tags: [{ type: 'Condition', var: 'OpenWeaknessEnemyPresence|EnemyHasOpenWeakness|EnemyOpenWeakness' }],
    });
    expect(
      parseConditionalSuffix("4% increased Area of Effect for Attacks per Enemy you've Ignited in the last 8 seconds, up to 40%"),
    ).toEqual({
      baseLine: '4% increased Area of Effect for Attacks',
      tags: [{ type: 'Multiplier', var: 'EnemyIgnitedRecently', limit: 40, limitTotal: true }],
    });

    const ctx = createEmptyEvalContext();
    ctx.conditions.EnemyOpenWeakness = true;
    ctx.multipliers.EnemyIgnitedRecently = 15;
    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'OpenWeaknessEnemyPresence|EnemyHasOpenWeakness|EnemyOpenWeakness' }] }),
        ctx,
      ).active,
    ).toBe(true);
    expect(
      applyModTagEval(
        4,
        evaluateModTags(
          makeMod({
            value: 4,
            tags: [{ type: 'Multiplier', var: 'EnemyIgnitedRecently', limit: 40, limitTotal: true } as unknown as ModTag],
          }),
          ctx,
        ),
      ),
    ).toBe(40);
  });

  it('evaluates Wave 4R guards (CanApplyLightningExposure gating & SpellCostsLife via LifeCost stat)', () => {
    const ctxBlocked = createEmptyEvalContext();
    ctxBlocked.conditions.LightningExposure = true;
    ctxBlocked.conditions.CanApplyLightningExposure = false;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyLightningExposure' }] }), ctxBlocked)
        .active,
    ).toBe(false);

    const ctxAllowed = createEmptyEvalContext();
    ctxAllowed.conditions.LightningExposure = true;
    ctxAllowed.conditions.CanApplyLightningExposure = true;
    ctxAllowed.stats.LifeCost = 45;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyLightningExposure' }] }), ctxAllowed)
        .active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'SpellCostsLife' }] }), ctxAllowed).active,
    ).toBe(true);
  });

  it('enforces CanApply*Exposure===false even when Enemy*Exposure is true and derives CritInPast8Sec from CritRecently (Wave 4S)', () => {
    const ctxBlocked = createEmptyEvalContext();
    ctxBlocked.conditions.EnemyLightningExposure = true;
    ctxBlocked.conditions.CanApplyLightningExposure = false;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyLightningExposure' }] }), ctxBlocked)
        .active,
    ).toBe(false);

    const ctxCrit = createEmptyEvalContext();
    ctxCrit.conditions.CritRecently = true;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'CritInPast8Sec' }] }), ctxCrit).active,
    ).toBe(true);
  });

  it('evaluates Wave 4U Bloodline/Threshold tags (string & structured MultiplierThreshold/StatThreshold, upper/neg, PerStat dual-source)', () => {
    const ctx = createEmptyEvalContext();
    ctx.multipliers.CorruptedItem = 4;
    ctx.multipliers.GhastlyEyeJewel = 3;
    ctx.multipliers.Rage = 12;
    ctx.multipliers.ActiveTotem = 2;
    ctx.multipliers.ActiveTotemLimit = 3;
    ctx.stats.ActiveZombieLimit = 8;
    ctx.multipliers.ActiveRagingSpiritLimit = 20;

    // String-encoded Condition thresholds
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:CorruptedItem:4' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:CorruptedItem:5' }] }), ctx).active,
    ).toBe(false);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:GhastlyEyeJewel:3' }] }), ctx).active,
    ).toBe(true);
    // Aliased multiplier resolution inside MultiplierThreshold
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:SummonedTotem:2' }] }), ctx).active,
    ).toBe(true);
    // Upper-bound threshold
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:Rage:15:upper' }] }), ctx).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'MultiplierThreshold:Rage:10:upper' }] }), ctx).active,
    ).toBe(false);

    // Structured runtime MultiplierThreshold & StatThreshold tags
    expect(
      evaluateModTags(
        makeMod({
          tags: [{ type: 'MultiplierThreshold', var: 'CorruptedItem', threshold: 4 } as unknown as ModTag],
        }),
        ctx,
      ).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({
          tags: [{ type: 'MultiplierThreshold', var: 'Rage', threshold: 10, upper: true } as unknown as ModTag],
        }),
        ctx,
      ).active,
    ).toBe(false);
    expect(
      evaluateModTags(
        makeMod({
          tags: [{ type: 'StatThreshold', stat: 'ActiveZombieLimit', threshold: 8 } as unknown as ModTag],
        }),
        ctx,
      ).active,
    ).toBe(true);
    expect(
      evaluateModTags(
        makeMod({
          tags: [{ type: 'StatThreshold', stat: 'ActiveZombieLimit', threshold: 8, neg: true } as unknown as ModTag],
        }),
        ctx,
      ).active,
    ).toBe(false);

    // PerStat dual-source fallback (ctx.stats and ctx.multipliers)
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'PerStat', stat: 'ActiveZombieLimit', div: 1 }] }), ctx).scale,
    ).toBe(8);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'PerStat', stat: 'ActiveRagingSpiritLimit', div: 2 }] }), ctx).scale,
    ).toBe(10);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'PerStat', stat: 'ActiveTotemLimit', div: 1 }] }), ctx).scale,
    ).toBe(3);
  });

  it('guards EnemyExposure with CanApply*Exposure===false and gates Shapeshifted when shifted back to Human (Wave 4V)', () => {
    const ctxExpBlocked = createEmptyEvalContext();
    ctxExpBlocked.conditions.EnemyLightningExposure = true;
    ctxExpBlocked.conditions.CanApplyLightningExposure = false;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyExposure' }] }), ctxExpBlocked).active,
    ).toBe(false);

    const ctxExpAllowed = createEmptyEvalContext();
    ctxExpAllowed.conditions.EnemyColdExposure = true;
    ctxExpAllowed.conditions.CanApplyLightningExposure = false;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyExposure' }] }), ctxExpAllowed).active,
    ).toBe(true);

    // Human spell with both ShapeshiftToAnimal and ShapeshiftToHuman is NOT currently Shapeshifted
    const ctxHuman = createEmptyEvalContext();
    ctxHuman.conditions.ShapeshiftToAnimal = true;
    ctxHuman.conditions.ShapeshiftToHuman = true;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Shapeshifted' }] }), ctxHuman).active,
    ).toBe(false);

    // Active Bear/Wolf/Wyvern skill with explicit Shapeshifted=true stays active
    const ctxBear = createEmptyEvalContext();
    ctxBear.conditions.Shapeshifted = true;
    ctxBear.conditions.ShapeshiftToHuman = true;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Shapeshifted' }] }), ctxBear).active,
    ).toBe(true);
  });

  it('evaluates Wave 4Y PoE 1+2 parity aliases (EnemyBurning<-EnemyIgnited, OnConsecratedGround, CritRecently, PerStat attribute aliases)', () => {
    const ctx = createEmptyEvalContext();
    ctx.conditions.EnemyIgnited = true;
    ctx.conditions.ConsecratedGround = true;
    ctx.conditions.SkillCritRecently = true;
    ctx.stats.Str = 450;
    ctx.stats.EnergyShield = 1200;

    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyBurning' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'OnConsecratedGround' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'CritRecently' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'PerStat', stat: 'Strength', div: 10 }] }), ctx).scale).toBe(45);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'PerStat', stat: 'ES', div: 100 }] }), ctx).scale).toBe(12);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'StatThreshold:Strength:400' }] }), ctx).active,
    ).toBe(true);
  });

  it('aliases EnergyShieldRechargePastTwoSec <-> EnergyShieldRechargeStartedRecently and HaveEnergyShield <- FullEnergyShield (Wave 4Z)', () => {
    const ctx = createEmptyEvalContext();
    ctx.conditions.EnergyShieldRechargePastTwoSec = true;
    ctx.conditions.FullEnergyShield = true;

    expect(
      evaluateModTags(
        makeMod({ tags: [{ type: 'Condition', var: 'EnergyShieldRechargeStartedRecently' }] }),
        ctx,
      ).active,
    ).toBe(true);
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'HaveEnergyShield' }] }), ctx).active,
    ).toBe(true);

    const ctxNoEsCond = createEmptyEvalContext();
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'HaveEnergyShield' }] }), ctxNoEsCond).active,
    ).toBe(false);
  });

  it('derives AtMax*Charges/AtMaxRage from multipliers and aliases Crit/Impale/Life conditions (Wave 5C)', () => {
    const ctx = createEmptyEvalContext();
    ctx.conditions.CriticalStrike = true;
    ctx.conditions.ImpaledRecently = true;
    ctx.conditions.KilledUniqueRecently = true;
    ctx.conditions.FullLife = true;
    ctx.conditions.EnemyLowLife = true;
    ctx.multipliers.EnemyImpaleStacks = 5;
    ctx.multipliers.PowerCharge = 11;
    ctx.multipliers.PowerChargeMax = 11;
    ctx.multipliers.FrenzyCharge = 4;
    ctx.multipliers.FrenzyChargeMax = 6;
    ctx.multipliers.EnduranceCharge = 6;
    ctx.multipliers.MaxEnduranceCharge = 6;
    ctx.multipliers.Rage = 55;
    ctx.multipliers.RageMax = 55;

    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Crit' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'ImpaledEnemyRecently' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyImpaled' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'KilledRareOrUniqueRecently' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'OnFullLife' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'EnemyOnLowLife' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtMaxPowerCharges' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtMaxFrenzyCharges' }] }), ctx).active).toBe(false);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtMaxEnduranceCharges' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtMaxRage' }] }), ctx).active).toBe(true);
  });

  it('derives Leeching from Life/ES/Mana leech, InflictedExposureRecently from EnemyExposure, and AtCloseRange from explicit distance<=15 (Wave 6A)', () => {
    const ctxLeech = createEmptyEvalContext();
    ctxLeech.conditions.LeechingEnergyShield = true;
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'Leeching' }] }), ctxLeech).active).toBe(true);

    const ctxExp = createEmptyEvalContext();
    ctxExp.conditions.EnemyFireExposure = true;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'InflictedExposureRecently' }] }), ctxExp).active,
    ).toBe(true);
    ctxExp.conditions.CanApplyFireExposure = false;
    expect(
      evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'InflictedExposureRecently' }] }), ctxExp).active,
    ).toBe(false);

    const ctxClose = createEmptyEvalContext();
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtCloseRange' }] }), ctxClose).active).toBe(false);
    ctxClose.conditions.MeleeProximity = true;
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtCloseRange' }] }), ctxClose).active).toBe(false);
    ctxClose.stats.EnemyDistance = 10;
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtCloseRange' }] }), ctxClose).active).toBe(true);
  });

  it('evaluates Focused Channelling ChannellingTime without flooring and with limitTotal, plus PoE 1 Multiplier/Condition aliases (Wave 6E)', () => {
    const fcMod = makeMod({
      type: 'MORE',
      value: 24,
      tags: [{ type: 'Multiplier', var: 'ChannellingTime', limit: 60 }],
    });
    const ctx = createEmptyEvalContext();
    ctx.multipliers.ChannellingTime = 2.5;
    expect(applyModTagEval(24, evaluateModTags(fcMod, ctx))).toBeCloseTo(60, 5);
    ctx.multipliers.ChannellingTime = 4;
    expect(applyModTagEval(24, evaluateModTags(fcMod, ctx))).toBeCloseTo(60, 5);

    ctx.multipliers.PowerCharge = 10;
    ctx.multipliers.Intensity = 4;
    ctx.multipliers.SustainableTraumaStacks = 18;
    ctx.multipliers.WitheredStacks = 15;
    ctx.multipliers.VirulenceStacks = 40;
    ctx.multipliers.CurseApplied = 2;
    ctx.multipliers.EnemyChillEffect = 30;
    ctx.multipliers.Fortification = 25;
    ctx.multipliers.RemovablePowerCharge = 3;
    ctx.multipliers.RemovableFrenzyCharge = 4;
    ctx.multipliers.RemovableEnduranceCharge = 5;
    ctx.multipliers.ChainRemaining = 3;
    ctx.conditions.KilledRecently = true;
    ctx.conditions.HaveMaximumRage = true;

    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'PowerCharges' }] }), ctx).scale).toBe(10);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'IntensityStacks' }] }), ctx).scale).toBe(4);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'TraumaStack' }] }), ctx).scale).toBe(18);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'WitheredStack' }] }), ctx).scale).toBe(15);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'VirulenceStack' }] }), ctx).scale).toBe(40);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'CurseOnEnemy' }] }), ctx).scale).toBe(2);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'ChillEffect' }] }), ctx).scale).toBe(30);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'RemovableFortification' }] }), ctx).scale).toBe(25);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'RemovableTotalCharges' }] }), ctx).scale).toBe(12);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'Chain' }] }), ctx).scale).toBe(3);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'KillRecently' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'AtMaxRage' }] }), ctx).active).toBe(true);

    // Wave 6M: Mine/Trap multiplier & condition aliases (Tree:45608 MineDetonatedRecently)
    ctx.multipliers.MineDetonatedRecently = 10;
    ctx.multipliers.ActiveMineCount = 15;
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'MinesDetonatedRecently' }] }), ctx).scale).toBe(10);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Condition', var: 'DetonatedMinesRecently' }] }), ctx).active).toBe(true);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'RemoteMineCount' }] }), ctx).scale).toBe(15);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'MinesThrown' }] }), ctx).scale).toBe(15);
    expect(evaluateModTags(makeMod({ tags: [{ type: 'Multiplier', var: 'TrapOrMineCount' }] }), ctx).scale).toBe(15);
  });

  it('computes PoE 1 Empower/Enhance level-scaled bonuses before static compiledMods in gemBonus (Wave 6E)', () => {
    const activeGem: GemDefinition = {
      id: 'bodyswap',
      game: 'poe1',
      name: { en: 'Bodyswap', zh: '灵体转换' },
      category: 'active',
      color: 'blue',
      tags: ['Spell', 'Fire'],
      modFlags: 0,
      keywordFlags: 0,
      stats: [],
    };
    const supportTarget: GemDefinition = {
      ...activeGem,
      id: 'spell_totem',
      name: { en: 'Spell Totem Support', zh: '法术图腾辅助' },
      category: 'support',
    };
    const empower: GemDefinition = {
      ...supportTarget,
      id: 'empower',
      name: { en: 'Empower Support', zh: '赋予辅助' },
      compiledMods: [{ name: 'SupportedGemLevel', type: 'BASE', value: 2, flags: 0, keywordFlags: 0 }],
    };
    const awkEmpower: GemDefinition = {
      ...empower,
      id: 'awk_empower',
      name: { en: 'Awakened Empower Support', zh: '觉醒赋予辅助' },
      compiledMods: [{ name: 'SupportedGemLevel', type: 'BASE', value: 19, flags: 0, keywordFlags: 0 }],
    };
    const enhance: GemDefinition = {
      ...supportTarget,
      id: 'enhance',
      name: { en: 'Enhance Support', zh: '增幅辅助' },
      compiledMods: [{ name: 'SupportedGemQuality', type: 'BASE', value: 16, flags: 0, keywordFlags: 0 }],
    };
    const awkEnhance: GemDefinition = {
      ...enhance,
      id: 'awk_enhance',
      name: { en: 'Awakened Enhance Support', zh: '觉醒增幅辅助' },
      compiledMods: [{ name: 'SupportedGemQuality', type: 'BASE', value: 152, flags: 0, keywordFlags: 0 }],
    };

    expect(resolveSupportGemLevelBonus(empower, activeGem, 4)).toEqual({ levelBonus: 3, qualityBonus: 0 });
    expect(resolveSupportGemLevelBonus(awkEmpower, activeGem, 5)).toEqual({ levelBonus: 4, qualityBonus: 0 });
    expect(resolveSupportGemLevelBonus(enhance, activeGem, 4)).toEqual({ levelBonus: 0, qualityBonus: 24 });
    expect(resolveSupportGemLevelBonus(awkEnhance, activeGem, 5)).toEqual({ levelBonus: 0, qualityBonus: 32 });
    expect(resolveSupportGemLevelBonus(empower, supportTarget, 4)).toEqual({ levelBonus: 0, qualityBonus: 0 });
    expect(resolveSupportGemLevelBonus(enhance, supportTarget, 4)).toEqual({ levelBonus: 0, qualityBonus: 0 });

    // Wave 6K: explicit isCorrupted=false must NEVER receive +N to Level of all Corrupted Skill Gems
    const corruptDb = new ModDB();
    corruptDb.addMod({
      name: 'GemLevel:corrupted',
      type: 'BASE',
      value: 1,
      flags: 0,
      keywordFlags: 0,
      source: 'Item:Body Armour',
    });
    expect(resolveGemBonuses(activeGem, corruptDb, [], { isCorrupted: false })).toEqual({
      levelBonus: 0,
      qualityBonus: 0,
    });
    expect(resolveGemBonuses(activeGem, corruptDb, [], { isCorrupted: true })).toEqual({
      levelBonus: 1,
      qualityBonus: 0,
    });
  });
});
