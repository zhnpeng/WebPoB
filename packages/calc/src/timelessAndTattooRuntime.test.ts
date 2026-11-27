import { describe, expect, it } from 'vitest';
import {
  ModFlag,
  type Build,
  type Item,
  type PassiveNode,
  type PassiveTreeData,
} from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import {
  classifyPoe2RuneSlotCategory,
  createCompactTimelessLutLookup,
  evaluatePoe2UnbakedSocketedRunes,
  evaluateTattoosAndRunegrafts,
  evaluateTimelessJewels,
  extractRawRuneNames,
  hasBakedRuneImplicits,
  parseTimelessJewel,
  type CompactTimelessLutPayload,
  type TimelessLutLookup,
} from './timelessAndTattooRuntime.js';

function mkNode(
  id: number,
  name: string,
  kind: PassiveNode['kind'],
  x: number,
  y: number,
  stats: string[] = [],
  ascendancyId?: string,
): PassiveNode {
  return {
    id,
    name: { en: name, zh: name },
    kind,
    x,
    y,
    stats,
    adjacent: [],
    ascendancyId,
  };
}

function mkItem(
  partial: Partial<Item> & { id: string; name: string; baseName: string },
): Item {
  return {
    rarity: 'UNIQUE',
    slotType: 'Any',
    quality: 0,
    implicits: [],
    explicits: [],
    ...partial,
  };
}

function mkBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: 'test-build',
    name: 'Test Build',
    game: 'poe1',
    level: 95,
    classId: 'templar',
    ascendancyId: 'inquisitor',
    activeWeaponSet: 1,
    tree: {
      title: 'Default',
      treeVersion: '3_30',
      allocatedNodeIds: [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
      socketedJewels: {},
      nodeOverrides: {},
    },
    skills: [],
    mainSkillGroupId: '',
    items: {},
    equipped: {},
    config: {
      enemyLevel: 84,
      enemyIsBoss: 'Pinnacle',
      enemyFireResist: 50,
      enemyColdResist: 50,
      enemyLightningResist: 50,
      enemyChaosResist: 30,
      enemyArmour: 0,
      enemyEvasion: 0,
      usePowerCharges: true,
      powerCharges: 6,
      useFrenzyCharges: false,
      frenzyCharges: 0,
      useEnduranceCharges: false,
      enduranceCharges: 0,
      onslaught: false,
      enemyShocked: false,
      shockValue: 0,
      enemyChilled: false,
      customMods: '',
    },
    notes: '',
    ...overrides,
  };
}

function applyResultToDb(
  db: ModDB,
  res: {
    addedStatLines: Array<{ source: string; lines: string[] }>;
    addedMods: import('@webpob/core').Mod[];
  },
): void {
  for (const entry of res.addedStatLines) {
    db.addMods(parseModLines(entry.lines, entry.source));
  }
  db.addMods(res.addedMods);
}

// ============================================================================
// 1. Timeless Jewel Evaluator Tests
// ============================================================================

describe('evaluateTimelessJewels', () => {
  const poe1Tree: PassiveTreeData = {
    game: 'poe1',
    version: '3_30',
    classStartNodeIds: { templar: 1 },
    nodes: {
      1: mkNode(1, 'Templar Start', 'start', 0, 0),
      100: mkNode(100, 'Jewel Socket', 'jewel', 0, 0),
      // Within PoE 1 Large radius (1800px)
      101: mkNode(101, 'Mind Over Matter', 'keystone', 1200, 0, [
        '40% of Damage is taken from Mana before Life',
      ]),
      102: mkNode(102, 'Strength Travel', 'small', 400, 0, ['+10 to Strength']),
      103: mkNode(103, 'Dexterity Travel', 'small', 600, 0, ['+10 to Dexterity']),
      104: mkNode(104, 'Life Small', 'small', 800, 0, ['5% increased maximum Life']),
      105: mkNode(105, 'Heart and Soul', 'notable', 1000, 0, [
        '8% increased maximum Life',
        '12% increased maximum Mana',
      ]),
      106: mkNode(106, 'Cruel Preparation', 'notable', 1500, 0, [
        '10% increased maximum Life',
        '+5% to all Elemental Resistances',
      ]),
      // Ascendancy node inside coordinates (must NEVER be affected)
      107: mkNode(
        107,
        'Ascendancy Small',
        'small',
        200,
        0,
        ['10% increased Elemental Damage'],
        'inquisitor',
      ),
      // Outside PoE 1 Large radius (>1800px)
      200: mkNode(200, 'Far Small', 'small', 2000, 0, ['+10 to Intelligence']),
      201: mkNode(201, 'Far Keystone', 'keystone', 2500, 0, [
        'Never deal Critical Strikes',
      ]),
    },
  };

  it('evaluates Glorious Vanity (Doryani -> Corrupted Soul 15% Life as Extra ES) and respects 1800px boundary', () => {
    const jewel = mkItem({
      id: 'gv-doryani',
      name: 'Glorious Vanity',
      baseName: 'Timeless Jewel',
      explicits: [
        'Bathed in the blood of 4512 sacrificed in the name of Doryani',
        'Passives in radius are Conquered by the Vaal',
      ],
    });

    const parsed = parseTimelessJewel(jewel, 'poe1');
    expect(parsed?.jewelType).toBe('Glorious Vanity');
    expect(parsed?.seed).toBe(4512);
    expect(parsed?.conqueror).toBe('Doryani');
    expect(parsed?.keystoneName).toBe('Corrupted Soul');

    const activeNodes = new Set([100, 101, 102, 201]);
    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      activeNodes,
    );

    expect(res.lifeGainAsEsPct).toBe(15);
    expect(res.suppressedNodeIds.has(101)).toBe(true);
    expect(res.suppressedNodeIds.has(201)).toBe(false);
    expect(res.replacedKeystones).toHaveLength(1);
    expect(res.replacedKeystones[0]?.keystoneName).toBe('Corrupted Soul');

    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.flag('CorruptedSoul')).toBe(true);
    expect(db.sum('BASE', 'LifeAsExtraES')).toBe(15);
    expect(db.sum('BASE', 'NonChaosDamageBypassEs')).toBe(50);
  });

  it('evaluates Glorious Vanity (Xibaqua -> Divine Flesh +5% max Chaos Res & 50% Ele taken as Chaos)', () => {
    const jewel = mkItem({
      id: 'gv-xibaqua',
      name: 'Glorious Vanity',
      baseName: 'Timeless Jewel',
      explicits: [
        'Bathed in the blood of 3120 sacrificed in the name of Xibaqua',
        'Passives in radius are Conquered by the Vaal',
      ],
    });

    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      new Set([100, 101]),
    );

    expect(res.suppressedNodeIds.has(101)).toBe(true);
    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.flag('DivineFlesh')).toBe(true);
    expect(db.sum('BASE', 'ChaosResistMax')).toBe(5);
    expect(db.sum('BASE', 'EleTakenAsChaos')).toBe(50);
  });

  it('evaluates Glorious Vanity (Ahuana -> Immortal Ambition) and applies LUT node replacement', () => {
    const jewel = mkItem({
      id: 'gv-ahuana',
      name: 'Glorious Vanity',
      baseName: 'Timeless Jewel',
      explicits: [
        'Bathed in the blood of 777 sacrificed in the name of Ahuana',
      ],
    });
    const lutLookup: TimelessLutLookup = {
      lookupNode(jewelType, seed, nodeId) {
        if (jewelType === 'Glorious Vanity' && seed === 777 && nodeId === 105) {
          return {
            mode: 'replace',
            name: 'Cult of Chaos',
            stats: ['+25% to Chaos Resistance', '15% increased Chaos Damage'],
          };
        }
        return null;
      },
    };

    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      new Set([100, 101, 105]),
      { lutLookup },
    );

    expect(res.suppressedNodeIds.has(101)).toBe(true);
    expect(res.suppressedNodeIds.has(105)).toBe(true);
    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.flag('ImmortalAmbition')).toBe(true);
    expect(db.flag('Overleech')).toBe(true);
    expect(db.sum('BASE', 'ChaosResist')).toBe(25);
    expect(db.sum('INC', 'ChaosDamage')).toBe(15);
  });

  it('evaluates Elegant Hubris (Caspiro -> Supreme Ostentation + suppresses ALL non-ascendancy small passives in radius)', () => {
    const jewel = mkItem({
      id: 'eh-caspiro',
      name: 'Elegant Hubris',
      baseName: 'Timeless Jewel',
      explicits: [
        'Commissioned 81400 coins to commemorate Caspiro',
        'Passives in radius are Conquered by the Eternal Empire',
      ],
    });
    const lutLookup: TimelessLutLookup = {
      lookupNode(jewelType, seed, nodeId) {
        if (jewelType === 'Elegant Hubris' && seed === 81400 && nodeId === 105) {
          return {
            mode: 'replace',
            name: 'Slum Lord',
            stats: ['80% increased Minion Damage'],
          };
        }
        return null;
      },
    };

    const active = new Set([100, 101, 102, 103, 104, 105, 106, 107, 200]);
    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      active,
      { lutLookup },
    );

    expect(res.supremeOstentation).toBe(true);
    // All non-ascendancy smalls in radius suppressed (102, 103, 104)
    expect(res.suppressedNodeIds.has(102)).toBe(true);
    expect(res.suppressedNodeIds.has(103)).toBe(true);
    expect(res.suppressedNodeIds.has(104)).toBe(true);
    // Keystone replaced (101) and LUT-replaced notable (105) suppressed
    expect(res.suppressedNodeIds.has(101)).toBe(true);
    expect(res.suppressedNodeIds.has(105)).toBe(true);
    // Non-LUT notable (106), ascendancy small (107), and out-of-radius small (200) NOT suppressed
    expect(res.suppressedNodeIds.has(106)).toBe(false);
    expect(res.suppressedNodeIds.has(107)).toBe(false);
    expect(res.suppressedNodeIds.has(200)).toBe(false);

    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.flag('SupremeOstentation')).toBe(true);
    expect(db.flag('NoAttributeBonuses')).toBe(true);
    expect(db.sum('INC', 'MinionDamage')).toBe(80);
  });

  it('evaluates Lethal Pride (+2 Str/small, +4 Str/notable, LUT additive notable bonus, and Tempered by War)', () => {
    const jewel = mkItem({
      id: 'lp-rakiata',
      name: 'Lethal Pride',
      baseName: 'Timeless Jewel',
      explicits: [
        'Commanded leadership over 14200 warriors under Rakiata',
        'Passives in radius are Conquered by the Karui',
      ],
    });
    const lutLookup: TimelessLutLookup = {
      lookupNode(jewelType, seed, nodeId) {
        if (jewelType === 'Lethal Pride' && seed === 14200 && nodeId === 105) {
          return {
            mode: 'add',
            stats: ['5% chance to deal Double Damage', '+20 to Strength'],
          };
        }
        return null;
      },
    };

    // 3 smalls in radius (102, 103, 104) -> 3*2 = 6 Str
    // 2 notables in radius (105, 106) -> 2*4 = 8 Str
    // Total base LP Str = 14, plus +20 from LUT = 34 Str
    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      new Set([100, 101, 102, 103, 104, 105, 106, 200]),
      { lutLookup },
    );

    expect(res.suppressedNodeIds.has(101)).toBe(true);
    expect(res.suppressedNodeIds.has(105)).toBe(false); // Lethal Pride LUT is additive!

    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.sum('BASE', 'Str')).toBe(34);
    expect(db.sum('BASE', 'DoubleDamageChance')).toBe(5);
    expect(db.flag('TemperedByWar')).toBe(true);
    expect(db.more('ColdResist')).toBe(0.5);
    expect(db.more('LightningResist')).toBe(0.5);
  });

  it('evaluates Brutal Restraint (+2 Dex/small, +4 Dex/notable, Dance with Death & Second Sight)', () => {
    const nasimaJewel = mkItem({
      id: 'br-nasima',
      name: 'Brutal Restraint',
      baseName: 'Timeless Jewel',
      explicits: [
        'Denoted service of 3500 dekhara in the akhara of Nasima',
        'Passives in radius are Conquered by the Maraketh',
      ],
    });

    // 2 smalls (102, 104) -> 4 Dex, 1 notable (105) -> 4 Dex => +8 Dex
    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel: nasimaJewel }],
      poe1Tree,
      new Set([100, 101, 102, 104, 105]),
    );

    const db = new ModDB();
    applyResultToDb(db, res);
    expect(db.sum('BASE', 'Dex')).toBe(8);
    expect(db.flag('SecondSight')).toBe(true);
    expect(db.flag('Blind')).toBe(true);
    expect(db.more('CritChance', ModFlag.Melee)).toBe(1.25);
    expect(db.more('CritChance', ModFlag.Spell)).toBe(1);

    const asenathJewel = mkItem({
      id: 'br-asenath',
      name: 'Brutal Restraint',
      baseName: 'Timeless Jewel',
      explicits: ['Denoted service of 1200 dekhara in the akhara of Asenath'],
    });
    const res2 = evaluateTimelessJewels(
      [{ nodeId: 100, jewel: asenathJewel }],
      poe1Tree,
      new Set([100, 101]),
    );
    const db2 = new ModDB();
    applyResultToDb(db2, res2);
    expect(db2.flag('DanceWithDeath')).toBe(true);
    expect(db2.flag('CritChanceLucky')).toBe(true);
  });

  it('evaluates Militant Faith (Devotion accumulation, per-10 Devotion bonuses, and Dominus Inner Conviction 3% MORE Spell Damage per Power Charge)', () => {
    const jewel = mkItem({
      id: 'mf-dominus',
      name: 'Militant Faith',
      baseName: 'Timeless Jewel',
      explicits: [
        'Carved to glorify 5120 new faithful converted by High Templar Dominus',
        '+4% to all Elemental Resistances per 10 Devotion',
        '4% increased Area Damage per 10 Devotion',
        '1% reduced Mana Cost of Skills per 10 Devotion',
        'Passives in radius are Conquered by the Templars',
      ],
    });

    // In radius:
    // 102 (+10 Str travel) -> suppressed, +10 Devotion
    // 103 (+10 Dex travel) -> suppressed, +10 Devotion
    // 104 (non-attr small) -> kept, +5 Devotion
    // 105 (notable) -> kept, +10 Devotion
    // 106 (notable) -> kept, +10 Devotion
    // Total Devotion = 45 -> 4 steps of 10 Devotion!
    const res = evaluateTimelessJewels(
      [{ nodeId: 100, jewel }],
      poe1Tree,
      new Set([100, 101, 102, 103, 104, 105, 106]),
    );

    expect(res.totalDevotion).toBe(45);
    expect(res.suppressedNodeIds.has(101)).toBe(true);
    expect(res.suppressedNodeIds.has(102)).toBe(true);
    expect(res.suppressedNodeIds.has(103)).toBe(true);
    expect(res.suppressedNodeIds.has(104)).toBe(false);

    const db = new ModDB();
    applyResultToDb(db, res);
    db.setMultiplier('PowerCharge', 6);

    expect(db.sum('BASE', 'Devotion')).toBe(45);
    expect(db.sum('BASE', 'FireResist')).toBe(16); // 4 * 4%
    expect(db.sum('BASE', 'ColdResist')).toBe(16);
    expect(db.sum('BASE', 'LightningResist')).toBe(16);
    expect(db.sum('INC', 'Damage', ModFlag.Area)).toBe(16); // 4 * 4%
    expect(db.sum('INC', 'ManaCost')).toBe(-4); // 4 * -1%
    // Inner Conviction: 6 Power Charges * 3% = 18% MORE Spell Damage
    expect(db.more('Damage', ModFlag.Spell)).toBeCloseTo(1.18, 4);
    expect(db.more('Damage', ModFlag.Attack)).toBe(1);
  });

  it('evaluates Militant Faith Maxarius (Transcendence -15% max Ele Res) and Avarius (Power of Purpose)', () => {
    const maxarius = mkItem({
      id: 'mf-maxarius',
      name: 'Militant Faith',
      baseName: 'Timeless Jewel',
      explicits: [
        'Carved to glorify 3333 new faithful converted by High Templar Maxarius',
      ],
    });
    const resMax = evaluateTimelessJewels(
      [{ nodeId: 100, jewel: maxarius }],
      poe1Tree,
      new Set([100, 101]),
    );
    const dbMax = new ModDB();
    applyResultToDb(dbMax, resMax);
    expect(dbMax.flag('Transcendence')).toBe(true);
    expect(dbMax.sum('BASE', 'ArmourAppliesToEle')).toBe(100);
    expect(dbMax.sum('BASE', 'FireResistMax')).toBe(-15);
    expect(dbMax.sum('BASE', 'ColdResistMax')).toBe(-15);
    expect(dbMax.sum('BASE', 'LightningResistMax')).toBe(-15);

    const avarius = mkItem({
      id: 'mf-avarius',
      name: 'Militant Faith',
      baseName: 'Timeless Jewel',
      explicits: [
        'Carved to glorify 4444 new faithful converted by High Templar Avarius',
      ],
    });
    const resAva = evaluateTimelessJewels(
      [{ nodeId: 100, jewel: avarius }],
      poe1Tree,
      new Set([100, 101]),
    );
    expect(resAva.powerOfPurpose).toEqual({
      manaConvertedPct: 80,
      armourMultiplier: 2,
    });
    const dbAva = new ModDB();
    applyResultToDb(dbAva, resAva);
    expect(dbAva.flag('PowerOfPurpose')).toBe(true);
    expect(dbAva.sum('BASE', 'ManaConvertToArmourPct')).toBe(80);
  });

  it('evaluates Heroic Tragedy across PoE 2 (1560px Large radius, Vorana Circular Teaching) and PoE 1 (Black Scythe Training)', () => {
    const poe2Tree: PassiveTreeData = {
      game: 'poe2',
      version: '0_5',
      classStartNodeIds: { warrior: 1 },
      nodes: {
        1: mkNode(1, 'Start', 'start', 0, 0),
        10: mkNode(10, 'Jewel Socket', 'jewel', 0, 0),
        11: mkNode(11, 'Inner Keystone', 'keystone', 1500, 0, ['Giant\'s Blood']),
        // 1650px is inside PoE 1 Large (1800px) but OUTSIDE PoE 2 Large (1560px)!
        12: mkNode(12, 'Outer Keystone', 'keystone', 1650, 0, ['Chaos Inoculation']),
      },
    };
    const vorana = mkItem({
      id: 'ht-vorana',
      name: 'Heroic Tragedy',
      baseName: 'Timeless Jewel',
      explicits: [
        'Remembrancing 4050 songworthy deeds by the line of Vorana',
        'Passives in radius are Conquered by the Kalguur',
      ],
    });

    const resPoe2 = evaluateTimelessJewels(
      [{ nodeId: 10, jewel: vorana }],
      poe2Tree,
      new Set([10, 11, 12]),
    );
    expect(resPoe2.details[0]?.radiusPx).toBe(1560);
    expect(resPoe2.suppressedNodeIds.has(11)).toBe(true);
    expect(resPoe2.suppressedNodeIds.has(12)).toBe(false);
    expect(resPoe2.noStrLifeBonus).toBe(true);
    expect(resPoe2.replacedKeystones[0]?.keystoneName).toBe('Circular Teaching');

    const db2 = new ModDB();
    applyResultToDb(db2, resPoe2);
    db2.setStat('Str', 200);
    expect(db2.sum('INC', 'EnergyShield')).toBe(100); // 200 / 2 = 100% inc ES

    // Same jewel in PoE 1 gets Black Scythe Training instead of PoE 2 Circular Teaching
    const resPoe1 = evaluateTimelessJewels(
      [{ nodeId: 100, jewel: vorana }],
      poe1Tree,
      new Set([100, 101]),
    );
    expect(resPoe1.noStrLifeBonus).toBe(false);
    expect(resPoe1.replacedKeystones[0]?.keystoneName).toBe(
      'Black Scythe Training',
    );
  });

  it('decodes compact base64 Uint8Array & Uint16Array timeless LUT payloads accurately', () => {
    // Seeds 1000..1006 step 2 -> 4 slots: [0, 1, 2, 1]
    const bytesU8 = Uint8Array.from([0, 1, 2, 1]);
    const b64U8 = Buffer.from(bytesU8).toString('base64');

    // Uint16 LE for Elegant Hubris: slots [0, 2]
    const bytesU16 = Uint8Array.from([0, 0, 2, 0]);
    const b64U16 = Buffer.from(bytesU16).toString('base64');

    const payload: CompactTimelessLutPayload = {
      'Lethal Pride': {
        minSeed: 1000,
        maxSeed: 1006,
        seedStep: 2,
        legionPassives: [
          { name: 'Strength of Karui', stats: ['+20 to Strength'] },
          { name: 'Double Damage', stats: ['5% chance to deal Double Damage'] },
        ],
        nodes: {
          105: b64U8,
          106: [1, 0, 2, 0],
        },
      },
      'Elegant Hubris': {
        minSeed: 2000,
        maxSeed: 2020,
        seedStep: 20,
        bytesPerEntry: 2,
        legionPassives: [
          { name: 'Superiority', stats: ['+40% to Critical Strike Multiplier'] },
          { name: 'Axiom Warden', stats: ['80% increased Spell Damage'] },
        ],
        nodes: {
          105: b64U16,
        },
      },
    };

    const lookup = createCompactTimelessLutLookup(payload);
    // Slot 0 (seed 1000) -> 0 => null
    expect(lookup.lookupNode?.('Lethal Pride', 1000, 105)).toBeNull();
    // Slot 1 (seed 1002) -> 1 => +20 to Strength (add mode)
    expect(lookup.lookupNode?.('Lethal Pride', 1002, 105)).toEqual({
      mode: 'add',
      name: 'Strength of Karui',
      stats: ['+20 to Strength'],
    });
    // Slot 2 (seed 1004) -> 2 => 5% Double Damage
    expect(lookup.lookupNode?.('Lethal Pride', 1004, 105)?.stats).toEqual([
      '5% chance to deal Double Damage',
    ]);
    // Direct number[] node table
    expect(lookup.lookupNode?.('Lethal Pride', 1004, 106)?.stats).toEqual([
      '5% chance to deal Double Damage',
    ]);
    // Uint16 Elegant Hubris slot 1 (seed 2020) -> replace mode
    expect(lookup.lookupNode?.('Elegant Hubris', 2020, 105)).toEqual({
      mode: 'replace',
      name: 'Axiom Warden',
      stats: ['80% increased Spell Damage'],
    });
    // Out of range or misaligned step -> null
    expect(lookup.lookupNode?.('Lethal Pride', 1001, 105)).toBeNull();
    expect(lookup.lookupNode?.('Lethal Pride', 2000, 105)).toBeNull();
  });
});

// ============================================================================
// 2. Tattoo & Runegraft Evaluator Tests
// ============================================================================

describe('evaluateTattoosAndRunegrafts', () => {
  const tree: PassiveTreeData = {
    game: 'poe1',
    version: '3_30',
    classStartNodeIds: { ranger: 1 },
    nodes: {
      1: mkNode(1, 'Ranger Start', 'start', 0, 0),
      500: mkNode(500, 'Jewel Socket', 'jewel', 0, 0),
      // Within PoE 1 Medium radius (1440px)
      501: mkNode(501, 'Dexterity', 'small', 600, 0, ['+10 to Dexterity']),
      502: mkNode(502, 'Dexterity', 'small', 1200, 0, ['+10 to Dexterity']),
      503: mkNode(503, 'Strength', 'small', 1400, 0, ['+10 to Strength']),
      // Outside Medium radius (>1440px)
      504: mkNode(504, 'Dexterity', 'small', 1600, 0, ['+10 to Dexterity']),
      // Mastery / Runegraft nodes
      505: mkNode(505, 'Life Mastery', 'small', 500, 0, ['5% increased maximum Life']),
      506: mkNode(506, 'Mana Mastery', 'small', 700, 0, ['10% increased maximum Mana']),
      507: mkNode(507, 'Support Mastery', 'small', 900, 0, ['+10 to Intelligence']),
    },
  };

  it("doubles Tattoo nodeOverrides in Medium radius with Warrior's Tale while ignoring out-of-radius Tattoos & Runegrafts", () => {
    const warriorsTale = mkItem({
      id: 'wt-1',
      name: "Warrior's Tale",
      baseName: 'Crimson Jewel',
      explicits: ['100% increased Effect of Tattoo Passive Skills in Radius'],
    });

    const build = mkBuild({
      items: { 'wt-1': warriorsTale },
      tree: {
        title: 'Default',
        treeVersion: '3_30',
        allocatedNodeIds: [500, 501, 502, 504, 505],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 500: 'wt-1' },
        nodeOverrides: {
          501: {
            name: 'Tattoo of the Ramako Sniper',
            stats: ['5% increased Projectile Speed'],
          },
          502: {
            name: 'Tattoo of the Ramako Scout',
            stats: ['+4% to Cold Resistance', '2% increased Movement Speed'],
          },
          504: {
            name: 'Tattoo of the Valako Stormrider',
            stats: ['+6% to Lightning Resistance'],
          },
          505: {
            name: 'Runegraft of the Fortress',
            stats: ['40% increased Global Defences', '10% reduced Attributes'],
          },
        },
      },
    });

    const res = evaluateTattoosAndRunegrafts(
      build,
      tree,
      new Set([500, 501, 502, 504, 505]),
    );

    expect(res.warriorsTaleAffectedNodeIds.has(501)).toBe(true);
    expect(res.warriorsTaleAffectedNodeIds.has(502)).toBe(true);
    expect(res.warriorsTaleAffectedNodeIds.has(504)).toBe(false); // Outside 1440px
    expect(res.warriorsTaleAffectedNodeIds.has(505)).toBe(false); // Runegraft, not Tattoo

    expect(res.counts.totalTattoos).toBe(3);
    expect(res.counts.byTribe['Ramako']).toBe(2);
    expect(res.counts.byTribe['Valako']).toBe(1);
    expect(res.counts.runegraftCount).toBe(1);

    const db = new ModDB();
    applyResultToDb(db, res);
    // Warrior's Tale 1x delta copy of node 502: +4% Cold Res, 2% Move Speed
    expect(db.sum('BASE', 'ColdResist')).toBe(4);
    expect(db.sum('INC', 'MovementSpeed')).toBe(2);
    // Out-of-radius node 504 NOT doubled
    expect(db.sum('BASE', 'LightningResist')).toBe(0);
    // Runegraft of the Fortress: 40% Global Defences + 10% reduced Attributes
    expect(db.sum('INC', 'Armour')).toBe(40);
    expect(db.sum('INC', 'Evasion')).toBe(40);
    expect(db.sum('INC', 'EnergyShield')).toBe(40);
    expect(db.sum('INC', 'Ward')).toBe(40);
    expect(db.sum('INC', 'Str')).toBe(-10);
    expect(db.sum('INC', 'Dex')).toBe(-10);
    expect(db.sum('INC', 'Int')).toBe(-10);
  });

  it('evaluates Journey Tattoos per-tribe scaling and Runegraft of Treachery / Gemcraft', () => {
    const warriorsTale = mkItem({
      id: 'wt-2',
      name: "Warrior's Tale",
      baseName: 'Crimson Jewel',
      explicits: ['100% increased effect of Tattoos in Radius'],
    });

    const build = mkBuild({
      items: { 'wt-2': warriorsTale },
      tree: {
        title: 'Default',
        treeVersion: '3_30',
        allocatedNodeIds: [500, 501, 502, 503, 504, 506, 507],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 500: 'wt-2' },
        nodeOverrides: {
          501: {
            name: 'Tattoo of the Ramako Makanga',
            stats: ['+1 to Level of all Dexterity Skill Gems'],
          },
          502: {
            name: 'Tattoo of the Ramako Fleetfoot',
            stats: ['2% increased Movement Speed'],
          },
          503: {
            name: 'Journey Tattoo of Maata',
            stats: ['+10 to maximum Life per Allocated Ramako Tattoo'],
          },
          504: {
            name: 'Tattoo of the Ngamahu Warmonger',
            stats: ['+6% to Fire Resistance'],
          },
          506: {
            name: 'Runegraft of Treachery',
            stats: ['15% increased Mana Reservation Efficiency of Skills'],
          },
          507: {
            name: 'Runegraft of Gemcraft',
            stats: ['+1 to Level of all non-Exceptional Support Gems'],
          },
        },
      },
    });

    const res = evaluateTattoosAndRunegrafts(
      build,
      tree,
      new Set([500, 501, 502, 503, 504, 506, 507]),
    );

    expect(res.counts.byTribe['Ramako']).toBe(2);
    expect(res.counts.byTribe['Ngamahu']).toBe(1);
    expect(res.counts.totalTattoos).toBe(4);
    expect(res.nonExceptionalSupportLevelBonus).toBe(1);

    const db = new ModDB();
    applyResultToDb(db, res);
    // Journey Tattoo of Maata is in Warrior's Tale radius (1400 <= 1440):
    // 2 Ramako Tattoos * +10 Life * 2x (Warrior's Tale) = +40 Life
    expect(db.sum('BASE', 'Life')).toBe(40);
    expect(db.sum('INC', 'ManaReservationEfficiency')).toBe(15);
    expect(db.sum('BASE', 'GemLevelSup:non-exceptional')).toBe(1);
  });
});

// ============================================================================
// 3. PoE 2 Unbaked Rune & Soul Core Resolver Tests
// ============================================================================

describe('evaluatePoe2UnbakedSocketedRunes', () => {
  it('resolves unbaked Glacial Rune, Soul Core of Tacati, Citaqualotl, and no-space Rune:Soul Core of Jiquani on armour', () => {
    const bodyArmour = mkItem({
      id: 'chest-1',
      name: 'Morior Invictus',
      baseName: 'Grand Regalia',
      slotType: 'Body Armour',
      armourStats: { energyShield: 286 },
      implicits: ['+1% to all maximum Elemental Resistances'],
      explicits: ['+9% to all Elemental Resistances per Socket filled'],
      rawText: [
        'Rarity: UNIQUE',
        'Morior Invictus',
        'Grand Regalia',
        'Energy Shield: 286',
        'Sockets: S S S S',
        'Rune: Glacial Rune',
        'Rune: Soul Core of Tacati',
        'Rune: Soul Core of Citaqualotl',
        'Rune:Soul Core of Jiquani',
        'Implicits: 1',
        '+1% to all maximum Elemental Resistances',
      ].join('\n'),
    });

    expect(extractRawRuneNames(bodyArmour)).toEqual([
      'Glacial Rune',
      'Soul Core of Tacati',
      'Soul Core of Citaqualotl',
      'Soul Core of Jiquani',
    ]);
    expect(hasBakedRuneImplicits(bodyArmour)).toBe(false);
    expect(classifyPoe2RuneSlotCategory('Body Armour', bodyArmour)).toBe('armour');

    const res = evaluatePoe2UnbakedSocketedRunes(
      [{ slot: 'Body Armour', item: bodyArmour }],
      'poe2',
    );

    const db = new ModDB();
    applyResultToDb(db, res);

    // Glacial Rune (+12 Cold) + Citaqualotl (+5 all Ele)
    expect(db.sum('BASE', 'ColdResist')).toBe(17);
    expect(db.sum('BASE', 'FireResist')).toBe(5);
    expect(db.sum('BASE', 'LightningResist')).toBe(5);
    // Soul Core of Tacati (+7 Chaos)
    expect(db.sum('BASE', 'ChaosResist')).toBe(7);
    // Soul Core of Jiquani (2% inc max Life)
    expect(db.sum('INC', 'Life')).toBe(2);
  });

  it('skips items that already contain {rune} or (rune) lines to prevent double-counting', () => {
    const bakedHelm = mkItem({
      id: 'helm-baked',
      name: 'Woe Crown',
      baseName: 'Ancestral Tiara',
      slotType: 'Helmet',
      armourStats: { energyShield: 180 },
      implicits: ['+12% to Cold Resistance'],
      rawText: [
        'Rarity: RARE',
        'Woe Crown',
        'Ancestral Tiara',
        'Energy Shield: 180',
        'Rune: Glacial Rune',
        'Implicits: 1',
        '{rune}+12% to Cold Resistance',
      ].join('\n'),
    });

    expect(hasBakedRuneImplicits(bakedHelm)).toBe(true);
    const res = evaluatePoe2UnbakedSocketedRunes(
      [{ slot: 'Helmet', item: bakedHelm }],
      'poe2',
    );
    expect(res.addedStatLines).toHaveLength(0);
    expect(res.addedMods).toHaveLength(0);
    expect(res.details[0]?.skippedEntireItemReason).toBe(
      'already-baked-rune-implicits',
    );
  });

  it('skips local Iron Rune on armour and Iron/Tempered Rune on weapons while keeping global runes on the same item', () => {
    const chest = mkItem({
      id: 'chest-iron',
      name: 'Armour Chest',
      baseName: 'Vaal Cuirass',
      slotType: 'Body Armour',
      armourStats: { armour: 600 },
      rawText: [
        'Armour: 600',
        'Rune: Iron Rune',
        'Rune: Greater Iron Rune',
        'Rune: Body Rune',
        'Implicits: 0',
      ].join('\n'),
    });
    const bow = mkItem({
      id: 'bow-iron',
      name: 'Dualstring Bow',
      baseName: 'Dualstring Bow',
      slotType: 'Weapon 1',
      weaponStats: {
        physicalMin: 100,
        physicalMax: 200,
        attacksPerSecond: 1.3,
        critChance: 5,
        weaponType: 'Bow',
        twoHanded: true,
      },
      rawText: [
        'Physical Damage: 100-200',
        'Rune: Iron Rune',
        'Rune: Tempered Rune',
        'Rune: Soul Core of Citaqualotl',
        'Implicits: 0',
      ].join('\n'),
    });

    const res = evaluatePoe2UnbakedSocketedRunes(
      [
        { slot: 'Body Armour', item: chest },
        { slot: 'Weapon 1', item: bow },
      ],
      'poe2',
    );

    const db = new ModDB();
    applyResultToDb(db, res);

    // Local Iron Runes skipped -> ZERO Armour/ES/Evasion or Phys INC added!
    expect(db.sum('INC', 'Armour')).toBe(0);
    expect(db.sum('INC', 'PhysicalDamage')).toBe(0);
    // Global Body Rune (+25 Life) & Soul Core of Citaqualotl on weapon (30% inc Ele Damage with Attacks) applied!
    expect(db.sum('BASE', 'Life')).toBe(25);
    expect(db.sum('INC', 'ElementalDamage', ModFlag.Attack)).toBe(30);
    expect(res.details[0]?.skippedRunes.map((s) => s.reason)).toEqual([
      'local-armour-already-in-header',
      'local-armour-already-in-header',
    ]);
    expect(res.details[1]?.skippedRunes.map((s) => s.reason)).toEqual([
      'local-weapon-phys-already-in-header',
      'local-weapon-phys-already-in-header',
    ]);
  });

  it('evaluates weapon/sceptre Soul Cores (Azcapa, Topotante, Quipolatl, Ticaba) & Mahuxotl Soul Core effect scaling', () => {
    const sceptre = mkItem({
      id: 'scep-1',
      name: 'Rattling Sceptre',
      baseName: 'Rattling Sceptre',
      slotType: 'Weapon 2',
      rawText: 'Rune: Soul Core of Azcapa\nImplicits: 0',
    });
    const qstaff = mkItem({
      id: 'qs-1',
      name: 'Gothic Quarterstaff',
      baseName: 'Gothic Quarterstaff',
      slotType: 'Weapon 1',
      weaponStats: {
        physicalMin: 80,
        physicalMax: 160,
        attacksPerSecond: 1.4,
        critChance: 10,
        weaponType: 'Quarterstaff',
        twoHanded: true,
      },
      rawText: [
        'Rune: Soul Core of Topotante',
        'Rune: Soul Core of Quipolatl',
        'Rune: Soul Core of Ticaba',
        'Implicits: 0',
      ].join('\n'),
    });
    const shield = mkItem({
      id: 'mahu-1',
      name: "Mahuxotl's Machination",
      baseName: 'Omen Crest Shield',
      slotType: 'Weapon 2',
      armourStats: { armour: 300, energyShield: 120, blockChance: 25 },
      explicits: ['100% increased effect of Socketed Soul Cores'],
      rawText: [
        'Rune: Soul Core of Puhuarte',
        'Rune: Soul Core of Zalatl',
        'Implicits: 0',
      ].join('\n'),
    });

    const res = evaluatePoe2UnbakedSocketedRunes(
      [
        { slot: 'Weapon 2', item: sceptre },
        { slot: 'Weapon 1', item: qstaff },
        { slot: 'Weapon 2', item: shield },
      ],
      'poe2',
    );

    const db = new ModDB();
    applyResultToDb(db, res);

    expect(db.sum('BASE', 'Spirit')).toBe(15);
    expect(db.sum('BASE', 'FirePenetration', ModFlag.Attack)).toBe(15);
    expect(db.sum('BASE', 'ColdPenetration', ModFlag.Attack)).toBe(15);
    expect(db.sum('BASE', 'LightningPenetration', ModFlag.Attack)).toBe(15);
    expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(5);
    expect(db.sum('BASE', 'CritDamageBonusFlat')).toBe(12);
    // Mahuxotl 100% increased effect of Socketed Soul Cores -> 2x Puhuarte (+2% max Fire Res) & 2x Zalatl (4% inc max Mana)
    expect(db.sum('BASE', 'FireResistMax')).toBe(2);
    expect(db.sum('INC', 'Mana')).toBe(4);
  });

  it('returns empty for PoE 1 and supports item.runes array + custom Poe2RunesLookup overrides', () => {
    const itemWithRunesArr = mkItem({
      id: 'gloves-1',
      name: 'Custom Gloves',
      baseName: 'Vaal Mitts',
      slotType: 'Gloves',
      armourStats: { armour: 150 },
    }) as Item & { runes?: string[] };
    itemWithRunesArr.runes = ['Inspiration Rune', 'Stone Rune', 'Custom Event Rune'];

    const poe1Res = evaluatePoe2UnbakedSocketedRunes(
      [{ slot: 'Gloves', item: itemWithRunesArr }],
      'poe1',
    );
    expect(poe1Res.addedStatLines).toHaveLength(0);
    expect(poe1Res.addedMods).toHaveLength(0);

    const poe2Res = evaluatePoe2UnbakedSocketedRunes(
      [{ slot: 'Gloves', item: itemWithRunesArr }],
      'poe2',
      {
        runesLookup: {
          lookupRune(name) {
            if (name === 'Custom Event Rune') {
              return {
                name: 'Custom Event Rune',
                armour: { stats: ['+15 to all Attributes'] },
              };
            }
            return null;
          },
        },
      },
    );

    const db = new ModDB();
    applyResultToDb(db, poe2Res);
    expect(db.sum('INC', 'EnergyShieldRecharge')).toBe(15);
    expect(db.sum('BASE', 'StunThreshold')).toBe(40);
    expect(db.sum('BASE', 'Str')).toBe(15);
    expect(db.sum('BASE', 'Dex')).toBe(15);
    expect(db.sum('BASE', 'Int')).toBe(15);
  });
});
