import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag } from '@webpob/core';
import { parseModLine } from './modParser.js';
import { POE1_EXTRA_MOD_RULES, parsePoe1ExtraModLine } from './modParserPoe1.js';

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
