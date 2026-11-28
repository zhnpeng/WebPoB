import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag } from '@webpob/core';
import { parseModLine, parseModLines } from './modParser.js';
import { POE1_EXTRA_MOD_RULES, parsePoe1ExtraModLine } from './modParserPoe1.js';
import { ModDB } from './modDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

describe('modParserPoe1 — PoE 1 High-Coverage ModParser Expansion', () => {
  it('exports at least 150 PoE 1 extended modifier rules', () => {
    expect(POE1_EXTRA_MOD_RULES.length).toBeGreaterThanOrEqual(150);
  });

  it('fixes P0 bugs: MaxCharges naming, Iron Grip trailing text, The Agnostic, and less ES', () => {
    expect(parseModLine('+1 to Maximum Power Charges', 'item')).toEqual([
      expect.objectContaining({ name: 'MaxPowerCharges', type: 'BASE', value: 1 }),
    ]);
    expect(parseModLine('+2 to Maximum Frenzy Charges', 'item')).toEqual([
      expect.objectContaining({ name: 'MaxFrenzyCharges', type: 'BASE', value: 2 }),
    ]);
    expect(parseModLine('+1 to Maximum Endurance Charge', 'tree')).toEqual([
      expect.objectContaining({ name: 'MaxEnduranceCharges', type: 'BASE', value: 1 }),
    ]);
    expect(
      parseModLine(
        "Strength's Damage bonus applies to Projectile Attack Damage as well as Melee Damage",
        'tree',
      ),
    ).toEqual([expect.objectContaining({ name: 'IronGrip', type: 'FLAG', value: true })]);
    expect(parseModLine('Removes all Energy Shield', 'tree')).toEqual([
      expect.objectContaining({ name: 'EnergyShield', type: 'OVERRIDE', value: 0 }),
    ]);
    expect(parseModLine('80% less maximum Energy Shield', 'gem')).toEqual([
      expect.objectContaining({ name: 'EnergyShield', type: 'MORE', value: -80 }),
    ]);
  });

  it('parses reduced modifiers as negative INC values', () => {
    expect(parseModLine('10% reduced Movement Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'MovementSpeed', type: 'INC', value: -10 }),
    ]);
    expect(parseModLine('15% reduced Attack Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: -15, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('12% reduced Cast Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: -12, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('8% reduced Attack and Cast Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: -8, flags: ModFlag.Attack }),
      expect.objectContaining({ name: 'Speed', type: 'INC', value: -8, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('20% reduced Mana Cost of Skills', 'tree')).toEqual([
      expect.objectContaining({ name: 'ManaCost', type: 'INC', value: -20 }),
    ]);
    expect(parseModLine('15% reduced Skill Effect Duration', 'tree')).toEqual([
      expect.objectContaining({ name: 'Duration', type: 'INC', value: -15 }),
    ]);
    expect(parseModLine('10% reduced maximum Life', 'item')).toEqual([
      expect.objectContaining({ name: 'Life', type: 'INC', value: -10 }),
    ]);
    expect(parseModLine('20% reduced Armour', 'item')).toEqual([
      expect.objectContaining({ name: 'Armour', type: 'INC', value: -20 }),
    ]);
    expect(parseModLine('15% reduced Reservation of Skills', 'item')).toEqual([
      expect.objectContaining({ name: 'ManaReserved', type: 'INC', value: -15 }),
    ]);
  });

  it('parses attribute % increases, per-charge scaling, and per-attribute stacking', () => {
    expect(parseModLine('16% increased Strength', 'item')).toEqual([
      expect.objectContaining({ name: 'Str', type: 'INC', value: 16 }),
    ]);
    expect(parseModLine('7% increased Attributes', 'jewel')).toEqual([
      expect.objectContaining({ name: 'Str', type: 'INC', value: 7 }),
      expect.objectContaining({ name: 'Dex', type: 'INC', value: 7 }),
      expect.objectContaining({ name: 'Int', type: 'INC', value: 7 }),
    ]);
    expect(parseModLine('Adds 50 to 70 Cold Damage to Spells per Power Charge', 'item')).toEqual([
      expect.objectContaining({ name: 'FlatMinPerPowerCharge:Cold', type: 'BASE', value: 50, flags: ModFlag.Spell }),
      expect.objectContaining({ name: 'FlatMaxPerPowerCharge:Cold', type: 'BASE', value: 70, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('8% increased Critical Strike Chance per Power Charge', 'tree')).toEqual([
      expect.objectContaining({ name: 'CritChancePerPowerCharge', type: 'BASE', value: 8 }),
    ]);
    expect(parseModLine('Adds 1 to 80 Chaos Damage to Attacks per 80 Strength', 'item')).toEqual([
      expect.objectContaining({ name: 'FlatMinPerAttr:Chaos:Strength', type: 'BASE', value: 1 / 80 }),
      expect.objectContaining({ name: 'FlatMaxPerAttr:Chaos:Strength', type: 'BASE', value: 1 }),
    ]);
    expect(parseModLine('+1% Chance to Block Attack Damage per 50 Strength', 'item')).toEqual([
      expect.objectContaining({ name: 'BlockChancePerAttr:Strength', type: 'BASE', value: 1 / 50 }),
    ]);
  });

  it('parses weapon-specific, dual-wield, shield, crit, and minion combat modifiers', () => {
    expect(parseModLine('12% increased Physical Damage with Two Handed Melee Weapons', 'tree')).toEqual([
      expect.objectContaining({
        name: 'PhysicalDamage',
        type: 'INC',
        value: 12,
        flags: ModFlag.Attack | ModFlag.Weapon2H | ModFlag.Melee,
      }),
    ]);
    expect(parseModLine('Axe Attacks deal 30% increased Damage with Ailments', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 30,
        flags: ModFlag.Attack | ModFlag.Axe | ModFlag.Ailment,
      }),
    ]);
    expect(parseModLine('Attack Skills deal 10% increased Damage while Dual Wielding', 'tree')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'INC', value: 10, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('4% increased Attack Speed while Dual Wielding', 'tree')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 4, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('+15% to Critical Strike Multiplier for Spell Damage', 'jewel')).toEqual([
      expect.objectContaining({ name: 'CritMultiplier', type: 'BASE', value: 15, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('+17% to Critical Strike Multiplier with Cold Skills', 'jewel')).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 17,
        keywordFlags: KeywordFlag.Cold,
      }),
    ]);
    expect(parseModLine('Adds 10 to 20 Fire Damage to Spells and Attacks', 'item')).toEqual([
      expect.objectContaining({ name: 'FireMin', type: 'BASE', value: 10 }),
      expect.objectContaining({ name: 'FireMax', type: 'BASE', value: 20 }),
    ]);
    expect(parseModLine('Minions have 4% increased Attack Speed', 'tree')).toEqual([
      expect.objectContaining({ name: 'MinionSpeed', type: 'INC', value: 4, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('Socketed Skills deal 20% more Attack Damage', 'item')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'MORE', value: 20, flags: ModFlag.Attack }),
    ]);
  });

  it('parses block, reservation, damage taken as, flasks, recoup, ailments, and penetration', () => {
    expect(parseModLine('+4% Chance to Block Attack Damage while holding a Shield', 'tree')).toEqual([
      expect.objectContaining({ name: 'BlockChance', type: 'BASE', value: 4 }),
    ]);
    expect(parseModLine('+3% to maximum Chance to Block Spell Damage', 'tree')).toEqual([
      expect.objectContaining({ name: 'SpellBlockChanceMax', type: 'BASE', value: 3 }),
    ]);
    expect(parseModLine('60% increased Energy Shield from Equipped Shield', 'tree')).toEqual([
      expect.objectContaining({ name: 'ShieldEnergyShieldInc', type: 'INC', value: 60 }),
    ]);
    expect(parseModLine('8% increased Reservation Efficiency of Skills', 'tree')).toEqual([
      expect.objectContaining({ name: 'ManaReservationEfficiency', type: 'INC', value: 8 }),
    ]);
    expect(parseModLine('10% of Physical Damage from Hits taken as Fire Damage', 'item')).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageTakenAsFire', type: 'BASE', value: 10 }),
    ]);
    expect(parseModLine('Flasks applied to you have 10% increased Effect', 'tree')).toEqual([
      expect.objectContaining({ name: 'FlaskEffect', type: 'INC', value: 10 }),
    ]);
    expect(parseModLine('4% of Damage taken Recouped as Life', 'tree')).toEqual([
      expect.objectContaining({ name: 'LifeRecoup', type: 'BASE', value: 4 }),
    ]);
    expect(parseModLine('+10% to Damage over Time Multiplier for Poison', 'tree')).toEqual([
      expect.objectContaining({ name: 'ChaosDotMultiplier', type: 'BASE', value: 10 }),
    ]);
    expect(parseModLine('0.8% of Physical Attack Damage Leeched as Life', 'tree')).toEqual([
      expect.objectContaining({ name: 'LifeLeech', type: 'BASE', value: 0.8 }),
    ]);
    expect(parseModLine('Attacks have 10% chance to cause Bleeding', 'tree')).toEqual([
      expect.objectContaining({ name: 'BleedChance', type: 'BASE', value: 10 }),
    ]);
    expect(parseModLine('Damage Penetrates 10% Elemental Resistances', 'item')).toEqual([
      expect.objectContaining({ name: 'FirePenetration', type: 'BASE', value: 10 }),
      expect.objectContaining({ name: 'ColdPenetration', type: 'BASE', value: 10 }),
      expect.objectContaining({ name: 'LightningPenetration', type: 'BASE', value: 10 }),
    ]);
    // Verify standalone parsePoe1ExtraModLine helper
    expect(parsePoe1ExtraModLine('8% increased Area of Effect', 'tree')).toEqual([
      expect.objectContaining({ name: 'AreaOfEffect', type: 'INC', value: 8 }),
    ]);
  });

  it('parses Wave 4M ProjectileCount, SplitCount, and high-leverage PoE 1 unique mods', () => {
    // 1. ProjectileCount & SplitCount
    expect(parseModLine('Bow Attacks fire an additional Arrow', 'item')).toEqual([
      expect.objectContaining({
        name: 'ProjectileCount',
        type: 'BASE',
        value: 1,
        flags: ModFlag.Attack | ModFlag.Bow,
      }),
    ]);
    expect(parseModLine('Bow Attacks fire 2 additional Arrows', 'item')).toEqual([
      expect.objectContaining({
        name: 'ProjectileCount',
        type: 'BASE',
        value: 2,
        flags: ModFlag.Attack | ModFlag.Bow,
      }),
    ]);
    expect(parseModLine('Skills fire 2 additional Projectiles', 'tree')).toEqual([
      expect.objectContaining({ name: 'ProjectileCount', type: 'BASE', value: 2, flags: 0 }),
    ]);
    expect(parseModLine('Attack Skills fire 2 additional Projectiles', 'item')).toEqual([
      expect.objectContaining({ name: 'ProjectileCount', type: 'BASE', value: 2, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('Spells fire an additional Projectile', 'item')).toEqual([
      expect.objectContaining({ name: 'ProjectileCount', type: 'BASE', value: 1, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('Totems fire 2 additional Projectiles', 'item')).toEqual([
      expect.objectContaining({
        name: 'ProjectileCount',
        type: 'BASE',
        value: 2,
        keywordFlags: KeywordFlag.Totem,
      }),
    ]);
    expect(parseModLine('Skills fire 2 additional Projectiles during Effect', 'flask')).toEqual([
      expect.objectContaining({ name: 'ProjectileCount', type: 'BASE', value: 2, flags: 0 }),
    ]);
    expect(parseModLine('Projectiles Split towards +2 targets', 'item')).toEqual([
      expect.objectContaining({ name: 'SplitCount', type: 'BASE', value: 2 }),
    ]);

    // 2. The Annihilating Light (Deal without trailing s)
    expect(parseModLine('Deal Triple Damage with Elemental Skills', 'item')).toEqual([
      expect.objectContaining({ name: 'TripleDamageElementalSkill', type: 'FLAG', value: true }),
    ]);

    // 3. Sandstorm Visage
    expect(
      parseModLine(
        'Base Spell Critical Strike Chance is equal to the Critical Strike Chance of Main Hand Weapon',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({ name: 'SpellCritChanceFromMainHandWeapon', type: 'FLAG', value: true }),
    ]);

    // 4. Enmity's Embrace
    expect(
      parseModLine(
        'Damage Penetrates Fire Resistance equal to your Overcapped Fire Resistance, up to a maximum of 200%',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'FirePenetration',
        type: 'BASE',
        value: 1,
        flags: ModFlag.Hit,
        tags: [{ type: 'PerStat', stat: 'FireResistOverCap', div: 1, limit: 200 }],
      }),
    ]);

    // 5. Seething Fury
    expect(
      parseModLine('+0.15% to Off Hand Critical Strike Chance per 10 Maximum Energy Shield on Shield', 'jewel'),
    ).toEqual([expect.objectContaining({ name: 'OffHandBaseCritPer10ShieldEs', type: 'BASE', value: 0.15 })]);
    expect(
      parseModLine('+4% to Off Hand Critical Strike Multiplier per 10 Maximum Energy Shield on Shield', 'jewel'),
    ).toEqual([expect.objectContaining({ name: 'OffHandCritMultiPer10ShieldEs', type: 'BASE', value: 4 })]);

    // 6. The Apostate
    expect(
      parseModLine('Gain Maximum Life instead of Maximum Energy Shield from Equipped Armour Items', 'item'),
    ).toEqual([expect.objectContaining({ name: 'ConvertArmourESToLife', type: 'FLAG', value: true })]);

    // 7. Foulborn Rathpith Globe
    expect(parseModLine('Deal 5% increased Damage Over Time per 100 Player Maximum Life', 'item')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 5,
        flags: ModFlag.Dot,
        tags: [{ type: 'PerStat', stat: 'Life', div: 100 }],
      }),
    ]);

    // 8. The Tempest Rising
    expect(
      parseModLine('Enemies affected by your Elemental Ailments count as Moving while Bleeding', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'EnemyAffectedByEleAilmentCountsAsMoving', type: 'FLAG', value: true }),
    ]);

    // 9. Frostbreath & Paradoxica
    expect(parseModLine('Attacks with this Weapon deal Double Damage to Chilled Enemies', 'item')).toEqual([
      expect.objectContaining({
        name: 'DoubleDamageChance',
        type: 'BASE',
        value: 100,
        flags: ModFlag.Attack | ModFlag.Hit,
        tags: [{ type: 'Condition', var: 'EnemyChilled' }],
      }),
    ]);
    expect(parseModLine('Attacks with this Weapon deal Double Damage', 'item')).toEqual([
      expect.objectContaining({
        name: 'DoubleDamageChance',
        type: 'BASE',
        value: 100,
        flags: ModFlag.Attack | ModFlag.Hit,
      }),
    ]);

    // 10. Sap of the Seasons
    expect(
      parseModLine(
        'Melee Weapon Damage Penetrates 1% Elemental Resistances per Mana Burn, up to a maximum of 200%',
        'tincture',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalPenetration',
        type: 'BASE',
        value: 1,
        flags: ModFlag.Attack | ModFlag.Melee,
        tags: [{ type: 'Multiplier', var: 'ManaBurn', limit: 200 }],
      }),
    ]);

    // 11. Crest of Desire
    expect(parseModLine('Socketed Gems deal Double Damage', 'item')).toEqual([
      expect.objectContaining({
        name: 'DoubleDamageChance',
        type: 'BASE',
        value: 100,
        tags: [{ type: 'SocketedIn' }],
      }),
    ]);
  });

  it('parses Wave 4M-B PoE 1 Accuracy Masteries, Withered Effect, and Ascendancy/Unique rules (RC-6/9/10)', () => {
    // RC-6: 4 Accuracy Masteries
    expect(parseModLine('Gain Accuracy Rating equal to your Intelligence', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'BASE',
        value: 1,
        flags: 0,
        tags: [{ type: 'PerStat', stat: 'Int', div: 1 }],
      }),
    ]);
    expect(parseModLine('Intelligence is added to Accuracy Rating with Wands', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'BASE',
        value: 1,
        flags: ModFlag.Wand,
        tags: [{ type: 'PerStat', stat: 'Int', div: 1 }],
      }),
    ]);
    expect(parseModLine('40% more Accuracy Rating against Unique Enemies', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'MORE',
        value: 40,
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      }),
    ]);
    expect(
      parseModLine("Dexterity's Accuracy Bonus instead grants +3 to Accuracy Rating per Dexterity", 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'Dex', div: 1 }],
      }),
    ]);

    // RC-9: Withered Effect (excludes defensive "on you")
    expect(parseModLine('20% increased Effect of Withered', 'tree')).toEqual([
      expect.objectContaining({ name: 'WitherEffect', type: 'INC', value: 20, flags: 0 }),
    ]);
    expect(parseModLine('Withered you inflict has 15% increased Effect', 'item')).toEqual([
      expect.objectContaining({ name: 'WitherEffect', type: 'INC', value: 15, flags: 0 }),
    ]);
    expect(parseModLine('65% reduced Effect of Withered on you', 'tree')).toEqual([]);

    // RC-10: Unstoppable Hero, Rage Mastery Intimidate, Ascendant Necro, Rite of Ruin, The Taming, Shroud of the Lightless
    expect(parseModLine('3% increased Attack Speed per Fortification above 20', 'tree')).toEqual([
      expect.objectContaining({ name: 'UnstoppableHero', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('3% more Armour and Evasion Rating per Fortification above 20', 'tree')).toEqual([
      expect.objectContaining({ name: 'UnstoppableHero', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Nearby Enemies are Intimidated while you have Rage', 'tree')).toEqual([
      expect.objectContaining({ name: 'EnemyIntimidatedWhileRage', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Enemies within 6 metres are Intimidated while you have Rage', 'tree')).toEqual([
      expect.objectContaining({ name: 'EnemyIntimidatedWhileRage', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Auras from your Skills grant 2% increased Attack and Cast Speed to you and Allies', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 2,
        flags: ModFlag.Attack,
        tags: [{ type: 'Multiplier', var: 'AuraAffectingSelf' }],
      }),
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 2,
        flags: ModFlag.Spell,
        tags: [{ type: 'Multiplier', var: 'AuraAffectingSelf' }],
      }),
    ]);
    expect(parseModLine('50% increased Rage Effect', 'tree')).toEqual([
      expect.objectContaining({ name: 'RageEffect', type: 'INC', value: 50 }),
    ]);
    expect(parseModLine('Rage Effect is increased by 50%', 'tree')).toEqual([
      expect.objectContaining({ name: 'RageEffect', type: 'INC', value: 50 }),
    ]);
    expect(
      parseModLine(
        '35% increased Elemental Damage with Hits and Ailments for each type of Elemental Ailment on Enemy',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalDamage',
        type: 'INC',
        value: 35,
        flags: ModFlag.Hit | ModFlag.Ailment,
        tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
      }),
    ]);
    expect(
      parseModLine(
        '20% increased Damage with Hits and Ailments per Freeze, Shock or Ignite on Enemy',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 20,
        flags: ModFlag.Hit | ModFlag.Ailment,
        tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
      }),
    ]);
    expect(
      parseModLine('Damage Penetrates 4% Elemental Resistances per Abyss Jewel affecting you', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalPenetration',
        type: 'BASE',
        value: 4,
        flags: ModFlag.Hit,
        tags: [{ type: 'Multiplier', var: 'AbyssJewel' }],
      }),
    ]);
    expect(
      parseModLine('Penetrate 4% Elemental Resistances per Abyss Jewel affecting you', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalPenetration',
        type: 'BASE',
        value: 4,
        flags: ModFlag.Hit,
        tags: [{ type: 'Multiplier', var: 'AbyssJewel' }],
      }),
    ]);
  });

  it('parses Wave 4N Sandstorm Visage, Wand/Enchant projectiles, Mind of the Council, Triumvirate, and 62dfba0 keystones', () => {
    // 1. 62dfba0 Keystones & Blood Magic preservation
    expect(parseModLine('Removes all mana', 'tree')).toEqual([
      expect.objectContaining({ name: 'BloodMagic', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'Mana', type: 'OVERRIDE', value: 0 }),
    ]);
    expect(parseModLine('Dexterity provides no inherent bonus to Evasion Rating', 'tree')).toEqual([
      expect.objectContaining({ name: 'NoDexEvasionBonus', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('40% more Attack Damage if Accuracy Rating is higher than Maximum Life', 'tree'),
    ).toEqual([
      expect.objectContaining({ name: 'PreciseTechnique', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'PreciseTechniqueMorePct', type: 'BASE', value: 40 }),
    ]);
    expect(
      parseModLine('Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier', 'tree'),
    ).toEqual([expect.objectContaining({ name: 'PerfectAgony', type: 'FLAG', value: true })]);
    expect(parseModLine('Non-Critical Strikes cannot inflict Ailments', 'tree')).toEqual([
      expect.objectContaining({ name: 'NonCritsCannotInflictAilments', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Critical Strikes do not deal extra Damage', 'tree')).toEqual([
      expect.objectContaining({ name: 'NoCritExtraDamage', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('You can inflict Bleeding on an Enemy up to 8 times', 'tree')).toEqual([
      expect.objectContaining({ name: 'CrimsonDance', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Your Bleeding does not deal extra Damage while the Enemy is moving and cannot be Aggravated', 'tree'),
    ).toEqual([expect.objectContaining({ name: 'CrimsonDance', type: 'FLAG', value: true })]);
    expect(parseModLine('Cannot Evade enemy Attacks', 'tree')).toEqual([
      expect.objectContaining({ name: 'CannotEvade', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Magebane', 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Magebane', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'NoDexEvasionBonus', type: 'FLAG', value: true }),
        expect.objectContaining({
          name: 'SpellSuppressionChance',
          type: 'BASE',
          value: 1,
          tags: [{ type: 'PerStat', stat: 'Dex', div: 15 }],
        }),
      ]),
    );
    expect(parseModLine('Precise Technique', 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'PreciseTechnique', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'NeverCrit', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'PreciseTechniqueMorePct', type: 'BASE', value: 40 }),
      ]),
    );
    expect(parseModLine('Perfect Agony', 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'PerfectAgony', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'NoCritExtraDamage', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'NonCritsCannotInflictAilments', type: 'FLAG', value: true }),
      ]),
    );
    expect(parseModLine('Unwavering Stance', 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'UnwaveringStance', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'CannotEvade', type: 'FLAG', value: true }),
      ]),
    );

    // 2. Sandstorm Visage exact PoE 1 text
    expect(
      parseModLine('Base Spell Critical Strike Chance of Spells is equal to that of Main Hand Weapon', 'item'),
    ).toEqual([expect.objectContaining({ name: 'SpellCritChanceFromMainHandWeapon', type: 'FLAG', value: true })]);

    // 3. Wand Mastery, Lab Enchant, Mind of the Council, Triumvirate Authority
    expect(parseModLine('Attacks with Wands fire an additional Projectile', 'tree')).toEqual([
      expect.objectContaining({
        name: 'ProjectileCount',
        type: 'BASE',
        value: 1,
        flags: ModFlag.Attack | ModFlag.Wand,
      }),
    ]);
    expect(parseModLine('Ice Spear fires an additional Projectile', 'item')).toEqual([
      expect.objectContaining({ name: 'ProjectileCount:ice spear', type: 'BASE', value: 1 }),
    ]);
    expect(parseModLine('Attacks have Added Lightning Damage equal to 6% of Maximum Mana', 'item')).toEqual([
      expect.objectContaining({ name: 'MindOfTheCouncilManaPct', type: 'BASE', value: 6 }),
    ]);
    expect(parseModLine('Socketed Vaal Skills deal 150% more Damage', 'item')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 150,
        tags: [{ type: 'SocketedIn' }],
      }),
    ]);

    // 4. Opportunistic, Toxic Delivery, Withering Presence, Action Speed
    expect(
      parseModLine('25% more Damage while there is at most one Rare or Unique Enemy within 6 metres', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 25,
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      }),
    ]);
    expect(
      parseModLine('5% increased Poison Duration for each Poison you have inflicted Recently, up to a maximum of 100%', 'tree'),
    ).toEqual([expect.objectContaining({ name: 'ToxicDeliveryPoisonDurCap', type: 'BASE', value: 100 })]);
    expect(parseModLine('15% more Chaos Damage', 'tree')).toEqual([
      expect.objectContaining({ name: 'ChaosDamage', type: 'MORE', value: 15 }),
    ]);
    expect(parseModLine('6% increased Action Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'ActionSpeed', type: 'INC', value: 6 }),
    ]);
  });

  it('parses Wave 4O PoE 1 mechanics, wrapped lines, limitTotal caps, MineLayingSpeed, and weapon-flagged Attack Speed', () => {
    // 1. Blood Magic rule preserved
    expect(parseModLine('Removes all mana', 'tree')).toEqual([
      expect.objectContaining({ name: 'BloodMagic', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'Mana', type: 'OVERRIDE', value: 0 }),
    ]);

    // 2. Spiritual Aid, Str->Accuracy, Tailwind, Slayer Impact, Mind of the Council (Attack Skills)
    expect(parseModLine('Increases and Reductions to Minion Damage also affect you', 'tree')).toEqual([
      expect.objectContaining({ name: 'SpiritualAid', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Gain Accuracy Rating equal to your Strength', 'item')).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'Str', div: 1 }],
      }),
    ]);
    expect(parseModLine('You and nearby Allies have Tailwind', 'tree')).toEqual([
      expect.objectContaining({ name: 'HasTailwind', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'Condition:Tailwind', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('You have Tailwind if you have dealt a Critical Strike Recently', 'item')).toEqual([
      expect.objectContaining({
        name: 'HasTailwind',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'CritRecently' }],
      }),
      expect.objectContaining({
        name: 'Condition:Tailwind',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'CritRecently' }],
      }),
    ]);
    expect(parseModLine('Deal up to 15% more Melee Damage to Enemies, based on proximity', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 15,
        flags: ModFlag.Attack | ModFlag.Melee,
        tags: [{ type: 'Condition', var: 'MeleeProximity' }],
      }),
    ]);
    expect(parseModLine('Attack Skills have Added Lightning Damage equal to 6% of maximum Mana', 'item')).toEqual([
      expect.objectContaining({ name: 'MindOfTheCouncilManaPct', type: 'BASE', value: 6 }),
    ]);

    // 3. MineLayingSpeed, Mine Penetration, Remote Mine limit, Self-Flagellation, Snowforged, Surveillance, Bitter Frost
    expect(parseModLine('26% increased Trap and Mine Throwing Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'TrapThrowingSpeed', type: 'INC', value: 26, keywordFlags: KeywordFlag.Trap }),
      expect.objectContaining({ name: 'MineLayingSpeed', type: 'INC', value: 26, keywordFlags: KeywordFlag.Mine }),
    ]);
    expect(parseModLine('14% increased Mine Throwing Speed', 'item')).toEqual([
      expect.objectContaining({ name: 'MineLayingSpeed', type: 'INC', value: 14, keywordFlags: KeywordFlag.Mine }),
    ]);
    expect(parseModLine('Mine Damage Penetrates 6% Elemental Resistances', 'tree')).toEqual([
      expect.objectContaining({ name: 'FirePenetration', type: 'BASE', value: 6, keywordFlags: KeywordFlag.Mine }),
      expect.objectContaining({ name: 'ColdPenetration', type: 'BASE', value: 6, keywordFlags: KeywordFlag.Mine }),
      expect.objectContaining({ name: 'LightningPenetration', type: 'BASE', value: 6, keywordFlags: KeywordFlag.Mine }),
    ]);
    expect(parseModLine('Can have up to 1 additional Remote Mines placed at a time', 'tree')).toEqual([
      expect.objectContaining({ name: 'ActiveMineLimit', type: 'BASE', value: 1 }),
    ]);
    expect(parseModLine('15% increased Damage per Curse on you', 'jewel')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 15,
        tags: [{ type: 'Multiplier', var: 'CurseOnSelf' }],
      }),
    ]);
    expect(parseModLine('Enemies Ignited or Chilled by you have -10% to Elemental Resistances', 'tree')).toEqual([
      expect.objectContaining({
        name: 'FireResist',
        type: 'BASE',
        value: -10,
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'EnemyIgnited|EnemyChilled' }],
      }),
      expect.objectContaining({
        name: 'ColdResist',
        type: 'BASE',
        value: -10,
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'EnemyIgnited|EnemyChilled' }],
      }),
      expect.objectContaining({
        name: 'LightningResist',
        type: 'BASE',
        value: -10,
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'EnemyIgnited|EnemyChilled' }],
      }),
    ]);
    expect(parseModLine('Each Totem applies 1% increased Damage taken to Enemies within 3 metres', 'tree')).toEqual([
      expect.objectContaining({
        name: 'DamageTaken',
        type: 'INC',
        value: 1,
        target: 'enemy',
        tags: [{ type: 'Multiplier', var: 'SummonedTotem' }],
      }),
    ]);
    expect(parseModLine('Enemies Chilled by your Hits have Cold Damage taken increased by Chill Effect', 'tree')).toEqual([
      expect.objectContaining({
        name: 'ColdDamageTaken',
        type: 'INC',
        value: 1,
        target: 'enemy',
        tags: [
          { type: 'Multiplier', var: 'EnemyChillEffect' },
          { type: 'Condition', var: 'EnemyChilled' },
        ],
      }),
    ]);

    // 4. Evasion per Life, Crit Bleed/Poison, Bleed Weapon DotMulti, Death Rush Adrenaline, Dual-Element Extra, Lucky Crit, Brand, Rift Ward, Nebulis
    expect(parseModLine('+8 to Evasion Rating per 10 Player Maximum Life', 'item')).toEqual([
      expect.objectContaining({
        name: 'Evasion',
        type: 'BASE',
        value: 8,
        tags: [{ type: 'PerStat', stat: 'Life', div: 10 }],
      }),
    ]);
    expect(parseModLine('50% chance to Cause Bleeding on Critical Strike', 'item')).toEqual([
      expect.objectContaining({ name: 'CritBleedChance', type: 'BASE', value: 50 }),
    ]);
    expect(parseModLine('+54% to Damage over Time Multiplier for Bleeding from Hits with this Weapon', 'item')).toEqual([
      expect.objectContaining({
        name: 'PhysicalDotMultiplier',
        type: 'BASE',
        value: 54,
        flags: ModFlag.Dot,
        keywordFlags: KeywordFlag.Bleed,
      }),
    ]);
    expect(parseModLine('Gain Adrenaline for 3 seconds on Kill', 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 100,
          tags: [
            { type: 'Condition', var: 'KilledRecently' },
            { type: 'Condition', var: 'Adrenaline', neg: true },
          ],
        }),
        expect.objectContaining({ name: 'Speed', type: 'INC', value: 25, flags: ModFlag.Attack }),
      ]),
    );
    expect(
      parseModLine('Hits with this Weapon gain 84% of Physical Damage as Extra Cold or Lightning Damage', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalGainAsCold', type: 'BASE', value: 42, flags: ModFlag.Attack }),
      expect.objectContaining({ name: 'PhysicalGainAsLightning', type: 'BASE', value: 42, flags: ModFlag.Attack }),
    ]);
    expect(parseModLine('Your Critical Strike Chance is Lucky', 'item')).toEqual([
      expect.objectContaining({ name: 'CritChanceIsLucky', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('+30% to Brand Critical Strike Multiplier', 'tree')).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 30,
        tags: [{ type: 'SkillType', skillType: 'Brand' }],
      }),
    ]);
    expect(parseModLine('1% increased Damage per 1% Chance to Block Attack Damage', 'item')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'BlockChance', div: 1 }],
      }),
    ]);
    expect(parseModLine('10% increased Elemental Damage per 1% Fire, Cold, or Lightning Resistance above 75%', 'item')).toHaveLength(3);

    // 5. Weapon-flagged Attack Speed (no longer stripped to generic ModFlag.Attack), EnemyHindered enemy target, Elemental Overload CritInPast8Sec
    expect(parseModLine('8% increased Attack Speed with Bows', 'tree')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 8, flags: ModFlag.Attack | ModFlag.Bow }),
    ]);
    expect(parseModLine('Enemies Hindered by you take 15% increased Chaos Damage', 'tree')).toEqual([
      expect.objectContaining({
        name: 'ChaosDamageTaken',
        type: 'INC',
        value: 15,
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'EnemyHindered' }],
      }),
    ]);
    expect(
      parseModLine('Skills that have dealt a Critical Strike in the past 8 seconds deal 40% more Elemental Damage with Hits and Ailments', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalDamage',
        type: 'MORE',
        value: 40,
        flags: ModFlag.Hit,
        tags: [{ type: 'Condition', var: 'CritInPast8Sec' }],
      }),
      expect.objectContaining({
        name: 'ElementalDamage',
        type: 'MORE',
        value: 40,
        flags: ModFlag.Ailment,
        tags: [{ type: 'Condition', var: 'CritInPast8Sec' }],
      }),
    ]);

    // 6. Wrapped multi-line joining in parseModLines + limitTotal cap (Arcane Capacitor caps at 50% total, not 500%)
    const masterOfMetalMods = parseModLines(
      [
        "If you've Impaled an Enemy Recently, you\nand Allies within 6 metres have +1000 to Armour",
        'You and nearby Allies deal 6 to 12 added Physical Damage for\neach Impale on Enemy',
      ],
      'Tree: Master of Metal',
    );
    expect(masterOfMetalMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Armour',
          type: 'BASE',
          value: 1000,
          tags: [{ type: 'Condition', var: 'ImpaledRecently|ImpaledEnemyRecently' }],
        }),
        expect.objectContaining({
          name: 'PhysicalMin',
          type: 'BASE',
          value: 6,
          tags: [{ type: 'Multiplier', var: 'EnemyImpaleStacks' }],
        }),
      ]),
    );
    const tamingMods = parseModLines(
      ['39% increased Elemental Damage with Hits and Ailments for', 'each type of Elemental Ailment on Enemy'],
      'Item: The Taming',
    );
    expect(tamingMods).toEqual([
      expect.objectContaining({
        name: 'ElementalDamage',
        type: 'INC',
        value: 39,
        tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
      }),
    ]);
    const capDb = new ModDB();
    capDb.addMods(
      parseModLines(
        ['10% increased Effect of Arcane Surge on you per\n200 Mana spent Recently, up to 50%'],
        'Tree: Arcane Capacitor',
      ),
    );
    capDb.setStat('ManaSpentRecently', 20000);
    expect(capDb.sum('INC', 'ArcaneSurgeEffect')).toBe(50);
  });

  it('achieves >= 68% non-mastery line parse coverage on official PoE 1 3.30 passive tree', () => {
    const treePath = path.join(repoRoot, 'apps/web/public/data/poe1-tree-3_30.json');
    const tree = JSON.parse(fs.readFileSync(treePath, 'utf8')) as {
      nodes: Record<string, { k?: string; st?: string[] }>;
    };

    let total = 0;
    let parsed = 0;
    for (const node of Object.values(tree.nodes)) {
      if (node.k === 'm' || !Array.isArray(node.st)) continue;
      for (const raw of node.st) {
        for (const line of String(raw).split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          total += 1;
          if (parseModLine(trimmed, 'tree').length > 0) {
            parsed += 1;
          }
        }
      }
    }

    const coverage = parsed / total;
    expect(total).toBeGreaterThan(3500);
    expect(coverage).toBeGreaterThanOrEqual(0.68);
  });
});
