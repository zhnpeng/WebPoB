import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag, type Mod, type PassiveNode } from '@webpob/core';
import { ModDB } from './modDb.js';
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
      expect(db.more('Speed', ModFlag.Attack)).toBeCloseTo(1.1, 5);
      expect(db.more('Speed', ModFlag.Spell)).toBeCloseTo(1.1, 5);
      expect(db.sum('INC', 'MovementSpeed')).toBe(10);
      expect(db.sum('INC', 'Evasion')).toBe(150);
      expect(db.more('Damage', ModFlag.Projectile | ModFlag.Hit)).toBeCloseTo(1.2, 5);
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
      expect(db.more('Speed', ModFlag.Spell)).toBeCloseTo(1.1, 5);
      expect(db.more('ManaRegen')).toBeCloseTo(1.2, 5);
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
    });

    it('Lich (PoE 2): Soulless Form & Eldritch Empowerment', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Soulless Form', [], 'Lich', 1),
        mkNode('Eldritch Empowerment', [], 'Lich', 2),
      ];
      applyPreStatAscendancyMechanics({ game: 'poe2', db, allocatedNodes: nodes });
      expect(db.flag('NoInherentManaRegen')).toBe(true);
      expect(db.sum('BASE', 'DamageBypassEs')).toBe(10);
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

    it('Amazon (PoE 2): Critical Strike & Predatory Instinct', () => {
      const db = new ModDB();
      const nodes = [
        mkNode('Critical Strike', [], 'Amazon', 1),
        mkNode('Predatory Instinct', [], 'Amazon', 2),
      ];
      applyPreStatAscendancyMechanics({
        game: 'poe2',
        db,
        allocatedNodes: nodes,
        config: { enemyIsBoss: 'Pinnacle' },
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
      // rawHitChance = (3000 * 1.25) / (3000 + 150) * 100 = 119.0476% -> excess = 19.0476% -> * 0.25 = 4.76%
      expect(db.sum('BASE', 'BaseCritChance', ModFlag.Attack)).toBeCloseTo(4.76, 2);
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
      // Bane of Legends (1.2) * Headsman (1.2) = 1.44
      expect(db.more('Damage')).toBeCloseTo(1.44, 5);
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
      expect(db.sum('INC', 'GolemBuffEffect')).toBe(200); // 100 base + 4 * 25
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
      expect(db.more('MinionDamage')).toBeCloseTo(1.1, 5);
      expect(db.more('MinionLife')).toBeCloseTo(1.2, 5);
    });

    it('Deadeye (PoE 1), Champion, Inquisitor, Trickster, Gladiator & Pathfinder', () => {
      // Deadeye (PoE 1)
      const dbDeadeye = new ModDB();
      applyPreStatAscendancyMechanics({
        game: 'poe1',
        db: dbDeadeye,
        allocatedNodes: [mkNode('Gathering Winds', [], 'Deadeye', 1), mkNode('Far Shot', [], 'Deadeye', 2)],
      });
      expect(dbDeadeye.sum('INC', 'ActionSpeed')).toBe(8);
      expect(dbDeadeye.more('Speed', ModFlag.Attack)).toBeCloseTo(1.08, 5);
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
      expect(dbGlad.more('Damage', ModFlag.Ailment | ModFlag.Dot, KeywordFlag.Bleed)).toBeCloseTo(2.0, 5);

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

    it('exports complete metadata registry covering all 59 PoE 1 & PoE 2 ascendancy notables', () => {
      const poe1Count = SUPPORTED_ASCENDANCY_NOTABLES.filter((n) => n.game === 'poe1').length;
      const poe2Count = SUPPORTED_ASCENDANCY_NOTABLES.filter((n) => n.game === 'poe2').length;
      expect(poe1Count).toBe(35);
      expect(poe2Count).toBe(24);
      expect(SUPPORTED_ASCENDANCY_NOTABLES.length).toBe(59);
    });
  });
});
