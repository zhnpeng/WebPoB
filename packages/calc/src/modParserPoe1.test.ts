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

    // RC-9: Withered Effect & WitheredMagnitude parity (excludes defensive "on you")
    expect(parseModLine('20% increased Effect of Withered', 'tree')).toEqual([
      expect.objectContaining({ name: 'WitherEffect', type: 'INC', value: 20, flags: 0 }),
      expect.objectContaining({ name: 'WitheredMagnitude', type: 'INC', value: 20, flags: 0 }),
    ]);
    expect(parseModLine('Withered you inflict has 15% increased Effect', 'item')).toEqual([
      expect.objectContaining({ name: 'WitherEffect', type: 'INC', value: 15, flags: 0 }),
      expect.objectContaining({ name: 'WitheredMagnitude', type: 'INC', value: 15, flags: 0 }),
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
        tags: [{ type: 'SocketedIn' }, { type: 'SkillType', skillType: 'Vaal' }],
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
        tags: [{ type: 'Condition', var: 'TwoRareOrUniqueNearby', neg: true }],
      }),
    ]);
    expect(parseModLine('Damage cannot be Reflected', 'Tree: Opportunistic')).toEqual([
      expect.objectContaining({ name: 'CannotTakeReflectedDamage', type: 'FLAG', value: true }),
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

  it('Wave 4O-B: dual-element TakenAs, Minions Phys-as-Chaos without Extra, Companion Damage, GemlingQuality & Removes all mana', () => {
    // 1. Purity of Fire Watcher's Eye dual-element TakenAs (bare + conditional)
    expect(parseModLine('10% of Cold and Lightning Damage taken as Fire Damage', 'item')).toEqual([
      expect.objectContaining({ name: 'ColdDamageTakenAsFire', type: 'BASE', value: 10 }),
      expect.objectContaining({ name: 'LightningDamageTakenAsFire', type: 'BASE', value: 10 }),
    ]);
    expect(
      parseModLine(
        '15% of Cold and Lightning Damage taken as Fire Damage while affected by Purity of Fire',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ColdDamageTakenAsFire',
        type: 'BASE',
        value: 15,
        tags: [{ type: 'Condition', var: 'AffectedByPurityOfFire' }],
      }),
      expect.objectContaining({
        name: 'LightningDamageTakenAsFire',
        type: 'BASE',
        value: 15,
        tags: [{ type: 'Condition', var: 'AffectedByPurityOfFire' }],
      }),
    ]);

    // 2. Minions gain X% of Physical Damage as Chaos Damage (without "Extra")
    expect(parseModLine('Minions gain 20% of Physical Damage as Chaos Damage', 'item')).toEqual([
      expect.objectContaining({
        name: 'MinionPhysicalDamageGainAsChaos',
        type: 'BASE',
        value: 20,
      }),
    ]);

    // 3. Companion Damage applies to / affects you
    expect(parseModLine('Increases and Reductions to Companion Damage also apply to you', 'tree')).toEqual([
      expect.objectContaining({ name: 'CompanionDamageAppliesToPlayer', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Increases and Reductions to Companion Damage also affect you', 'tree')).toEqual([
      expect.objectContaining({ name: 'CompanionDamageAppliesToPlayer', type: 'FLAG', value: true }),
    ]);

    // 4. GemlingQuality & preservation of "Removes all mana"
    expect(parseModLine('Gem Quality grants Socketed Skills an additional effect', 'tree')).toEqual([
      expect.objectContaining({ name: 'GemlingQuality', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Removes all mana', 'tree')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'BloodMagic', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'Mana', type: 'OVERRIDE', value: 0 }),
      ]),
    );
  });

  it('Wave 4P: SpiritualCommand, Headsman on-kill speed, Master Distiller, Dismembering & Badge of the Brotherhood', () => {
    expect(parseModLine('Increases and Reductions to Minion Attack Speed also affect you', 'tree')).toEqual([
      expect.objectContaining({ name: 'SpiritualCommand', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Gain 10% increased Attack Speed for 20 seconds when you Kill a Rare or Unique Enemy', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 10,
        flags: ModFlag.Attack,
        tags: [{ type: 'Condition', var: 'KilledRareOrUniqueRecently' }],
      }),
    ]);
    expect(
      parseModLine('Gain 10% increased Movement Speed for 20 seconds when you Kill an Enemy', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'MovementSpeed',
        type: 'INC',
        value: 10,
        tags: [{ type: 'Condition', var: 'KilledRecently' }],
      }),
    ]);
    expect(
      parseModLine('If Bismuth Flask Charges are consumed, Penetrate 30% Elemental Resistances', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'ElementalPenetration',
        type: 'BASE',
        value: 30,
        tags: [{ type: 'Condition', var: 'UsedBismuthFlaskRecently' }],
      }),
    ]);
    expect(
      parseModLine('If Amethyst Flask Charges are consumed, 47% of Physical Damage as Extra Chaos Damage', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'PhysicalDamageGainAsChaos',
        type: 'BASE',
        value: 47,
        tags: [{ type: 'Condition', var: 'UsedAmethystFlaskRecently' }],
      }),
    ]);
    expect(
      parseModLine('If Diamond Flask Charges are consumed, +100% to Critical Strike Multiplier', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 100,
        tags: [{ type: 'Condition', var: 'UsedDiamondFlaskRecently' }],
      }),
    ]);
    expect(parseModLine('20% chance to Maim Enemies on Critical Strike with Attacks', 'tree')).toEqual([
      expect.objectContaining({ name: 'MaimChance', type: 'BASE', value: 20, flags: ModFlag.Attack }),
    ]);
    expect(
      parseModLine('Your Maximum Frenzy Charges is equal to your Maximum Power Charges', 'item'),
    ).toEqual([expect.objectContaining({ name: 'MaxFrenzyEqualsMaxPower', type: 'FLAG', value: true })]);
  });

  it('Wave 4Q: Eldritch Exposure-on-Hit, Vaal Crit, Unnerve-on-Hit, Original Sin & Ralakesh', () => {
    expect(
      parseModLine('Inflict Cold Exposure on Hit, applying -12% to Cold Resistance', 'Item (Gloves)'),
    ).toEqual([
      expect.objectContaining({ name: 'ColdExposureChance', type: 'BASE', value: 100 }),
      expect.objectContaining({
        name: 'EnemyColdResist',
        type: 'BASE',
        value: -12,
        source: 'Item (Gloves) (Exposure)',
        tags: [{ type: 'Condition', var: 'EnemyColdExposure' }],
      }),
    ]);
    expect(
      parseModLine('Inflict Lightning Exposure on Hit, applying -13% to Lightning Resistance', 'Item (Gloves)'),
    ).toEqual([
      expect.objectContaining({ name: 'LightningExposureChance', type: 'BASE', value: 100 }),
      expect.objectContaining({
        name: 'EnemyLightningResist',
        type: 'BASE',
        value: -13,
        tags: [{ type: 'Condition', var: 'EnemyLightningExposure' }],
      }),
    ]);
    expect(parseModLine('Gain 2 Rage on Attack Hit', 'item')).toEqual([
      expect.objectContaining({ name: 'RageOnHit', type: 'BASE', value: 2 }),
    ]);
    expect(parseModLine('Gain 1 Rage on Melee Weapon Hit', 'item')).toEqual([
      expect.objectContaining({ name: 'RageOnHit', type: 'BASE', value: 1 }),
    ]);
    expect(parseModLine('80% increased Critical Strike Chance with Vaal Skills during effect', 'item')).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 80,
        tags: [{ type: 'SkillType', skillType: 'Vaal' }],
      }),
    ]);
    expect(parseModLine('20% chance to Unnerve Enemies for 4 seconds on Hit', 'item')).toEqual([
      expect.objectContaining({ name: 'UnnerveOnHitChance', type: 'BASE', value: 20 }),
    ]);
    expect(parseModLine('Cannot deal non-Chaos Damage', 'item')).toHaveLength(4);
    expect(parseModLine('Count as having maximum number of Frenzy Charges', 'item')).toEqual([
      expect.objectContaining({ name: 'CountAsMaxFrenzyCharges', type: 'FLAG', value: true }),
    ]);
  });

  it('Wave 4S: Impale PDR ignore, FrozenByYouSeconds mastery, Physical extra random element, Mine aura & Stormshroud', () => {
    expect(
      parseModLine('Impale Damage dealt to Enemies Impaled by you ignores Enemy Physical Damage Reduction', 'Mastery'),
    ).toEqual([
      expect.objectContaining({ name: 'IgnoreEnemyImpalePhysicalDamageReduction', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine(
        "Enemies permanently take 5% increased Damage for each second they've ever been Frozen by you, up to a maximum of 50%",
        'Mastery',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 5,
        tags: [{ type: 'Multiplier', var: 'FrozenByYouSeconds', limit: 10 }],
      }),
    ]);
    expect(
      parseModLine('3% chance for Hits to deal 300% of Physical Damage as Extra Damage of a random Element', 'Mastery'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageGainAsFire', type: 'BASE', value: 3, flags: ModFlag.Hit }),
      expect.objectContaining({ name: 'PhysicalDamageGainAsCold', type: 'BASE', value: 3, flags: ModFlag.Hit }),
      expect.objectContaining({ name: 'PhysicalDamageGainAsLightning', type: 'BASE', value: 3, flags: ModFlag.Hit }),
    ]);
    expect(
      parseModLine('Each Mine applies 2% increased Damage taken to Enemies within 6 metres, up to 10%', 'Mastery'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 2,
        tags: [{ type: 'Multiplier', var: 'ActiveMines', limit: 5 }],
      }),
    ]);
    expect(
      parseModLine('Modifiers to Chance to Avoid being Shocked apply to all Elemental Ailments', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'ShockAvoidAppliesToElementalAilments', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Melee Hits Fortify', 'Mastery')).toEqual([
      expect.objectContaining({ name: 'MeleeHitsFortify', type: 'FLAG', value: true }),
    ]);
  });

  it('Wave 4T: PoE 1 Bloodline notables (Unseen Hand, Toad\'s Price, Conjoined Spire, Vivid Cat, Umbral Army, Starlight, etc.)', () => {
    expect(parseModLine('+1 Ring Slot', 'Tree: The Unseen Hand')).toEqual([
      expect.objectContaining({ name: 'AdditionalRingSlot', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Utility Flasks are Disabled', "Tree: Toad's Price")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'UtilityFlasksDoNotApplyToPlayer', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'DisableUtilityFlasks', type: 'FLAG', value: true }),
      ]),
    );
    expect(
      parseModLine('Skills used by Totems deal 10% more Damage per maximum number of Summoned Totems', 'Tree: Conjoined Spire'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 10,
        tags: [
          { type: 'PerStat', stat: 'ActiveTotemLimit', div: 1 },
          { type: 'SkillType', skillType: 'Totem' },
        ],
      }),
    ]);
    expect(parseModLine('50% increased Effect of your Marks while Elusive', 'Tree: The Vivid Cat')).toEqual([
      expect.objectContaining({
        name: 'MarkEffect',
        type: 'INC',
        value: 50,
        tags: [{ type: 'Condition', var: 'Elusive' }],
      }),
    ]);
    expect(
      parseModLine('2% increased Attack and Cast Speed per Summoned Raging Spirit', 'Tree: Umbral Army'),
    ).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 2, flags: ModFlag.Attack }),
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 2, flags: ModFlag.Spell }),
    ]);
    expect(parseModLine('15% increased Attack Damage per Raised Zombie', 'Tree: Umbral Army')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 15,
        flags: ModFlag.Attack,
        tags: [{ type: 'PerStat', stat: 'ActiveZombieLimit', div: 1 }],
      }),
    ]);
    expect(parseModLine('70% increased Ward from Equipped Armour Items', 'Tree: Enhanced Starlight')).toEqual([
      expect.objectContaining({ name: 'Ward', type: 'INC', value: 70 }),
    ]);
    expect(
      parseModLine(
        'Spells you cast yourself gain Added Physical Damage equal to 75% of Life Cost, if Life Cost is not higher than the maximum you could spend',
        'Tree: Cannibalised Faith',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'AddedPhysicalDamageFromLifeCostPct',
        type: 'BASE',
        value: 75,
        flags: ModFlag.Spell,
      }),
    ]);
    expect(
      parseModLine('Hatred has 50% increased Aura Effect while at maximum Frenzy Charges', "Tree: The King's Might"),
    ).toEqual([
      expect.objectContaining({
        name: 'AuraEffect:Hatred',
        type: 'INC',
        value: 50,
        tags: [{ type: 'Condition', var: 'AtMaximumFrenzyCharges' }],
      }),
    ]);
    expect(
      parseModLine('Unsealed Spells gain 5% more Damage each time their effects Reoccur', 'Tree: The Primal Owl'),
    ).toEqual([expect.objectContaining({ name: 'MaxSealDamage', type: 'MORE', value: 5 })]);
    expect(
      parseModLine('You have Everlasting Sacrifice if at least 6 Corrupted Items are Equipped', "Tree: Corruption's Embrace"),
    ).toEqual([
      expect.objectContaining({
        name: 'CorruptionsEmbrace:EverlastingSacrifice',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'MultiplierThreshold:CorruptedItem:6' }],
      }),
    ]);
  });

  it('Wave 4U: SocketedIn slotName binding + Gladiator Determined Survivor, War of Attrition & Weapon Master', () => {
    expect(parseModLine('Socketed Skills deal 20% more Attack Damage', 'Item (Weapon 1)')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 20,
        flags: ModFlag.Attack,
        tags: [{ type: 'SocketedIn', slotName: 'Weapon 1' }],
      }),
    ]);
    expect(
      parseModLine("Gain 50% Chance to Block from Equipped Shield instead of the Shield's value", 'Tree: Determined Survivor'),
    ).toEqual([expect.objectContaining({ name: 'ShieldBlockOverride', type: 'OVERRIDE', value: 50 })]);
    expect(parseModLine('Inherent Bonuses from Dual Wielding are doubled', 'Tree: Determined Survivor')).toEqual([
      expect.objectContaining({ name: 'DualWieldBonusesDoubled', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine(
        "Deal 1% more Damage with Hits and Ailments to Rare and Unique Enemies for each second they've ever been in your Presence, up to a maximum of 100%",
        'Tree: War of Attrition',
      ),
    ).toHaveLength(2);
    expect(
      parseModLine(
        '30% more Damage with Hits and Ailments against Enemies that are on Low Life while you are wielding an Axe',
        'Tree: Weapon Master',
      ),
    ).toHaveLength(2);
  });

  it('Wave 4V: Elementalist Shaper of Storms ShockMinimum, Hits always Shock & Heart of Destruction AoE', () => {
    expect(
      parseModLine('Shocks from your Hits always increase Damage taken by at least 25%', 'Tree: Shaper of Storms'),
    ).toEqual([expect.objectContaining({ name: 'ShockMinimum', type: 'BASE', value: 25 })]);
    expect(parseModLine('Hits always Shock', 'Tree: Shaper of Storms')).toEqual([
      expect.objectContaining({ name: 'ShockChance', type: 'BASE', value: 100 }),
    ]);
    expect(
      parseModLine("60% increased Area of Effect while you don't have Convergence", 'Tree: Heart of Destruction'),
    ).toEqual([
      expect.objectContaining({
        name: 'AreaOfEffect',
        type: 'INC',
        value: 60,
        tags: [{ type: 'Condition', var: 'Convergence', neg: true }],
      }),
    ]);
  });

  it('Wave 4W: Onslaught Effect, Nearby Enemies Intimidated, Onslaught on Kill, Saboteur & Warden Bloodline', () => {
    expect(parseModLine('100% increased Onslaught Effect', 'Item: Daresso')).toEqual([
      expect.objectContaining({ name: 'OnslaughtEffect', type: 'INC', value: 100 }),
    ]);
    expect(parseModLine('Nearby Enemies are Intimidated', 'Item: Belt')).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 10,
        tags: [{ type: 'Condition', var: 'EnemyIntimidated', neg: true }],
      }),
    ]);
    expect(parseModLine('15% chance to gain Onslaught for 4 seconds on Kill', 'Item: Boots')).toEqual([
      expect.objectContaining({ name: 'Speed', type: 'INC', value: 20, source: 'Item: Boots' }),
      expect.objectContaining({ name: 'MovementSpeed', type: 'INC', value: 20, source: 'Item: Boots' }),
    ]);
    expect(parseModLine('Hits have 30% chance to deal 50% more Area Damage', 'Tree: Bomb Specialist')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'MORE', value: 15 }),
    ]);
    expect(parseModLine('30% less Damage with Triggered Spells', 'Tree: Perfect Crime')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'MORE', value: -30 }),
    ]);
    expect(
      parseModLine('Defences from Equipped Body Armour are doubled if it has no Socketed Gems', 'Tree: Oath of the Maji'),
    ).toEqual([expect.objectContaining({ name: 'OathOfTheMajiBodyArmour', type: 'FLAG', value: true })]);
  });

  it('Wave 4X: Vaal Skills (Soul Catcher/Yaomac), Roiling Tempest, Luminary & Crit Ailment DoT Multi', () => {
    expect(parseModLine('112% increased Damage with Vaal Skills', 'Item: Yaomac')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 112,
        tags: [{ type: 'SkillType', skillType: 'Vaal' }],
      }),
    ]);
    expect(
      parseModLine('60% increased Critical Strike Chance with Vaal Skills during effect', 'Item: Soul Catcher'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 60,
        tags: [{ type: 'SkillType', skillType: 'Vaal' }],
      }),
    ]);
    expect(parseModLine('25% more Maximum Lightning Damage', 'Tree: Roiling Tempest')).toEqual([
      expect.objectContaining({ name: 'LightningMaxDamage', type: 'MORE', value: 25 }),
    ]);
    expect(parseModLine('50% less Minimum Lightning Damage', 'Tree: Roiling Tempest')).toEqual([
      expect.objectContaining({ name: 'LightningMinDamage', type: 'MORE', value: -50 }),
    ]);
    expect(parseModLine('Cannot deal non-Lightning Damage', 'Tree: Roiling Tempest')).toHaveLength(4);
    expect(
      parseModLine('Your Mercenary has 50% increased effect of Non-Curse Auras from Skills', 'Tree: Bestowed Knighthood'),
    ).toEqual([expect.objectContaining({ name: 'MercenaryAuraEffect', type: 'INC', value: 50 })]);
    expect(
      parseModLine('+25% to Damage over Time Multiplier for Ailments from Critical Strikes', 'Tree: Dire Torment'),
    ).toEqual([
      expect.objectContaining({
        name: 'DotMultiplier',
        type: 'BASE',
        value: 25,
        tags: [{ type: 'Condition', var: 'Crit' }],
      }),
    ]);
  });

  it('Wave 4Y: Bloodline (Catarina/Farrul), Plaguebringer, Opportunistic & Armour/Evasion 4-slot Masteries', () => {
    expect(
      parseModLine('Minions deal 20% more Damage while they are on Low Life', 'Tree: Prolonged Servitude'),
    ).toEqual([
      expect.objectContaining({
        name: 'MinionDamage',
        type: 'MORE',
        value: 20,
        tags: [{ type: 'Condition', var: 'MinionLowLife' }],
      }),
    ]);
    expect(
      parseModLine('Minions deal 80% increased Damage if you have Warcried Recently', 'Tree: Primal Roar'),
    ).toEqual([
      expect.objectContaining({
        name: 'MinionDamage',
        type: 'INC',
        value: 80,
        tags: [{ type: 'Condition', var: 'UsedWarcryRecently' }],
      }),
    ]);
    expect(parseModLine('Maximum number of Raised Spectres is 1', 'Tree: Farrul')).toEqual([
      expect.objectContaining({ name: 'ActiveSpectreLimit', type: 'OVERRIDE', value: 1 }),
    ]);
    expect(
      parseModLine(
        '+1% to all maximum Elemental Resistances if Equipped Helmet, Body Armour, Gloves, and Boots all have Armour',
        'Tree: Armour Mastery',
      ),
    ).toHaveLength(3);
    expect(
      parseModLine(
        '+15% chance to Suppress Spell Damage if Equipped Helmet, Body Armour, Gloves, and Boots all have Evasion Rating',
        'Tree: Evasion Mastery',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'SpellSuppressionChance',
        type: 'BASE',
        value: 15,
        tags: [{ type: 'Condition', var: 'AllFourArmourSlotsHaveEvasion' }],
      }),
    ]);
  });

  it('Wave 5A: Cinderswallow Urn, Doppelganger Guise (Sane/Insane), Per-Aura/Curse Effect & High-Freq Uniques', () => {
    expect(
      parseModLine('Enemies Ignited by you during Effect take 7% increased Damage', 'Item: Cinderswallow Urn'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 7,
        tags: [{ type: 'Condition', var: 'EnemyIgnited' }],
      }),
    ]);
    expect(
      parseModLine('40% less Physical and Chaos Damage taken while Sane', 'Item: Doppelganger Guise'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageTaken', type: 'MORE', value: -40 }),
      expect.objectContaining({ name: 'ChaosDamageTaken', type: 'MORE', value: -40 }),
    ]);
    expect(parseModLine('40% more Damage while Insane', 'Item: Doppelganger Guise')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 40,
        tags: [{ type: 'Condition', var: 'Insane' }],
      }),
    ]);
    expect(parseModLine('40% increased Vulnerability Curse Effect', 'Item: Helmet')).toEqual([
      expect.objectContaining({ name: 'CurseEffect:Vulnerability', type: 'INC', value: 40 }),
    ]);
    expect(
      parseModLine('Increases and Reductions to Cast Speed apply to Attack Speed', "Item: Wilma's Requital"),
    ).toEqual([expect.objectContaining({ name: 'CastSpeedAppliesToAttackSpeed', type: 'FLAG', value: true })]);
    expect(parseModLine('Cannot deal Critical Strikes with Attacks', 'Item: Sandstorm Visage')).toEqual([
      expect.objectContaining({ name: 'NeverCrit', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Chaos Damage taken does not bypass Energy Shield during effect', 'Item: Coruscating Elixir'),
    ).toEqual([expect.objectContaining({ name: 'ChaosDamageDoesNotBypassES', type: 'FLAG', value: true })]);
  });

  it('Wave 5B: Pathfinder Master Distiller (Diamond/Bismuth/Amethyst Flask Charges consumed)', () => {
    expect(
      parseModLine('If Diamond Flask Charges are consumed, 250% increased Critical Strike Chance', 'Tree: Master Distiller'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 250,
        tags: [
          { type: 'SkillType', skillType: 'Triggered', neg: true },
          { type: 'SkillType', skillType: 'Channel', neg: true },
          { type: 'Condition', var: 'HaveDiamondFlask' },
        ],
      }),
    ]);
    expect(
      parseModLine('If Diamond Flask Charges are consumed, +100% to Critical Strike Multiplier', 'Tree: Master Distiller'),
    ).toEqual([
      expect.objectContaining({ name: 'CritMultiplier', type: 'BASE', value: 100 }),
    ]);
    expect(
      parseModLine('If Bismuth Flask Charges are consumed, Penetrate 30% Elemental Resistances', 'Tree: Master Distiller'),
    ).toEqual([
      expect.objectContaining({ name: 'ElementalPenetration', type: 'BASE', value: 30 }),
    ]);
    expect(
      parseModLine('If Amethyst Flask Charges are consumed, 47% of Physical Damage as Extra Chaos Damage', 'Tree: Master Distiller'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageGainAsChaos', type: 'BASE', value: 47 }),
    ]);
  });

  it('Wave 5C: Saboteur Demolitions Specialist (MineAuraEffect), Calculated Risk (DamageIsUnlucky), Pyromaniac & Eternal Struggle', () => {
    expect(parseModLine('150% increased Effect of Auras from Mines', 'Tree: Demolitions Specialist')).toEqual([
      expect.objectContaining({ name: 'MineAuraEffect', type: 'INC', value: 150 }),
    ]);
    expect(parseModLine('Damage with Hits is Unlucky', 'Tree: Calculated Risk')).toEqual([
      expect.objectContaining({ name: 'DamageIsUnlucky', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine(
        'Regenerate 2% of Life per second for each Mine Detonated Recently, up to 10% per second',
        'Tree: Pyromaniac',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'LifeRegenPercent',
        type: 'BASE',
        value: 2,
        tags: [{ type: 'Multiplier', var: 'MineDetonatedRecently', limit: 5 }],
      }),
    ]);
    expect(
      parseModLine(
        'Kill Enemies that have 15% or lower Life on Hit if The Searing Exarch is dominant',
        'Item: The Eternal Struggle',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'CullPercent',
        type: 'MAX',
        value: 15,
        tags: [{ type: 'Condition', var: 'SearingExarchDominant' }],
      }),
    ]);
  });

  it('Wave 5D: Deal no Non-Lightning Damage, Successive Detonations, Warcry/Exert, Mine, Impale & Spider Webs', () => {
    expect(parseModLine('Deal no Non-Lightning Damage', "Item: Doryani's Prototype")).toEqual([
      expect.objectContaining({ name: 'DealNoNonLightning', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('10% increased Critical Strike Chance for each Mine Detonated Recently, up to 100%', 'Tree: Successive Detonations'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 10,
        tags: [{ type: 'Multiplier', var: 'MineDetonatedRecently', limit: 10 }],
      }),
    ]);
    expect(parseModLine('Warcries Exert 1 additional Attack', 'Tree: Measured Fury')).toEqual([
      expect.objectContaining({ name: 'WarcryExertCount', type: 'BASE', value: 1 }),
    ]);
    expect(
      parseModLine('Enemies Taunted by your Warcries take 8% increased Damage', 'Tree: Natural Authority'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 8,
        tags: [{ type: 'Condition', var: 'EnemyTaunted' }],
      }),
    ]);
    expect(parseModLine('Critical Strikes with Spells inflict Impale', 'Item: Entropic Devastation')).toEqual([
      expect.objectContaining({ name: 'SpellCritInflictsImpale', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine("Enemies affected by your Spider's Webs have -10% to All Resistances", "Item: Fenumus' Shroud"),
    ).toHaveLength(4);
  });

  it('Wave 5F: Circle Herald Buff Effect, Stampede, Nimis, Warcry Infinite Power, Focus CDR & Azadi Crest', () => {
    expect(parseModLine('Herald of Ash has 60% increased Buff Effect', 'Item: Circle of Anguish')).toEqual([
      expect.objectContaining({ name: 'HeraldBuffEffect:Herald of Ash', type: 'INC', value: 60 }),
    ]);
    expect(parseModLine('Herald of Purity has 60% increased Buff Effect', 'Item: Circle of Guilt')).toEqual([
      expect.objectContaining({ name: 'HeraldBuffEffect:Herald of Purity', type: 'INC', value: 60 }),
    ]);
    expect(parseModLine('Your Movement Speed is 150% of its base value', 'Item: The Stampede')).toEqual([
      expect.objectContaining({ name: 'MovementSpeed', type: 'OVERRIDE', value: 150 }),
    ]);
    expect(parseModLine('Projectiles Return to you', 'Item: Nimis')).toEqual([
      expect.objectContaining({ name: 'ProjectilesReturn', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Warcries have infinite Power', 'Tree: Sione')).toEqual([
      expect.objectContaining({ name: 'WarcryInfinitePower', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Focus has 25% increased Cooldown Recovery Rate', 'Item: Boots')).toEqual([
      expect.objectContaining({ name: 'CooldownRecovery:Focus', type: 'INC', value: 25 }),
    ]);
  });

  it('Wave 6A: Graft local-skill isolation & Foulborn unique modifiers', () => {
    // Graft-local CDR/Duration must NOT leak into global player CooldownRecovery/Duration
    expect(
      parseModLine('Skills used by this Graft have 16% increased Cooldown Recovery Rate', 'Item: Graft 1'),
    ).toEqual([expect.objectContaining({ name: 'GraftSkillLocalMod', type: 'FLAG', value: true })]);
    expect(
      parseModLine('Your Damage with Hits is Lucky while on Low Life', "Item: Foulborn Lori's Lantern"),
    ).toEqual([
      expect.objectContaining({
        name: 'DamageIsLucky',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'LowLife' }],
      }),
    ]);
    expect(
      parseModLine(
        "Adds 1 to 10 Lightning Damage for each Shocked Enemy you've Killed Recently",
        "Item: Foulborn Esh's Mirror",
      ),
    ).toHaveLength(2);
    expect(
      parseModLine(
        'Minions have +5% to Critical Strike Multiplier per Withered Debuff on Enemy',
        'Item: Foulborn Severed in Sleep',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'MinionCritMultiplier',
        type: 'BASE',
        value: 5,
        tags: [{ type: 'Multiplier', var: 'WitheredStack' }],
      }),
    ]);
    expect(parseModLine('Gain no inherent bonuses from Strength', 'Item: Foulborn The Brass Dome')).toEqual([
      expect.objectContaining({ name: 'NoStrengthBonus', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Maximum Energy Shield is increased by Chaos Resistance', "Item: Foulborn Saffell's Frame"),
    ).toEqual([expect.objectContaining({ name: 'EsIncreasedByChaosRes', type: 'FLAG', value: true })]);
  });

  it('Wave 6B: Svalinn Block Lucky, ES Overleech, Buff Effect & Per-Skill MRE', () => {
    expect(parseModLine('Chance to Block is Lucky', 'Item: Svalinn')).toEqual([
      expect.objectContaining({ name: 'BlockChanceIsLucky', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'SpellBlockChanceIsLucky', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Tempest Shield has 20% increased Buff Effect', 'Item: Body Armour')).toEqual([
      expect.objectContaining({ name: 'BuffEffect:Tempest Shield', type: 'INC', value: 20 }),
    ]);
    expect(parseModLine('Malevolence has 31% increased Mana Reservation Efficiency', 'Item: Ring')).toEqual([
      expect.objectContaining({ name: 'ManaReservationEfficiency:Malevolence', type: 'INC', value: 31 }),
    ]);
  });

  it('Wave 6C: Block Unlucky, DoT Taken, Whispers of Infinity, Warcry/Echoes, Alchemist Mark & Luminary', () => {
    expect(parseModLine('Chance to Block Spell Damage is Unlucky', 'Item: The Iron Fortress')).toEqual([
      expect.objectContaining({ name: 'SpellBlockChanceIsUnlucky', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('7% reduced Chaos Damage taken over time', 'Tree')).toEqual([
      expect.objectContaining({ name: 'ChaosDamageTakenOverTime', type: 'INC', value: -7 }),
    ]);
    expect(parseModLine('Skills Cost Energy Shield instead of Mana or Life', 'Item: Whispers of Infinity')).toEqual([
      expect.objectContaining({ name: 'SkillsCostEnergyShield', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Warcries have 20% increased Cooldown Recovery Rate', 'Tree')).toEqual([
      expect.objectContaining({
        name: 'CooldownRecovery',
        type: 'INC',
        value: 20,
        tags: [{ type: 'SkillType', skillType: 'Warcry' }],
      }),
    ]);
    expect(parseModLine('Warcries cannot Exert Travel Skills', 'Item')).toEqual([
      expect.objectContaining({ name: 'WarcriesCannotExertTravelSkills', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('When you Attack, take 16% of Life as Physical Damage for each Warcry Exerting the Attack', 'Item: Echoes of Creation'),
    ).toEqual([
      expect.objectContaining({ name: 'EchoesSelfDamagePerExert', type: 'BASE', value: 16 }),
    ]);
    expect(parseModLine('Marked Enemy takes 15% increased Damage from Poison', "Gem: Alchemist's Mark")).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 15,
        target: 'enemy',
      }),
    ]);
    expect(parseModLine('All Damage with Hits can Chill', 'Item')).toEqual([
      expect.objectContaining({ name: 'AllDamageCanChill', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('All Damage from Critical Strikes can apply Lightning Ailments during effect', 'Flask')).toEqual([
      expect.objectContaining({ name: 'CritDamageCanApplyLightningAilments', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Your Mercenary and their Minions have 15% increased maximum Life', 'Tree: Luminary')).toEqual([
      expect.objectContaining({ name: 'MercenaryLife', type: 'INC', value: 15 }),
    ]);
    expect(
      parseModLine('Your Mercenary and their Minions deal 8% more Damage for each Unique item they have equipped', 'Tree: Luminary'),
    ).toEqual([
      expect.objectContaining({ name: 'MercenaryDamagePerUnique', type: 'BASE', value: 8 }),
    ]);
  });

  it('Wave 6E: Timeless Keystones & PoE 1 3.30 Ascendancy / Reliquarian / Harbinger / Bloodline rules', () => {
    expect(
      parseModLine('Armour applies to Fire, Cold and Lightning Damage taken from Hits instead of Physical Damage', 'Keystone: Transcendence'),
    ).toEqual([
      expect.objectContaining({ name: 'Transcendence', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'ArmourAppliesToEle', type: 'BASE', value: 100 }),
      expect.objectContaining({ name: 'ArmourDoesNotApplyToPhys', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Your Damage with Critical Strikes is Lucky', 'Keystone: Dance with Death')).toEqual([
      expect.objectContaining({ name: 'CritDamageIsLucky', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Maximum Energy Shield is 0', 'Keystone: The Agnostic')).toEqual([
      expect.objectContaining({ name: 'EnergyShield', type: 'OVERRIDE', value: 0 }),
    ]);
    expect(parseModLine('50% more Effect of Auras from your Skills on you', 'Keystone: Supreme Ego')).toEqual([
      expect.objectContaining({ name: 'AuraEffectOnSelf', type: 'MORE', value: 50 }),
    ]);
    expect(parseModLine('Strength provides no bonus to Maximum Life', 'Tree: The Brass Dome')).toEqual([
      expect.objectContaining({ name: 'NoStrengthBonusToLife', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Your Maximum Endurance Charges is equal to your Maximum Frenzy Charges', 'Tree: Masterful Form'),
    ).toEqual([
      expect.objectContaining({ name: 'MaxEnduranceEqualsMaxFrenzy', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Temporal Chains has no Reservation if Cast as an Aura', 'Tree: Harbinger')).toEqual([
      expect.objectContaining({ name: 'NoReservationAsAura:Temporal Chains', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('15% of Armour also applies to Chaos Damage taken from Hits', 'Tree: Unbreakable')).toEqual([
      expect.objectContaining({ name: 'ArmourAppliesToChaos', type: 'BASE', value: 15 }),
    ]);
    expect(parseModLine('All Damage can Shock', 'Tree: Shaper of Storms')).toEqual([
      expect.objectContaining({ name: 'AllDamageCanShock', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Minions have Unholy Might', 'Tree: Unnatural Strength')).toEqual([
      expect.objectContaining({ name: 'MinionUnholyMight', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('20% reduced Soul Gain Prevention Duration', 'Tree: Priest of Yaomac')).toEqual([
      expect.objectContaining({ name: 'SoulGainPreventionDuration', type: 'INC', value: -20 }),
    ]);
    expect(parseModLine('Vaal Skills require 30% less Souls per Use', 'Tree: Priest of Yaomac')).toEqual([
      expect.objectContaining({ name: 'VaalSoulCost', type: 'MORE', value: -30 }),
    ]);
  });

  it('Wave 6F: AdditionalPoisonChance, Onslaught on Hit, Doryani Prototype, Aegis Aurora, Triad Grip & lowercase ElementalDamage', () => {
    expect(parseModLine('15% more elemental damage', 'Custom')).toEqual([
      expect.objectContaining({ name: 'ElementalDamage', type: 'MORE', value: 15 }),
    ]);
    expect(
      parseModLine('46% chance to inflict an additional Poison on the same Target when you inflict Poison', 'Item: Poison Mastery'),
    ).toEqual([
      expect.objectContaining({
        name: 'AdditionalPoisonChance',
        type: 'BASE',
        value: 46,
        keywordFlags: KeywordFlag.Poison,
      }),
    ]);
    expect(parseModLine('You gain Onslaught for 4 seconds on Hit', 'Item: Synthesised Ring')).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 20,
        flags: ModFlag.Attack | ModFlag.Spell,
        tags: [
          { type: 'Condition', var: 'HitRecently' },
          { type: 'Condition', var: 'Onslaught', neg: true },
        ],
      }),
      expect.objectContaining({
        name: 'MovementSpeed',
        type: 'INC',
        value: 20,
        tags: [
          { type: 'Condition', var: 'HitRecently' },
          { type: 'Condition', var: 'Onslaught', neg: true },
        ],
      }),
    ]);
    expect(parseModLine('Armour also applies to Lightning Damage taken from Hits', "Item: Doryani's Prototype")).toEqual([
      expect.objectContaining({ name: 'ArmourAppliesToLightning', type: 'BASE', value: 100 }),
    ]);
    expect(parseModLine('Nearby Enemies have Lightning Resistance equal to yours', "Item: Doryani's Prototype")).toEqual([
      expect.objectContaining({ name: 'EnemyLightningResEqualsYours', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Recover Energy Shield equal to 2% of Armour when you Block', 'Item: Aegis Aurora')).toEqual([
      expect.objectContaining({ name: 'EsRecoverOnBlockPctArmour', type: 'BASE', value: 2 }),
    ]);
    expect(
      parseModLine('Minions convert 25% of Physical Damage to Fire Damage per Red Socket', 'Item: Triad Grip'),
    ).toEqual([
      expect.objectContaining({ name: 'MinionPhysConvertToFirePerRedSocket', type: 'BASE', value: 25 }),
    ]);
    expect(parseModLine('Nearby Enemies are Scorched', 'Custom')).toEqual([
      expect.objectContaining({ name: 'EnemyScorched', type: 'FLAG', value: true }),
    ]);
  });

  it('Wave 6H: poe1-regression-bugs sweep (Skitterbots, Focus Recovery, Scorch on Block, Linked Minions, Flask Life on Kill)', () => {
    expect(parseModLine('Recover 35% of Mana and Energy Shield when you Focus', 'Item')).toEqual([
      expect.objectContaining({ name: 'ManaRecoverOnFocusPct', type: 'BASE', value: 35 }),
      expect.objectContaining({ name: 'EsRecoverOnFocusPct', type: 'BASE', value: 35 }),
    ]);
    expect(parseModLine("Summoned Skitterbots' Auras affect you as well as Enemies", 'Item')).toEqual([
      expect.objectContaining({ name: 'SkitterbotsAffectPlayer', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('63% increased Effect of Non-Damaging Ailments inflicted by Summoned Skitterbots', 'Item'),
    ).toEqual([
      expect.objectContaining({ name: 'SkitterbotsAilmentEffect', type: 'INC', value: 63 }),
    ]);
    expect(parseModLine('Scorch Enemies in Close Range when you Block', 'Item')).toEqual([
      expect.objectContaining({ name: 'ScorchOnBlock', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Recover 3% of Life when you Kill an Enemy during Effect', 'Flask')).toEqual([
      expect.objectContaining({
        name: 'LifeRecoverOnKillPct',
        type: 'BASE',
        value: 3,
        tags: [{ type: 'Condition', var: 'UsingFlask' }],
      }),
    ]);
    expect(parseModLine('Your Linked Minions take 67% less Damage', 'Item')).toEqual([
      expect.objectContaining({ name: 'LinkedMinionDamageTaken', type: 'MORE', value: -67 }),
    ]);
  });

  it('Wave 6I: Phrecia 3_28_alternate Ascendancy rules', () => {
    expect(
      parseModLine('40% increased Effect of Non-Curse Auras from your Skills while you have a Linked Target', 'Tree: Absolution'),
    ).toEqual([
      expect.objectContaining({
        name: 'AuraEffect',
        type: 'INC',
        value: 40,
        tags: [{ type: 'Condition', var: 'HaveLinkedTarget' }],
      }),
    ]);
    expect(parseModLine('Non-instant Mana Recovery from Flasks is also Recovered as Life', 'Tree: breathe deep')).toEqual([
      expect.objectContaining({ name: 'ManaFlaskRecoveryAppliesToLife', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Cannot be Ignited if Strength is higher than Dexterity', 'Tree: Illicit Gains')).toEqual([
      expect.objectContaining({ name: 'ConditionalIgnitedImmune', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Cannot be Shocked if Intelligence is higher than Strength', 'Tree: Private Tuition')).toEqual([
      expect.objectContaining({ name: 'ConditionalShockedImmune', type: 'FLAG', value: true }),
    ]);
    expect(
      parseModLine('Enemies Taunted by you deal 20% less Damage with Hits and Ailments against other targets', 'Tree: Bring the Battle'),
    ).toEqual([
      expect.objectContaining({ name: 'TauntedEnemyLessDamageOtherTargets', type: 'BASE', value: 20 }),
    ]);
  });

  it('Wave 6J: WitheredMagnitude parity and Archdemon Crown support gem level', () => {
    expect(parseModLine('20% increased Effect of Withered', 'Tree')).toEqual([
      expect.objectContaining({ name: 'WitherEffect', type: 'INC', value: 20 }),
      expect.objectContaining({ name: 'WitheredMagnitude', type: 'INC', value: 20 }),
    ]);
    expect(parseModLine('-2 to Level of Socketed Support Gems', 'Item: Archdemon Crown')).toEqual([
      expect.objectContaining({ name: 'SocketedGemLevel:support', type: 'BASE', value: -2 }),
    ]);
  });

  it('Wave 6K: PascalCase stat-name normalization for lowercase custom mods and optional Damage suffix in taken-as', () => {
    expect(parseModLine('adds 2037 to 2037 fire damage', 'Custom')).toEqual([
      expect.objectContaining({ name: 'FireMin', type: 'BASE', value: 2037 }),
      expect.objectContaining({ name: 'FireMax', type: 'BASE', value: 2037 }),
    ]);
    expect(parseModLine('+35% to lightning resistance', 'Custom')).toEqual([
      expect.objectContaining({ name: 'LightningResist', type: 'BASE', value: 35 }),
    ]);
    expect(parseModLine('+35% to chaos resistance', 'Custom')).toEqual([
      expect.objectContaining({ name: 'ChaosResist', type: 'BASE', value: 35 }),
    ]);
    expect(parseModLine('15% increased light radius', 'Custom')).toEqual([
      expect.objectContaining({ name: 'LightRadius', type: 'INC', value: 15 }),
    ]);
    expect(parseModLine('40% of Physical damage taken as Fire', 'Custom')).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageTakenAsFire', type: 'BASE', value: 40 }),
    ]);
    expect(parseModLine('25% of Physical Damage from Hits taken as fire', 'Custom')).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageTakenAsFire', type: 'BASE', value: 25 }),
    ]);
  });

  it('Wave 6L: Successive Detonations MineDetonatedRecently singular var + poe1-regression-bugs rules', () => {
    expect(
      parseModLine('+4% to Critical Strike Multiplier for each Mine Detonated Recently, up to +40%', 'Tree: Successive Detonations'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 4,
        tags: [{ type: 'Multiplier', var: 'MineDetonatedRecently', limit: 10 }],
      }),
    ]);
    expect(
      parseModLine("Herald of Thunder's Storms Hit Enemies with 50% increased Frequency", 'Item: Storm Secret'),
    ).toEqual([
      expect.objectContaining({ name: 'HeraldOfThunderHitFrequency', type: 'INC', value: 50 }),
    ]);
    expect(parseModLine('Cannot Block', 'Item')).toEqual([
      expect.objectContaining({ name: 'CannotBlockAttacks', type: 'FLAG', value: true }),
      expect.objectContaining({ name: 'CannotBlockSpells', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Nearby Enemies have Fire Exposure while at maximum Rage', 'Item')).toEqual([
      expect.objectContaining({
        name: 'FireExposure',
        type: 'BASE',
        value: -10,
        tags: [{ type: 'Condition', var: 'AtMaxRage' }],
      }),
    ]);
    expect(parseModLine('Socketed Spells have +50% to Critical Strike Multiplier', 'Item')).toEqual([
      expect.objectContaining({ name: 'SocketedCritMultiplier', type: 'BASE', value: 50 }),
    ]);
    expect(parseModLine('36% increased Effect of the Buff granted by your Stone Golems', 'Item')).toEqual([
      expect.objectContaining({ name: 'GolemBuffEffect:Stone', type: 'INC', value: 36 }),
    ]);
  });

  it('Wave 6N: Watcher Eye Crit Pen, The Grey Wind, Instruments of Virtue, Onslaught while Fortified, WitherOnHit, OfferingEffectOnSelf', () => {
    expect(
      parseModLine('Critical Strikes Penetrate 10% of Enemy Elemental Resistances while affected by Zealotry', 'Item'),
    ).toEqual([
      expect.objectContaining({ name: 'CritFirePenetration', type: 'BASE', value: 10, tags: [{ type: 'Condition', var: 'AffectedByZealotry' }] }),
      expect.objectContaining({ name: 'CritColdPenetration', type: 'BASE', value: 10, tags: [{ type: 'Condition', var: 'AffectedByZealotry' }] }),
      expect.objectContaining({ name: 'CritLightningPenetration', type: 'BASE', value: 10, tags: [{ type: 'Condition', var: 'AffectedByZealotry' }] }),
    ]);
    expect(
      parseModLine("Attacks with this Weapon have Added Fire Damage equal to 12% of Player's Maximum Life", 'Item: The Grey Wind'),
    ).toEqual([
      expect.objectContaining({ name: 'WeaponAddedFireFromLifePct', type: 'BASE', value: 12 }),
    ]);
    expect(
      parseModLine("10% more Attack Damage for each Non-Instant Spell you've Cast in the past 8 seconds, up to a maximum of 30%", 'Tree: Instruments of Virtue'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 10,
        tags: [{ type: 'Multiplier', var: 'NonInstantSpellCastInPast8Sec', limit: 3 }],
      }),
    ]);
    expect(parseModLine('You have Onslaught while Fortified', 'Item')).toEqual([
      expect.objectContaining({ name: 'Onslaught', type: 'FLAG', value: true, tags: [{ type: 'Condition', var: 'Fortified' }] }),
    ]);
    expect(parseModLine('Melee Weapon Hits Inflict 3 Withered Debuffs for 2 seconds', 'Item')).toEqual([
      expect.objectContaining({ name: 'WitherOnHit', type: 'FLAG', value: true }),
    ]);
    expect(parseModLine('Your Offerings have 50% reduced Effect on you', 'Tree: Necromancer')).toEqual([
      expect.objectContaining({ name: 'OfferingEffectOnSelf', type: 'INC', value: -50 }),
    ]);
  });

  it('Wave 6O: Shining Justice, Dendrobate Dex/Int thresholds, Static Blows, Daresso Onslaught', () => {
    expect(
      parseModLine('Consecrated Ground you create grants 30% increased Accuracy Rating to you and Allies', 'Tree: Shining Justice'),
    ).toEqual([
      expect.objectContaining({
        name: 'Accuracy',
        type: 'INC',
        value: 30,
        tags: [{ type: 'Condition', var: 'OnConsecratedGround' }],
      }),
    ]);
    expect(
      parseModLine('100% increased Damage with Poison if you have at least 300 Dexterity', 'Item: Dendrobate'),
    ).toEqual([
      expect.objectContaining({
        name: 'PoisonDamage',
        type: 'INC',
        value: 100,
        tags: [{ type: 'PerStat', stat: 'Dex', div: 300, limit: 1 }],
      }),
    ]);
    expect(
      parseModLine('25% increased Poison Duration if you have at least 150 Intelligence', 'Item: Dendrobate'),
    ).toEqual([
      expect.objectContaining({
        name: 'PoisonDuration',
        type: 'INC',
        value: 25,
        tags: [{ type: 'PerStat', stat: 'Int', div: 150, limit: 1 }],
      }),
    ]);
    expect(parseModLine('50% increased Duration of Lightning Ailments', 'Tree: Static Blows')).toEqual([
      expect.objectContaining({ name: 'ShockDuration', type: 'INC', value: 50 }),
    ]);
    expect(parseModLine('You gain Onslaught for 5 seconds per Endurance Charge when Hit', 'Item')).toEqual([
      expect.objectContaining({
        name: 'Onslaught',
        type: 'FLAG',
        value: true,
        tags: [{ type: 'Condition', var: 'BeenHitRecently' }],
      }),
    ]);
  });

  it('Wave 6P: PoE 1 3.30 Ascendancy notables (One Step Ahead, Master Toxicist, Natures Boon, Wind Ward, Sign of Purpose, Natures Reprisal)', () => {
    expect(parseModLine('Your Action Speed is at least 105% of base value', 'Tree: One Step Ahead')).toEqual([
      expect.objectContaining({ name: 'MinimumActionSpeed', type: 'MAX', value: 105 }),
    ]);
    expect(parseModLine("Nearby Enemy Monsters' Action Speed is at most 90% of base value", 'Tree: One Step Ahead')).toEqual([
      expect.objectContaining({ name: 'EnemyMaxActionSpeed', type: 'OVERRIDE', value: 90 }),
    ]);
    expect(
      parseModLine('Poisons you inflict during any Flask Effect have 20% chance to deal 100% more Damage', 'Tree: Master Toxicist'),
    ).toEqual([
      expect.objectContaining({
        name: 'PoisonDoubleDamageChance',
        type: 'BASE',
        value: 20,
        tags: [{ type: 'Condition', var: 'UsingFlask' }],
      }),
    ]);
    expect(parseModLine('Magic Utility Flasks applied to you have 30% increased Effect', "Tree: Nature's Boon")).toEqual([
      expect.objectContaining({ name: 'MagicUtilityFlaskEffect', type: 'INC', value: 30 }),
    ]);
    expect(parseModLine('4% less Damage taken per Gale Force', 'Tree: Wind Ward')).toEqual([
      expect.objectContaining({
        name: 'DamageTaken',
        type: 'MORE',
        value: -4,
        tags: [{ type: 'Multiplier', var: 'GaleForce' }],
      }),
    ]);
    expect(
      parseModLine('Brands have 100% more Activation Frequency if 75% of Attached Duration expired', 'Tree: Sign of Purpose'),
    ).toEqual([
      expect.objectContaining({
        name: 'BrandActivationFrequency',
        type: 'MORE',
        value: 100,
        tags: [{ type: 'Condition', var: 'BrandAttached75PctExpired' }],
      }),
    ]);
    expect(parseModLine('25% chance to inflict Withered for 2 seconds on Hit', "Tree: Nature's Reprisal")).toEqual([
      expect.objectContaining({ name: 'WitherOnHit', type: 'FLAG', value: true }),
    ]);
  });
});
