import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag, type Mod, type PassiveNode } from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseModLine, parseModLines } from './modParser.js';
import {
  SUPPORTED_ASCENDANCY_NOTABLES,
  applyPostLifeAscendancyMechanics,
  applyPreStatAscendancyMechanics,
  computeSmallPassiveEffectMultiplier,
  scaleSmallPassiveMods,
} from './ascendancyMods.js';

function mkNode(
  name: string,
  stats: string[] = [],
  ascendancyId = 'TestAscendancy',
  id = 1,
): PassiveNode {
  return {
    id,
    name: { en: name, zh: name },
    kind: 'notable',
    x: 0,
    y: 0,
    stats,
    adjacent: [],
    ascendancyId,
  };
}

describe('ascendancyMods', () => {
  describe('PoE 2 Titan — Hulking Form (Small Passive Scaling)', () => {
    it('returns 1 when Hulking Form is not allocated', () => {
      expect(computeSmallPassiveEffectMultiplier([mkNode('Crushing Impacts')])).toBe(1);
    });

    it('returns 1.5 when Hulking Form is allocated (by stat text or by name)', () => {
      const byStat = mkNode('Hulking Form', ['50% increased effect of Small Passive Skills'], 'Titan');
      const byName = mkNode('Hulking Form', [], 'Titan');
      expect(computeSmallPassiveEffectMultiplier([byStat])).toBe(1.5);
      expect(computeSmallPassiveEffectMultiplier([byName])).toBe(1.5);
    });

    it('scales small passive numeric modifiers with PoB integer truncation', () => {
      const mult = computeSmallPassiveEffectMultiplier([
        mkNode('Hulking Form', ['50% increased effect of Small Passive Skills'], 'Titan'),
      ]);
      const rawMods: Mod[] = [
        { name: 'Armour', type: 'INC', value: 15, flags: 0, keywordFlags: 0, source: 'Small Armour' },
        { name: 'Str', type: 'BASE', value: 8, flags: 0, keywordFlags: 0, source: 'Small Str' },
        { name: 'SomeFlag', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: 'Small Flag' },
      ];
      const scaled = scaleSmallPassiveMods(rawMods, mult);
      expect(scaled[0]?.value).toBe(22); // Math.trunc(15 * 1.5) = 22
      expect(scaled[1]?.value).toBe(12); // Math.trunc(8 * 1.5) = 12
      expect(scaled[2]?.value).toBe(true);

      // PoE 2 CalcSetup.lua:397 (`not node.isAttribute`): pure attribute travel nodes are NOT scaled
      const attrTravelMods: Mod[] = [
        { name: 'Str', type: 'BASE', value: 5, flags: 0, keywordFlags: 0, source: 'Tree: Attribute' },
      ];
      expect(scaleSmallPassiveMods(attrTravelMods, mult)[0]?.value).toBe(5);
      const strTravelMods: Mod[] = [
        { name: 'Str', type: 'BASE', value: 8, flags: 0, keywordFlags: 0, source: 'Tree: Strength' },
      ];
      expect(scaleSmallPassiveMods(strTravelMods, mult)[0]?.value).toBe(8);
    });
  });

  describe('PoE 2 Ascendancies', () => {
    it('Invoker: Lead me through Grace... grants exact +174 Spirit on 608 ES / 1979 Eva Body Armour', () => {
      const db = new ModDB();
      db.addMod({ name: 'Spirit', type: 'BASE', value: 100, flags: 0, keywordFlags: 0, source: 'Campaign Base Spirit' });
      const node = mkNode(
        'Lead me through Grace...',
        [
          '+1 to Spirit for every 8 Item Energy Shield on Equipped Body Armour',
          '+1 to Spirit for every 20 Evasion Rating on Equipped Body Armour',
          'Cannot gain Spirit from Equipment',
        ],
        'Invoker',
      );
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: [node],
        bodyArmourStats: { energyShield: 608, evasion: 1979 },
      });

      // Math.floor(608 / 8) + Math.floor(1979 / 20) = 76 + 98 = 174; 100 + 174 = 274
      expect(db.sum('BASE', 'Spirit')).toBe(274);
      expect(db.flag('NoSpiritFromEquipment')).toBe(true);
    });

    it('Invoker: ...and Protect me from Harm applies 35% less Evasion and Evasion->Armour PDR equivalence', () => {
      const db = new ModDB();
      db.addMod({ name: 'Evasion', type: 'BASE', value: 10000, flags: 0, keywordFlags: 0, source: 'Gear' });
      const node = mkNode('...and Protect me from Harm', [], 'Invoker');

      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: [node] });
      expect(db.more('Evasion')).toBeCloseTo(0.65, 5);
      expect(db.flag('EvasionAppliesToArmourPdr')).toBe(true);

      const postEva = db.calcStat('Evasion').total; // 6500
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: [node],
        str: 50,
        dex: 150,
        int: 150,
        maxLife: 1500,
        maxMana: 700,
        evasion: postEva,
      });
      expect(db.sum('BASE', 'ArmourEquivFromEvasion')).toBe(6500);
    });

    it('Blood Mage: Sunder the Flesh, Crimson Power & Gore Spike', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Sunder the Flesh', ['Base Critical Hit Chance for Spells is 15%'], 'Blood Mage', 1),
        mkNode('Crimson Power', [], 'Blood Mage', 2),
        mkNode('Gore Spike', ['1% increased Critical Damage Bonus per 40 Life'], 'Blood Mage', 3),
      ];

      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        bodyArmourStats: { energyShield: 650 },
      });
      expect(db.override('SpellBaseCritOverride', ModFlag.Spell)).toBe(15);
      expect(db.sum('BASE', 'Life')).toBe(650);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 200,
        dex: 100,
        int: 160,
        maxLife: 4300,
        maxMana: 800,
      });
      // Math.floor(4300 / 40) = 107
      expect(db.sum('BASE', 'CritMultiplier')).toBe(107);

      // Also verify PoE 2 0.5 wording ("per 50 current Life") dynamically parses divisor 50
      const db05 = new ModDB();
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db: db05,
        allocatedNodes: [mkNode('Gore Spike', ['1% increased Critical Damage Bonus per 50 current Life'], 'Blood Mage')],
        str: 200,
        dex: 100,
        int: 160,
        maxLife: 4300,
        maxMana: 800,
      });
      expect(db05.sum('BASE', 'CritMultiplier')).toBe(86); // Math.floor(4300 / 50)

      // Also verify PoE 2 Gore Spike deduplicates when tree stat line already parsed into CritDamageBonusInc
      const dbGoreParsed = new ModDB();
      const goreNode04 = mkNode('Gore Spike', ['1% increased Critical Damage Bonus per 40 Life'], 'Blood Mage', 52703);
      dbGoreParsed.addMods(parseModLines(goreNode04.stats, 'Passive: Gore Spike'));
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db: dbGoreParsed,
        allocatedNodes: [goreNode04],
        str: 200,
        dex: 100,
        int: 160,
        maxLife: 4000,
        maxMana: 800,
      });
      dbGoreParsed.setStat('Life', 4000);
      expect(dbGoreParsed.sum('INC', 'CritDamageBonusInc')).toBe(100);
      expect(dbGoreParsed.sum('BASE', 'CritMultiplier')).toBe(0);

      // Verify PoE 2 Herald-of-X conditional parsing (Coming Calamity)
      expect(parseModLine('30% increased Lightning Damage while affected by Herald of Thunder', 'item')).toEqual([
        expect.objectContaining({
          name: 'LightningDamage',
          type: 'INC',
          value: 30,
          tags: [{ type: 'Condition', var: 'AffectedByHeraldOfThunder' }],
        }),
      ]);
      expect(parseModLine('While affected by Herald of Ice, 25% increased Cold Damage', 'item')).toEqual([
        expect.objectContaining({
          name: 'ColdDamage',
          type: 'INC',
          value: 25,
          tags: [{ type: 'Condition', var: 'AffectedByHeraldOfIce' }],
        }),
      ]);

      // Verify PoE 2 Disciple of Varashta Instruments of Power (-50% Focus bonus scaling & deduplication)
      expect(parseModLine('50% reduced bonuses gained from Equipped Focus', 'Passive: Instruments of Power')).toEqual([
        expect.objectContaining({ name: 'EffectOfBonusesFromFocus', type: 'INC', value: -50 }),
      ]);
      const dbVarashtaFallback = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db: dbVarashtaFallback,
        allocatedNodes: [mkNode('Instruments of Power', [], 'Disciple of Varashta', 1)],
      });
      expect(dbVarashtaFallback.sum('INC', 'EffectOfBonusesFromFocus')).toBe(-50);

      const dbVarashtaParsed = new ModDB();
      const instNode = mkNode(
        'Instruments of Power',
        ['50% reduced bonuses gained from Equipped Focus'],
        'Disciple of Varashta',
        1,
      );
      dbVarashtaParsed.addMods(parseModLines(instNode.stats, 'Passive: Instruments of Power'));
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db: dbVarashtaParsed,
        allocatedNodes: [instNode],
      });
      expect(dbVarashtaParsed.sum('INC', 'EffectOfBonusesFromFocus')).toBe(-50);
    });

    it("Infernalist: Beidat's Hand, Will, Gaze & Altered Flesh", () => {
      const db = new ModDB();
      const nodes = [
        mkNode("Beidat's Hand", [], 'Infernalist', 1),
        mkNode("Beidat's Will", [], 'Infernalist', 2),
        mkNode("Beidat's Gaze", [], 'Infernalist', 3),
        mkNode('Altered Flesh', [], 'Infernalist', 4),
      ];

      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.sum('BASE', 'ColdTakenAsFire')).toBe(20);
      expect(db.sum('BASE', 'LightningTakenAsFire')).toBe(20);
      expect(db.sum('BASE', 'PhysTakenAsChaos')).toBe(20);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 100,
        dex: 50,
        int: 200,
        maxLife: 2000,
        maxMana: 1000,
      });
      expect(db.sum('BASE', 'Mana')).toBe(250); // 2000 / 8
      expect(db.sum('BASE', 'Spirit')).toBe(80); // 2000 / 25
      expect(db.sum('BASE', 'EnergyShield')).toBe(250); // 2000 / 8
      expect(db.sum('BASE', 'LifeReservedPct')).toBe(75); // 25% * 3

      // Verify PoE 2 0.5 explicit stat wording on Beidat's Hand (ES/8) & Beidat's Gaze (Mana/6)
      const db05 = new ModDB();
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db: db05,
        allocatedNodes: [
          mkNode("Beidat's Hand", ['Reserves 25% of Life', '+1 to Maximum Energy Shield per 8 Maximum Life'], 'Infernalist', 1),
          mkNode("Beidat's Gaze", ['Reserves 25% of Life', '+1 to Maximum Mana per 6 Maximum Life'], 'Infernalist', 2),
        ],
        str: 100,
        dex: 50,
        int: 200,
        maxLife: 2400,
        maxMana: 1000,
      });
      expect(db05.sum('BASE', 'EnergyShield')).toBe(300); // 2400 / 8
      expect(db05.sum('BASE', 'Mana')).toBe(400); // 2400 / 6
    });

    it('Deadeye (PoE 2): Gathering Winds, Point Blank & Endless Munitions', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Gathering Winds', [], 'Deadeye', 1),
        mkNode('Point Blank', [], 'Deadeye', 2),
        mkNode('Endless Munitions', [], 'Deadeye', 3),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });

      expect(db.flag('HasTailwind')).toBe(true);
      expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(20);
      expect(db.sum('INC', 'Speed', ModFlag.Cast)).toBe(20);
      expect(db.sum('INC', 'DeflectEffect')).toBe(10);
      expect(db.sum('INC', 'MovementSpeed')).toBe(10);
      expect(db.sum('INC', 'Evasion')).toBe(100);
      expect(db.flag('PointBlank')).toBe(true);
      expect(db.sum('BASE', 'ProjectileCount')).toBe(1);
    });

    it('Stormweaver (PoE 2): Force of Will & Constant Gale', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Force of Will', [], 'Stormweaver', 1),
        mkNode('Constant Gale', [], 'Stormweaver', 2),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.flag('HasArcaneSurge')).toBe(true);
      expect(db.getEvalContext().conditions.AffectedByArcaneSurge).toBe(true);
      expect(db.sum('INC', 'Speed', ModFlag.Spell)).toBe(15);
      expect(db.sum('INC', 'ManaRegen')).toBe(20);
      expect(db.sum('BASE', 'DamageTakenFromManaBeforeLife')).toBe(20);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 60,
        dex: 80,
        int: 340,
        maxLife: 1400,
        maxMana: 3402,
      });
      expect(db.sum('INC', 'ArcaneSurgeEffect')).toBe(226); // Math.floor(3402 / 15)

      // PoE 2 v0.3-v0.5 reworked Force of Will ("per ten percent missing Mana") must NOT add max-Mana ArcaneSurgeEffect
      const db05 = new ModDB();
      const nodes05 = [
        mkNode(
          'Force of Will',
          [
            '20% of Damage is taken from Mana before Life',
            '20% increased Effect of Arcane Surge on you per ten percent missing Mana',
          ],
          'Stormweaver',
          1,
        ),
      ];
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db: db05,
        allocatedNodes: nodes05,
        str: 60,
        dex: 80,
        int: 340,
        maxLife: 1400,
        maxMana: 3402,
      });
      expect(db05.sum('INC', 'ArcaneSurgeEffect')).toBe(0);
    });

    it('Lich (PoE 2): Soulless Form & Eldritch Empowerment (condition-gated)', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Soulless Form', [], 'Lich', 1),
        mkNode('Eldritch Empowerment', [], 'Lich', 2),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.flag('NoInherentManaRegen')).toBe(true);
      expect(db.sum('BASE', 'DamageBypassEs')).toBe(10);
      expect(db.flag('EldritchEmpowerment')).toBe(true);
      // Gated by Condition:EldritchEmpowermentSacrifice (PoB 2 ModParser.lua:3191-3194)
      expect(db.more('Damage', ModFlag.Spell)).toBeCloseTo(1.0, 5);
      db.setCondition('EldritchEmpowermentSacrifice', true);
      expect(db.more('Damage', ModFlag.Spell)).toBeCloseTo(1.3, 5);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 80,
        dex: 60,
        int: 300,
        maxLife: 2500,
        maxMana: 1200,
      });
      expect(db.sum('BASE', 'ManaRegen')).toBe(150); // 6% of 2500
    });

    it('Gemling Legionnaire (PoE 2): Enhanced Effectiveness, Gem Studded & Integrated Efficiency', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Enhanced Effectiveness', [], 'Gemling Legionnaire', 1),
        mkNode('Gem Studded', [], 'Gemling Legionnaire', 2),
        mkNode('Integrated Efficiency', [], 'Gemling Legionnaire', 3),
      ];
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        mainSkillSupportColors: { red: 3, green: 1, blue: 1 },
      });

      expect(db.flag('DoubleAttributeBonuses')).toBe(true);
      expect(db.flag('NoExtraDamageFromCrits')).toBe(true); // Red most numerous
      expect(db.sum('INC', 'Damage')).toBe(60); // 3 red * 20%
      expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(6); // 1 green * 6%
      expect(db.sum('INC', 'CritChance')).toBe(20); // 1 blue * 20%

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 400,
        dex: 200,
        int: 300,
        maxLife: 3000,
        maxMana: 1500,
      });
      expect(db.sum('BASE', 'Life')).toBe(800); // Extra +2 Life/Str -> total 4/Str
      expect(db.sum('BASE', 'Accuracy')).toBe(1000); // Extra +5 Acc/Dex -> total 10/Dex
      expect(db.sum('BASE', 'Mana')).toBe(600); // Extra +2 Mana/Int -> total 4/Int
    });

    it('Gemling Legionnaire (PoE 2): Advanced Thaumaturgy, Adaptive Capability, Crystalline Potential & Thaumaturgical Infusion', () => {
      const db = new ModDB();
      db.setMultiplier('StrengthMoteSkillCount', 6);
      db.setMultiplier('DexterityMoteSkillCount', 4);
      db.setMultiplier('IntelligenceMoteSkillCount', 9);
      const nodes = [
        mkNode('Advanced Thaumaturgy', [], 'Gemling Legionnaire', 1),
        mkNode('Adaptive Capability', [], 'Gemling Legionnaire', 2),
        mkNode('Crystalline Potential', [], 'Gemling Legionnaire', 3),
        mkNode('Thaumaturgical Infusion', [], 'Gemling Legionnaire', 4),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.flag('GemlingQuality')).toBe(true);
      expect(db.flag('GemAttributeRequirementsSatisfiedByHighestAttribute')).toBe(true);
      expect(db.sum('BASE', 'GemQuality:all')).toBe(10);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        str: 200,
        dex: 200,
        int: 200,
        maxLife: 2000,
        maxMana: 1000,
      });
      expect(db.sum('BASE', 'FireResistMax')).toBe(2); // floor(6/3)
      expect(db.sum('BASE', 'LightningResistMax')).toBe(1); // floor(4/3)
      expect(db.sum('BASE', 'ColdResistMax')).toBe(3); // floor(9/3)
    });

    it('Phrecia Alternate Ascendancies (PoE 1): Aristocrat, Paladin & Whisperer', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Illicit Gains', [], 'Aristocrat', 1),
        mkNode('Private Tuition', [], 'Aristocrat', 2),
        mkNode('Fancy Foil', [], 'Aristocrat', 3),
        mkNode('Dreadful Attitude', [], 'Aristocrat', 4),
        mkNode('Light of Divinity', [], 'Paladin', 5),
        mkNode('Bring the Battle', [], 'Paladin', 6),
        mkNode('Field Medicine', [], 'Paladin', 7),
        mkNode('there is more', [], 'Whisperer', 8),
        mkNode('an infinite pursuit', [], 'Whisperer', 9),
        mkNode('we know all', [], 'Whisperer', 10),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe1', db, allocatedNodes: nodes });
      expect(db.sum('INC', 'Str')).toBe(40);
      expect(db.sum('INC', 'Int')).toBe(40);
      expect(db.sum('INC', 'Dex')).toBe(40);
      expect(db.sum('INC', 'FlaskEffect')).toBe(40);
      expect(db.sum('BASE', 'MinFrenzyCharges')).toBe(4);
      expect(db.sum('BASE', 'MinPowerCharges')).toBe(4);
      expect(db.flag('NoIntManaBonus')).toBe(true);

      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        str: 300,
        dex: 250,
        int: 400,
        maxLife: 4000,
        maxMana: 2000,
      });
      // Dreadful Attitude: floor(min(300,250,400)/5) * 8 = 50 * 8 = 400%
      expect(db.sum('INC', 'Damage')).toBe(400);
      // an infinite pursuit: +1 Mana per Dex = 250
      expect(db.sum('BASE', 'Mana')).toBe(250);
      // we know all: 6% of 2000 maxMana = 120 added Lightning Damage to Attacks
      expect(db.sum('BASE', 'LightningMin', ModFlag.Attack)).toBe(120);
      expect(db.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(120);
    });

    it('Amazon (PoE 2): Critical Strike & Predatory Instinct', () => {
      const dbOff = new ModDB();
      const nodes = [
        mkNode('Critical Strike', [], 'Amazon', 1),
        mkNode('Predatory Instinct', [], 'Amazon', 2),
      ];
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db: dbOff,
        allocatedNodes: nodes,
        config: { enemyIsBoss: 'Pinnacle' },
      });
      // Predatory Instinct defaults OFF unless conditionEnemyOpenWeakness is explicitly enabled
      expect(dbOff.more('Damage')).toBe(1);

      const db = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        config: { enemyIsBoss: 'Pinnacle', rawInputs: { conditionEnemyOpenWeakness: true } },
      });
      expect(db.flag('ExcessAccuracyToCrit', ModFlag.Attack)).toBe(true);
      expect(db.more('Damage')).toBeCloseTo(1.5, 5);

      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        config: { enemyEvasion: 500 },
        str: 100,
        dex: 300,
        int: 80,
        maxLife: 2000,
        maxMana: 600,
        accuracy: 3000,
      });
      // rawHitChance = round((3000 * 1.25) / (3000 + 150) * 100) = 119 -> excess = 19 -> * 0.25 = 4.75%
      expect(db.sum('BASE', 'BaseCritChance', ModFlag.Attack)).toBeCloseTo(4.75, 2);

      // Blinded enemy has 20% less Evasion (enemyEvasion 1000 -> 800)
      const dbBlinded = new ModDB();
      applyPostLifeAscendancyMechanics({
        game: 'poe2',
        db: dbBlinded,
        allocatedNodes: nodes,
        config: { enemyEvasion: 1000, rawInputs: { conditionEnemyBlinded: true } },
        str: 100,
        dex: 300,
        int: 80,
        maxLife: 2000,
        maxMana: 600,
        accuracy: 3000,
      });
      // rawHitChance = round((3000 * 1.25) / (3000 + 800 * 0.3) * 100) = round(115.74) = 116 -> excess = 16 -> 4.00%
      expect(dbBlinded.sum('BASE', 'BaseCritChance', ModFlag.Attack)).toBeCloseTo(4.0, 2);
    });

    it('Ritualist (PoE 2): Unfurled Finger & Mystic Attunement', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Unfurled Finger', [], 'Ritualist', 1),
        mkNode('Mystic Attunement', [], 'Ritualist', 2),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.sum('BASE', 'ExtraRingSlot')).toBe(1);
      expect(db.flag('HasExtraRingSlot')).toBe(true);
      expect(db.sum('INC', 'RingEffect')).toBe(25);
      expect(db.sum('INC', 'AmuletEffect')).toBe(25);
    });
  });

  describe('PoE 1 Ascendancies', () => {
    it("Chieftain: Valako syncs max resists to 90/90/90, Tasalio mirrors 50% Fire Res, Ramako sets -20% DoT Fire Res", () => {
      const db = new ModDB();
      // Base max resists (75) + +15% Fire Max Res -> 90 Fire Max
      db.addMod({ name: 'FireResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });
      db.addMod({ name: 'ColdResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });
      db.addMod({ name: 'LightningResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });
      db.addMod({ name: 'FireResistMax', type: 'BASE', value: 15, flags: 0, keywordFlags: 0, source: 'Purity of Fire + Tree' });

      // Campaign penalty (-60), all-ele (+15), Fire-only (+200)
      for (const res of ['FireResist', 'ColdResist', 'LightningResist']) {
        db.addMod({ name: res, type: 'BASE', value: -60, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
        db.addMod({ name: res, type: 'BASE', value: 15, flags: 0, keywordFlags: 0, source: 'Bandit: Alira' });
      }
      db.addMod({ name: 'FireResist', type: 'BASE', value: 200, flags: 0, keywordFlags: 0, source: 'Gear Fire Res' });

      const nodes = [
        mkNode("Valako, Storm's Embrace", [], 'Chieftain', 1),
        mkNode('Tasalio, Cleansing Water', [], 'Chieftain', 2),
        mkNode("Ramako, Sun's Light", [], 'Chieftain', 3),
      ];

      applyPreStatAscendancyMechanics({ game: 'poe1', db, allocatedNodes: nodes });
      expect(db.override('EnemyFireResistDotOverride')).toBe(-20);

      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        str: 271,
        dex: 159,
        int: 204,
        maxLife: 5500,
        maxMana: 800,
      });

      // Valako: 90/90/90 max resists
      expect(db.sum('BASE', 'FireResistMax')).toBe(90);
      expect(db.sum('BASE', 'ColdResistMax')).toBe(90);
      expect(db.sum('BASE', 'LightningResistMax')).toBe(90);

      // Tasalio: -60 + 15 + 100 (50% of 200 Fire-only) = +55 Cold & Lightning (all-ele +15 NOT double-counted)
      expect(db.sum('BASE', 'ColdResist')).toBe(55);
      expect(db.sum('BASE', 'LightningResist')).toBe(55);
    });

    it('Juggernaut: Undeniable at 1993 Str (+3986 Acc & Acc/150 Attack Speed), Unbreakable & Untiring', () => {
      const db = new ModDB();
      db.addMod({ name: 'Accuracy', type: 'BASE', value: 600, flags: 0, keywordFlags: 0, source: 'Level + Dex' });
      const nodes = [
        mkNode('Undeniable', [], 'Juggernaut', 1),
        mkNode('Unbreakable', [], 'Juggernaut', 2),
        mkNode('Untiring', [], 'Juggernaut', 3),
      ];

      applyPreStatAscendancyMechanics({ game: 'poe1', db, allocatedNodes: nodes });
      expect(db.sum('BASE', 'Accuracy')).toBe(1100); // 600 + 500
      expect(db.flag('BodyArmourDoubled')).toBe(true);
      expect(db.sum('BASE', 'ArmourAppliesToChaos')).toBe(15);
      expect(db.sum('INC', 'LifeRegenRate')).toBe(40);

      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        str: 1993,
        dex: 240,
        int: 505,
        maxLife: 5514,
        maxMana: 844,
      });
      // Accuracy = 600 + 500 + 1993 * 2 = 5086; Attack Speed INC = Math.floor(5086 / 150) = 33%
      expect(db.sum('BASE', 'Accuracy')).toBe(5086);
      expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(33);
    });

    it('Slayer: Masterful Form charge cap sync, Overwhelm 8% base crit, Bane of Legends & Headsman', () => {
      const db = new ModDB();
      db.addMod({ name: 'MaxFrenzyCharges', type: 'BASE', value: 4, flags: 0, keywordFlags: 0, source: 'Tree + Gear' }); // 3 + 4 = 7
      const nodes = [
        mkNode('Masterful Form', [], 'Slayer', 1),
        mkNode('Overwhelm', [], 'Slayer', 2),
        mkNode('Bane of Legends', [], 'Slayer', 3),
        mkNode('Headsman', [], 'Slayer', 4),
      ];

      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        config: { enemyIsBoss: 'Pinnacle' },
      });
      expect(db.override('WeaponBaseCritChance', ModFlag.Attack)).toBe(8);
      // PoE 1 3.25+: Bane of Legends grants 20% MORE vs Unique; Headsman only grants 20% Culling Strike (no 20% MORE)
      expect(db.more('Damage')).toBeCloseTo(1.2, 5);
      expect(db.sum('BASE', 'CullingStrikeThreshold')).toBe(20);

      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        str: 150,
        dex: 200,
        int: 100,
        maxLife: 3800,
        maxMana: 700,
      });
      // 3 base + 4 added = 7 Max Endurance Charges matching 7 Max Frenzy Charges
      expect(3 + db.sum('BASE', 'MaxEnduranceCharges')).toBe(7);
    });

    it('Assassin: Opportunistic, For the Jugular, Unstable Infusion & Deadly Infusion', () => {
      const db = new ModDB();
      db.addMod({ name: 'MaxPowerCharges', type: 'BASE', value: 4, flags: 0, keywordFlags: 0, source: 'Tree + Gear' });
      const nodes = [
        mkNode('Opportunistic', [], 'Assassin', 1),
        mkNode('For the Jugular', [], 'Assassin', 2),
        mkNode('Unstable Infusion', [], 'Assassin', 3),
        mkNode('Deadly Infusion', [], 'Assassin', 4),
      ];

      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        config: { conditionLowLife: false },
      });
      expect(db.more('Damage')).toBeCloseTo(1, 5);
      db.setCondition('EnemyRareOrUnique', true);
      expect(db.more('Damage')).toBeCloseTo(1.25, 5);
      expect(db.sum('BASE', 'CritMultiplier')).toBe(100);
      expect(3 + db.sum('BASE', 'MaxPowerCharges')).toBe(8); // 3 base + 4 + 1 Unstable Infusion

      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        str: 100,
        dex: 200,
        int: 250,
        maxLife: 3600,
        maxMana: 900,
        activePowerCharges: 8,
      });
      // +100 (For the Jugular) + 8*5 (Deadly Infusion) = 140; at max Power Charges -> +1.5% Base Crit
      expect(db.sum('BASE', 'CritMultiplier')).toBe(140);
      expect(db.sum('BASE', 'BaseCritChance')).toBe(1.5);

      // Deduplicate For the Jugular when passive tree stats already parsed +100% CritMultiplier
      const dbDedup = new ModDB();
      const ftjStats = [
        '+100% to Critical Strike Multiplier against Enemies that are not on Low Life',
        '100% more Critical Strike Chance against Enemies that are on Low Life',
        'Critical Strikes have Culling Strike',
      ];
      for (const s of ftjStats) {
        dbDedup.addMods(parseModLine(s, 'Tree: For the Jugular'));
      }
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbDedup,
        allocatedNodes: [mkNode('For the Jugular', ftjStats, 'Assassin', 2)],
        config: { rawInputs: {} },
      });
      // Must be 100 (not double-counted 200!) when EnemyLowLife is false
      expect(dbDedup.sum('BASE', 'CritMultiplier')).toBe(100);
      expect(dbDedup.more('CritChance')).toBeCloseTo(1, 5);
      // When EnemyLowLife is true, CritMultiplier drops to 0 and CritChance gets 100% MORE
      dbDedup.setCondition('EnemyLowLife', true);
      expect(dbDedup.sum('BASE', 'CritMultiplier')).toBe(0);
      expect(dbDedup.more('CritChance')).toBeCloseTo(2, 5);

      // Ascendant Necromancer wrapped "Cast\nSpeed" stat -> Speed INC 2 * AuraAffectingSelf
      const dbAscNecro = new ModDB();
      dbAscNecro.setMultiplier('AuraAffectingSelf', 5);
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbAscNecro,
        allocatedNodes: [
          mkNode(
            'Necromancer',
            ['Auras from your Skills grant 2% increased Attack and Cast\nSpeed to you and Allies'],
            'Ascendant',
            10099,
          ),
        ],
      });
      expect(dbAscNecro.sum('INC', 'Speed', ModFlag.Attack)).toBe(10);
      expect(dbAscNecro.sum('INC', 'Speed', ModFlag.Spell)).toBe(10);

      // Berserker Rite of Ruin dedup + Crave the Slaughter 3.25+ does NOT inject phantom +10 Max Rage
      const dbZerk = new ModDB();
      dbZerk.addMods(parseModLine('50% increased Rage Effect', 'Tree: Rite of Ruin'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbZerk,
        allocatedNodes: [
          mkNode('Rite of Ruin', ['50% increased Rage Effect'], 'Berserker', 57560),
          mkNode('Crave the Slaughter', ['Every Rage also grants 1% increased Attack Speed'], 'Berserker', 24528),
        ],
      });
      expect(dbZerk.sum('INC', 'RageEffect')).toBe(50);
      expect(dbZerk.sum('BASE', 'MaximumRage')).toBe(0);
    });

    it('Elementalist: Shaper of Flames, Mastermind of Discord, Heart of Destruction & Liege of the Primordial', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Shaper of Flames', [], 'Elementalist', 1),
        mkNode('Mastermind of Discord', [], 'Elementalist', 2),
        mkNode('Heart of Destruction', [], 'Elementalist', 3),
        mkNode('Liege of the Primordial', [], 'Elementalist', 4),
      ];

      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        config: { enemyIsBoss: 'Pinnacle' },
        activeGolemCount: 4,
      });
      expect(db.more('IgniteDamage', ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Ignite)).toBeCloseTo(1.25, 5);
      expect(db.sum('BASE', 'IgniteChance')).toBe(100);
      expect(db.sum('BASE', 'ExtraExposure')).toBe(25);
      expect(db.more('ElementalDamage')).toBeCloseTo(1.3, 5);
      expect(db.sum('BASE', 'MaxGolems')).toBe(2);
      expect(db.sum('INC', 'GolemBuffEffect')).toBe(200); // Legacy synthetic fallback: 100 base + 4 * 25

      // PoE 3.28+ / 3.30 Liege of the Primordial: GolemBuffEffect removed (0%)
      const db330 = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: db330,
        allocatedNodes: [
          mkNode(
            'Liege of the Primordial',
            [
              'Summoned Golems are Immune to Elemental Damage',
              'Summoned Golems are Resummoned 4 seconds after being Killed',
              '+2 to maximum number of Summoned Golems',
            ],
            'Elementalist',
            4,
          ),
        ],
        activeGolemCount: 4,
      });
      expect(db330.sum('BASE', 'MaxGolems')).toBe(2);
      expect(db330.sum('INC', 'GolemBuffEffect')).toBe(0);

      // PoE 3.27 Liege of the Primordial: 50% flat GolemBuffEffect, 0% per golem
      const db327 = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: db327,
        allocatedNodes: [
          mkNode(
            'Liege of the Primordial',
            [
              '+2 to maximum number of Summoned Golems',
              '50% increased Effect of Buffs granted by your Golems',
            ],
            'Elementalist',
            4,
          ),
        ],
        activeGolemCount: 4,
      });
      expect(db327.sum('INC', 'GolemBuffEffect')).toBe(50);
    });

    it('Necromancer: Commander of Darkness, Unnatural Strength & Mindless Aggression', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Commander of Darkness', [], 'Necromancer', 1),
        mkNode('Unnatural Strength', [], 'Necromancer', 2),
        mkNode('Mindless Aggression', [], 'Necromancer', 3),
      ];
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db,
        allocatedNodes: nodes,
        activeAuraCount: 4,
      });

      expect(db.sum('BASE', 'FireResist')).toBe(30);
      expect(db.sum('BASE', 'ColdResist')).toBe(30);
      expect(db.sum('BASE', 'LightningResist')).toBe(30);
      expect(db.sum('INC', 'Damage')).toBe(30);
      expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(12); // 4 auras * 3%
      expect(db.sum('INC', 'Speed', ModFlag.Spell)).toBe(12);
      expect(db.sum('BASE', 'GemLevel:minion')).toBe(2);
      expect(db.flag('MinionUnholyMight')).toBe(true);
      expect(db.sum('BASE', 'PhysicalDamageConvertToChaos')).toBe(100);
      expect(db.more('MinionDamage')).toBeCloseTo(1.1, 5);
      expect(db.more('MinionLife')).toBeCloseTo(1.2, 5);

      // PoE 1 Deadeye Endless Munitions (+2 ProjectileCount, deduplicated if already parsed from tree)
      const dbEm = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbEm,
        allocatedNodes: [mkNode('Endless Munitions', ['Skills fire 2 additional Projectiles'], 'Deadeye', 9)],
      });
      expect(dbEm.sum('BASE', 'ProjectileCount')).toBe(2);
      // Deduplicate when tree already parsed it
      const dbEmDup = new ModDB();
      dbEmDup.addMods(parseModLine('Skills fire 2 additional Projectiles', 'Tree: Endless Munitions'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbEmDup,
        allocatedNodes: [mkNode('Endless Munitions', ['Skills fire 2 additional Projectiles'], 'Deadeye', 9)],
      });
      expect(dbEmDup.sum('BASE', 'ProjectileCount')).toBe(2);
    });

    it('Deadeye (PoE 1), Champion, Inquisitor, Trickster, Gladiator & Pathfinder', () => {
      // Deadeye (PoE 1): Gathering Winds emits Condition:Tailwind + base ActionSpeed without double-counting Speed MORE
      const dbDeadeye = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbDeadeye,
        allocatedNodes: [mkNode('Gathering Winds', [], 'Deadeye', 1), mkNode('Far Shot', [], 'Deadeye', 2)],
      });
      expect(dbDeadeye.flag('HasTailwind')).toBe(true);
      expect(dbDeadeye.flag('Condition:Tailwind')).toBe(true);
      expect(dbDeadeye.sum('INC', 'ActionSpeed')).toBe(8);
      expect(dbDeadeye.more('Speed', ModFlag.Attack)).toBeCloseTo(1.0, 5);
      expect(dbDeadeye.more('Damage', ModFlag.Projectile)).toBeCloseTo(1.3, 5);

      // Champion
      const dbChamp = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbChamp,
        allocatedNodes: [mkNode('Fortitude', [], 'Champion', 1), mkNode('Inspirational', [], 'Champion', 2)],
      });
      expect(dbChamp.sum('BASE', 'Fortification')).toBe(20);
      expect(dbChamp.flag('AlwaysFortified')).toBe(true);
      expect(dbChamp.sum('INC', 'AuraEffect')).toBe(30);

      // Inquisitor
      const dbInq = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbInq,
        allocatedNodes: [
          mkNode('Inevitable Judgement', [], 'Inquisitor', 1),
          mkNode('Pious Path', [], 'Inquisitor', 2),
          mkNode('Augury of Penitence', [], 'Inquisitor', 3),
        ],
      });
      expect(dbInq.flag('CritIgnoresEleRes')).toBe(true);
      expect(dbInq.flag('ConsecratedGroundEsRegen')).toBe(true);
      expect(dbInq.sum('INC', 'EnemyElementalDamageTaken')).toBe(16);

      // Trickster
      const dbTrick = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbTrick,
        allocatedNodes: [
          mkNode('One Step Ahead', [], 'Trickster', 1),
          mkNode('Polymath', [], 'Trickster', 2),
          mkNode('Spellbreaker', [], 'Trickster', 3),
        ],
        masteryCount: 7,
      });
      expect(dbTrick.sum('INC', 'ActionSpeed')).toBe(8);
      expect(dbTrick.more('Damage')).toBeCloseTo(1.21, 5); // 7 * 3% = 21% more
      expect(dbTrick.sum('BASE', 'SpellSuppressionChance')).toBe(20);

      // Gladiator
      const dbGlad = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbGlad,
        allocatedNodes: [
          mkNode('More Than Skill', [], 'Gladiator', 1),
          mkNode('Jagged Technique', [], 'Gladiator', 2),
        ],
      });
      expect(dbGlad.flag('BlockChanceIsLucky')).toBe(true);
      expect(dbGlad.flag('AggravatedBleeding')).toBe(true);
      // AggravatedBleeding drives the 3x (210% vs 70%) bleed rate in skillActorRuntime without double-counting MORE 100
      expect(dbGlad.more('Damage', ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Bleed)).toBeCloseTo(1.0, 5);

      // Pathfinder
      const dbPf = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbPf,
        allocatedNodes: [
          mkNode("Nature's Boon", [], 'Pathfinder', 1),
          mkNode('Master Toxicist', [], 'Pathfinder', 2),
        ],
      });
      expect(dbPf.sum('INC', 'FlaskEffect')).toBe(30);
      expect(dbPf.flag('PoisonProliferation')).toBe(true);
      expect(dbPf.more('Damage', ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Poison)).toBeCloseTo(1.2, 5);
    });

    it('exports complete metadata registry covering all 62 PoE 1 & PoE 2 ascendancy notables', () => {
      const poe1Count = SUPPORTED_ASCENDANCY_NOTABLES.filter((n) => n.game === 'poe1').length;
      const poe2Count = SUPPORTED_ASCENDANCY_NOTABLES.filter((n) => n.game === 'poe2').length;
      expect(poe1Count).toBe(35);
      expect(poe2Count).toBe(27);
      expect(SUPPORTED_ASCENDANCY_NOTABLES.length).toBe(62);
    });

    it('deduplicates Juggernaut Undeniable IAS, Inquisitor Augury of Penitence, and Assassin Deadly Infusion when node stats are parsed', () => {
      // Undeniable with parsed tree stats (PerStat:Accuracy) must NOT double-count Attack Speed
      const dbJug = new ModDB();
      dbJug.addMod({ name: 'Accuracy', type: 'BASE', value: 1500, flags: 0, keywordFlags: 0, source: 'Base' });
      const undeniableNode = mkNode(
        'Undeniable',
        ['+500 to Accuracy Rating', '1% increased Attack Speed per 150 Accuracy Rating', 'Gain Accuracy Rating equal to twice your Strength'],
        'Juggernaut',
        44297,
      );
      dbJug.addMods(parseModLines(undeniableNode.stats, 'Passive: Undeniable'));
      applyPreStatAscendancyMechanics({ game: 'poe1', db: dbJug, allocatedNodes: [undeniableNode] });
      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db: dbJug,
        allocatedNodes: [undeniableNode],
        str: 500,
        dex: 100,
        int: 100,
        maxLife: 4000,
        maxMana: 600,
        accuracy: 2000,
      });
      // Accuracy = 1500 + 500 + 1000 = 3000; once stats.Accuracy = 3000 is populated, PerStat gives exactly 20% (not 40%)
      dbJug.setStat('Accuracy', Math.round(dbJug.calcStat('Accuracy').total));
      expect(dbJug.sum('BASE', 'Accuracy')).toBe(3000);
      expect(dbJug.sum('INC', 'Speed', ModFlag.Attack)).toBe(20);

      // Augury of Penitence parsed from tree must NOT double-count 16% -> 32%
      const dbInq = new ModDB();
      const auguryNode = mkNode(
        'Augury of Penitence',
        ['Nearby Enemies take 16% increased Elemental Damage', 'Nearby Enemies deal 8% less Elemental Damage'],
        'Inquisitor',
        40059,
      );
      dbInq.addMods(parseModLines(auguryNode.stats, 'Passive: Augury of Penitence'));
      applyPreStatAscendancyMechanics({ game: 'poe1', db: dbInq, allocatedNodes: [auguryNode] });
      expect(dbInq.sum('INC', 'EnemyElementalDamageTaken')).toBe(16);

      // Assassin Deadly Infusion parsed from tree must NOT double-count +5% CritMulti per Power Charge
      const dbAss = new ModDB();
      const deadlyNode = mkNode(
        'Deadly Infusion',
        ['+5% to Critical Strike Multiplier per Power Charge', '+1.5% Critical Strike Chance while at maximum Power Charges'],
        'Assassin',
        10,
      );
      dbAss.addMods(parseModLines(deadlyNode.stats, 'Passive: Deadly Infusion'));
      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db: dbAss,
        allocatedNodes: [deadlyNode],
        str: 100,
        dex: 200,
        int: 200,
        maxLife: 3500,
        maxMana: 700,
        maxPowerCharges: 6,
        activePowerCharges: 6,
      });
      expect(dbAss.sum('BASE', 'CritMultiPerPowerCharge')).toBe(5);
      expect(dbAss.sum('BASE', 'CritMultiplier')).toBe(0);
      expect(dbAss.sum('BASE', 'BaseCritChance')).toBe(1.5);
    });

    it('emits Deadeye Far Shot flag (delegating distance ramp to engine.ts) and Focal Point MarkEffect', () => {
      const farShot = mkNode(
        'Far Shot',
        ['Projectiles gain Damage as they travel farther, dealing up\nto 30% more Damage with Hits and Ailments'],
        'Deadeye',
        45313,
      );
      const focalPoint = mkNode('Focal Point', ['75% increased Effect of your Marks'], 'Deadeye', 5443);

      const db50 = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: db50,
        allocatedNodes: [farShot, focalPoint],
        config: { rawInputs: { projectileDistance: 50 } },
      });
      expect(db50.flag('FarShot')).toBe(true);
      // With BuildConfig present, engine.ts evaluates the PoB 1 Far Shot ramp via FarShot flag (zero double-count)
      expect(db50.more('Damage', ModFlag.Projectile)).toBe(1);
      expect(db50.sum('INC', 'MarkEffect')).toBe(75);

      // Focal Point deduplicates when node stats are already parsed into db
      const dbFocalParsed = new ModDB();
      dbFocalParsed.addMods(parseModLines(focalPoint.stats, 'Passive: Focal Point'));
      applyPreStatAscendancyMechanics({ game: 'poe1', db: dbFocalParsed, allocatedNodes: [focalPoint] });
      expect(dbFocalParsed.sum('INC', 'MarkEffect')).toBe(75);

      // Trickster One Step Ahead emits OneStepAhead flag (without double-counting ActionSpeed when config present)
      const dbOsa = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbOsa,
        allocatedNodes: [mkNode('One Step Ahead', ['Your Action Speed is at least 105% of base value'], 'Trickster', 23225)],
        config: { rawInputs: {} },
      });
      expect(dbOsa.flag('OneStepAhead')).toBe(true);
      expect(dbOsa.sum('INC', 'ActionSpeed')).toBe(0);

      // Assassin Opportunistic deduplicates with parsed tree stat & Toxic Delivery emits cap from wrapped stat
      const dbAss2 = new ModDB();
      const oppNode = mkNode(
        'Opportunistic',
        ['25% more Damage while there is at most one Rare or Unique Enemy within 6 metres'],
        'Assassin',
        19083,
      );
      const tdNode = mkNode(
        'Toxic Delivery',
        ['5% increased Poison Duration for each Poison you have inflicted Recently, up\nto a maximum of 100%'],
        'Assassin',
        19598,
      );
      dbAss2.addMods(parseModLines(oppNode.stats, 'Tree: Opportunistic'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbAss2,
        allocatedNodes: [oppNode, tdNode],
        config: { rawInputs: {} },
      });
      dbAss2.setCondition('EnemyRareOrUnique', true);
      expect(dbAss2.more('Damage')).toBeCloseTo(1.25, 5);
      expect(dbAss2.sum('BASE', 'ToxicDeliveryPoisonDurCap')).toBe(100);
    });

    it('handles Hierophant Ritual of Awakening, Arcane Blessing, Warden Avatar of the Wilds, and Champion Adrenaline / Celestial Brace', () => {
      // Hierophant Ritual of Awakening + Arcane Blessing
      const dbHiero = new ModDB();
      const ritualNode = mkNode('Ritual of Awakening', ['3% more Damage per Summoned Totem'], 'Hierophant', 34434);
      const blessingNode = mkNode(
        'Arcane Blessing',
        ['Arcane Surge also grants 20% more Spell Damage to you'],
        'Hierophant',
        40510,
      );
      const pursuitNode = mkNode('Pursuit of Faith', ['+1 to maximum number of Summoned Totems'], 'Hierophant', 1105);
      dbHiero.addMods(parseModLines(ritualNode.stats, 'Passive: Ritual of Awakening'));
      dbHiero.addMods(parseModLines(blessingNode.stats, 'Passive: Arcane Blessing'));
      dbHiero.addMods(parseModLines(pursuitNode.stats, 'Passive: Pursuit of Faith'));
      applyPreStatAscendancyMechanics({ game: 'poe1', db: dbHiero, allocatedNodes: [ritualNode, blessingNode, pursuitNode] });
      dbHiero.setMultiplier('SummonedTotem', 5);
      // 3% * 5 = 15% MORE
      expect(dbHiero.more('Damage')).toBeCloseTo(1.15, 5);
      expect(dbHiero.max('ArcaneSurgeDamage')).toBe(20);
      expect(dbHiero.flag('Condition:ArcaneSurge')).toBe(true);
      expect(dbHiero.sum('BASE', 'ActiveTotemLimit')).toBe(1);

      // Standalone Arcane Blessing (unparsed tree stats) emits ArcaneSurgeDamage BASE 20 + Condition:ArcaneSurge
      const dbHieroRaw = new ModDB();
      applyPreStatAscendancyMechanics({ game: 'poe1', db: dbHieroRaw, allocatedNodes: [blessingNode] });
      expect(dbHieroRaw.sum('BASE', 'ArcaneSurgeDamage')).toBe(20);
      expect(dbHieroRaw.flag('Condition:ArcaneSurge')).toBe(true);

      // Warden Avatar of the Wilds (Unbound Avatar) — active vs inactive
      const avatarNode = mkNode(
        'Avatar of the Wilds',
        ['Grants Level 20 Unbound Avatar', '100% more Elemental Damage while Unbound'],
        'Raider',
        55509,
      );
      const dbWardenOn = new ModDB();
      dbWardenOn.addMods(parseModLines(avatarNode.stats, 'Passive: Avatar of the Wilds'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbWardenOn,
        allocatedNodes: [avatarNode],
        config: { rawInputs: { Unbound: true } },
      });
      expect(dbWardenOn.more('ElementalDamage')).toBeCloseTo(2.0, 5);

      const dbWardenOff = new ModDB();
      dbWardenOff.addMods(parseModLines(avatarNode.stats, 'Passive: Avatar of the Wilds'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbWardenOff,
        allocatedNodes: [avatarNode],
        config: { rawInputs: {} },
      });
      expect(dbWardenOff.more('ElementalDamage')).toBe(1);

      // Champion First to Strike + Fortitude + The Celestial Brace
      const dbChamp = new ModDB();
      dbChamp.addMods(parseModLines(['1% increased Attack Speed per Fortification', '+10 to maximum Fortification'], 'Item: The Celestial Brace'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbChamp,
        allocatedNodes: [
          mkNode('Fortitude', [], 'Champion', 31700),
          mkNode('First to Strike, Last to Fall', [], 'Champion', 27604),
        ],
        config: { rawInputs: { conditionAdrenaline: true } },
      });
      dbChamp.setMultiplier('Fortification', 30);
      expect(dbChamp.sum('BASE', 'MaxFortification')).toBe(10);
      expect(dbChamp.sum('INC', 'Damage')).toBe(100);
      expect(dbChamp.sum('INC', 'Speed', ModFlag.Attack)).toBe(55); // 25 Adrenaline + 30 Celestial Brace
    });

    it('parses PoE 1 high-impact modParser rules (BifurcateCrit, Ryslatha, Echoes, ExertIncrease, Socketed Gems, Cull, Yoke, Consecrated Ground, MarkEffect)', () => {
      expect(parseModLine('Spell Critical Strike Chance Bifurcates', 'tree')).toEqual([
        expect.objectContaining({ name: 'BifurcateCrit', type: 'FLAG', value: true, flags: ModFlag.Spell }),
      ]);
      expect(parseModLine('Critical Strike Chance Bifurcates', 'item')).toEqual([
        expect.objectContaining({ name: 'BifurcateCrit', type: 'FLAG', value: true, flags: 0 }),
      ]);
      expect(parseModLine('40% more Maximum Physical Attack Damage', 'item')).toEqual([
        expect.objectContaining({ name: 'PhysicalMaxDamage', type: 'MORE', value: 40, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('30% less Minimum Physical Attack Damage', 'item')).toEqual([
        expect.objectContaining({ name: 'PhysicalMinDamage', type: 'MORE', value: -30, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('25% more Maximum Physical Damage', 'item')).toEqual([
        expect.objectContaining({ name: 'PhysicalMaxDamage', type: 'MORE', value: 25, flags: 0 }),
      ]);
      expect(parseModLine('Skills deal 15% more Damage for each Warcry Exerting them', 'item')).toEqual([
        expect.objectContaining({ name: 'EchoesExertAverageIncrease', type: 'MORE', value: 15, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('Exerted Attacks deal 35% increased Damage', 'tree')).toEqual([
        expect.objectContaining({ name: 'ExertIncrease', type: 'INC', value: 35, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('Socketed Gems deal 30% more Elemental Damage', 'item')).toEqual([
        expect.objectContaining({
          name: 'ElementalDamage',
          type: 'MORE',
          value: 30,
          tags: [{ type: 'SocketedIn' }],
        }),
      ]);
      expect(parseModLine('Socketed Gems deal 30% more Damage over Time', 'item')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'MORE',
          value: 30,
          flags: ModFlag.Dot,
          tags: [{ type: 'SocketedIn' }],
        }),
      ]);
      expect(parseModLine('Kill Enemies that have 15% or lower Life', 'item')).toEqual([
        expect.objectContaining({ name: 'CullPercent', type: 'MAX', value: 15 }),
      ]);
      expect(
        parseModLine('Enemies take 10% increased Damage for each type of Ailment you have inflicted on them', 'item'),
      ).toEqual([
        expect.objectContaining({ name: 'EnemyDamageTakenPerAilmentType', type: 'BASE', value: 10 }),
      ]);
      expect(parseModLine('Enemies on Consecrated Ground you create take 15% increased Damage', 'item')).toEqual([
        expect.objectContaining({ name: 'DamageTakenConsecratedGround', type: 'INC', value: 15, target: 'enemy' }),
      ]);
      expect(parseModLine('Consecrated Ground you create applies 15% increased Damage taken to Enemies', 'tree')).toEqual([
        expect.objectContaining({ name: 'DamageTakenConsecratedGround', type: 'INC', value: 15, target: 'enemy' }),
      ]);
      expect(parseModLine('75% increased Effect of your Marks', 'tree')).toEqual([
        expect.objectContaining({ name: 'MarkEffect', type: 'INC', value: 75 }),
      ]);
      expect(parseModLine('20% increased Effect of your Mark Skills', 'tree')).toEqual([
        expect.objectContaining({ name: 'MarkEffect', type: 'INC', value: 20 }),
      ]);
      expect(parseModLine('50% increased Effect of Arcane Surge on you', 'tree')).toEqual([
        expect.objectContaining({ name: 'ArcaneSurgeEffect', type: 'INC', value: 50 }),
      ]);
      expect(parseModLine('Ignites you inflict with Attacks deal Damage 35% faster', 'item')).toEqual([
        expect.objectContaining({ name: 'IgniteFaster', type: 'INC', value: 35, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('+25% to Damage over Time Multiplier with Melee Weapon Attacks', 'item')).toEqual([
        expect.objectContaining({
          name: 'DotMultiplier',
          type: 'BASE',
          value: 25,
          flags: ModFlag.Attack | ModFlag.Melee,
        }),
      ]);
      expect(parseModLine('60% increased Damage with Ignite from Melee Weapons', 'item')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 60,
          flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Ailment,
          keywordFlags: KeywordFlag.Ignite,
        }),
      ]);
      expect(parseModLine('45% increased Damage with Ailments from Melee Weapons', 'item')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 45,
          flags: ModFlag.Attack | ModFlag.Melee | ModFlag.Ailment,
          keywordFlags: 0,
        }),
      ]);
    });

    it('handles Wave 4O PoE 1 Slayer dedup/Impact, Deadeye/Ascendant Tailwind, Occultist Vile Bastion, and Reliquarian Scales of Justice', () => {
      // 1. Slayer Bane of Legends dedup + Impact proximity MORE + Headsman no phantom MORE
      const dbSlayer = new ModDB();
      const baneNode = mkNode(
        'Bane of Legends',
        ["10% more Damage if you've Killed Recently", '20% more Damage with Hits and Ailments against Unique Enemies'],
        'Slayer',
        62817,
      );
      const impactNode = mkNode(
        'Impact',
        ['Deal up to 15% more Melee Damage to Enemies, based on proximity'],
        'Slayer',
        38180,
      );
      const headsmanNode = mkNode(
        'Headsman',
        ['Kill Enemies that have 20% or lower Life when Hit by your Skills'],
        'Slayer',
        3184,
      );
      dbSlayer.addMods(parseModLines(baneNode.stats, 'Tree: Bane of Legends'));
      dbSlayer.addMods(parseModLines(impactNode.stats, 'Tree: Impact'));
      dbSlayer.addMods(parseModLines(headsmanNode.stats, 'Tree: Headsman'));
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbSlayer,
        allocatedNodes: [baneNode, impactNode, headsmanNode],
        config: { enemyIsBoss: 'Pinnacle' },
      });
      dbSlayer.setCondition('EnemyRareOrUnique', true);
      dbSlayer.setCondition('MeleeProximity', true);
      // Only Impact (1.15) applies on Attack|Melee without Bane double-count or Headsman phantom MORE
      // (Bane tree mod has ModFlag.Hit|ModFlag.Ailment expanded in skillActorRuntime; ascendancyMods must not double-add)
      expect(dbSlayer.more('Damage', ModFlag.Attack | ModFlag.Melee)).toBeCloseTo(1.15, 5);
      expect(dbSlayer.sum('BASE', 'CullingStrikeThreshold')).toBe(20);

      // 2. Deadeye Gathering Winds with config delegates Tailwind to engine.ts (0 direct ActionSpeed); Ascendant Deadeye emits Condition:Tailwind
      const dbDeCfg = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbDeCfg,
        allocatedNodes: [mkNode('Gathering Winds', [], 'Deadeye', 1)],
        config: { buffTailwind: false },
      });
      expect(dbDeCfg.flag('Condition:Tailwind')).toBe(true);
      expect(dbDeCfg.sum('INC', 'ActionSpeed')).toBe(0);

      const dbAscDe = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbAscDe,
        allocatedNodes: [mkNode('Deadeye', ['You and nearby Allies have Tailwind'], 'Ascendant', 34567)],
        config: {},
      });
      expect(dbAscDe.flag('HasTailwind')).toBe(true);
      expect(dbAscDe.flag('Condition:Tailwind')).toBe(true);

      // 3. Occultist Vile Bastion: Maximum Energy Shield increased by capped Spell Block Chance
      const dbOcc = new ModDB();
      dbOcc.addMod({ name: 'SpellBlockChance', type: 'BASE', value: 40, flags: 0, keywordFlags: 0, source: 'Gear' });
      dbOcc.addMod({ name: 'SpellBlockChance', type: 'MORE', value: 100, flags: 0, keywordFlags: 0, source: 'Glancing Blows' });
      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db: dbOcc,
        allocatedNodes: [mkNode('Vile Bastion', ['Maximum Energy Shield is increased by Chance to Block Spell Damage'], 'Occultist', 1)],
        str: 100,
        dex: 100,
        int: 300,
        maxLife: 1,
        maxMana: 1000,
      });
      // 40 * 2 = 80 capped at 75
      expect(dbOcc.sum('INC', 'EnergyShield')).toBe(75);

      // 4. Reliquarian The Scales of Justice: 4 to 8 added Fire Damage per 100 of min(Life, Mana)
      const dbRel = new ModDB();
      applyPostLifeAscendancyMechanics({
        game: 'poe1',
        db: dbRel,
        allocatedNodes: [
          mkNode(
            'The Scales of Justice',
            ['4 to 8 added Fire Damage per 100 of Maximum Life or Maximum Mana, whichever is lower'],
            'Reliquarian',
            1,
          ),
        ],
        str: 100,
        dex: 100,
        int: 200,
        maxLife: 4500,
        maxMana: 3250,
      });
      // floor(3250 / 100) = 32 -> 128 to 256 added Fire
      expect(dbRel.sum('BASE', 'FireMin')).toBe(128);
      expect(dbRel.sum('BASE', 'FireMax')).toBe(256);
    });
  });
});
