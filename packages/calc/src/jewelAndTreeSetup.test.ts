import { describe, expect, it } from 'vitest';
import type { Build, Item, PassiveNode, PassiveTreeData } from '@webpob/core';
import {
  applyClusterJewelAllocationFix,
  collectAllocatedAnointNodes,
  computeJewelEffectScale,
  computeSplitPersonalityDistance,
  evaluateRadiusAndDistanceJewels,
  getJewelRadiusPx,
  resolveActiveSocketedJewels,
  scaleJewelModLines,
  scaleStatLineNumeric,
} from './jewelAndTreeSetup.js';

function mkNode(
  id: number,
  name: string,
  kind: PassiveNode['kind'],
  x: number,
  y: number,
  stats: string[] = [],
  adjacent: number[] = [],
  ascendancyId?: string,
): PassiveNode {
  return {
    id,
    name: { en: name, zh: name },
    kind,
    x,
    y,
    stats,
    adjacent,
    ascendancyId,
  };
}

function mkItem(partial: Partial<Item> & { id: string; name: string; baseName: string }): Item {
  return {
    rarity: 'RARE',
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
    game: 'poe2',
    level: 95,
    classId: 'witch',
    ascendancyId: 'bloodmage',
    activeWeaponSet: 1,
    tree: {
      title: 'Default',
      treeVersion: '0_5',
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
      enemyLevel: 82,
      enemyIsBoss: 'Pinnacle',
      enemyFireResist: 50,
      enemyColdResist: 50,
      enemyLightningResist: 50,
      enemyChaosResist: 0,
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

describe('collectAllocatedAnointNodes', () => {
  const tree: PassiveTreeData = {
    game: 'poe2',
    version: '0_5',
    classStartNodeIds: { witch: 1 },
    nodes: {
      1: mkNode(1, 'Witch Start', 'start', 0, 0),
      32976: mkNode(32976, "Zarokh's Gift", 'notable', 100, 0, ['5% increased maximum Mana']),
      41000: mkNode(41000, 'Barbaric Strength', 'notable', 200, 0, ['+10 to Strength', '45% increased Critical Damage Bonus']),
      42001: mkNode(42001, 'Beastial Skin', 'notable', 300, 0, ['100% increased Evasion Rating from Equipped Body Armour']),
      42002: mkNode(42002, 'Subterfuge Mask', 'notable', 400, 0, ['+2 to Evasion Rating per 1 Maximum Energy Shield on Equipped Helmet']),
      42003: mkNode(42003, 'Pure Power', 'notable', 500, 0, ['2% increased Lightning Damage per 10 Intelligence']),
      50001: mkNode(50001, 'Knife in the Back', 'notable', 600, 0, ['+25% to Critical Strike Multiplier'], [], 'assassin'),
      50002: mkNode(50002, 'Unmatched Notable', 'notable', 700, 0, ['+10 to Intelligence'], [], 'assassin'),
    },
  };

  it('resolves Amulet anoints (Zarokh\'s Gift / Barbaric Strength) and ignores Voices socket lines', () => {
    const amulet = mkItem({
      id: 'amulet-1',
      name: 'Defiance of Destiny',
      baseName: 'Jade Amulet',
      rarity: 'UNIQUE',
      slotType: 'Amulet',
      implicits: ["{enchant}Allocates Zarokh's Gift"],
    });
    const helmet = mkItem({
      id: 'helm-1',
      name: 'Fate Corona',
      baseName: 'Ancestral Tiara',
      slotType: 'Helmet',
      implicits: ['Raven-Touched', '{enchant}Allocates Barbaric Strength'],
    });
    const voices = mkItem({
      id: 'jewel-voices',
      name: 'Voices',
      baseName: 'Sapphire',
      rarity: 'UNIQUE',
      explicits: ['Allocates 2 Sinister Jewel sockets'],
    });

    const build = mkBuild({
      items: { 'amulet-1': amulet, 'helm-1': helmet, 'jewel-voices': voices },
      equipped: { Amulet: 'amulet-1', Helmet: 'helm-1' },
      tree: {
        title: 'Default',
        treeVersion: '0_5',
        allocatedNodeIds: [1],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 26196: 'jewel-voices' },
      },
    });

    const nodes = collectAllocatedAnointNodes(build, tree, new Set([1]));
    expect(nodes.map((n) => n.name.en)).toEqual(["Zarokh's Gift", 'Barbaric Strength']);
  });

  it('resolves Megalomaniac 3 notables and deduplicates against activeTreeNodes', () => {
    const megalomaniac = mkItem({
      id: 'mega-1',
      name: 'Megalomaniac',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      explicits: [
        '{enchant}Allocates Beastial Skin',
        '{enchant}Allocates Subterfuge Mask',
        'Allocates Pure Power',
      ],
    });

    const build = mkBuild({
      items: { 'mega-1': megalomaniac },
      tree: {
        title: 'Default',
        treeVersion: '0_5',
        allocatedNodeIds: [1, 42002], // Subterfuge Mask already allocated on tree
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: { 62152: 'mega-1' }, // Even in a Voices virtual socket!
      },
    });

    const nodes = collectAllocatedAnointNodes(build, tree, new Set([1, 42002]));
    expect(nodes.map((n) => n.name.en)).toEqual(['Beastial Skin', 'Pure Power']);
  });

  it('grants matching Forbidden Flame + Forbidden Flesh ascendancy notable exactly once and ignores unpaired ones', () => {
    const flame = mkItem({
      id: 'ff-flame',
      name: 'Forbidden Flame',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Allocates Knife in the Back if you have the matching modifier on Forbidden Flesh',
      ],
    });
    const flesh = mkItem({
      id: 'ff-flesh',
      name: 'Forbidden Flesh',
      baseName: 'Cobalt Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Allocates Knife in the Back if you have the matching modifier on Forbidden Flame',
      ],
    });
    const unpairedFlame = mkItem({
      id: 'ff-unpaired',
      name: 'Forbidden Flame',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Allocates Unmatched Notable if you have the matching modifier on Forbidden Flesh',
      ],
    });

    const build = mkBuild({
      game: 'poe1',
      items: {
        'ff-flame': flame,
        'ff-flesh': flesh,
        'ff-unpaired': unpairedFlame,
      },
      tree: {
        title: 'Default',
        treeVersion: '3_30',
        allocatedNodeIds: [1],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: {
          18436: 'ff-flame',
          22748: 'ff-flesh',
          22749: 'ff-unpaired',
        },
      },
    });

    const nodes = collectAllocatedAnointNodes(build, tree, new Set([1]));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe(50001);
    expect(nodes[0]!.name.en).toBe('Knife in the Back');
  });
});

describe('resolveActiveSocketedJewels', () => {
  const tree: PassiveTreeData = {
    game: 'poe2',
    version: '0_5',
    classStartNodeIds: { witch: 1 },
    nodes: {
      1: mkNode(1, 'Start', 'start', 0, 0),
      21984: mkNode(21984, 'Jewel Socket', 'jewel', 100, 100),
      30001: mkNode(30001, 'WS2 Socket', 'jewel', 200, 200),
    },
  };

  it('preserves Voices Sinister sockets and historical sockets while excluding inactive Weapon Set sockets', () => {
    const normalJewel = mkItem({ id: 'j1', name: 'Maelstrom Hope', baseName: 'Time-Lost Sapphire' });
    const voicesJewel = mkItem({ id: 'j2', name: 'Hypnotic Splinter', baseName: 'Sapphire' });
    const ws2Jewel = mkItem({ id: 'j3', name: 'Swap Jewel', baseName: 'Emerald' });

    const build = mkBuild({
      game: 'poe2',
      activeWeaponSet: 1,
      items: { j1: normalJewel, j2: voicesJewel, j3: ws2Jewel },
      tree: {
        title: 'Default',
        treeVersion: '0_5',
        allocatedNodeIds: [1, 21984],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [30001],
        masteryEffects: {},
        socketedJewels: {
          21984: 'j1',
          26178: 'j2', // Voices Sinister socket (not in activeTreeNodes)
          30001: 'j3', // Inactive Weapon Set 2 socket -> excluded
        },
      },
    });

    const active = resolveActiveSocketedJewels(build, tree, new Set([1, 21984]));
    expect(active).toHaveLength(2);
    expect(active.find((j) => j.nodeId === 21984)?.isVoicesOrVirtual).toBe(false);
    expect(active.find((j) => j.nodeId === 26178)?.isVoicesOrVirtual).toBe(true);
    expect(active.find((j) => j.nodeId === 30001)).toBeUndefined();
  });
});

describe('computeJewelEffectScale & scaleStatLineNumeric', () => {
  it('scales numeric values with PoB integer truncation and preserves decimals', () => {
    expect(scaleStatLineNumeric('+6% to Fire Resistance', 1.48)).toBe('+8% to Fire Resistance');
    expect(scaleStatLineNumeric('20% increased maximum Energy Shield', 1.48)).toBe(
      '29% increased maximum Energy Shield',
    );
    expect(scaleStatLineNumeric('Adds 10 to 25 Fire Damage', 1.53)).toBe(
      'Adds 15 to 38 Fire Damage',
    );
    expect(scaleStatLineNumeric('+1.5% to Critical Hit Chance', 1.5)).toBe(
      '+2.2% to Critical Hit Chance',
    );
  });

  it('applies The Adorned 48% corrupted rare scaling and PoE 2 53% Effect of Suffixes', () => {
    const adorned = mkItem({
      id: 'adorned',
      name: 'The Adorned',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      corrupted: true,
      explicits: [
        '48% increased Effect of Jewel Socket Passive Skills containing Corrupted Rare Jewels',
      ],
    });

    const corruptedRare = mkItem({
      id: 'rare-1',
      name: 'Cataclysm Creed',
      baseName: 'Sapphire',
      rarity: 'RARE',
      corrupted: true,
      implicits: ['+6% to Fire Resistance'],
      explicits: [
        '20% increased maximum Energy Shield',
        '15% increased Spell Damage',
        '20% increased Critical Spell Damage Bonus',
        '10% increased Critical Hit Chance for Spells',
        '53% increased Effect of Suffixes',
      ],
      rawText: [
        'Prefixes:',
        'EnergyShield1',
        'SpellDamage1',
        'Suffixes:',
        'CritMulti1',
        'CritChance1',
        'Corrupted',
      ].join('\n'),
    });

    const uncorruptedRare = mkItem({
      id: 'rare-2',
      name: 'Plain Sapphire',
      baseName: 'Sapphire',
      rarity: 'RARE',
      corrupted: false,
      explicits: ['20% increased maximum Energy Shield'],
    });

    const allJewels = [adorned, corruptedRare, uncorruptedRare];

    const scale = computeJewelEffectScale(corruptedRare, allJewels, 'poe2');
    expect(scale.globalScale).toBeCloseTo(1.48, 5);
    expect(scale.prefixScale).toBeCloseTo(1, 5);
    expect(scale.suffixScale).toBeCloseTo(1.53, 5);

    const plainScale = computeJewelEffectScale(uncorruptedRare, allJewels, 'poe2');
    expect(plainScale.globalScale).toBe(1);

    const scaled = scaleJewelModLines(corruptedRare, allJewels, 'poe2');
    expect(scaled.implicits).toEqual(['+8% to Fire Resistance']);
    // Prefixes: 1.48x -> trunc(20*1.48)=29, trunc(15*1.48)=22
    expect(scaled.explicits[0]).toBe('29% increased maximum Energy Shield');
    expect(scaled.explicits[1]).toBe('22% increased Spell Damage');
    // Suffixes: 1.48 * 1.53 = 2.2644x -> trunc(20*2.2644)=45, trunc(10*2.2644)=22
    expect(scaled.explicits[2]).toBe('45% increased Critical Spell Damage Bonus');
    expect(scaled.explicits[3]).toBe('22% increased Critical Hit Chance for Spells');
  });
});

describe('evaluateRadiusAndDistanceJewels', () => {
  it('evaluates PoE 2 Time-Lost Notable radius grants, Notable Effect (+22%), and Against the Darkness', () => {
    const tree: PassiveTreeData = {
      game: 'poe2',
      version: '0_5',
      classStartNodeIds: { witch: 1 },
      nodes: {
        1: mkNode(1, 'Start', 'start', 0, 0),
        100: mkNode(100, 'Socket', 'jewel', 0, 0),
        101: mkNode(101, 'Notable A', 'notable', 500, 0, ['+10 to Strength']),
        102: mkNode(102, 'Notable B', 'notable', 0, 1400, ['+10 to Intelligence']),
        103: mkNode(103, 'Notable Out', 'notable', 2500, 0, ['+10 to Dexterity']),
        104: mkNode(104, 'Small In', 'small', 400, 400, ['+5 to Strength']),
      },
    };

    const timeLost = mkItem({
      id: 'tl-1',
      name: 'Brood Spark',
      baseName: 'Time-Lost Emerald',
      explicits: [
        'Upgrades Radius to Very Large',
        'Notable Passive Skills in Radius also grant 10% increased Critical Damage Bonus',
        '22% increased Effect of Notable Passive Skills in Radius',
      ],
    });

    const againstTheDarkness = mkItem({
      id: 'atd-1',
      name: 'Against the Darkness',
      baseName: 'Time-Lost Diamond',
      rarity: 'UNIQUE',
      explicits: [
        'Notable Passive Skills in Radius also grant Gain 4% of Damage as Extra Cold Damage',
      ],
    });

    expect(getJewelRadiusPx('Very Large', 'poe2')).toBe(1800);
    expect(getJewelRadiusPx('Large', 'poe2')).toBe(1560);

    const active = new Set([1, 100, 101, 102, 103, 104]);
    const res = evaluateRadiusAndDistanceJewels(
      [
        { nodeId: 100, jewel: timeLost },
        { nodeId: 100, jewel: againstTheDarkness },
      ],
      tree,
      active,
      1,
    );

    // Time-Lost Very Large (1800px): Notable A (500px) & Notable B (1400px) in radius; Notable Out (2500px) out
    const tlLines = res.addedStatLines.find((s) => s.source.includes('Brood Spark'))!.lines;
    expect(tlLines.filter((l) => l === '10% increased Critical Damage Bonus')).toHaveLength(2);
    // +22% Notable effect: trunc(10 * 1.22) - 10 = +2 Str and +2 Int
    expect(tlLines).toContain('+2 to Strength');
    expect(tlLines).toContain('+2 to Intelligence');
    expect(tlLines).not.toContain('+2 to Dexterity');

    // Against the Darkness Large (1560px): Notable A (500px) & Notable B (1400px) in radius
    const atdLines = res.addedStatLines.find((s) => s.source.includes('Against the Darkness'))!.lines;
    expect(atdLines).toEqual([
      'Gain 4% of Damage as Extra Cold Damage',
      'Gain 4% of Damage as Extra Cold Damage',
    ]);
  });

  it('evaluates PoE 1 The Light of Meaning, Might of the Meek, and Fluid Motion attribute conversion', () => {
    const tree: PassiveTreeData = {
      game: 'poe1',
      version: '3_30',
      classStartNodeIds: { shadow: 1 },
      nodes: {
        1: mkNode(1, 'Start', 'start', 0, 0),
        200: mkNode(200, 'Socket', 'jewel', 0, 0),
        201: mkNode(201, 'Small Str 1', 'small', 500, 0, ['+10 to Strength']),
        202: mkNode(202, 'Small Str 2', 'small', 0, 1000, ['+10 to Strength']),
        203: mkNode(203, 'Notable Str', 'notable', 1200, 0, ['+20 to Strength']),
        204: mkNode(204, 'Far Node', 'small', 3000, 0, ['+10 to Strength']),
      },
    };

    const lightOfMeaning = mkItem({
      id: 'lom',
      name: 'The Light of Meaning',
      baseName: 'Prismatic Jewel',
      rarity: 'UNIQUE',
      explicits: ['Passive Skills in Radius also grant +4% to Chaos Resistance'],
    });

    const mightOfTheMeek = mkItem({
      id: 'motm',
      name: 'Might of the Meek',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        '50% increased Effect of non-Keystone Passive Skills in Radius',
        'Notable Passive Skills in Radius grant nothing',
      ],
    });

    const fluidMotion = mkItem({
      id: 'fm',
      name: 'Fluid Motion',
      baseName: 'Viridian Jewel',
      rarity: 'UNIQUE',
      explicits: ['Strength from Passives in Radius is Transformed to Dexterity'],
    });

    const active = new Set([1, 200, 201, 202, 203, 204]);
    const res = evaluateRadiusAndDistanceJewels(
      [
        { nodeId: 200, jewel: lightOfMeaning },
        { nodeId: 200, jewel: mightOfTheMeek },
        { nodeId: 200, jewel: fluidMotion },
      ],
      tree,
      active,
      1,
    );

    // Light of Meaning: 3 allocated passive nodes in Large radius (1800px): 201, 202, 203
    const lomLines = res.addedStatLines.find((s) => s.source.includes('The Light of Meaning'))!.lines;
    expect(lomLines).toHaveLength(3);
    expect(lomLines[0]).toBe('+4% to Chaos Resistance');

    // Might of the Meek: suppresses notable 203, grants +50% (+5 Str) to smalls 201 and 202
    expect(res.suppressedNodeIds.has(203)).toBe(true);
    const motmLines = res.addedStatLines.find((s) => s.source.includes('Might of the Meek'))!.lines;
    expect(motmLines).toEqual(['+5 to Strength', '+5 to Strength']);

    // Fluid Motion: converts 10 + 10 + 20 = 40 Strength to 40 Dexterity
    expect(res.addedMods).toContainEqual(
      expect.objectContaining({ name: 'Str', type: 'BASE', value: -40 }),
    );
    expect(res.addedMods).toContainEqual(
      expect.objectContaining({ name: 'Dex', type: 'BASE', value: 40 }),
    );
  });

  it('evaluates PoE 1 Split Personality BFS shortest-path distance scaling', () => {
    // Graph: Start(1) -- N2 -- N3 -- N4 -- N5 -- Socket(6)
    // Plus a longer branch: Start(1) -- N7 -- N8 -- N9 -- N10 -- N11 -- Socket(6)
    const tree: PassiveTreeData = {
      game: 'poe1',
      version: '3_30',
      classStartNodeIds: { marauder: 1 },
      nodes: {
        1: mkNode(1, 'Marauder Start', 'start', 0, 0, [], [2, 7]),
        2: mkNode(2, 'N2', 'small', 100, 0, [], [1, 3]),
        3: mkNode(3, 'N3', 'small', 200, 0, [], [2, 4]),
        4: mkNode(4, 'N4', 'small', 300, 0, [], [3, 5]),
        5: mkNode(5, 'N5', 'small', 400, 0, [], [4, 6]),
        6: mkNode(6, 'Jewel Socket', 'jewel', 500, 0, [], [5, 11]),
        7: mkNode(7, 'N7', 'small', 0, 100, [], [1, 8]),
        8: mkNode(8, 'N8', 'small', 0, 200, [], [7, 9]),
        9: mkNode(9, 'N9', 'small', 0, 300, [], [8, 10]),
        10: mkNode(10, 'N10', 'small', 0, 400, [], [9, 11]),
        11: mkNode(11, 'N11', 'small', 0, 500, [], [10, 6]),
      },
    };

    const splitPersonality = mkItem({
      id: 'sp-1',
      name: 'Split Personality',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        "This Jewel's Socket has 25% increased effect per Allocated Passive Skill between",
        "it and your Class' starting location",
        '+5 to Strength',
        '+5 to Intelligence',
      ],
    });

    // Shortest path is 1 -> 2 -> 3 -> 4 -> 5 -> 6 (4 nodes strictly between Start and Socket)
    const active = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(computeSplitPersonalityDistance(tree, active, 1, 6)).toBe(4);

    const res = evaluateRadiusAndDistanceJewels(
      [{ nodeId: 6, jewel: splitPersonality }],
      tree,
      active,
      1,
    );

    // mult = 1 + 0.25 * 4 = 2.0 -> delta = trunc(5 * 2.0) - 5 = +5 Str, +5 Int
    expect(res.details[0]).toMatchObject({
      kind: 'split-personality',
      bfsDistance: 4,
    });
    expect(res.addedStatLines[0]!.lines).toEqual(['+5 to Strength', '+5 to Intelligence']);
  });

  it('scales Corrupted Magic Time-Lost Jewels via The Adorned inside evaluateRadiusAndDistanceJewels without double-scaling and excludes PoE 2 attribute travel nodes', () => {
    const tree: PassiveTreeData = {
      game: 'poe2',
      version: '0_5',
      nodes: {
        1: mkNode(1, 'Socket 1', 'jewel', 0, 0),
        2: mkNode(2, 'Socket 2', 'jewel', 5000, 0),
        10: mkNode(10, 'Heartbreaking', 'notable', 500, 0, [
          '25% increased Critical Damage Bonus',
          '+10 to Strength',
        ]),
        11: mkNode(11, 'Attribute', 'small', 300, 0, ['+5 to any Attribute']),
        12: mkNode(12, 'Fire Damage', 'small', 400, 0, ['10% increased Fire Damage']),
      },
      classStartNodeIds: {},
    };
    const active = new Set([1, 2, 10, 11, 12]);

    const adorned = mkItem({
      id: 'adorned',
      name: 'The Adorned',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      corrupted: true,
      explicits: [
        '100% increased Effect of Jewel Socket Passive Skills',
        'containing Corrupted Magic Jewels',
      ],
    });
    const timeLost = mkItem({
      id: 'tl1',
      name: 'Potent Time-Lost Sapphire',
      baseName: 'Time-Lost Sapphire',
      rarity: 'MAGIC',
      corrupted: true,
      explicits: [
        'Notable Passive Skills in Radius also grant 10% increased Critical Damage Bonus',
        'Small Passive Skills in Radius also grant +2% to Fire Resistance',
        '20% increased Effect of Notable Passive Skills in Radius',
      ],
    });

    // Direct call (un-pre-scaled): The Adorned +100% doubles 10% -> 20%, +2% -> +4%, 20% notable effect -> 40%
    const directRes = evaluateRadiusAndDistanceJewels(
      [
        { nodeId: 1, jewel: timeLost },
        { nodeId: 2, jewel: adorned },
      ],
      tree,
      active,
      0,
    );
    expect(directRes.details[0]).toMatchObject({
      kind: 'time-lost',
      notablesInRadius: 1,
      smallsInRadius: 1, // Attribute travel node (11) excluded in PoE 2!
    });
    const directLines = directRes.addedStatLines[0]!.lines;
    expect(directLines).toContain('20% increased Critical Damage Bonus');
    expect(directLines).toContain('+4% to Fire Resistance');
    // Notable Heartbreaking (25% Crit Damage Bonus, +10 Str) scaled by +40% (1.4x) -> delta +10% Crit, +4 Str
    expect(directLines).toContain('10% increased Critical Damage Bonus');
    expect(directLines).toContain('+4 to Strength');

    // Pre-scaled call (like engine.ts): MUST produce identical lines with ZERO double-scaling!
    const preScaled = scaleJewelModLines(timeLost, [timeLost, adorned], 'poe2');
    const preScaledRes = evaluateRadiusAndDistanceJewels(
      [
        {
          nodeId: 1,
          jewel: { ...timeLost, implicits: preScaled.implicits, explicits: preScaled.explicits },
        },
        { nodeId: 2, jewel: adorned },
      ],
      tree,
      active,
      0,
    );
    expect(preScaledRes.addedStatLines[0]!.lines).toEqual(directLines);
  });

  it('evaluates PoE 1 Transcendent Flesh / Mind per-attribute Allocated and Unallocated radius modifiers', () => {
    const tree: PassiveTreeData = {
      game: 'poe1',
      version: '3_28',
      nodes: {
        1: mkNode(1, 'Jewel Socket', 'jewel', 0, 0),
        10: mkNode(10, 'Alloc Str', 'small', 400, 0, ['+10 to Strength']),
        11: mkNode(11, 'Unalloc Str 1', 'small', 600, 0, ['+10 to Strength']),
        12: mkNode(12, 'Unalloc Str 2', 'notable', 800, 0, ['+30 to Strength']),
        13: mkNode(13, 'Far Str', 'small', 3000, 0, ['+30 to Strength']),
      },
      classStartNodeIds: {},
    };
    const active = new Set([1, 10]);

    const tFlesh = mkItem({
      id: 'tf',
      name: 'Transcendent Flesh',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        '-1 Strength per 1 Strength on Allocated Passives in Radius',
        '+7% to Critical Strike Multiplier per 10 Strength on Unallocated Passives in Radius',
        '1% additional Physical Damage Reduction per 10 Strength on Allocated Passives in Radius',
      ],
    });

    const res = evaluateRadiusAndDistanceJewels([{ nodeId: 1, jewel: tFlesh }], tree, active, 0);
    expect(res.details[0]).toMatchObject({ kind: 'transcendent' });
    // Allocated in Medium radius (1440px): +10 Str -> -10 Str mod + 1% PDR
    expect(res.addedMods).toEqual([
      expect.objectContaining({ name: 'Str', type: 'BASE', value: -10 }),
    ]);
    // Unallocated in Medium radius: 10 + 30 = 40 Str -> 4 * 7% = +28% Crit Multi
    expect(res.addedStatLines[0]!.lines).toEqual([
      '+28% to Critical Strike Multiplier',
      '1% additional Physical Damage Reduction',
    ]);
  });

  it('evaluates Transcendent Flesh overlapping Lethal Pride (+4/+2 Str small passives) with exact PoB 1 getPerStat floor rounding', () => {
    // Socket 1 = Transcendent Flesh (Medium 1440px) at (0, 0)
    // Socket 2 = Lethal Pride (Large 1800px) at (500, 0)
    const nodes: PassiveTreeData['nodes'] = {
      1: mkNode(1, 'Jewel Socket', 'jewel', 0, 0),
      2: mkNode(2, 'Jewel Socket', 'jewel', 500, 0),
      // Unallocated Notable (+20 Str, untouched by Lethal Pride small-node rule)
      10: mkNode(10, 'Path of the Warrior', 'notable', 300, 0, ['+20 to Strength']),
      // Unallocated Attribute small (+10 Str base +2 Str Karui = 12 Str)
      11: mkNode(11, 'Strength', 'small', 400, 0, ['+10 to Strength']),
      // Unallocated non-attr small (+4 Str Karui each): 27 nodes -> 27 * 4 = 108 Str
      // Wait: 20 + 12 + 110 -> let's construct exact 142 Str = 20 (notable) + 12 (attr small) + 27 * 4 (non-attr small) + 2 (tattooed attr small)!
      12: mkNode(12, 'Tattooed Node', 'small', 450, 0, ['+10 to Strength']),
      // Allocated non-attr smalls inside both radii: 6 nodes * +4 Str = 24 alloc Str -> -24 Str & +7% Life Recovery Rate
    };
    const active = new Set<number>([1, 2]);
    for (let i = 0; i < 27; i++) {
      nodes[100 + i] = mkNode(100 + i, `Life ${i}`, 'small', 200 + i * 10, 100, [
        '5% increased maximum Life',
      ]);
    }
    for (let i = 0; i < 6; i++) {
      const id = 200 + i;
      nodes[id] = mkNode(id, `Proj ${i}`, 'small', 200 + i * 10, -100, [
        '8% increased Projectile Damage',
      ]);
      active.add(id);
    }

    const tree: PassiveTreeData = {
      game: 'poe1',
      version: '3_28',
      nodes,
      classStartNodeIds: {},
    };

    const tFlesh = mkItem({
      id: 'tf',
      name: 'Transcendent Flesh',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        '-1 Strength per 1 Strength on Allocated Passives in Radius',
        '+7% to Critical Strike Multiplier per 10 Strength on Unallocated Passives in Radius',
        '3% increased Life Recovery Rate per 10 Strength on Allocated Passives in Radius',
        '2% reduced Life Recovery Rate per 10 Strength on Unallocated Passives in Radius',
      ],
    });
    const lethalPride = mkItem({
      id: 'lp',
      name: 'Lethal Pride',
      baseName: 'Timeless Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Commanded leadership over 14954 warriors under Kaom',
        'Passives in radius are Conquered by the Karui',
      ],
    });

    // Override node 12 with a non-Str Tattoo (so base Str = 0, Karui adds +2 Str for tattooed small!)
    const nodeOverrides = {
      12: { name: 'Tattoo of the Ngamahu Firewalker', stats: ['+6% to Fire Resistance'] },
    };

    const res = evaluateRadiusAndDistanceJewels(
      [
        { nodeId: 1, jewel: tFlesh },
        { nodeId: 2, jewel: lethalPride },
      ],
      tree,
      active,
      0,
      undefined,
      nodeOverrides,
    );

    // Unallocated Str = 20 (notable) + (10 + 2) (Strength small) + (0 + 2) (tattooed small) + 27 * 4 (non-attr smalls) = 142
    // PoB 1 ModParser.lua:6504 exact floor: floor(142 * 7 / 10) = +99% CritMulti, floor(142 * 2 / 10) = 28% reduced Life Recovery Rate
    // Allocated Str = 6 * 4 = 24 -> -24 Str mod and floor(24 * 3 / 10) = 7% increased Life Recovery Rate
    expect(res.addedMods).toEqual([
      expect.objectContaining({ name: 'Str', type: 'BASE', value: -24 }),
    ]);
    expect(res.addedStatLines[0]!.lines).toEqual([
      '+99% to Critical Strike Multiplier',
      '7% increased Life Recovery Rate',
      '28% reduced Life Recovery Rate',
    ]);
  });

  it('evaluates Foulborn The Red Dream (including Ngamahu Firewalker Tattoos) and Nightmare resistance-in-radius conversions', () => {
    const tree: PassiveTreeData = {
      game: 'poe1',
      version: '3_30',
      nodes: {
        1: mkNode(1, 'Jewel Socket', 'jewel', 0, 0),
        10: mkNode(10, 'Barbarism', 'notable', 600, 0, ['8% increased maximum Life', '+8% to Fire Resistance']),
        11: mkNode(11, 'Diamond Skin', 'notable', 1600, 0, ['+15% to all Elemental Resistances']),
        12: mkNode(12, 'Strength', 'small', 900, 0, ['+10 to Strength']),
        13: mkNode(13, 'Out of Large Radius', 'notable', 2000, 0, ['+20% to Fire Resistance']),
      },
      classStartNodeIds: {},
    };
    const active = new Set([1, 10, 11, 12, 13]);
    const nodeOverrides: Record<number, { name?: string; stats?: string[] }> = {
      12: { name: 'Tattoo of the Ngamahu Firewalker', stats: ['+6% to Fire Resistance'] },
    };

    const foulbornRedDream = mkItem({
      id: 'frd',
      name: 'Foulborn The Red Dream',
      baseName: 'Crimson Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Gain 8% of Fire Damage as Extra Chaos Damage',
        '{mutated}Passives granting Fire Resistance or all Elemental Resistances in Radius',
        'also grant increased Maximum Life at 50% of its value',
      ],
    });

    const res = evaluateRadiusAndDistanceJewels(
      [{ nodeId: 1, jewel: foulbornRedDream }],
      tree,
      active,
      0,
      undefined,
      nodeOverrides,
    );
    expect(res.details[0]).toMatchObject({
      kind: 'resist-conversion',
      radiusLabel: 'Large',
      radiusPx: 1800,
    });
    // Per-mod Math.floor(val * 0.5): Barbarism (8->4) + Diamond Skin (15->7) + Ngamahu Tattoo (6->3) = 14% INC Life!
    // Node 13 at 2000px (> 1800px Large radius) is excluded.
    expect(res.addedMods).toEqual([
      expect.objectContaining({ name: 'Life', type: 'INC', value: 14 }),
    ]);

    const blueNightmare = mkItem({
      id: 'bn',
      name: 'The Blue Nightmare',
      baseName: 'Cobalt Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Passives granting Lightning Resistance or all Elemental Resistances in Radius',
        'also grant Chance to Block Spell Damage at 50% of its value',
      ],
    });
    const resBlue = evaluateRadiusAndDistanceJewels(
      [{ nodeId: 1, jewel: blueNightmare }],
      tree,
      active,
      0,
      undefined,
      nodeOverrides,
    );
    // Only Diamond Skin (+15% all Ele -> floor(15*0.5) = 7% Spell Block) matches Lightning/All Ele
    expect(resBlue.addedMods).toEqual([
      expect.objectContaining({ name: 'SpellBlockChance', type: 'BASE', value: 7 }),
    ]);

    const greenNightmare = mkItem({
      id: 'gn',
      name: 'The Green Nightmare',
      baseName: 'Viridian Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Passives granting Cold Resistance or all Elemental Resistances in Radius',
        'also grant Chance to Suppress Spell Damage at 50% of its value',
      ],
    });
    const resGreen = evaluateRadiusAndDistanceJewels(
      [{ nodeId: 1, jewel: greenNightmare }],
      tree,
      active,
      0,
      undefined,
      nodeOverrides,
    );
    expect(resGreen.addedMods).toEqual([
      expect.objectContaining({ name: 'SpellSuppressionChance', type: 'BASE', value: 7 }),
    ]);
  });
});

describe('applyClusterJewelAllocationFix', () => {
  const largeCluster = mkItem({
    id: 'cluster-1',
    name: 'Large Cluster Jewel',
    baseName: 'Large Cluster Jewel',
    implicits: [
      'Adds 8 Passive Skills',
      '2 Added Passive Skills are Jewel Sockets',
      'Added Small Passive Skills grant: 12% increased Cold Damage',
    ],
    explicits: [
      'Added Small Passive Skills have 25% increased effect',
      'Added Small Passive Skills also grant: +4 to Dexterity',
      '1 Added Passive Skill is Blanketed Snow',
      '1 Added Passive Skill is Doryani\'s Lesson',
    ],
  });

  it('prevents over-allocating unallocated small cluster nodes when >=65536 XML IDs are present', () => {
    // 8 total added = 2 sockets + 2 notables + 4 max smalls.
    // Suppose XML only allocated 6 cluster nodes total (2 sockets + 2 notables + 2 smalls):
    const rawIds = [100, 200, 65536, 65537, 65538, 65539, 65540, 65541];
    const res = applyClusterJewelAllocationFix(largeCluster, rawIds);

    expect(res.totalAdded).toBe(8);
    expect(res.socketCount).toBe(2);
    expect(res.notableNames).toEqual(['Blanketed Snow', "Doryani's Lesson"]);
    expect(res.maxSmallCount).toBe(4);
    expect(res.allocatedSmallCount).toBe(2);
    expect(res.usedRawClusterIds).toBe(true);
    // +25% small effect: 12 * 1.25 = 15%, 4 * 1.25 = 5
    expect(res.scaledSmallGrants).toEqual([
      '15% increased Cold Damage',
      '+5 to Dexterity',
    ]);
  });

  it('falls back cleanly to maxSmallCount when no raw >=65536 cluster IDs are provided', () => {
    const res = applyClusterJewelAllocationFix(largeCluster, [100, 200]);
    expect(res.usedRawClusterIds).toBe(false);
    expect(res.allocatedSmallCount).toBe(4);
  });
});

describe('PoE 2 The Adorned Sinister Sockets & Undying Hate Conquered Passives', () => {
  it('excludes PoE 2 Voices Sinister Jewel sockets from The Adorned scaling while still scaling normal tree sockets', () => {
    const tree: PassiveTreeData = {
      game: 'poe2',
      version: '0_5',
      classStartNodeIds: { druid: 1 },
      nodes: {
        1: mkNode(1, 'Start', 'start', 0, 0),
        100: mkNode(100, 'Tree Socket Normal', 'jewel', 200, 0),
        101: mkNode(101, 'Tree Socket Adorned', 'jewel', 400, 0),
        102: mkNode(102, 'Tree Socket Voices', 'jewel', 600, 0),
      },
    };
    const adorned = mkItem({
      id: 'adorned',
      name: 'The Adorned',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      explicits: ['48% increased Effect of Socketed Corrupted Magic or Rare Jewels'],
    });
    const voices = mkItem({
      id: 'voices',
      name: 'Voices',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      explicits: ['Allocates 3 Sinister Jewel sockets'],
    });
    const normalJewel = mkItem({
      id: 'j-normal',
      name: 'Normal Sapphire',
      baseName: 'Sapphire',
      rarity: 'RARE',
      corrupted: true,
      explicits: ['10% increased maximum Energy Shield'],
    });
    const sinisterJewel = mkItem({
      id: 'j-sinister',
      name: 'Sinister Sapphire',
      baseName: 'Sapphire',
      rarity: 'RARE',
      corrupted: true,
      explicits: ['10% increased maximum Energy Shield'],
    });

    const build = mkBuild({
      game: 'poe2',
      name: 'AdornedVoices',
      classId: 'druid',
      ascendancyId: 'oracle',
      level: 95,
      activeWeaponSet: 1,
      tree: {
        title: 'Default',
        treeVersion: '0_5',
        allocatedNodeIds: [1, 100, 101, 102],
        weaponSet1NodeIds: [],
        weaponSet2NodeIds: [],
        masteryEffects: {},
        socketedJewels: {
          100: 'j-normal',
          101: 'adorned',
          102: 'voices',
          // Virtual Voices Sinister socket ID absent from tree.nodes
          11184: 'j-sinister',
        },
      },
      items: {
        adorned,
        voices,
        'j-normal': normalJewel,
        'j-sinister': sinisterJewel,
      },
    });

    const activeNodes = new Set([1, 100, 101, 102]);
    const resolved = resolveActiveSocketedJewels(build, tree, activeNodes);
    const allJewels = resolved.map((r) => r.jewel);

    expect(computeJewelEffectScale(normalJewel, allJewels, 'poe2').globalScale).toBeCloseTo(1.48, 4);
    expect(computeJewelEffectScale(sinisterJewel, allJewels, 'poe2').globalScale).toBe(1);
  });

  it('evaluates PoE 2 Undying Hate Conquered Attribute/Small/Notable Passive Skills in Very Large (1800px) radius', () => {
    const tree: PassiveTreeData = {
      game: 'poe2',
      version: '0_3',
      classStartNodeIds: { witch: 1 },
      nodes: {
        1: mkNode(1, 'Start', 'start', 0, 0),
        21984: mkNode(21984, 'Jewel Socket', 'jewel', 0, 0),
        10382: mkNode(10382, 'Attribute', 'small', 954, 0, ['+5 to Intelligence']),
        4059: mkNode(4059, 'Attribute', 'small', 1620, 0, ['+5 to Intelligence']),
        9999: mkNode(9999, 'Attribute Far', 'small', 1950, 0, ['+5 to Intelligence']),
      },
    };
    const undyingHate = mkItem({
      id: 'uh-1',
      name: 'Undying Hate',
      baseName: 'Timeless Jewel',
      rarity: 'UNIQUE',
      explicits: [
        'Glorifying the defilement of 712 souls in tribute to Tecrod',
        'Passives in radius are Conquered by the Abyssals',
        'Conquered Attribute Passive Skills also grant +8 to Strength',
      ],
    });
    const res = evaluateRadiusAndDistanceJewels(
      [{ nodeId: 21984, jewel: undyingHate }],
      tree,
      new Set([1, 21984, 10382, 4059, 9999]),
      1,
    );
    const uhLines = res.addedStatLines.find((s) => s.source.includes('Undying Hate'))?.lines ?? [];
    // Both 954px and 1620px are inside Very Large (1800px), while 1950px is outside -> 2 x "+8 to Strength"
    expect(uhLines).toEqual(['+8 to Strength', '+8 to Strength']);
  });
});
