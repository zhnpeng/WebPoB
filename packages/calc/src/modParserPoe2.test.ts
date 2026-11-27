import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ModFlag } from '@webpob/core';
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
});
