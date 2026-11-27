import { describe, expect, it } from 'vitest';
import type { Mod, ModTag } from '@webpob/core';
import { ModDB } from './modDb.js';
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
});
