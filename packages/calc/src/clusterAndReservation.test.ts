import { describe, expect, it } from 'vitest';
import {
  KeywordFlag,
  ModFlag,
  type Build,
  type GameId,
  type GemDefinition,
  type Item,
  type PassiveNode,
} from '@webpob/core';
import type { ClusterNotableDef } from '@webpob/data';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import {
  CLUSTER_NODE_SIGNAL_BIT,
  POE1_EXPANSION_SOCKETS,
  applyPoolZeroingAndKeystoneRules,
  decodeClusterNodeId,
  encodeClusterNodeId,
  evaluateAllocatedClusterJewels,
  evaluateAurasAndWatchersEye,
  getClusterTemplateLayout,
  parseWatchersEyeCondition,
  scaleClusterGrantLine,
} from './clusterAndReservation.js';

// ============================================================================
// Test Fixture Factories
// ============================================================================

function mkItem(partial: Partial<Item> & Pick<Item, 'id' | 'name' | 'baseName'>): Item {
  return {
    rarity: 'RARE',
    slotType: 'Any',
    quality: 0,
    implicits: [],
    explicits: [],
    ...partial,
  };
}

function mkNode(
  id: number,
  name: string,
  kind: PassiveNode['kind'] = 'keystone',
  stats: string[] = [],
): PassiveNode {
  return {
    id,
    name: { en: name, zh: name },
    kind,
    x: 0,
    y: 0,
    stats,
    adjacent: [],
  };
}

function mkBuild(overrides: Partial<Build> = {}): Build {
  return {
    id: 'test-build',
    name: 'Test Build',
    game: 'poe1',
    level: 95,
    classId: 'witch',
    ascendancyId: 'necromancer',
    activeWeaponSet: 1,
    tree: {
      title: 'Default',
      treeVersion: '3_30',
      allocatedNodeIds: [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
      socketedJewels: {},
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
      usePowerCharges: false,
      powerCharges: 0,
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

const TEST_GEMS: Record<string, GemDefinition> = {
  poe1_determination: {
    id: 'poe1_determination',
    name: { en: 'Determination', zh: '坚定' },
    category: 'active',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'spell', 'area', 'physical'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['+1000 to Armour', '50% more Armour'],
  },
  poe1_grace: {
    id: 'poe1_grace',
    name: { en: 'Grace', zh: '优雅' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['aura', 'spell', 'area'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['+1500 to Evasion Rating', '30% more Evasion Rating'],
  },
  poe1_discipline: {
    id: 'poe1_discipline',
    name: { en: 'Discipline', zh: '纪律' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['aura', 'spell', 'area'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 35,
    isAuraOrBuff: true,
    stats: ['+200 to maximum Energy Shield'],
  },
  poe1_hatred: {
    id: 'poe1_hatred',
    name: { en: 'Hatred', zh: '憎恨' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['aura', 'spell', 'area', 'cold'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Cold,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['Gain 40% of Physical Damage as Extra Cold Damage'],
  },
  poe1_wrath: {
    id: 'poe1_wrath',
    name: { en: 'Wrath', zh: '雷霆' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['aura', 'spell', 'area', 'lightning'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Lightning,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['20% more Lightning Damage'],
  },
  poe1_clarity: {
    id: 'poe1_clarity',
    name: { en: 'Clarity', zh: '清晰' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['aura', 'spell', 'area'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationFlat: 200,
    isAuraOrBuff: true,
    stats: ['Regenerate 30 Mana per second'],
  },
  poe1_precision: {
    id: 'poe1_precision',
    name: { en: 'Precision', zh: '精准' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['aura', 'spell', 'area', 'critical'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationFlat: 186,
    isAuraOrBuff: true,
    stats: ['+700 to Accuracy Rating', '60% increased Critical Strike Chance'],
  },
  poe1_purityofelements: {
    id: 'poe1_purityofelements',
    name: { en: 'Purity of Elements', zh: '元素净化' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['aura', 'spell', 'area'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['+34% to all Elemental Resistances'],
  },
  poe1_pride: {
    id: 'poe1_pride',
    name: { en: 'Pride', zh: '骄傲' },
    category: 'active',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'spell', 'area', 'physical'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Physical,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: [],
  },
  poe1_supportgenerosity: {
    id: 'poe1_supportgenerosity',
    name: { en: 'Generosity', zh: '慷慨' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'support'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['39% increased Aura Effect'],
  },
  poe1_supportawakenedgenerosity: {
    id: 'poe1_supportawakenedgenerosity',
    name: { en: 'Awakened Generosity', zh: '觉醒·慷慨' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'support', 'awakened'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['44% increased Aura Effect'],
  },
  poe1_supporteternalblessing: {
    id: 'poe1_supporteternalblessing',
    name: { en: 'Eternal Blessing', zh: '永恒祝福' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'support', 'blessing'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['19% increased Aura Effect'],
  },
  poe1_supportdivineblessing: {
    id: 'poe1_supportdivineblessing',
    name: { en: 'Divine Blessing', zh: '神圣祝福' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['aura', 'support', 'blessing'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['29% increased Aura Effect'],
  },
  poe1_supportguardiansblessing: {
    id: 'poe1_supportguardiansblessing',
    name: { en: "Guardian's Blessing", zh: '守护者祝福' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'support', 'blessing', 'minion'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['27% increased Aura Effect'],
  },
  poe1_supportarrogance: {
    id: 'poe1_supportarrogance',
    name: { en: 'Arrogance', zh: '傲慢' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['aura', 'support'],
    modFlags: 0,
    keywordFlags: KeywordFlag.Aura,
    stats: ['19% increased Aura Effect'],
  },
  poe1_supportenlighten: {
    id: 'poe1_supportenlighten',
    name: { en: 'Enlighten', zh: '启蒙' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['support'],
    modFlags: 0,
    keywordFlags: 0,
    stats: [],
  },
};

const lookupTestGem = (_game: GameId, id: string): GemDefinition | undefined => TEST_GEMS[id];

// ============================================================================
// 1. Exact PoE 1 Cluster Jewel Subgraph Allocator Tests
// ============================================================================

describe('clusterAndReservation — PoE 1 Cluster Jewel Subgraph Allocator', () => {
  it('decodes and encodes PoB 1 >= 65536 cluster node ID bitfields accurately', () => {
    // Real PoB 1 IDs verified from PassiveSpec.lua:
    // 65824 (0x10120) -> idx=0, size=2 (Large), large=4 (socket 32763), med=0
    const dLarge = decodeClusterNodeId(65824);
    expect(dLarge).toEqual({
      nodeId: 65824,
      nodeIndex: 0,
      sizeIndex: 2,
      size: 'Large',
      largeSocketIndex: 4,
      mediumSocketIndex: 0,
      outerGroupIndex: 0,
      subgraphBaseId: 65824,
    });

    // 66841 (0x10519) -> idx=9, size=1 (Medium), large=4, med=2 (socket 33753)
    const dMed = decodeClusterNodeId(66841);
    expect(dMed).toEqual({
      nodeId: 66841,
      nodeIndex: 9,
      sizeIndex: 1,
      size: 'Medium',
      largeSocketIndex: 4,
      mediumSocketIndex: 2,
      outerGroupIndex: 0,
      subgraphBaseId: 66832,
    });

    // 65860 (0x10144) -> idx=4, size=0 (Small), large=5 (socket 21984), med=0
    const dSmall = decodeClusterNodeId(65860);
    expect(dSmall).toEqual({
      nodeId: 65860,
      nodeIndex: 4,
      sizeIndex: 0,
      size: 'Small',
      largeSocketIndex: 5,
      mediumSocketIndex: 0,
      outerGroupIndex: 0,
      subgraphBaseId: 65856,
    });

    // Round-trip encode
    expect(
      encodeClusterNodeId({
        nodeIndex: 9,
        sizeIndex: 1,
        largeSocketIndex: 4,
        mediumSocketIndex: 2,
      }),
    ).toBe(66841);

    // Non-cluster tree node IDs return null
    expect(decodeClusterNodeId(32763)).toBeNull();
    expect(decodeClusterNodeId(CLUSTER_NODE_SIGNAL_BIT - 1)).toBeNull();
    expect(POE1_EXPANSION_SOCKETS[32763]?.largeSocketIndex).toBe(4);
    expect(POE1_EXPANSION_SOCKETS[33753]).toMatchObject({
      socketSize: 1,
      largeSocketIndex: 4,
      mediumSocketIndex: 2,
    });
  });

  it('allocates exact partial Large 8-passive cluster (5 nodes, skipping back notable) + nested Medium 4-passive cluster', () => {
    // Large 8-passive cluster in socket 32763 (largeIdx=4) with 3 notables and 2 jewel sockets:
    // Template: sockets=[4, 8], notables=[2, 6, 10] (sorted by official PoB sortOrder!), smalls=[0, 7, 5].
    // Sort order: Sadist (112) < Prismatic Heart (116) < Widespread Destruction (117)
    //   -> idx 2 = Sadist (Front), idx 6 = Prismatic Heart (Back), idx 10 = Widespread Destruction (Front)
    // Player allocates ONLY 5 nodes: entrance(0), Front Notable 1(2), Front Notable 2(10), plus small(5),
    // and skips Back Notable(6) and small(7) -> actually let's allocate 0, 2, 5, 7, 10 (5 nodes, skipping back notable 6!).
    const largeJewel = mkItem({
      id: 'large-1',
      name: 'Hypnotic Ruin',
      baseName: 'Large Cluster Jewel',
      implicits: [
        '{crafted}Adds 8 Passive Skills',
        '{crafted}2 Added Passive Skills are Jewel Sockets',
        '{crafted}Added Small Passive Skills grant: 12% increased Elemental Damage',
      ],
      explicits: [
        'Added Small Passive Skills also grant: +4 to Maximum Life',
        'Added Small Passive Skills have 25% increased Effect',
        '1 Added Passive Skill is Widespread Destruction',
        '1 Added Passive Skill is Sadist',
        '1 Added Passive Skill is Prismatic Heart',
      ],
    });

    // Nested Medium 4-passive cluster in socket 33753 (largeIdx=4, medIdx=2):
    // Template for 4-passive Medium with 1 socket & 2 notables: socket=[6], notables=[3, 9], smalls=[0].
    // Player allocates only 2 nodes: entrance small(0) + first notable(3), skipping second notable(9)!
    const mediumJewel = mkItem({
      id: 'med-1',
      name: 'Blight Orb',
      baseName: 'Medium Cluster Jewel',
      implicits: [
        '{crafted}Adds 4 Passive Skills',
        '{crafted}1 Added Passive Skill is a Jewel Socket',
        '{crafted}Added Small Passive Skills grant: 10% increased Area Damage',
      ],
      explicits: [
        '1 Added Passive Skill is Vast Power',
        '1 Added Passive Skill is Towering Threat',
      ],
    });

    const notableDefs: Record<string, ClusterNotableDef> = {
      sadist: { en: 'Sadist', st: ['+20 to Strength'] },
      'prismatic heart': { en: 'Prismatic Heart', st: ['+10% to all Elemental Resistances'] },
      'widespread destruction': { en: 'Widespread Destruction', st: ['20% increased Elemental Damage'] },
      'vast power': { en: 'Vast Power', st: ['20% increased Area Damage'] },
      'towering threat': { en: 'Towering Threat', st: ['8% increased maximum Life'] },
    };

    // Large 4 allocated: idx 0, 2, 5, 7, 10 (5 nodes: 2 front notables + 3 smalls; back notable idx 6 NOT allocated!)
    // Medium (large 4, med 2) allocated: idx 0, 3 (2 nodes: 1 small + 1 notable Vast Power; Towering Threat idx 9 NOT allocated!)
    const allocatedNodeIds = [
      32763, // outer Large socket
      33753, // nested Medium socket
      encodeClusterNodeId({ nodeIndex: 0, sizeIndex: 2, largeSocketIndex: 4 }),
      encodeClusterNodeId({ nodeIndex: 2, sizeIndex: 2, largeSocketIndex: 4 }),
      encodeClusterNodeId({ nodeIndex: 5, sizeIndex: 2, largeSocketIndex: 4 }),
      encodeClusterNodeId({ nodeIndex: 7, sizeIndex: 2, largeSocketIndex: 4 }),
      encodeClusterNodeId({ nodeIndex: 10, sizeIndex: 2, largeSocketIndex: 4 }),
      encodeClusterNodeId({ nodeIndex: 0, sizeIndex: 1, largeSocketIndex: 4, mediumSocketIndex: 2 }),
      encodeClusterNodeId({ nodeIndex: 3, sizeIndex: 1, largeSocketIndex: 4, mediumSocketIndex: 2 }),
    ];

    const res = evaluateAllocatedClusterJewels(
      [
        { nodeId: 32763, jewel: largeJewel },
        { nodeId: 33753, jewel: mediumJewel },
      ],
      allocatedNodeIds,
      (name) => notableDefs[name.toLowerCase()],
    );

    expect(res.usedSubgraphAllocation).toBe(true);
    expect(res.entries).toHaveLength(2);

    const largeEntry = res.entries[0]!;
    expect(largeEntry.grantedNotableNames).toEqual(['Sadist', 'Widespread Destruction']);
    expect(largeEntry.grantedNotableNames).not.toContain('Prismatic Heart'); // Back notable skipped!
    expect(largeEntry.grantedSmallCount).toBe(3);
    // Small effect +25%: 12% -> floor(12 * 1.25) = 15%, +4 Life -> floor(4 * 1.25) = +5 Life
    expect(largeEntry.scaledSmallGrants).toEqual([
      '15% increased Elemental Damage',
      '+5 to Maximum Life',
    ]);

    const medEntry = res.entries[1]!;
    expect(medEntry.grantedNotableNames).toEqual(['Vast Power']);
    expect(medEntry.grantedNotableNames).not.toContain('Towering Threat');
    expect(medEntry.grantedSmallCount).toBe(1);

    // Verify exact ModDB totals
    const db = new ModDB();
    db.addMods(res.mods);
    expect(db.sum('BASE', 'Str')).toBe(20); // Sadist
    expect(db.sum('BASE', 'FireResist')).toBe(0); // Prismatic Heart skipped!
    expect(db.sum('INC', 'ElementalDamage')).toBe(20 + 15 * 3); // Widespread Destruction + 3 scaled smalls
    expect(db.sum('BASE', 'Life')).toBe(5 * 3); // 3 scaled smalls (+5 each)
    expect(db.sum('INC', 'Life')).toBe(0); // Towering Threat skipped!
    expect(db.sum('INC', 'Damage', ModFlag.Area)).toBe(20 + 10); // Vast Power + 1 Medium small
  });

  it('supports synthetic >= 65536 nested cluster jewel socket IDs and floors 35% small effect', () => {
    const nestedMediumSocketId = encodeClusterNodeId({
      nodeIndex: 4, // socket 0 of Large 0 -> maps to medIndex 0
      sizeIndex: 2,
      largeSocketIndex: 0,
    });
    const medJewel = mkItem({
      id: 'med-nested',
      name: 'Gale Ruin',
      baseName: 'Medium Cluster Jewel',
      implicits: [
        'Adds 5 Passive Skills',
        '1 Added Passive Skill is a Jewel Socket',
        'Added Small Passive Skills grant: +10 to Maximum Energy Shield',
      ],
      explicits: [
        'Added Small Passive Skills have 35% increased Effect',
        '1 Added Passive Skill is Flow of Life',
      ],
    });

    // Allocate entrance(0) + small(3) ONLY (skip notable at index 10!)
    const layout = getClusterTemplateLayout(1, 5, 1, 1);
    expect(layout.socketIndices).toEqual([6]);
    expect(layout.smallIndices).toContain(0);
    expect(layout.smallIndices).toContain(3);

    const allocIds = [
      encodeClusterNodeId({ nodeIndex: 0, sizeIndex: 1, largeSocketIndex: 0, mediumSocketIndex: 0 }),
      encodeClusterNodeId({ nodeIndex: 3, sizeIndex: 1, largeSocketIndex: 0, mediumSocketIndex: 0 }),
      // Even if a sub-socket index (6) were present, it must NEVER count as a small passive
      encodeClusterNodeId({ nodeIndex: 6, sizeIndex: 1, largeSocketIndex: 0, mediumSocketIndex: 0 }),
    ];

    const res = evaluateAllocatedClusterJewels(
      [{ nodeId: nestedMediumSocketId, jewel: medJewel }],
      allocIds,
      () => ({ en: 'Flow of Life', st: ['+100 to maximum Life'] }),
    );

    expect(res.entries[0]!.grantedNotableNames).toEqual([]);
    expect(res.entries[0]!.grantedSmallCount).toBe(2);
    // floor(10 * 1.35) = 13
    expect(scaleClusterGrantLine('+10 to Maximum Energy Shield', 35)).toBe(
      '+13 to Maximum Energy Shield',
    );
    const db = new ModDB();
    db.addMods(res.mods);
    expect(db.sum('BASE', 'EnergyShield')).toBe(26);
    expect(db.sum('BASE', 'Life')).toBe(0);
  });

  it('falls back gracefully to full-cluster grant when allocatedNodeIds has no >= 65536 IDs', () => {
    const smallJewel = mkItem({
      id: 'small-fallback',
      name: 'Loath Curio',
      baseName: 'Small Cluster Jewel',
      implicits: [
        'Adds 3 Passive Skills',
        'Added Small Passive Skills grant: 4% increased maximum Life',
      ],
      explicits: ['1 Added Passive Skill is Fettle'],
    });

    const res = evaluateAllocatedClusterJewels(
      [{ nodeId: 12613, jewel: smallJewel }],
      [12613], // No >= 65536 IDs (synthetic unit test mode)
      () => ({ en: 'Fettle', st: ['+20 to maximum Life', '10% increased maximum Life'] }),
    );

    expect(res.usedSubgraphAllocation).toBe(false);
    expect(res.entries[0]!.grantedNotableNames).toEqual(['Fettle']);
    expect(res.entries[0]!.grantedSmallCount).toBe(2);
    const db = new ModDB();
    db.addMods(res.mods);
    expect(db.sum('BASE', 'Life')).toBe(20);
    expect(db.sum('INC', 'Life')).toBe(18); // 10 + 4*2
  });
});

// ============================================================================
// 2. Pool-Zeroing & Conversion Keystones / Uniques Tests
// ============================================================================

describe('clusterAndReservation — Pool-Zeroing & Keystone/Unique Rules', () => {
  it('zeros Mana and grants non-duplicated 10% more Life for PoE 1 Blood Magic', () => {
    const db = new ModDB();
    db.addMod({ name: 'Life', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    db.addMod({ name: 'Mana', type: 'BASE', value: 800, flags: 0, keywordFlags: 0, source: 'Base' });

    const bmNode = mkNode(100, 'Blood Magic', 'keystone', [
      'Removes all mana',
      '10% more maximum Life',
      'Skills Cost Life instead of Mana',
      'Skills Reserve Life instead of Mana',
    ]);
    // Simulate engine.ts parsing the passive node first (which already emits 10% more Life)
    db.addMods(parseModLines(bmNode.stats, 'Tree: Blood Magic'));

    const res = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db,
      allocatedNodes: [bmNode],
    });

    expect(res.bloodMagic).toBe(true);
    expect(res.manaZeroed).toBe(true);
    expect(db.flag('BloodMagic')).toBe(true);
    expect(db.calcStat('Mana').total).toBe(0);
    // Must be 1100 (10% more once), NOT 1210 (double-applied)!
    expect(db.calcStat('Life').total).toBe(1100);

    // Also verify when granted without pre-parsed 10% more Life (e.g. unique granting Blood Magic)
    const db2 = new ModDB();
    db2.addMod({ name: 'Life', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    db2.addMod({ name: 'Mana', type: 'BASE', value: 500, flags: 0, keywordFlags: 0, source: 'Base' });
    applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: db2,
      equippedItems: [
        {
          slot: 'Helmet',
          item: mkItem({
            id: 'h1',
            name: "Malachai's Simula",
            baseName: 'Iron Mask',
            rarity: 'UNIQUE',
            explicits: ['Blood Magic'],
          }),
        },
      ],
    });
    expect(db2.calcStat('Mana').total).toBe(0);
    expect(db2.calcStat('Life').total).toBe(1100);
  });

  it('zeros Mana for PoE 2 Blood Magic and PoE 2 Infernalist Pyromantic Pact without PoE 1 Life MORE', () => {
    const dbBm = new ModDB();
    dbBm.addMod({ name: 'Life', type: 'BASE', value: 2000, flags: 0, keywordFlags: 0, source: 'Base' });
    dbBm.addMod({ name: 'Mana', type: 'BASE', value: 900, flags: 0, keywordFlags: 0, source: 'Base' });

    const poe2Bm = mkNode(51749, 'Blood Magic', 'keystone', [
      'You have no Mana',
      'Skill Mana Costs Converted to Life Costs',
    ]);
    const resBm = applyPoolZeroingAndKeystoneRules({
      game: 'poe2',
      db: dbBm,
      allocatedNodes: [poe2Bm],
    });

    expect(resBm.bloodMagic).toBe(true);
    expect(resBm.manaZeroed).toBe(true);
    expect(dbBm.calcStat('Mana').total).toBe(0);
    expect(dbBm.calcStat('Life').total).toBe(2000); // PoE 2 Blood Magic has no 10% more Life

    const dbPyro = new ModDB();
    dbPyro.addMod({ name: 'Mana', type: 'BASE', value: 1200, flags: 0, keywordFlags: 0, source: 'Base' });
    const pyroNode = mkNode(13174, 'Pyromantic Pact', 'notable', [
      'Maximum Mana is replaced by twice as much Maximum Infernal Flame',
    ]);
    const resPyro = applyPoolZeroingAndKeystoneRules({
      game: 'poe2',
      db: dbPyro,
      allocatedNodes: [pyroNode],
    });

    expect(resPyro.pyromanticPact).toBe(true);
    expect(resPyro.manaZeroed).toBe(false);
    expect(dbPyro.calcStat('Mana').total).toBe(1200);
  });

  it('zeros Energy Shield for Dissolution of the Flesh and The Agnostic', () => {
    const dbDiss = new ModDB();
    dbDiss.addMod({ name: 'Life', type: 'BASE', value: 4000, flags: 0, keywordFlags: 0, source: 'Base' });
    dbDiss.addMod({ name: 'EnergyShield', type: 'BASE', value: 1500, flags: 0, keywordFlags: 0, source: 'Gear' });

    const dissolution = mkItem({
      id: 'j-diss',
      name: 'Dissolution of the Flesh',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Removes all Energy Shield',
        'Life that would be lost by taking Damage is instead Reserved until you take no Damage to Life for 2 seconds',
        '30% more Maximum Life',
      ],
    });

    const resDiss = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: dbDiss,
      socketedJewels: [{ nodeId: 26725, jewel: dissolution }],
    });

    expect(resDiss.dissolutionOfTheFlesh).toBe(true);
    expect(resDiss.energyShieldZeroed).toBe(true);
    expect(dbDiss.calcStat('EnergyShield').total).toBe(0);
    expect(dbDiss.calcStat('Life').total).toBe(5200);

    const dbAgn = new ModDB();
    dbAgn.addMod({ name: 'EnergyShield', type: 'BASE', value: 900, flags: 0, keywordFlags: 0, source: 'Gear' });
    const resAgn = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: dbAgn,
      allocatedNodes: [mkNode(200, 'The Agnostic', 'keystone', ['Maximum Energy Shield is 0'])],
    });
    expect(resAgn.theAgnostic).toBe(true);
    expect(dbAgn.calcStat('EnergyShield').total).toBe(0);
  });

  it('handles Solipsism, Glancing Blows, Versatile Combatant, Supreme Ego, The Apostate, Fleshcrafter, and Blackbraid', () => {
    // 1. Solipsism + Glancing Blows + Versatile Combatant + Supreme Ego
    const db = new ModDB();
    db.addMod({ name: 'BlockChance', type: 'BASE', value: 40, flags: 0, keywordFlags: 0, source: 'Shield' });
    db.addMod({ name: 'SpellBlockChance', type: 'BASE', value: 20, flags: 0, keywordFlags: 0, source: 'Tree' });

    const res = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db,
      allocatedNodes: [
        mkNode(1, 'Solipsism', 'keystone', ['Intelligence provides no inherent bonus to Energy Shield']),
        mkNode(2, 'Glancing Blows', 'keystone', [
          'Chance to Block Attack Damage is doubled',
          'Chance to Block Spell Damage is doubled',
          'You take 65% of Damage from Blocked Hits',
        ]),
        mkNode(3, 'Versatile Combatant', 'keystone', [
          '-10% to maximum Chance to Block Attack Damage',
          '-10% to maximum Chance to Block Spell Damage',
          '+2% Chance to Block Spell Damage for each 1% Overcapped Chance to Block Attack Damage',
        ]),
        mkNode(4, 'Supreme Ego', 'keystone', [
          'Auras from your Skills can only affect you',
          '40% more Mana Reservation of Aura Skills',
        ]),
      ],
    });

    expect(res.solipsism).toBe(true);
    expect(res.noIntEsBonus).toBe(true);
    expect(db.flag('NoIntEsBonus')).toBe(true);

    expect(res.glancingBlows).toBe(true);
    expect(res.blockMultiplier).toBe(2);
    expect(res.spellBlockMultiplier).toBe(2);
    // Attack block: 40 * 2 = 80; Versatile Combatant lowers max block to 65 -> overcap = 15 -> +30% Spell Block!
    expect(db.calcStat('BlockChance').total).toBe(80);
    expect(res.versatileCombatant).toBe(true);
    expect(res.versatileCombatantSpellBlockBonus).toBe(30);
    expect(db.sum('BASE', 'BlockChanceMax')).toBe(-10);
    expect(db.sum('BASE', 'SpellBlockChanceMax')).toBe(-10);
    // Spell block: (20 base + 30 overcap bonus) * 2 = 100
    expect(db.calcStat('SpellBlockChance').total).toBe(100);
    expect(res.supremeEgo).toBe(true);
    expect(db.flag('SelfAurasOnlyAffectYou')).toBe(true);

    // 2. The Apostate (converts Armour ES -> Base Life)
    const dbApostate = new ModDB();
    dbApostate.addMod({ name: 'Life', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    dbApostate.addMod({ name: 'EnergyShield', type: 'BASE', value: 600, flags: 0, keywordFlags: 0, source: 'Item (Body Armour)' });
    const resApostate = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: dbApostate,
      equippedItems: [
        {
          slot: 'Body Armour',
          item: mkItem({
            id: 'apostate',
            name: 'The Apostate',
            baseName: 'Cabalist Regalia',
            rarity: 'UNIQUE',
            armourStats: { energyShield: 600 },
            localStatsPrecomputed: true,
            explicits: ['Gain Maximum Life instead of Maximum Energy Shield from Equipped Armour Items'],
          }),
        },
      ],
    });
    expect(resApostate.theApostate).toBe(true);
    expect(resApostate.apostateConvertedArmourEs).toBe(600);
    expect(dbApostate.calcStat('Life').total).toBe(1600);
    expect(dbApostate.calcStat('EnergyShield').total).toBe(0);

    // 3. Fleshcrafter with >= 50% Chaos Res -> 100% Life to ES
    const dbFlesh = new ModDB();
    const resFlesh = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: dbFlesh,
      minionChaosResist: 50,
      equippedItems: [
        {
          slot: 'Body Armour',
          item: mkItem({
            id: 'flesh',
            name: 'Fleshcrafter',
            baseName: 'Necromancer Silks',
            rarity: 'UNIQUE',
            explicits: ['Minions Convert 2% of their Maximum Life to Maximum Energy Shield per 1% Chaos Resistance they have'],
          }),
        },
      ],
    });
    expect(resFlesh.fleshcrafter).toBe(true);
    expect(resFlesh.fleshcrafterMinionLifeConvertToEsPct).toBe(100);
    expect(dbFlesh.flag('FleshcrafterMinionsZeroLife')).toBe(true);

    // 4. PoE 2 Blackbraid + Ghostwrithe + Scarred Faith
    const dbPoe2 = new ModDB();
    const resPoe2 = applyPoolZeroingAndKeystoneRules({
      game: 'poe2',
      db: dbPoe2,
      allocatedNodes: [mkNode(49547, 'Scarred Faith', 'keystone', ['You cannot Recover Energy Shield to above Armour'])],
      equippedItems: [
        {
          slot: 'Body Armour',
          item: mkItem({
            id: 'bb',
            name: 'Blackbraid',
            baseName: 'Fur Plate',
            rarity: 'UNIQUE',
            explicits: ['+120% of Armour also applies to Elemental Damage'],
          }),
        },
      ],
    });
    expect(resPoe2.blackbraid).toBe(true);
    expect(resPoe2.scarredFaith).toBe(true);
    expect(dbPoe2.sum('BASE', 'ArmourAppliesToEle')).toBe(120);
    expect(dbPoe2.flag('EsRecoveryCappedByArmour')).toBe(true);
  });
});

// ============================================================================
// 3. Active Aura, Generosity, The Hand of Phrecia & Watcher's Eye Tests
// ============================================================================

describe('clusterAndReservation — Auras, Generosity, The Hand of Phrecia & Watcher\'s Eye', () => {
  it('routes Generosity-linked auras to minionDb with scaled effect, keeps reservation, and blocks player Watcher\'s Eye', () => {
    const playerDb = new ModDB();
    playerDb.addMod({ name: 'Mana', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    // 50% global increased Aura Effect
    playerDb.addMod({ name: 'AuraEffect', type: 'INC', value: 50, flags: 0, keywordFlags: 0, source: 'Tree' });

    const watchersEye = mkItem({
      id: 'we-1',
      name: "Watcher's Eye",
      baseName: 'Prismatic Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'While affected by Determination, +800 to Armour',
        'Damage Penetrates 15% Cold Resistance while affected by Hatred',
        'Gain 10% of Maximum Mana as Extra Maximum Energy Shield while affected by Clarity',
        '12% chance to deal Double Damage while using Pride',
      ],
    });

    const build = mkBuild({
      items: { 'we-1': watchersEye },
      tree: {
        title: 'Default',
        treeVersion: '3_30',
        allocatedNodeIds: [26725],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 26725: 'we-1' },
      },
      skills: [
        // Group 1: Determination (affects player + minions) + Pride (enemy-only aura, counts for Watcher's Eye)
        {
          id: 'grp-self',
          label: 'Self Auras',
          enabled: true,
          gems: [
            { instanceId: 'g1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true },
            { instanceId: 'g2', gemId: 'poe1_pride', level: 20, quality: 0, enabled: true },
          ],
        },
        // Group 2: Hatred linked with Generosity (39% aura effect) -> minionDb ONLY, still reserves 50% mana, NO player Watcher's Eye!
        {
          id: 'grp-gen',
          label: 'Generosity Hatred',
          enabled: true,
          gems: [
            { instanceId: 'g3', gemId: 'poe1_hatred', level: 20, quality: 0, enabled: true },
            { instanceId: 'g4', gemId: 'poe1_supportgenerosity', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });

    const res = evaluateAurasAndWatchersEye({
      build,
      playerDb,
      getGemByIdFn: lookupTestGem,
      maxMana: 1000,
    });

    // Determination affects player (50% aura effect -> +1500 Armour) + Watcher's Eye (+800 Armour) = 2300
    expect(res.activeAurasAffectingPlayer.has('Determination')).toBe(true);
    expect(res.activeAurasAffectingPlayer.has('Pride')).toBe(true);
    expect(res.activeAurasAffectingPlayer.has('Hatred')).toBe(false);
    expect(res.activeAurasAffectingPlayer.has('Clarity')).toBe(false);
    expect(res.activeAurasAffectingMinions.has('Hatred')).toBe(true);

    // Player gets Determination (+1500 Armour + 800 Watcher's Eye) and Pride Watcher's Eye (12% Double Damage),
    // but does NOT get Hatred's Phys-as-Cold nor Hatred's 15% Cold Pen Watcher's Eye nor Clarity's Mana-as-ES!
    expect(playerDb.sum('BASE', 'Armour')).toBe(1500 + 800);
    expect(playerDb.sum('BASE', 'PhysicalDamageGainAsCold')).toBe(0);
    expect(playerDb.sum('BASE', 'ColdPenetration')).toBe(0);
    expect(playerDb.sum('BASE', 'ManaAsExtraES')).toBe(0);
    expect(playerDb.sum('BASE', 'DoubleDamageChance')).toBe(12);

    // MinionDb receives Hatred scaled by 1 + (50 + 39) / 100 = 1.89 -> trunc(40 * 1.89) = 75% Phys as Extra Cold!
    expect(res.minionDb.sum('BASE', 'PhysicalDamageGainAsCold')).toBe(75);
    // MinionDb also receives Determination scaled by 1.5 -> +1500 Armour
    expect(res.minionDb.sum('BASE', 'Armour')).toBe(1500);

    // Generosity Hatred STILL reserves 50% mana (total: 50% Det + 50% Pride + 50% Hatred = 150%)
    expect(res.totalManaReservedPct).toBe(150);
    expect(res.manaReservations.find((r) => r.gemName === 'Hatred')?.effectivePct).toBe(50);
  });

  it('blocks ALL non-curse auras from playerDb and Watcher\'s Eye when The Hand of Phrecia is equipped', () => {
    const playerDb = new ModDB();
    playerDb.addMod({ name: 'Mana', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });

    const phrecia = mkItem({
      id: 'gloves-phrecia',
      name: 'The Hand of Phrecia',
      baseName: 'Mesh Gloves',
      rarity: 'UNIQUE',
      slotType: 'Gloves',
      explicits: ['Non-Curse Auras from your Skills only apply to Allies'],
    });
    const watchersEye = mkItem({
      id: 'we-phrecia',
      name: "Watcher's Eye",
      baseName: 'Prismatic Jewel',
      rarity: 'UNIQUE',
      explicits: [
        '+1% to all maximum Elemental Resistances while affected by Purity of Elements',
        '+15% chance to Suppress Spell Damage while affected by Grace',
      ],
    });

    const build = mkBuild({
      items: { 'gloves-phrecia': phrecia, 'we-phrecia': watchersEye },
      equipped: { Gloves: 'gloves-phrecia' },
      tree: {
        title: 'Default',
        treeVersion: '3_30',
        allocatedNodeIds: [26725],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 26725: 'we-phrecia' },
      },
      skills: [
        {
          id: 'grp-1',
          label: 'Allies Auras',
          enabled: true,
          gems: [
            { instanceId: 'g1', gemId: 'poe1_purityofelements', level: 20, quality: 0, enabled: true },
            { instanceId: 'g2', gemId: 'poe1_grace', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });

    const res = evaluateAurasAndWatchersEye({
      build,
      playerDb,
      getGemByIdFn: lookupTestGem,
      maxMana: 1000,
    });

    expect(res.hasHandOfPhrecia).toBe(true);
    expect(res.activeAurasAffectingPlayer.size).toBe(0);
    expect(res.activeAurasAffectingMinions.has('Purity of Elements')).toBe(true);
    expect(res.activeAurasAffectingMinions.has('Grace')).toBe(true);

    // Player gets 0 aura stats and 0 Watcher's Eye mods
    expect(playerDb.sum('BASE', 'FireResist')).toBe(0);
    expect(playerDb.sum('BASE', 'FireResistMax')).toBe(0);
    expect(playerDb.sum('BASE', 'Evasion')).toBe(0);
    expect(playerDb.sum('BASE', 'SpellSuppressionChance')).toBe(0);
    expect(res.watchersEyeMods).toHaveLength(0);

    // Minions get the full auras
    expect(res.minionDb.sum('BASE', 'FireResist')).toBe(34);
    expect(res.minionDb.sum('BASE', 'Evasion')).toBe(1500);

    // Both auras STILL reserve Mana (50% + 50% = 100%)
    expect(res.totalManaReservedPct).toBe(100);
  });

  it('handles Eternal/Divine/Guardian Blessing (0% reservation), Arrogance (~200% Life reservation + aura effect), and Prism Guardian', () => {
    const playerDb = new ModDB();
    playerDb.addMod({ name: 'Life', type: 'BASE', value: 4000, flags: 0, keywordFlags: 0, source: 'Base' });
    playerDb.addMod({ name: 'Mana', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });

    const prismGuardian = mkItem({
      id: 'shield-pg',
      name: 'Prism Guardian',
      baseName: 'Archon Kite Shield',
      rarity: 'UNIQUE',
      slotType: 'Weapon 2',
      explicits: [
        '+2 to Level of Socketed Aura Gems',
        'Socketed Gems Cost and Reserve Life instead of Mana',
        'Socketed Gems have 30% increased Reservation Efficiency',
      ],
    });

    const build = mkBuild({
      items: { 'shield-pg': prismGuardian },
      equipped: { 'Weapon 2': 'shield-pg' },
      skills: [
        // 1. Eternal Blessing + Determination -> 0% mana reservation, +24% aura effect (19% + 5% Q20)
        {
          id: 'grp-eb',
          label: 'Eternal Blessing Det',
          enabled: true,
          gems: [
            { instanceId: 'g1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true },
            { instanceId: 'g2', gemId: 'poe1_supporteternalblessing', level: 20, quality: 20, enabled: true },
          ],
        },
        // 2. Arrogance (Lv.20 Q20 -> 2.01x mult, +24% aura effect) + Precision (186 flat) -> Life reservation!
        {
          id: 'grp-arr',
          label: 'Arrogance Precision',
          enabled: true,
          gems: [
            { instanceId: 'g3', gemId: 'poe1_precision', level: 20, quality: 0, enabled: true },
            { instanceId: 'g4', gemId: 'poe1_supportarrogance', level: 20, quality: 20, enabled: true },
          ],
        },
        // 3. Prism Guardian socketed Discipline (35% base / 1.30 eff = 26.92% Life reserved!)
        {
          id: 'grp-pg',
          label: 'Prism Guardian Discipline',
          enabled: true,
          slot: 'Weapon 2',
          gems: [
            { instanceId: 'g5', gemId: 'poe1_discipline', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });

    const res = evaluateAurasAndWatchersEye({
      build,
      playerDb,
      getGemByIdFn: lookupTestGem,
      maxLife: 4000,
      maxMana: 1000,
    });

    // Mana reserved = 0 (Eternal Blessing is 0%, Precision & Discipline reserve Life!)
    expect(res.totalManaReservedPct).toBe(0);
    expect(res.totalManaReservedFlat).toBe(0);
    expect(res.manaReservations.find((r) => r.gemName === 'Determination')?.zeroedByBlessing).toBe(true);

    // Determination affected by Eternal Blessing (+24% aura effect): 1000 * 1.24 = 1240 Armour
    expect(playerDb.sum('BASE', 'Armour')).toBe(1240);

    // Arrogance Precision: +24% aura effect -> trunc(700 * 1.24) = 868 Accuracy; flat life reserved = trunc(186 * 2.01) = 373
    expect(playerDb.sum('BASE', 'Accuracy')).toBe(868);
    const arrRes = res.lifeReservations.find((r) => r.gemName === 'Precision');
    expect(arrRes?.pool).toBe('Life');
    expect(arrRes?.multiplier).toBeCloseTo(2.01, 2);
    expect(arrRes?.effectiveFlat).toBe(373);

    // Prism Guardian Discipline: 35% / 1.30 = 26.92% Life reserved (ceil(4000 * 0.2692) = 1077)
    const pgRes = res.lifeReservations.find((r) => r.gemName === 'Discipline');
    expect(pgRes?.pool).toBe('Life');
    expect(pgRes?.localEfficiencyPct).toBe(30);
    expect(pgRes?.effectivePct).toBe(26.92);
    expect(pgRes?.effectiveFlat).toBe(1077);
  });

  it('parses prefix, suffix, and infix Watcher\'s Eye aura conditions accurately', () => {
    expect(parseWatchersEyeCondition('While affected by Determination, +1000 to Armour')).toEqual({
      requiredAura: 'Determination',
      strippedModLine: '+1000 to Armour',
    });
    expect(
      parseWatchersEyeCondition('+1% to all maximum Elemental Resistances while affected by Purity of Elements'),
    ).toEqual({
      requiredAura: 'Purity of Elements',
      strippedModLine: '+1% to all maximum Elemental Resistances',
    });
    expect(
      parseWatchersEyeCondition('18% of Damage taken while affected by Clarity Recouped as Mana'),
    ).toEqual({
      requiredAura: 'Clarity',
      strippedModLine: '18% of Damage taken Recouped as Mana',
    });
    expect(
      parseWatchersEyeCondition('Your Hits Intimidate Enemies for 4 seconds while you are using Pride'),
    ).toEqual({
      requiredAura: 'Pride',
      strippedModLine: 'Your Hits Intimidate Enemies for 4 seconds',
    });
  });

  it('handles Small Cluster Jewel directly in an outer Large socket and real PoB node IDs', () => {
    // Matches real PoE 1 build layout: Small Cluster Jewel socketed directly in outer Large socket 21984 (largeIdx=5)
    // Nodes: 65856 (idx=0), 65858 (idx=2), 65860 (idx=4) -> 3 small passives with 25% increased Effect
    const smallResJewel = mkItem({
      id: 'small-21984',
      name: 'Foe Cut',
      baseName: 'Small Cluster Jewel',
      implicits: [
        '{crafted}Adds 3 Passive Skills',
        '{crafted}Added Small Passive Skills grant: 6% increased Mana Reservation Efficiency of Skills',
      ],
      explicits: [
        'Added Small Passive Skills also grant: +3% to Chaos Resistance',
        'Added Small Passive Skills also grant: +5 to Maximum Energy Shield',
        'Added Small Passive Skills have 25% increased Effect',
      ],
    });

    const res = evaluateAllocatedClusterJewels(
      [{ nodeId: 21984, jewel: smallResJewel }],
      [21984, 65856, 65858, 65860],
    );

    expect(res.usedSubgraphAllocation).toBe(true);
    expect(res.entries[0]!.grantedSmallCount).toBe(3);
    // floor(6 * 1.25) = 7, floor(3 * 1.25) = 3, floor(5 * 1.25) = 6
    const db = new ModDB();
    db.addMods(res.mods);
    expect(db.sum('INC', 'ManaReservationEfficiency')).toBe(21);
    expect(db.sum('BASE', 'ChaosResist')).toBe(9);
    expect(db.sum('BASE', 'EnergyShield')).toBe(18);
  });

  it('routes Blood Magic reservations to Life, supports Divine/Guardian Blessing, Awakened Generosity, Supreme Ego, and Mahuxotl/Ghostwrithe/CI', () => {
    // 1. Blood Magic + Determination reserves Life instead of Mana, while Divine/Guardian Blessing reserves 0%
    const bmDb = new ModDB();
    bmDb.addMod({ name: 'Life', type: 'BASE', value: 5000, flags: 0, keywordFlags: 0, source: 'Base' });
    bmDb.addMod({ name: 'Mana', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: bmDb,
      allocatedNodes: [mkNode(1, 'Blood Magic', 'keystone', ['Removes all mana'])],
    });
    expect(bmDb.calcStat('Mana').total).toBe(0);

    const bmBuild = mkBuild({
      skills: [
        {
          id: 'g-det',
          label: 'BM Det',
          enabled: true,
          gems: [{ instanceId: 'i1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true }],
        },
        {
          id: 'g-gb',
          label: 'Guardian Blessing Grace',
          enabled: true,
          gems: [
            { instanceId: 'i2', gemId: 'poe1_grace', level: 20, quality: 0, enabled: true },
            { instanceId: 'i3', gemId: 'poe1_supportguardiansblessing', level: 20, quality: 0, enabled: true },
          ],
        },
        {
          id: 'g-ag',
          label: 'Awakened Generosity Wrath',
          enabled: true,
          gems: [
            { instanceId: 'i4', gemId: 'poe1_wrath', level: 20, quality: 0, enabled: true },
            { instanceId: 'i5', gemId: 'poe1_supportawakenedgenerosity', level: 5, quality: 0, enabled: true },
          ],
        },
      ],
    });

    const bmRes = evaluateAurasAndWatchersEye({
      build: bmBuild,
      playerDb: bmDb,
      getGemByIdFn: lookupTestGem,
      maxLife: 5500,
      maxMana: 0,
    });

    expect(bmRes.totalManaReservedPct).toBe(0);
    // Determination (50%) + Awakened Generosity Wrath (50%) both reserve Life under Blood Magic = 100%; Grace is 0% via Guardian's Blessing
    expect(bmRes.totalLifeReservedPct).toBe(100);
    expect(bmRes.activeAurasAffectingPlayer.has('Determination')).toBe(true);
    expect(bmRes.activeAurasAffectingPlayer.has('Grace')).toBe(true);
    expect(bmRes.activeAurasAffectingPlayer.has('Wrath')).toBe(false);
    // Awakened Generosity Lv.5 grants +1 Aura gem level and 44% Aura Effect to minionDb
    const wrathEntry = bmRes.auras.find((a) => a.gemName === 'Wrath');
    expect(wrathEntry?.level).toBe(21);
    expect(wrathEntry?.generosityEffectPct).toBe(44);
    expect(bmRes.minionDb.more('LightningDamage')).toBeCloseTo(1.28, 2); // trunc(20 * 1.44) = 28% more

    // 2. Supreme Ego: 40% more Mana Reservation (50% -> 70%) + 1% more Aura Effect per 2% reserved (35% more) + SelfAurasOnlyAffectYou
    const egoDb = new ModDB();
    egoDb.addMod({ name: 'Mana', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Base' });
    applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: egoDb,
      allocatedNodes: [mkNode(2, 'Supreme Ego', 'keystone', ['Auras from your Skills can only affect you'])],
    });
    const egoRes = evaluateAurasAndWatchersEye({
      build: mkBuild({
        skills: [
          {
            id: 'g-ego',
            label: 'Ego Det',
            enabled: true,
            gems: [{ instanceId: 'i1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true }],
          },
        ],
      }),
      playerDb: egoDb,
      getGemByIdFn: lookupTestGem,
      maxMana: 1000,
    });
    expect(egoRes.totalManaReservedPct).toBe(70);
    expect(egoRes.activeAurasAffectingMinions.size).toBe(0);
    // 70% reserved -> floor(70/2) = 35% more aura effect -> +1350 Armour!
    expect(egoDb.sum('BASE', 'Armour')).toBe(1350);

    // 3. Mahuxotl's Machination + Ghostwrithe + Chaos Inoculation interaction
    const mahuDb = new ModDB();
    const mahuRes = applyPoolZeroingAndKeystoneRules({
      game: 'poe1',
      db: mahuDb,
      equippedItems: [
        {
          slot: 'Weapon 2',
          item: mkItem({
            id: 'mahu',
            name: "Mahuxotl's Machination",
            baseName: 'Steel Kite Shield',
            rarity: 'UNIQUE',
            explicits: ['Corrupted Soul', 'Divine Flesh', 'Eternal Youth', 'Everlasting Sacrifice', 'Immortal Ambition', 'Vaal Pact'],
          }),
        },
      ],
    });
    expect(mahuRes.mahuxotlsMachination).toBe(true);
    expect(mahuRes.immortalAmbition).toBe(true);
    expect(mahuDb.sum('BASE', 'EleTakenAsChaos')).toBe(50);
    expect(mahuDb.sum('BASE', 'LifeAsExtraES')).toBe(15);
    expect(mahuDb.flag('NoEsRecharge')).toBe(true);
    expect(mahuDb.flag('Overleech')).toBe(true);

    // CI blocks Ghostwrithe from adding LifeConvertToES
    const ciDb = new ModDB();
    const ciRes = applyPoolZeroingAndKeystoneRules({
      game: 'poe2',
      db: ciDb,
      allocatedNodes: [mkNode(56349, 'Chaos Inoculation', 'keystone', ['Maximum Life is 1'])],
      equippedItems: [
        {
          slot: 'Body Armour',
          item: mkItem({
            id: 'gw',
            name: 'Ghostwrithe',
            baseName: 'Tattered Robe',
            rarity: 'UNIQUE',
            explicits: ['50% of Maximum Life Converted to Energy Shield'],
          }),
        },
      ],
    });
    expect(ciRes.chaosInoculation).toBe(true);
    expect(ciRes.ghostwrithe).toBe(true);
    expect(ciDb.override('Life')).toBe(1);
    expect(ciDb.sum('BASE', 'LifeConvertToES')).toBe(0);
  });

  it('handles wrapped/specialized cluster notables (Purposeful Harbinger, Skill Mana Res Eff, Precise Focus, Weight Advantage, Surprise Sabotage, Rotten Claws, Renewal, Master of Fire)', () => {
    const clusterJewel = mkItem({
      id: 'cl-special',
      name: 'Blight Prism',
      baseName: 'Medium Cluster Jewel',
      implicits: ['Adds 4 Passive Skills', 'Added Small Passive Skills grant: 10% increased Damage'],
      explicits: [
        '1 Added Passive Skill is Purposeful Harbinger',
        '1 Added Passive Skill is Uncompromising',
        '1 Added Passive Skill is Precise Focus',
        '1 Added Passive Skill is Weight Advantage',
        '1 Added Passive Skill is Surprise Sabotage',
        '1 Added Passive Skill is Rotten Claws',
        '1 Added Passive Skill is Renewal',
        '1 Added Passive Skill is Master of Fire',
      ],
    });
    const defs: Record<string, ClusterNotableDef> = {
      'purposeful harbinger': {
        en: 'Purposeful Harbinger',
        st: [
          'Auras from your Skills have 8% increased Effect on you for',
          'each Herald affecting you, up to a maximum of 40%',
        ],
      },
      uncompromising: {
        en: 'Uncompromising',
        st: ['Determination has 50% increased Mana Reservation Efficiency'],
      },
      'precise focus': {
        en: 'Precise Focus',
        st: ["+20% to Critical Strike Multiplier if you've been Channelling for at least 1 second"],
      },
      'weight advantage': {
        en: 'Weight Advantage',
        st: ['4% chance to deal Double Damage while wielding a Mace, Sceptre or Staff'],
      },
      'surprise sabotage': {
        en: 'Surprise Sabotage',
        st: ['Mine Damage Penetrates 4% Elemental Resistances'],
      },
      'rotten claws': {
        en: 'Rotten Claws',
        st: ['Minions have a 12% chance to Impale on Hit with Attacks'],
      },
      renewal: {
        en: 'Renewal',
        st: ['Minions have 5% chance to deal Double Damage while they are on Full Life'],
      },
      'master of fire': {
        en: 'Master of Fire',
        st: ['Enemies within 3 metres have Fire Exposure'],
      },
    };
    const res = evaluateAllocatedClusterJewels(
      [{ nodeId: 12613, jewel: clusterJewel }],
      [12613],
      (name) => defs[name.toLowerCase()],
    );
    const db = new ModDB();
    db.addMods(res.mods);
    expect(db.sum('BASE', 'PurposefulHarbingerPerHerald')).toBe(8);
    expect(db.sum('INC', 'SkillManaReservationEfficiency:determination')).toBe(50);
    expect(db.sum('BASE', 'CritMultiplier')).toBe(0);
    db.setCondition('Channelling', true);
    expect(db.sum('BASE', 'CritMultiplier')).toBe(20);
    expect(db.sum('BASE', 'DoubleDamageChance')).toBe(0);
    db.setCondition('UsingMace', true);
    expect(db.sum('BASE', 'DoubleDamageChance')).toBe(4);
    expect(db.sum('BASE', 'FirePenetration', 0, KeywordFlag.Mine)).toBe(4);
    expect(db.sum('BASE', 'MinionImpaleChance', ModFlag.Attack)).toBe(12);
    expect(db.sum('BASE', 'MinionDoubleDamageChance')).toBe(5);
    expect(db.flag('MasterOfElementExposure:Fire')).toBe(true);
  });

  it('evaluates War Banner Valour with MaxValour + BannerAuraEffect + level-scaled per-Valour, Sublime Vision 3-pass ordering, Blood/Sand Stance sync, Combustion gating, and PoE 1 Exposure deduplication', () => {
    const warBannerDef: GemDefinition = {
      id: 'poe1_warbanner',
      name: { en: 'War Banner', zh: '战争旗帜' },
      category: 'active',
      game: 'poe1',
      color: 'red',
      tags: ['area', 'aura', 'banner', 'duration', 'physical', 'spell'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Aura,
      isAuraOrBuff: true,
      stats: ['4% more Physical Damage'],
      levelScaling: {
        18: {
          stats: ['4% more Physical Damage'],
          compiledMods: [
            {
              name: 'AuraEffect',
              type: 'MORE',
              value: 9,
              flags: 0,
              keywordFlags: 0,
              tags: [
                { type: 'Multiplier', var: 'BannerValour' },
                { type: 'Condition', var: 'BannerPlanted' },
              ],
            },
            {
              name: 'PhysicalDamage',
              type: 'MORE',
              value: 4,
              flags: 0,
              keywordFlags: 0,
              target: 'player',
              tags: [{ type: 'SkillType', skillType: 'Melee' }],
            },
          ],
        },
      },
    };
    const fleshAndStoneDef: GemDefinition = {
      id: 'poe1_fleshandstone',
      name: { en: 'Flesh and Stone', zh: '血肉与岩石' },
      category: 'active',
      game: 'poe1',
      color: 'red',
      tags: ['area', 'aura', 'spell'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Aura,
      manaReservationPct: 25,
      isAuraOrBuff: true,
      stats: [],
      compiledMods: [
        {
          name: 'PhysicalDamageTaken',
          type: 'MORE',
          value: 20,
          flags: 0,
          keywordFlags: 0,
          target: 'enemy',
          tags: [{ type: 'Condition', var: 'BloodStance' }],
        },
      ],
    };
    const combustionDef: GemDefinition = {
      id: 'poe1_combustion',
      name: { en: 'Combustion Support', zh: '燃烧辅助' },
      category: 'support',
      game: 'poe1',
      color: 'blue',
      tags: ['support', 'fire'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Fire,
      stats: [],
    };
    const waveOfConvictionDef: GemDefinition = {
      id: 'poe1_waveofconviction',
      name: { en: 'Wave of Conviction', zh: '定罪波' },
      category: 'active',
      game: 'poe1',
      color: 'blue',
      tags: ['spell', 'fire', 'lightning', 'physical'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Fire | KeywordFlag.Lightning,
      stats: [],
    };
    const customLookup = (game: 'poe1' | 'poe2', gemId: string) => {
      if (gemId === 'poe1_warbanner') return warBannerDef;
      if (gemId === 'poe1_fleshandstone') return fleshAndStoneDef;
      if (gemId === 'poe1_combustion') return combustionDef;
      if (gemId === 'poe1_waveofconviction') return waveOfConvictionDef;
      return lookupTestGem(game, gemId);
    };

    // 1. War Banner Lv18 @ 105 Valour (50 base + 55 MaxValour), +35% BannerAuraEffect + 12% AuraEffect -> 4 * 1.47 * (1 + 0.09*105) = 61.446 -> 61% MORE
    const bannerDb = new ModDB();
    bannerDb.addMod({ name: 'MaxValour', type: 'BASE', value: 55, flags: 0, keywordFlags: 0, source: 'Tree' });
    bannerDb.addMod({ name: 'BannerAuraEffect', type: 'INC', value: 35, flags: 0, keywordFlags: 0, source: 'Tree' });
    bannerDb.addMod({ name: 'AuraEffect', type: 'INC', value: 12, flags: 0, keywordFlags: 0, source: 'Tree' });
    bannerDb.addMod({ name: 'MasterOfElementExposure:Fire', type: 'FLAG', value: true, flags: 0, keywordFlags: 0, source: 'Cluster' });
    const bannerBuild = mkBuild({
      config: {
        ...mkBuild().config,
        rawInputs: {
          bannerPlanted: true,
          bannerValour: 105,
          bloodSandStance: 'SAND',
          conditionEnemyIgnited: false,
        },
      },
      skills: [
        {
          id: 'sg-banner',
          label: 'Banners & Utility',
          enabled: true,
          gems: [
            { instanceId: 'g1', gemId: 'poe1_warbanner', level: 18, quality: 0, enabled: true },
            { instanceId: 'g2', gemId: 'poe1_fleshandstone', level: 20, quality: 0, enabled: true },
          ],
        },
        {
          id: 'sg-woc',
          label: 'WoC + Combustion',
          enabled: true,
          gems: [
            { instanceId: 'g3', gemId: 'poe1_waveofconviction', level: 20, quality: 0, enabled: true },
            { instanceId: 'g4', gemId: 'poe1_combustion', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });
    const bannerRes = evaluateAurasAndWatchersEye({
      build: bannerBuild,
      playerDb: bannerDb,
      getGemByIdFn: customLookup,
      maxMana: 1000,
    });
    bannerDb.setEvalContext({ ...bannerDb.getEvalContext(), skillTypes: { Melee: true } });
    expect(bannerDb.more('PhysicalDamage')).toBeCloseTo(1.61, 4);
    // Case-insensitive "SAND" stance must NOT trigger Flesh and Stone BloodStance enemy MORE PhysicalDamageTaken!
    expect(bannerRes.enemyDb.more('PhysicalDamageTaken')).toBe(1);
    // Wave of Conviction (15% Fire Exposure) dominates Master of Fire (10%), deduplicated to -15% FireResist;
    // Combustion (-10% FireResist) must NOT fire when conditionEnemyIgnited is false!
    expect(bannerRes.enemyDb.sum('BASE', 'FireResist')).toBe(-15);

    // 2. Now enable conditionEnemyIgnited + BloodStance -> Combustion adds -10% (total -25%), Flesh & Stone activates
    const ignitedDb = new ModDB();
    const ignitedBuild = mkBuild({
      config: {
        ...mkBuild().config,
        rawInputs: {
          bloodSandStance: 'BLOOD',
          conditionEnemyIgnited: true,
        },
      },
      skills: [
        {
          id: 'sg-fs',
          label: 'Flesh and Stone',
          enabled: true,
          gems: [{ instanceId: 'g1', gemId: 'poe1_fleshandstone', level: 20, quality: 0, enabled: true }],
        },
        {
          id: 'sg-woc2',
          label: 'WoC + Combustion',
          enabled: true,
          gems: [
            { instanceId: 'g2', gemId: 'poe1_waveofconviction', level: 20, quality: 0, enabled: true },
            { instanceId: 'g3', gemId: 'poe1_combustion', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });
    const ignitedRes = evaluateAurasAndWatchersEye({
      build: ignitedBuild,
      playerDb: ignitedDb,
      getGemByIdFn: customLookup,
      maxMana: 1000,
    });
    expect(ignitedRes.enemyDb.more('PhysicalDamageTaken')).toBeCloseTo(1.2, 4);
    expect(ignitedRes.enemyDb.sum('BASE', 'FireResist')).toBe(-25);

    // 3. Sublime Vision disables other aura-tagged gems while keeping allowed aura + its Vaal counterpart
    const sublimeDb = new ModDB();
    const sublimeJewel = mkItem({
      id: 'j-sv',
      name: 'Sublime Vision',
      baseName: 'Prismatic Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Aura Skills other than Determination are Disabled',
        '+10% to Physical Damage Reduction while affected by Determination',
      ],
    });
    const sublimeBuild = mkBuild({
      items: { 'j-sv': sublimeJewel },
      tree: { ...mkBuild().tree, socketedJewels: { 26725: 'j-sv' } },
      skills: [
        {
          id: 'sg-auras',
          label: 'Auras',
          enabled: true,
          gems: [
            { instanceId: 'g1', gemId: 'poe1_determination', level: 20, quality: 0, enabled: true },
            { instanceId: 'g2', gemId: 'poe1_grace', level: 20, quality: 0, enabled: true },
          ],
        },
      ],
    });
    const sublimeRes = evaluateAurasAndWatchersEye({
      build: sublimeBuild,
      playerDb: sublimeDb,
      getGemByIdFn: customLookup,
      maxMana: 1000,
    });
    expect(sublimeRes.activeAurasAffectingPlayer.has('Determination')).toBe(true);
    expect(sublimeRes.activeAurasAffectingPlayer.has('Grace')).toBe(false);
    expect(sublimeDb.sum('BASE', 'Armour')).toBeGreaterThan(0);
    expect(sublimeDb.sum('BASE', 'Evasion')).toBe(0);
  });

  it('deduplicates PoE 2 Sigil of Power across duplicate groups and prevents MetaDeadeyeMarks from stacking dual Marks (Sniper + Freezing)', () => {
    const sigilDef: GemDefinition = {
      id: 'poe2_sigilofpower',
      name: { en: 'Sigil of Power', zh: '力量法印' },
      category: 'active',
      game: 'poe2',
      color: 'blue',
      tags: ['area', 'duration', 'spell', 'stages'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Spell,
      stats: [],
      compiledMods: [
        {
          name: 'Damage',
          type: 'MORE',
          value: 14,
          flags: ModFlag.Spell,
          keywordFlags: 0,
          target: 'player',
          tags: [{ type: 'Multiplier', var: 'SigilOfPowerStage' }],
        },
      ],
    };
    const metaMarksDef: GemDefinition = {
      id: 'poe2_metadeadeyemarks',
      name: { en: 'Called Shots', zh: '精准点名' },
      category: 'active',
      game: 'poe2',
      color: 'green',
      tags: ['meta', 'trigger'],
      modFlags: 0,
      keywordFlags: 0,
      stats: [],
    };
    const snipersMarkDef: GemDefinition = {
      id: 'poe2_snipersmark',
      name: { en: "Sniper's Mark", zh: '狙击印记' },
      category: 'active',
      game: 'poe2',
      color: 'green',
      tags: ['mark', 'duration'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Curse,
      stats: [],
      compiledMods: [
        {
          name: 'SelfCritMultiplier',
          type: 'BASE',
          value: 77,
          flags: 0,
          keywordFlags: 0,
          target: 'enemy',
        },
      ],
    };
    const freezingMarkDef: GemDefinition = {
      id: 'poe2_freezingmark',
      name: { en: 'Freezing Mark', zh: '冰霜印记' },
      category: 'active',
      game: 'poe2',
      color: 'green',
      tags: ['mark', 'cold', 'buff', 'duration'],
      modFlags: 0,
      keywordFlags: KeywordFlag.Curse,
      stats: [],
      compiledMods: [
        {
          name: 'DamageGainAsCold',
          type: 'BASE',
          value: 30,
          flags: 0,
          keywordFlags: 0,
          target: 'player',
        },
      ],
    };
    const poe2Lookup = (_game: 'poe1' | 'poe2', gemId: string) => {
      if (gemId === 'poe2_sigilofpower') return sigilDef;
      if (gemId === 'poe2_metadeadeyemarks') return metaMarksDef;
      if (gemId === 'poe2_snipersmark') return snipersMarkDef;
      if (gemId === 'poe2_freezingmark') return freezingMarkDef;
      return undefined;
    };

    // 1. Two Sigil of Power groups (socketed + Weapon 1 Swap Chiming Staff) apply MORE Spell Damage strictly ONCE
    const sigilDb = new ModDB();
    const sigilBuild = mkBuild({
      game: 'poe2',
      skills: [
        {
          id: 'sg-sigil-1',
          label: 'Sigil Socketed',
          enabled: true,
          gems: [{ instanceId: 's1', gemId: 'poe2_sigilofpower', level: 20, quality: 0, enabled: true }],
        },
        {
          id: 'sg-sigil-2',
          label: 'Sigil Swap Staff',
          slot: 'Weapon 1 Swap',
          enabled: true,
          gems: [{ instanceId: 's2', gemId: 'poe2_sigilofpower', level: 20, quality: 0, enabled: true }],
        },
      ],
    });
    evaluateAurasAndWatchersEye({
      build: sigilBuild,
      playerDb: sigilDb,
      getGemByIdFn: poe2Lookup,
      maxMana: 1000,
    });
    expect(sigilDb.more('Damage', ModFlag.Spell)).toBeCloseTo(1.14, 4);

    // 2. MetaDeadeyeMarks with both Sniper's Mark (lv18) and Freezing Mark (lv19) keeps only highest-level Mark (Freezing Mark)
    const dualMarkDb = new ModDB();
    const dualMarkBuild = mkBuild({
      game: 'poe2',
      skills: [
        {
          id: 'sg-meta',
          label: 'Called Shots',
          enabled: true,
          gems: [
            { instanceId: 'm0', gemId: 'poe2_metadeadeyemarks', level: 20, quality: 0, enabled: true },
            { instanceId: 'm1', gemId: 'poe2_snipersmark', level: 18, quality: 20, enabled: true },
            { instanceId: 'm2', gemId: 'poe2_freezingmark', level: 19, quality: 0, enabled: true },
          ],
        },
      ],
    });
    const dualMarkRes = evaluateAurasAndWatchersEye({
      build: dualMarkBuild,
      playerDb: dualMarkDb,
      getGemByIdFn: poe2Lookup,
      maxMana: 1000,
    });
    expect(dualMarkDb.sum('BASE', 'DamageGainAsCold')).toBe(30);
    expect(dualMarkRes.enemyDb.sum('BASE', 'SelfCritMultiplier')).toBe(0);

    // 3. MetaDeadeyeMarks with ONLY Sniper's Mark still applies Sniper's Mark normally
    const singleMarkDb = new ModDB();
    const singleMarkBuild = mkBuild({
      game: 'poe2',
      skills: [
        {
          id: 'sg-meta-single',
          label: 'Called Shots Single',
          enabled: true,
          gems: [
            { instanceId: 'm0', gemId: 'poe2_metadeadeyemarks', level: 20, quality: 0, enabled: true },
            { instanceId: 'm1', gemId: 'poe2_snipersmark', level: 18, quality: 20, enabled: true },
          ],
        },
      ],
    });
    const singleMarkRes = evaluateAurasAndWatchersEye({
      build: singleMarkBuild,
      playerDb: singleMarkDb,
      getGemByIdFn: poe2Lookup,
      maxMana: 1000,
    });
    expect(singleMarkRes.enemyDb.sum('BASE', 'SelfCritMultiplier')).toBe(77);
  });
});
