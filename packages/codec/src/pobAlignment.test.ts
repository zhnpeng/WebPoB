import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSamplePoe1Build,
  createSamplePoe2Build,
  getTreeForGame,
  hydrateCompactTree,
  registerBaseItems,
  registerGemsData,
  registerTreeData,
  UTILITY_FLASK_BUFFS,
  type CompactBaseItemsPayload,
  type CompactGemsPayload,
  type CompactTreePayload,
} from '@webpob/data';
import {
  buildToPobXml,
  CANONICAL_UTILITY_FLASK_BASES,
  encodeBuildToPobCode,
  formatItemToPobText,
  importBuildFromCode,
  interpolateModRanges,
  parseItemText,
  parseMasteryEffectsAttr,
  parseNodeOverrides,
  parseSkillWeaponSets,
  resolveMagicUtilityFlaskBase,
  serializeMasteryEffectsAttr,
  xmlToBuild,
} from './index.js';

interface NinjaFixtureEntry {
  id: string;
  title: string;
  pobCode: string;
}

interface NinjaFixtureFile {
  builds: NinjaFixtureEntry[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../../..');
const dataDir = path.join(rootDir, 'apps/web/public/data');
const ninjaDir = path.join(rootDir, 'fixtures/ninja');

function loadNinjaBuilds(filename: string): NinjaFixtureEntry[] {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(ninjaDir, filename), 'utf-8'),
  ) as NinjaFixtureFile;
  return parsed.builds;
}

describe('PoB XML & Item Codec Full Alignment (Track 01)', () => {
  beforeAll(() => {
    const poe1Tree = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe1-tree-3_30.json'), 'utf-8'),
    ) as CompactTreePayload;
    const poe2Tree = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe2-tree-0_5.json'), 'utf-8'),
    ) as CompactTreePayload;
    const poe1Gems = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe1-gems.json'), 'utf-8'),
    ) as CompactGemsPayload;
    const poe2Gems = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe2-gems.json'), 'utf-8'),
    ) as CompactGemsPayload;
    const poe1Bases = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe1-bases.json'), 'utf-8'),
    ) as CompactBaseItemsPayload;
    const poe2Bases = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'poe2-bases.json'), 'utf-8'),
    ) as CompactBaseItemsPayload;

    registerTreeData(hydrateCompactTree(poe1Tree));
    registerTreeData(hydrateCompactTree(poe2Tree));
    registerGemsData('poe1', poe1Gems);
    registerGemsData('poe2', poe2Gems);
    registerBaseItems(poe1Bases);
    registerBaseItems(poe2Bases);
  });

  describe('1. PoE 1 <Spec masteryEffects> parsing & round-trip serialization', () => {
    it('resolves {nodeId,effectId} against hydrated PoE 1 tree and round-trips through XML', () => {
      const poe1Tree = getTreeForGame('poe1');
      const parsed = parseMasteryEffectsAttr('{13862,64875},{60170,38814}', poe1Tree);
      expect(parsed[13862]).toBeDefined();
      expect(parsed[60170]).toBeDefined();
      expect(parsed[13862]).not.toBe('64875');
      expect(parsed[60170]).not.toBe('38814');

      const serialized = serializeMasteryEffectsAttr(parsed, poe1Tree);
      expect(serialized).toBe('{13862,64875},{60170,38814}');

      // Fallback without tree keeps numeric effectId and round-trips it cleanly
      const withoutTree = parseMasteryEffectsAttr('{13862,64875},{60170,38814}');
      expect(withoutTree).toEqual({ 13862: '64875', 60170: '38814' });
      expect(serializeMasteryEffectsAttr(withoutTree)).toBe('{13862,64875},{60170,38814}');
    });

    it('imports and round-trips masteryEffects on real PoE 1 ninja fixtures without dropping any pairs', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      let totalLoadedMasteries = 0;

      for (const entry of poe1Builds) {
        const { build } = importBuildFromCode(entry.pobCode);
        const specs = build.treeSpecs ?? [build.tree];
        for (const spec of specs) {
          for (const [nodeIdStr, statText] of Object.entries(spec.masteryEffects)) {
            expect(Number(nodeIdStr)).toBeGreaterThan(0);
            expect(statText.trim().length).toBeGreaterThan(0);
            expect(/^\d+$/.test(statText.trim())).toBe(false);
            totalLoadedMasteries++;
          }
        }

        const reencoded = encodeBuildToPobCode(build);
        const { build: roundTripped, xml: roundTrippedXml } = importBuildFromCode(reencoded);
        expect(roundTripped.tree.masteryEffects).toEqual(build.tree.masteryEffects);
        if (Object.keys(build.tree.masteryEffects).length > 0) {
          expect(roundTrippedXml).toContain('masteryEffects="');
        }
      }

      // All 109 mastery pairs across 21 specs in the 6 PoE 1 fixtures
      expect(totalLoadedMasteries).toBe(109);
    });
  });

  describe('2. PoE 1 <Overrides><Override> (Tattoos & Runegrafts) parsing & round-trip', () => {
    it('parses single-line, multi-line, and self-closing <Override> nodes and round-trips cleanly', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1" />
  <Tree activeSpec="1">
    <Spec treeVersion="3_30" nodes="54447,5296,4011">
      <Overrides>
        <Override nodeId="5296" dn="Tattoo of the Arohongui Shaman">
          5% increased Effect of Herald Buffs on you
        </Override>
        <Override nodeId="4011" dn="Runegraft of the Warp">
          Buffs on you expire 30% slower
          Debuffs on you expire 30% faster
        </Override>
      </Overrides>
    </Spec>
  </Tree>
</PathOfBuilding>`;

      const build = xmlToBuild(xml);
      expect(build.tree.nodeOverrides).toEqual({
        5296: {
          name: 'Tattoo of the Arohongui Shaman',
          stats: ['5% increased Effect of Herald Buffs on you'],
        },
        4011: {
          name: 'Runegraft of the Warp',
          stats: ['Buffs on you expire 30% slower', 'Debuffs on you expire 30% faster'],
        },
      });

      const exportedXml = buildToPobXml(build);
      expect(exportedXml).toContain('<Overrides>');
      expect(exportedXml).toContain('<Override nodeId="5296" dn="Tattoo of the Arohongui Shaman">');
      expect(exportedXml).toContain('5% increased Effect of Herald Buffs on you');

      const roundTripped = xmlToBuild(exportedXml);
      expect(roundTripped.tree.nodeOverrides).toEqual(build.tree.nodeOverrides);
    });

    it('imports all 102 Tattoo <Override> entries across real PoE 1 fixtures and round-trips them', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      let totalOverrides = 0;
      let buildsWithOverrides = 0;

      for (const entry of poe1Builds) {
        const { build } = importBuildFromCode(entry.pobCode);
        const specs = build.treeSpecs ?? [build.tree];
        const buildOverrideCount = specs.reduce(
          (sum, spec) => sum + Object.keys(spec.nodeOverrides ?? {}).length,
          0,
        );
        if (buildOverrideCount > 0) buildsWithOverrides++;
        totalOverrides += buildOverrideCount;

        const roundTripped = xmlToBuild(buildToPobXml(build));
        expect(roundTripped.tree.nodeOverrides).toEqual(build.tree.nodeOverrides);
      }

      expect(buildsWithOverrides).toBe(5);
      expect(totalOverrides).toBe(102);
    });

    it('ignores <AttributeOverride> when parsing PoE 1 <Override> elements', () => {
      const inner = `
        <Overrides>
          <AttributeOverride strNodes="101,102" dexNodes="201" />
          <Override nodeId="301" dn="Tattoo of the Tukohama Brawler">+4% chance to Knock Enemies Back on hit</Override>
        </Overrides>
      `;
      expect(parseNodeOverrides(inner)).toEqual({
        301: {
          name: 'Tattoo of the Tukohama Brawler',
          stats: ['+4% chance to Knock Enemies Back on hit'],
        },
      });
    });
  });

  describe('3. Item variant filtering ({variant:N}) and range interpolation ({range:X} / <ModRange>)', () => {
    it('interpolates integer, decimal, dual, negative, and advanced-copy ranges accurately', () => {
      expect(interpolateModRanges('{range:0.5}+(25-35) to Strength')).toBe('{range:0.5}+30 to Strength');
      expect(interpolateModRanges('{range:0.5}+(11-12)% to Fire and Chaos Resistances')).toBe(
        '{range:0.5}+12% to Fire and Chaos Resistances',
      );
      expect(interpolateModRanges('{range:1}(33-37)% increased Spell Damage')).toBe(
        '{range:1}37% increased Spell Damage',
      );
      expect(interpolateModRanges('{range:0}(33-37)% increased Spell Damage')).toBe(
        '{range:0}33% increased Spell Damage',
      );
      expect(interpolateModRanges('{range:0.5}(0.4-0.6)% of Physical Attack Damage Leeched as Life')).toBe(
        '{range:0.5}0.5% of Physical Attack Damage Leeched as Life',
      );
      expect(interpolateModRanges('{range:0.5}Adds (1-2) to (3-4) Fire Damage to Spells and Attacks')).toBe(
        '{range:0.5}Adds 2 to 4 Fire Damage to Spells and Attacks',
      );
      // Default 0.5 when no {range:} tag or override is provided
      expect(interpolateModRanges('+(20-40) to maximum Life')).toBe('+30 to maximum Life');
      // Negative range with antonym conversion
      expect(interpolateModRanges('{range:0}(-10-10)% increased Movement Speed')).toBe(
        '{range:0}10% reduced Movement Speed',
      );
      // Alt+Ctrl+C advanced copy preserves rolled value
      expect(interpolateModRanges('+32(25-35) to Strength')).toBe('+32 to Strength');
    });

    it('filters inactive {variant:...} lines while preserving Implicits: N boundaries and <ModRange> indices', () => {
      const mortemXml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" className="Duelist" ascendClassName="Slayer" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="3_30" nodes="54447" /></Tree>
  <Items activeItemSet="1">
    <Item variant="4" id="8">
Rarity: UNIQUE
Mortem Morsu
Fright Claw
Variant: Pre 2.2.0
Variant: Pre 2.6.0
Variant: Pre 3.0.0
Variant: Current
Selected Variant: 4
Quality: 20
Sockets: G-G-G
LevelReq: 34
Implicits: 2
{variant:1,2}2% of Physical Attack Damage Leeched as Life
{variant:3,4}Grants 20 Life per Enemy Hit
{range:0.5}(75-100)% increased Physical Damage
20% increased Attack Speed
25% increased Critical Strike Chance
{variant:1}+25% to Global Critical Strike Multiplier
{variant:2,3,4}+40% to Global Critical Strike Multiplier
(10-20)% of Physical Damage Converted to Chaos Damage
{variant:1,2,3}Poisonous Hit
{variant:4}60% chance to Poison on Hit
25% reduced Enemy Stun Threshold with this Weapon
<ModRange id="1" range="0.5"/>
<ModRange id="2" range="0.5"/>
<ModRange id="3" range="0.5"/>
<ModRange id="8" range="1"/>
    </Item>
    <ItemSet id="1"><Slot name="Weapon 1" itemId="8" /></ItemSet>
  </Items>
</PathOfBuilding>`;

      const build = xmlToBuild(mortemXml);
      const claw = build.items['imp_item_8']!;
      expect(claw.variant).toBe(4);
      expect(claw.selectedVariant).toBe(4);
      // Implicit boundary must keep only variant 4 implicit and never pull explicit #1 into implicits!
      expect(claw.implicits).toEqual(['Grants 20 Life per Enemy Hit']);
      expect(claw.explicits).toContain('88% increased Physical Damage');
      expect(claw.explicits).toContain('+40% to Global Critical Strike Multiplier');
      // Line 8 had no inline {range:}, so it used <ModRange id="8" range="1"/> -> 20%
      expect(claw.explicits).toContain('20% of Physical Damage Converted to Chaos Damage');
      expect(claw.explicits).toContain('60% chance to Poison on Hit');
      // Inactive variant lines MUST be excluded
      const allMods = [...claw.implicits, ...claw.explicits];
      expect(allMods).not.toContain('2% of Physical Attack Damage Leeched as Life');
      expect(allMods).not.toContain('+25% to Global Critical Strike Multiplier');
      expect(allMods).not.toContain('Poisonous Hit');
    });

    it('supports variantAlt attributes (e.g. Cinderswallow Urn) and eliminates raw (min-max) ranges on real PoE 1 fixtures', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      const rawRangePattern = /\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)/;

      for (const entry of poe1Builds) {
        const { build } = importBuildFromCode(entry.pobCode);
        for (const item of Object.values(build.items)) {
          for (const line of [...item.implicits, ...item.explicits]) {
            expect(
              rawRangePattern.test(line),
              `${entry.id} -> ${item.name} retained uninterpolated range: "${line}"`,
            ).toBe(false);
          }
        }
      }

      // Check Cinderswallow Urn (variant="16" variantAlt="9") in poe1-elementalist-chaos-golem
      const elemEntry = poe1Builds.find((b) => b.id === 'poe1-elementalist-chaos-golem')!;
      const { build: elemBuild } = importBuildFromCode(elemEntry.pobCode);
      const cinderswallow = Object.values(elemBuild.items).find((i) => i.name === 'Cinderswallow Urn');
      expect(cinderswallow).toBeDefined();
      expect(cinderswallow!.variant).toBe(16);
      // Verify variant filtering kept the active lines instead of merging all 18 variants
      expect(cinderswallow!.explicits.length).toBeLessThan(12);

      // Check Mortem Morsu in poe1-slayer-elemental-hit
      const slayerEntry = poe1Builds.find((b) => b.id === 'poe1-slayer-elemental-hit')!;
      const { build: slayerBuild } = importBuildFromCode(slayerEntry.pobCode);
      const mortem = Object.values(slayerBuild.items).find((i) => i.name === 'Mortem Morsu');
      expect(mortem).toBeDefined();
      expect(mortem!.implicits).toEqual(['Grants 20 Life per Enemy Hit']);
      expect(mortem!.explicits).toContain('+40% to Global Critical Strike Multiplier');
      expect(mortem!.explicits).not.toContain('+25% to Global Critical Strike Multiplier');
    });
  });

  describe('4. Shield base blockChance preservation in itemParser.ts', () => {
    it('merges officialBase.armour.blockChance even when XML provides Armour/ES without Chance to Block', () => {
      const shieldText = `Rarity: RARE
New Item
Thorium Spirit Shield
Energy Shield: 245
Quality: 20
Implicits: 0
+80 to maximum Life`;

      const parsed = parseItemText(shieldText, 'shield_1', 'poe1');
      expect(parsed).not.toBeNull();
      expect(parsed!.armourStats?.energyShield).toBe(245);
      expect(parsed!.armourStats?.blockChance).toBeGreaterThan(0);

      // Explicit Chance to Block in item text MUST NOT be overwritten
      const explicitBlockText = `Rarity: RARE
Custom Shield
Thorium Spirit Shield
Chance to Block: 34%
Energy Shield: 245
Implicits: 0`;
      const explicitParsed = parseItemText(explicitBlockText, 'shield_2', 'poe1');
      expect(explicitParsed!.armourStats?.blockChance).toBe(34);
    });

    it('preserves base blockChance on shields across real PoE 1 fixtures (Thorium Spirit Shield, Aegis Aurora, Malachai\'s Loop)', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      const shieldBuildIds = [
        'poe1-elementalist-chaos-golem',
        'poe1-assassin-winter-orb',
        'poe1-scion-luminary-static-strike',
      ];

      for (const buildId of shieldBuildIds) {
        const entry = poe1Builds.find((b) => b.id === buildId)!;
        const { build } = importBuildFromCode(entry.pobCode);
        const offhandId = build.equipped['Weapon 2'];
        expect(offhandId, `${buildId} should equip a shield in Weapon 2`).toBeDefined();
        const shield = build.items[offhandId!]!;
        expect(
          shield.armourStats?.blockChance,
          `${buildId} shield (${shield.name} / ${shield.baseName}) must preserve base blockChance`,
        ).toBeGreaterThanOrEqual(20);
      }
    });
  });

  describe('5. Magic Utility Flask baseName resolution', () => {
    it('resolves all 18 canonical utility flask bases from MAGIC names and round-trips cleanly', () => {
      for (const canonicalBase of CANONICAL_UTILITY_FLASK_BASES) {
        const magicName = `Alchemist's ${canonicalBase} of the Armadillo`;
        expect(resolveMagicUtilityFlaskBase(magicName)).toBe(canonicalBase);

        const parsed = parseItemText(
          `Rarity: MAGIC
${magicName}
Quality: 20
Implicits: 0
55% increased Armour during Effect`,
          `flask_${canonicalBase}`,
          'poe1',
        );
        expect(parsed).not.toBeNull();
        expect(parsed!.name).toBe(magicName);
        expect(parsed!.baseName).toBe(canonicalBase);
        expect(parsed!.explicits).toEqual(['55% increased Armour during Effect']);

        // Round-trip via formatItemToPobText must NOT leak baseName into explicits
        const formatted = formatItemToPobText(parsed!);
        const reparsed = parseItemText(formatted, parsed!.id, 'poe1');
        expect(reparsed!.name).toBe(magicName);
        expect(reparsed!.baseName).toBe(canonicalBase);
        expect(reparsed!.explicits).toEqual(['55% increased Armour during Effect']);
      }
    });

    it('resolves equipped magic utility flasks in real PoE 1 fixtures so UTILITY_FLASK_BUFFS matches 100%', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      let matchedMagicUtilityFlasks = 0;

      for (const entry of poe1Builds) {
        const { build } = importBuildFromCode(entry.pobCode);
        for (const slot of ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'] as const) {
          const itemId = build.equipped[slot];
          if (!itemId) continue;
          const flask = build.items[itemId];
          if (!flask || flask.rarity !== 'MAGIC') continue;
          if (!/Flask/i.test(flask.name) || /Life Flask|Mana Flask|Hybrid Flask/i.test(flask.name)) continue;

          expect(
            CANONICAL_UTILITY_FLASK_BASES.includes(flask.baseName),
            `${entry.id} ${slot} ("${flask.name}") resolved unexpected baseName "${flask.baseName}"`,
          ).toBe(true);
          if (flask.baseName !== 'Gold Flask' && flask.baseName !== 'Iron Flask' && flask.baseName !== 'Aquamarine Flask' && flask.baseName !== 'Corundum Flask') {
            expect(
              UTILITY_FLASK_BUFFS[flask.baseName],
              `${flask.baseName} should exist in UTILITY_FLASK_BUFFS`,
            ).toBeDefined();
          }
          matchedMagicUtilityFlasks++;
        }
      }

      expect(matchedMagicUtilityFlasks).toBeGreaterThanOrEqual(10);
    });
  });

  describe('6. <Config activeConfigSet> strict selection, input aliases & <CustomModifierBlock>', () => {
    it('reads ONLY activeConfigSet, supports all PoB/WebPoB input aliases, and imports enabled <CustomModifierBlock>s', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" className="Witch" ascendClassName="Occultist" mainSocketGroup="1" />
  <Tree activeSpec="1"><Spec treeVersion="3_30" nodes="54447" /></Tree>
  <Config activeConfigSet="2">
    <ConfigSet id="1" title="Levelling">
      <Input name="customMods" string="+200 to all resistances" />
      <Input name="conditionEnemyShocked" boolean="false" />
      <Input name="multiplierRage" number="99" />
      <CustomModifierBlock title="LevellingHack" enabled="true">+500 to maximum Life</CustomModifierBlock>
    </ConfigSet>
    <ConfigSet id="2" title="Endgame">
      <Input boolean="true" name="conditionEnemyShocked" />
      <Input name="conditionShockEffect" number="45" />
      <Input boolean="true" name="conditionEnemyChilled" />
      <Input name="conditionLowLife" boolean="true" />
      <Input boolean="true" name="conditionFullLife" />
      <Input name="multiplierRage" number="35" />
      <Input name="multiplierWitheredStackCount" number="15" />
      <Input name="usePowerCharges" boolean="true" />
      <Input name="useFrenzyCharges" boolean="true" />
      <Input name="useEnduranceCharges" boolean="true" />
      <CustomModifierBlock title="ActiveBlock" enabled="true">
        15% more Damage
      </CustomModifierBlock>
      <CustomModifierBlock title="DisabledBlock" enabled="false">
        999% more Damage
      </CustomModifierBlock>
    </ConfigSet>
    <ConfigSet id="3" title="FuturePlan">
      <Input name="conditionEnemyShocked" boolean="false" />
      <Input name="conditionShockEffect" number="5" />
      <Input name="customMods" string="SHOULD NOT LEAK" />
    </ConfigSet>
  </Config>
</PathOfBuilding>`;

      const build = xmlToBuild(xml);
      expect(build.config.enemyShocked).toBe(true);
      expect(build.config.shockValue).toBe(45);
      expect(build.config.enemyChilled).toBe(true);
      expect(build.config.conditionLowLife).toBe(true);
      expect(build.config.conditionFullLife).toBe(true);
      expect(build.config.rage).toBe(35);
      expect(build.config.witheredStacks).toBe(15);
      expect(build.config.usePowerCharges).toBe(true);
      expect(build.config.useFrenzyCharges).toBe(true);
      expect(build.config.useEnduranceCharges).toBe(true);
      expect(build.config.customMods).toContain('15% more Damage');
      expect(build.config.customMods).not.toContain('+200 to all resistances');
      expect(build.config.customMods).not.toContain('+500 to maximum Life');
      expect(build.config.customMods).not.toContain('999% more Damage');
      expect(build.config.customMods).not.toContain('SHOULD NOT LEAK');

      // Round-trip preserves enemyShocked, shockValue, enemyChilled, conditionLowLife, conditionFullLife, rage, witheredStacks
      const roundTripped = xmlToBuild(buildToPobXml(build));
      expect(roundTripped.config.enemyShocked).toBe(true);
      expect(roundTripped.config.shockValue).toBe(45);
      expect(roundTripped.config.enemyChilled).toBe(true);
      expect(roundTripped.config.conditionLowLife).toBe(true);
      expect(roundTripped.config.conditionFullLife).toBe(true);
      expect(roundTripped.config.rage).toBe(35);
      expect(roundTripped.config.witheredStacks).toBe(15);
    });

    it('strictly selects activeConfigSet and parses Shock/Chill/FullLife/CustomModifierBlock on real PoE 1 fixtures', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');

      // poe1-slayer-elemental-hit: activeConfigSet="7" must NOT inherit "+200 to all resistances" from sets 4/5/6
      const slayer = importBuildFromCode(
        poe1Builds.find((b) => b.id === 'poe1-slayer-elemental-hit')!.pobCode,
      ).build;
      expect(slayer.config.enemyShocked).toBe(true);
      expect(slayer.config.shockValue).toBe(7);
      expect(slayer.config.enemyChilled).toBe(true);
      expect(slayer.config.rage).toBe(15);
      expect(slayer.config.customMods).not.toContain('+200 to all resistances');

      // poe1-hierophant-spark-nova: conditionEnemyShocked + conditionShockEffect=50 + CustomModifierBlock
      const hiero = importBuildFromCode(
        poe1Builds.find((b) => b.id === 'poe1-hierophant-spark-nova')!.pobCode,
      ).build;
      expect(hiero.config.enemyShocked).toBe(true);
      expect(hiero.config.shockValue).toBe(50);
      expect(hiero.config.customMods).toContain('punishment has 50% reduced curse effect');

      // poe1-assassin-winter-orb: conditionEnemyChilled + CustomModifierBlock
      const assassin = importBuildFromCode(
        poe1Builds.find((b) => b.id === 'poe1-assassin-winter-orb')!.pobCode,
      ).build;
      expect(assassin.config.enemyChilled).toBe(true);
      expect(assassin.config.customMods).toContain('1099% increased Critical Strike Chance');

      // poe1-scion-luminary-static-strike: conditionFullLife + conditionEnemyChilled + CustomModifierBlock
      const scion = importBuildFromCode(
        poe1Builds.find((b) => b.id === 'poe1-scion-luminary-static-strike')!.pobCode,
      ).build;
      expect(scion.config.conditionFullLife).toBe(true);
      expect(scion.config.enemyChilled).toBe(true);
      expect(scion.config.customMods).toContain('Minions deal 1000% increased Damage');
    });
  });

  describe('7. PoE 2 XML Fidelity (targetVersion, set1/set2 skill flags, <Spec><Sockets> preservation)', () => {
    it('emits targetVersion="0_1" for PoE 2 and targetVersion="3_0" for PoE 1', () => {
      const poe1Xml = buildToPobXml(createSamplePoe1Build());
      const poe2Xml = buildToPobXml(createSamplePoe2Build());
      expect(poe1Xml).toContain('targetVersion="3_0"');
      expect(poe2Xml).toContain('targetVersion="0_1"');
    });

    it('parses PoB2 <Skill set1/set2> attributes into weaponSets alongside weaponSets="1,2" and round-trips', () => {
      expect(parseSkillWeaponSets({ set1: 'true', set2: 'false' }, 'poe2')).toEqual([1]);
      expect(parseSkillWeaponSets({ set1: 'false', set2: 'true' }, 'poe2')).toEqual([2]);
      expect(parseSkillWeaponSets({ set1: 'true', set2: 'true' }, 'poe2')).toEqual([1, 2]);
      expect(parseSkillWeaponSets({ set1: 'false', set2: 'false' }, 'poe2')).toEqual([]);
      expect(parseSkillWeaponSets({ weaponSets: '2' }, 'poe2')).toEqual([2]);
      expect(parseSkillWeaponSets({}, 'poe2')).toEqual([1, 2]);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="Stormweaver" mainSocketGroup="1" />
  <Tree activeSpec="1">
    <Spec treeVersion="0_5" nodes="2408">
      <Sockets>
        <Socket nodeId="65536" itemId="1" />
        <Socket nodeId="26178" itemId="2" />
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill enabled="true" set1="true" set2="false" label="Set1 Spark">
        <Gem nameSpec="Spark" level="20" quality="20" enabled="true" />
      </Skill>
      <Skill enabled="true" set1="false" set2="true" label="Set2 Arc">
        <Gem nameSpec="Arc" level="20" quality="0" enabled="true" />
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Voices Subsocket Jewel
Cobalt Jewel
Implicits: 0
+10% to Fire Resistance
    </Item>
    <Item id="2">
Rarity: RARE
External Socket Jewel
Sapphire
Implicits: 0
+12% to Cold Resistance
    </Item>
    <ItemSet id="1" />
  </Items>
</PathOfBuilding2>`;

      const build = xmlToBuild(xml);
      expect(build.skills[0]!.weaponSets).toEqual([1]);
      expect(build.skills[1]!.weaponSets).toEqual([2]);
      // Voices / cluster / non-tree socket nodeIds MUST NOT be dropped from socketedJewels
      expect(build.tree.socketedJewels).toEqual({
        65536: 'imp_item_1',
        26178: 'imp_item_2',
      });

      const exported = buildToPobXml(build);
      expect(exported).toContain('targetVersion="0_1"');
      expect(exported).toContain('set1="true" set2="false"');
      expect(exported).toContain('set1="false" set2="true"');
      expect(exported).toContain('<Socket nodeId="65536"');
      expect(exported).toContain('<Socket nodeId="26178"');

      const roundTripped = xmlToBuild(exported);
      expect(roundTripped.skills[0]!.weaponSets).toEqual([1]);
      expect(roundTripped.skills[1]!.weaponSets).toEqual([2]);
      expect(roundTripped.tree.socketedJewels).toEqual({
        65536: 'imp_item_1',
        26178: 'imp_item_2',
      });
    });

    it('preserves non-tree <Spec><Sockets> jewel nodeIds across real PoE 1 & PoE 2 ninja fixtures', () => {
      const poe1Builds = loadNinjaBuilds('poe1-builds.json');
      const poe2Builds = loadNinjaBuilds('poe2-builds.json');

      // poe1-assassin-winter-orb has 3.29 jewel sockets 18436 & 22748 absent from 3.30 tree.nodes
      const assassin = importBuildFromCode(
        poe1Builds.find((b) => b.id === 'poe1-assassin-winter-orb')!.pobCode,
      ).build;
      expect(assassin.tree.socketedJewels?.[18436]).toBeDefined();
      expect(assassin.tree.socketedJewels?.[22748]).toBeDefined();

      // poe2-stormweaver-spark has sockets 26178 & 62152 absent from poe2-tree-0_5.json
      const spark = importBuildFromCode(
        poe2Builds.find((b) => b.id === 'poe2-stormweaver-spark')!.pobCode,
      ).build;
      expect(spark.tree.socketedJewels?.[26178]).toBeDefined();
      expect(spark.tree.socketedJewels?.[62152]).toBeDefined();
    });
  });
});
