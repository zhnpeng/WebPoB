import { describe, expect, it } from 'vitest';
import { ModFlag, type Build, type Item, type PassiveNode } from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import {
  applyPoolConversionsAndKeystones,
  countItemSockets,
  evaluateBuildEnablingUniques,
  evaluateEquippedFocusScaling,
  evaluateIngenuityAndRingBonuses,
  evaluateMagebloodFlasks,
  evaluatePerSocketItemModifiers,
  evaluatePostPoolBuildEnablingUniques,
  evaluatePreStatBuildEnablingUniques,
  type ItemWithSocketCounts,
} from './uniqueMechanicsRuntime.js';

function makeItem(partial: Partial<ItemWithSocketCounts> & Pick<Item, 'id' | 'name' | 'baseName'>): ItemWithSocketCounts {
  return {
    rarity: 'UNIQUE',
    slotType: 'Any',
    quality: 0,
    implicits: [],
    explicits: [],
    ...partial,
  };
}

function makeNode(name: string, stats: string[] = []): PassiveNode {
  return {
    id: 1001,
    name: { en: name, zh: name },
    kind: 'keystone',
    x: 0,
    y: 0,
    stats,
    adjacent: [],
  };
}

function makeMinimalBuild(overrides?: Partial<Build>): Build {
  return {
    id: 'test-unique-mechanics',
    name: 'Test Build',
    game: 'poe1',
    level: 95,
    classId: 'shadow',
    ascendancyId: 'trickster',
    activeWeaponSet: 1,
    tree: {
      title: 'Default',
      treeVersion: '3_30',
      allocatedNodeIds: [],
      weaponSet1NodeIds: [],
      weaponSet2NodeIds: [],
      masteryEffects: {},
    },
    skills: [],
    mainSkillGroupId: '',
    items: {},
    equipped: {},
    activeFlaskSlots: {},
    config: {
      enemyLevel: 84,
      enemyIsBoss: 'None',
      enemyFireResist: 0,
      enemyColdResist: 0,
      enemyLightningResist: 0,
      enemyChaosResist: 0,
      enemyArmour: 0,
      enemyEvasion: 0,
      usePowerCharges: false,
      powerCharges: 3,
      useFrenzyCharges: false,
      frenzyCharges: 3,
      useEnduranceCharges: false,
      enduranceCharges: 3,
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

describe('uniqueMechanicsRuntime — 1. PoE 2 Ingenuity Utility Belt', () => {
  it('scales both equipped rings for legacy global Ingenuity (% increased bonuses gained from Equipped Rings)', () => {
    const db = new ModDB();
    const belt = makeItem({
      id: 'belt',
      name: 'Ingenuity',
      baseName: 'Utility Belt',
      explicits: ['80% increased bonuses gained from Equipped Rings'],
    });
    const ring1 = makeItem({
      id: 'r1',
      name: 'Breach Ring',
      baseName: 'Breach Ring',
      rarity: 'RARE',
      implicits: ['+25 to maximum Mana'],
      explicits: [
        '+45 to maximum Life',
        '+35% to Fire Resistance',
        'Adds 11 to 23 Lightning Damage to Attacks',
        'Regenerate 12.5 Life per second',
      ],
    });
    const ring2 = makeItem({
      id: 'r2',
      name: 'Amethyst Ring',
      baseName: 'Amethyst Ring',
      rarity: 'RARE',
      implicits: ['+17% to Chaos Resistance'],
      explicits: ['+30 to Intelligence', '20% increased Suffix Modifier magnitudes'],
    });

    // Ingest base 1.0x ring stats first
    db.addMods(parseModLines([...ring1.implicits, ...ring1.explicits], 'Item (Ring 1)'));
    db.addMods(parseModLines([...ring2.implicits, ...ring2.explicits], 'Item (Ring 2)'));

    const res = evaluateIngenuityAndRingBonuses(
      [
        { slot: 'Belt', item: belt },
        { slot: 'Ring 1', item: ring1 },
        { slot: 'Ring 2', item: ring2 },
      ],
      db,
    );

    expect(res.allRingsBonusPct).toBe(80);
    expect(res.rings).toHaveLength(2);

    // 45 * 1.8 = 81 (base 45 + delta 36)
    expect(db.sum('BASE', 'Life')).toBe(81);
    // 25 * 1.8 = 45 (base 25 + delta 20)
    expect(db.sum('BASE', 'Mana')).toBe(45);
    // 35 * 1.8 = 63
    expect(db.sum('BASE', 'FireResist')).toBe(63);
    // 11 * 1.8 = 19.8 -> trunc 19; 23 * 1.8 = 41.4 -> trunc 41
    expect(db.sum('BASE', 'LightningMin', ModFlag.Attack)).toBe(19);
    expect(db.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(41);
    // Decimal preservation: 12.5 * 1.8 = 22.5
    expect(db.sum('BASE', 'LifeRegen')).toBeCloseTo(22.5, 4);
    // Ring 2: 17 * 1.8 = 30.6 -> trunc 30; 30 * 1.8 = 54
    expect(db.sum('BASE', 'ChaosResist')).toBe(30);
    expect(db.sum('BASE', 'Int')).toBe(54);
  });

  it('scales Left Ring and Right Ring independently for PoE 2 0.2+/0.5 Ingenuity (including reduced bonuses)', () => {
    const db = new ModDB();
    const belt = makeItem({
      id: 'belt',
      name: 'Ingenuity',
      baseName: 'Utility Belt',
      explicits: [
        '30% increased bonuses gained from Equipped Left Ring',
        '20% reduced bonuses gained from Equipped Right Ring',
      ],
    });
    const leftRing = makeItem({
      id: 'r1',
      name: 'Left Ring',
      baseName: 'Sapphire Ring',
      rarity: 'RARE',
      explicits: ['+50 to maximum Life', '+40% to Cold Resistance'],
    });
    const rightRing = makeItem({
      id: 'r2',
      name: 'Right Ring',
      baseName: 'Topaz Ring',
      rarity: 'RARE',
      explicits: ['+50 to maximum Mana', '+40% to Lightning Resistance'],
    });

    db.addMods(parseModLines(leftRing.explicits, 'Item (Ring 1)'));
    db.addMods(parseModLines(rightRing.explicits, 'Item (Ring 2)'));

    const res = evaluateIngenuityAndRingBonuses(
      [
        { slot: 'Belt', item: belt },
        { slot: 'Ring 1', item: leftRing },
        { slot: 'Ring 2', item: rightRing },
      ],
      db,
    );

    expect(res.leftRingBonusPct).toBe(30);
    expect(res.rightRingBonusPct).toBe(-20);

    // Left Ring: +30% -> Life 50 * 1.3 = 65, ColdRes 40 * 1.3 = 52
    expect(db.sum('BASE', 'Life')).toBe(65);
    expect(db.sum('BASE', 'ColdResist')).toBe(52);
    // Right Ring: -20% -> Mana 50 * 0.8 = 40, LightRes 40 * 0.8 = 32
    expect(db.sum('BASE', 'Mana')).toBe(40);
    expect(db.sum('BASE', 'LightningResist')).toBe(32);
  });

  it('consumes non-item Ring1Effect / Ring2Effect INC from ModDB without double-counting Belt Ingenuity sources', () => {
    const db = new ModDB();
    const belt = makeItem({
      id: 'belt',
      name: 'Ingenuity',
      baseName: 'Utility Belt',
      explicits: ['20% increased bonuses gained from left Equipped Ring'],
    });
    const leftRing = makeItem({
      id: 'ring1',
      name: 'Sapphire Ring',
      baseName: 'Sapphire Ring',
      explicits: ['+100 to maximum Life'],
    });
    const rightRing = makeItem({
      id: 'ring2',
      name: 'Topaz Ring',
      baseName: 'Topaz Ring',
      explicits: ['+100 to maximum Mana'],
    });

    db.addMods(parseModLines(leftRing.explicits, 'Item (Ring 1)'));
    db.addMods(parseModLines(rightRing.explicits, 'Item (Ring 2)'));
    // Simulate Ingenuity belt already parsed into db as Ring1Effect (+20) + a separate Passive node (+10 Ring1Effect, +25 Ring2Effect)
    db.addMod({ name: 'Ring1Effect', type: 'INC', value: 20, flags: 0, keywordFlags: 0, source: 'Belt: Ingenuity' });
    db.addMod({ name: 'Ring1Effect', type: 'INC', value: 10, flags: 0, keywordFlags: 0, source: 'Passive: Ring Mastery' });
    db.addMod({ name: 'Ring2Effect', type: 'INC', value: 25, flags: 0, keywordFlags: 0, source: 'Passive: Ring Mastery' });

    const res = evaluateIngenuityAndRingBonuses(
      [
        { slot: 'Belt', item: belt },
        { slot: 'Ring 1', item: leftRing },
        { slot: 'Ring 2', item: rightRing },
      ],
      db,
    );

    // Belt +20% + Passive +10% = +30% (NOT double-counted to +50%!)
    expect(res.leftRingBonusPct).toBe(30);
    expect(res.rightRingBonusPct).toBe(25);
    expect(db.sum('BASE', 'Life')).toBe(130);
    expect(db.sum('BASE', 'Mana')).toBe(125);
  });
});

describe('uniqueMechanicsRuntime — 2. Morior Invictus & Per-Socket Modifiers', () => {
  it('scales 5-socket Morior Invictus (+13% Chaos Res, +56 Mana, +14 Spirit, 5% Attr, 10% Global Defences per Socket filled)', () => {
    const db = new ModDB();
    const morior = makeItem({
      id: 'body',
      name: 'Morior Invictus',
      baseName: 'Grand Regalia',
      sockets: 'S S S S S',
      implicits: [
        '{rune}+12% to Fire Resistance',
        '{rune}+12% to Cold Resistance',
        '{rune}+12% to Lightning Resistance',
        '{rune}+12% to Fire Resistance',
        '{rune}+12% to Cold Resistance',
      ],
      explicits: [
        '+13% to Chaos Resistance per Socket filled',
        '+56 to maximum Mana per Socket filled',
        '+14 to Spirit per Socket filled',
        '5% increased Attributes per Socket filled',
        '10% increased Global Defences per Socket filled',
        '10% increased Rarity of Items found per Socket filled',
      ],
    });

    const counts = countItemSockets(morior);
    expect(counts).toEqual({ totalSockets: 5, filledSockets: 5, emptySockets: 0 });

    const res = evaluatePerSocketItemModifiers([{ slot: 'Body Armour', item: morior }], db);
    expect(res.entries).toHaveLength(1);
    expect(db.sum('BASE', 'ChaosResist')).toBe(65);
    expect(db.sum('BASE', 'Mana')).toBe(280);
    expect(db.sum('BASE', 'Spirit')).toBe(70);
    expect(db.sum('INC', 'Str')).toBe(25);
    expect(db.sum('INC', 'Dex')).toBe(25);
    expect(db.sum('INC', 'Int')).toBe(25);
    expect(db.sum('INC', 'Armour')).toBe(50);
    expect(db.sum('INC', 'Evasion')).toBe(50);
    expect(db.sum('INC', 'EnergyShield')).toBe(50);

    // Calling again guards against double-counting
    const secondPass = evaluatePerSocketItemModifiers([{ slot: 'Body Armour', item: morior }], db);
    expect(secondPass.mods).toHaveLength(0);
    expect(db.sum('BASE', 'ChaosResist')).toBe(65);
    expect(db.sum('BASE', 'Spirit')).toBe(70);
  });

  it('handles Rune: lines in rawText and per Empty Socket modifiers accurately', () => {
    const db = new ModDB();
    const chest = makeItem({
      id: 'chest2',
      name: 'Socketed Chest',
      baseName: 'Grand Regalia',
      rawText: 'Sockets: S S S S S\nRune: Iron Rune\nRune: Iron Rune',
      explicits: [
        '+10% to all Elemental Resistances per Socketed Rune or Soul Core',
        '+50 to maximum Life per Empty Socket',
      ],
    });

    const counts = countItemSockets(chest);
    expect(counts).toEqual({ totalSockets: 5, filledSockets: 2, emptySockets: 3 });

    evaluatePerSocketItemModifiers([{ slot: 'Body Armour', item: chest }], db);
    expect(db.sum('BASE', 'FireResist')).toBe(20);
    expect(db.sum('BASE', 'ColdResist')).toBe(20);
    expect(db.sum('BASE', 'LightningResist')).toBe(20);
    expect(db.sum('BASE', 'Life')).toBe(150);
  });
});

describe('uniqueMechanicsRuntime — 3. Mageblood Auto-Active Magic Utility Flasks', () => {
  it('auto-activates 4 un-ticked Magic Utility Flasks with 25% + 70% = 95% increased effect (+9% max Res, +117% Armour, scaled Onslaught)', () => {
    const db = new ModDB();
    const mageblood = makeItem({
      id: 'belt',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      explicits: [
        'Magic Utility Flasks cannot be Used',
        'Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you',
      ],
    });
    const ruby = makeItem({
      id: 'f1',
      name: "Abecedarian's Ruby Flask of the Armadillo",
      baseName: 'Ruby Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect', '{enchant}Gains no Charges during Effect'],
      explicits: ['25% increased effect', '60% increased Armour during Effect'],
    });
    const granite = makeItem({
      id: 'f2',
      name: "Alchemist's Granite Flask of the Rainbow",
      baseName: 'Granite Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '+20% to all Elemental Resistances during Effect'],
    });
    const silver = makeItem({
      id: 'f3',
      name: "Dabbler's Silver Flask of the Cheetah",
      baseName: 'Silver Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '14% increased Movement Speed during Effect'],
    });
    const basalt = makeItem({
      id: 'f4',
      name: "Alchemist's Basalt Flask of the Owl",
      baseName: 'Basalt Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '60% increased Evasion Rating during Effect'],
    });
    const lifeFlask = makeItem({
      id: 'f5',
      name: 'Seething Divine Life Flask',
      baseName: 'Divine Life Flask',
      rarity: 'MAGIC',
      explicits: ['Instant Recovery'],
    });

    const build = makeMinimalBuild({
      items: { belt: mageblood, f1: ruby, f2: granite, f3: silver, f4: basalt, f5: lifeFlask },
      equipped: {
        Belt: 'belt',
        'Flask 1': 'f1',
        'Flask 2': 'f2',
        'Flask 3': 'f3',
        'Flask 4': 'f4',
        'Flask 5': 'f5',
      },
      // Notice: NONE of Flask 1..4 are ticked active in PoB XML!
      activeFlaskSlots: {},
    });

    const res = evaluateMagebloodFlasks(build, db, { alreadyActiveFlaskSlots: build.activeFlaskSlots });

    expect(res.magebloodLeftCount).toBe(4);
    expect(res.activatedSlots).toEqual(['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4']);
    expect(res.newlyActivatedSlots).toEqual(['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4']);
    expect(res.grantsOnslaught).toBe(true);
    expect(res.onslaughtEffectPct).toBe(39); // trunc(20 * 1.95) = 39

    // Ruby Flask: +5% max Fire Res * 1.95 = +9%, +40% Fire Res * 1.95 = +78%, +60% Armour * 1.95 = +117%
    expect(db.sum('BASE', 'FireResistMax')).toBe(9);
    // Fire Res = Ruby (+78) + Granite Rainbow (+39) = 117
    expect(db.sum('BASE', 'FireResist')).toBe(117);
    expect(db.sum('BASE', 'ColdResist')).toBe(39);
    expect(db.sum('INC', 'Armour')).toBe(117);
    // Granite base: 1500 * 1.95 = 2925
    expect(db.sum('BASE', 'Armour')).toBe(2925);
    // Basalt base: 20% more * 1.95 = 39% more Armour; suffix 60% * 1.95 = 117% Evasion INC
    expect(db.more('Armour')).toBeCloseTo(1.39, 4);
    expect(db.sum('INC', 'Evasion')).toBe(117);
    // Silver Onslaught (39%) + Cheetah (trunc(14 * 1.95) = 27%) = 66% Move Speed
    expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(39);
    expect(db.sum('INC', 'MovementSpeed')).toBe(66);
  });

  it('never double-counts already-active flasks and applies only missing effect delta when unscaled', () => {
    const db = new ModDB();
    const mageblood = makeItem({
      id: 'belt',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      explicits: ['Leftmost 2 Magic Utility Flasks constantly apply their Flask Effects to you'],
    });
    const ruby = makeItem({
      id: 'f1',
      name: "Alchemist's Ruby Flask of the Armadillo",
      baseName: 'Ruby Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '60% increased Armour during Effect'],
    });

    // Simulate Flask 1 already ingested at 1.0x base
    db.addMods(parseModLines(['+5% to maximum Fire Resistance', '+40% to Fire Resistance', '60% increased Armour'], 'Active Flask 1'));

    const res = evaluateMagebloodFlasks(
      [
        { slot: 'Belt', item: mageblood },
        { slot: 'Flask 1', item: ruby },
      ],
      db,
      { alreadyActiveFlaskSlots: new Set(['Flask 1']), alreadyScaledByEffect: false },
    );

    expect(res.deltaScaledSlots).toEqual(['Flask 1']);
    expect(db.sum('BASE', 'FireResistMax')).toBe(9); // 5 + 4 delta
    expect(db.sum('BASE', 'FireResist')).toBe(78); // 40 + 38 delta
    expect(db.sum('INC', 'Armour')).toBe(117); // 60 + 57 delta
  });
});

describe('uniqueMechanicsRuntime — 4. Build-Enabling Uniques (Pre-Stat & Post-Pool)', () => {
  it('evaluates Crystallised Omniscience: redirects Str/Dex/Int to Omni, restores class base, injects All Res & Ele Pen', () => {
    const db = new ModDB();
    db.addMod({ name: 'Str', type: 'BASE', value: 23, flags: 0, keywordFlags: 0, source: 'Class: Ranger' });
    db.addMod({ name: 'Dex', type: 'BASE', value: 32, flags: 0, keywordFlags: 0, source: 'Class: Ranger' });
    db.addMod({ name: 'Int', type: 'BASE', value: 14, flags: 0, keywordFlags: 0, source: 'Class: Ranger' });
    db.addMods(parseModLines(['+200 to Strength', '+400 to Dexterity', '+300 to Intelligence', '10% increased Strength'], 'Gear & Tree'));

    const omniAmulet = makeItem({
      id: 'amulet',
      name: 'Crystallised Omniscience',
      baseName: 'Onyx Amulet',
      explicits: [
        'Modifiers to Attributes instead apply to Omniscience',
        '+1% to all Elemental Resistances per 15 Omniscience',
        'Penetrate 1% Elemental Resistances per 15 Omniscience',
      ],
    });

    const res = evaluatePreStatBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Amulet', item: omniAmulet }],
    });

    expect(res.crystallisedOmniscienceActive).toBe(true);
    // Non-base flat = 200 + 400 + 300 = 900; INC = 10% -> 990 Omniscience
    expect(res.omniscienceTotal).toBe(990);
    // 990 / 15 = 66% all ele res & 66% ele penetration
    expect(res.omniscienceAllResBonus).toBe(66);
    expect(res.omniscienceElePenBonus).toBe(66);
    expect(db.sum('BASE', 'FireResist')).toBe(66);
    expect(db.sum('BASE', 'ColdResist')).toBe(66);
    expect(db.sum('BASE', 'LightningResist')).toBe(66);
    expect(db.sum('BASE', 'FirePenetration')).toBe(66);
    expect(db.sum('BASE', 'ColdPenetration')).toBe(66);
    expect(db.sum('BASE', 'LightningPenetration')).toBe(66);

    // Str/Dex/Int restored strictly to Ranger class base (23 / 32 / 14)
    expect(db.calcStat('Str').total).toBe(23);
    expect(db.calcStat('Dex').total).toBe(32);
    expect(db.calcStat('Int').total).toBe(14);
  });

  it('evaluates Ashes of the Stars, Heart of the Well, Original Sin, and Doryani\'s Prototype', () => {
    const db = new ModDB();
    const ashes = makeItem({
      id: 'amulet',
      name: 'Ashes of the Stars',
      baseName: 'Onyx Amulet',
      explicits: ['+1 to Level of all Skill Gems', '+30% to Quality of all Skill Gems'],
    });
    const heartOfTheWell = makeItem({
      id: 'jewel',
      name: 'Heart of the Well',
      baseName: 'Diamond',
      explicits: [
        'Gain 15% of Damage as Extra Damage of a random Element',
        'Gain 12% of Damage as Extra Chaos Damage',
        'Penetrate 10% Lightning Resistance',
      ],
    });
    const originalSin = makeItem({
      id: 'ring1',
      name: 'Original Sin',
      baseName: 'Amethyst Ring',
      explicits: [
        'All Elemental Damage Converted to Chaos Damage',
        "Nearby Enemies' Chaos Resistance is 0",
      ],
    });
    const doryani = makeItem({
      id: 'body',
      name: "Doryani's Prototype",
      baseName: 'Saint\'s Hauberk',
      explicits: ['Nearby Enemies have Lightning Resistance equal to yours'],
    });

    const res = evaluateBuildEnablingUniques({
      db,
      equippedItems: [
        { slot: 'Amulet', item: ashes },
        { slot: 'Ring 1', item: originalSin },
        { slot: 'Body Armour', item: doryani },
      ],
      socketedJewels: [heartOfTheWell],
      postPool: {
        str: 100,
        dex: 100,
        int: 100,
        life: 4000,
        mana: 1000,
        energyShield: 0,
        armour: 30000,
        evasion: 0,
        playerLightningResist: -160,
      },
    });

    expect(res.preStat.allSkillGemQualityBonus).toBe(30);
    expect(res.preStat.allSkillGemLevelBonus).toBe(1);
    expect(db.sum('BASE', 'GemQuality:all')).toBe(30);
    expect(db.sum('BASE', 'GemLevel:all')).toBe(1);

    // Heart of the Well: 15% random element -> 5% Fire, 5% Cold, 5% Lightning + 12% Chaos + 10% Light Pen
    expect(res.preStat.heartOfTheWellActive).toBe(true);
    expect(db.sum('BASE', 'DamageGainAsFire')).toBeCloseTo(5, 4);
    expect(db.sum('BASE', 'DamageGainAsCold')).toBeCloseTo(5, 4);
    expect(db.sum('BASE', 'DamageGainAsLightning')).toBeCloseTo(5, 4);
    expect(db.sum('BASE', 'DamageGainAsChaos')).toBe(12);
    expect(db.sum('BASE', 'LightningPenetration')).toBe(10);

    // Original Sin
    expect(res.preStat.originalSinActive).toBe(true);
    expect(res.preStat.enemyChaosResistOverride).toBe(0);
    expect(db.sum('BASE', 'FireDamageConvertToChaos')).toBe(100);
    expect(db.sum('BASE', 'ColdDamageConvertToChaos')).toBe(100);
    expect(db.sum('BASE', 'LightningDamageConvertToChaos')).toBe(100);
    expect(db.override('EnemyChaosResist')).toBe(0);

    // Doryani's Prototype
    expect(res.preStat.doryanisPrototypeActive).toBe(true);
    expect(res.postPool?.enemyLightningResistOverride).toBe(-160);
    expect(db.override('EnemyLightningResist')).toBe(-160);
  });

  it('evaluates Replica Alberon\'s Warpath and Iron Fortress strength-stacking synergy', () => {
    const db = new ModDB();
    const alberon = makeItem({
      id: 'boots',
      name: "Replica Alberon's Warpath",
      baseName: 'Soldier Boots',
      explicits: [
        'Adds 1 to 80 Chaos Damage to Attacks per 80 Strength',
        'Cannot deal Non-Chaos Damage',
      ],
    });
    const fortress = makeItem({
      id: 'body',
      name: 'The Iron Fortress',
      baseName: 'Crusader Plate',
      explicits: [
        '+1% Chance to Block Attack Damage per 50 Strength',
        "Strength's Damage Bonus instead grants 3% Melee Physical Damage per 10 Strength",
      ],
    });

    const res = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [
        { slot: 'Boots', item: alberon },
        { slot: 'Body Armour', item: fortress },
      ],
      str: 1600,
      dex: 100,
      int: 100,
      life: 5000,
      mana: 600,
      energyShield: 0,
      armour: 20000,
      evasion: 0,
    });

    // 1600 / 80 = 20 steps -> 20 to 1600 Chaos Damage to Attacks
    expect(res.replicaAlberonsChaosMin).toBe(20);
    expect(res.replicaAlberonsChaosMax).toBe(1600);
    expect(db.sum('BASE', 'ChaosMin', ModFlag.Attack)).toBe(20);
    expect(db.sum('BASE', 'ChaosMax', ModFlag.Attack)).toBe(1600);
    expect(db.flag('DealNoPhysical')).toBe(true);
    expect(db.flag('DealNoFire')).toBe(true);
    expect(db.flag('DealNoCold')).toBe(true);
    expect(db.flag('DealNoLightning')).toBe(true);

    // Iron Fortress: 1600 / 50 = +32% Attack Block; extra +1% per 10 Str = +160% Melee Physical
    expect(res.ironFortressBlockBonus).toBe(32);
    expect(db.sum('BASE', 'BlockChance')).toBe(32);
    expect(res.ironFortressExtraMeleePhysInc).toBe(160);
    expect(db.sum('INC', 'PhysicalDamage', ModFlag.Melee)).toBe(160);
  });

  it("reconciles Replica Alberon's Warpath continuous FlatMaxPerAttr scaling to exact stepped ChaosMax without double-counting", () => {
    const db = new ModDB();
    const str = 2154; // floor(2154 / 80) = 26 -> exact stepped 26..2080 (continuous FlatMaxPerAttr = 2154)
    const alberon = makeItem({
      id: 'boots',
      name: "Replica Alberon's Warpath",
      baseName: 'Soldier Boots',
      explicits: [
        'Adds 1 to 80 Chaos Damage to Attacks per 80 Strength',
        'Cannot deal Non-Chaos Damage',
      ],
    });

    // Step 1: Parse item mods as engine.ts does
    const itemSrc = `Item (Boots): ${alberon.name}`;
    db.addMods(parseModLines(alberon.explicits, itemSrc));

    // Step 2: Simulate engine.ts injectAttributeScaling continuous FlatMinPerAttr / FlatMaxPerAttr expansion
    for (const prefix of ['FlatMinPerAttr:', 'FlatMaxPerAttr:'] as const) {
      for (const [key, mods] of db.entriesByPrefix(prefix)) {
        const [, dmgType] = key.split(':');
        for (const mod of mods) {
          if (mod.type !== 'BASE' || typeof mod.value !== 'number') continue;
          const scaled = Math.floor(str * mod.value + 1e-9);
          if (scaled === 0) continue;
          db.addMod({
            name: `${dmgType}${prefix === 'FlatMinPerAttr:' ? 'Min' : 'Max'}`,
            type: 'BASE',
            value: scaled,
            flags: mod.flags,
            keywordFlags: mod.keywordFlags,
            source: `${mod.source} (Strength ${str})`,
          });
        }
      }
    }
    // Sanity check: continuous expansion produced 26..2154 before post-pool unique reconciliation
    expect(db.sum('BASE', 'ChaosMin', ModFlag.Attack)).toBe(26);
    expect(db.sum('BASE', 'ChaosMax', ModFlag.Attack)).toBe(2154);

    // Step 3: Post-pool unique evaluation must reconcile to exact stepped 26..2080 (NEVER 4234!)
    const res = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Boots', item: alberon }],
      str,
      dex: 100,
      int: 100,
      life: 5000,
      mana: 500,
      energyShield: 0,
      armour: 20000,
      evasion: 0,
    });
    expect(res.replicaAlberonsChaosMin).toBe(26);
    expect(res.replicaAlberonsChaosMax).toBe(2080);
    expect(db.sum('BASE', 'ChaosMin', ModFlag.Attack)).toBe(26);
    expect(db.sum('BASE', 'ChaosMax', ModFlag.Attack)).toBe(2080);
    expect(db.sum('BASE', 'ChaosMax')).toBe(2080);

    // Idempotent on second pass
    evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Boots', item: alberon }],
      str,
      dex: 100,
      int: 100,
      life: 5000,
      mana: 500,
      energyShield: 0,
      armour: 20000,
      evasion: 0,
    });
    expect(db.sum('BASE', 'ChaosMin', ModFlag.Attack)).toBe(26);
    expect(db.sum('BASE', 'ChaosMax', ModFlag.Attack)).toBe(2080);
  });

  it("handles The Iron Fortress canonical '3% increased Melee Physical Damage' wording and avoids double-counting when StrDmgBonusRatioOverride is already applied", () => {
    const fortress = makeItem({
      id: 'body',
      name: 'The Iron Fortress',
      baseName: 'Crusader Plate',
      explicits: [
        '+1% Chance to Block Attack Damage per 50 Strength',
        "Strength's Damage Bonus instead grants 3% increased Melee Physical Damage per 10 Strength",
      ],
    });

    // Standalone (no engine StrDmgBonusRatioOverride yet) -> adds extra +1% per 10 Str = +215% (for 2154 Str: 645 - 430 = 215)
    const dbStandalone = new ModDB();
    evaluatePostPoolBuildEnablingUniques({
      db: dbStandalone,
      equippedItems: [{ slot: 'Body Armour', item: fortress }],
      str: 2154,
      dex: 100,
      int: 100,
      life: 5000,
      mana: 500,
      energyShield: 0,
      armour: 20000,
      evasion: 0,
    });
    expect(dbStandalone.sum('BASE', 'BlockChance')).toBe(43);
    expect(dbStandalone.sum('INC', 'PhysicalDamage', ModFlag.Melee)).toBe(215);

    // When engine already applied StrDmgBonusRatioOverride (0.3) -> 0 extra added (no double-count!)
    const dbWithOverride = new ModDB();
    dbWithOverride.addMod({
      name: 'StrDmgBonusRatioOverride',
      type: 'BASE',
      value: 0.3,
      flags: 0,
      keywordFlags: 0,
      source: 'Item (Body Armour): The Iron Fortress',
    });
    dbWithOverride.addMod({
      name: 'PhysicalDamage',
      type: 'INC',
      value: 646,
      flags: ModFlag.Melee,
      keywordFlags: 0,
      source: 'Strength (Iron Fortress 2154)',
    });
    // Also simulate BlockChancePerAttr already expanded by injectAttributeScaling
    dbWithOverride.addMod({
      name: 'BlockChance',
      type: 'BASE',
      value: 43,
      flags: 0,
      keywordFlags: 0,
      source: 'Item (Body Armour): The Iron Fortress (Strength 2154)',
    });
    evaluatePostPoolBuildEnablingUniques({
      db: dbWithOverride,
      equippedItems: [{ slot: 'Body Armour', item: fortress }],
      str: 2154,
      dex: 100,
      int: 100,
      life: 5000,
      mana: 500,
      energyShield: 0,
      armour: 20000,
      evasion: 0,
    });
    expect(dbWithOverride.sum('BASE', 'BlockChance')).toBe(43);
    expect(dbWithOverride.sum('INC', 'PhysicalDamage', ModFlag.Melee)).toBe(646);
  });

  it('evaluates Crown of Eyes (150% Spell Damage -> Attack Damage) without double-counting', () => {
    const db = new ModDB();
    db.addMods(parseModLines(['120% increased Spell Damage', '50% increased Damage'], 'Tree'));

    const crown = makeItem({
      id: 'helm',
      name: 'Crown of Eyes',
      baseName: 'Hubris Circlet',
      explicits: [
        'Increases and Reductions to Spell Damage also apply to Attacks at 150% of their value',
      ],
    });

    const res = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Helmet', item: crown }],
      str: 100,
      dex: 100,
      int: 200,
      life: 4000,
      mana: 1000,
      energyShield: 2000,
      armour: 0,
      evasion: 0,
    });

    // Spell-only INC = 120% -> 150% of 120 = 180% Attack Damage INC (+50% global = 230% total)
    expect(res.crownOfEyesAttackInc).toBe(180);
    expect(db.sum('INC', 'Damage', ModFlag.Attack)).toBe(230);

    // Re-running does not double-count
    evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Helmet', item: crown }],
      str: 100,
      dex: 100,
      int: 200,
      life: 4000,
      mana: 1000,
      energyShield: 2000,
      armour: 0,
      evasion: 0,
    });
    expect(db.sum('INC', 'Damage', ModFlag.Attack)).toBe(230);
  });

  it('evaluates Ephemeral Edge and Energy Blade (PoE 3.23+ fixed 50% less ES, level-scaled base lightning, 1.7x 2H, quality AS)', () => {
    const db = new ModDB();
    const ephemeral = makeItem({
      id: 'w1',
      name: 'Ephemeral Edge',
      baseName: 'Dusk Blade',
      explicits: [
        "Attacks with this Weapon have Added Maximum Lightning Damage equal to 20% of Player's Maximum Energy Shield",
      ],
    });

    const eeRes = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Weapon 1', item: ephemeral }],
      str: 100,
      dex: 100,
      int: 400,
      life: 1,
      mana: 800,
      energyShield: 15000,
      armour: 0,
      evasion: 20000,
    });

    // 20% of 15,000 ES = 3,000 added maximum Lightning Damage
    expect(eeRes.ephemeralEdgeLightningMax).toBe(3000);
    expect(db.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(3000);

    // Energy Blade 2H Lv20 at 20% quality -> ALWAYS 50% less ES (10000 -> 5000 ES), +10% Attack Speed
    const ebDb = new ModDB();
    ebDb.addMod({ name: 'EnergyShield', type: 'BASE', value: 10000, flags: 0, keywordFlags: 0, source: 'Gear' });
    const ebRes = evaluatePostPoolBuildEnablingUniques({
      db: ebDb,
      equippedItems: [],
      str: 300,
      dex: 150,
      int: 600,
      life: 3000,
      mana: 1000,
      energyShield: 10000,
      armour: 0,
      evasion: 0,
      energyBlade: { active: true, twoHanded: true, gemLevel: 20, gemQuality: 20 },
    });

    expect(ebRes.energyBlade).not.toBeNull();
    expect(ebRes.energyBlade!.gemLevel).toBe(20);
    expect(ebRes.energyBlade!.lessEsPct).toBe(50);
    expect(ebRes.energyBlade!.postBladeEs).toBe(5000);
    expect(ebRes.energyBlade!.aps).toBe(1.6);
    expect(ebRes.energyBlade!.critChance).toBe(7);
    // 2H Lv20 (12..235 base + ceil(2%/40% of 5000) = 100..2000) * 1.7 (70% more) -> floor(190.4)=190, floor(3799.5)=3799
    expect(ebRes.energyBlade!.lightningMin).toBe(190);
    expect(ebRes.energyBlade!.lightningMax).toBe(3799);
    expect(ebDb.calcStat('EnergyShield').total).toBe(5000);
    expect(ebDb.sum('INC', 'Speed', ModFlag.Attack)).toBe(10); // floor(20 * 0.5) = 10% AS

    // Verified against live PoB1 LuaJIT on 1H Lv21 Q44 (pre-blade ES 17662 -> post-blade ES 8831 -> 190..3783, +22% AS)
    const eb1hDb = new ModDB();
    eb1hDb.addMod({ name: 'EnergyShield', type: 'BASE', value: 17662, flags: 0, keywordFlags: 0, source: 'Gear' });
    const eb1hRes = evaluatePostPoolBuildEnablingUniques({
      db: eb1hDb,
      equippedItems: [],
      str: 200,
      dex: 200,
      int: 800,
      life: 1,
      mana: 1000,
      energyShield: 17662,
      armour: 0,
      evasion: 0,
      activeSkills: [{ name: 'Energy Blade', level: 21, quality: 44, enabled: true }],
      isTwoHanded: false,
    });
    expect(eb1hRes.energyBlade!.lessEsPct).toBe(50);
    expect(eb1hRes.energyBlade!.postBladeEs).toBe(8831);
    expect(eb1hRes.energyBlade!.aps).toBe(1.7);
    expect(eb1hRes.energyBlade!.lightningMin).toBe(190); // 13 + ceil(8831 * 0.02) = 13 + 177
    expect(eb1hRes.energyBlade!.lightningMax).toBe(3783); // 250 + ceil(8831 * 0.40) = 250 + 3533
    expect(eb1hDb.sum('INC', 'Speed', ModFlag.Attack)).toBe(22);

    // Verified against live PoB1 LuaJIT on 1H Lv20 Q54 (pre-blade ES 11194 -> post-blade ES 5597 -> 124..2474, +27% AS)
    const eb20Db = new ModDB();
    eb20Db.addMod({ name: 'EnergyShield', type: 'BASE', value: 11194, flags: 0, keywordFlags: 0, source: 'Gear' });
    const eb20Res = evaluatePostPoolBuildEnablingUniques({
      db: eb20Db,
      equippedItems: [],
      str: 500,
      dex: 100,
      int: 500,
      life: 3000,
      mana: 1000,
      energyShield: 11194,
      armour: 0,
      evasion: 0,
      activeSkills: [{ name: 'Energy Blade', level: 20, quality: 54, enabled: true }],
      isTwoHanded: false,
    });
    expect(eb20Res.energyBlade!.postBladeEs).toBe(5597);
    expect(eb20Res.energyBlade!.lightningMin).toBe(124); // 12 + ceil(5597 * 0.02) = 12 + 112
    expect(eb20Res.energyBlade!.lightningMax).toBe(2474); // 235 + ceil(5597 * 0.40) = 235 + 2239
    expect(eb20Db.sum('INC', 'Speed', ModFlag.Attack)).toBe(27);
  });

  it('evaluates Rathpith Globe, Perseverance, HoWA, Brutus\' Lead Sprinkler, and Pillar of the Caged God', () => {
    const db = new ModDB();
    const rathpith = makeItem({
      id: 'shield',
      name: 'Rathpith Globe',
      baseName: 'Titanium Spirit Shield',
      explicits: [
        '5% increased Spell Damage per 100 Player Maximum Life',
        '5% increased Critical Strike Chance for Spells per 100 Player Maximum Life',
      ],
    });
    const perseverance = makeItem({
      id: 'belt',
      name: 'Perseverance',
      baseName: 'Vanguard Belt',
      explicits: [
        '1% increased Attack Damage per 200 of the lowest of Armour and Evasion Rating',
        'You have Onslaught while you have Fortify',
      ],
    });
    const howa = makeItem({
      id: 'claw',
      name: 'Hand of Wisdom and Action',
      baseName: 'Imperial Claw',
      explicits: [
        'Adds 1 to 10 Lightning Damage to Attacks with this Weapon per 10 Intelligence',
        '1% increased Attack Speed per 25 Dexterity',
      ],
    });
    const brutus = makeItem({
      id: 'mace',
      name: "Brutus' Lead Sprinkler",
      baseName: 'Ritual Sceptre',
      explicits: ['Adds 4 to 7 Fire Damage to Attacks with this Weapon per 10 Strength'],
    });
    const pillar = makeItem({
      id: 'staff',
      name: 'Pillar of the Caged God',
      baseName: 'Long Staff',
      explicits: [
        '16% increased Physical Weapon Damage per 10 Strength',
        '1% increased Attack Speed per 20 Dexterity',
      ],
    });

    const res = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [
        { slot: 'Weapon 2', item: rathpith },
        { slot: 'Belt', item: perseverance },
        { slot: 'Weapon 1', item: howa },
        { slot: 'Weapon 1 Swap', item: brutus },
        { slot: 'Weapon 2 Swap', item: pillar },
      ],
      str: 500,
      dex: 400,
      int: 800,
      life: 12000,
      mana: 1000,
      energyShield: 1000,
      armour: 50000,
      evasion: 40000,
      fortified: true,
    });

    // Rathpith: 12000 / 100 * 5 = +600% Spell Damage & +600% Spell Crit Chance
    expect(res.rathpithSpellDamageInc).toBe(600);
    expect(res.rathpithSpellCritInc).toBe(600);
    // Perseverance: min(50000, 40000) / 200 = +200% Attack Damage + Onslaught
    expect(res.perseveranceAttackInc).toBe(200);
    expect(res.perseveranceGrantedOnslaught).toBe(true);
    expect(db.sum('INC', 'MovementSpeed')).toBe(20);
    // HoWA: 800 / 10 -> 80..800 Lightning; 400 / 25 -> 16% AS
    expect(res.howaLightningMin).toBe(80);
    expect(res.howaLightningMax).toBe(800);
    expect(res.howaAttackSpeedInc).toBe(16);
    // Brutus: 500 / 10 -> 200..350 Fire
    expect(res.brutusFireMin).toBe(200);
    expect(res.brutusFireMax).toBe(350);
    // Pillar: 500 / 10 * 16 = 800% Phys Weapon Damage; 400 / 20 = 20% AS
    expect(res.pillarPhysWeaponInc).toBe(800);
    expect(res.pillarAttackSpeedInc).toBe(20);
  });
});

describe('uniqueMechanicsRuntime — 5. Pool-Conversion Keystones & Faithguard', () => {
  it('applies PoE 2 Eldritch Battery (base flat ES -> flat Mana scaled by Mana INC, ES = 0) and does NOT zero ES in PoE 1', () => {
    // PoE 2 case
    const dbPoe2 = new ModDB();
    dbPoe2.addMod({ name: 'EnergyShield', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Body Armour' });
    dbPoe2.addMod({ name: 'EnergyShield', type: 'INC', value: 150, flags: 0, keywordFlags: 0, source: 'Tree' });
    dbPoe2.addMod({ name: 'Mana', type: 'BASE', value: 500, flags: 0, keywordFlags: 0, source: 'Level' });
    dbPoe2.addMod({ name: 'Mana', type: 'INC', value: 100, flags: 0, keywordFlags: 0, source: 'Tree' });

    const res2 = applyPoolConversionsAndKeystones({
      game: 'poe2',
      db: dbPoe2,
      allocatedNodes: [makeNode('Eldritch Battery', ['Converts all Energy Shield to Mana'])],
    });

    expect(res2.poe2EldritchBattery).toBe(true);
    expect(res2.convertedEsToManaBase).toBe(1000);
    expect(res2.resolvedPools.energyShield).toBe(0);
    // Mana = (500 + 1000 base ES) * (1 + 100%) = 3000 (ES 150% INC does NOT scale converted ES!)
    expect(res2.resolvedPools.mana).toBe(3000);

    // PoE 1 case: Eldritch Battery does NOT convert ES to Mana or zero ES
    const dbPoe1 = new ModDB();
    dbPoe1.addMod({ name: 'EnergyShield', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Body Armour' });
    dbPoe1.addMod({ name: 'Mana', type: 'BASE', value: 500, flags: 0, keywordFlags: 0, source: 'Level' });

    const res1 = applyPoolConversionsAndKeystones({
      game: 'poe1',
      db: dbPoe1,
      allocatedNodes: [makeNode('Eldritch Battery', ['Energy Shield protects Mana instead of Life'])],
    });

    expect(res1.poe2EldritchBattery).toBe(false);
    expect(res1.resolvedPools.energyShield).toBe(1000);
    expect(res1.resolvedPools.mana).toBe(500);
    expect(dbPoe1.flag('EldritchBattery')).toBe(true);
  });

  it('applies Chaos Inoculation: Life = 1, ChaosResist = 100%, ChaosResistMax = 100%', () => {
    const db = new ModDB();
    db.addMod({ name: 'Life', type: 'BASE', value: 1800, flags: 0, keywordFlags: 0, source: 'Level & Gear' });
    db.addMod({ name: 'Life', type: 'INC', value: 120, flags: 0, keywordFlags: 0, source: 'Tree' });
    db.addMod({ name: 'ChaosResist', type: 'BASE', value: -60, flags: 0, keywordFlags: 0, source: 'Campaign Penalty' });
    db.addMod({ name: 'ChaosResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });

    const res = applyPoolConversionsAndKeystones({
      game: 'poe1',
      db,
      allocatedNodes: [makeNode('Chaos Inoculation', ['Maximum Life becomes 1, Immune to Chaos Damage'])],
    });

    expect(res.chaosInoculation).toBe(true);
    expect(res.resolvedPools.life).toBe(1);
    expect(res.resolvedPools.chaosResist).toBe(100);
    expect(res.resolvedPools.chaosResistMax).toBe(100);
    expect(db.flag('ChaosImmune')).toBe(true);
  });

  it('applies Iron Reflexes: converts flat Evasion to Armour without double-counting hybrid Armour/Evasion INC and strips Dex Evasion INC', () => {
    const db = new ModDB();
    db.addMod({ name: 'Armour', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Body Armour' });
    db.addMod({ name: 'Evasion', type: 'BASE', value: 2000, flags: 0, keywordFlags: 0, source: 'Grace' });
    db.addMod({ name: 'Armour', type: 'INC', value: 50, flags: 0, keywordFlags: 0, source: 'Tree: Pure Armour' });
    db.addMod({ name: 'Evasion', type: 'INC', value: 40, flags: 0, keywordFlags: 0, source: 'Tree: Pure Evasion' });
    // Hybrid Armour + Evasion mod from the same node -> MUST NOT be double-counted!
    db.addMods(parseModLines(['30% increased Armour and Evasion'], 'Tree: Leather and Steel'));
    // Inherent Dexterity Evasion INC -> MUST grant 0% under Iron Reflexes!
    db.addMod({ name: 'Evasion', type: 'INC', value: 60, flags: 0, keywordFlags: 0, source: 'Dexterity (300)' });

    const res = applyPoolConversionsAndKeystones({
      game: 'poe1',
      db,
      allocatedNodes: [makeNode('Iron Reflexes', ['Converts all Evasion Rating to Armour'])],
      dex: 300,
    });

    expect(res.ironReflexes).toBe(true);
    expect(res.resolvedPools.evasion).toBe(0);
    // Armour base 1000 scaled by (50 + 30)% = 1800
    // Evasion base 2000 scaled by Armour INC (50 + 30) + Evasion-only INC (40) = 120% (hybrid 30% counted ONCE, Dex 60% ignored!)
    // Converted = 2000 * 2.2 = 4400 -> Total Armour = 1800 + 4400 = 6200
    expect(res.evasionOnlyIncPct).toBe(40);
    expect(res.convertedEvasionToArmour).toBe(4400);
    expect(res.resolvedPools.armour).toBe(6200);
  });

  it('applies Faithguard: redirects net EnergyShield INC to Ward INC and computes EnergyShield with 0% INC', () => {
    const db = new ModDB();
    db.addMod({ name: 'EnergyShield', type: 'BASE', value: 500, flags: 0, keywordFlags: 0, source: 'Gear' });
    db.addMod({ name: 'EnergyShield', type: 'INC', value: 200, flags: 0, keywordFlags: 0, source: 'Tree' });
    db.addMod({ name: 'Ward', type: 'BASE', value: 1000, flags: 0, keywordFlags: 0, source: 'Olroth Gear' });
    db.addMod({ name: 'Ward', type: 'INC', value: 50, flags: 0, keywordFlags: 0, source: 'Gear' });

    const faithguard = makeItem({
      id: 'helm',
      name: 'Faithguard',
      baseName: 'Runic Crown',
      explicits: ['Increases and Reductions to Maximum Energy Shield instead apply to Ward'],
    });

    const res = applyPoolConversionsAndKeystones({
      game: 'poe1',
      db,
      equippedItems: [{ slot: 'Helmet', item: faithguard }],
    });

    expect(res.faithguard).toBe(true);
    expect(res.faithguardRedirectedIncPct).toBe(200);
    // EnergyShield computed with 0% INC -> 500
    expect(res.resolvedPools.energyShield).toBe(500);
    expect(db.calcStat('EnergyShield').incPct).toBe(0);
    // Ward gets +200% INC (total 250% INC) -> 1000 * 3.5 = 3500
    expect(res.resolvedPools.ward).toBe(3500);
    expect(db.calcStat('Ward').incPct).toBe(250);
  });

  it("handles PoE 2 Doryani's Prototype Presence wording down to -200% and ignores Rune: None in socket counts", () => {
    const db = new ModDB();
    const poe2Doryani = makeItem({
      id: 'body-dory2',
      name: "Doryani's Prototype",
      baseName: 'Scale Mail',
      slotType: 'Body Armour',
      explicits: ['Enemies in your Presence have Lightning Resistance equal to yours'],
      rawText: [
        'Sockets: S S S S',
        'Rune: Greater Iron Rune',
        'Rune: None',
        'Rune: None',
        'Rune: None',
      ].join('\n'),
    });

    // Only 1 filled rune socket (the 3 `Rune: None` lines must not count as filled!)
    expect(countItemSockets(poe2Doryani)).toEqual({
      totalSockets: 4,
      filledSockets: 1,
      emptySockets: 3,
    });

    const pre = evaluatePreStatBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Body Armour', item: poe2Doryani }],
      game: 'poe2',
    });
    expect(pre.doryanisPrototypeActive).toBe(true);

    // Syncs negative player Lightning Resistance down to -200% clamp
    const post = evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Body Armour', item: poe2Doryani }],
      str: 100,
      dex: 100,
      int: 100,
      life: 2000,
      mana: 500,
      energyShield: 0,
      armour: 5000,
      evasion: 0,
      playerLightningResist: -230,
    });
    expect(post.enemyLightningResistOverride).toBe(-200);
    expect(db.override('EnemyLightningResist')).toBe(-200);
  });

  it('evaluates Disciple of Varashta Instruments of Power (-50% Equipped Focus bonuses) with PoB 2 truncation', () => {
    const focus = makeItem({
      id: 'w2-focus',
      name: 'Ghoul Chant',
      baseName: 'Tasalian Focus',
      rarity: 'RARE',
      slotType: 'Weapon 2',
      explicits: [
        '+140 to maximum Energy Shield',
        '83% increased Spell Damage',
        '31% increased Critical Spell Damage Bonus',
      ],
    });
    const instrumentsNode = makeNode('Instruments of Power', [
      '50% reduced bonuses gained from Equipped Focus',
    ]);

    const db = new ModDB();
    db.addMods(
      parseModLines(
        ['83% increased Spell Damage', '31% increased Critical Spell Damage Bonus'],
        'Focus',
      ),
    );

    const res = evaluateEquippedFocusScaling([{ slot: 'Weapon 2', item: focus }], db, {
      allocatedNodes: [instrumentsNode],
    });

    expect(res.focusEffectPct).toBe(-50);
    expect(res.multiplier).toBe(0.5);
    expect(db.sum('INC', 'Damage', ModFlag.Spell)).toBe(42); // 83 - trunc(41.5) = 42
    expect(
      db.sum('INC', 'CritDamageBonusInc', ModFlag.Spell) +
        db.sum('INC', 'CritMultiplier', ModFlag.Spell),
    ).toBe(16); // 31 - trunc(15.5) = 16

    // Second call is a no-op because FocusEffectApplied prevents double-scaling
    const second = evaluateEquippedFocusScaling([{ slot: 'Weapon 2', item: focus }], db, {
      allocatedNodes: [instrumentsNode],
    });
    expect(second.mods).toHaveLength(0);
    expect(db.sum('INC', 'Damage', ModFlag.Spell)).toBe(42);
  });

  it('emits EnemyAffectedByEleAilmentCountsAsMoving for The Tempest Rising (3.25+ Presence wording) and counts exact 5 filled sockets on Morior Invictus', () => {
    const tempestDb = new ModDB();
    const tempestBoots = makeItem({
      id: 'boots-tr',
      name: 'The Tempest Rising',
      baseName: 'Goliath Greaves',
      slotType: 'Boots',
      explicits: [
        '120% increased Armour',
        '30% increased Movement Speed',
        'Damaging Ailments deal damage 24% Faster',
        'You and Enemies in your Presence count as moving while affected by Elemental Ailments',
      ],
    });
    evaluatePreStatBuildEnablingUniques({
      db: tempestDb,
      equippedItems: [{ slot: 'Boots', item: tempestBoots }],
      game: 'poe1',
    });
    expect(tempestDb.flag('EnemyAffectedByEleAilmentCountsAsMoving')).toBe(true);

    // Morior Invictus with 5 filled Soul Cores: exact +25% Attributes and +50% all Ele Res (no overcount)
    const morior = makeItem({
      id: 'body-mi5',
      name: 'Morior Invictus',
      baseName: 'Grand Regalia',
      slotType: 'Body Armour',
      explicits: [
        '247% increased Armour, Evasion and Energy Shield',
        '5% increased Attributes per Socketed Rune or Soul Core',
        '+10% to all Elemental Resistances per Socketed Rune or Soul Core',
      ],
      rawText: [
        'Sockets: S S S S S',
        'Rune: Soul Core of Citaqualotl',
        'Rune: Soul Core of Citaqualotl',
        'Rune: Soul Core of Citaqualotl',
        'Rune: Soul Core of Citaqualotl',
        'Rune: Soul Core of Citaqualotl',
      ].join('\n'),
    });
    expect(countItemSockets(morior)).toEqual({ totalSockets: 5, filledSockets: 5, emptySockets: 0 });
    const moriorDb = new ModDB();
    evaluatePerSocketItemModifiers([{ slot: 'Body Armour', item: morior }], moriorDb);
    expect(moriorDb.sum('INC', 'Str')).toBe(25);
    expect(moriorDb.sum('INC', 'Dex')).toBe(25);
    expect(moriorDb.sum('INC', 'Int')).toBe(25);
    expect(moriorDb.sum('BASE', 'FireResist')).toBe(50);
  });

  it("evaluates Left/Right ring slot mods (Shavronne's Revelation, Polaric Devastation), Xoph's Blood Ash, Singularity Hindered, Betrayal's Sting, Yaomac's Accord, and quality-scaled globals", () => {
    const db = new ModDB();
    const shavRing = makeItem({
      id: 'ring-left',
      name: "Shavronne's Revelation",
      baseName: 'Moonstone Ring',
      slotType: 'Ring 1',
      explicits: [
        'Left ring slot: +250 to maximum Mana',
        'Right ring slot: +250 to maximum Energy Shield',
      ],
    });
    const polaricRing = makeItem({
      id: 'ring-right',
      name: 'Polaric Devastation',
      baseName: 'Opal Ring',
      slotType: 'Ring 2',
      explicits: [
        'Left ring slot: Cover Enemies in Ash for 5 seconds when you Ignite them',
        'Right ring slot: Cover Enemies in Frost for 5 seconds when you Freeze them',
      ],
    });
    const xoph = makeItem({
      id: 'am-xoph',
      name: "Xoph's Blood",
      baseName: 'Amber Amulet',
      slotType: 'Amulet',
      explicits: ['Cover Enemies in Ash when they Hit you'],
    });
    const singularity = makeItem({
      id: 'wep-sing',
      name: 'Singularity',
      baseName: 'Platinum Sceptre',
      slotType: 'Weapon 1',
      explicits: ['Nearby Enemies are Hindered, with 25% reduced Movement Speed'],
    });
    const betrayal = makeItem({
      id: 'ring-bs',
      name: "Betrayal's Sting",
      baseName: 'Steel Ring',
      slotType: 'Ring 1',
      explicits: ['35% chance to inflict an additional Poison on the same Target when you inflict Poison'],
    });
    const yaomac = makeItem({
      id: 'wep-yao',
      name: "Yaomac's Accord",
      baseName: 'Vaal Sceptre',
      slotType: 'Weapon 1',
      explicits: [
        '120% increased Damage with Vaal Skills',
        '80% increased Critical Strike Chance with Vaal Skills',
      ],
    });
    const harvestWep = makeItem({
      id: 'wep-q',
      name: 'Glyph Sceptre',
      baseName: 'Opal Sceptre',
      slotType: 'Weapon 1',
      quality: 30,
      implicits: ['Quality does not increase Physical Damage', '1% increased Elemental Damage per 2% Quality'],
    });

    evaluatePreStatBuildEnablingUniques({
      db,
      equippedItems: [
        { slot: 'Ring 1', item: shavRing },
        { slot: 'Ring 2', item: polaricRing },
        { slot: 'Amulet', item: xoph },
        { slot: 'Weapon 1', item: singularity },
        { slot: 'Weapon 2', item: yaomac },
        { slot: 'Gloves', item: betrayal },
        { slot: 'Helmet', item: harvestWep },
      ],
      game: 'poe1',
    });

    // Ring 1 gets Left slot (+250 Mana, NOT +250 ES)
    expect(db.sum('BASE', 'Mana')).toBe(250);
    expect(db.sum('BASE', 'EnergyShield')).toBe(0);

    // Polaric Devastation Right Ring Frost requires EnemyFrozen; Xoph's Blood Ash is unconditional
    expect(db.sum('INC', 'EnemyFireDamageTaken')).toBe(20);
    expect(db.sum('INC', 'EnemyColdDamageTaken')).toBe(0);
    db.setCondition('EnemyFrozen', true);
    expect(db.sum('INC', 'EnemyColdDamageTaken')).toBe(20);

    // Singularity Hindered sets EnemyHindered condition
    expect(db.getEvalContext().conditions.EnemyHindered).toBe(true);

    // Betrayal's Sting adds AdditionalPoisonChance
    expect(db.sum('BASE', 'AdditionalPoisonChance')).toBe(35);

    // Yaomac's Accord tags mods with SkillType: Vaal
    expect(db.sum('INC', 'Damage')).toBe(0);
    db.setEvalContext({ ...db.getEvalContext(), skillTypes: { Vaal: true } });
    expect(db.sum('INC', 'Damage')).toBe(120);
    expect(db.sum('INC', 'CritChance')).toBe(80);

    // Harvest Quality -> 30 / 2 * 1 = 15% increased Elemental Damage
    expect(db.sum('INC', 'ElementalDamage')).toBe(15);
  });

  it("evaluates Post-Pool Mind of the Council, Nebulis, wrapped The Taming, Enmity's Embrace, and elevated Tailwind", () => {
    const db = new ModDB();
    db.setCondition('EnemyIgnited', true);
    db.setCondition('EnemyChilled', true);
    db.setCondition('EnemyShocked', true);
    db.setCondition('CritRecently', true);
    const mindOfCouncil = makeItem({
      id: 'helm-moc',
      name: 'Mind of the Council',
      baseName: 'Harlequin Mask',
      slotType: 'Helmet',
      explicits: ['Attack Skills have Added Lightning Damage equal to 6% of Maximum Mana'],
    });
    const nebulis = makeItem({
      id: 'wep-neb',
      name: 'Nebulis',
      baseName: 'Void Sceptre',
      slotType: 'Weapon 1',
      explicits: [
        '20% increased Cold Damage per 1% Cold Resistance above 75%',
        '15% increased Elemental Damage per 1% Fire, Cold, or Lightning Resistance above 75%',
      ],
    });
    const taming = makeItem({
      id: 'ring-tam',
      name: 'The Taming',
      baseName: 'Prismatic Ring',
      slotType: 'Ring 1',
      explicits: [
        '20% increased Elemental Damage with Hits and Ailments for',
        'each type of Elemental Ailment on Enemy',
      ],
    });
    const tailwindBoots = makeItem({
      id: 'boots-tw',
      name: 'Dire Spark',
      baseName: 'Two-Toned Boots',
      slotType: 'Boots',
      explicits: [
        'You have Tailwind if you have dealt a Critical Strike Recently',
        '25% increased effect of Tailwind on you',
      ],
    });

    // Cold res 85% (10 above 75 -> +200% Cold), Lightning res 90% (15 above 75 -> +225% Elemental)
    db.addMod({ name: 'ColdResist', type: 'BASE', value: 85, flags: 0, keywordFlags: 0, source: 'Gear' });
    db.addMod({ name: 'ColdResistMax', type: 'BASE', value: 85, flags: 0, keywordFlags: 0, source: 'Gear' });
    db.addMod({ name: 'LightningResist', type: 'BASE', value: 90, flags: 0, keywordFlags: 0, source: 'Gear' });
    db.addMod({ name: 'LightningResistMax', type: 'BASE', value: 90, flags: 0, keywordFlags: 0, source: 'Gear' });

    evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [
        { slot: 'Helmet', item: mindOfCouncil },
        { slot: 'Weapon 1', item: nebulis },
        { slot: 'Ring 1', item: taming },
        { slot: 'Boots', item: tailwindBoots },
      ],
      str: 100,
      dex: 100,
      int: 100,
      life: 4000,
      mana: 5000,
      energyShield: 0,
      armour: 1000,
      evasion: 1000,
      playerLightningResist: 90,
    });

    // Mind of the Council: 6% of 5000 Mana = 300 flat Attack Lightning Min & Max
    expect(db.sum('BASE', 'LightningMin', ModFlag.Attack)).toBe(300);
    expect(db.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(300);

    // Nebulis: 20 * 10 (Cold 85-75) = 200 Cold INC; 15 * (10 + 15) = 375 Elemental INC
    // Plus Wrapped The Taming: 20% * 3 (Ignited + Chilled + Shocked) = 60% Elemental INC with Hits & Ailments
    expect(db.sum('INC', 'ColdDamage')).toBe(200);
    expect(db.sum('INC', 'ElementalDamage', ModFlag.Hit)).toBe(375 + 60);
    expect(db.sum('INC', 'ElementalDamage', ModFlag.Ailment)).toBe(375 + 60);

    // Elevated Tailwind: 8% * 1.25 = 10% ActionSpeed INC
    expect(db.sum('INC', 'ActionSpeed')).toBe(10);

    // Perseverance must NOT double-count when generic PerStat:LowestOfArmourAndEvasion is already on db
    const persevDb = new ModDB();
    persevDb.setStat('LowestOfArmourAndEvasion', 10000);
    const persevBelt = makeItem({
      id: 'belt-persev',
      name: 'Perseverance',
      baseName: 'Vanguard Belt',
      slotType: 'Belt',
      explicits: ['1% increased Attack Damage per 200 of the lowest of Armour and Evasion Rating'],
    });
    persevDb.addMod({
      name: 'Damage',
      type: 'INC',
      value: 1,
      flags: ModFlag.Attack,
      keywordFlags: 0,
      source: 'Item (Belt): Perseverance',
      tags: [{ type: 'PerStat', stat: 'LowestOfArmourAndEvasion', div: 200 }],
    });
    evaluatePostPoolBuildEnablingUniques({
      db: persevDb,
      equippedItems: [{ slot: 'Belt', item: persevBelt }],
      str: 100,
      dex: 100,
      int: 100,
      life: 4000,
      mana: 500,
      energyShield: 0,
      armour: 12000,
      evasion: 10000,
    });
    // 10000 / 200 = 50% Attack Damage INC (strictly once, NOT 100%!)
    expect(persevDb.sum('INC', 'Damage', ModFlag.Attack)).toBe(50);
  });

  it("evaluates Badge/Replica Badge of the Brotherhood, Wilma's Requital, and Kalandra's Touch reflection of The Taming", () => {
    // 1. Badge of the Brotherhood flag + Replica Badge of the Brotherhood MaxEnduranceCharges sync
    const preDb = new ModDB();
    preDb.addMod({ name: 'MaxFrenzyCharges', type: 'BASE', value: 4, flags: 0, keywordFlags: 0, source: 'Tree' }); // 3 + 4 = 7 max
    const badge = makeItem({
      id: 'am-badge',
      name: 'Badge of the Brotherhood',
      baseName: 'Turquoise Amulet',
      slotType: 'Amulet',
      explicits: ['Your Maximum Frenzy Charges is equal to your Maximum Power Charges'],
    });
    const replicaBadge = makeItem({
      id: 'am-rbadge',
      name: 'Replica Badge of the Brotherhood',
      baseName: 'Turquoise Amulet',
      slotType: 'Ring 1',
      explicits: ['Your Maximum Endurance Charges is equal to your Maximum Frenzy Charges'],
    });
    evaluatePreStatBuildEnablingUniques({
      db: preDb,
      equippedItems: [
        { slot: 'Amulet', item: badge },
        { slot: 'Ring 1', item: replicaBadge },
      ],
      game: 'poe1',
    });
    expect(preDb.flag('BadgeOfTheBrotherhood')).toBe(true);
    expect(3 + preDb.sum('BASE', 'MaxEnduranceCharges')).toBe(7);

    // 2. Wilma's Requital mirrors Spell Cast Speed INC (including Onslaught Cast Speed!) to Attack Speed
    const postDb = new ModDB();
    postDb.setCondition('EnemyIgnited', true);
    postDb.setCondition('EnemyShocked', true);
    postDb.addMod({ name: 'Speed', type: 'INC', value: 30, flags: ModFlag.Spell, keywordFlags: 0, source: 'Ring Cast Speed' });
    postDb.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Attack, keywordFlags: 0, source: 'Onslaught' });
    postDb.addMod({ name: 'Speed', type: 'INC', value: 20, flags: ModFlag.Spell, keywordFlags: 0, source: 'Onslaught' });
    const wilma = makeItem({
      id: 'helm-wilma',
      name: "Wilma's Requital",
      baseName: 'Solaris Circlet',
      slotType: 'Helmet',
      explicits: ['Increases and Reductions to Cast Speed apply to Attack Speed'],
    });
    const taming = makeItem({
      id: 'r1-tam',
      name: 'The Taming',
      baseName: 'Prismatic Ring',
      slotType: 'Ring 1',
      explicits: ['40% increased Elemental Damage with Hits and Ailments for', 'each type of Elemental Ailment on Enemy'],
    });
    const kalandra = makeItem({
      id: 'r2-kal',
      name: "Kalandra's Touch",
      baseName: 'Ring',
      slotType: 'Ring 2',
      explicits: ['Reflects your other Ring'],
    });
    evaluatePostPoolBuildEnablingUniques({
      db: postDb,
      equippedItems: [
        { slot: 'Helmet', item: wilma },
        { slot: 'Ring 1', item: taming },
        { slot: 'Ring 2', item: kalandra },
      ],
      str: 100,
      dex: 100,
      int: 100,
      life: 4000,
      mana: 500,
      energyShield: 0,
      armour: 1000,
      evasion: 1000,
    });
    // Ring Cast Speed (30) + Onslaught Attack (20) + Onslaught Cast mirrored by Wilma's (20) = 70% Attack Speed INC
    expect(postDb.sum('INC', 'Speed', ModFlag.Attack)).toBe(70);
    // The Taming (40 * 2 = 80) + Kalandra's Touch reflection (80) = 160 Elemental Damage INC with Hits & Ailments
    expect(postDb.sum('INC', 'ElementalDamage', ModFlag.Hit)).toBe(160);
    expect(postDb.sum('INC', 'ElementalDamage', ModFlag.Ailment)).toBe(160);
  });

  it('evaluates Legacy of Fury Nearby Enemies are Scorched with Scorch Effect scaling, 30% cap, and dedupe', () => {
    const db = new ModDB();
    const legacyOfFury = makeItem({
      id: 'boots-lof',
      name: 'Legacy of Fury',
      baseName: 'Wyrmscale Boots',
      slotType: 'Boots',
      explicits: [
        'Nearby Enemies are Scorched',
        '48% increased Effect of Scorch',
      ],
    });
    evaluatePreStatBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Boots', item: legacyOfFury }],
      game: 'poe1',
    });
    // Base -10% Ele Res * (1 + 48/100) = -14.8 -> floor = -14%
    expect(db.getEvalContext().conditions.EnemyScorched).toBe(true);
    expect(db.sum('BASE', 'EnemyFireResist')).toBe(-14);
    expect(db.sum('BASE', 'EnemyColdResist')).toBe(-14);
    expect(db.sum('BASE', 'EnemyLightningResist')).toBe(-14);

    // Dedupe: calling again when EnemyScorched is already active must not double-apply
    evaluatePreStatBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Boots', item: legacyOfFury }],
      game: 'poe1',
    });
    expect(db.sum('BASE', 'EnemyFireResist')).toBe(-14);

    // Cap at -30% when Scorch Effect >= 200%
    const cappedDb = new ModDB();
    cappedDb.addMod({
      name: 'EnemyScorchEffect',
      type: 'INC',
      value: 250,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree',
    });
    evaluatePreStatBuildEnablingUniques({
      db: cappedDb,
      equippedItems: [{ slot: 'Boots', item: legacyOfFury }],
      game: 'poe1',
    });
    expect(cappedDb.sum('BASE', 'EnemyFireResist')).toBe(-30);
    expect(cappedDb.sum('BASE', 'EnemyColdResist')).toBe(-30);
    expect(cappedDb.sum('BASE', 'EnemyLightningResist')).toBe(-30);
  });

  it('grants Perseverance Onslaught when only an inactive conditional Onslaught mod exists in ModDB', () => {
    const db = new ModDB();
    // Inactive conditional Onslaught (e.g. "Onslaught if you have Killed Recently" when KilledRecently is false)
    db.addMod({
      name: 'MovementSpeed',
      type: 'INC',
      value: 20,
      flags: 0,
      keywordFlags: 0,
      source: 'Tree (Onslaught)',
      tags: [{ type: 'Condition', var: 'KilledRecently' }],
    });
    const perseverance = makeItem({
      id: 'belt-persev',
      name: 'Perseverance',
      baseName: 'Vanguard Belt',
      slotType: 'Belt',
      explicits: ['You have Onslaught while you have Fortify'],
    });
    evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Belt', item: perseverance }],
      str: 100,
      dex: 100,
      int: 100,
      life: 4000,
      mana: 500,
      energyShield: 0,
      armour: 10000,
      evasion: 10000,
      fortified: true,
    });
    // Inactive conditional Onslaught must NOT suppress Perseverance's active Onslaught
    expect(db.sum('INC', 'MovementSpeed')).toBe(20);
    expect(db.sum('INC', 'Speed', ModFlag.Attack)).toBe(20);
    expect(db.sum('INC', 'Speed', ModFlag.Spell)).toBe(20);
  });

  it('evaluates Whispers of Infinity Added Attack Chaos Damage per Maximum Mana', () => {
    const db = new ModDB();
    const whispers = makeItem({
      id: 'am-whispers',
      name: 'Whispers of Infinity',
      baseName: 'Seaglass Amulet',
      slotType: 'Amulet',
      explicits: ['13 to 33 Added Attack Chaos Damage per 100 Maximum Mana'],
    });
    evaluatePostPoolBuildEnablingUniques({
      db,
      equippedItems: [{ slot: 'Amulet', item: whispers }],
      str: 100,
      dex: 100,
      int: 100,
      life: 3000,
      mana: 1250,
      energyShield: 2000,
      armour: 0,
      evasion: 0,
    });
    // floor(1250 / 100) = 12 steps -> 12 * 13 = 156 min, 12 * 33 = 396 max Attack Chaos
    expect(db.sum('BASE', 'ChaosMin', ModFlag.Attack)).toBe(156);
    expect(db.sum('BASE', 'ChaosMax', ModFlag.Attack)).toBe(396);
  });

  it('skips Mind of the Council post-pool injection when modParser already emitted MindOfTheCouncilManaPct', () => {
    const motc = makeItem({
      id: 'helm-motc',
      name: 'Mind of the Council',
      baseName: 'Harlequin Mask',
      slotType: 'Helmet',
      explicits: ['Attack Skills have Added Lightning Damage equal to 6% of maximum Mana'],
    });

    // 1. Standalone post-pool (without MindOfTheCouncilManaPct) still injects 6% of 2895 = 174
    const dbStandalone = new ModDB();
    evaluatePostPoolBuildEnablingUniques({
      db: dbStandalone,
      equippedItems: [{ slot: 'Helmet', item: motc }],
      str: 100,
      dex: 100,
      int: 300,
      life: 3000,
      mana: 2895,
      energyShield: 1200,
      armour: 0,
      evasion: 0,
    });
    expect(dbStandalone.sum('BASE', 'LightningMin', ModFlag.Attack)).toBe(174);
    expect(dbStandalone.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(174);

    // 2. When modParser already emitted MindOfTheCouncilManaPct (consumed by engine.ts), do NOT double-count
    const dbParsed = new ModDB();
    dbParsed.addMod({
      name: 'MindOfTheCouncilManaPct',
      type: 'BASE',
      value: 6,
      flags: 0,
      keywordFlags: 0,
      source: 'Helmet: Mind of the Council',
    });
    evaluatePostPoolBuildEnablingUniques({
      db: dbParsed,
      equippedItems: [{ slot: 'Helmet', item: motc }],
      str: 100,
      dex: 100,
      int: 300,
      life: 3000,
      mana: 2895,
      energyShield: 1200,
      armour: 0,
      evasion: 0,
    });
    expect(dbParsed.sum('BASE', 'LightningMin', ModFlag.Attack)).toBe(0);
    expect(dbParsed.sum('BASE', 'LightningMax', ModFlag.Attack)).toBe(0);
  });

  it('recognizes Chinese Kalandra’s Touch (卡兰德之触) in evaluateIngenuityAndRingBonuses', () => {
    const ring1 = makeItem({
      id: 'r1',
      name: 'Rare Ring',
      baseName: 'Gold Ring',
      slotType: 'Ring 1',
      explicits: ['+40% to Fire Resistance'],
    });
    const ring2 = makeItem({
      id: 'r2',
      name: '卡兰德之触',
      baseName: '戒指',
      slotType: 'Ring 2',
      rarity: 'UNIQUE',
      explicits: ['镜像反映你的另一枚戒指'],
    });
    const belt = makeItem({
      id: 'belt-ing',
      name: 'Ingenuity',
      baseName: 'Utility Belt',
      slotType: 'Belt',
      rarity: 'UNIQUE',
      explicits: ['50% increased bonuses gained from Equipped Rings'],
    });
    const db = new ModDB();
    const res = evaluateIngenuityAndRingBonuses(
      [
        { slot: 'Ring 1', item: ring1 },
        { slot: 'Ring 2', item: ring2 },
        { slot: 'Belt', item: belt },
      ],
      db,
    );
    // Ring 1 (+40 * 50% = +20) + Ring 2 (卡兰德之触 reflecting Ring 1: +40 * 50% = +20) = +40 bonus Fire Res
    expect(db.sum('BASE', 'FireResist')).toBe(40);
    expect(res.rings.length).toBe(2);
  });
});
