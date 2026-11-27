import { KeywordFlag, ModFlag, type Mod, type ModType } from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';
import { normalizeGemFilterTokens } from './gemBonus.js';
import { parseModCompositional } from './compositionalModParser.js';
import { POE1_EXTRA_MOD_RULES } from './modParserPoe1.js';
import { POE2_EXTRA_MOD_RULES } from './modParserPoe2.js';

function mkMod(
  name: string,
  type: ModType,
  value: number | boolean | string,
  source: string,
  flags = 0,
  keywordFlags = 0,
): Mod {
  return { name, type, value, flags, keywordFlags, source };
}

interface ParserRule {
  pattern: RegExp;
  build: (match: RegExpMatchArray, source: string) => Mod[];
}

const PARSER_RULES: ParserRule[] = [
  // Flat Resources
  {
    pattern: /^\+(\d+) to maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to maximum Mana$/i,
    build: (m, src) => [mkMod('Mana', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to maximum Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Spirit$/i,
    build: (m, src) => [mkMod('Spirit', 'BASE', Number(m[1]), src)],
  },
  // % Resources & Defences
  {
    pattern: /^(\d+)% increased maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (?:maximum )?Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more (?:maximum )?Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased maximum Mana$/i,
    build: (m, src) => [mkMod('Mana', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Armour$/i,
    build: (m, src) => [mkMod('Armour', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Armour$/i,
    build: (m, src) => [mkMod('Armour', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more Armour$/i,
    build: (m, src) => [mkMod('Armour', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Evasion Rating$/i,
    build: (m, src) => [mkMod('Evasion', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Evasion Rating$/i,
    build: (m, src) => [mkMod('Evasion', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more Evasion Rating$/i,
    build: (m, src) => [mkMod('Evasion', 'MORE', Number(m[1]), src)],
  },
  // Attributes (single, dual, all, and PoE 2 "any Attribute")
  {
    pattern: /^\+(\d+) to Strength$/i,
    build: (m, src) => [mkMod('Str', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Dexterity$/i,
    build: (m, src) => [mkMod('Dex', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Intelligence$/i,
    build: (m, src) => [mkMod('Int', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Strength and Dexterity$/i,
    build: (m, src) => [
      mkMod('Str', 'BASE', Number(m[1]), src),
      mkMod('Dex', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^\+(\d+) to Strength and Intelligence$/i,
    build: (m, src) => [
      mkMod('Str', 'BASE', Number(m[1]), src),
      mkMod('Int', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^\+(\d+) to Dexterity and Intelligence$/i,
    build: (m, src) => [
      mkMod('Dex', 'BASE', Number(m[1]), src),
      mkMod('Int', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^\+(\d+) to all Attributes$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('Str', 'BASE', v, src),
        mkMod('Dex', 'BASE', v, src),
        mkMod('Int', 'BASE', v, src),
      ];
    },
  },
  // Hybrid Defences common on official PoE 1 & PoE 2 trees and gear
  {
    pattern: /^(\d+)% increased Global Armour, Evasion(?: Rating)? and Energy Shield$/i,
    build: (m, src) => [
      mkMod('Armour', 'INC', Number(m[1]), src),
      mkMod('Evasion', 'INC', Number(m[1]), src),
      mkMod('EnergyShield', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased Armour, Evasion(?: Rating)? and Energy Shield$/i,
    build: (m, src) => [
      mkMod('Armour', 'INC', Number(m[1]), src),
      mkMod('Evasion', 'INC', Number(m[1]), src),
      mkMod('EnergyShield', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased Global Defences$/i,
    build: (m, src) => [
      mkMod('Armour', 'INC', Number(m[1]), src),
      mkMod('Evasion', 'INC', Number(m[1]), src),
      mkMod('EnergyShield', 'INC', Number(m[1]), src),
      mkMod('Ward', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Gain additional maximum Life equal to (\d+)% of the Item Energy Shield on Equipped Body Armour$/i,
    build: (m, src) => [mkMod('LifePerBodyEsPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Maximum Life for each Corrupted Item Equipped$/i,
    build: (m, src) => [mkMod('LifeIncPerCorruptedItem', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Armour and Energy Shield$/i,
    build: (m, src) => [
      mkMod('Armour', 'INC', Number(m[1]), src),
      mkMod('EnergyShield', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased Evasion and Energy Shield$/i,
    build: (m, src) => [
      mkMod('Evasion', 'INC', Number(m[1]), src),
      mkMod('EnergyShield', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased (?:Armour and Evasion(?: Rating)?|Evasion(?: Rating)? and Armour)$/i,
    build: (m, src) => [
      mkMod('Armour', 'INC', Number(m[1]), src),
      mkMod('Evasion', 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased Mana Regeneration Rate$/i,
    build: (m, src) => [mkMod('ManaRegen', 'INC', Number(m[1]), src)],
  },
  // Resistances
  {
    pattern: /^([+-]?\d+)% to all Elemental Resistances$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('FireResist', 'BASE', v, src),
        mkMod('ColdResist', 'BASE', v, src),
        mkMod('LightningResist', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^\+(\d+)% to all maximum Elemental Resistances$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('FireResistMax', 'BASE', v, src),
        mkMod('ColdResistMax', 'BASE', v, src),
        mkMod('LightningResistMax', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^\+(\d+)% to maximum (Fire|Cold|Lightning|Chaos) Resistance$/i,
    build: (m, src) => [mkMod(`${m[2]}ResistMax`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/i,
    build: (m, src) => [
      mkMod(`${m[2]}Resist`, 'BASE', Number(m[1]), src),
      mkMod(`${m[3]}Resist`, 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i,
    build: (m, src) => [mkMod(`${m[2]}Resist`, 'BASE', Number(m[1]), src)],
  },
  // Block, Suppression, Regen, Move Speed, Accuracy
  {
    pattern: /^\+(\d+)% Chance to Block Attack Damage$/i,
    build: (m, src) => [mkMod('BlockChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% Chance to Block Spell Damage$/i,
    build: (m, src) => [mkMod('SpellBlockChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% chance to Suppress Spell Damage$/i,
    build: (m, src) => [mkMod('SpellSuppressionChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?) Life per second$/i,
    build: (m, src) => [mkMod('LifeRegen', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?)% of Life per second$/i,
    build: (m, src) => [mkMod('LifeRegenPercent', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Movement Speed$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Accuracy Rating$/i,
    build: (m, src) => [mkMod('Accuracy', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Accuracy Rating$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', Number(m[1]), src)],
  },
  // Added Damage (Global, Spell, Attack)
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to Spells$/i,
    build: (m, src) => [
      mkMod(`${m[3]}Min`, 'BASE', Number(m[1]), src, ModFlag.Spell),
      mkMod(`${m[3]}Max`, 'BASE', Number(m[2]), src, ModFlag.Spell),
    ],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to Attacks$/i,
    build: (m, src) => [
      mkMod(`${m[3]}Min`, 'BASE', Number(m[1]), src, ModFlag.Attack),
      mkMod(`${m[3]}Max`, 'BASE', Number(m[2]), src, ModFlag.Attack),
    ],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [
      mkMod(`${m[3]}Min`, 'BASE', Number(m[1]), src),
      mkMod(`${m[3]}Max`, 'BASE', Number(m[2]), src),
    ],
  },
  // Damage Conversion & Gained as Extra
  {
    pattern: /^(\d+)% of Physical Damage Converted to (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`PhysicalDamageConvertTo${m[2]}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of (Cold|Lightning) Damage Converted to (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`${m[2]}DamageConvertTo${m[3]}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of Fire Damage Converted to Chaos Damage$/i,
    build: (m, src) => [mkMod('FireDamageConvertToChaos', 'BASE', Number(m[1]), src)],
  },
  // Aura & Curse Effect scaling (Phase 18)
  {
    pattern: /^(\d+)% increased effect of Non-Curse Auras from your Skills$/i,
    build: (m, src) => [mkMod('AuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Aura Effect$/i,
    build: (m, src) => [mkMod('AuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Effect of (?:your )?Curses$/i,
    build: (m, src) => [mkMod('CurseEffect', 'INC', Number(m[1]), src)],
  },
  // Phase 19 charge scaling, attribute stacking, leech & flat PDR
  {
    pattern: /^\+?(\d+)% additional Physical Damage Reduction$/i,
    build: (m, src) => [mkMod('PhysDamageReduction', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Spell )?Damage per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => [
      mkMod(`DamagePer${m[3]}Charge`, 'BASE', Number(m[1]), src, m[2] ? ModFlag.Spell : 0),
    ],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier per Power Charge$/i,
    build: (m, src) => [mkMod('CritMultiPerPowerCharge', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Attack|Cast) Speed per (Frenzy|Power) Charge$/i,
    build: (m, src) => [
      mkMod(
        `SpeedPer${m[3]}Charge`,
        'BASE',
        Number(m[1]),
        src,
        m[2]!.toLowerCase() === 'attack' ? ModFlag.Attack : ModFlag.Spell,
      ),
    ],
  },
  {
    pattern: /^(\d+)% increased (Spell |Attack |)?Damage per (\d+) (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => {
      const scope = (m[2] ?? '').trim().toLowerCase() || 'all';
      const flags =
        scope === 'spell' ? ModFlag.Spell : scope === 'attack' ? ModFlag.Attack : 0;
      return [
        mkMod(
          `DamagePerAttr:${m[4]}:${scope}`,
          'BASE',
          Number(m[1]) / Number(m[3]),
          src,
          flags,
        ),
      ];
    },
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Fire|Cold|Lightning|Physical|Chaos) Damage (?:to Attacks )?per (\d+) (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => [
      mkMod(`FlatMinPerAttr:${m[3]}:${m[5]}`, 'BASE', Number(m[1]) / Number(m[4]), src),
      mkMod(`FlatMaxPerAttr:${m[3]}:${m[5]}`, 'BASE', Number(m[2]) / Number(m[4]), src),
    ],
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% of (?:Physical |Attack |Spell |Elemental |Fire |Cold |Lightning |Chaos )?Damage Leeched as (Life|Energy Shield|Mana)$/i,
    build: (m, src) => [
      mkMod(`${m[2] === 'Energy Shield' ? 'Es' : m[2]}Leech`, 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased Maximum total (Life|Energy Shield) Recovery per second from Leech$/i,
    build: (m, src) => [
      mkMod(`${m[2] === 'Energy Shield' ? 'Es' : 'Life'}MaxLeechRateInc`, 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Gain (\d+)% of Damage as Extra (Fire|Cold|Lightning|Chaos) Damage per (\d+) Maximum Mana$/i,
    build: (m, src) => [
      mkMod(`SpellGainAs${m[2]}PerMana100`, 'BASE', (Number(m[1]) * 100) / Math.max(1, Number(m[3])), src, ModFlag.Spell),
    ],
  },
  {
    pattern: /^Gain (\d+)% of Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`DamageGainAs${m[2]}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% of Damage as Extra Elemental Damage$/i,
    build: (m, src) => [
      mkMod('DamageGainAsFire', 'BASE', Number(m[1]), src),
      mkMod('DamageGainAsCold', 'BASE', Number(m[1]), src),
      mkMod('DamageGainAsLightning', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Gain (\d+)% of Physical Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`PhysicalDamageGainAs${m[2]}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% of Elemental Damage as Extra Chaos Damage$/i,
    build: (m, src) => [mkMod('ElementalDamageGainAsChaos', 'BASE', Number(m[1]), src)],
  },
  // Damage Increased / More / Less
  {
    pattern: /^(\d+)% (increased|more|less) (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage with Attack Skills$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod(`${m[3]}Damage`, type, val, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod(`${m[3]}Damage`, type, val, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Spell Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Spell)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Attack Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Projectile Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Projectile)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Melee Physical Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('PhysicalDamage', type, val, src, ModFlag.Melee)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Melee Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Melee)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Area Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Area)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Damage with Hits$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src, ModFlag.Hit)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Damage', type, val, src)];
    },
  },
  // Speed (including element-specific Cast/Attack speed on official trees)
  {
    pattern: /^(\d+)% (increased|more|less) Attack and Cast Speed$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [
        mkMod('Speed', type, val, src, ModFlag.Attack),
        mkMod('Speed', type, val, src, ModFlag.Spell),
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Attack Speed(?: with .+)?$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Speed', type, val, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Cast Speed(?: with (Fire|Cold|Lightning|Chaos|Physical) Skills)?$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      const el = m[3];
      const kw =
        el === 'Fire'
          ? KeywordFlag.Fire
          : el === 'Cold'
            ? KeywordFlag.Cold
            : el === 'Lightning'
              ? KeywordFlag.Lightning
              : el === 'Chaos'
                ? KeywordFlag.Chaos
                : el === 'Physical'
                  ? KeywordFlag.Physical
                  : 0;
      return [mkMod('Speed', type, val, src, ModFlag.Spell, kw)];
    },
  },
  // Critical Strikes (PoE 1 & PoE 2 terminology)
  {
    pattern: /^(\d+)% (more|less) Critical Strike Chance$/i,
    build: (m, src) => [
      mkMod('CritChance', 'MORE', m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased (?:Critical Strike|Critical Hit) Chance for Spells$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% increased Spell Critical (?:Strike|Hit) Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% increased (?:Global )?(?:Critical Strike|Critical Hit) Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to (?:Global )?Critical Strike Multiplier$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to (?:Global )?Critical Damage Bonus$/i,
    build: (m, src) => [mkMod('CritDamageBonusFlat', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Hits have )?\+(\d+(?:\.\d+)?)% to Critical Strike Chance$/i,
    build: (m, src) => [mkMod('BaseCritChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Multiplier( for Spells)?$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, m[2] ? ModFlag.Spell : 0)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Critical Damage Bonus( for Spells)?$/i,
    build: (m, src) => [
      mkMod(
        'CritDamageBonusInc',
        'INC',
        m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]),
        src,
        m[3] ? ModFlag.Spell : 0,
      ),
    ],
  },
  {
    pattern: /^Deal no Elemental Damage$/i,
    build: (_, src) => [mkMod('DealNoElemental', 'FLAG', true, src)],
  },
  {
    pattern: /^Deal no Chaos Damage$/i,
    build: (_, src) => [mkMod('DealNoChaos', 'FLAG', true, src)],
  },
  {
    pattern: /^Cannot inflict Elemental Ailments$/i,
    build: (_, src) => [mkMod('CannotIgnite', 'FLAG', true, src)],
  },
  // Penetration
  {
    pattern: /^Damage Penetrates (\d+)% (Fire|Cold|Lightning|Chaos|Elemental) Resistance$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      if (m[2] === 'Elemental') {
        return [
          mkMod('FirePenetration', 'BASE', v, src),
          mkMod('ColdPenetration', 'BASE', v, src),
          mkMod('LightningPenetration', 'BASE', v, src),
        ];
      }
      return [mkMod(`${m[2]}Penetration`, 'BASE', v, src)];
    },
  },
  // Iconic Keystones
  {
    pattern: /^Your Hits can't be Evaded$/i,
    build: (_, src) => [mkMod('HitsCantBeEvaded', 'FLAG', true, src, ModFlag.None, KeywordFlag.Hit)],
  },
  {
    pattern: /^Never deal Critical Strikes$/i,
    build: (_, src) => [mkMod('NeverCrit', 'FLAG', true, src)],
  },
  {
    pattern: /^Maximum Life becomes 1, Immune to Chaos Damage$/i,
    build: (_, src) => [
      mkMod('Life', 'OVERRIDE', 1, src),
      mkMod('ChaosImmune', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^(\d+)% of Damage is taken from Mana before Life$/i,
    build: (m, src) => [mkMod('DamageTakenFromManaBeforeLife', 'BASE', Number(m[1]), src)],
  },
  // Flask / Buff keywords
  {
    pattern: /^Onslaught$/i,
    build: (_, src) => [
      mkMod('Speed', 'INC', 20, src, ModFlag.Attack),
      mkMod('Speed', 'INC', 20, src, ModFlag.Spell),
      mkMod('MovementSpeed', 'INC', 20, src),
    ],
  },
  // Ailments & Damage over Time (Ignite / Bleed / Poison)
  {
    pattern: /^\+(\d+)% to (Fire|Cold|Chaos|Physical) Damage over Time Multiplier$/i,
    build: (m, src) => [mkMod(`${m[2]}DotMultiplier`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier$/i,
    build: (m, src) => [mkMod('DotMultiplier', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|more|less) (?:Burning|Ignite) Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('IgniteDamage', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) Damage with (?:Ignite|Ignites)$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('IgniteDamage', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) (?:Damage over Time|Damage with Ailments|Poison Damage|Bleeding Damage)$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('DotDamage', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^(\d+)% chance to Ignite$/i,
    build: (m, src) => [mkMod('IgniteChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to cause Bleeding$/i,
    build: (m, src) => [mkMod('BleedChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Poison on Hit$/i,
    build: (m, src) => [mkMod('PoisonChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Hits always Ignite$/i,
    build: (_, src) => [mkMod('IgniteChance', 'BASE', 100, src)],
  },
  {
    pattern: /^(\d+)% increased Armour during effect$/i,
    build: (m, src) => [mkMod('Armour', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Evasion Rating during effect$/i,
    build: (m, src) => [mkMod('Evasion', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance during effect$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Movement Speed during effect$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'INC', Number(m[1]), src)],
  },
  // Curses & Marks (Enemy debuffs)
  {
    pattern: /^Cursed enemies have ([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i,
    build: (m, src) => [mkMod(`Enemy${m[2]}Resist`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Cursed enemies have ([+-]?\d+)% to Elemental Resistances$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('EnemyFireResist', 'BASE', v, src),
        mkMod('EnemyColdResist', 'BASE', v, src),
        mkMod('EnemyLightningResist', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^Cursed enemies take (\d+)% increased Physical Damage$/i,
    build: (m, src) => [mkMod('EnemyPhysicalDamageTaken', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Cursed enemies take (\d+)% increased Projectile Damage$/i,
    build: (m, src) => [mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src, ModFlag.Projectile)],
  },
  {
    pattern: /^Hits against Cursed Enemies have \+(\d+(?:\.\d+)?)% to Critical Strike Chance$/i,
    build: (m, src) => [mkMod('EnemyCritChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Hits against Cursed Enemies have \+(\d+)% to Critical Strike Multiplier$/i,
    build: (m, src) => [mkMod('EnemyCritMultiplier', 'BASE', Number(m[1]), src)],
  },
  // Mana Reservation Efficiency
  {
    pattern: /^(\d+)% increased Mana Reservation Efficiency(?: of Skills)?$/i,
    build: (m, src) => [mkMod('ManaReservationEfficiency', 'INC', Number(m[1]), src)],
  },
  // Endgame Keystones & Unique Conversions
  {
    pattern: /^Converts all Evasion Rating to Armour/i,
    build: (_, src) => [mkMod('IronReflexes', 'FLAG', true, src)],
  },
  {
    pattern: /^50% of Physical, Cold and Lightning Damage Converted to Fire Damage$/i,
    build: (_, src) => [
      mkMod('PhysicalDamageConvertToFire', 'BASE', 50, src),
      mkMod('ColdDamageConvertToFire', 'BASE', 50, src),
      mkMod('LightningDamageConvertToFire', 'BASE', 50, src),
    ],
  },
  {
    pattern: /^Deal no Non-Fire Damage$/i,
    build: (_, src) => [mkMod('DealNoNonFire', 'FLAG', true, src)],
  },
  {
    pattern: /^Your Critical Strikes do not deal extra Damage$/i,
    build: (_, src) => [mkMod('NoCritExtraDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^Ailments never count as being from Critical Strikes$/i,
    build: (_, src) => [mkMod('NoCritAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^Skills that have dealt a Critical Strike in the past 8 seconds deal (\d+)% more Elemental Damage/i,
    build: (m, src) => [mkMod('ElementalDamage', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of Maximum Life Converted to Energy Shield$/i,
    build: (m, src) => [mkMod('LifeConvertToES', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Damage with (Bow|Wand|Sword|Axe|Mace|Claw|Dagger|Staff)s?$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  // Pain Attunement, Double Damage, Exposure & Minions
  {
    pattern: /^30% more Spell Damage when on Low Life$/i,
    build: (_, src) => [mkMod('PainAttunement', 'FLAG', true, src)],
  },
  {
    pattern: /^Exposure you inflict applies an extra -(\d+)% to the affected Resistance$/i,
    build: (m, src) => [mkMod('ExtraExposure', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to deal Double Damage$/i,
    build: (m, src) => [mkMod('DoubleDamageChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|more|less) Minion Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('MinionDamage', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^Minions deal (\d+)% (increased|more|less) Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('MinionDamage', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^Minions have (\d+)% (increased|more) Attack and Cast Speed$/i,
    build: (m, src) => [
      mkMod('MinionSpeed', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', Number(m[1]), src),
    ],
  },
  // Ward (Expedition Defence)
  {
    pattern: /^\+(\d+) to Ward$/i,
    build: (m, src) => [mkMod('Ward', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|more|less) Ward$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('Ward', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  // Impale Mechanics
  {
    pattern: /^(\d+)% chance to Impale Enemies on Hit with Attacks$/i,
    build: (m, src) => [mkMod('ImpaleChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Impale Effect$/i,
    build: (m, src) => [mkMod('ImpaleEffect', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^Impales you inflict last (\d+) additional Hits?$/i,
    build: (m, src) => [mkMod('ImpaleStacksMax', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  // Cooldown Recovery Rate & Trigger Supports
  {
    pattern: /^(\d+)% increased Cooldown Recovery Rate$/i,
    build: (m, src) => [mkMod('CooldownRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Trigger Supported Spells on Melee Critical Strike$/i,
    build: (_, src) => [mkMod('CastOnCrit', 'FLAG', true, src)],
  },
  // Timeless Jewel Keystones, Life/Mana-as-Extra-ES & Phase 20 Endgame Ascendancies
  {
    pattern: /^Gain (\d+)% of Maximum Life as Extra Maximum Energy Shield$/i,
    build: (m, src) => [mkMod('LifeAsExtraES', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% of Maximum Mana as Extra Maximum Energy Shield$/i,
    build: (m, src) => [mkMod('ManaAsExtraES', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Transfiguration of Mind|Increases and Reductions to Maximum Mana also apply to Damage at 30% of their value)$/i,
    build: (_, src) => [mkMod('TransfigurationOfMind', 'FLAG', true, src)],
  },
  {
    pattern: /^\+(\d+) to Minimum (Power|Frenzy|Endurance) Charges?$/i,
    build: (m, src) => [mkMod(`Min${m[2]}Charges`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Maximum Power Charges and Maximum Endurance Charges$/i,
    build: (m, src) => [
      mkMod('MaxPowerCharges', 'BASE', Number(m[1]), src),
      mkMod('MaxEnduranceCharges', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Nearby Enemies have ([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i,
    build: (m, src) => [mkMod(`Enemy${m[2]}Resist`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Taunt on Hit$/i,
    build: (_, src) => [mkMod('TauntOnHit', 'FLAG', true, src)],
  },
  {
    pattern: /^Enemies Taunted by you take (\d+)% increased Damage$/i,
    build: (m, src) => [mkMod('TauntedEnemyDamageTaken', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Enemies Taunted by you cannot Evade Attacks$/i,
    build: (_, src) => [mkMod('TauntedHitsCantBeEvaded', 'FLAG', true, src)],
  },
  {
    pattern: /^Corrupted Soul$/i,
    build: (_, src) => [
      mkMod('LifeAsExtraES', 'BASE', 15, src),
      mkMod('CorruptedSoul', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Divine Flesh$/i,
    build: (_, src) => [
      mkMod('ChaosResistMax', 'BASE', 5, src),
      mkMod('EleTakenAsChaos', 'BASE', 50, src),
    ],
  },
  {
    pattern: /^Inner Conviction$/i,
    build: (_, src) => [mkMod('InnerConviction', 'FLAG', true, src)],
  },
  {
    pattern: /^The Agnostic$/i,
    build: (_, src) => [mkMod('EnergyShield', 'OVERRIDE', 0, src)],
  },
  {
    pattern: /^3% more Spell Damage per Power Charge$/i,
    build: (_, src) => [mkMod('InnerConviction', 'FLAG', true, src)],
  },
  // Global Skill Gem Level & Quality Bonuses (PoE 1 & PoE 2)
  {
    pattern: /^\+(\d+) to Level of all (?:([A-Za-z ]+?) )?Support Gems?$/i,
    build: (m, src) => {
      const filterKey = normalizeGemFilterTokens(m[2]);
      if (!filterKey) return [];
      return [mkMod(`GemLevelSup:${filterKey}`, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^\+(\d+) to Level of all (?:([A-Za-z ]+?) )?(?:Skill Gems?|Skills?)$/i,
    build: (m, src) => {
      const filterKey = normalizeGemFilterTokens(m[2]);
      if (!filterKey) return [];
      return [mkMod(`GemLevel:${filterKey}`, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^\+(\d+)% to Quality of all (?:([A-Za-z ]+?) )?(?:Skill Gems?|Skills?)$/i,
    build: (m, src) => {
      const filterKey = normalizeGemFilterTokens(m[2]);
      if (!filterKey) return [];
      return [mkMod(`GemQuality:${filterKey}`, 'BASE', Number(m[1]), src)];
    },
  },
  // Rage
  {
    pattern: /^\+(\d+) to Maximum Rage$/i,
    build: (m, src) => [mkMod('MaximumRage', 'BASE', Number(m[1]), src)],
  },
  // Ascendancy & Keystone Mechanics (Inquisitor / Eldritch Battery)
  {
    pattern: /^Critical Strikes ignore Enemy Monster Elemental Resistances$/i,
    build: (_, src) => [mkMod('CritIgnoresEleRes', 'FLAG', true, src)],
  },
  {
    pattern: /^Non-Critical Strikes Penetrate (\d+)% of Enemy Elemental Resistances$/i,
    build: (m, src) => [mkMod('NonCritElePen', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^1% increased Critical Strike Chance per point of Strength or Intelligence, whichever is lower$/i,
    build: (_, src) => [mkMod('CritChancePerLowerStrInt', 'FLAG', true, src)],
  },
  {
    pattern: /^Energy Shield protects Mana instead of Life$/i,
    build: (_, src) => [mkMod('EldritchBattery', 'FLAG', true, src)],
  },
  // Berserker, Slayer, Necromancer & Strength Keystones (Phase 16)
  {
    pattern: /^Base Critical Strike Chance for Attacks with Weapons is (\d+(?:\.\d+)?)%$/i,
    build: (m, src) => [mkMod('WeaponBaseCritChance', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Every Rage also grants (\d+)% increased Attack Speed$/i,
    build: (m, src) => [mkMod('RageGrantsAttackSpeed', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Strength's Damage bonus applies to all Spell Damage as well|Iron Will)$/i,
    build: (_, src) => [mkMod('IronWill', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:Strength's Damage bonus applies to Projectile Attack Damage as well|Iron Grip)$/i,
    build: (_, src) => [mkMod('IronGrip', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% (increased|more|less) Damage taken$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('DamageTaken', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  {
    pattern: /^Minions have (\d+)% (increased|more|less) maximum Life$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('MinionLife', m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE', val, src)];
    },
  },
  // Endgame ascendancy & defence mechanics (Phase 17)
  {
    pattern: /^Armour from Equipped Body Armour is doubled$/i,
    build: (_, src) => [mkMod('BodyArmourDoubled', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% of Armour applies to Fire, Cold and Lightning Damage taken from Hits$/i,
    build: (m, src) => [mkMod('ArmourAppliesToEle', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more Damage for each different type of Mastery you have Allocated$/i,
    build: (m, src) => [mkMod('MoreDamagePerMastery', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Maximum Energy Shield per (\d+) Evasion Rating on Equipped Body Armour$/i,
    build: (m, src) => [mkMod('EsPerBodyEvasion', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^\+(\d+) to Evasion Rating per (\d+) Maximum Energy Shield on Equipped Helmet$/i,
    build: (m, src) => [mkMod('EvasionPerHelmetEs', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^\+(\d+) to Maximum (Power|Frenzy|Endurance) Charges?$/i,
    build: (m, src) => [mkMod(`Max${m[2]}Charges`, 'BASE', Number(m[1]), src)],
  },
  ...POE1_EXTRA_MOD_RULES,
  ...POE2_EXTRA_MOD_RULES,
];

export interface ParseModOptions {
  /** Enable PoE 2 Shaman-exclusive Bonded ("Bonded:" / "羁绊：") modifiers. Defaults to false. */
  allowBonded?: boolean;
}

/**
 * Parses a single stat line (English OR Chinese) into typed `Mod` entries.
 */
export function parseModLine(rawLine: string, source: string, opts?: ParseModOptions): Mod[] {
  let canonical = normalizeStatLineToEn(rawLine);
  if (!canonical) return [];

  const bondedMatch = canonical.match(/^Bonded:\s*(.+)$/i);
  if (bondedMatch) {
    if (!opts?.allowBonded) return [];
    canonical = bondedMatch[1]!.trim();
    if (!canonical) return [];
  }

  for (const rule of PARSER_RULES) {
    const match = canonical.match(rule.pattern);
    if (match) {
      const built = rule.build(match, source);
      if (built.length > 0) return built;
    }
  }
  return parseModCompositional(canonical, source, { allowBonded: opts?.allowBonded });
}

export function parseModLines(
  lines: readonly string[],
  source: string,
  opts?: ParseModOptions,
): Mod[] {
  const result: Mod[] = [];
  for (const rawEntry of lines) {
    // Official PoB passive tree nodes often pack multiple stat lines separated by `\n` (e.g. Resolute Technique)
    for (const line of rawEntry.split(/\r?\n/)) {
      if (line.trim()) {
        result.push(...parseModLine(line, source, opts));
      }
    }
  }
  return result;
}
