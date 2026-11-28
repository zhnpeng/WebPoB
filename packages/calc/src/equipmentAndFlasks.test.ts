import { describe, expect, it } from 'vitest';
import type { Build, Item } from '@webpob/core';
import { ModDB } from './modDb.js';
import { parseModLines } from './modParser.js';
import {
  FULL_UTILITY_FLASK_BUFFS,
  collectExtraSocketedEquipment,
  evaluateActiveFlasks,
  evaluatePoe2MagebloodLegacies,
  evaluateSpecialUniqueGearMechanics,
  resolveUtilityFlaskBaseName,
  scaleModLineByMultiplier,
} from './equipmentAndFlasks.js';

function makeItem(partial: Partial<Item> & Pick<Item, 'id' | 'name' | 'baseName'>): Item {
  return {
    rarity: 'RARE',
    slotType: 'Any',
    quality: 0,
    implicits: [],
    explicits: [],
    ...partial,
  };
}

function makeMinimalBuild(overrides?: Partial<Build>): Build {
  return {
    id: 'test-build',
    name: 'Test Build',
    game: 'poe1',
    level: 95,
    classId: 'marauder',
    ascendancyId: 'juggernaut',
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

describe('equipmentAndFlasks — Utility Flasks & PoE 1 Mageblood', () => {
  it('resolves canonical utility flask base names for magic, normal, and unique flasks', () => {
    expect(
      resolveUtilityFlaskBaseName(
        makeItem({
          id: 'f1',
          name: "Alchemist's Granite Flask of the Armadillo",
          baseName: "Alchemist's Granite Flask of the Armadillo",
          rarity: 'MAGIC',
        }),
      ),
    ).toBe('Granite Flask');

    expect(
      resolveUtilityFlaskBaseName(
        makeItem({
          id: 'f2',
          name: 'Bottomless Quicksilver Flask of the Lynx',
          baseName: 'Bottomless Quicksilver Flask of the Lynx',
          rarity: 'MAGIC',
        }),
      ),
    ).toBe('Quicksilver Flask');

    expect(
      resolveUtilityFlaskBaseName(
        makeItem({
          id: 'f3',
          name: "Oriath's End",
          baseName: 'Bismuth Flask',
          rarity: 'UNIQUE',
        }),
      ),
    ).toBe('Bismuth Flask');

    expect(
      resolveUtilityFlaskBaseName(
        makeItem({
          id: 'f4',
          name: 'Olroth\'s Resolve',
          baseName: 'Iron Flask',
          rarity: 'UNIQUE',
        }),
      ),
    ).toBe('Iron Flask');
    expect(FULL_UTILITY_FLASK_BUFFS['Iron Flask']).toEqual(['+200 to Ward']);

    expect(
      resolveUtilityFlaskBaseName(
        makeItem({
          id: 'f5',
          name: 'Seething Divine Life Flask of Staunching',
          baseName: 'Seething Divine Life Flask of Staunching',
          rarity: 'MAGIC',
        }),
      ),
    ).toBeNull();
  });

  it('auto-activates leftmost 4 Magic Utility Flasks with Mageblood and scales by +95% Enkindling+Alchemist effect', () => {
    const mageblood = makeItem({
      id: 'belt1',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Magic Utility Flasks cannot be Used',
        'Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you',
        'Magic Utility Flask Effects cannot be removed',
      ],
    });
    const granite = makeItem({
      id: 'fl1',
      name: "Alchemist's Granite Flask of the Armadillo",
      baseName: "Alchemist's Granite Flask of the Armadillo",
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect', '{enchant}Gains no Charges during Effect'],
      explicits: ['25% increased effect', '33% reduced Duration', '55% increased Armour during Effect'],
    });
    const amethyst = makeItem({
      id: 'fl2',
      name: "Alchemist's Amethyst Flask of the Rainbow",
      baseName: "Alchemist's Amethyst Flask of the Rainbow",
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '19% additional Elemental Resistances during Effect'],
    });
    const quicksilver = makeItem({
      id: 'fl3',
      name: "Alchemist's Quicksilver Flask of the Cheetah",
      baseName: "Alchemist's Quicksilver Flask of the Cheetah",
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '14% increased Movement Speed during Effect'],
    });
    const diamond = makeItem({
      id: 'fl4',
      name: "Alchemist's Diamond Flask of Incision",
      baseName: "Alchemist's Diamond Flask of Incision",
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '55% increased Critical Strike Chance during Effect'],
    });
    const progenesis = makeItem({
      id: 'fl5',
      name: 'Progenesis',
      baseName: 'Amethyst Flask',
      rarity: 'UNIQUE',
      explicits: ['When Hit during effect, 25% of Life loss from Damage taken occurs over 4 seconds instead'],
    });

    const build = makeMinimalBuild({
      items: {
        belt1: mageblood,
        fl1: granite,
        fl2: amethyst,
        fl3: quicksilver,
        fl4: diamond,
        fl5: progenesis,
      },
      equipped: {
        Belt: 'belt1',
        'Flask 1': 'fl1',
        'Flask 2': 'fl2',
        'Flask 3': 'fl3',
        'Flask 4': 'fl4',
        'Flask 5': 'fl5',
      },
      // All flasks disabled in XML — Mageblood must still auto-activate Flask 1..4, while Progenesis stays off
      activeFlaskSlots: {
        'Flask 1': false,
        'Flask 2': false,
        'Flask 3': false,
        'Flask 4': false,
        'Flask 5': false,
      },
    });

    const res = evaluateActiveFlasks(build, 0);
    expect(res.activeSlots).toEqual(['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4']);
    // +95% effect => 1.95x with PoB integer truncation:
    // Granite: +1500 * 1.95 = +2925 Armour; 55% * 1.95 = 107% increased Armour
    expect(res.modLines).toContain('+2925 to Armour');
    expect(res.modLines).toContain('107% increased Armour');
    // Amethyst: +35% * 1.95 = +68% Chaos Res; 19% * 1.95 = +37% all Ele Res
    expect(res.modLines).toContain('+68% to Chaos Resistance');
    expect(res.modLines).toContain('+37% to all Elemental Resistances');
    // Quicksilver: 40% * 1.95 = 78% MS; 14% * 1.95 = 27% MS
    expect(res.modLines).toContain('78% increased Movement Speed');
    expect(res.modLines).toContain('27% increased Movement Speed');
    // Diamond: 100% * 1.95 = 195% Crit; 55% * 1.95 = 107% Crit
    expect(res.modLines).toContain('195% increased Global Critical Strike Chance');
    expect(res.modLines).toContain('107% increased Critical Strike Chance');

    // Verify all generated lines parse cleanly into ModDB
    const db = new ModDB();
    db.addMods(parseModLines(res.modLines, 'Flasks'));
    expect(db.sum('BASE', 'Armour')).toBe(2925);
    expect(db.sum('INC', 'Armour')).toBe(107);
    expect(db.sum('BASE', 'ChaosResist')).toBe(68);
    expect(db.sum('BASE', 'FireResist')).toBe(37);
    expect(db.sum('INC', 'MovementSpeed')).toBe(78 + 27);
  });

  it('detects Silver Flask Onslaught, Bottled Faith Consecrated Ground/Crit, and Progenesis delay', () => {
    const silver = makeItem({
      id: 'fl1',
      name: "Apprentice's Silver Flask of the Cheetah",
      baseName: "Apprentice's Silver Flask of the Cheetah",
      rarity: 'MAGIC',
    });
    const bottledFaith = makeItem({
      id: 'fl2',
      name: 'Bottled Faith',
      baseName: 'Sulphur Flask',
      rarity: 'UNIQUE',
      implicits: ['Creates Consecrated Ground on Use'],
      explicits: [
        '+1.5% to Critical Strike Chance against Enemies on Consecrated Ground during Effect',
        'Consecrated Ground created during Effect applies 10% increased Damage taken to Enemies',
      ],
    });
    const progenesis = makeItem({
      id: 'fl3',
      name: 'Progenesis',
      baseName: 'Amethyst Flask',
      rarity: 'UNIQUE',
      explicits: ['When Hit during effect, 25% of Life loss from Damage taken occurs over 4 seconds instead'],
    });

    const build = makeMinimalBuild({
      items: { fl1: silver, fl2: bottledFaith, fl3: progenesis },
      equipped: { 'Flask 1': 'fl1', 'Flask 2': 'fl2', 'Flask 3': 'fl3' },
      activeFlaskSlots: { 'Flask 1': true, 'Flask 2': true, 'Flask 3': true },
    });

    // Global +20% flask effect
    const res = evaluateActiveFlasks(build, 20);
    expect(res.grantsOnslaught).toBe(true);
    // Silver Flask must NOT push raw 'Onslaught' into modLines (engine.ts injects scaled Onslaught once)
    expect(res.modLines.some((l) => /^Onslaught$/i.test(l))).toBe(false);
    expect(res.perFlask.find((f) => f.baseName === 'Silver Flask')?.baseBuffLines).toContain('Onslaught');
    expect(res.grantsConsecratedGround).toBe(true);
    expect(res.bottledFaithBaseCrit).toBeCloseTo(1.8, 2);
    expect(res.progenesisDelayPct).toBe(30); // trunc(25 * 1.2) = 30
    expect(res.modLines).toContain('48% increased Damage'); // Sulphur 40 * 1.2
    expect(res.modLines).toContain('Enemies take 12% increased Damage');
  });

  it('sets grantsOnslaught without emitting raw Onslaught into modLines (preventing 2x speed with engine.ts)', () => {
    const silver = makeItem({
      id: 'fl1',
      name: "Alchemist's Silver Flask of the Cheetah",
      baseName: 'Silver Flask',
      rarity: 'MAGIC',
      implicits: ['{enchant}70% increased effect'],
      explicits: ['25% increased effect', '14% increased Movement Speed during Effect'],
    });
    const explicitOnslaughtFlask = makeItem({
      id: 'fl2',
      name: 'Special Onslaught Flask',
      baseName: 'Diamond Flask',
      rarity: 'UNIQUE',
      explicits: ['Onslaught during Effect'],
    });
    const build = makeMinimalBuild({
      items: { fl1: silver, fl2: explicitOnslaughtFlask },
      equipped: { 'Flask 1': 'fl1', 'Flask 2': 'fl2' },
      activeFlaskSlots: { 'Flask 1': true, 'Flask 2': true },
    });

    const res = evaluateActiveFlasks(build, 0);
    expect(res.grantsOnslaught).toBe(true);
    expect(res.modLines.some((l) => /^Onslaught$/i.test(l))).toBe(false);
    expect(res.perFlask[0]?.effectMult).toBeCloseTo(1.95, 4);

    // Parsing res.modLines into ModDB must NOT add raw +20% Attack/Cast Speed from Onslaught
    const db = new ModDB();
    db.addMods(parseModLines(res.modLines, 'Active Flasks'));
    expect(db.sum('INC', 'Speed', 1)).toBe(0); // ModFlag.Attack = 1
    expect(db.sum('INC', 'Speed', 2)).toBe(0); // ModFlag.Spell = 2
    // Only Cheetah suffix (trunc(14 * 1.95) = 27% Movement Speed) should be present
    expect(db.sum('INC', 'MovementSpeed')).toBe(27);
  });
});

describe('equipmentAndFlasks — PoE 2 Mageblood Legacies', () => {
  it('computes exact PoB2 LuaJIT integer values with duplicate legacy effect scaling', () => {
    // Matches Stormweaver audit: 1 duplicate (2x Jade) + 46% per duplicate => 1.46x
    const stormweaverMageblood = makeItem({
      id: 'mb-poe2',
      name: 'Mageblood',
      baseName: 'Utility Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Jade',
        'Legacy of Jade',
        'Legacy of Quicksilver',
        'Legacy of Diamond',
        "All Mage's Legacies have 46% increased effect per duplicate Mage's Legacy you have",
      ],
    });

    const lines = evaluatePoe2MagebloodLegacies(stormweaverMageblood);
    expect(lines).toContain('+2920 to Evasion Rating'); // floor(2000 * 1.46)
    expect(lines).toContain('43% increased Movement Speed'); // floor(30 * 1.46)
    expect(lines).toContain('109% increased Global Critical Strike Chance'); // floor(75 * 1.46)

    // Matches Invoker audit: 1 duplicate + 48% per duplicate => 1.48x
    const invokerMageblood = makeItem({
      id: 'mb-poe2-inv',
      name: 'Mageblood',
      baseName: 'Utility Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Sulphur',
        'Legacy of Silver',
        'Legacy of Diamond',
        'Legacy of Diamond',
        "All Mage's Legacies have 48% increased effect per duplicate Mage's Legacy you have",
      ],
    });
    const invLines = evaluatePoe2MagebloodLegacies(invokerMageblood);
    expect(invLines).toContain('88% increased Damage'); // floor(60 * 1.48)
    expect(invLines).toContain('44% increased Attack and Cast Speed'); // floor(30 * 1.48)
    expect(invLines).toContain('111% increased Global Critical Strike Chance'); // floor(75 * 1.48)
  });

  it('handles zero duplicates (1.0x) and elemental resistance legacies', () => {
    const titanMageblood = makeItem({
      id: 'mb-poe2-titan',
      name: 'Mageblood',
      baseName: 'Utility Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Quicksilver',
        'Legacy of Silver',
        'Legacy of Sulphur',
        'Legacy of Ruby',
        "All Mage's Legacies have 50% increased effect per duplicate Mage's Legacy you have",
      ],
    });

    const lines = evaluatePoe2MagebloodLegacies(titanMageblood);
    expect(lines).toContain('30% increased Movement Speed');
    expect(lines).toContain('30% increased Attack and Cast Speed');
    expect(lines).toContain('60% increased Damage');
    expect(lines).toContain('+60% to Fire Resistance');
    expect(lines).toContain('+5% to maximum Fire Resistance');
  });
});

describe('equipmentAndFlasks — Extra Socketed Equipment (Abyssal Sockets & PoE 2 0.5 Slots)', () => {
  it('collects PoE 1 Abyssal Sockets and applies Darkness Enthroned effect multiplier', () => {
    const darknessEnthroned = makeItem({
      id: 'belt-de',
      name: 'Darkness Enthroned',
      baseName: 'Stygian Vise',
      rarity: 'UNIQUE',
      explicits: ['99% increased Effect of Socketed Abyss Jewels'],
    });
    const abyssJewel1 = makeItem({
      id: 'aj1',
      name: 'Ghastly Eye',
      baseName: 'Ghastly Eye Jewel',
      explicits: ['+40 to maximum Life', '+12% to all Elemental Resistances'],
    });
    const abyssJewel2 = makeItem({
      id: 'aj2',
      name: 'Hypnotic Eye',
      baseName: 'Hypnotic Eye Jewel',
      explicits: ['+35 to maximum Energy Shield'],
    });
    const bodyAbyssJewel = makeItem({
      id: 'aj3',
      name: "Kurgal's Gaze",
      baseName: 'Hypnotic Eye Jewel',
      explicits: ['+30 to maximum Life'],
    });

    const build = makeMinimalBuild({
      items: {
        'belt-de': darknessEnthroned,
        aj1: abyssJewel1,
        aj2: abyssJewel2,
        aj3: bodyAbyssJewel,
      },
      equipped: {
        Belt: 'belt-de',
        'Belt Abyssal Socket 1': 'aj1',
        'Belt Abyssal Socket 2': 'aj2',
        'Body Armour Abyssal Socket 1': 'aj3',
      } as Build['equipped'],
    });

    const extras = collectExtraSocketedEquipment(build);
    expect(extras).toHaveLength(3);

    const beltSock1 = extras.find((e) => e.slot === 'Belt Abyssal Socket 1');
    expect(beltSock1?.effectMult).toBeCloseTo(1.99, 4);
    expect(scaleModLineByMultiplier('+40 to maximum Life', beltSock1!.effectMult)).toBe(
      '+79 to maximum Life',
    );

    const bodySock1 = extras.find((e) => e.slot === 'Body Armour Abyssal Socket 1');
    expect(bodySock1?.effectMult).toBe(1);
  });

  it('collects PoE 2 0.5 Grafted Limbs (Arm/Leg 1-2) and Equipment Jewel Sockets', () => {
    const combatArm = makeItem({
      id: 'arm1',
      name: 'Combat Arm',
      baseName: 'Grafted Arm',
      explicits: ['10% increased Attack Speed'],
    });
    const evasiveLeg = makeItem({
      id: 'leg1',
      name: 'Evasive Leg',
      baseName: 'Grafted Leg',
      explicits: ['30% increased Evasion Rating'],
    });
    const gloveJewel = makeItem({
      id: 'gj1',
      name: 'Dusk Lens',
      baseName: 'Sapphire',
      explicits: ['+8% to Cold Resistance', '20% increased maximum Energy Shield'],
    });

    const build = makeMinimalBuild({
      game: 'poe2',
      items: { arm1: combatArm, leg1: evasiveLeg, gj1: gloveJewel },
      equipped: {
        'Arm 1': 'arm1',
        'Leg 1': 'leg1',
        'Gloves Jewel Socket 1': 'gj1',
      } as Build['equipped'],
    });

    const extras = collectExtraSocketedEquipment(build);
    expect(extras.map((e) => e.slot).sort()).toEqual([
      'Arm 1',
      'Gloves Jewel Socket 1',
      'Leg 1',
    ]);
    expect(extras.every((e) => e.effectMult === 1)).toBe(true);
  });
});

describe('equipmentAndFlasks — Special Meta Unique Gear Mechanics', () => {
  it('Widowhail +290% scales Quiver implicits & explicits to exact PoB integer totals', () => {
    const widowhail = makeItem({
      id: 'w1',
      name: 'Widowhail',
      baseName: 'Crude Bow',
      rarity: 'UNIQUE',
      explicits: ['290% increased bonuses gained from Equipped Quiver'],
    });
    const quiver = makeItem({
      id: 'w2',
      name: 'Onslaught Impaler',
      baseName: 'Broadhead Arrow Quiver',
      rarity: 'RARE',
      implicits: ['+54 to maximum Mana'],
      explicits: ['+40 to maximum Life', '10% increased Attack Speed'],
    });

    const db = new ModDB();
    // Simulate normal 1x quiver ingestion first
    db.addMods(parseModLines([...quiver.implicits, ...quiver.explicits], 'Quiver'));
    expect(db.sum('BASE', 'Mana')).toBe(54);

    const res = evaluateSpecialUniqueGearMechanics(
      [
        { slot: 'Weapon 1', item: widowhail },
        { slot: 'Weapon 2', item: quiver },
      ],
      db,
      'poe1',
    );

    expect(res.widowhailQuiverBonusPct).toBe(290);
    // 54 * 3.90 = 210.6 -> trunc 210 (exact match to PoB1 Oracle!)
    expect(db.sum('BASE', 'Mana')).toBe(210);
    // 40 * 3.90 = 156
    expect(db.sum('BASE', 'Life')).toBe(156);
    // 10 * 3.90 = 39
    expect(db.sum('INC', 'Speed', 1)).toBe(39);
  });

  it('Melding of the Flesh applies -max ele res and syncs all elemental max resists to highest', () => {
    const melding = makeItem({
      id: 'j-meld',
      name: 'Melding of the Flesh',
      baseName: 'Cobalt Jewel',
      rarity: 'UNIQUE',
      explicits: [
        '-70% to all Elemental Resistances',
        '-4% to all maximum Elemental Resistances',
        'Elemental Resistances are capped by your highest Maximum Elemental Resistance instead',
      ],
    });

    const db = new ModDB();
    // Base 75% max all res, plus +19% max Cold res (e.g. Purity of Ice + Aegis Aurora + tree -> 94 before -4 = 90)
    db.addMod({ name: 'FireResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });
    db.addMod({ name: 'ColdResistMax', type: 'BASE', value: 94, flags: 0, keywordFlags: 0, source: 'Base+Ice' });
    db.addMod({ name: 'LightningResistMax', type: 'BASE', value: 75, flags: 0, keywordFlags: 0, source: 'Base' });

    const res = evaluateSpecialUniqueGearMechanics([], db, 'poe1', {
      socketedJewels: [melding],
    });

    expect(res.meldingOfTheFleshActive).toBe(true);
    expect(res.meldingHighestMaxResist).toBe(90);
    expect(db.sum('BASE', 'FireResistMax')).toBe(90);
    expect(db.sum('BASE', 'ColdResistMax')).toBe(90);
    expect(db.sum('BASE', 'LightningResistMax')).toBe(90);
    expect(db.override('FireResistMax')).toBe(90);
  });

  it("Ralakesh's Impatience grants max Power/Frenzy/Endurance charge flags and syncs min=max", () => {
    const ralakesh = makeItem({
      id: 'boots-ral',
      name: "Ralakesh's Impatience",
      baseName: 'Riveted Boots',
      rarity: 'UNIQUE',
      explicits: ['Count as having maximum number of Power Charges'],
    });

    const db = new ModDB();
    db.addMod({ name: 'MaxPowerCharges', type: 'BASE', value: 7, flags: 0, keywordFlags: 0, source: 'Gear+Tree' }); // 3 + 7 = 10 max

    const res = evaluateSpecialUniqueGearMechanics([{ slot: 'Boots', item: ralakesh }], db, 'poe1');
    expect(res.ralakeshCharges).toEqual({ power: true, frenzy: false, endurance: false });
    expect(db.flag('CountAsMaxPowerCharges')).toBe(true);
    expect(db.sum('BASE', 'MinPowerCharges')).toBe(10);
  });

  it('The Ivory Tower grants +30 maximum ES per 100 Reserved Life', () => {
    const ivoryTower = makeItem({
      id: 'body-it',
      name: 'The Ivory Tower',
      baseName: "Saint's Hauberk",
      rarity: 'UNIQUE',
      explicits: [
        '+30 to maximum Energy Shield per 100 Reserved Life',
        'Chaos Damage is taken from Mana before Life',
      ],
    });

    const db = new ModDB();
    const res = evaluateSpecialUniqueGearMechanics([{ slot: 'Body Armour', item: ivoryTower }], db, 'poe1', {
      reservedLife: 8500,
    });

    expect(res.ivoryTowerEsPer100ReservedLife).toBe(30);
    expect(res.ivoryTowerBonusEs).toBe(2550); // floor(8500 / 100) * 30 = 2550
    expect(db.sum('BASE', 'EnergyShield')).toBe(2550);
    expect(db.flag('ChaosTakenFromManaBeforeLife')).toBe(true);
  });

  it('Prism of Belief returns lowercase skill-name-specific gem level bonuses and dedupes against GemLevel', () => {
    const prism = makeItem({
      id: 'j-prism',
      name: 'Prism of Belief',
      baseName: 'Diamond',
      rarity: 'UNIQUE',
      explicits: [
        '+3 to Level of all Earthshatter Skills',
        '+3 to Level of all Supercharged Slam Skills',
      ],
    });

    const db = new ModDB();
    const res = evaluateSpecialUniqueGearMechanics([], db, 'poe2', {
      socketedJewels: [prism],
    });

    expect(res.skillSpecificGemLevels).toEqual({
      earthshatter: 3,
      'supercharged slam': 3,
    });
    expect(db.sum('BASE', 'SkillLevel:earthshatter')).toBe(3);
    expect(db.sum('BASE', 'SkillLevel:supercharged slam')).toBe(3);

    // When modParserPoe2 already emitted GemLevel:supercharged+slam into db, skillSpecificGemLevels dedupes it
    const dbPreParsed = new ModDB();
    dbPreParsed.addMod({
      name: 'GemLevel:supercharged+slam',
      type: 'BASE',
      value: 3,
      flags: 0,
      keywordFlags: 0,
      source: 'Jewel (Prism of Belief)',
    });
    const resDeduped = evaluateSpecialUniqueGearMechanics([], dbPreParsed, 'poe2', {
      socketedJewels: [prism],
    });
    expect(resDeduped.skillSpecificGemLevels).toEqual({ earthshatter: 3 });
  });

  it('scales Equipped Focus non-local mods when EffectOfBonusesFromFocus is set (e.g. Instruments of Power -50%)', () => {
    const focus = makeItem({
      id: 'w2-focus',
      name: 'Ghoul Chant',
      baseName: 'Tasalian Focus',
      rarity: 'RARE',
      explicits: [
        '+120 to maximum Energy Shield',
        '83% increased Spell Damage',
        '31% increased Critical Spell Damage Bonus',
      ],
    });

    const db = new ModDB();
    db.addMods(
      parseModLines(
        ['83% increased Spell Damage', '31% increased Critical Spell Damage Bonus'],
        'Focus',
      ),
    );
    db.addMod({
      name: 'EffectOfBonusesFromFocus',
      type: 'INC',
      value: -50,
      flags: 0,
      keywordFlags: 0,
      source: 'Ascendancy: Instruments of Power',
    });

    evaluateSpecialUniqueGearMechanics([{ slot: 'Weapon 2', item: focus }], db, 'poe2');

    // PoB 2 ModStore.lua:114 truncation: 83 + trunc(-41.5) = 42; 31 + trunc(-15.5) = 16
    expect(db.sum('INC', 'Damage', 2)).toBe(42);
    expect(db.sum('INC', 'CritDamageBonusInc', 2) + db.sum('INC', 'CritMultiplier', 2)).toBe(16);
    expect(db.flag('FocusEffectApplied')).toBe(true);
  });

  it('handles Cogwork/Helical Ring suffix magnitudes, Sacred Flame, Aegis Aurora, and Svalinn', () => {
    const helicalRing = makeItem({
      id: 'r1',
      name: 'Miracle Band',
      baseName: 'Helical Ring',
      rarity: 'RARE',
      implicits: ['50% increased Suffix Modifier magnitudes'],
      explicits: ['+60 to Strength', '+40% to Fire Resistance', '+70 to maximum Life'],
    });
    const sacredFlame = makeItem({
      id: 's1',
      name: 'Sacred Flame',
      baseName: 'Shrine Sceptre',
      rarity: 'UNIQUE',
      explicits: ['Enemies in your Presence Resist Elemental Damage based on their Lowest Resistance'],
    });
    const aegis = makeItem({
      id: 'sh1',
      name: 'Aegis Aurora',
      baseName: 'Champion Kite Shield',
      rarity: 'UNIQUE',
      explicits: ['Recover Energy Shield equal to 2% of Armour when you Block'],
    });
    const svalinn = makeItem({
      id: 'sh2',
      name: 'Svalinn',
      baseName: 'Girded Tower Shield',
      rarity: 'UNIQUE',
      explicits: [
        '-10% to maximum Chance to Block Attack Damage',
        '-10% to maximum Chance to Block Spell Damage',
        'Chance to Block is Lucky',
      ],
    });

    const db = new ModDB();
    // Normal 1x ring stats already parsed
    db.addMods(parseModLines(helicalRing.explicits, 'Ring 1'));

    const res = evaluateSpecialUniqueGearMechanics(
      [
        { slot: 'Ring 1', item: helicalRing },
        { slot: 'Weapon 1', item: sacredFlame },
        { slot: 'Weapon 2', item: aegis },
        { slot: 'Weapon 2 Swap', item: svalinn },
      ],
      db,
      'poe1',
    );

    // Helical Ring +50% suffix magnitudes: Str 60 -> 90, FireRes 40 -> 60, Life (prefix) stays 70
    expect(db.sum('BASE', 'Str')).toBe(90);
    expect(db.sum('BASE', 'FireResist')).toBe(60);
    expect(db.sum('BASE', 'Life')).toBe(70);

    expect(res.enemyResistLowestElement).toBe(true);
    expect(db.flag('EnemyResistLowestElement')).toBe(true);

    expect(res.aegisAuroraEsOnBlockArmourPct).toBe(2);
    expect(db.sum('BASE', 'EsRecoverOnBlockPctArmour')).toBe(2);

    expect(res.svalinnLuckyBlock).toBe(true);
    expect(db.flag('BlockChanceLucky')).toBe(true);
    expect(db.sum('BASE', 'MaxBlockChance')).toBe(-10);
    expect(db.sum('BASE', 'MaxSpellBlockChance')).toBe(-10);
  });

  it('scales PoE 1 Tinctures with PoB multiplicative quality formula, filters meta lines, and normalizes WeaponMelee scope when melee weapon equipped', () => {
    const claw = makeItem({
      id: 'w1',
      name: 'Viper Talon',
      baseName: 'Imperial Claw',
      rarity: 'RARE',
      slotType: 'Weapon 1',
    });
    const prismaticTincture = makeItem({
      id: 'fl4',
      name: 'Enriched Prismatic Tincture of Overpowering',
      baseName: 'Enriched Prismatic Tincture of Overpowering',
      rarity: 'MAGIC',
      quality: 20,
      implicits: ['162% increased Elemental Damage with Melee Weapons'],
      explicits: [
        'Inflicts Mana Burn every 0.43 Seconds',
        '8 Second Cooldown when Deactivated',
        '35% increased effect',
        '64% increased Mana Burn rate',
        'Melee Weapon Damage Penetrates 30% Elemental Resistances',
      ],
    });
    const rosethornTincture = makeItem({
      id: 'fl5',
      name: 'Concentrated Rosethorn Tincture of Mastery',
      baseName: 'Concentrated Rosethorn Tincture of Mastery',
      rarity: 'MAGIC',
      quality: 20,
      implicits: ['243% increased Critical Strike Chance with Melee Weapons'],
      explicits: [
        '35% increased effect',
        '69% increased Mana Burn rate',
        '46% increased Melee Weapon Attack Speed',
      ],
    });

    const build = makeMinimalBuild({
      items: { w1: claw, fl4: prismaticTincture, fl5: rosethornTincture },
      equipped: { 'Weapon 1': 'w1', 'Flask 4': 'fl4', 'Flask 5': 'fl5' },
      activeFlaskSlots: { 'Flask 4': true, 'Flask 5': true },
    });

    // Global 71% + Local 35% = 106% -> floor((1 + 1.06) * 1.20 * 100) / 100 = 2.47 (exact PoB1 CalcPerform.lua:1938)
    const evalRes = evaluateActiveFlasks(build, 0, { tinctureEffectPct: 71 });
    expect(evalRes.perFlask[0]?.effectMult).toBe(2.47);
    expect(evalRes.perFlask[1]?.effectMult).toBe(2.47);
    // Exact PoB1 integer outputs: floor(162*2.47)=400, floor(30*2.47)=74, floor(243*2.47)=600, floor(46*2.47)=113
    expect(evalRes.modLines).toContain('400% increased Elemental Damage with Attacks');
    expect(evalRes.modLines).toContain('Attack Damage Penetrates 74% Elemental Resistances');
    expect(evalRes.modLines).toContain('600% increased Critical Strike Chance with Attacks');
    expect(evalRes.modLines).toContain('113% increased Attack Speed');
    // Tincture meta lines filtered out
    expect(evalRes.modLines.some((l) => /Inflicts Mana Burn|Cooldown when Deactivated/i.test(l))).toBe(false);

    // Verify parsed mods apply to Attack Projectile skills (e.g. Lightning Strike part 2: Attack|Projectile|Hit, NO ModFlag.Melee)
    const db = new ModDB();
    db.addMods(parseModLines(evalRes.modLines, 'Active Flasks'));
    const lsProjFlags = 1 | 4 | 128; // Attack | Hit | Projectile
    expect(db.sum('INC', 'ElementalDamage', lsProjFlags)).toBe(400);
    expect(db.sum('BASE', 'LightningPenetration', lsProjFlags)).toBe(74);
    expect(db.sum('INC', 'CritChance', lsProjFlags)).toBe(600);
    expect(db.sum('INC', 'Speed', lsProjFlags)).toBe(113);
  });

  it('evaluates PoE 2 Mageblood duplicate Legacy scaling accurately across 1-duplicate and 2-duplicate rolls', () => {
    const mbInvoker = makeItem({
      id: 'mb1',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Sulphur',
        'Legacy of Diamond',
        'Legacy of Silver',
        'Legacy of Sulphur',
        "All Mage's Legacies have 48% increased effect per duplicate Mage's Legacy you have",
      ],
    });
    expect(evaluatePoe2MagebloodLegacies(mbInvoker)).toEqual([
      '88% increased Damage',
      '111% increased Global Critical Strike Chance',
      '44% increased Attack and Cast Speed',
    ]);

    const mbOracle = makeItem({
      id: 'mb2',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Quicksilver',
        'Legacy of Silver',
        'Legacy of Sulphur',
        'Legacy of Silver',
        "All Mage's Legacies have 46% increased effect per duplicate Mage's Legacy you have",
      ],
    });
    expect(evaluatePoe2MagebloodLegacies(mbOracle)).toEqual([
      '43% increased Movement Speed',
      '43% increased Attack and Cast Speed',
      '87% increased Damage',
    ]);

    const mbTwoDupes = makeItem({
      id: 'mb3',
      name: 'Mageblood',
      baseName: 'Heavy Belt',
      rarity: 'UNIQUE',
      explicits: [
        'Legacy of Sulphur',
        'Legacy of Silver',
        'Legacy of Sulphur',
        'Legacy of Sulphur',
        "All Mage's Legacies have 49% increased effect per duplicate Mage's Legacy you have",
      ],
    });
    // 2 duplicates * 49% = +98% effect -> floor(60 * 1.98) = 118, floor(30 * 1.98) = 59
    expect(evaluatePoe2MagebloodLegacies(mbTwoDupes)).toEqual([
      '118% increased Damage',
      '59% increased Attack and Cast Speed',
    ]);
  });
});
