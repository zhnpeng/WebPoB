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

function mapSlotTokens(rawSlots: string): Array<'BodyArmour' | 'Shield' | 'Helmet' | 'Focus' | 'Boots' | 'Gloves'> {
  const s = rawSlots.toLowerCase();
  const out: Array<'BodyArmour' | 'Shield' | 'Helmet' | 'Focus' | 'Boots' | 'Gloves'> = [];
  if (s.includes('body armour')) out.push('BodyArmour');
  if (s.includes('shield')) out.push('Shield');
  if (s.includes('helmet')) out.push('Helmet');
  if (s.includes('focus')) out.push('Focus');
  if (s.includes('boots')) out.push('Boots');
  if (s.includes('gloves')) out.push('Gloves');
  return out;
}

function mapSlotDefStats(rawDef: string): Array<'Armour' | 'Evasion' | 'EnergyShield'> {
  const d = rawDef.toLowerCase();
  if (d === 'defences' || (d.includes('armour') && d.includes('evasion') && d.includes('energy shield'))) {
    return ['Armour', 'Evasion', 'EnergyShield'];
  }
  if (d.includes('armour') && d.includes('evasion')) return ['Armour', 'Evasion'];
  if (d.includes('armour') && d.includes('energy shield')) return ['Armour', 'EnergyShield'];
  if (d.includes('evasion') && d.includes('energy shield')) return ['Evasion', 'EnergyShield'];
  if (d.includes('armour')) return ['Armour'];
  if (d.includes('evasion')) return ['Evasion'];
  if (d.includes('energy shield')) return ['EnergyShield'];
  return [];
}

const PARSER_RULES: ParserRule[] = [
  // High-impact Tincture, Gain-All-Elements, Breach Overcap, Untouched Soul, Shrine & Surrounded rules
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of Damage as Extra (?:Elemental )?Damage of all Elements$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('DamageGainAsFire', 'BASE', v, src),
        mkMod('DamageGainAsCold', 'BASE', v, src),
        mkMod('DamageGainAsLightning', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Melee Weapon Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Melee)],
  },
  {
    pattern: /^Melee Weapon Damage Penetrates (\d+)% (?:of Enemy )?(?:(Fire|Cold|Lightning) |Elemental )?Resistances?$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      const f = ModFlag.Attack | ModFlag.Melee;
      const el = m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() : null;
      if (el) return [mkMod(`${el}Penetration`, 'BASE', v, src, f)];
      return [
        mkMod('FirePenetration', 'BASE', v, src, f),
        mkMod('ColdPenetration', 'BASE', v, src, f),
        mkMod('LightningPenetration', 'BASE', v, src, f),
      ];
    },
  },
  {
    pattern: /^Attacks with this Weapon deal Double Damage to Chilled Enemies$/i,
    build: (_, src) => [
      {
        ...mkMod('DoubleDamageChance', 'BASE', 100, src, ModFlag.Attack | ModFlag.Hit),
        tags: [{ type: 'Condition', var: 'EnemyChilled' }],
      },
    ],
  },
  {
    pattern: /^Attacks with this Weapon deal Double Damage$/i,
    build: (_, src) => [mkMod('DoubleDamageChance', 'BASE', 100, src, ModFlag.Attack | ModFlag.Hit)],
  },
  {
    pattern: /^Bow Attacks fire (an|\d+) additional Arrows?$/i,
    build: (m, src) => [
      mkMod(
        'ProjectileCount',
        'BASE',
        m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]),
        src,
        ModFlag.Attack | ModFlag.Bow,
      ),
    ],
  },
  {
    pattern: /^Attacks with Wands fire (an|\d+) additional Projectiles?$/i,
    build: (m, src) => [
      mkMod(
        'ProjectileCount',
        'BASE',
        m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]),
        src,
        ModFlag.Attack | ModFlag.Wand,
      ),
    ],
  },
  {
    pattern: /^(?:Attack Skills|Attacks) fire (an|\d+) additional Projectiles?(?: during Effect)?$/i,
    build: (m, src) => [
      mkMod(
        'ProjectileCount',
        'BASE',
        m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]),
        src,
        ModFlag.Attack,
      ),
    ],
  },
  {
    pattern: /^Spells fire (an|\d+) additional Projectiles?(?: during Effect)?$/i,
    build: (m, src) => [
      mkMod(
        'ProjectileCount',
        'BASE',
        m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]),
        src,
        ModFlag.Spell,
      ),
    ],
  },
  {
    pattern: /^Totems fire (an|\d+) additional Projectiles?$/i,
    build: (m, src) => [
      mkMod(
        'ProjectileCount',
        'BASE',
        m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]),
        src,
        0,
        KeywordFlag.Totem,
      ),
    ],
  },
  {
    pattern: /^Skills fire (an|\d+) additional Projectiles?(?: during Effect)?$/i,
    build: (m, src) => [
      mkMod('ProjectileCount', 'BASE', m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]), src),
    ],
  },
  {
    pattern: /^([A-Z][A-Za-z' ]+?) fires? (an|\d+) additional Projectiles?$/i,
    build: (m, src) => {
      const skillLower = m[1]!.trim().toLowerCase();
      if (
        skillLower === 'skills' ||
        skillLower === 'attacks' ||
        skillLower === 'attack skills' ||
        skillLower === 'spells' ||
        skillLower === 'totems' ||
        skillLower === 'traps' ||
        skillLower === 'mines' ||
        skillLower === 'minions' ||
        skillLower === 'projectiles'
      ) {
        return [];
      }
      return [
        mkMod(
          `ProjectileCount:${skillLower}`,
          'BASE',
          m[2]!.toLowerCase() === 'an' ? 1 : Number(m[2]),
          src,
        ),
      ];
    },
  },
  {
    pattern: /^Projectiles Split towards (an|\+?\d+) (?:additional )?targets?$/i,
    build: (m, src) => [
      mkMod('SplitCount', 'BASE', m[1]!.toLowerCase() === 'an' ? 1 : Number(m[1]), src),
    ],
  },
  {
    pattern: /^Base (?:Spell )?Critical Strike Chance(?: of Spells)? is equal to (?:that|the Critical Strike Chance) of Main Hand Weapon$/i,
    build: (_, src) => [mkMod('SpellCritChanceFromMainHandWeapon', 'FLAG', true, src)],
  },
  {
    pattern: /^Attack(?:s| Skills) have Added Lightning Damage equal to (\d+)% of Maximum Mana$/i,
    build: (m, src) => [mkMod('MindOfTheCouncilManaPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more Damage while there is at most one Rare or Unique Enemy (?:nearby|within \d+ metres)$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Poison Duration for each Poison you have inflicted Recently(?:,\s*up(?:\s+to\s+(?:a\s+maximum\s+of\s+)?(\d+)%)?)?$/i,
    build: (m, src) => [mkMod('ToxicDeliveryPoisonDurCap', 'BASE', m[2] ? Number(m[2]) : 100, src)],
  },
  {
    pattern: /^Damage Penetrates Fire Resistance equal to your Overcapped Fire Resistance, up to a maximum of (\d+)%$/i,
    build: (m, src) => [
      {
        ...mkMod('FirePenetration', 'BASE', 1, src, ModFlag.Hit),
        tags: [{ type: 'PerStat', stat: 'FireResistOverCap', div: 1, limit: Number(m[1]) }],
      },
    ],
  },
  {
    pattern: /^\+(\d+(?:\.\d+)?)% to Off Hand Critical Strike Chance per (\d+) Maximum Energy Shield on Shield$/i,
    build: (m, src) => [
      mkMod('OffHandBaseCritPer10ShieldEs', 'BASE', (Number(m[1]) * 10) / Math.max(1, Number(m[2])), src),
    ],
  },
  {
    pattern: /^\+(\d+(?:\.\d+)?)% to Off Hand Critical Strike Multiplier per (\d+) Maximum Energy Shield on Shield$/i,
    build: (m, src) => [
      mkMod('OffHandCritMultiPer10ShieldEs', 'BASE', (Number(m[1]) * 10) / Math.max(1, Number(m[2])), src),
    ],
  },
  {
    pattern: /^Gain Maximum Life instead of Maximum Energy Shield from Equipped Armour Items$/i,
    build: (_, src) => [mkMod('ConvertArmourESToLife', 'FLAG', true, src)],
  },
  {
    pattern: /^Deal (\d+)% increased Damage over Time per (\d+) Player Maximum Life$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Dot),
        tags: [{ type: 'PerStat', stat: 'Life', div: Math.max(1, Number(m[2])) }],
      },
    ],
  },
  {
    pattern: /^Enemies affected by your Elemental Ailments count as Moving while Bleeding$/i,
    build: (_, src) => [mkMod('EnemyAffectedByEleAilmentCountsAsMoving', 'FLAG', true, src)],
  },
  {
    pattern: /^Melee Weapon Damage Penetrates (\d+)% Elemental Resistances per Mana Burn, up to a maximum of (\d+)%$/i,
    build: (m, src) => {
      const perBurn = Number(m[1]);
      const maxPen = Number(m[2]);
      const maxStacks = Math.floor(maxPen / Math.max(1, perBurn));
      return [
        {
          ...mkMod('ElementalPenetration', 'BASE', perBurn, src, ModFlag.Attack | ModFlag.Melee),
          tags: [{ type: 'Multiplier', var: 'ManaBurn', limit: maxStacks }],
        },
      ];
    },
  },
  // Wave 4M-B: PoE 1 Accuracy Masteries (RC-6)
  {
    pattern: /^Gain Accuracy Rating equal to your Intelligence$/i,
    build: (_, src) => [
      {
        ...mkMod('Accuracy', 'BASE', 1, src),
        tags: [{ type: 'PerStat', stat: 'Int', div: 1 }],
      },
    ],
  },
  // Wave 4O: PoE 1 High-Impact Mechanics (Spiritual Aid/Command, Tailwind, Impact, Str->Acc, Mines, Curses, Ailment/Enemy Mods)
  {
    pattern: /^Gain Accuracy Rating equal to your Strength$/i,
    build: (_, src) => [
      {
        ...mkMod('Accuracy', 'BASE', 1, src),
        tags: [{ type: 'PerStat', stat: 'Str', div: 1 }],
      },
    ],
  },
  {
    pattern: /^Increases and Reductions to Minion Damage also affect you$/i,
    build: (_, src) => [mkMod('SpiritualAid', 'FLAG', true, src)],
  },
  {
    pattern: /^Increases and Reductions to Minion Attack Speed also affect you$/i,
    build: (_, src) => [mkMod('SpiritualCommand', 'FLAG', true, src)],
  },
  {
    pattern: /^Increases and Reductions to Companion Damage also (?:apply to|affect) you$/i,
    build: (_, src) => [mkMod('CompanionDamageAppliesToPlayer', 'FLAG', true, src)],
  },
  {
    pattern: /^Gem Quality grants Socketed Skills an additional effect$/i,
    build: (_, src) => [mkMod('GemlingQuality', 'FLAG', true, src)],
  },
  // NOTE: SpiritualCommand ("Increases and Reductions to Minion Attack Speed also affect you") is
  // deferred to Coordinator handoff because skillActorRuntime.ts:1241 currently routes SpiritualCommand
  // to both ModFlag.Attack and ModFlag.Spell (leaking Minion Attack Speed onto Spells & double-counting hybrids).
  {
    pattern: /^You and nearby Allies have Tailwind$/i,
    build: (_, src) => [
      mkMod('HasTailwind', 'FLAG', true, src),
      mkMod('Condition:Tailwind', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^You have Tailwind if you have dealt a Critical Strike Recently$/i,
    build: (_, src) => [
      { ...mkMod('HasTailwind', 'FLAG', true, src), tags: [{ type: 'Condition', var: 'CritRecently' }] },
      { ...mkMod('Condition:Tailwind', 'FLAG', true, src), tags: [{ type: 'Condition', var: 'CritRecently' }] },
    ],
  },
  {
    pattern: /^Deal up to (\d+)% more Melee Damage to Enemies, based on proximity$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src, ModFlag.Attack | ModFlag.Melee),
        tags: [{ type: 'Condition', var: 'MeleeProximity' }],
      },
    ],
  },
  {
    pattern: /^Mine Damage Penetrates (\d+)% Elemental Resistances$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      return [
        mkMod('FirePenetration', 'BASE', val, src, ModFlag.Hit, KeywordFlag.Mine),
        mkMod('ColdPenetration', 'BASE', val, src, ModFlag.Hit, KeywordFlag.Mine),
        mkMod('LightningPenetration', 'BASE', val, src, ModFlag.Hit, KeywordFlag.Mine),
      ];
    },
  },
  {
    pattern: /^Can have up to (\d+) additional Remote Mines? placed at a time$/i,
    build: (m, src) => [mkMod('ActiveMineLimit', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Damage per Curse on you$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src),
        tags: [{ type: 'Multiplier', var: 'CurseOnSelf' }],
      },
    ],
  },
  {
    pattern: /^Enemies Ignited or Chilled by you have (-?\d+)% to Elemental Resistances$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tags = [{ type: 'Condition' as const, var: 'EnemyIgnited|EnemyChilled' }];
      return [
        { ...mkMod('FireResist', 'BASE', val, src), target: 'enemy' as const, tags },
        { ...mkMod('ColdResist', 'BASE', val, src), target: 'enemy' as const, tags },
        { ...mkMod('LightningResist', 'BASE', val, src), target: 'enemy' as const, tags },
      ];
    },
  },
  {
    pattern: /^Each Totem applies (\d+)% increased Damage taken to Enemies (?:near it|within \d+(?:\.\d+)? metres)$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'INC', Number(m[1]), src),
        target: 'enemy' as const,
        tags: [{ type: 'Multiplier', var: 'SummonedTotem' }],
      },
    ],
  },
  {
    pattern: /^Enemies Chilled by your Hits have Cold Damage taken increased by Chill Effect$/i,
    build: (_, src) => [
      {
        ...mkMod('ColdDamageTaken', 'INC', 1, src),
        target: 'enemy' as const,
        tags: [
          { type: 'Multiplier', var: 'EnemyChillEffect' },
          { type: 'Condition', var: 'EnemyChilled' },
        ],
      },
    ],
  },
  {
    pattern: /^Enemies Chilled by your Hits have Damage taken increased by Chill Effect$/i,
    build: (_, src) => [
      {
        ...mkMod('DamageTaken', 'INC', 1, src),
        target: 'enemy' as const,
        tags: [
          { type: 'Multiplier', var: 'EnemyChillEffect' },
          { type: 'Condition', var: 'EnemyChilled' },
        ],
      },
    ],
  },
  {
    pattern: /^If you've Impaled an Enemy Recently, you and (?:nearby Allies|Allies within \d+ metres) have \+(\d+) to Armour$/i,
    build: (m, src) => [
      {
        ...mkMod('Armour', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'ImpaledRecently|ImpaledEnemyRecently' }],
      },
    ],
  },
  {
    pattern: /^\+(\d+) to Evasion Rating per (\d+) (?:Player )?Maximum Life$/i,
    build: (m, src) => [
      {
        ...mkMod('Evasion', 'BASE', Number(m[1]), src),
        tags: [{ type: 'PerStat', stat: 'Life', div: Math.max(1, Number(m[2])) }],
      },
    ],
  },
  {
    pattern: /^(\d+)% chance to Cause Bleeding on Critical Strike$/i,
    build: (m, src) => [mkMod('CritBleedChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Cause Poison on Critical Strike$/i,
    build: (m, src) => [mkMod('CritPoisonChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier for Bleeding from Hits with this Weapon$/i,
    build: (m, src) => [
      // Note: skillActorRuntime evaluates PoE 1 Bleed with ailmentDamageFlags (ModFlag.Dot | ModFlag.Ailment | weaponFlags, no ModFlag.Attack)
      mkMod('PhysicalDotMultiplier', 'BASE', Number(m[1]), src, ModFlag.Dot, KeywordFlag.Bleed),
    ],
  },
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier for Bleeding from Critical Strikes$/i,
    build: (m, src) => [
      {
        ...mkMod('PhysicalDotMultiplier', 'BASE', Number(m[1]), src, ModFlag.Dot, KeywordFlag.Bleed),
        tags: [{ type: 'Condition', var: 'CriticalStrike' }],
      },
    ],
  },
  {
    pattern: /^Poison you inflict with Critical Strikes deals (\d+)% more Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src, 0, KeywordFlag.Poison),
        tags: [{ type: 'Condition', var: 'CriticalStrike' }],
      },
    ],
  },
  {
    pattern: /^Gain Adrenaline for \d+ seconds? on Kill$/i,
    build: (_, src) => {
      const tags = [
        { type: 'Condition' as const, var: 'KilledRecently' },
        { type: 'Condition' as const, var: 'Adrenaline', neg: true },
      ];
      return [
        { ...mkMod('Damage', 'INC', 100, src), tags },
        { ...mkMod('Speed', 'INC', 25, src, ModFlag.Attack), tags },
        { ...mkMod('Speed', 'INC', 25, src, ModFlag.Spell), tags },
        { ...mkMod('MovementSpeed', 'INC', 25, src), tags },
        { ...mkMod('PhysDamageReduction', 'BASE', 10, src), tags },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Damage with Skills that Cost Life$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src),
        tags: [{ type: 'PerStat', stat: 'LifeCost', div: 1, limit: 1 }],
      },
    ],
  },
  {
    pattern: /^Hits with this Weapon gain (\d+)% of Physical Damage as Extra (Fire|Cold|Lightning) or (Fire|Cold|Lightning) Damage$/i,
    build: (m, src) => {
      const half = Number(m[1]) / 2;
      const el1 = m[2]![0]!.toUpperCase() + m[2]!.slice(1).toLowerCase();
      const el2 = m[3]![0]!.toUpperCase() + m[3]!.slice(1).toLowerCase();
      return [
        mkMod(`PhysicalGainAs${el1}`, 'BASE', half, src, ModFlag.Attack),
        mkMod(`PhysicalGainAs${el2}`, 'BASE', half, src, ModFlag.Attack),
      ];
    },
  },
  {
    pattern: /^Projectiles gain Damage as they travel farther, dealing up to (\d+)% increased Damage with Hits to targets$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Hit | ModFlag.Projectile),
        tags: [{ type: 'Condition', var: 'DistanceRamp:35:0,70:1' }],
      },
    ],
  },
  {
    pattern: /^Arrows gain Damage as they travel farther, dealing up to (\d+)% increased Damage with Hits to targets$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Hit | ModFlag.Bow),
        tags: [{ type: 'Condition', var: 'DistanceRamp:35:0,70:1' }],
      },
    ],
  },
  {
    pattern: /^Mana is increased by (\d+)% of Overcapped Lightning Resistance$/i,
    build: (m, src) => [
      mkMod('ManaIncreasedByOvercappedLightningRes', 'FLAG', true, src),
      {
        ...mkMod('Mana', 'INC', Number(m[1]) / 100, src),
        tags: [{ type: 'PerStat', stat: 'LightningResistOverCap', div: 1 }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Main Hand Critical Strike Chance per Murderous Eye Jewel affecting you(?:, up to a maximum of (\d+)%)?$/i,
    build: (m, src) => {
      const per = Number(m[1]);
      const maxPct = m[2] ? Number(m[2]) : undefined;
      return [
        {
          ...mkMod('CritChance', 'INC', per, src, ModFlag.Attack),
          tags: [
            {
              type: 'Multiplier',
              var: 'MurderousEyeJewel',
              ...(maxPct !== undefined ? { limit: Math.floor(maxPct / Math.max(1, per)) } : {}),
            },
          ],
        },
      ];
    },
  },
  {
    pattern: /^\+(\d+)% to Off Hand Critical Strike Multiplier per Murderous Eye Jewel affecting you(?:, up to a maximum of \+?(\d+)%)?$/i,
    build: (m, src) => {
      const per = Number(m[1]);
      const maxPct = m[2] ? Number(m[2]) : undefined;
      return [
        {
          ...mkMod('CritMultiplier', 'BASE', per, src, ModFlag.Attack),
          tags: [
            {
              type: 'Multiplier',
              var: 'MurderousEyeJewel',
              ...(maxPct !== undefined ? { limit: Math.floor(maxPct / Math.max(1, per)) } : {}),
            },
            { type: 'Condition', var: 'OffHandAttack' },
          ],
        },
      ];
    },
  },
  {
    pattern: /^Maximum Energy Shield is increased by Chance to Block Spell Damage$/i,
    build: (_, src) => [mkMod('EnergyShieldIncreasedBySpellBlock', 'FLAG', true, src)],
  },
  {
    pattern: /^Your Critical Strike Chance is Lucky$/i,
    build: (_, src) => [mkMod('CritChanceIsLucky', 'FLAG', true, src)],
  },
  {
    pattern: /^Prevent \+(\d+)% of Suppressed Spell Damage$/i,
    build: (m, src) => [mkMod('SpellSuppressionEffect', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Prevent \+(\d+)% of Suppressed Spell Damage while on Full Energy Shield$/i,
    build: (m, src) => [
      {
        ...mkMod('SpellSuppressionEffect', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'FullEnergyShield' }],
      },
    ],
  },
  {
    pattern: /^Enemies (?:nearby|within \d+(?:\.\d+)? metres) are Covered in Ash if you haven't moved in the past \d+ seconds$/i,
    build: (_, src) => [
      {
        ...mkMod('FireDamageTaken', 'INC', 20, src),
        target: 'enemy' as const,
        tags: [{ type: 'Condition', var: 'Stationary' }],
      },
    ],
  },
  {
    pattern: /^Enemies within \d+(?:\.\d+)? metres are Blinded$/i,
    build: (_, src) => [mkMod('Condition:EnemyBlinded', 'FLAG', true, src)],
  },
  {
    pattern: /^Mines Hinder Enemies (?:near them|within \d+(?:\.\d+)? metres) for \d+ seconds when they Land$/i,
    build: (_, src) => [mkMod('Condition:EnemyHindered', 'FLAG', true, src)],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier per Enemy (?:nearby|within \d+(?:\.\d+)? metres)(?:, up to \+?(\d+)%)?$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'BASE', Number(m[1]), src),
        tags: [
          {
            type: 'Multiplier',
            var: 'NearbyEnemies',
            ...(m[2] ? { limit: Number(m[2]), limitTotal: true } : {}),
          } as unknown as NonNullable<Mod['tags']>[number],
        ],
      },
    ],
  },
  {
    pattern: /^If you've Attacked Recently, you and (?:nearby Allies|Allies within \d+(?:\.\d+)? metres) have \+(\d+)% Chance to Block Attack Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('BlockChance', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'AttackedRecently' }],
      },
    ],
  },
  {
    pattern: /^If you've Cast a Spell Recently, you and (?:nearby Allies|Allies within \d+(?:\.\d+)? metres) have \+(\d+)% Chance to Block Spell Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('SpellBlockChance', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'CastSpellRecently' }],
      },
    ],
  },
  {
    pattern: /^With at least one corpse (?:nearby|within \d+(?:\.\d+)? metres), you and (?:nearby Allies|Allies within \d+(?:\.\d+)? metres) deal (\d+)% more Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'CorpseNearby' }],
      },
    ],
  },
  {
    pattern: /^\+(\d+)% to Brand Critical Strike Multiplier$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'BASE', Number(m[1]), src),
        tags: [{ type: 'SkillType', skillType: 'Brand' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Brand Critical Strike Chance$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src),
        tags: [{ type: 'SkillType', skillType: 'Brand' }],
      },
    ],
  },
  {
    pattern: /^You can Cast (?:an|(\d+)) additional Brands?$/i,
    build: (m, src) => [mkMod('ActiveBrandLimit', 'BASE', m[1] ? Number(m[1]) : 1, src)],
  },
  {
    pattern: /^(\d+)% increased Damage per (\d+)% Chance to Block Attack Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src),
        tags: [{ type: 'PerStat', stat: 'BlockChance', div: Math.max(1, Number(m[2])) }],
      },
    ],
  },
  {
    pattern: /^\+(\d+)% Chance to Block Spell Damage while in Off Hand$/i,
    build: (m, src) => [mkMod('SpellBlockChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Elemental|Fire|Cold|Lightning) Damage per (\d+)% Fire, Cold, or Lightning Resistance above 75%$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const stat = `${m[2]![0]!.toUpperCase()}${m[2]!.slice(1).toLowerCase()}Damage`;
      const div = Math.max(1, Number(m[3]));
      return [
        { ...mkMod(stat, 'INC', val, src), tags: [{ type: 'PerStat', stat: 'FireResistOver75', div }] },
        { ...mkMod(stat, 'INC', val, src), tags: [{ type: 'PerStat', stat: 'ColdResistOver75', div }] },
        { ...mkMod(stat, 'INC', val, src), tags: [{ type: 'PerStat', stat: 'LightningResistOver75', div }] },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased (Elemental|Fire|Cold|Lightning) Damage per (\d+)% (Fire|Cold|Lightning) Resistance above 75%$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const stat = `${m[2]![0]!.toUpperCase()}${m[2]!.slice(1).toLowerCase()}Damage`;
      const res = `${m[4]![0]!.toUpperCase()}${m[4]!.slice(1).toLowerCase()}ResistOver75`;
      const div = Math.max(1, Number(m[3]));
      return [{ ...mkMod(stat, 'INC', val, src), tags: [{ type: 'PerStat', stat: res, div }] }];
    },
  },
  {
    pattern: /^Intelligence is added to Accuracy Rating with Wands$/i,
    build: (_, src) => [
      {
        ...mkMod('Accuracy', 'BASE', 1, src, ModFlag.Wand),
        tags: [{ type: 'PerStat', stat: 'Int', div: 1 }],
      },
    ],
  },
  {
    pattern: /^(\d+)% more Accuracy Rating against Unique Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('Accuracy', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'EnemyRareOrUnique' }],
      },
    ],
  },
  {
    pattern: /^Dexterity['’]s Accuracy Bonus instead grants \+(\d+) to Accuracy Rating per Dexterity$/i,
    build: (m, src) => {
      const delta = Number(m[1]) - 2;
      if (delta === 0) return [];
      return [
        {
          ...mkMod('Accuracy', 'BASE', delta, src),
          tags: [{ type: 'PerStat', stat: 'Dex', div: 1 }],
        },
      ];
    },
  },
  // Wave 4M-B: Withered Effect (RC-9; excludes defensive "on you")
  {
    pattern: /^(?:(\d+)% increased Effect of Withered|Withered you inflict has (\d+)% increased Effect)$/i,
    build: (m, src) => [mkMod('WitherEffect', 'INC', Number(m[1] ?? m[2]), src)],
  },
  // Wave 4M-B: Champion Unstoppable Hero / Fortitude > 20, Rage Mastery Intimidate, Ascendant Necro, Rite of Ruin, The Taming, Shroud of the Lightless (RC-10)
  {
    pattern: /^(\d+)% (?:increased Attack Speed|more Armour and Evasion Rating) per Fortification above 20$/i,
    build: (_, src) => [mkMod('UnstoppableHero', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:Nearby Enemies|Enemies within \d+ metres) are Intimidated while you have Rage$/i,
    build: (_, src) => [mkMod('EnemyIntimidatedWhileRage', 'FLAG', true, src)],
  },
  {
    pattern: /^Auras from your Skills grant (\d+)% increased Attack and Cast\s+Speed to you and Allies$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tags = [{ type: 'Multiplier' as const, var: 'AuraAffectingSelf' }];
      return [
        { ...mkMod('Speed', 'INC', val, src, ModFlag.Attack), tags },
        { ...mkMod('Speed', 'INC', val, src, ModFlag.Spell), tags },
      ];
    },
  },
  {
    pattern: /^(?:(\d+)% increased (?:Rage Effect|Effect of Rage)|Rage Effect is increased by (\d+)%)$/i,
    build: (m, src) => [mkMod('RageEffect', 'INC', Number(m[1] ?? m[2]), src)],
  },
  {
    pattern: /^(\d+)% increased (Elemental )?Damage(?: with Hits and Ailments)? (?:for each type of|per) (?:Elemental Ailment|Freeze, Shock (?:or|and) Ignite) on Enemy$/i,
    build: (m, src) => [
      {
        ...mkMod(m[2] ? 'ElementalDamage' : 'Damage', 'INC', Number(m[1]), src, ModFlag.Hit | ModFlag.Ailment),
        tags: [{ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }],
      },
    ],
  },
  {
    pattern: /^(?:(?:Elemental )?Damage )?Penetrates? (\d+)% Elemental Resistances per Abyss Jewel affecting you$/i,
    build: (m, src) => [
      {
        ...mkMod('ElementalPenetration', 'BASE', Number(m[1]), src, ModFlag.Hit),
        tags: [{ type: 'Multiplier', var: 'AbyssJewel' }],
      },
    ],
  },
  {
    pattern: /^(?:Gain|Adds) (?:Added )?Chaos Damage equal to (\d+)% of Ward$/i,
    build: (m, src) => [mkMod('WardAsChaosPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have (\d+)% chance to Poison Enemies on Hit$/i,
    build: (m, src) => [mkMod('MinionPoisonChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Armour is increased by (Overcapped|Uncapped) Fire Resistance$/i,
    build: (m, src) => [
      mkMod(
        m[1]!.toLowerCase() === 'overcapped'
          ? 'ArmourIncPerOvercappedFireRes'
          : 'ArmourIncPerUncappedFireRes',
        'FLAG',
        true,
        src,
      ),
    ],
  },
  {
    pattern: /^Evasion Rating is increased by (Overcapped|Uncapped) Cold Resistance$/i,
    build: (m, src) => [
      mkMod(
        m[1]!.toLowerCase() === 'overcapped'
          ? 'EvasionIncPerOvercappedColdRes'
          : 'EvasionIncPerUncappedColdRes',
        'FLAG',
        true,
        src,
      ),
    ],
  },
  {
    pattern: /^Critical Strike Chance is increased by (Overcapped|Uncapped) Lightning Resistance$/i,
    build: (m, src) => [
      mkMod(
        m[1]!.toLowerCase() === 'overcapped'
          ? 'CritIncPerOvercappedLightRes'
          : 'CritIncPerUncappedLightRes',
        'FLAG',
        true,
        src,
      ),
    ],
  },
  {
    pattern: /^\+(\d+) to maximum Life for each Empty Red Socket on any Equipped Item$/i,
    build: (m, src) => [mkMod('LifePerEmptyRedSocket', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to Accuracy Rating for each Empty Green Socket on any Equipped Item$/i,
    build: (m, src) => [mkMod('AccuracyPerEmptyGreenSocket', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to maximum Mana for each Empty Blue Socket on any Equipped Item$/i,
    build: (m, src) => [mkMod('ManaPerEmptyBlueSocket', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to all Elemental Resistances for each Empty White Socket on any Equipped Item$/i,
    build: (m, src) => [mkMod('AllEleResPerEmptyWhiteSocket', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Require (\d+) fewer Enemies to be Surrounded$/i,
    build: (m, src) => [mkMod('SurroundedEnemyReduction', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Effect of Shrine Buffs on you$/i,
    build: (m, src) => [mkMod('ShrineBuffEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^You have (Lesser )?(Massive|Brutal|Acceleration|Diamond|Replenishing|Resistance|Impenetrable|Gloom) Shrine Buff$/i,
    build: (m, src) => [
      mkMod(
        `ShrineBuff:${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}`,
        'BASE',
        m[1] ? 1 : 2,
        src,
      ),
    ],
  },
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
    pattern: /^(\d+)% (increased|reduced) maximum Life, Mana and Energy Shield$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('Life', 'INC', val, src), mkMod('Mana', 'INC', val, src), mkMod('EnergyShield', 'INC', val, src)];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) maximum Life and (Mana|Energy Shield)$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]);
      const second = m[3]!.toLowerCase() === 'energy shield' ? 'EnergyShield' : 'Mana';
      return [mkMod('Life', 'INC', val, src), mkMod(second, 'INC', val, src)];
    },
  },
  {
    pattern: /^Gain Armour equal to (\d+)% of total Strength Requirements of Equipped Boots, Gloves and Helmet$/i,
    build: (m, src) => [mkMod('ArmourPerStrReqBootsGlovesHelmetPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% less maximum Life$/i,
    build: (m, src) => [mkMod('Life', 'MORE', -Number(m[1]), src)],
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
    pattern: /^(\d+)% less (?:maximum )?Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'MORE', -Number(m[1]), src)],
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
    pattern: /^([+-]?\d+)% to all maximum Elemental Resistances$/i,
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
    pattern: /^([+-]?\d+)% to maximum (Fire|Cold|Lightning|Chaos) Resistance$/i,
    build: (m, src) => [mkMod(`${m[2]}ResistMax`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Your Maximum Resistances are (\d+)%$/i,
    build: (m, src) => [mkMod('AllResistMaxOverride', 'OVERRIDE', Number(m[1]), src)],
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
      const elem = m[3]![0]!.toUpperCase() + m[3]!.slice(1).toLowerCase();
      return [mkMod(`${elem}Damage`, type, val, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^(\d+)% (increased|more|less) (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      const elem = m[3]![0]!.toUpperCase() + m[3]!.slice(1).toLowerCase();
      return [mkMod(`${elem}Damage`, type, val, src)];
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
    pattern: /^(\d+)% (increased|more|less) Attack Speed$/i,
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
    pattern: /^(?:Your )?Critical Strikes do not deal extra Damage$/i,
    build: (_, src) => [mkMod('NoCritExtraDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^Ailments never count as being from Critical Strikes$/i,
    build: (_, src) => [mkMod('NoCritAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier$/i,
    build: (_, src) => [mkMod('PerfectAgony', 'FLAG', true, src)],
  },
  {
    pattern: /^Non-Critical Strikes cannot inflict Ailments$/i,
    build: (_, src) => [mkMod('NonCritsCannotInflictAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% of Maximum Life Converted to Energy Shield$/i,
    build: (m, src) => [mkMod('LifeConvertToES', 'BASE', Number(m[1]), src)],
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
    pattern: /^(?:Transfiguration of Soul|Increases and Reductions to Maximum Energy Shield also apply to Spell Damage at 30% of their value)$/i,
    build: (_, src) => [mkMod('TransfigurationOfSoul', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:Transfiguration of Body|Increases and Reductions to Maximum Life also apply to Attack Damage at 30% of their value)$/i,
    build: (_, src) => [mkMod('TransfigurationOfBody', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:Culling Strike against Marked Enem(?:y|ies)|Hits against Marked Enem(?:y|ies) have Culling Strike)$/i,
    build: (_, src) => [
      {
        ...mkMod('CullingStrike', 'FLAG', true, src),
        tags: [{ type: 'Condition', var: 'EnemyMarked' }],
      },
      {
        ...mkMod('CullPercent', 'MAX', 10, src),
        tags: [{ type: 'Condition', var: 'EnemyMarked' }],
      },
    ],
  },
  {
    pattern: /^Kill Enemies that have (\d+)% or lower Life(?: when Hit(?: by your Skills)?)?$/i,
    build: (m, src) => [mkMod('CullPercent', 'MAX', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% (increased|reduced) Culling Strike Threshold$/i,
    build: (m, src) => [
      mkMod('CullPercent', 'INC', m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]), src),
    ],
  },
  {
    pattern: /^Critical Strikes(?: with (Daggers|Claws|Swords|Axes|Maces|Bows|Wands|Staves|Attacks|Spells))? have Culling Strike$/i,
    build: (m, src) => {
      const scope = (m[1] ?? '').toLowerCase();
      const fl =
        scope === 'daggers'
          ? ModFlag.Dagger
          : scope === 'claws'
            ? ModFlag.Claw
            : scope === 'swords'
              ? ModFlag.Sword
              : scope === 'axes'
                ? ModFlag.Axe
                : scope === 'maces'
                  ? ModFlag.Mace
                  : scope === 'bows'
                    ? ModFlag.Bow
                    : scope === 'wands'
                      ? ModFlag.Wand
                      : scope === 'staves'
                        ? ModFlag.Staff
                        : scope === 'attacks'
                          ? ModFlag.Attack
                          : scope === 'spells'
                            ? ModFlag.Spell
                            : 0;
      return [
        mkMod('CriticalCullPercent', 'MAX', 10, src, fl),
        mkMod('CritCanCull', 'FLAG', true, src, fl),
      ];
    },
  },
  {
    pattern: /^(?:(Bow Attacks|Melee Hits|Attack Hits|Spell Hits|Attacks|Spells|Hits with this Weapon|Your Hits|Hits) )?have Culling Strike(?: against (Bleeding|Marked|Cursed|Ignited|Poisoned|Chilled|Frozen|Shocked|Maimed|Intimidated|Taunted|Blinded|Low Life|Rare or Unique) Enem(?:y|ies))?$/i,
    build: (m, src) => {
      const subj = (m[1] ?? '').toLowerCase();
      const condRaw = (m[2] ?? '').toLowerCase();
      const fl =
        subj === 'bow attacks'
          ? ModFlag.Attack | ModFlag.Bow
          : subj === 'melee hits'
            ? ModFlag.Attack | ModFlag.Melee
            : subj === 'attack hits' || subj === 'attacks'
              ? ModFlag.Attack
              : subj === 'spell hits' || subj === 'spells'
                ? ModFlag.Spell
                : 0;
      const condMap: Record<string, string> = {
        bleeding: 'EnemyBleeding',
        marked: 'EnemyMarked',
        cursed: 'EnemyCursed',
        ignited: 'EnemyIgnited',
        poisoned: 'EnemyPoisoned',
        chilled: 'EnemyChilled',
        frozen: 'EnemyFrozen',
        shocked: 'EnemyShocked',
        maimed: 'EnemyMaimed',
        intimidated: 'EnemyIntimidated',
        taunted: 'EnemyTaunted',
        blinded: 'EnemyBlinded',
        'low life': 'EnemyLowLife',
        'rare or unique': 'EnemyRareOrUnique',
      };
      const condVar = condRaw ? condMap[condRaw] : undefined;
      const tags = condVar ? [{ type: 'Condition' as const, var: condVar }] : undefined;
      return [
        { ...mkMod('CullingStrike', 'FLAG', true, src, fl), ...(tags ? { tags } : {}) },
        { ...mkMod('CullPercent', 'MAX', 10, src, fl), ...(tags ? { tags } : {}) },
      ];
    },
  },
  {
    pattern: /^Increases and Reductions to Spell Damage also apply to Attacks(?: at (\d+)% of their value)?$/i,
    build: (m, src) => [
      mkMod('SpellDamageAppliesToAttacks', 'FLAG', true, src),
      ...(m[1] ? [mkMod('ImprovedSpellDamageAppliesToAttacks', 'BASE', Number(m[1]), src)] : []),
    ],
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
  // Equipment-slot specific Defence INC & MORE fallback (catches multi-slot, "maximum Energy Shield from Equipped Focus", hybrid & MORE variants before compositionalModParser)
  {
    pattern:
      /^(\d+)% (increased|reduced|more|less) (Armour, Evasion(?: Rating)? and (?:maximum )?Energy Shield|Armour and Evasion(?: Rating)?|Armour and (?:maximum )?Energy Shield|Evasion(?: Rating)? and (?:maximum )?Energy Shield|Defences|Armour|Evasion(?: Rating)?|(?:maximum )?Energy Shield) from Equipped (Body Armour|Shield|Helmet|Focus|Boots and Gloves|Gloves and Boots|Helmet and Body Armour|Body Armour and Helmet|Helmet, Gloves and Boots|Boots|Gloves)$/i,
    build: (m, src) => {
      const mag = Number(m[1]);
      const kw = m[2]!.toLowerCase();
      const modType: ModType = kw === 'more' || kw === 'less' ? 'MORE' : 'INC';
      const val = kw === 'reduced' || kw === 'less' ? -mag : mag;
      const stats = mapSlotDefStats(m[3]!);
      const slots = mapSlotTokens(m[4]!);
      const mods: Mod[] = [];
      for (const slot of slots) {
        for (const stat of stats) {
          mods.push(mkMod(`${stat}From${slot}`, modType, val, src));
        }
      }
      return mods;
    },
  },
  {
    pattern: /^(\d+)% of Strength Requirements from Boots, Gloves and Helmets? also added to Armour$/i,
    build: (m, src) => [mkMod('ArmourPerStrReqBootsGlovesHelmetPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% of Evasion Rating as extra Armour$/i,
    build: (m, src) => [mkMod('EvasionAsExtraArmour', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Poison Damage you inflict on Non-Poisoned Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, 0, KeywordFlag.Poison),
        tags: [{ type: 'Condition', var: 'NonPoisonedOnly' }],
      },
    ],
  },
  {
    pattern: /^Poisons you inflict on non-Poisoned Enemies deal (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, 0, KeywordFlag.Poison),
        tags: [{ type: 'Condition', var: 'NonPoisonedOnly' }],
      },
    ],
  },
  {
    pattern: /^Increases and Reductions to Cast Speed also apply to Projectile Speed$/i,
    build: (_, src) => [mkMod('CastSpeedAppliesToProjectileSpeed', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% increased Magnitude of Poison you inflict on targets that are not Poisoned$/i,
    build: (m, src) => [
      {
        ...mkMod('PoisonMagnitude', 'INC', Number(m[1]), src, 0, KeywordFlag.Poison),
        tags: [{ type: 'Condition', var: 'NonPoisonedOnly' }],
      },
    ],
  },
  {
    pattern: /^Damage over Time Multiplier for Ailments is equal to Critical Strike Multiplier$/i,
    build: (_, src) => [
      mkMod('PerfectAgony', 'FLAG', true, src),
      mkMod('PerfectAgonyPct', 'BASE', 100, src),
    ],
  },
  {
    pattern: /^Critical Strikes do not deal extra Damage$/i,
    build: (_, src) => [mkMod('NoCritExtraDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^Skills that have dealt a Critical Strike in the past (\d+) seconds deal (\d+)% more Elemental Damage(?: with Hits and Ailments)?$/i,
    build: (m, src) => {
      const val = Number(m[2]);
      const condTag = { type: 'Condition' as const, var: 'CritInPast8Sec' };
      return [
        { ...mkMod('ElementalDamage', 'MORE', val, src, ModFlag.Hit), tags: [condTag] },
        { ...mkMod('ElementalDamage', 'MORE', val, src, ModFlag.Ailment), tags: [condTag] },
      ];
    },
  },
  {
    pattern: /^Ailments never count as being from Critical Strikes$/i,
    build: (_, src) => [mkMod('NoCritAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^You can have an additional Brand Attached to an Enemy$/i,
    build: (_, src) => [mkMod('BrandsAttachedLimit', 'BASE', 1, src)],
  },
  {
    pattern: /^(\d+)% more Attack Damage if Accuracy Rating is higher than Maximum Life$/i,
    build: (m, src) => [mkMod('PreciseTechniqueMorePct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Projectile Attack Hits deal up to (\d+)% more Damage to targets at the start of their movement.*$/i,
    build: (_, src) => [mkMod('PointBlank', 'FLAG', true, src)],
  },
  {
    pattern: /^Your Critical Damage Bonus is (\d+)%$/i,
    build: (m, src) => [mkMod('CritDamageBonusOverride', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Your Critical Strike Multiplier is (\d+)%$/i,
    build: (m, src) => [mkMod('CritMultiplierOverride', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Marked Enemy takes (\d+)% increased Damage$/i,
    build: (m, src) => [mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Hits treat Enemy Monster Elemental Resistance values as inverted$/i,
    build: (_, src) => [mkMod('InvertEnemyEleRes', 'FLAG', true, src)],
  },
  {
    pattern: /^Require (\d+) fewer enemies to be Surrounded$/i,
    build: (m, src) => [mkMod('FewerEnemiesToBeSurrounded', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Increases and Reductions to Maximum Energy Shield instead apply to Ward$/i,
    build: (_, src) => [mkMod('EsIncAppliesToWardInstead', 'FLAG', true, src)],
  },
  {
    pattern: /^Gain (\d+(?:\.\d+)?)% of Damage as Extra Damage of all Elements$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      return [
        mkMod('DamageGainAsFire', 'BASE', val, src),
        mkMod('DamageGainAsCold', 'BASE', val, src),
        mkMod('DamageGainAsLightning', 'BASE', val, src),
      ];
    },
  },
  {
    pattern: /^Gain (\d+)% of Cold Damage as Extra Fire Damage against Frozen Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('ColdDamageGainAsFire', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'EnemyFrozen' }],
      },
    ],
  },
  {
    pattern: /^Gain Affliction Charges instead of Frenzy Charges$/i,
    build: (_, src) => [mkMod('AfflictionChargesInsteadOfFrenzy', 'FLAG', true, src)],
  },
  {
    pattern: /^(Spell |Attack )?(?:Critical Strike Chance Bifurcates|Forks Critical Hits|Bifurcates Critical Hits|Critical Hits? Fork|Your Critical (?:Hits|Strikes) Bifurcate)$/i,
    build: (m, src) => {
      const scope = (m[1] ?? '').trim().toLowerCase();
      const fl = scope === 'spell' ? ModFlag.Spell : scope === 'attack' ? ModFlag.Attack : 0;
      return [mkMod('BifurcateCrit', 'FLAG', true, src, fl)];
    },
  },
  {
    pattern: /^Inevitable Critical Hits$/i,
    build: (_, src) => [mkMod('InevitableCriticalHits', 'FLAG', true, src)],
  },
  {
    pattern: /^Critical Hits ignore non-negative (?:Enemy )?(?:Monster )?Elemental Resistances$/i,
    build: (_, src) => [mkMod('CritIgnoresNonNegativeEleRes', 'FLAG', true, src)],
  },
  {
    pattern: /^Hits ignore non-negative Elemental Resistances of Frozen Enemies$/i,
    build: (_, src) => [mkMod('HitsIgnoreNonNegativeEleResFrozen', 'FLAG', true, src)],
  },
  {
    pattern: /^Increases and Reductions to Projectile Speed also apply to Damage with Bows$/i,
    build: (_, src) => [mkMod('ProjSpeedAppliesToBowDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^(All|Elemental|Fire|Cold|Lightning|Chaos) Damage (?:from Hits )?(?:with this Weapon )?(?:also )?(?:can Poison|Contributes to Poison Magnitudes?)$/i,
    build: (m, src) => {
      const kind = m[1]!.toLowerCase();
      if (kind === 'all' || kind === 'elemental') return [mkMod('AllDamageCanPoison', 'FLAG', true, src)];
      const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
      return [mkMod(`${cap}CanPoison`, 'FLAG', true, src)];
    },
  },
  {
    pattern: /^(All|Elemental|Fire|Cold|Lightning|Chaos|Physical) Damage (?:from Hits |from Fire Spells |from you and Allies in your Presence )?(?:with this Weapon )?(?:also )?(?:can Ignite|Contributes to Ignite Magnitudes?|Contributes to Flammability and Ignite Magnitudes?)$/i,
    build: (m, src) => {
      const kind = m[1]!.toLowerCase();
      if (kind === 'all' || kind === 'elemental') return [mkMod('AllDamageCanIgnite', 'FLAG', true, src)];
      if (kind === 'chaos') return [mkMod('ChaosContributesToIgnite', 'FLAG', true, src)];
      const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
      return [mkMod(`${cap}CanIgnite`, 'FLAG', true, src)];
    },
  },
  {
    pattern: /^(All|Elemental|Fire|Cold|Lightning|Chaos) Damage (?:from Hits )?(?:with this Weapon )?(?:also )?(?:can Bleed|Contributes to Bleeding Magnitudes?)$/i,
    build: (m, src) => {
      const kind = m[1]!.toLowerCase();
      if (kind === 'all') return [mkMod('AllDamageCanBleed', 'FLAG', true, src)];
      if (kind === 'elemental') return [mkMod('ElementalCanBleed', 'FLAG', true, src)];
      const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
      return [mkMod(`${cap}CanBleed`, 'FLAG', true, src)];
    },
  },
  {
    pattern: /^Rage grants Spell Damage instead of Attack Damage$/i,
    build: (_, src) => [mkMod('Condition:RageSpellDamage', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:Deals? Triple Damage with Elemental Skills|Elemental Skills deal Triple Damage)$/i,
    build: (_, src) => [mkMod('TripleDamageElementalSkill', 'FLAG', true, src)],
  },
  {
    pattern: /^Double the number of your Poisons that targets can be affected by at the same time$/i,
    build: (_, src) => [
      mkMod('PoisonCanStack', 'FLAG', true, src),
      mkMod('DoublePoisonStacks', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (Poison|Bleed|Bleeding|Ignite|Damaging Ailment|Ailment|Skill Effect) Duration$/i,
    build: (m, src) => {
      const rawVal = Number(m[1]);
      const kind = m[2]!.toLowerCase();
      const modType: ModType = kind === 'more' || kind === 'less' ? 'MORE' : 'INC';
      const signedVal = kind === 'reduced' || kind === 'less' ? -rawVal : rawVal;
      const target = m[3]!.toLowerCase();
      const statName =
        target === 'poison'
          ? 'PoisonDuration'
          : target === 'bleed' || target === 'bleeding'
            ? 'BleedDuration'
            : target === 'ignite'
              ? 'IgniteDuration'
              : target === 'damaging ailment'
                ? 'DamagingAilmentDuration'
                : target === 'ailment'
                  ? 'AilmentDuration'
                  : 'Duration';
      return [mkMod(statName, modType, signedVal, src)];
    },
  },
  {
    pattern: /^(?:Skills|Attacks|Spells|Hits)(?: with this Weapon)? have (\d+)% chance to deal Triple Damage$/i,
    build: (m, src) => [mkMod('TripleDamageChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Skills deal (\d+)% more Elemental Damage if you have dealt a Critical Strike in the past 8 seconds$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const condTag = { type: 'Condition' as const, var: 'CritInPast8Sec' };
      return [
        { ...mkMod('ElementalDamage', 'MORE', val, src, ModFlag.Hit), tags: [condTag] },
        { ...mkMod('ElementalDamage', 'MORE', val, src, ModFlag.Ailment), tags: [condTag] },
      ];
    },
  },
  {
    pattern: /^Modifiers to Critical Strike Multiplier also apply to Damage over Time Multiplier for Ailments from Critical Strikes at (\d+)% of their value$/i,
    build: (m, src) => [
      mkMod('PerfectAgony', 'FLAG', true, src),
      mkMod('PerfectAgonyPct', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Non-Critical Strikes cannot inflict Ailments$/i,
    build: (_, src) => [mkMod('NonCritsCannotInflictAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:\+|Targets can be affected by \+)(\d+) (?:to maximum Poison Stacks|of your Poisons at the same time)$/i,
    build: (m, src) => [
      mkMod('PoisonCanStack', 'FLAG', true, src),
      mkMod('PoisonStacks', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(?:Inflict twice as many Poisons|Double the number of Poisons you can inflict)$/i,
    build: (_, src) => [
      mkMod('PoisonCanStack', 'FLAG', true, src),
      mkMod('PoisonStacks', 'MORE', 100, src),
    ],
  },
  {
    pattern: /^(\d+)% (increased|reduced|more|less) (?:(Poison|Bleed|Bleeding|Ignite|Flammability|Damaging Ailments?|Ailments?|Shock|Chill) Magnitude|Magnitude of (Poison|Bleed|Bleeding|Ignite|Flammability|Damaging Ailments?|Ailments?|Shock|Chill)(?: you inflict)?)$/i,
    build: (m, src) => {
      const rawVal = Number(m[1]);
      const kind = m[2]!.toLowerCase();
      const modType: ModType = kind === 'more' || kind === 'less' ? 'MORE' : 'INC';
      const signedVal = kind === 'reduced' || kind === 'less' ? -rawVal : rawVal;
      const targetRaw = (m[3] ?? m[4] ?? 'ailment').toLowerCase();
      const statName =
        targetRaw === 'poison'
          ? 'PoisonMagnitude'
          : targetRaw === 'bleed' || targetRaw === 'bleeding'
            ? 'BleedingMagnitude'
            : targetRaw === 'ignite' || targetRaw === 'flammability'
              ? 'IgniteMagnitude'
              : targetRaw === 'shock'
                ? 'EnemyShockMagnitude'
                : targetRaw === 'chill'
                  ? 'EnemyChillMagnitude'
                  : 'AilmentMagnitude';
      return [mkMod(statName, modType, signedVal, src)];
    },
  },
  {
    pattern: /^(Poisons|Ignites|Bleeds|Bleeding|Damaging Ailments|Ailments) you inflict(?: with (Attacks|Spells|Melee Attacks|Melee Weapons|Weapon Attacks))? deal Damage (\d+)% faster$/i,
    build: (m, src) => {
      const t = m[1]!.toLowerCase();
      const scope = (m[2] ?? '').toLowerCase();
      const val = Number(m[3]);
      const fl =
        scope === 'attacks' || scope === 'weapon attacks'
          ? ModFlag.Attack
          : scope === 'melee attacks' || scope === 'melee weapons'
            ? ModFlag.Attack | ModFlag.Melee
            : scope === 'spells'
              ? ModFlag.Spell
              : 0;
      const statName =
        t === 'poisons'
          ? 'PoisonFaster'
          : t === 'ignites'
            ? 'IgniteFaster'
            : t === 'bleeds' || t === 'bleeding'
              ? 'BleedFaster'
              : 'AilmentFaster';
      return [mkMod(statName, 'INC', val, src, fl)];
    },
  },
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier with Melee Weapon Attacks$/i,
    build: (m, src) => [mkMod('DotMultiplier', 'BASE', Number(m[1]), src, ModFlag.Attack | ModFlag.Melee)],
  },
  {
    pattern: /^(\d+)% increased Damage with (Ignite|Bleeding|Poison|Ailments) from Melee Weapons$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const kw =
        kind === 'ignite'
          ? KeywordFlag.Ignite
          : kind === 'bleeding'
            ? KeywordFlag.Bleed
            : kind === 'poison'
              ? KeywordFlag.Poison
              : 0;
      return [mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Melee | ModFlag.Ailment, kw)];
    },
  },
  {
    pattern: /^Gain (\d+)% of Physical Damage as(?: Extra Damage of)? a random Element if you've cast Elemental Weakness in the past 10 seconds$/i,
    build: (m, src) => {
      const each = Number(m[1]) / 3;
      const condTag = { type: 'Condition' as const, var: 'SelfCastElementalWeakness' };
      return [
        { ...mkMod('PhysicalDamageGainAsFire', 'BASE', each, src), tags: [condTag] },
        { ...mkMod('PhysicalDamageGainAsCold', 'BASE', each, src), tags: [condTag] },
        { ...mkMod('PhysicalDamageGainAsLightning', 'BASE', each, src), tags: [condTag] },
      ];
    },
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier if you've cast Enfeeble in the past 10 seconds$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'SelfCastEnfeeble' }],
      },
    ],
  },
  {
    pattern: /^(?:Inflict )?(Fire|Cold|Lightning) Exposure on Hit if you've cast (Flammability|Frostbite|Conductivity) in the past 10 seconds$/i,
    build: (m, src) => [
      {
        ...mkMod(`${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1).toLowerCase()}Exposure`, 'BASE', -10, src),
        target: 'enemy',
        tags: [{ type: 'Condition', var: `SelfCast${m[2]!.charAt(0).toUpperCase()}${m[2]!.slice(1).toLowerCase()}` }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Cooldown Recovery Rate if you've cast Temporal Chains in the past 10 seconds$/i,
    build: (m, src) => [
      {
        ...mkMod('CooldownRecovery', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'SelfCastTemporalChains' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% chance to deal Double Damage if you've cast Vulnerability in the past 10 seconds$/i,
    build: (m, src) => [
      {
        ...mkMod('DoubleDamageChance', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'SelfCastVulnerability' }],
      },
    ],
  },
  {
    pattern: /^Transfiguration of Mind$/i,
    build: (_, src) => [mkMod('TransfigurationOfMind', 'FLAG', true, src)],
  },
  {
    pattern: /^(?:.*?\b)?Your Curse Limit is equal to your maximum Power Charges$/i,
    build: (_, src) => [mkMod('CurseLimitIsMaximumPowerCharges', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% increased Spell Damage for each (\d+) Mana you have spent Recently,\s*up to (\d+)%$/i,
    build: (m, src) => {
      const perStep = Number(m[1]);
      const div = Math.max(1, Number(m[2]));
      const capTotal = Number(m[3]);
      const limitSteps = perStep > 0 ? Math.floor(capTotal / perStep) : 0;
      return [
        {
          ...mkMod('Damage', 'INC', perStep, src, ModFlag.Spell),
          tags: [{ type: 'PerStat', stat: 'ManaSpentRecently', div, limit: limitSteps }],
        },
      ];
    },
  },
  {
    pattern: /^Lightning Damage with Non-Critical Strikes is Lucky$/i,
    build: (_, src) => [mkMod('LightningNoCritLucky', 'FLAG', true, src)],
  },
  {
    pattern: /^Gain (\d+)% of Cold Damage as Extra Fire Damage per 1% Chill Effect on Enemy$/i,
    build: (m, src) => [
      {
        ...mkMod('ColdDamageGainAsFire', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Multiplier', var: 'EnemyChillEffect' }],
      },
    ],
  },
  {
    pattern: /^Gain (\d+)% of Cold Damage as Extra Fire Damage against Frozen Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('ColdDamageGainAsFire', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'EnemyFrozen' }],
      },
    ],
  },
  {
    pattern: /^Enemies take (\d+)% increased Damage for each of your Brands Attached to them$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'INC', Number(m[1]), src),
        target: 'enemy',
        tags: [{ type: 'Multiplier', var: 'BrandsAttachedToEnemy' }],
      },
    ],
  },
  {
    pattern: /^Culling Strike$/i,
    build: (_, src) => [
      mkMod('CullingStrike', 'FLAG', true, src),
      mkMod('CullPercent', 'MAX', 10, src),
    ],
  },
  {
    pattern: /^(\d+)% increased maximum Life and Mana if your equipped Staff has a Red and Blue Socket$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const condTag = { type: 'Condition' as const, var: 'StaffHasRedAndBlueSocket' };
      return [
        { ...mkMod('Life', 'INC', val, src), tags: [condTag] },
        { ...mkMod('Mana', 'INC', val, src), tags: [condTag] },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Effect of your Marks?(?: Skills)?$/i,
    build: (m, src) => [mkMod('MarkEffect', 'INC', Number(m[1]), src)],
  },
  // Ryslatha's Coil & Minimum/Maximum Damage scaling
  {
    pattern: /^(\d+)% (more|less|increased|reduced) (Minimum|Maximum) (Physical|Fire|Cold|Lightning|Chaos) (Attack |Spell )?Damage$/i,
    build: (m, src) => {
      const mag = Number(m[1]);
      const kind = m[2]!.toLowerCase();
      const modType: ModType = kind === 'more' || kind === 'less' ? 'MORE' : 'INC';
      const val = kind === 'less' || kind === 'reduced' ? -mag : mag;
      const bound = m[3]!.toLowerCase() === 'maximum' ? 'Max' : 'Min';
      const el = m[4]!.charAt(0).toUpperCase() + m[4]!.slice(1).toLowerCase();
      const scope = (m[5] ?? '').trim().toLowerCase();
      const fl = scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
      return [mkMod(`${el}${bound}Damage`, modType, val, src, fl)];
    },
  },
  {
    pattern: /^(\d+)% (more|less|increased|reduced) (Minimum|Maximum) (Attack |Spell )?Damage$/i,
    build: (m, src) => {
      const mag = Number(m[1]);
      const kind = m[2]!.toLowerCase();
      const modType: ModType = kind === 'more' || kind === 'less' ? 'MORE' : 'INC';
      const val = kind === 'less' || kind === 'reduced' ? -mag : mag;
      const bound = m[3]!.toLowerCase() === 'maximum' ? 'Max' : 'Min';
      const scope = (m[4] ?? '').trim().toLowerCase();
      const fl = scope === 'attack' ? ModFlag.Attack : scope === 'spell' ? ModFlag.Spell : 0;
      return [mkMod(`${bound}Damage`, modType, val, src, fl)];
    },
  },
  // Echoes of Creation (per exerting Warcry)
  {
    pattern: /^Skills deal (\d+)% more Damage for each Warcry Exerting them$/i,
    build: (m, src) => [mkMod('EchoesExertAverageIncrease', 'MORE', Number(m[1]), src, ModFlag.Attack)],
  },
  // Yoke of Suffering (Enemy damage taken per ailment type)
  {
    pattern: /^Enemies take (\d+)% increased Damage for each type of Ailment you have inflicted on them$/i,
    build: (m, src) => [
      { ...mkMod('EnemyDamageTakenPerAilmentType', 'BASE', Number(m[1]), src), target: 'player' },
    ],
  },
  // Consecrated Ground increased Damage taken by Enemies
  {
    pattern: /^Enemies on Consecrated Ground(?: you create)? take (\d+)% increased Damage$/i,
    build: (m, src) => [
      { ...mkMod('DamageTakenConsecratedGround', 'INC', Number(m[1]), src), target: 'enemy' },
    ],
  },
  {
    pattern: /^Consecrated Ground (?:you create|created during Effect) applies (\d+)% increased Damage taken to Enemies$/i,
    build: (m, src) => [
      { ...mkMod('DamageTakenConsecratedGround', 'INC', Number(m[1]), src), target: 'enemy' },
    ],
  },
  {
    pattern: /^Consecrated Ground you create while affected by Zealotry causes Enemies to take (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTakenConsecratedGround', 'INC', Number(m[1]), src),
        target: 'enemy',
        tags: [{ type: 'Condition', var: 'AffectedByZealotry' }],
      },
    ],
  },
  // Hierophant Arcane Blessing (Arcane Surge grants more Spell Damage)
  {
    pattern: /^Arcane Surge (?:also )?grants (\d+)% more Spell Damage(?: to you)?$/i,
    build: (m, src) => [mkMod('ArcaneSurgeDamage', 'MAX', Number(m[1]), src)],
  },
  // Warden Avatar of the Wilds (Unbound Avatar)
  {
    pattern: /^(\d+)% more Elemental Damage while Unbound$/i,
    build: (m, src) => [
      {
        ...mkMod('ElementalDamage', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition', var: 'Unbound' }],
      },
    ],
  },
  {
    pattern: /^Your Hits always inflict Freeze, Shock and Ignite while Unbound$/i,
    build: (_, src) => {
      const condTag = { type: 'Condition' as const, var: 'Unbound' };
      return [
        { ...mkMod('FreezeChance', 'BASE', 100, src), tags: [condTag] },
        { ...mkMod('ShockChance', 'BASE', 100, src), tags: [condTag] },
        { ...mkMod('IgniteChance', 'BASE', 100, src), tags: [condTag] },
      ];
    },
  },
  {
    pattern: /^(.+?)\s+if\s+(\d+)\s+(Shaper|Elder|Crusader|Hunter|Redeemer|Warlord|Searing Exarch|Eater of Worlds)\s+Items?\s+(?:is|are)\s+Equipped$/i,
    build: (m, src) => {
      const inner = parseModLine(m[1]!.trim(), src);
      if (inner.length === 0) return [];
      const rawInf = m[3]!.toLowerCase();
      const infKey =
        rawInf === 'searing exarch'
          ? 'ExarchItem'
          : rawInf === 'eater of worlds'
            ? 'EaterItem'
            : `${m[3]!.charAt(0).toUpperCase()}${m[3]!.slice(1).toLowerCase()}Item`;
      const condTag = {
        type: 'Condition' as const,
        var: `MultiplierThreshold:${infKey}:${Number(m[2])}`,
      };
      return inner.map((mod) => ({
        ...mod,
        tags: [...(mod.tags ?? []), condTag],
      }));
    },
  },
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
  const compMods = parseModCompositional(canonical, source, { allowBonded: opts?.allowBonded });
  if (compMods.length > 0 && /\bfrom Equipped\b/i.test(canonical)) {
    // Prevent unrecognized equipment-slot defence clauses from leaking as global defences
    return compMods.filter(
      (m) => m.name !== 'Armour' && m.name !== 'Evasion' && m.name !== 'EnergyShield',
    );
  }
  return compMods;
}

export function parseModLines(
  lines: readonly string[],
  source: string,
  opts?: ParseModOptions,
): Mod[] {
  const result: Mod[] = [];
  // Expand `\n`-packed entries (official PoB passive nodes pack multiple lines or mid-sentence wraps)
  const flatLines: string[] = [];
  for (const rawEntry of lines) {
    const parts = rawEntry
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length > 1) {
      // If a continuation line starts with a lowercase word (mid-sentence wrap like "dealing up\nto 30%..."
      // or "you\nand nearby Allies..."), test joining the whole entry first.
      const hasLowercaseWrap = parts.slice(1).some((p) => /^[a-z]/.test(p));
      if (hasLowercaseWrap) {
        const joinedWhole = parts.join(' ');
        const wholeMods = parseModLine(joinedWhole, source, opts);
        if (wholeMods.length > 0) {
          result.push(...wholeMods);
          continue;
        }
      }
    }
    flatLines.push(...parts);
  }

  for (let i = 0; i < flatLines.length; i++) {
    const line = flatLines[i]!;
    const mods = parseModLine(line, source, opts);
    if (mods.length > 0) {
      result.push(...mods);
      continue;
    }
    // Wrapped two-line item/tree modifiers (e.g. The Taming, Master of Metal, Murderous Eye Jewel)
    // Only join consecutive unparsed fragments so independent valid lines are never merged.
    if (i + 1 < flatLines.length) {
      const next = flatLines[i + 1]!;
      if (parseModLine(next, source, opts).length === 0) {
        const joined = `${line} ${next}`;
        const joinedMods = parseModLine(joined, source, opts);
        if (joinedMods.length > 0) {
          result.push(...joinedMods);
          i += 1;
          continue;
        }
      }
    }
  }
  return result;
}
