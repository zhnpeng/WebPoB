import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag, type GameId } from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseModLine } from './modParser.js';
import {
  parseModCompositional,
  splitAndNormalizeModLines,
} from './compositionalModParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function readJson(relPath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function extractDatasetRawLines(relPath: string): string[] {
  const data = readJson(relPath) as {
    nodes?: Record<string, { st?: string[]; me?: Array<{ st?: string[] }> }>;
    uniques?: Array<{ i?: string[]; e?: string[] }>;
    notables?: Array<{ st?: string[] }> | Record<string, { st?: string[] }>;
  };
  const raw: string[] = [];
  if (data.nodes) {
    for (const node of Object.values(data.nodes)) {
      if (Array.isArray(node.st)) raw.push(...node.st);
      if (Array.isArray(node.me)) {
        for (const m of node.me) {
          if (Array.isArray(m.st)) raw.push(...m.st);
        }
      }
    }
  } else if (data.uniques) {
    for (const u of data.uniques) {
      if (Array.isArray(u.i)) raw.push(...u.i);
      if (Array.isArray(u.e)) raw.push(...u.e);
    }
  } else if (data.notables) {
    const list = Array.isArray(data.notables) ? data.notables : Object.values(data.notables);
    for (const n of list) {
      if (Array.isArray(n.st)) raw.push(...n.st);
    }
  }
  return raw;
}

describe('splitAndNormalizeModLines', () => {
  it('splits embedded newlines, strips PoB tags, resolves PoE 2 bracket markup, and normalizes ZH->EN', () => {
    const raw = [
      '{variant:1,2}{range:0.5}+50 to maximum Life (crafted)',
      '{fractured}{enchant}12% increased [Attack|Attack Speed]\r\n{crucible}{scourge}{mutated}+15% to [Resistances|all Elemental Resistances] (implicit)',
      '最大生命提高 10%\n全元素抗性 +12%',
    ];
    expect(splitAndNormalizeModLines(raw)).toEqual([
      '+50 to maximum Life',
      '12% increased Attack Speed',
      '+15% to all Elemental Resistances',
      '10% increased maximum Life',
      '+12% to all Elemental Resistances',
    ]);
  });

  it('respects PoE 2 Bonded gating via allowBonded option', () => {
    expect(parseModCompositional('Bonded: +40 to maximum Life', 'item', { game: 'poe2' })).toEqual(
      [],
    );
    expect(
      parseModCompositional('Bonded: +40 to maximum Life', 'item', {
        game: 'poe2',
        allowBonded: true,
      }),
    ).toEqual([expect.objectContaining({ name: 'Life', type: 'BASE', value: 40 })]);
  });
});

describe('Multi-line PoE 1 Keystones & Pool Zeroing Overrides', () => {
  it('parses Blood Magic, The Agnostic, Supreme Ego, and Solipsism directly from poe1-tree-3_30.json', () => {
    const tree = readJson('apps/web/public/data/poe1-tree-3_30.json') as {
      nodes: Record<string, { en: string; st?: string[] }>;
    };
    const byName = new Map<string, string[]>();
    for (const node of Object.values(tree.nodes)) {
      if (node.en && node.st) byName.set(node.en, node.st);
    }

    // Blood Magic (single string with 4 newline-separated lines)
    const bloodMagicLines = byName.get('Blood Magic') ?? [];
    expect(bloodMagicLines.length).toBeGreaterThan(0);
    const bmMods = bloodMagicLines.flatMap((l) => parseModCompositional(l, 'Tree: Blood Magic'));
    expect(bmMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Mana', type: 'OVERRIDE', value: 0 }),
        expect.objectContaining({ name: 'BloodMagic', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'Life', type: 'MORE', value: 10 }),
        expect.objectContaining({ name: 'ManaCostConvertToLife', type: 'BASE', value: 100 }),
        expect.objectContaining({ name: 'ReserveLifeInsteadOfMana', type: 'FLAG', value: true }),
      ]),
    );

    // The Agnostic
    const agnosticMods = (byName.get('The Agnostic') ?? []).flatMap((l) =>
      parseModCompositional(l, 'Tree: The Agnostic'),
    );
    expect(agnosticMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'EnergyShield', type: 'OVERRIDE', value: 0 }),
        expect.objectContaining({
          name: 'AgnosticManaSacrificePct',
          type: 'BASE',
          value: 20,
          tags: [{ type: 'Condition', var: 'FullLife', neg: true }],
        }),
      ]),
    );

    // Supreme Ego
    const supremeEgoMods = (byName.get('Supreme Ego') ?? []).flatMap((l) =>
      parseModCompositional(l, 'Tree: Supreme Ego'),
    );
    expect(supremeEgoMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'SupremeEgo', type: 'FLAG', value: true }),
        expect.objectContaining({
          name: 'AuraEffect',
          type: 'MORE',
          value: 1,
          keywordFlags: KeywordFlag.Aura,
          tags: [{ type: 'PerStat', stat: 'ManaReservedPercent', div: 2 }],
        }),
        expect.objectContaining({
          name: 'ManaReserved',
          type: 'MORE',
          value: 40,
          keywordFlags: KeywordFlag.Aura,
        }),
      ]),
    );

    // Solipsism
    const solipsismMods = (byName.get('Solipsism') ?? []).flatMap((l) =>
      parseModCompositional(l, 'Tree: Solipsism'),
    );
    expect(solipsismMods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'NoIntBonusToES', type: 'FLAG', value: true }),
        expect.objectContaining({
          name: 'SelfElementalAilmentDuration',
          type: 'INC',
          value: -2,
          tags: [{ type: 'PerStat', stat: 'Int', div: 15 }],
        }),
      ]),
    );
  });

  it('parses CI, Resolute Technique, and PoE 2 pool zeroing lines', () => {
    expect(parseModCompositional('Maximum Life becomes 1', 'tree')).toEqual([
      expect.objectContaining({ name: 'Life', type: 'OVERRIDE', value: 1 }),
      expect.objectContaining({ name: 'ChaosInoculation', type: 'FLAG', value: true }),
    ]);
    expect(parseModCompositional('Maximum Life is 1', 'tree', { game: 'poe2' })).toEqual([
      expect.objectContaining({ name: 'Life', type: 'OVERRIDE', value: 1 }),
      expect.objectContaining({ name: 'ChaosInoculation', type: 'FLAG', value: true }),
    ]);
    expect(parseModCompositional('You have no Spirit', 'item', { game: 'poe2' })).toEqual([
      expect.objectContaining({ name: 'ZeroSpirit', type: 'FLAG', value: true }),
    ]);
    expect(parseModCompositional('Your Hits cannot be Evaded', 'tree')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'CannotBeEvaded', type: 'FLAG', value: true }),
        expect.objectContaining({ name: 'HitsCantBeEvaded', type: 'FLAG', value: true }),
      ]),
    );
    expect(parseModCompositional("Hits can't be Evaded", 'item')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'CannotBeEvaded', type: 'FLAG', value: true }),
      ]),
    );
    expect(parseModCompositional('Never deal Critical Strikes', 'tree')).toEqual([
      expect.objectContaining({ name: 'NeverCrit', type: 'FLAG', value: true }),
    ]);
    expect(parseModCompositional('Cannot deal Critical Hits', 'tree', { game: 'poe2' })).toEqual([
      expect.objectContaining({ name: 'NeverCrit', type: 'FLAG', value: true }),
    ]);
  });
});

describe("Stage 1: Watcher's Eye Aura Prefixes, Actor Scopes, PerStat, Multipliers & Conditions", () => {
  it("parses Watcher's Eye aura modifiers with AffectedBy<Aura> condition tags", () => {
    expect(
      parseModCompositional('While affected by Hatred, +1.8% to Critical Strike Chance', 'jewel'),
    ).toEqual([
      expect.objectContaining({
        name: 'BaseCritChance',
        type: 'BASE',
        value: 1.8,
        tags: [{ type: 'Condition', var: 'AffectedByHatred' }],
      }),
    ]);

    expect(
      parseModCompositional(
        'While affected by Pride, 25% chance to Impale Enemies on Hit with Attacks',
        'jewel',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ImpaleChance',
        type: 'BASE',
        value: 25,
        flags: ModFlag.Attack,
        tags: [{ type: 'Condition', var: 'AffectedByPride' }],
      }),
    ]);

    expect(
      parseModCompositional(
        'While affected by Purity of Elements, +30% to Chaos Resistance',
        'jewel',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ChaosResist',
        type: 'BASE',
        value: 30,
        tags: [{ type: 'Condition', var: 'AffectedByPurityOfElements' }],
      }),
    ]);

    expect(
      parseModCompositional(
        'While affected by Malevolence, Damaging Ailments you inflict deal Damage 15% faster',
        'jewel',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'AilmentFaster',
        type: 'INC',
        value: 15,
        tags: [{ type: 'Condition', var: 'AffectedByMalevolence' }],
      }),
    ]);

    expect(
      parseModCompositional(
        'While affected by Clarity, Gain 10% of Maximum Mana as Extra Maximum Energy Shield',
        'jewel',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ManaAsExtraES',
        type: 'BASE',
        value: 10,
        tags: [{ type: 'Condition', var: 'AffectedByClarity' }],
      }),
    ]);

    // Verify dynamic evaluation inside ModDB
    const db = new ModDB();
    db.addMods(
      parseModCompositional('While affected by Hatred, +1.8% to Critical Strike Chance', 'jewel'),
    );
    expect(db.sum('BASE', 'BaseCritChance')).toBe(0);
    db.setCondition('AffectedByHatred', true);
    expect(db.sum('BASE', 'BaseCritChance')).toBeCloseTo(1.8, 5);
  });

  it('parses Minion prefixes/suffixes and Enemy debuff/damage-taken prefixes', () => {
    expect(parseModCompositional('Minions deal 20% increased Damage', 'tree')).toEqual([
      expect.objectContaining({
        name: 'MinionDamage',
        type: 'INC',
        value: 20,
        keywordFlags: KeywordFlag.Minion,
      }),
    ]);
    expect(parseModCompositional('Minions have 15% increased Attack and Cast Speed', 'tree')).toEqual([
      expect.objectContaining({
        name: 'MinionSpeed',
        type: 'INC',
        value: 15,
        flags: 0,
        keywordFlags: KeywordFlag.Minion,
      }),
    ]);
    expect(parseModCompositional('Minions have 12% increased maximum Life', 'tree')).toEqual([
      expect.objectContaining({
        name: 'MinionLife',
        type: 'INC',
        value: 12,
        keywordFlags: KeywordFlag.Minion,
      }),
    ]);
    expect(parseModCompositional('Minions have +25% to Critical Strike Multiplier', 'tree')).toEqual([
      expect.objectContaining({
        name: 'MinionCritMultiplier',
        type: 'BASE',
        value: 25,
        keywordFlags: KeywordFlag.Minion,
      }),
    ]);
    expect(parseModCompositional('25% increased Damage for Minions', 'item')).toEqual([
      expect.objectContaining({
        name: 'MinionDamage',
        type: 'INC',
        value: 25,
        keywordFlags: KeywordFlag.Minion,
      }),
    ]);
    expect(parseModCompositional('Nearby Enemies take 10% increased Damage', 'item')).toEqual([
      expect.objectContaining({ name: 'EnemyDamageTaken', type: 'INC', value: 10 }),
    ]);
    expect(
      parseModCompositional('Enemies Maimed by you take 10% increased Physical Damage', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyPhysicalDamageTaken',
        type: 'INC',
        value: 10,
        tags: [{ type: 'Condition', var: 'EnemyMaimed' }],
      }),
    ]);
    expect(
      parseModCompositional('Enemies Hindered by you take 15% increased Chaos Damage', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyChaosDamageTaken',
        type: 'INC',
        value: 15,
        tags: [{ type: 'Condition', var: 'EnemyHindered' }],
      }),
    ]);
    expect(
      parseModCompositional('Nearby Enemies have -9% to Fire Resistance', 'item'),
    ).toEqual([expect.objectContaining({ name: 'EnemyFireResist', type: 'BASE', value: -9 })]);
  });

  it('parses PerStat, Charge, Rage, Corrupted Item, and Mastery multipliers and evaluates them in ModDB', () => {
    const intDmg = parseModCompositional('2% increased Spell Damage per 15 Intelligence', 'item');
    expect(intDmg).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 2,
        flags: ModFlag.Spell,
        tags: [{ type: 'PerStat', stat: 'Int', div: 15 }],
      }),
    ]);

    const db = new ModDB();
    db.addMods(intDmg);
    db.setStat('Int', 300);
    expect(db.sum('INC', 'Damage', ModFlag.Spell)).toBe(40);

    expect(
      parseModCompositional('4% increased Spell Damage per Power Charge while on Low Life', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 4,
        flags: ModFlag.Spell,
        tags: [
          { type: 'Multiplier', var: 'PowerCharge' },
          { type: 'Condition', var: 'LowLife' },
        ],
      }),
    ]);

    expect(
      parseModCompositional('1% increased Attack Speed per Rage', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 1,
        flags: ModFlag.Attack,
        tags: [{ type: 'Multiplier', var: 'Rage' }],
      }),
    ]);

    expect(
      parseModCompositional('5% increased Maximum Life for each Corrupted Item Equipped', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Life',
        type: 'INC',
        value: 5,
        tags: [{ type: 'Multiplier', var: 'CorruptedItem' }],
      }),
    ]);

    expect(
      parseModCompositional('3% more Damage per Allocated Mastery', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 3,
        tags: [{ type: 'Multiplier', var: 'AllocatedMastery' }],
      }),
    ]);

    expect(
      parseModCompositional(
        '15% increased Critical Strike Chance against Shocked Enemies while Focused',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 15,
        tags: [
          { type: 'Condition', var: 'EnemyShocked' },
          { type: 'Condition', var: 'Focused' },
        ],
      }),
    ]);
  });
});

describe('Stage 2 & 3: Weapons, Skills, Elements, Conversions, Flat Damage, Penetration & DoT Multi', () => {
  it('peels weapon, skill, delivery, and element flags compositionally', () => {
    expect(parseModCompositional('12% increased Attack Speed with Bows', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 12,
        flags: ModFlag.Bow | ModFlag.Attack,
      }),
    ]);
    expect(parseModCompositional('20% increased Damage with Quarterstaves', 'tree')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'INC', value: 20, flags: ModFlag.Quarterstaff }),
    ]);
    expect(parseModCompositional('18% increased Damage with Crossbows', 'tree')).toEqual([
      expect.objectContaining({ name: 'Damage', type: 'INC', value: 18, flags: ModFlag.Crossbow }),
    ]);
    expect(parseModCompositional('15% increased Damage with Spears', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 15,
        flags: ModFlag.Sword | ModFlag.Melee,
      }),
    ]);
    expect(
      parseModCompositional('24% increased Physical Damage with Two Handed Melee Weapons', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'PhysicalDamage',
        type: 'INC',
        value: 24,
        flags: ModFlag.Weapon2H | ModFlag.Melee,
      }),
    ]);
    expect(
      parseModCompositional('30% increased Damage with Hits and Ailments', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 30,
        flags: ModFlag.Hit | ModFlag.Ailment,
      }),
    ]);
    expect(
      parseModCompositional('10% increased Attack Damage with Claws while Dual Wielding per Frenzy Charge', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 10,
        flags: ModFlag.Claw | ModFlag.Attack,
        tags: [
          { type: 'Condition', var: 'DualWielding' },
          { type: 'Multiplier', var: 'FrenzyCharge' },
        ],
      }),
    ]);
    expect(parseModCompositional('15% increased Area of Effect of Aura Skills', 'tree')).toEqual([
      expect.objectContaining({
        name: 'AreaOfEffect',
        type: 'INC',
        value: 15,
        keywordFlags: KeywordFlag.Aura,
      }),
    ]);
    expect(parseModCompositional('10% increased Cast Speed with Cold Skills', 'tree')).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 10,
        flags: ModFlag.Spell,
        keywordFlags: KeywordFlag.Cold,
      }),
    ]);
  });

  it('parses Conversions, Gain as Extra, Added Flat Damage, Penetrations, DoT Multipliers & Regen', () => {
    expect(
      parseModCompositional('50% of Physical Damage Converted to Lightning Damage', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageConvertToLightning', type: 'BASE', value: 50 }),
    ]);

    expect(
      parseModCompositional('Gain 15% of Physical Damage as Extra Fire Damage', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'PhysicalDamageGainAsFire', type: 'BASE', value: 15 }),
    ]);

    expect(
      parseModCompositional('Gain 10% of Elemental Damage as Extra Chaos Damage', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'ElementalDamageGainAsChaos', type: 'BASE', value: 10 }),
    ]);

    expect(
      parseModCompositional('Gain 12% of Damage as Extra Cold Damage', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'DamageGainAsCold', type: 'BASE', value: 12 }),
    ]);

    expect(
      parseModCompositional('Adds 10 to 25 Fire Damage to Attacks with Bows', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'FireMin',
        type: 'BASE',
        value: 10,
        flags: ModFlag.Bow | ModFlag.Attack,
      }),
      expect.objectContaining({
        name: 'FireMax',
        type: 'BASE',
        value: 25,
        flags: ModFlag.Bow | ModFlag.Attack,
      }),
    ]);

    expect(
      parseModCompositional('Adds 14 to 28 Lightning Damage to Spells', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'LightningMin', type: 'BASE', value: 14, flags: ModFlag.Spell }),
      expect.objectContaining({ name: 'LightningMax', type: 'BASE', value: 28, flags: ModFlag.Spell }),
    ]);

    expect(
      parseModCompositional('Damage Penetrates 8% Cold Resistance against Chilled Enemies', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'ColdPenetration',
        type: 'BASE',
        value: 8,
        tags: [{ type: 'Condition', var: 'EnemyChilled' }],
      }),
    ]);

    expect(
      parseModCompositional('Damage Penetrates 10% Elemental Resistances', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'ElementalPenetration', type: 'BASE', value: 10 }),
    ]);

    expect(
      parseModCompositional('+18% to Fire Damage over Time Multiplier', 'item'),
    ).toEqual([
      expect.objectContaining({ name: 'FireDotMultiplier', type: 'BASE', value: 18 }),
    ]);

    expect(
      parseModCompositional('+20% to Damage over Time Multiplier', 'tree'),
    ).toEqual([
      expect.objectContaining({ name: 'DotMultiplier', type: 'BASE', value: 20 }),
    ]);

    expect(parseModCompositional('Regenerate 1.5% of Life per second', 'tree')).toEqual([
      expect.objectContaining({ name: 'LifeRegenPercent', type: 'BASE', value: 1.5 }),
    ]);

    expect(parseModCompositional('Regenerate 45 Life per second', 'item')).toEqual([
      expect.objectContaining({ name: 'LifeRegen', type: 'BASE', value: 45 }),
    ]);

    expect(parseModCompositional('Regenerate 2% of Energy Shield per second', 'tree')).toEqual([
      expect.objectContaining({ name: 'EnergyShieldRegenPercent', type: 'BASE', value: 2 }),
    ]);
  });

  it('parses Wave 4O high-frequency PoE 1 & PoE 2 corpus patterns (suppression, deflection, block, charges, non-channelling, fists of stone, graft scoping)', () => {
    // Prevent +X% of Suppressed Spell Damage / Deflected Hits
    expect(parseModCompositional('Prevent +3% of Suppressed Spell Damage', 'mastery')).toEqual([
      expect.objectContaining({ name: 'SpellSuppressionEffect', type: 'BASE', value: 3 }),
    ]);
    expect(parseModCompositional('Prevent +6% of Damage from Deflected Hits', 'tree')).toEqual([
      expect.objectContaining({ name: 'DeflectedHitDamagePrevented', type: 'BASE', value: 6 }),
    ]);

    // PoE 2 Fists of Stone / Runeforged Fists of Stone "Has +X ... per player level"
    expect(parseModCompositional('Has +2 to Evasion Rating per player level', 'item')).toEqual([
      expect.objectContaining({
        name: 'Evasion',
        type: 'BASE',
        value: 2,
        tags: [{ type: 'Multiplier', var: 'Level' }],
      }),
    ]);
    expect(
      parseModCompositional('Has +1 to maximum Energy Shield per player level', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnergyShield',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'Multiplier', var: 'Level' }],
      }),
    ]);
    expect(parseModCompositional('Has +1 to maximum Runic Ward per player level', 'item')).toEqual([
      expect.objectContaining({
        name: 'Ward',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'Multiplier', var: 'Level' }],
      }),
    ]);

    // Block PerStat & Shield ES without "Equipped"
    expect(
      parseModCompositional(
        '+1% Chance to Block Spell Damage per 5% Chance to Block Attack Damage',
        'mastery',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'SpellBlockChance',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'BlockChance', div: 5 }],
      }),
    ]);
    expect(
      parseModCompositional(
        '1% increased Mana Regeneration Rate per 1% Chance to Block Spell Damage',
        'tree',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'ManaRegen',
        type: 'INC',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'SpellBlockChance', div: 1 }],
      }),
    ]);
    expect(
      parseModCompositional(
        '+1% to Critical Strike Multiplier per 10 Maximum Energy Shield on Shield',
        'mastery',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'PerStat', stat: 'ShieldES', div: 10 }],
      }),
    ]);

    // Charge Mastery: per Endurance, Frenzy or Power Charge -> TotalCharges
    const chargeMastery = parseModCompositional(
      '3% increased Damage per Endurance, Frenzy or Power Charge',
      'mastery',
    );
    expect(chargeMastery).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 3,
        tags: [{ type: 'Multiplier', var: 'TotalCharges' }],
      }),
    ]);
    const chargeDb = new ModDB();
    chargeDb.addMods(chargeMastery);
    chargeDb.setMultiplier('PowerCharge', 4);
    chargeDb.setMultiplier('FrenzyCharge', 3);
    chargeDb.setMultiplier('EnduranceCharge', 5);
    expect(chargeDb.sum('INC', 'Damage')).toBe(36);

    // Non-Channelling Spells & Player Maximum Life & Projectiles within 2m
    expect(
      parseModCompositional('Non-Channelling Spells deal 6% increased Damage per 100 maximum Life', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 6,
        flags: ModFlag.Spell,
        tags: [
          { type: 'PerStat', stat: 'Life', div: 100 },
          { type: 'SkillType', skillType: 'Channel', neg: true },
        ],
      }),
    ]);
    expect(
      parseModCompositional('5% increased Spell Damage per 100 Player Maximum Life', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 5,
        flags: ModFlag.Spell,
        tags: [{ type: 'PerStat', stat: 'Life', div: 100 }],
      }),
    ]);
    expect(
      parseModCompositional(
        'Projectiles have 40% increased Critical Damage Bonus against Enemies within 2m',
        'tree',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'CritDamageBonusInc',
        type: 'INC',
        value: 40,
        flags: ModFlag.Projectile,
        tags: [{ type: 'Condition', var: 'EnemyDistanceLe:20' }],
      }),
    ]);

    // Marked Enemy, against you, Graft skill scoping (must stay gated by SkillType: Graft)
    expect(
      parseModCompositional('Marked Enemy has 10% reduced Accuracy Rating', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyAccuracy',
        type: 'INC',
        value: -10,
        tags: [{ type: 'Condition', var: 'EnemyMarked' }],
      }),
    ]);
    expect(
      parseModCompositional('Hits have 25% reduced Critical Hit Chance against you', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyCritChance',
        type: 'INC',
        value: -25,
        flags: ModFlag.Hit,
      }),
    ]);
    expect(
      parseModCompositional('Skills used by this Graft have +30% to Critical Strike Multiplier', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 30,
        tags: [{ type: 'SkillType', skillType: 'Graft' }],
      }),
    ]);

    // Additional high-frequency PoE 1 & PoE 2 stems & conditions
    expect(parseModCompositional('30% increased Flask Recovery rate', 'tree')).toEqual([
      expect.objectContaining({ name: 'FlaskRecoveryRate', type: 'INC', value: 30 }),
    ]);
    expect(parseModCompositional('32% reduced Bleed Duration on you', 'jewel')).toEqual([
      expect.objectContaining({ name: 'SelfBleedDuration', type: 'INC', value: -32 }),
    ]);
    expect(parseModCompositional('2% increased Trap and Mine Throwing Speed', 'cluster')).toEqual([
      expect.objectContaining({
        name: 'TrapThrowingSpeed',
        type: 'INC',
        value: 2,
        keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine,
      }),
      expect.objectContaining({
        name: 'MineThrowingSpeed',
        type: 'INC',
        value: 2,
        keywordFlags: KeywordFlag.Trap | KeywordFlag.Mine,
      }),
    ]);
    expect(parseModCompositional('Grenade Skills have +1 Cooldown Use', 'tree')).toEqual([
      expect.objectContaining({
        name: 'AdditionalCooldownUses',
        type: 'BASE',
        value: 1,
        tags: [{ type: 'SkillType', skillType: 'Grenade' }],
      }),
    ]);
    expect(parseModCompositional('60% increased Mana Cost Efficiency of Marks', 'tree')).toEqual([
      expect.objectContaining({
        name: 'ManaCostEfficiency',
        type: 'INC',
        value: 60,
        tags: [{ type: 'SkillType', skillType: 'Mark' }],
      }),
    ]);
    expect(
      parseModCompositional('30% less Movement Speed Penalty from using Skills while moving', 'asc'),
    ).toEqual([
      expect.objectContaining({
        name: 'MoveSpeedPenaltyReduction',
        type: 'MORE',
        value: -30,
        tags: [{ type: 'Condition', var: 'Moving' }],
      }),
    ]);
    expect(
      parseModCompositional('3% less Damage taken per Tailwind', 'asc'),
    ).toEqual([
      expect.objectContaining({
        name: 'DamageTaken',
        type: 'MORE',
        value: -3,
        tags: [{ type: 'Multiplier', var: 'Tailwind' }],
      }),
    ]);
    expect(
      parseModCompositional('Companions deal 59% increased damage to your Marked targets', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'CompanionDamage',
        type: 'INC',
        value: 59,
        tags: [{ type: 'Condition', var: 'EnemyMarked' }],
      }),
    ]);

    // Wave 4O-B 63-build bug-regression corpus patterns
    expect(parseModCompositional('-1 to Spirit per 2 Levels', 'item')).toEqual([
      expect.objectContaining({
        name: 'Spirit',
        type: 'BASE',
        value: -1,
        tags: [{ type: 'PerStat', stat: 'Level', div: 2 }],
      }),
    ]);
    expect(
      parseModCompositional('88% increased Damage with Poison if you have at least 300 Dexterity', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'DotDamage',
        type: 'INC',
        value: 88,
        keywordFlags: KeywordFlag.Poison,
        tags: [{ type: 'Condition', var: 'StatThreshold:Dex:300' }],
      }),
    ]);
    expect(
      parseModCompositional('Regenerate 200 Energy Shield per second while a Rare or Unique Enemy is Nearby', 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'EnergyShieldRegen',
        type: 'BASE',
        value: 200,
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      }),
    ]);
    expect(
      parseModCompositional("20% increased Runic Ward Regeneration Rate if you've dealt a Critical Hit Recently", 'item'),
    ).toEqual([
      expect.objectContaining({
        name: 'WardRegen',
        type: 'INC',
        value: 20,
        tags: [{ type: 'Condition', var: 'CritRecently' }],
      }),
    ]);
    expect(
      parseModCompositional('Nearby Enemies have 18% increased Effect of Curses on them', 'custom'),
    ).toEqual([
      expect.objectContaining({
        name: 'CurseEffect',
        type: 'INC',
        value: 18,
      }),
    ]);
  });
});

describe('Real-World Corpus Coverage (parseModLine + parseModCompositional fallback)', () => {
  const datasets: Array<{
    name: string;
    relPath: string;
    game: GameId;
    minCombinedPct: number;
  }> = [
    {
      name: 'poe1-tree-3_30.json',
      relPath: 'apps/web/public/data/poe1-tree-3_30.json',
      game: 'poe1',
      minCombinedPct: 75,
    },
    {
      name: 'poe2-tree-0_5.json',
      relPath: 'apps/web/public/data/poe2-tree-0_5.json',
      game: 'poe2',
      minCombinedPct: 87,
    },
    {
      name: 'poe1-uniques.json',
      relPath: 'apps/web/public/data/poe1-uniques.json',
      game: 'poe1',
      minCombinedPct: 70,
    },
    {
      name: 'poe2-uniques.json',
      relPath: 'apps/web/public/data/poe2-uniques.json',
      game: 'poe2',
      minCombinedPct: 74,
    },
    {
      name: 'poe1-clusters.json',
      relPath: 'apps/web/public/data/poe1-clusters.json',
      game: 'poe1',
      minCombinedPct: 78,
    },
  ];

  for (const ds of datasets) {
    it(`achieves >= ${ds.minCombinedPct}% combined coverage on ${ds.name}`, () => {
      const lines = splitAndNormalizeModLines(extractDatasetRawLines(ds.relPath));
      expect(lines.length).toBeGreaterThan(0);

      let baseMatched = 0;
      let combinedMatched = 0;
      for (const line of lines) {
        const legacy = parseModLine(line, ds.name);
        if (legacy.length > 0) {
          baseMatched++;
          combinedMatched++;
        } else if (parseModCompositional(line, ds.name, { game: ds.game }).length > 0) {
          combinedMatched++;
        }
      }

      const combinedPct = (combinedMatched / lines.length) * 100;
      expect(combinedMatched).toBeGreaterThanOrEqual(baseMatched);
      expect(combinedPct).toBeGreaterThanOrEqual(ds.minCombinedPct);
    });
  }

  it('parses Wave 4P suffix conditions and multipliers (Retaliation, Consumed Charge, Totem, Yoke Ailment, Eye Jewel)', () => {
    expect(
      parseModCompositional('20% increased Attack Speed if you have used a Retaliation Skill Recently', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Speed',
        type: 'INC',
        value: 20,
        tags: [{ type: 'Condition', var: 'UsedRetaliationSkillRecently' }],
      }),
    ]);
    expect(
      parseModCompositional("15% more Spell Damage if you've consumed a Power Charge Recently", 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'MORE',
        value: 15,
        tags: [{ type: 'Condition', var: 'ConsumedPowerChargeRecently' }],
      }),
    ]);
    expect(
      parseModCompositional('30% increased Armour while you have a Totem', 'tree'),
    ).toEqual([
      expect.objectContaining({
        name: 'Armour',
        type: 'INC',
        value: 30,
        tags: [{ type: 'Condition', var: 'HaveTotem' }],
      }),
    ]);
    expect(
      parseModCompositional(
        'Enemies take 19% increased Damage for each Elemental Ailment type among your Ailments on them',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'EnemyDamageTaken',
        type: 'INC',
        value: 19,
        tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
      }),
    ]);
    expect(
      parseModCompositional(
        'Minions have +6% to Damage over Time Multiplier per Ghastly Eye Jewel affecting you, up to a maximum of +30%',
        'item',
      ),
    ).toEqual([
      expect.objectContaining({
        name: 'MinionDotMultiplier',
        type: 'BASE',
        value: 6,
        tags: [
          expect.objectContaining({
            type: 'Multiplier',
            var: 'GhastlyEyeJewel',
            limit: 30,
            limitTotal: true,
          }),
        ],
      }),
    ]);

    // Wave 4Q additions: Weapon Damage per Str, Socketed Rune/Soul Core, Life Cost Efficiency
    expect(parseModCompositional('12% increased Weapon Damage per 5 Strength', 'item')).toEqual([
      expect.objectContaining({
        name: 'Damage',
        type: 'INC',
        value: 12,
        flags: ModFlag.Attack,
        tags: [{ type: 'PerStat', stat: 'Str', div: 5 }],
      }),
    ]);
    expect(parseModCompositional('+10 to Spirit per Socketed Rune or Soul Core', 'item')).toEqual([
      expect.objectContaining({
        name: 'Spirit',
        type: 'BASE',
        value: 10,
        tags: [{ type: 'Multiplier', var: 'SocketedRune' }],
      }),
    ]);
    expect(parseModCompositional('40% increased Life Cost Efficiency', 'item')).toEqual([
      expect.objectContaining({
        name: 'LifeCostEfficiency',
        type: 'INC',
        value: 40,
      }),
    ]);

    // Wave 4R Tincture Melee Weapon mods & "from Melee Weapons" suffix
    expect(parseModCompositional('+23% to Melee Weapon Critical Strike Multiplier', 'tincture')).toEqual([
      expect.objectContaining({
        name: 'CritMultiplier',
        type: 'BASE',
        value: 23,
        flags: ModFlag.Attack | ModFlag.Melee,
      }),
    ]);
    expect(parseModCompositional('100% increased Melee Weapon Critical Strike Chance', 'tincture')).toEqual([
      expect.objectContaining({
        name: 'CritChance',
        type: 'INC',
        value: 100,
        flags: ModFlag.Attack | ModFlag.Melee,
      }),
    ]);
    expect(parseModCompositional('90% Increased Damage with Bleed From Melee Weapons', 'tincture')).toEqual([
      expect.objectContaining({
        name: 'DotDamage',
        type: 'INC',
        value: 90,
        flags: ModFlag.Attack | ModFlag.Melee,
        keywordFlags: KeywordFlag.Bleed,
      }),
    ]);
  });
});
