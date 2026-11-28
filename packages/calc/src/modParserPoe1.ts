import { KeywordFlag, ModFlag, type Mod, type ModType } from '@webpob/core';
import { normalizeStatLineToEn } from '@webpob/i18n';

export interface ModRule {
  pattern: RegExp;
  build: (match: RegExpMatchArray, source: string) => Mod[];
}

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

function attrCode(raw: string): 'Str' | 'Dex' | 'Int' {
  const lower = raw.toLowerCase();
  if (lower.startsWith('str')) return 'Str';
  if (lower.startsWith('dex')) return 'Dex';
  return 'Int';
}

function weaponFlags(raw: string): number {
  const lower = raw.toLowerCase();
  if (lower.includes('two handed')) return ModFlag.Attack | ModFlag.Weapon2H | (lower.includes('melee') ? ModFlag.Melee : 0);
  if (lower.includes('one handed')) return ModFlag.Attack | ModFlag.Weapon1H | (lower.includes('melee') ? ModFlag.Melee : 0);
  if (lower.includes('mace') && lower.includes('stave')) return ModFlag.Attack | ModFlag.Mace | ModFlag.Staff;
  if (lower.includes('mace') || lower.includes('sceptre')) return ModFlag.Attack | ModFlag.Mace;
  if (lower.includes('axe')) return ModFlag.Attack | ModFlag.Axe;
  if (lower.includes('sword')) return ModFlag.Attack | ModFlag.Sword;
  if (lower.includes('claw')) return ModFlag.Attack | ModFlag.Claw;
  if (lower.includes('dagger')) return ModFlag.Attack | ModFlag.Dagger;
  if (lower.includes('bow')) return ModFlag.Attack | ModFlag.Bow;
  if (lower.includes('wand')) return ModFlag.Attack | ModFlag.Wand;
  if (lower.includes('staff') || lower.includes('stave')) return ModFlag.Attack | ModFlag.Staff;
  if (lower.includes('melee')) return ModFlag.Attack | ModFlag.Melee;
  return ModFlag.Attack;
}

function elementKeywordFlag(raw?: string): number {
  if (!raw) return 0;
  switch (raw.toLowerCase()) {
    case 'fire':
      return KeywordFlag.Fire;
    case 'cold':
      return KeywordFlag.Cold;
    case 'lightning':
      return KeywordFlag.Lightning;
    case 'chaos':
      return KeywordFlag.Chaos;
    case 'physical':
      return KeywordFlag.Physical;
    case 'totem':
    case 'totems':
      return KeywordFlag.Totem;
    case 'trap':
    case 'traps':
      return KeywordFlag.Trap;
    case 'mine':
    case 'mines':
      return KeywordFlag.Mine;
    case 'minion':
    case 'minions':
      return KeywordFlag.Minion;
    case 'aura':
    case 'auras':
      return KeywordFlag.Aura;
    case 'curse':
    case 'curses':
    case 'hex':
      return KeywordFlag.Curse;
    case 'warcry':
      return KeywordFlag.Warcry;
    case 'movement':
      return KeywordFlag.Movement;
    default:
      return 0;
  }
}

function resourceModName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === 'energy shield') return 'EnergyShield';
  if (lower === 'life') return 'Life';
  if (lower === 'mana') return 'Mana';
  if (lower === 'armour') return 'Armour';
  if (lower.startsWith('evasion')) return 'Evasion';
  if (lower === 'ward') return 'Ward';
  return raw;
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function dmgModName(raw?: string): string {
  if (!raw) return 'Damage';
  const c = capFirst(raw.trim());
  if (c === 'Physical' || c === 'Fire' || c === 'Cold' || c === 'Lightning' || c === 'Chaos' || c === 'Elemental') {
    return `${c}Damage`;
  }
  return 'Damage';
}

/**
 * High-coverage PoE 1 modifier rules aligned with upstream PoB1 `ModParser.lua`.
 * Covers confirmed P0 parser bugfixes, attribute & charge stacking, weapon & conditional
 * combat, defences, block, reservation, flasks, ailments, and endgame tree/cluster/unique mods.
 */
export const POE1_EXTRA_MOD_RULES: ModRule[] = [
  // =========================================================================
  // 1. Confirmed P0 Bugfixes & Keystones
  // =========================================================================
  {
    pattern: /^\+(\d+) to Maximum (Power|Frenzy|Endurance) Charges?$/i,
    build: (m, src) => [mkMod(`Max${capFirst(m[2]!)}Charges`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Strength's Damage bonus applies to Projectile Attack Damage as well as Melee Damage$/i,
    build: (_, src) => [mkMod('IronGrip', 'FLAG', true, src)],
  },
  {
    pattern: /^Removes all Energy Shield$/i,
    build: (_, src) => [mkMod('EnergyShield', 'OVERRIDE', 0, src)],
  },
  {
    pattern: /^Removes all mana$/i,
    build: (_, src) => [mkMod('BloodMagic', 'FLAG', true, src), mkMod('Mana', 'OVERRIDE', 0, src)],
  },
  {
    pattern: /^Dexterity provides no inherent bonus to Evasion Rating$/i,
    build: (_, src) => [mkMod('NoDexEvasionBonus', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% more Attack Damage if Accuracy Rating is higher than Maximum Life$/i,
    build: (m, src) => [
      mkMod('PreciseTechnique', 'FLAG', true, src),
      mkMod('PreciseTechniqueMorePct', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^You can inflict Bleeding on an Enemy up to 8 times$/i,
    build: (_, src) => [mkMod('CrimsonDance', 'FLAG', true, src)],
  },
  {
    pattern: /^Your Bleeding does not deal extra Damage while the Enemy is moving and cannot be Aggravated$/i,
    build: (_, src) => [mkMod('CrimsonDance', 'FLAG', true, src)],
  },
  {
    pattern: /^Cannot Evade enemy Attacks$/i,
    build: (_, src) => [mkMod('CannotEvade', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% increased Action Speed$/i,
    build: (m, src) => [mkMod('ActionSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% less (?:maximum )?Energy Shield$/i,
    build: (m, src) => [mkMod('EnergyShield', 'MORE', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% less maximum (Life|Mana)$/i,
    build: (m, src) => [mkMod(capFirst(m[2]!), 'MORE', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% less (Armour|Evasion Rating)$/i,
    build: (m, src) => [mkMod(resourceModName(m[2]!), 'MORE', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% less (Attack|Cast) Speed$/i,
    build: (m, src) => [
      mkMod('Speed', 'MORE', -Number(m[1]), src, m[2]!.toLowerCase() === 'attack' ? ModFlag.Attack : ModFlag.Spell),
    ],
  },
  {
    pattern: /^(\d+)% less Movement Speed$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'MORE', -Number(m[1]), src)],
  },

  // =========================================================================
  // 2. Reduced Modifiers (Negative INC)
  // =========================================================================
  {
    pattern: /^(\d+)% reduced Movement Speed$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% reduced Cast Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% reduced Attack and Cast Speed$/i,
    build: (m, src) => [
      mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Attack),
      mkMod('Speed', 'INC', -Number(m[1]), src, ModFlag.Spell),
    ],
  },
  {
    pattern: /^(\d+)% reduced (?:Mana )?Cost(?: of (?:Skills|Attacks|Spells))?$/i,
    build: (m, src) => [mkMod('ManaCost', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:Global )?(Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i,
    build: (m, src) => [mkMod(`${capFirst(m[2]!)}Damage`, 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (Spell|Attack|Projectile|Melee|Area|Minion) Damage$/i,
    build: (m, src) => {
      const k = m[2]!.toLowerCase();
      if (k === 'minion') return [mkMod('MinionDamage', 'INC', -Number(m[1]), src)];
      const flag =
        k === 'spell' ? ModFlag.Spell :
        k === 'attack' ? ModFlag.Attack :
        k === 'projectile' ? ModFlag.Projectile :
        k === 'melee' ? ModFlag.Melee : ModFlag.Area;
      return [mkMod('Damage', 'INC', -Number(m[1]), src, flag)];
    },
  },
  {
    pattern: /^(\d+)% reduced (?:Global )?Damage$/i,
    build: (m, src) => [mkMod('Damage', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:Global )?Critical Strike Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:Skill Effect |Flask Effect )?Duration$/i,
    build: (m, src) => [mkMod('Duration', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced maximum (Life|Mana|Energy Shield)$/i,
    build: (m, src) => [mkMod(resourceModName(m[2]!), 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (Armour|Evasion(?: Rating)?|Energy Shield|Ward)$/i,
    build: (m, src) => [mkMod(resourceModName(m[2]!), 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:Mana )?Reservation(?: of Skills)?$/i,
    build: (m, src) => [mkMod('ManaReserved', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Enemy Stun Threshold(?: with .+)?$/i,
    build: (m, src) => [mkMod('EnemyStunThreshold', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Effect of Curses on you(?: during Effect)?$/i,
    build: (m, src) => [mkMod('CurseEffectOnSelf', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Light Radius$/i,
    build: (m, src) => [mkMod('LightRadius', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Attribute Requirements$/i,
    build: (m, src) => [mkMod('AttributeRequirements', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Elemental Ailment Duration on you$/i,
    build: (m, src) => [mkMod('SelfElementalAilmentDuration', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Effect of (?:Chill|Shock|Chill and Shock|Non-Damaging Ailments) on you$/i,
    build: (m, src) => [mkMod('SelfAilmentEffect', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^You take (\d+)% reduced Extra Damage from Critical Strikes$/i,
    build: (m, src) => [mkMod('CritExtraDamageTaken', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Area of Effect$/i,
    build: (m, src) => [mkMod('AreaOfEffect', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Accuracy Rating$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:Damage taken|Physical Damage taken|Elemental Damage taken)$/i,
    build: (m, src) => [mkMod('DamageTaken', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => [mkMod(attrCode(m[2]!), 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced (?:all )?Attributes$/i,
    build: (m, src) => {
      const v = -Number(m[1]);
      return [mkMod('Str', 'INC', v, src), mkMod('Dex', 'INC', v, src), mkMod('Int', 'INC', v, src)];
    },
  },
  {
    pattern: /^(\d+)% reduced Mana Regeneration Rate$/i,
    build: (m, src) => [mkMod('ManaRegen', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Flask Charges used$/i,
    build: (m, src) => [mkMod('FlaskChargesUsed', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% reduced Projectile Speed$/i,
    build: (m, src) => [mkMod('ProjectileSpeed', 'INC', -Number(m[1]), src)],
  },

  // =========================================================================
  // 3. Attributes & Stacking (Per-Charge & Per-Attribute)
  // =========================================================================
  {
    pattern: /^(\d+)% increased (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => [mkMod(attrCode(m[2]!), 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (?:all )?Attributes$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [mkMod('Str', 'INC', v, src), mkMod('Dex', 'INC', v, src), mkMod('Int', 'INC', v, src)];
    },
  },
  {
    pattern: /^(\d+)% increased (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => [
      mkMod(attrCode(m[2]!), 'INC', Number(m[1]), src),
      mkMod(attrCode(m[3]!), 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to (Spells|Attacks) per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => {
      const flag = m[4]!.toLowerCase() === 'spells' ? ModFlag.Spell : ModFlag.Attack;
      const charge = capFirst(m[5]!);
      const el = capFirst(m[3]!);
      return [
        mkMod(`FlatMinPer${charge}Charge:${el}`, 'BASE', Number(m[1]), src, flag),
        mkMod(`FlatMaxPer${charge}Charge:${el}`, 'BASE', Number(m[2]), src, flag),
      ];
    },
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => {
      const charge = capFirst(m[4]!);
      const el = capFirst(m[3]!);
      return [
        mkMod(`FlatMinPer${charge}Charge:${el}`, 'BASE', Number(m[1]), src),
        mkMod(`FlatMaxPer${charge}Charge:${el}`, 'BASE', Number(m[2]), src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => [mkMod(`CritChancePer${capFirst(m[2]!)}Charge`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Attack Damage per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => [mkMod(`DamagePer${capFirst(m[2]!)}Charge`, 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased (Area of Effect|Movement Speed|Armour|Evasion Rating|Energy Shield) per (Power|Frenzy|Endurance) Charge$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!).replace(/\s+/g, '')}Per${capFirst(m[3]!)}Charge`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Fire|Cold|Lightning|Physical|Chaos) Damage to (Spells|Attacks) per (\d+) (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => {
      const flag = m[4]!.toLowerCase() === 'spells' ? ModFlag.Spell : ModFlag.Attack;
      const el = capFirst(m[3]!);
      const attr = capFirst(m[6]!);
      return [
        mkMod(`FlatMinPerAttr:${el}:${attr}`, 'BASE', Number(m[1]) / Number(m[5]), src, flag),
        mkMod(`FlatMaxPerAttr:${el}:${attr}`, 'BASE', Number(m[2]) / Number(m[5]), src, flag),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased (Armour|Evasion(?: Rating)?|Melee Physical Damage|Energy Shield|Accuracy Rating|Attack Speed|Cast Speed) per (\d+) (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => {
      const stat = m[2]!.replace(/\s+/g, '');
      const attr = capFirst(m[4]!);
      return [mkMod(`${stat}PerAttr:${attr}`, 'BASE', Number(m[1]) / Number(m[3]), src)];
    },
  },
  {
    pattern: /^\+(\d+)% Chance to Block Attack Damage per (\d+) Strength$/i,
    build: (m, src) => [mkMod('BlockChancePerAttr:Strength', 'BASE', Number(m[1]) / Number(m[2]), src)],
  },
  {
    pattern: /^\+(\d+) to (maximum Life|maximum Mana|maximum Energy Shield|Accuracy Rating|Armour|Evasion Rating) per (\d+) (Strength|Dexterity|Intelligence)$/i,
    build: (m, src) => {
      const stat = m[2]!.replace(/^maximum /i, '').replace(/\s+/g, '');
      return [mkMod(`${stat}PerAttr:${capFirst(m[4]!)}`, 'BASE', Number(m[1]) / Number(m[3]), src)];
    },
  },
  {
    pattern: /^Dexterity provides no (?:inherent )?bonus to Evasion Rating$/i,
    build: (_m, src) => [mkMod('NoDexBonusToEvasion', 'FLAG', true, src)],
  },

  // =========================================================================
  // 4. Weapon & Conditional Combat
  // =========================================================================
  {
    pattern: /^(\d+)% (increased|more|less) Attack Speed with (Two Handed Melee Weapons|Two Handed Weapons|One Handed Melee Weapons|One Handed Weapons|Maces or Sceptres|Maces, Sceptres or Staves|Axes?|Swords?|Claws?|Daggers?|Bows?|Wands?|Staves|Staff|Melee Weapons|Weapons)$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'less' ? -Number(m[1]) : Number(m[1]);
      const type: ModType = m[2]!.toLowerCase() === 'increased' ? 'INC' : 'MORE';
      return [mkMod('Speed', type, val, src, weaponFlags(m[3]!))];
    },
  },
  {
    pattern: /^(\d+)% increased (Physical |Elemental |Fire |Cold |Lightning |Chaos )?Damage with (Two Handed Melee Weapons|Two Handed Weapons|One Handed Melee Weapons|One Handed Weapons|Maces or Sceptres|Maces, Sceptres or Staves|Axes?|Swords?|Claws?|Daggers?|Bows?|Wands?|Staves|Staff|Melee Weapons|Weapons)$/i,
    build: (m, src) => [mkMod(dmgModName(m[2]), 'INC', Number(m[1]), src, weaponFlags(m[3]!))],
  },
  {
    pattern: /^(Mace or Sceptre|Axe|Sword|Claw|Dagger|Bow|Staff|Wand) Attacks deal (\d+)% increased Damage with Hits and Ailments$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[2]), src, weaponFlags(m[1]!))],
  },
  {
    pattern: /^(Mace or Sceptre|Axe|Sword|Claw|Dagger|Bow|Staff|Wand) Attacks deal (\d+)% increased Damage with Ailments$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[2]), src, weaponFlags(m[1]!) | ModFlag.Ailment)],
  },
  {
    pattern: /^(Mace or Sceptre|Axe|Sword|Claw|Dagger|Bow|Staff|Wand) Attacks deal (\d+)% increased Damage$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[2]), src, weaponFlags(m[1]!))],
  },
  {
    pattern: /^Attacks with (Two Handed Melee Weapons|Two Handed Weapons|One Handed Melee Weapons|One Handed Weapons|Melee Weapons) deal (\d+)% increased Damage with Ailments$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[2]), src, weaponFlags(m[1]!) | ModFlag.Ailment)],
  },
  {
    pattern: /^Attacks with (Two Handed Melee Weapons|Two Handed Weapons|One Handed Melee Weapons|One Handed Weapons|Melee Weapons) deal (\d+)% increased Damage(?: with Hits and Ailments)?$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[2]), src, weaponFlags(m[1]!))],
  },
  {
    pattern: /^Attack Skills deal (\d+)% increased Damage with Ailments while (Dual Wielding|holding a Shield|wielding a Staff)$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Ailment)],
  },
  {
    pattern: /^Attack Skills deal (\d+)% increased Damage(?: with Hits and Ailments)? while (Dual Wielding|holding a Shield|wielding a Staff)$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Attack Speed while (Dual Wielding|holding a Shield|wielding a Staff|Leeching)$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Cast Speed while (Dual Wielding|holding a Shield|wielding a Staff|Leeching)$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% increased Attack and Cast Speed (?:while (?:Channelling|Dual Wielding|holding a Shield|Leeching)|with (?:Chaos|Fire|Cold|Lightning|Physical|Elemental) Skills)$/i,
    build: (m, src) => [
      mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack),
      mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Spell),
    ],
  },
  {
    pattern: /^(\d+)% increased (?:Attack |Global )?Physical(?: Attack)? Damage(?: while (?:holding a Shield|Dual Wielding|wielding a Staff))?$/i,
    build: (m, src) => {
      const isAtk = /attack|shield|wielding/i.test(m[0]);
      return [mkMod('PhysicalDamage', 'INC', Number(m[1]), src, isAtk ? ModFlag.Attack : 0)];
    },
  },
  {
    pattern: /^(\d+)% increased Melee Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Melee)],
  },
  {
    pattern: /^(\d+)% increased Life Regeneration rate$/i,
    build: (m, src) => [mkMod('LifeRegen', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Spell Damage while (Dual Wielding|holding a Shield|wielding a Staff|wielding a Wand)$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^(\d+)% increased Damage while (?:wielding a (?:Wand|Staff|Bow|Sword|Axe|Claw|Dagger|Mace)|holding a Shield|Dual Wielding|Leeching)$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Damage if you have Consumed a corpse Recently$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Global Accuracy Rating$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Accuracy Rating with (Bows|Wands|Claws|Swords|Axes|Daggers|Staves|Maces or Sceptres|Two Handed Melee Weapons|One Handed Melee Weapons)$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', Number(m[1]), src, weaponFlags(m[2]!))],
  },
  {
    pattern: /^(\d+)% increased Accuracy Rating while (Dual Wielding|holding a Shield|wielding a Staff)$/i,
    build: (m, src) => [mkMod('Accuracy', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased (Melee|Attack) Critical Strike Chance(?: while (?:Dual Wielding|holding a Shield|wielding a Staff))?$/i,
    build: (m, src) => [
      mkMod('CritChance', 'INC', Number(m[1]), src, m[2]!.toLowerCase() === 'melee' ? ModFlag.Melee : ModFlag.Attack),
    ],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance for Attacks$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance with (Swords|Axes|Claws|Daggers|Bows|Wands|Staves|Maces or Sceptres|Two Handed Melee Weapons|One Handed Melee Weapons)$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, weaponFlags(m[2]!))],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance while (wielding a Staff|Dual Wielding|holding a Shield)$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance with (Fire|Cold|Lightning|Chaos|Physical|Elemental|Totem|Trap|Mine)s?(?: Skills)?$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, 0, elementKeywordFlag(m[2]))],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance against Blinded Enemies$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Projectile Attack Skills have (\d+)% increased Critical Strike Chance$/i,
    build: (m, src) => [mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Projectile)],
  },
  {
    pattern: /^Projectile Attack Skills have \+(\d+)% to Critical Strike Multiplier$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, ModFlag.Attack | ModFlag.Projectile)],
  },
  {
    pattern: /^\+(\d+)% to (Melee|Attack|Spell) Critical Strike Multiplier(?: while (?:Dual Wielding|holding a Shield|wielding a Staff))?$/i,
    build: (m, src) => {
      const k = m[2]!.toLowerCase();
      const flag = k === 'melee' ? ModFlag.Melee : k === 'spell' ? ModFlag.Spell : ModFlag.Attack;
      return [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, flag)];
    },
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier (?:with|for) Spell(?: Damage| Skills)?$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier (?:with|for) (Fire|Cold|Lightning|Elemental|Chaos|Physical|Totem|Trap|Mine)s?(?: Skills)?$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, 0, elementKeywordFlag(m[2]))],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier (?:with|for) (Melee|Attack)(?: Skills| Damage)?$/i,
    build: (m, src) => [
      mkMod('CritMultiplier', 'BASE', Number(m[1]), src, m[2]!.toLowerCase() === 'melee' ? ModFlag.Melee : ModFlag.Attack),
    ],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier (?:with|for) (Bows?|Claws?|Daggers?|Swords?|Axes?|Maces?|Maces or Sceptres|Staves|Staff|Wands?)(?: Skills)?$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src, weaponFlags(m[2]!))],
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier while (wielding a Staff|Dual Wielding|holding a Shield)$/i,
    build: (m, src) => [mkMod('CritMultiplier', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to (?:Spells and Attacks|Attacks and Spells)$/i,
    build: (m, src) => {
      const el = capFirst(m[3]!);
      return [
        mkMod(`${el}Min`, 'BASE', Number(m[1]), src),
        mkMod(`${el}Max`, 'BASE', Number(m[2]), src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased (Trap|Mine|Totem|Brand|Channelling|Retaliation) Damage$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const val = Number(m[1]);
      if (kind === 'totem') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Totem)];
      if (kind === 'trap') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Trap)];
      if (kind === 'mine') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Mine)];
      if (kind === 'channelling') {
        return [{ ...mkMod('Damage', 'INC', val, src), tags: [{ type: 'Condition', var: 'Channelling' }] }];
      }
      return [{ ...mkMod('Damage', 'INC', val, src), tags: [{ type: 'SkillType', skillType: capFirst(kind) }] }];
    },
  },
  {
    pattern: /^(Retaliation|Channelling|Brand|Totem|Trap|Mine) Skills deal (\d+)% increased Damage$/i,
    build: (m, src) => {
      const kind = m[1]!.toLowerCase();
      const val = Number(m[2]);
      if (kind === 'totem') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Totem)];
      if (kind === 'trap') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Trap)];
      if (kind === 'mine') return [mkMod('Damage', 'INC', val, src, 0, KeywordFlag.Mine)];
      if (kind === 'channelling') {
        return [{ ...mkMod('Damage', 'INC', val, src), tags: [{ type: 'Condition', var: 'Channelling' }] }];
      }
      return [{ ...mkMod('Damage', 'INC', val, src), tags: [{ type: 'SkillType', skillType: capFirst(kind) }] }];
    },
  },
  {
    pattern: /^Exerted Attacks deal (\d+)% (increased|more|less) Damage$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const val = kind === 'less' ? -Number(m[1]) : Number(m[1]);
      return [mkMod('ExertIncrease', kind === 'increased' ? 'INC' : 'MORE', val, src, ModFlag.Attack)];
    },
  },
  {
    pattern: /^Minions deal (\d+)% increased Damage while you are affected by a Herald$/i,
    build: (m, src) => [mkMod('MinionDamage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have (\d+)% increased (Attack|Cast) Speed$/i,
    build: (m, src) => [
      mkMod('MinionSpeed', 'INC', Number(m[1]), src, m[2]!.toLowerCase() === 'attack' ? ModFlag.Attack : ModFlag.Spell),
    ],
  },
  {
    pattern: /^Minions have (\d+)% increased Critical Strike Chance$/i,
    build: (m, src) => [mkMod('MinionCritChance', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have \+(\d+)% to Critical Strike Multiplier$/i,
    build: (m, src) => [mkMod('MinionCritMultiplier', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions Regenerate (\d+(?:\.\d+)?)% of Life per second$/i,
    build: (m, src) => [mkMod('MinionLifeRegenPercent', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have \+(\d+)% to (Chaos|Fire|Cold|Lightning) Resistance$/i,
    build: (m, src) => [mkMod(`Minion${capFirst(m[2]!)}Resist`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Minions have \+(\d+)% to all Elemental Resistances$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('MinionFireResist', 'BASE', v, src),
        mkMod('MinionColdResist', 'BASE', v, src),
        mkMod('MinionLightningResist', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Minion Duration$/i,
    build: (m, src) => [mkMod('MinionDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+)% of Wand Physical Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`PhysicalDamageGainAs${capFirst(m[2]!)}`, 'BASE', Number(m[1]), src, ModFlag.Wand)],
  },
  {
    pattern: /^Socketed (?:Gems|Skills) deal Double Damage$/i,
    build: (_, src) => [{ ...mkMod('DoubleDamageChance', 'BASE', 100, src), tags: [{ type: 'SocketedIn' }] }],
  },
  {
    pattern: /^Socketed Vaal (?:Gems|Skills) (?:deal|have) (\d+)% (more|less) Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', (m[2]!.toLowerCase() === 'less' ? -1 : 1) * Number(m[1]), src),
        tags: [{ type: 'SocketedIn' }],
      },
    ],
  },
  {
    pattern: /^Socketed (?:Gems|Skills) deal (\d+)% (more|less) (Elemental |Attack |Spell |Physical |Fire |Cold |Lightning |Chaos |Melee |Projectile |Area )?Damage( over Time)?$/i,
    build: (m, src) => {
      const val = (m[2]!.toLowerCase() === 'less' ? -1 : 1) * Number(m[1]);
      const kind = (m[3] ?? '').trim().toLowerCase();
      const isDot = Boolean(m[4]);
      let statName = 'Damage';
      let flag = isDot ? ModFlag.Dot : 0;
      if (
        kind === 'elemental' ||
        kind === 'physical' ||
        kind === 'fire' ||
        kind === 'cold' ||
        kind === 'lightning' ||
        kind === 'chaos'
      ) {
        statName = `${capFirst(kind)}Damage`;
      } else if (kind === 'attack') {
        flag |= ModFlag.Attack;
      } else if (kind === 'spell') {
        flag |= ModFlag.Spell;
      } else if (kind === 'melee') {
        flag |= ModFlag.Melee;
      } else if (kind === 'projectile') {
        flag |= ModFlag.Projectile;
      } else if (kind === 'area') {
        flag |= ModFlag.Area;
      }
      return [{ ...mkMod(statName, 'MORE', val, src, flag), tags: [{ type: 'SocketedIn' }] }];
    },
  },

  // =========================================================================
  // 5. Defences, Block, Suppression, Reservation, Flasks & Recovery
  // =========================================================================
  {
    pattern: /^\+?(\d+)% Chance to Block (Attack|Spell) Damage while (?:holding a Shield|Dual Wielding|wielding a Staff|Dual Wielding or holding a Shield|holding a Staff or Shield)$/i,
    build: (m, src) => [
      mkMod(m[2]!.toLowerCase() === 'spell' ? 'SpellBlockChance' : 'BlockChance', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% Chance to Block (Attack|Spell) Damage$/i,
    build: (m, src) => [
      mkMod(m[2]!.toLowerCase() === 'spell' ? 'SpellBlockChance' : 'BlockChance', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^\+(\d+)% to maximum Chance to Block (Attack|Spell) Damage$/i,
    build: (m, src) => [
      mkMod(m[2]!.toLowerCase() === 'spell' ? 'SpellBlockChanceMax' : 'BlockChanceMax', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^\+(\d+)% (?:to )?(?:all )?Elemental Resistances while (?:holding a Shield|Dual Wielding|wielding a Staff)$/i,
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
    pattern: /^(\d+)% (increased|reduced) Defences$/i,
    build: (m, src) => {
      const v = m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]);
      return [
        mkMod('Armour', 'INC', v, src),
        mkMod('Evasion', 'INC', v, src),
        mkMod('EnergyShield', 'INC', v, src),
        mkMod('Ward', 'INC', v, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased (Energy Shield|Armour|Evasion(?: Rating)?|Defences|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield) from Equipped (Shield|Body Armour|Helmet|Boots|Gloves)$/i,
    build: (m, src) => {
      const slot = m[3]!.replace(/\s+/g, '');
      const stat = m[2]!.replace(/\s+/g, '');
      return [mkMod(`${slot}${stat}Inc`, 'INC', Number(m[1]), src)];
    },
  },
  {
    pattern: /^(\d+)% increased (?:Mana )?Reservation Efficiency of (?:Skills|Mana|Aura Skills|Herald Skills|Curse Aura Skills|Skills that throw Mines)$/i,
    build: (m, src) => [mkMod('ManaReservationEfficiency', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of Physical Damage from Hits taken as (Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => [mkMod(`PhysicalDamageTakenAs${capFirst(m[2]!)}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Area of Effect(?: while wielding a Staff)?$/i,
    build: (m, src) => [mkMod('AreaOfEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Area of Effect of (Aura|Hex|Curse|Brand|Warcry|Banner) Skills$/i,
    build: (m, src) => [mkMod('AreaOfEffect', 'INC', Number(m[1]), src, 0, elementKeywordFlag(m[2]))],
  },
  {
    pattern: /^(Melee|Spell|Warcry|Banner|Retaliation) Skills have (\d+)% increased Area of Effect$/i,
    build: (m, src) => {
      const k = m[1]!.toLowerCase();
      const flag = k === 'melee' ? ModFlag.Melee : k === 'spell' ? ModFlag.Spell : 0;
      return [mkMod('AreaOfEffect', 'INC', Number(m[2]), src, flag, elementKeywordFlag(k))];
    },
  },
  {
    pattern: /^(\d+)% increased (?:Skill Effect )?Duration$/i,
    build: (m, src) => [mkMod('Duration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Energy Shield Recharge Rate$/i,
    build: (m, src) => [mkMod('EnergyShieldRecharge', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% faster start of Energy Shield Recharge$/i,
    build: (m, src) => [mkMod('EnergyShieldRechargeFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Flask Effect Duration$/i,
    build: (m, src) => [mkMod('FlaskDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Flask Charges gained$/i,
    build: (m, src) => [mkMod('FlaskChargesGained', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Charge Recovery$/i,
    build: (m, src) => [mkMod('FlaskChargeRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Life|Mana) Recovery from Flasks$/i,
    build: (m, src) => [mkMod(`Flask${capFirst(m[2]!)}Recovery`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Flasks applied to you have (\d+)% increased Effect$/i,
    build: (m, src) => [mkMod('FlaskEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased effect$/i,
    build: (m, src) => [mkMod('LocalFlaskEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Tinctures applied to you have (\d+)% increased Effect$/i,
    build: (m, src) => [mkMod('TinctureEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Tinctures applied to you have (\d+)% reduced Mana Burn rate$/i,
    build: (m, src) => [mkMod('TinctureManaBurnRate', 'INC', -Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% additional Elemental Resistances during Effect$/i,
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
    pattern: /^(\d+)% increased (?:Mana )?Cost Efficiency(?: of (?:Attacks|Spells|Skills|Curse Skills|Link Skills))?$/i,
    build: (m, src) => [mkMod('ManaCostEfficiency', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Non-Channelling Skills have ([+-]?\d+) to Total Mana Cost$/i,
    build: (m, src) => [mkMod('ManaCost', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% of Damage taken Recouped as (Life|Mana|Energy Shield)$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!)}Recoup`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased total Recovery per second from (Life|Mana|Energy Shield) Leech$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!)}LeechRate`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Maximum total Mana Recovery per second from Leech$/i,
    build: (m, src) => [mkMod('ManaMaxLeechRateInc', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+(?:\.\d+)?)% of (?:Physical )?Attack Damage Leeched as (Life|Mana|Energy Shield)$/i,
    build: (m, src) => [
      mkMod(`${m[2]!.toLowerCase() === 'energy shield' ? 'Es' : capFirst(m[2]!)}Leech`, 'BASE', Number(m[1]), src, ModFlag.Attack),
    ],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?) Mana per second$/i,
    build: (m, src) => [mkMod('ManaRegen', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+) (Life|Mana|Energy Shield) per Enemy Killed$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!)}OnKill`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(?:Gain|Grants) (\d+) (Life|Mana|Energy Shield) per Enemy Hit(?: with Attacks)?$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!)}OnHit`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Recover (\d+)% of (Life|Mana|Energy Shield) on Kill$/i,
    build: (m, src) => [mkMod(`${resourceModName(m[2]!)}OnKillPercent`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Action Speed$/i,
    build: (m, src) => [mkMod('ActionSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Movement Speed while (Dual Wielding|holding a Shield|wielding a Staff)$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'INC', Number(m[1]), src)],
  },

  // =========================================================================
  // 6. Ailments, DoT Multipliers & Penetration
  // =========================================================================
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier for (Poison|Bleeding|Ignite|Fire|Cold|Chaos|Physical)$/i,
    build: (m, src) => {
      const k = capFirst(m[2]!);
      const name = k === 'Poison' || k === 'Chaos' ? 'ChaosDotMultiplier' :
                   k === 'Bleeding' || k === 'Physical' ? 'PhysicalDotMultiplier' :
                   k === 'Ignite' || k === 'Fire' ? 'FireDotMultiplier' : 'ColdDotMultiplier';
      return [mkMod(name, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^\+(\d+)% to (Fire|Cold|Chaos|Physical) Damage over Time Multiplier with (Attack|Spell|Bow) Skills$/i,
    build: (m, src) => {
      const f = m[3]!.toLowerCase() === 'spell' ? ModFlag.Spell :
                m[3]!.toLowerCase() === 'bow' ? (ModFlag.Attack | ModFlag.Bow) : ModFlag.Attack;
      return [mkMod(`${capFirst(m[2]!)}DotMultiplier`, 'BASE', Number(m[1]), src, f)];
    },
  },
  {
    pattern: /^\+(\d+)% to Damage Over Time Multiplier with (Spell|Attack|Bow) Skills$/i,
    build: (m, src) => {
      const f = m[2]!.toLowerCase() === 'spell' ? ModFlag.Spell :
                m[2]!.toLowerCase() === 'bow' ? (ModFlag.Attack | ModFlag.Bow) : ModFlag.Attack;
      return [mkMod('DotMultiplier', 'BASE', Number(m[1]), src, f)];
    },
  },
  {
    pattern: /^(\d+)% increased Damage Over Time with (Bow|Spell|Attack) Skills$/i,
    build: (m, src) => {
      const f = m[2]!.toLowerCase() === 'spell' ? ModFlag.Spell :
                m[2]!.toLowerCase() === 'bow' ? (ModFlag.Attack | ModFlag.Bow) : ModFlag.Attack;
      return [mkMod('DotDamage', 'INC', Number(m[1]), src, f)];
    },
  },
  {
    pattern: /^(\d+)% increased Damage with (?:Poison|Bleeding|Ailments from Attack Skills)$/i,
    build: (m, src) => [mkMod('DotDamage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Damage with Hits and Ailments against Marked Enemy$/i,
    build: (m, src) => [mkMod('Damage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Attacks have (\d+)% chance to cause Bleeding$/i,
    build: (m, src) => [mkMod('BleedChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^Attacks have (\d+)% chance to Ignite$/i,
    build: (m, src) => [mkMod('IgniteChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^(\d+)% chance to cause Bleeding on Hit$/i,
    build: (m, src) => [mkMod('BleedChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Poison on Hit with (Attacks|Spell Damage|Spells)$/i,
    build: (m, src) => [
      mkMod('PoisonChance', 'BASE', Number(m[1]), src, m[2]!.toLowerCase().startsWith('spell') ? ModFlag.Spell : ModFlag.Attack),
    ],
  },
  {
    pattern: /^(\d+)% chance to Ignite on Hit$/i,
    build: (m, src) => [mkMod('IgniteChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to (Freeze|Shock)$/i,
    build: (m, src) => [mkMod(`${capFirst(m[2]!)}Chance`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Freeze, Shock and Ignite$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      return [
        mkMod('FreezeChance', 'BASE', v, src),
        mkMod('ShockChance', 'BASE', v, src),
        mkMod('IgniteChance', 'BASE', v, src),
      ];
    },
  },
  {
    pattern: /^Damage(?: with Weapons)? Penetrates (\d+)% (?:of Enemy )?(Elemental|Fire|Cold|Lightning|Chaos) Resistances?$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      const el = capFirst(m[2]!);
      if (el === 'Elemental') {
        return [
          mkMod('FirePenetration', 'BASE', v, src),
          mkMod('ColdPenetration', 'BASE', v, src),
          mkMod('LightningPenetration', 'BASE', v, src),
        ];
      }
      return [mkMod(`${el}Penetration`, 'BASE', v, src)];
    },
  },
  {
    pattern: /^(Attack|Spell) Damage Penetrates (\d+)% (?:of Enemy )?(Elemental|Fire|Cold|Lightning|Chaos) Resistances?$/i,
    build: (m, src) => {
      const v = Number(m[2]);
      const flag = m[1]!.toLowerCase() === 'spell' ? ModFlag.Spell : ModFlag.Attack;
      const el = capFirst(m[3]!);
      if (el === 'Elemental') {
        return [
          mkMod('FirePenetration', 'BASE', v, src, flag),
          mkMod('ColdPenetration', 'BASE', v, src, flag),
          mkMod('LightningPenetration', 'BASE', v, src, flag),
        ];
      }
      return [mkMod(`${el}Penetration`, 'BASE', v, src, flag)];
    },
  },
  {
    pattern: /^Hits have (\d+)% chance to ignore Enemy Physical Damage Reduction$/i,
    build: (m, src) => [mkMod('EnemyPhysicalDamageReductionIgnoreChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Damaging Ailments deal damage (\d+)% Faster$/i,
    build: (m, src) => [mkMod('AilmentFaster', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(Bleeding|Ignite|Poison) you inflict deals Damage (\d+)% Faster$/i,
    build: (m, src) => [mkMod(`${capFirst(m[1]!)}Faster`, 'INC', Number(m[2]), src)],
  },
  {
    pattern: /^(\d+)% increased (Poison|Bleeding|Ignite|Curse|Mine|Trap|Totem) Duration(?: on Enemies)?$/i,
    build: (m, src) => [mkMod(`${capFirst(m[2]!)}Duration`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Duration of Elemental Ailments on Enemies$/i,
    build: (m, src) => [mkMod('ElementalAilmentDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Effect of (Non-Damaging Ailments|Chill|Shock|Lightning Ailments|Cold Ailments|Fire Ailments|your Marks?(?: Skills)?|Marks?(?: Skills)?|Herald Buffs on you|Consecrated Ground you create|Arcane Surge on you|Onslaught on you|Buffs granted by your Golems)$/i,
    build: (m, src) => {
      const raw = m[2]!.toLowerCase();
      let statName: string;
      if (raw.includes('mark')) statName = 'MarkEffect';
      else if (raw === 'arcane surge on you') statName = 'ArcaneSurgeEffect';
      else if (raw === 'consecrated ground you create') statName = 'ConsecratedGroundEffect';
      else if (raw === 'buffs granted by your golems') statName = 'GolemBuffEffect';
      else if (raw === 'herald buffs on you') statName = 'HeraldBuffEffect';
      else if (raw === 'onslaught on you') statName = 'OnslaughtEffect';
      else if (raw === 'shock' || raw === 'lightning ailments') statName = 'ShockEffect';
      else if (raw === 'chill' || raw === 'cold ailments') statName = 'ChillEffect';
      else if (raw === 'fire ailments') statName = 'FireAilmentEffect';
      else statName = 'NonDamagingAilmentEffect';
      return [mkMod(statName, 'INC', Number(m[1]), src)];
    },
  },

  // =========================================================================
  // 7. High-Frequency PoE 1 Tree, Utility, Totem/Trap/Mine/Warcry & Misc Rules
  // =========================================================================
  {
    pattern: /^Grants (\d+) Passive Skill Points?$/i,
    build: (m, src) => [mkMod('ExtraPoints', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+(?:\.\d+)?) metres to Melee Strike Range$/i,
    build: (m, src) => [mkMod('MeleeWeaponRange', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Projectile Speed$/i,
    build: (m, src) => [mkMod('ProjectileSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Totem Placement speed$/i,
    build: (m, src) => [mkMod('TotemPlacementSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Totem Life$/i,
    build: (m, src) => [mkMod('TotemLife', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Totems gain \+(\d+)% to all Elemental Resistances$/i,
    build: (m, src) => [mkMod('TotemElementalResist', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Attacks used by Totems have (\d+)% increased Attack Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack, KeywordFlag.Totem)],
  },
  {
    pattern: /^Spells Cast by Totems have (\d+)% increased Cast Speed$/i,
    build: (m, src) => [mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Spell, KeywordFlag.Totem)],
  },
  {
    pattern: /^(\d+)% increased Trap and Mine Throwing Speed$/i,
    build: (m, src) => [
      mkMod('TrapThrowingSpeed', 'INC', Number(m[1]), src, 0, KeywordFlag.Trap),
      mkMod('MineLayingSpeed', 'INC', Number(m[1]), src, 0, KeywordFlag.Mine),
    ],
  },
  {
    pattern: /^(\d+)% increased (Trap|Mine) Throwing Speed$/i,
    build: (m, src) => {
      const isMine = m[2]!.toLowerCase() === 'mine';
      return [
        mkMod(
          isMine ? 'MineLayingSpeed' : 'TrapThrowingSpeed',
          'INC',
          Number(m[1]),
          src,
          0,
          isMine ? KeywordFlag.Mine : KeywordFlag.Trap,
        ),
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Trap Trigger Area of Effect$/i,
    build: (m, src) => [mkMod('TrapTriggerAreaOfEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Mines have (\d+)% increased Detonation Speed$/i,
    build: (m, src) => [mkMod('MineDetonationSpeed', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Warcry (Buff Effect|Duration|Cooldown Recovery Rate|Speed)$/i,
    build: (m, src) => [mkMod(`Warcry${m[2]!.replace(/\s+/g, '')}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(Banner|Brand|Curse|Mark|Link|Guard|Retaliation) Skills have (\d+)% increased (Duration|Cast Speed|Speed|Cooldown Recovery Rate|Aura Effect|Buff Effect)$/i,
    build: (m, src) => [mkMod(`${capFirst(m[1]!)}${m[3]!.replace(/\s+/g, '')}`, 'INC', Number(m[2]), src)],
  },
  {
    pattern: /^(\d+)% increased Cooldown Recovery Rate (?:of|for) (Movement|Stance|Travel) Skills$/i,
    build: (m, src) => [mkMod(`${capFirst(m[2]!)}CooldownRecovery`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Brand Recall has (\d+)% increased Cooldown Recovery Rate$/i,
    build: (m, src) => [mkMod('BrandRecallCooldownRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Brand Attachment range$/i,
    build: (m, src) => [mkMod('BrandAttachmentRange', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Stun and Block Recovery$/i,
    build: (m, src) => [mkMod('StunRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Block Recovery$/i,
    build: (m, src) => [mkMod('BlockRecovery', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Stun Duration(?: with .+)? on Enemies$/i,
    build: (m, src) => [mkMod('EnemyStunDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased Stun Threshold$/i,
    build: (m, src) => [mkMod('StunThreshold', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to Avoid (?:being Stunned|Elemental Ailments|being Poisoned|Bleeding|being Chilled|being Frozen|being Shocked|being Ignited)$/i,
    build: (m, src) => [mkMod('AvoidAilmentOrStun', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Cannot be Stunned$/i,
    build: (_, src) => [mkMod('StunImmune', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% chance to Ignore Stuns while Casting$/i,
    build: (m, src) => [mkMod('IgnoreStunsWhileCasting', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Gain (\d+) Rage on Melee Hit$/i,
    build: (m, src) => [mkMod('RageOnMeleeHit', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Inherent loss of Rage is (\d+)% slower$/i,
    build: (m, src) => [mkMod('RageLossSlower', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Endurance|Frenzy|Power) Charge Duration$/i,
    build: (m, src) => [mkMod(`${capFirst(m[2]!)}ChargeDuration`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+) to maximum number of Summoned (Totems|Golems|Zombies|Skeletons|Spectres|Raging Spirits)$/i,
    build: (m, src) => {
      const singular = m[2]!.replace(/\s+/g, '').replace(/s$/i, '');
      return [mkMod(`Active${singular}Limit`, 'BASE', Number(m[1]), src)];
    },
  },
  {
    pattern: /^Attack Skills have \+(\d+) to maximum number of Summoned Ballista Totems$/i,
    build: (m, src) => [mkMod('ActiveBallistaTotemsLimit', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^You can apply an additional Curse$/i,
    build: (_, src) => [
      mkMod('EnemyCurseLimit', 'BASE', 1, src),
      mkMod('WhispersOfDoom', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^\+(\d+) to maximum (Fortification|Valour)$/i,
    build: (m, src) => [mkMod(`Max${capFirst(m[2]!)}`, 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Valour gained|Elusive Effect|Blind Effect|Light Radius|Mirage Archer Duration)$/i,
    build: (m, src) => [mkMod(m[2]!.replace(/\s+/g, ''), 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+?(\d+)% to Item Rarity$/i,
    build: (m, src) => [mkMod('LootRarity', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% increased (Rarity|Quantity) of Items found$/i,
    build: (m, src) => [mkMod(`Loot${capFirst(m[2]!)}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to gain (?:a |an )?(Power|Frenzy|Endurance|Power, Frenzy or Endurance) Charge (?:on Kill|on Critical Strike|when you Block|when you are Hit)$/i,
    build: (m, src) => [mkMod('ChargeGainChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to gain Phasing for \d+ seconds on Kill$/i,
    build: (m, src) => [mkMod('PhasingOnKillChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% chance to (?:Blind Enemies on Hit(?: with Attacks)?|Knock Enemies Back on hit|double Stun Duration)$/i,
    build: (m, src) => [mkMod('CombatUtilityChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Retaliation Skills become Usable for (\d+)% longer$/i,
    build: (m, src) => [mkMod('RetaliationUsableDuration', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Cannot take Reflected (Elemental|Physical) Damage$/i,
    build: (m, src) => [mkMod(`${capFirst(m[1]!)}ReflectImmune`, 'FLAG', true, src)],
  },
  {
    pattern: /^Enemies Hindered by you take (\d+)% increased Chaos Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('ChaosDamageTaken', 'INC', Number(m[1]), src),
        target: 'enemy' as const,
        tags: [{ type: 'Condition' as const, var: 'EnemyHindered' }],
      },
    ],
  },
  // Wave 4P: Slayer Headsman on-kill Attack/Cast/Movement Speed
  {
    pattern: /^Gain (\d+)% increased (Attack|Cast|Movement) Speed for \d+ seconds when you Kill a Rare or Unique Enemy$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const val = Number(m[1]);
      const cond = { type: 'Condition' as const, var: 'KilledRareOrUniqueRecently' };
      if (kind === 'movement') {
        return [{ ...mkMod('MovementSpeed', 'INC', val, src), tags: [cond] }];
      }
      return [
        {
          ...mkMod('Speed', 'INC', val, src, kind === 'attack' ? ModFlag.Attack : ModFlag.Spell),
          tags: [cond],
        },
      ];
    },
  },
  {
    pattern: /^Gain (\d+)% increased (Attack|Cast|Movement) Speed for \d+ seconds when you Kill an Enemy$/i,
    build: (m, src) => {
      const kind = m[2]!.toLowerCase();
      const val = Number(m[1]);
      const cond = { type: 'Condition' as const, var: 'KilledRecently' };
      if (kind === 'movement') {
        return [{ ...mkMod('MovementSpeed', 'INC', val, src), tags: [cond] }];
      }
      return [
        {
          ...mkMod('Speed', 'INC', val, src, kind === 'attack' ? ModFlag.Attack : ModFlag.Spell),
          tags: [cond],
        },
      ];
    },
  },
  // Wave 4P: Pathfinder Master Distiller flask-charge bonuses
  {
    pattern: /^If Bismuth Flask Charges are consumed, Penetrate (\d+)% Elemental Resistances$/i,
    build: (m, src) => [
      {
        ...mkMod('ElementalPenetration', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsedBismuthFlaskRecently' }],
      },
    ],
  },
  {
    pattern: /^If Amethyst Flask Charges are consumed, (\d+)% of Physical Damage as Extra Chaos Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('PhysicalDamageGainAsChaos', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsedAmethystFlaskRecently' }],
      },
    ],
  },
  {
    pattern: /^If Diamond Flask Charges are consumed, \+(\d+)% to Critical Strike Multiplier$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsedDiamondFlaskRecently' }],
      },
    ],
  },
  // Wave 4P: Dismembering (Maim on Crit with Attacks) & Badge of the Brotherhood
  {
    pattern: /^(\d+)% chance to Maim Enemies on Critical Strike with Attacks$/i,
    build: (m, src) => [mkMod('MaimChance', 'BASE', Number(m[1]), src, ModFlag.Attack)],
  },
  {
    pattern: /^Your Maximum Frenzy Charges is equal to your Maximum Power Charges$/i,
    build: (_, src) => [mkMod('MaxFrenzyEqualsMaxPower', 'FLAG', true, src)],
  },
];

/**
 * Standalone parser helper for PoE 1 extended rules (English or Chinese input).
 */
export function parsePoe1ExtraModLine(rawLine: string, source: string): Mod[] {
  const canonical = normalizeStatLineToEn(rawLine);
  if (!canonical) return [];
  for (const rule of POE1_EXTRA_MOD_RULES) {
    const match = canonical.match(rule.pattern);
    if (match) {
      return rule.build(match, source);
    }
  }
  return [];
}
