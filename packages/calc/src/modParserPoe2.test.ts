import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KeywordFlag, ModFlag, type GemDefinition } from '@webpob/core';
import {
  gemMatchesFilterKey,
  normalizeGemFilterTokens,
  resolveSupportGemLevelBonus,
} from './gemBonus.js';
import { parseModLine, parseModLines } from './modParser.js';
import { POE2_EXTRA_MOD_RULES } from './modParserPoe2.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../../..');
const poe2TreePath = path.join(rootDir, 'apps/web/public/data/poe2-tree-0_5.json');

interface CompactTreeNode {
  id: number;
  en: string;
  k: string;
  st?: string[];
}

describe('PoE 2 ModParser Expansion (modParserPoe2)', () => {
  it('exports at least 150 PoE 2 modifier rules', () => {
    expect(POE2_EXTRA_MOD_RULES.length).toBeGreaterThanOrEqual(150);
  });

  describe('P0 PoE 2 Keystones', () => {
    it('parses Chaos Inoculation (PoE 2 two-line wording)', () => {
      const mods = parseModLines(
        ['Maximum Life is 1', 'Immune to Chaos Damage and Bleeding'],
        'Keystone: Chaos Inoculation',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Life', type: 'OVERRIDE', value: 1 }),
          expect.objectContaining({ name: 'ChaosImmune', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'BleedImmune', type: 'FLAG', value: true }),
        ]),
      );
    });

    it('parses Blood Magic (PoE 2 wording)', () => {
      const mods = parseModLines(
        ['You have no Mana', 'Skill Mana Costs Converted to Life Costs'],
        'Keystone: Blood Magic',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Mana', type: 'OVERRIDE', value: 0 }),
          expect.objectContaining({ name: 'BloodMagic', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'ManaCostConvertToLife', type: 'BASE', value: 100 }),
        ]),
      );
    });

    it('parses Mind Over Matter (PoE 2 wording)', () => {
      const mods = parseModLines(
        ['All Damage is taken from Mana before Life', '50% less Mana Recovery Rate'],
        'Keystone: Mind Over Matter',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'DamageTakenFromManaBeforeLife', type: 'BASE', value: 100 }),
          expect.objectContaining({ name: 'ManaRecoveryRate', type: 'MORE', value: -50 }),
        ]),
      );
    });

    it('parses Eldritch Battery (PoE 2 ES -> Mana conversion)', () => {
      const mods = parseModLines(
        ['Convert 100% of maximum Energy Shield to maximum Mana', 'Mana Costs are Doubled'],
        'Keystone: Eldritch Battery',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Poe2EldritchBattery', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'EsConvertToMana', type: 'BASE', value: 100 }),
          expect.objectContaining({ name: 'ManaCost', type: 'MORE', value: 100 }),
        ]),
      );
    });

    it('parses Resolute Technique (PoE 2 wording)', () => {
      const mods = parseModLines(
        ['Accuracy Rating is Doubled', 'Never deal Critical Hits'],
        'Keystone: Resolute Technique',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Accuracy', type: 'MORE', value: 100 }),
          expect.objectContaining({ name: 'NeverCrit', type: 'FLAG', value: true }),
        ]),
      );
    });

    it('parses Pain Attunement (PoE 2 Critical Damage Bonus)', () => {
      const mods = parseModLines(
        [
          '30% less Critical Damage Bonus when on Full Life',
          '30% more Critical Damage Bonus when on Low Life',
        ],
        'Keystone: Pain Attunement',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'CritDamageBonusLowLifeMore', type: 'BASE', value: 30 }),
          expect.objectContaining({ name: 'PainAttunement', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'CritDamageBonusFullLifeMore', type: 'BASE', value: -30 }),
        ]),
      );
    });

    it('parses Avatar of Fire (75% global Damage Converted to Fire Damage)', () => {
      const mods = parseModLines(
        ['75% of Damage Converted to Fire Damage', 'Deal no Non-Fire Damage'],
        'Keystone: Avatar of Fire',
      );
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PhysicalDamageConvertToFire', type: 'BASE', value: 75 }),
          expect.objectContaining({ name: 'ColdDamageConvertToFire', type: 'BASE', value: 75 }),
          expect.objectContaining({ name: 'LightningDamageConvertToFire', type: 'BASE', value: 75 }),
          expect.objectContaining({ name: 'ChaosDamageConvertToFire', type: 'BASE', value: 75 }),
          expect.objectContaining({ name: 'DealNoNonFire', type: 'FLAG', value: true }),
        ]),
      );
    });

    it('parses Zealot\'s Oath, Giant\'s Blood, Acrobatics, Eternal Youth, Whispers of Doom, and Ancestral Bond', () => {
      expect(
        parseModLine('Excess Life Recovery from Regeneration is applied to Energy Shield', 'ks'),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'ZealotsOath', type: 'FLAG', value: true })]));

      expect(
        parseModLine('You can wield Two-Handed Axes, Maces and Swords in one hand', 'ks'),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'GiantsBlood', type: 'FLAG', value: true })]));

      expect(parseModLine('Acrobatics', 'ks')).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Acrobatics', type: 'FLAG', value: true })]),
      );

      expect(parseModLine('Life Recharges instead of Energy Shield', 'ks')).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'EternalYouth', type: 'FLAG', value: true })]),
      );

      expect(parseModLine('You can apply an additional Curse', 'ks')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'WhispersOfDoom', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'EnemyCurseLimit', type: 'BASE', value: 1 }),
        ]),
      );

      expect(parseModLine('Your Totem Limit is doubled', 'ks')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'AncestralBond', type: 'FLAG', value: true }),
        ]),
      );
    });
  });

  describe('P0 PoE 2 Notables, Crit, Speed, Attributes & Defences', () => {
    it('parses Spectral Ward ("Item Evasion" wording)', () => {
      const mods = parseModLine(
        '+1 to Maximum Energy Shield per 12 Item Evasion on Equipped Body Armour',
        'Notable: Spectral Ward',
      );
      expect(mods).toHaveLength(1);
      expect(mods[0]?.name).toBe('EsPerBodyEvasion');
      expect(mods[0]?.type).toBe('BASE');
      expect(mods[0]?.value).toBeCloseTo(1 / 12, 6);
    });

    it('parses Skill Speed (Attack + Cast Speed)', () => {
      const mods = parseModLine('12% increased Skill Speed', 'item');
      expect(mods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Speed', type: 'INC', value: 12, flags: ModFlag.Attack }),
          expect.objectContaining({ name: 'Speed', type: 'INC', value: 12, flags: ModFlag.Spell }),
        ]),
      );
    });

    it('parses PoE 2 Crit Damage Bonus and Crit Hit Chance wordings', () => {
      expect(parseModLine('27% increased Critical Spell Damage Bonus', 'jewel')).toEqual([
        expect.objectContaining({ name: 'CritDamageBonusInc', type: 'INC', value: 27, flags: ModFlag.Spell }),
      ]);
      expect(parseModLine('34% increased Critical Damage Bonus for Attack Damage', 'jewel')).toEqual([
        expect.objectContaining({ name: 'CritDamageBonusInc', type: 'INC', value: 34, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('25% increased Critical Hit Chance for Attacks', 'jewel')).toEqual([
        expect.objectContaining({ name: 'CritChance', type: 'INC', value: 25, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('Attacks have +1% to Critical Hit Chance', 'notable')).toEqual([
        expect.objectContaining({ name: 'CritChance', type: 'BASE', value: 1, flags: ModFlag.Attack }),
      ]);
      expect(parseModLine('Base Critical Hit Chance for Spells is 15%', 'ascendancy')).toEqual([
        expect.objectContaining({ name: 'SpellBaseCritOverride', type: 'BASE', value: 15, flags: ModFlag.Spell }),
      ]);
      expect(parseModLine('20% reduced Critical Hit Chance', 'notable')).toEqual([
        expect.objectContaining({ name: 'CritChance', type: 'INC', value: -20 }),
      ]);
    });

    it('parses % increased Attributes, Spirit, Deflection, Block, Armour-to-Ele, and Skill Levels', () => {
      expect(parseModLine('4% increased Strength', 'asc')).toEqual([
        expect.objectContaining({ name: 'Str', type: 'INC', value: 4 }),
      ]);
      expect(parseModLine('5% increased Dexterity', 'notable')).toEqual([
        expect.objectContaining({ name: 'Dex', type: 'INC', value: 5 }),
      ]);
      expect(parseModLine('6% increased Intelligence', 'notable')).toEqual([
        expect.objectContaining({ name: 'Int', type: 'INC', value: 6 }),
      ]);
      expect(parseModLine('8% increased all Attributes', 'item')).toHaveLength(3);
      expect(parseModLine('18% increased Spirit', 'item')).toEqual([
        expect.objectContaining({ name: 'Spirit', type: 'INC', value: 18 }),
      ]);
      expect(parseModLine('Gain Deflection Rating equal to 8% of Evasion Rating', 'node')).toEqual([
        expect.objectContaining({ name: 'DeflectionPerEvasionPct', type: 'BASE', value: 8 }),
      ]);
      expect(parseModLine('+15% of Armour also applies to Elemental Damage', 'node')).toEqual([
        expect.objectContaining({ name: 'ArmourAppliesToElementalPct', type: 'BASE', value: 15 }),
      ]);
      expect(parseModLine('10% increased Block chance', 'node')).toEqual([
        expect.objectContaining({ name: 'BlockChance', type: 'INC', value: 10 }),
      ]);
      expect(parseModLine('Aura Skills have 19% increased Magnitudes', 'item')).toEqual([
        expect.objectContaining({ name: 'AuraEffect', type: 'INC', value: 19 }),
      ]);
      expect(parseModLine('+3 to Level of all Earthshatter Skills', 'jewel')).toEqual([
        expect.objectContaining({ name: 'GemLevel:earthshatter', type: 'BASE', value: 3 }),
      ]);
      expect(parseModLine('+1 to Level of all Nova Skill Gems', 'item')).toEqual([
        expect.objectContaining({ name: 'GemLevel:nova', type: 'BASE', value: 1 }),
      ]);
    });
  });

  describe('PoE 2 Passive Tree & Keystone Coverage Targets (poe2-tree-0_5.json)', () => {
    it('achieves >= 60% line coverage on PoE 2 passive tree (excluding +5 to any Attribute) and >= 55% Keystone coverage', () => {
      const raw = JSON.parse(fs.readFileSync(poe2TreePath, 'utf-8')) as {
        nodes: Record<string, CompactTreeNode>;
      };
      const nodes = Object.values(raw.nodes);

      let totalExclAnyAttr = 0;
      let parsedExclAnyAttr = 0;
      let ksTotalLines = 0;
      let ksParsedLines = 0;
      let ksFullNodes = 0;
      let ksCount = 0;

      for (const node of nodes) {
        const lines = (node.st ?? [])
          .flatMap((s) => s.split(/\r?\n/))
          .map((s) => s.trim())
          .filter(Boolean);

        if (node.k === 'K') {
          ksCount++;
          let okInNode = 0;
          for (const line of lines) {
            ksTotalLines++;
            if (parseModLine(line, `Keystone:${node.en}`).length > 0) {
              ksParsedLines++;
              okInNode++;
            }
          }
          if (lines.length > 0 && okInNode === lines.length) {
            ksFullNodes++;
          }
        }

        for (const line of lines) {
          if (/^\+\d+ to any Attribute$/i.test(line)) continue;
          totalExclAnyAttr++;
          if (parseModLine(line, `Node:${node.id}`).length > 0) {
            parsedExclAnyAttr++;
          }
        }
      }

      const treeCoveragePct = (parsedExclAnyAttr / totalExclAnyAttr) * 100;
      const ksLineCoveragePct = (ksParsedLines / ksTotalLines) * 100;
      const ksNodeCoveragePct = (ksFullNodes / ksCount) * 100;

      expect(treeCoveragePct).toBeGreaterThanOrEqual(60);
      expect(ksLineCoveragePct).toBeGreaterThanOrEqual(55);
      expect(ksNodeCoveragePct).toBeGreaterThanOrEqual(55);
    });
  });

  describe('Wave 4J PoE 2 mechanics rules', () => {
    it('unifies BleedingMagnitude, parses Low Tolerance AilmentEffect & Critical Hits Poison', () => {
      const bleed = parseModLine('20% increased Magnitude of Bleeding you inflict', 'Tree');
      expect(bleed).toEqual([
        expect.objectContaining({ name: 'BleedingMagnitude', type: 'INC', value: 20 }),
      ]);

      const lowTol = parseModLine(
        '60% increased Magnitude of Poison you inflict on targets that are not Poisoned',
        'Tree: Low Tolerance',
      );
      expect(lowTol).toEqual([
        expect.objectContaining({ name: 'AilmentEffect', type: 'INC', value: 60 }),
      ]);

      const atsak = parseModLine('Critical Hits Poison the enemy', "Item: Atsak's Sight");
      expect(atsak).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'CritPoisonChance', type: 'BASE', value: 100 }),
          expect.objectContaining({
            name: 'PoisonChance',
            type: 'OVERRIDE',
            value: 100,
            tags: [{ type: 'Condition', var: 'CriticalStrike' }],
          }),
        ]),
      );
    });

    it('parses Random Element gain, Turning of the Seasons exposure, Reality Rending, and Dance with Death', () => {
      const turning = parseModLines(
        [
          'Enemies in your Presence have Exposure',
          'Gain 10% of Damage as Extra Damage of a random Element',
        ],
        'Tree: Turning of the Seasons',
      );
      expect(turning.filter((m) => m.target === 'enemy' && m.name.endsWith('Exposure'))).toHaveLength(3);
      expect(turning.find((m) => m.name === 'DamageGainAsFire')?.value).toBeCloseTo(10 / 3, 4);
      expect(turning.find((m) => m.name === 'DamageGainAsCold')?.value).toBeCloseTo(10 / 3, 4);
      expect(turning.find((m) => m.name === 'DamageGainAsLightning')?.value).toBeCloseTo(10 / 3, 4);

      const hiddenForms = parseModLine(
        'Gain 8% of Damage as Extra Damage of a random Element while Shapeshifted',
        'Tree: Hidden Forms',
      );
      expect(hiddenForms).toHaveLength(3);
      expect(hiddenForms[0]?.tags).toEqual([{ type: 'Condition', var: 'Shapeshifted' }]);

      const reality = parseModLines(
        [
          '23% chance to Gain 25% of Damage with Hits as Extra Chaos Damage',
          '13% chance to Gain 50% of Damage with Hits as Extra Chaos Damage',
          '7% chance to Gain 100% of Damage with Hits as Extra Chaos Damage',
        ],
        'Tree: Reality Rending',
      );
      const totalExpectedChaos = reality.reduce((s, m) => s + Number(m.value), 0);
      expect(totalExpectedChaos).toBeCloseTo(19.25, 4);

      const dwdJoined = parseModLine(
        '25% more Skill Speed while Off Hand is empty and you have a One-Handed Martial Weapon equipped in your Main Hand',
        'Tree: Dance with Death',
      );
      expect(dwdJoined).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'DanceWithDeath', type: 'FLAG', value: true }),
          expect.objectContaining({ name: 'DanceWithDeathSkillSpeedMore', type: 'BASE', value: 25 }),
        ]),
      );
    });

    it('parses Power Charge Recently crit multi, HitsInvertEleResChance, GrenadeActivateTwice, Point Blank, Lucky Hits, Skullcrusher, Greatest Defence, Warcry Empower, Leopold, Spear 3m & Bonded', () => {
      const pcCrit = parseModLine(
        "20% increased Critical Damage Bonus if you've consumed a Power Charge Recently",
        'Tree',
      );
      expect(pcCrit).toEqual([
        expect.objectContaining({
          name: 'CritDamageBonusInc',
          type: 'INC',
          value: 20,
          tags: [{ type: 'Condition', var: 'ConsumedPowerChargeRecently' }],
        }),
      ]);

      expect(
        parseModLine(
          'Hits have 15% chance to treat Enemy Monster Elemental Resistance values as inverted',
          'Tree: Dimensional Weakspot',
        ),
      ).toEqual([
        expect.objectContaining({ name: 'HitsInvertEleResChance', type: 'BASE', value: 15 }),
      ]);

      expect(parseModLine('Grenades have 15% chance to activate a second time', 'Tree')).toEqual([
        expect.objectContaining({ name: 'GrenadeActivateTwice', type: 'BASE', value: 15 }),
      ]);

      expect(
        parseModLine(
          'Projectiles deal 20% more Hit damage to targets in the first 3.5 metres of their movement, scaling down with distance travelled to reach 0% after 7 metres',
          'Tree: Point Blank',
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PointBlank', type: 'FLAG', value: true }),
          expect.objectContaining({
            name: 'Damage',
            type: 'MORE',
            value: 20,
            tags: [{ type: 'Condition', var: 'DistanceRamp:35:1,70:0' }],
          }),
        ]),
      );

      expect(parseModLine('15% more Maximum Lightning Damage', 'Tree: Wild Storm')).toEqual([
        expect.objectContaining({ name: 'LightningMaxDamage', type: 'MORE', value: 15 }),
      ]);

      expect(parseModLine('10% chance for Lightning Damage with Hits to be Lucky', 'Jewel')).toEqual([
        expect.objectContaining({ name: 'LightningLuckyHitsChance', type: 'BASE', value: 10 }),
      ]);

      expect(parseModLine('20% more Damage against Heavy Stunned Enemies with Maces', 'Tree')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'MORE',
          value: 20,
          flags: ModFlag.Mace,
          tags: [{ type: 'Condition', var: 'EnemyHeavyStunned' }],
        }),
      ]);

      expect(
        parseModLine(
          '4% increased Attack Damage per 75 Item Armour and Evasion Rating on Equipped Shield',
          'Tree: Greatest Defence',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 4,
          flags: ModFlag.Attack,
          tags: [{ type: 'PerStat', stat: 'ShieldArmourAndEvasion', div: 75 }],
        }),
      ]);

      expect(parseModLine('Warcries Empower an additional Attack', 'Tree')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'WarcryExtraEmpowers', type: 'BASE', value: 1 }),
        ]),
      );

      expect(
        parseModLine(
          'Elemental Penetration can Penetrate Elemental Resistances down to -50%',
          "Item: Leopold's Applause",
        ),
      ).toEqual([
        expect.objectContaining({ name: 'ElementalPenetrationMinimum', type: 'OVERRIDE', value: -50 }),
      ]);

      expect(
        parseModLine(
          '40% increased Projectile Damage with Spears while there are no Enemies within 3m',
          'Tree',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 40,
          flags: ModFlag.Attack | ModFlag.Projectile,
          tags: [{ type: 'Condition', var: 'EnemyDistanceGt:30' }],
        }),
      ]);

      // Bonded gating via allowBonded
      expect(parseModLine('Bonded: 40% increased effect of Fully Broken Armour', 'Rune')).toEqual([]);
      expect(
        parseModLine('Bonded: 40% increased effect of Fully Broken Armour', 'Rune', {
          allowBonded: true,
        }),
      ).toEqual([
        expect.objectContaining({ name: 'FullyBrokenArmourEffect', type: 'INC', value: 40 }),
      ]);
    });

    it('parses Wave 4M PoE 2 mechanics (Lay Siege, Empowered/Ancestral, Grenade/Plant/Hazard, Ailments, Unarmed, Notables, Arcane Surge, PoisonStacksMax & GemLevel)', () => {
      // S8.1: Lay Siege / Offensive Stance
      expect(parseModLine('1% increased Damage per 1% Chance to Block', 'Tree: Lay Siege')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 1,
          tags: [{ type: 'PerStat', stat: 'BlockChance', div: 1 }],
        }),
      ]);

      // S8.2: Empowered Attacks & Ancestrally Boosted Attacks (never leak as unconditional Damage INC!)
      expect(parseModLine('Empowered Attacks deal 16% increased Damage', 'Tree')).toEqual([
        expect.objectContaining({
          name: 'EmpoweredIncrease',
          type: 'INC',
          value: 16,
          flags: ModFlag.Attack,
        }),
      ]);
      expect(parseModLine('Ancestrally Boosted Attacks deal 30% increased Damage', 'Tree: Guided Hand')).toEqual([
        expect.objectContaining({
          name: 'AncestralBoostIncrease',
          type: 'INC',
          value: 30,
          flags: ModFlag.Attack,
        }),
      ]);
      expect(
        parseModLine(
          'Empowered Attacks Gain 15% of Physical Damage as Extra Fire damage',
          'Tree: Cremating Cries',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'PhysicalDamageGainAsFire',
          type: 'BASE',
          value: 15,
          tags: [{ type: 'Condition', var: 'EmpoweredAttack' }],
        }),
      ]);
      expect(
        parseModLine('Empowered Attacks Gain 16% of Damage as Extra Cold Damage', 'Tree: Hail'),
      ).toEqual([
        expect.objectContaining({
          name: 'DamageGainAsCold',
          type: 'BASE',
          value: 16,
          tags: [{ type: 'Condition', var: 'EmpoweredAttack' }],
        }),
      ]);

      // S8.3 & S8.4 & Hazard: SkillType-tagged Grenade / Plant / Hazard Damage
      expect(parseModLine('12% increased Grenade Damage', 'Tree')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 12,
          tags: [{ type: 'SkillType', skillType: 'Grenade' }],
        }),
      ]);
      expect(parseModLine('80% reduced Grenade Damage', 'Tree: Utility Ordnance')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: -80,
          tags: [{ type: 'SkillType', skillType: 'Grenade' }],
        }),
      ]);
      expect(parseModLine('12% increased Damage with Plant Skills', 'Tree')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 12,
          tags: [{ type: 'SkillType', skillType: 'Plant' }],
        }),
      ]);
      expect(parseModLine('40% increased Hazard Damage', 'Tree: Delayed Danger')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 40,
          tags: [{ type: 'SkillType', skillType: 'Hazard' }],
        }),
      ]);

      // S8.6: Harness the Elements, Exploit, Vile Wounds, Wasting, Agonising Calamity
      expect(
        parseModLine('20% increased Damage for each type of Elemental Ailment on Enemy', 'Tree: Harness the Elements'),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 20,
          tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
        }),
      ]);
      expect(
        parseModLine('24% increased Damage with Hits against Enemies affected by Elemental Ailments', 'Tree: Exploit'),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 24,
          tags: [{ type: 'Condition', var: 'EnemyAffectedByElementalAilment' }],
        }),
      ]);
      expect(
        parseModLine('33% increased Damage with Hits against Enemies affected by Ailments', 'Tree: Vile Wounds'),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 33,
          tags: [{ type: 'Condition', var: 'EnemyAffectedByAilment' }],
        }),
      ]);
      expect(
        parseModLine('40% increased Physical Damage while affected by Herald of Blood', 'Tree: Agonising Calamity'),
      ).toEqual([
        expect.objectContaining({
          name: 'PhysicalDamage',
          type: 'INC',
          value: 40,
          tags: [{ type: 'Condition', var: 'AffectedByHeraldOfBlood' }],
        }),
      ]);

      // S8.7: Unarmed Damage, Unarmed Attack Speed & Flurry
      expect(parseModLine('14% increased Damage with Unarmed Attacks', 'Tree')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 14,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        }),
      ]);
      expect(parseModLine('25% reduced Damage with Unarmed Attacks', 'Tree: Flurry')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: -25,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        }),
      ]);
      expect(parseModLine('20% increased Unarmed Attack Speed', 'Tree: Flurry')).toEqual([
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 20,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Unarmed' }],
        }),
      ]);

      // S8.9: High-frequency PoE 2 notables/smalls
      expect(
        parseModLine("15% increased Damage if you've dealt a Critical Hit in the past 8 seconds", 'Tree: Deadly Force'),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 15,
          tags: [{ type: 'Condition', var: 'CritInPast8Sec' }],
        }),
      ]);
      expect(
        parseModLine('15% increased Critical Hit Chance against enemies with Exposure', 'Tree: Exposed to the Storm'),
      ).toEqual([
        expect.objectContaining({
          name: 'CritChance',
          type: 'INC',
          value: 15,
          tags: [{ type: 'Condition', var: 'EnemyExposure' }],
        }),
      ]);
      expect(parseModLine('15% increased Attack Speed while not on Low Mana', 'Tree: Chakra of Thought')).toEqual([
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 15,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'LowMana', neg: true }],
        }),
      ]);
      expect(parseModLine('Triggered Spells deal 40% increased Spell Damage', 'Tree: Invocated Efficiency')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 40,
          flags: ModFlag.Spell,
          tags: [{ type: 'SkillType', skillType: 'Triggered' }],
        }),
      ]);
      // Note: modParserPoe1.ts:548 precedes POE2_EXTRA_MOD_RULES for "Channelling Skills deal X% increased Damage";
      // verify the POE2_EXTRA_MOD_RULES rule itself produces Condition:Channelling Damage INC cleanly.
      const chanRule = POE2_EXTRA_MOD_RULES.find((r) =>
        r.pattern.test('Channelling Skills deal 25% increased Damage'),
      );
      expect(chanRule).toBeDefined();
      const chanMatch = 'Channelling Skills deal 25% increased Damage'.match(chanRule!.pattern)!;
      expect(chanRule!.build(chanMatch, 'Tree: Focused Channel')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 25,
          tags: [{ type: 'Condition', var: 'Channelling' }],
        }),
      ]);
      expect(parseModLine('3% increased Skill Speed with Channelling Skills', 'Tree: Channelling Speed')).toEqual([
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 3,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Channelling' }],
        }),
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 3,
          flags: ModFlag.Spell,
          tags: [{ type: 'Condition', var: 'Channelling' }],
        }),
      ]);
      expect(parseModLine('8% increased Skill Speed while Shapeshifted', 'Tree: Primal Spirit')).toEqual([
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 8,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Shapeshifted' }],
        }),
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 8,
          flags: ModFlag.Spell,
          tags: [{ type: 'Condition', var: 'Shapeshifted' }],
        }),
      ]);
      expect(
        parseModLine(
          '30% increased Attack Damage if you have Shapeshifted to an Animal form Recently',
          'Tree: Shifted Strikes',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 30,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'ShapeshiftedToAnimalRecently|Shapeshifted' }],
        }),
      ]);
      expect(
        parseModLine(
          '35% increased Spell Damage if you have consumed an Elemental Infusion Recently',
          'Tree: Empowering Infusions',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 35,
          flags: ModFlag.Spell,
          tags: [{ type: 'Condition', var: 'ConsumedElementalInfusionRecently' }],
        }),
      ]);
      expect(parseModLine('50% increased Fire Damage while Ignited', 'Tree: Molten Carapace')).toEqual([
        expect.objectContaining({
          name: 'FireDamage',
          type: 'INC',
          value: 50,
          tags: [{ type: 'Condition', var: 'Ignited' }],
        }),
      ]);
      expect(parseModLine('+2% to Maximum Fire Resistance while Ignited', 'Tree: Molten Carapace')).toEqual([
        expect.objectContaining({
          name: 'FireResistMax',
          type: 'BASE',
          value: 2,
          tags: [{ type: 'Condition', var: 'Ignited' }],
        }),
      ]);
      expect(parseModLine('Every Rage also grants 2% increased Spell Damage', 'Tree: Mystical Rage')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 2,
          flags: ModFlag.Spell,
          tags: [{ type: 'Multiplier', var: 'Rage' }],
        }),
      ]);
      expect(
        parseModLine(
          '25% increased Damage with Crossbows for each type of Ammunition fired in the past 10 seconds',
          'Tree: Full Salvo',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 25,
          flags: ModFlag.Crossbow,
          tags: [{ type: 'Multiplier', var: 'DifferentAmmoFired' }],
        }),
      ]);
      expect(parseModLine('Enemies you Mark take 10% increased Damage', 'Tree: Marked for Sickness')).toEqual([
        expect.objectContaining({
          name: 'DamageTaken',
          type: 'INC',
          value: 10,
          target: 'enemy',
          tags: [{ type: 'Condition', var: 'Marked|EnemyMarked' }],
        }),
      ]);
      expect(
        parseModLine('Enemies you apply Incision to take 2% increased Physical Damage per Incision', 'Tree: Thousand Cuts'),
      ).toEqual([
        expect.objectContaining({
          name: 'PhysicalDamageTaken',
          type: 'INC',
          value: 2,
          target: 'enemy',
          tags: [{ type: 'Multiplier', var: 'IncisionStack' }],
        }),
      ]);
      expect(
        parseModLine('Attacks used by Totems have 4% increased Attack Speed per Summoned Totem', 'Tree: Ancestral Unity'),
      ).toEqual([
        expect.objectContaining({
          name: 'Speed',
          type: 'INC',
          value: 4,
          flags: ModFlag.Attack,
          keywordFlags: KeywordFlag.Totem,
          tags: [{ type: 'Multiplier', var: 'ActiveTotem' }],
        }),
      ]);
      expect(parseModLine('50% increased Attack Damage while on Low Life', 'Support: Direstrike')).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 50,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'LowLife' }],
        }),
      ]);
      expect(parseModLine('15% more Critical Damage Bonus against Blinded Enemies', 'Support: Blindside')).toEqual([
        expect.objectContaining({
          name: 'CritMultiplier',
          type: 'MORE',
          value: 15,
          tags: [{ type: 'Condition', var: 'EnemyBlinded' }],
        }),
      ]);
      expect(parseModLine('Companions deal 15% increased Damage', 'Tree')).toEqual([
        expect.objectContaining({ name: 'CompanionDamage', type: 'INC', value: 15 }),
      ]);
      expect(parseModLine('10% increased Melee Damage', 'Tree: Melee and Projectile Damage')).toEqual([
        expect.objectContaining({ name: 'Damage', type: 'INC', value: 10, flags: ModFlag.Melee }),
      ]);
      expect(parseModLine('10% increased Projectile Damage', 'Tree: Melee and Projectile Damage')).toEqual([
        expect.objectContaining({ name: 'Damage', type: 'INC', value: 10, flags: ModFlag.Projectile }),
      ]);

      // S10.2: Arcane Surge on Critical Hit / Always
      expect(
        parseModLine('5% chance to Gain Arcane Surge when you deal a Critical Hit', 'Tree:2244'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'ArcaneSurgeOnCritChance', type: 'BASE', value: 5 }),
          expect.objectContaining({ name: 'Condition:ArcaneSurge', type: 'FLAG', value: true }),
        ]),
      );
      expect(parseModLine('You have Arcane Surge', 'Tree: Constant Gale')).toEqual([
        expect.objectContaining({ name: 'Condition:ArcaneSurge', type: 'FLAG', value: true }),
      ]);

      // S11: PoisonStacks & PoisonStacksMax
      expect(
        parseModLine('+1 to Maximum number of Poisons you can inflict on an Enemy', 'Tree'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PoisonStacksMax', type: 'BASE', value: 1 }),
        ]),
      );
      expect(parseModLine('Double Maximum Poison Stacks', 'Tree')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PoisonStacksMax', type: 'MORE', value: 100 }),
        ]),
      );
      expect(
        parseModLine('Targets can be affected by +1 of your Poisons at the same time', 'Tree: Stacking Toxins'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PoisonStacks', type: 'BASE', value: 1 }),
        ]),
      );

      // S14.1: GemLevel (+all, +Nova, +Dex requirement) & gemBonus tokens
      expect(parseModLine('+2 to Level of all Skills', 'Ascendancy')).toEqual([
        expect.objectContaining({ name: 'GemLevel:all', type: 'BASE', value: 2 }),
      ]);
      expect(parseModLine('+1 to Level of all Nova Skill Gems', 'Item: Grim Cry')).toEqual([
        expect.objectContaining({ name: 'GemLevel:nova', type: 'BASE', value: 1 }),
      ]);
      expect(
        parseModLine('+2 to Level of all Skills with a Dexterity requirement', 'Tree: Motoric Implants'),
      ).toEqual([
        expect.objectContaining({ name: 'GemLevel:dexterity', type: 'BASE', value: 2 }),
      ]);
      expect(normalizeGemFilterTokens('Nova')).toBe('nova');
      expect(normalizeGemFilterTokens('Plant')).toBe('plant');
      expect(normalizeGemFilterTokens('Grenade')).toBe('grenade');
      expect(normalizeGemFilterTokens('Hazard')).toBe('hazard');
      expect(normalizeGemFilterTokens('Shapeshift')).toBe('shapeshift');

      const grimPillarsMock: GemDefinition = {
        id: 'poe2_grimpillars',
        name: { en: 'Grim Pillars', zh: '阴森之柱' },
        category: 'active',
        game: 'poe2',
        color: 'white',
        tags: ['area', 'cold', 'duration', 'nova', 'spell'],
        skillTypes: ['Area', 'Cold', 'Nova', 'Spell'],
        modFlags: ModFlag.Spell | ModFlag.Area,
        keywordFlags: KeywordFlag.Cold,
        stats: [],
      };
      expect(gemMatchesFilterKey(grimPillarsMock, 'nova')).toBe(true);
      expect(gemMatchesFilterKey(grimPillarsMock, 'grenade')).toBe(false);

      const hybridGrenadeMock: GemDefinition = {
        id: 'poe2_explosivegrenade',
        name: { en: 'Explosive Grenade', zh: '爆炸榴弹' },
        category: 'active',
        game: 'poe2',
        color: 'red',
        tags: ['area', 'attack', 'dexterity', 'fire', 'grenade', 'projectile', 'strength'],
        modFlags: ModFlag.Attack | ModFlag.Area | ModFlag.Projectile,
        keywordFlags: KeywordFlag.Fire,
        stats: [],
      };
      expect(gemMatchesFilterKey(hybridGrenadeMock, 'dexterity')).toBe(true);
      expect(gemMatchesFilterKey(hybridGrenadeMock, 'grenade')).toBe(true);
    });

    it('parses Wave 4N PoE 2 mechanics (ElementalGainAs, Leopold, PoisonFaster/Plaguefinger/Tacati/Esh, PointBlank, PriceOfPower, FranticFighter, BestialRage, GrinningImmolation, GoreSpike, PreemptiveStrike, Yoke, FoeSong & resolveSupportGemLevelBonus)', () => {
      // RC-1: Elemental Damage GainAs Cold/Fire/Lightning/Chaos
      expect(
        parseModLine('Gain 6% of Elemental Damage as Extra Cold Damage', 'Tree: Glaciation'),
      ).toEqual([
        expect.objectContaining({ name: 'ElementalDamageGainAsCold', type: 'BASE', value: 6 }),
      ]);
      expect(
        parseModLine('Gain 13% of Elemental Damage as Extra Fire Damage', 'Item: Wand'),
      ).toEqual([
        expect.objectContaining({ name: 'ElementalDamageGainAsFire', type: 'BASE', value: 13 }),
      ]);
      expect(
        parseModLine('Gain 40% of Lightning Damage as Extra Chaos Damage', "Support: Esh's Radiance"),
      ).toEqual([
        expect.objectContaining({ name: 'LightningDamageGainAsChaos', type: 'BASE', value: 40 }),
      ]);

      // RC-2: Leopold's Applause exact wording
      expect(
        parseModLine(
          'Elemental Damage with Hits can Penetrate Resistances down to a minimum of -50%',
          "Item: Leopold's Applause",
        ),
      ).toEqual([
        expect.objectContaining({ name: 'ElementalPenetrationMinimum', type: 'OVERRIDE', value: -50 }),
      ]);

      // RC-3: PoE 2 Poison faster, Plaguefinger, Tacati's Ire
      expect(parseModLine('Poisons you inflict deal Damage 15% faster', 'Tree')).toEqual([
        expect.objectContaining({ name: 'PoisonFaster', type: 'INC', value: 15 }),
      ]);
      expect(parseModLine('Damaging Ailments you inflict deal Damage 12% faster', 'Tree')).toEqual([
        expect.objectContaining({ name: 'AilmentFaster', type: 'INC', value: 12 }),
      ]);
      expect(parseModLine('Poisons you inflict deal Damage 2% faster per Rage', "Support: Tacati's Ire")).toEqual([
        expect.objectContaining({
          name: 'PoisonFaster',
          type: 'INC',
          value: 2,
          tags: [{ type: 'Multiplier', var: 'Rage' }],
        }),
      ]);
      expect(
        parseModLine('All Damage from Hits Contributes to Poison Magnitude', 'Item: Plaguefinger'),
      ).toEqual([
        expect.objectContaining({ name: 'AllDamageCanPoison', type: 'FLAG', value: true }),
      ]);

      // RC-5: Point Blank split-line variant
      expect(
        parseModLine('Projectiles deal 20% more Hit damage to targets in the first 3.5 metres', 'Tree: Point Blank'),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'PointBlank', type: 'FLAG', value: true }),
          expect.objectContaining({
            name: 'Damage',
            type: 'MORE',
            value: 20,
            tags: [{ type: 'Condition', var: 'DistanceRamp:35:1,70:0' }],
          }),
        ]),
      );

      // RC-10: Price of Power, Frantic Fighter, Bestial Rage, Grinning Immolation, Gore Spike, Preemptive Strike, Yoke, Foe Song
      expect(
        parseModLine('Spells consume a Power Charge if able to deal 40% more Damage', 'Tree: Price of Power'),
      ).toEqual([
        expect.objectContaining({ name: 'PriceOfPowerSpellMore', type: 'BASE', value: 40 }),
      ]);
      expect(
        parseModLine('100% increased Attack Damage while Surrounded', 'Tree: Frantic Fighter'),
      ).toEqual([
        expect.objectContaining({
          name: 'Damage',
          type: 'INC',
          value: 100,
          flags: ModFlag.Attack,
          tags: [{ type: 'Condition', var: 'Surrounded' }],
        }),
      ]);
      expect(
        parseModLine('Every 10 Rage also grants 12% increased Physical Damage', 'Tree: Bestial Rage'),
      ).toEqual([
        expect.objectContaining({
          name: 'PhysicalDamage',
          type: 'INC',
          value: 12,
          tags: [{ type: 'PerStat', stat: 'Rage', div: 10 }],
        }),
      ]);
      expect(parseModLine('50% more Critical Damage Bonus', 'Tree: Grinning Immolation')).toEqual([
        expect.objectContaining({ name: 'CritMultiplier', type: 'MORE', value: 50 }),
      ]);
      expect(
        parseModLine('1% increased Critical Damage Bonus per 50 current Life', 'Tree: Gore Spike'),
      ).toEqual([
        expect.objectContaining({
          name: 'CritDamageBonusInc',
          type: 'INC',
          value: 1,
          tags: [{ type: 'PerStat', stat: 'Life', div: 50 }],
        }),
      ]);
      expect(
        parseModLine(
          '100% increased Critical Damage Bonus against Enemies that are on Full Life',
          'Tree: Preemptive Strike',
        ),
      ).toEqual([
        expect.objectContaining({
          name: 'CritMultiplier',
          type: 'INC',
          value: 100,
          tags: [{ type: 'Condition', var: 'EnemyFullLife' }],
        }),
      ]);
      expect(
        parseModLine(
          'Enemies take 10% increased Damage for each type of Ailment you have inflicted on them',
          'Item: Yoke of Suffering',
        ),
      ).toEqual([
        expect.objectContaining({ name: 'EnemyDamageTakenPerAilmentType', type: 'BASE', value: 10 }),
      ]);
      expect(
        parseModLine(
          'Transforms all Cold and Lightning modifiers on the item into equivalent Fire modifiers',
          'Item: Foe Song',
        ),
      ).toEqual([
        expect.objectContaining({ name: 'ItemTransformsColdLightToFire', type: 'FLAG', value: true }),
      ]);

      // gemBonus: resolveSupportGemLevelBonus for Mastery supports & Uhtred's Omen / Dialla's Desire
      const cometMock: GemDefinition = {
        id: 'poe2_comet',
        name: { en: 'Comet', zh: '彗星' },
        category: 'active',
        game: 'poe2',
        color: 'blue',
        tags: ['area', 'cold', 'spell'],
        modFlags: ModFlag.Spell | ModFlag.Area,
        keywordFlags: KeywordFlag.Cold,
        stats: [],
      };
      const coldMasteryMock: GemDefinition = {
        id: 'poe2_coldmasterysupport',
        name: { en: 'Cold Mastery', zh: '冰霜专精' },
        category: 'support',
        game: 'poe2',
        color: 'blue',
        tags: ['cold', 'support'],
        modFlags: 0,
        keywordFlags: 0,
        stats: [],
        compiledMods: [
          { name: 'SupportedGemLevel:Cold', type: 'BASE', value: 1, flags: 0, keywordFlags: 0 },
        ],
      };
      const lightMasteryMock: GemDefinition = {
        ...coldMasteryMock,
        id: 'poe2_lightningmasterysupport',
        name: { en: 'Lightning Mastery', zh: '闪电专精' },
        compiledMods: [
          { name: 'SupportedGemLevel:Lightning', type: 'BASE', value: 1, flags: 0, keywordFlags: 0 },
        ],
      };
      const uhtredOmenMock: GemDefinition = {
        id: 'poe2_uhtredomensupport',
        name: { en: "Uhtred's Omen", zh: '乌特雷德的预兆' },
        category: 'support',
        game: 'poe2',
        color: 'blue',
        tags: ['support'],
        modFlags: 0,
        keywordFlags: 0,
        stats: [],
        compiledMods: [
          { name: 'SupportedGemLevel', type: 'BASE', value: 2, flags: 0, keywordFlags: 0 },
        ],
      };
      expect(resolveSupportGemLevelBonus(coldMasteryMock, cometMock)).toEqual({
        levelBonus: 1,
        qualityBonus: 0,
      });
      expect(resolveSupportGemLevelBonus(lightMasteryMock, cometMock)).toEqual({
        levelBonus: 0,
        qualityBonus: 0,
      });
      expect(resolveSupportGemLevelBonus(uhtredOmenMock, cometMock)).toEqual({
        levelBonus: 2,
        qualityBonus: 0,
      });
    });
  });
});
