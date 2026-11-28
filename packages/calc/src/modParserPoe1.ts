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

function makeSocketedInTag(src: string): { type: 'SocketedIn'; slotName?: string } {
  const m = src.match(/^Item \(([^)]+)\)/i);
  return m?.[1] ? { type: 'SocketedIn', slotName: m[1] } : { type: 'SocketedIn' };
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
    build: (_, src) => [{ ...mkMod('DoubleDamageChance', 'BASE', 100, src), tags: [makeSocketedInTag(src)] }],
  },
  {
    pattern: /^Socketed Vaal (?:Gems|Skills) (?:deal|have) (\d+)% (more|less) Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', (m[2]!.toLowerCase() === 'less' ? -1 : 1) * Number(m[1]), src),
        tags: [makeSocketedInTag(src), { type: 'SkillType' as const, skillType: 'Vaal' }],
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
      return [{ ...mkMod(statName, 'MORE', val, src, flag), tags: [makeSocketedInTag(src)] }];
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
  // Wave 4Q/4R: Eldritch Glove Exposure-on-Hit implicits (PoB 1 ModParser.lua:4393-4395):
  // Emits <El>ExposureChance + Enemy<El>Resist gated by Condition:Enemy<El>Exposure so builds
  // without Exposure enabled in Config (e.g. Elementalist EK Ignite / Vaal Flameblast) never regress.
  {
    pattern: /^Inflict (Fire|Cold|Lightning) Exposure on Hit, applying -(\d+)% to (?:Fire|Cold|Lightning) Resistance$/i,
    build: (m, src) => {
      const el = capFirst(m[1]!);
      return [
        mkMod(`${el}ExposureChance`, 'BASE', 100, src),
        {
          ...mkMod(`Enemy${el}Resist`, 'BASE', -Number(m[2]), `${src} (Exposure)`),
          tags: [{ type: 'Condition' as const, var: `Enemy${el}Exposure` }],
        },
      ];
    },
  },
  // Wave 4Q: Vaal Skill Crit Chance (Soul Catcher / Soul Ripper)
  {
    pattern: /^(\d+)% increased Critical Strike Chance with Vaal Skills(?: during effect)?$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src),
        tags: [{ type: 'SkillType' as const, skillType: 'Vaal' }],
      },
    ],
  },
  // Wave 4Q: Unnerve on Hit, Original Sin & Ralakesh's Impatience
  {
    pattern: /^(\d+)% chance to Unnerve Enemies(?: for \d+ seconds)? on Hit$/i,
    build: (m, src) => [mkMod('UnnerveOnHitChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Cannot deal non-Chaos Damage$/i,
    build: (_, src) => [
      mkMod('DealNoPhysical', 'FLAG', true, src),
      mkMod('DealNoFire', 'FLAG', true, src),
      mkMod('DealNoCold', 'FLAG', true, src),
      mkMod('DealNoLightning', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Count as having maximum number of (Frenzy|Power|Endurance) Charges$/i,
    build: (m, src) => [mkMod(`CountAsMax${capFirst(m[1]!)}Charges`, 'FLAG', true, src)],
  },
  // Wave 4S: High-yield PoE 1 Mastery rules (wired directly into engine.ts)
  {
    pattern: /^Impale Damage dealt to Enemies Impaled by you ignores Enemy Physical Damage Reduction$/i,
    build: (_, src) => [mkMod('IgnoreEnemyImpalePhysicalDamageReduction', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% chance on Hitting an Enemy for all Impales on that Enemy to last for an additional Hit$/i,
    build: (m, src) => [mkMod('ImpaleAdditionalHitChance', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Enemies permanently take (\d+)% increased Damage for each second they've ever been (Frozen|Chilled) by you, up to a maximum of (\d+)%$/i,
    build: (m, src) => {
      const perSec = Number(m[1]);
      const maxPct = Number(m[3]);
      const varName = m[2]!.toLowerCase() === 'frozen' ? 'FrozenByYouSeconds' : 'ChilledByYouSeconds';
      return [
        {
          ...mkMod('EnemyDamageTaken', 'INC', perSec, src),
          tags: [{ type: 'Multiplier' as const, var: varName, limit: Math.floor(maxPct / Math.max(1, perSec)) }],
        },
      ];
    },
  },
  {
    pattern: /^(\d+)% chance for Hits to deal (\d+)% of Physical Damage as Extra Damage of a random Element$/i,
    build: (m, src) => {
      const total = (Number(m[1]) * Number(m[2])) / 100;
      const each = total / 3;
      return [
        mkMod('PhysicalDamageGainAsFire', 'BASE', each, src, ModFlag.Hit),
        mkMod('PhysicalDamageGainAsCold', 'BASE', each, src, ModFlag.Hit),
        mkMod('PhysicalDamageGainAsLightning', 'BASE', each, src, ModFlag.Hit),
      ];
    },
  },
  {
    pattern: /^Each Mine applies (\d+)% increased Damage taken to Enemies (?:within \d+ metres|near it), up to (\d+)%$/i,
    build: (m, src) => {
      const perMine = Number(m[1]);
      const maxPct = Number(m[2]);
      return [
        {
          ...mkMod('EnemyDamageTaken', 'INC', perMine, src),
          tags: [{ type: 'Multiplier' as const, var: 'ActiveMines', limit: Math.floor(maxPct / Math.max(1, perMine)) }],
        },
      ];
    },
  },
  {
    pattern: /^Each Mine applies (\d+)% reduced Damage dealt to Enemies (?:within \d+ metres|near it), up to (\d+)%$/i,
    build: (m, src) => {
      const perMine = Number(m[1]);
      const maxPct = Number(m[2]);
      return [
        {
          ...mkMod('EnemyDamageDealt', 'INC', -perMine, src),
          tags: [{ type: 'Multiplier' as const, var: 'ActiveMines', limit: Math.floor(maxPct / Math.max(1, perMine)) }],
        },
      ];
    },
  },
  {
    pattern: /^(?:Modifiers to )?Chance to Avoid being Shocked (?:apply|applies) to all Elemental Ailments$/i,
    build: (_, src) => [mkMod('ShockAvoidAppliesToElementalAilments', 'FLAG', true, src)],
  },
  {
    pattern: /^Melee Hits Fortify$/i,
    build: (_, src) => [mkMod('MeleeHitsFortify', 'FLAG', true, src)],
  },
  // Wave 4T: PoE 1 Bloodline Notable ModParser Rules (aligned with upstream PoB 1 ModParser.lua:3105-3176)
  // 1. The Unseen Hand & Toad's Price (Ritualist Bloodline)
  {
    pattern: /^\+1 Ring Slot$/i,
    build: (_, src) => [mkMod('AdditionalRingSlot', 'FLAG', true, src)],
  },
  {
    pattern: /^Utility Flasks are Disabled$/i,
    build: (_, src) => [
      mkMod('UtilityFlasksDoNotApplyToPlayer', 'FLAG', true, src),
      mkMod('DisableUtilityFlasks', 'FLAG', true, src),
    ],
  },
  // 2. Conjoined Spire (Abyssal Bloodline)
  {
    pattern: /^(\d+)% less Damage taken while you have a Totem$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'MORE', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'HaveTotem' }],
      },
    ],
  },
  {
    pattern: /^Skills used by Totems deal (\d+)% more Damage per maximum number of Summoned Totems$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src),
        tags: [
          { type: 'PerStat' as const, stat: 'ActiveTotemLimit', div: 1 },
          { type: 'SkillType' as const, skillType: 'Totem' },
        ],
      },
    ],
  },
  {
    pattern: /^Skills used by Totems have (\d+)% more Area of Effect per maximum number of Summoned Totems$/i,
    build: (m, src) => [
      {
        ...mkMod('AreaOfEffect', 'MORE', Number(m[1]), src),
        tags: [
          { type: 'PerStat' as const, stat: 'ActiveTotemLimit', div: 1 },
          { type: 'SkillType' as const, skillType: 'Totem' },
        ],
      },
    ],
  },
  {
    pattern: /^Totems have (\d+)% more Life per maximum number of Summoned Totems$/i,
    build: (m, src) => [
      {
        ...mkMod('TotemLife', 'MORE', Number(m[1]), src),
        tags: [{ type: 'PerStat' as const, stat: 'ActiveTotemLimit', div: 1 }],
      },
    ],
  },
  // 3. Cryogenesis
  {
    pattern: /^You gain Added (Cold|Lightning) Damage instead of Added Damage of other types if (?:Dexterity|Intelligence) exceeds both other Attributes$/i,
    build: (m, src) => [mkMod(`Cryogenesis${capFirst(m[1]!)}`, 'FLAG', true, src)],
  },
  // 4. Bitter Heresy (Profane Ground -> Malediction / Chaotic Might)
  {
    pattern: /^Create Profane Ground instead of Consecrated Ground$/i,
    build: (_, src) => [mkMod('CreateProfaneGround', 'FLAG', true, src)],
  },
  {
    pattern: /^Profane Ground you create inflicts Malediction on Enemies$/i,
    build: (_, src) => [
      mkMod('ProfaneGroundInflictsMalediction', 'FLAG', true, src),
      {
        ...mkMod('EnemyDamageTaken', 'INC', 10, src),
        tags: [{ type: 'Condition' as const, var: 'EnemyOnConsecratedGround' }],
      },
    ],
  },
  {
    pattern: /^Profane Ground you create also affects you and your Allies, granting Chaotic Might$/i,
    build: (_, src) => [
      mkMod('ProfaneGroundGrantsChaoticMight', 'FLAG', true, src),
      {
        ...mkMod('Condition:ChaoticMight', 'FLAG', true, src),
        tags: [{ type: 'Condition' as const, var: 'OnConsecratedGround' }],
      },
    ],
  },
  // 5. The Vivid Cat (Mark Effect while Elusive — consumed natively by engine.ts MarkEffect)
  {
    pattern: /^(\d+)% increased Effect of your Marks while Elusive$/i,
    build: (m, src) => [
      {
        ...mkMod('MarkEffect', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'Elusive' }],
      },
    ],
  },
  // 6. Umbral Army (per SRS / Zombie / Skeleton / Spectre / Phantasm)
  {
    pattern: /^(\d+)% increased Attack and Cast Speed per Summoned Raging Spirit$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tag = { type: 'PerStat' as const, stat: 'ActiveRagingSpiritLimit', div: 1 };
      return [
        { ...mkMod('Speed', 'INC', val, src, ModFlag.Attack), tags: [tag] },
        { ...mkMod('Speed', 'INC', val, src, ModFlag.Spell), tags: [tag] },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Attack Damage per Raised Zombie$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack),
        tags: [{ type: 'PerStat' as const, stat: 'ActiveZombieLimit', div: 1 }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Spell Damage per Summoned Skeleton$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Spell),
        tags: [{ type: 'PerStat' as const, stat: 'ActiveSkeletonLimit', div: 1 }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Defences per Raised Spectre$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tag = { type: 'PerStat' as const, stat: 'ActiveSpectreLimit', div: 1 };
      return [
        { ...mkMod('Armour', 'INC', val, src), tags: [tag] },
        { ...mkMod('Evasion', 'INC', val, src), tags: [tag] },
        { ...mkMod('EnergyShield', 'INC', val, src), tags: [tag] },
        { ...mkMod('Ward', 'INC', val, src), tags: [tag] },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Movement Speed per Summoned Phantasm$/i,
    build: (m, src) => [
      {
        ...mkMod('MovementSpeed', 'INC', Number(m[1]), src),
        tags: [{ type: 'PerStat' as const, stat: 'ActivePhantasmLimit', div: 1 }],
      },
    ],
  },
  // 7. Cannibalised Faith & Oshabi Life-Cost Added Damage
  {
    pattern: /^Spells you cast yourself gain Added Physical Damage equal to (\d+)% of Life Cost, if Life Cost is not higher than the maximum you could spend$/i,
    build: (m, src) => [mkMod('AddedPhysicalDamageFromLifeCostPct', 'BASE', Number(m[1]), src, ModFlag.Spell)],
  },
  {
    pattern: /^Skills gain Added Chaos Damage equal to (\d+)% of Life Cost, if Life Cost is not higher than the maximum you could spend$/i,
    build: (m, src) => [mkMod('AddedChaosDamageFromLifeCostPct', 'BASE', Number(m[1]), src)],
  },
  // 8. Enhanced Starlight & small Ward Bloodline nodes
  {
    pattern: /^(\d+)% increased Ward from Equipped Armour Items$/i,
    build: (m, src) => [mkMod('Ward', 'INC', Number(m[1]), src)],
  },
  // 9. Ghastly Gaze of the Lich
  {
    pattern: /^Unholy Might you grant also causes target's Damage to Penetrate (\d+)% Chaos Resistance$/i,
    build: (m, src) => [
      {
        ...mkMod('UnholyMightAlsoChaosPenetration', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'MultiplierThreshold:GhastlyEyeJewel:3' }],
      },
    ],
  },
  {
    pattern: /^Unholy Might you grant also applies (\d+)% increased Effect of Withered$/i,
    build: (m, src) => [
      {
        ...mkMod('UnholyMightAlsoWitherEffect', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'MultiplierThreshold:GhastlyEyeJewel:3' }],
      },
    ],
  },
  // 10. The King's Might
  {
    pattern: /^(Grace|Hatred) has (\d+)% increased Aura Effect while at (Minimum|Maximum) Frenzy Charges$/i,
    build: (m, src) => [
      {
        ...mkMod(`AuraEffect:${capFirst(m[1]!)}`, 'INC', Number(m[2]), src),
        tags: [
          {
            type: 'Condition' as const,
            var: m[3]!.toLowerCase() === 'minimum' ? 'AtMinimumFrenzyCharges' : 'AtMaximumFrenzyCharges',
          },
        ],
      },
    ],
  },
  // 11. The Primal Owl & Unleash Seal Gain Frequency
  {
    pattern: /^Unsealed Spells gain (\d+)% more Damage each time their effects Reoccur$/i,
    build: (m, src) => [mkMod('MaxSealDamage', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^Skills Supported by Unleash have (\d+)% increased Seal gain frequency$/i,
    build: (m, src) => [mkMod('UnleashSealGainFrequency', 'INC', Number(m[1]), src)],
  },
  // 12. Precursor's Release (Aul Bloodline)
  {
    pattern: /^Action Speed cannot be modified to below Base Value if you have Equipped Boots with no Socketed Gems$/i,
    build: (_, src) => [mkMod('PrecursorBootsActionSpeed', 'FLAG', true, src)],
  },
  {
    pattern: /^Cannot be Stunned if you have an Equipped Helmet with no Socketed Gems$/i,
    build: (_, src) => [mkMod('PrecursorHelmetStunImmune', 'FLAG', true, src)],
  },
  {
    pattern: /^Elemental Ailments cannot be inflicted on you if you have an Equipped Body Armour with no Socketed Gems$/i,
    build: (_, src) => [mkMod('PrecursorBodyAilmentImmune', 'FLAG', true, src)],
  },
  {
    pattern: /^Take no Extra Damage from Critical Strikes if you have Equipped Gloves with no Socketed Gems$/i,
    build: (_, src) => [mkMod('PrecursorGlovesNoExtraCrit', 'FLAG', true, src)],
  },
  // 13. Corruption's Embrace
  {
    pattern: /^You have (Shepherd of Souls|Everlasting Sacrifice|Sacrifice of Blood) if at least (\d+) Corrupted Items are Equipped$/i,
    build: (m, src) => [
      {
        ...mkMod(`CorruptionsEmbrace:${m[1]!.replace(/\s+/g, '')}`, 'FLAG', true, src),
        tags: [{ type: 'Condition' as const, var: `MultiplierThreshold:CorruptedItem:${Number(m[2])}` }],
      },
    ],
  },
  // 14. Boon of the Mountain & Foul Pact
  {
    pattern: /^(\d+)% less Damage Taken from Damage over Time while you have Unbroken Ward$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTakenOverTime', 'MORE', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UnbrokenWard' }],
      },
    ],
  },
  {
    pattern: /^Enemies Pacified by you take (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemyPacified' }],
      },
    ],
  },
  // Wave 4U: Gladiator Determined Survivor, War of Attrition & Weapon Master
  {
    pattern: /^Gain (\d+)% Chance to Block from Equipped Shield instead of the Shield's value$/i,
    build: (m, src) => [mkMod('ShieldBlockOverride', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Inherent Bonuses from Dual Wielding are doubled$/i,
    build: (_, src) => [mkMod('DualWieldBonusesDoubled', 'FLAG', true, src)],
  },
  {
    pattern: /^Deal (\d+)% more Damage with Hits and Ailments to Rare and Unique Enemies for each second they've ever been in your Presence, up to a maximum of (\d+)%$/i,
    build: (m, src) => {
      const perSec = Number(m[1]);
      const maxPct = Number(m[2]);
      const tags = [
        { type: 'Condition' as const, var: 'EnemyRareOrUnique' },
        { type: 'Multiplier' as const, var: 'PresenceSeconds', limit: Math.floor(maxPct / Math.max(1, perSec)) },
      ];
      return [
        { ...mkMod('Damage', 'MORE', perSec, src, ModFlag.Hit), tags },
        { ...mkMod('Damage', 'MORE', perSec, src, ModFlag.Ailment), tags },
      ];
    },
  },
  {
    pattern: /^(\d+)% more Damage with Hits and Ailments against Enemies that are on Low Life while you are wielding an Axe$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tags = [
        { type: 'Condition' as const, var: 'EnemyLowLife' },
        { type: 'Condition' as const, var: 'UsingAxe' },
      ];
      return [
        { ...mkMod('Damage', 'MORE', val, src, ModFlag.Hit), tags },
        { ...mkMod('Damage', 'MORE', val, src, ModFlag.Ailment), tags },
      ];
    },
  },
  {
    pattern: /^(\d+)% more Accuracy Rating while wielding a Sword$/i,
    build: (m, src) => [
      {
        ...mkMod('Accuracy', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsingSword' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% more Area of Effect while wielding a Mace or Sceptre$/i,
    build: (m, src) => [
      {
        ...mkMod('AreaOfEffect', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsingMace' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% more Critical Strike Chance while wielding a Dagger$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsingDagger' }],
      },
    ],
  },
  // Wave 4V: Elementalist Shaper of Storms (ShockMinimum wired natively in engine.ts:5728)
  {
    pattern: /^Shocks from your Hits always increase Damage taken by at least (\d+)%$/i,
    build: (m, src) => [mkMod('ShockMinimum', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Hits always Shock$/i,
    build: (_, src) => [mkMod('ShockChance', 'BASE', 100, src)],
  },
  {
    pattern: /^(\d+)% increased Area of Effect while you don't have Convergence$/i,
    build: (m, src) => [
      {
        ...mkMod('AreaOfEffect', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'Convergence', neg: true }],
      },
    ],
  },
  {
    pattern: /^Nearby Hindered Enemies deal (\d+)% reduced Damage over Time$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageDealtOverTime', 'INC', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemyHindered' }],
      },
    ],
  },
  // Wave 4W: High-leverage PoE 1 Onslaught, Intimidate, Saboteur/Occultist/Warden Bloodline notables
  {
    pattern: /^(\d+)% increased Onslaught Effect$/i,
    build: (m, src) => [mkMod('OnslaughtEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Nearby Enemies are Intimidated$/i,
    build: (_, src) => [
      {
        ...mkMod('EnemyDamageTaken', 'INC', 10, src, ModFlag.Attack),
        tags: [{ type: 'Condition' as const, var: 'EnemyIntimidated', neg: true }],
      },
    ],
  },
  {
    pattern: /^(?:\d+% chance to )?gain Onslaught for \d+ seconds on Kill$/i,
    build: (_, src) => {
      const tags = [
        { type: 'Condition' as const, var: 'KilledRecently' },
        { type: 'Condition' as const, var: 'Onslaught', neg: true },
      ];
      return [
        { ...mkMod('Speed', 'INC', 20, src, ModFlag.Attack | ModFlag.Spell), tags },
        { ...mkMod('MovementSpeed', 'INC', 20, src), tags },
      ];
    },
  },
  {
    pattern: /^Hits have (\d+)% chance to deal (\d+)% more Area Damage$/i,
    build: (m, src) => [
      mkMod('Damage', 'MORE', (Number(m[1]) * Number(m[2])) / 100, src, ModFlag.Hit | ModFlag.Area),
    ],
  },
  {
    pattern: /^(\d+)% less Damage with Triggered Spells$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', -Number(m[1]), src, ModFlag.Spell),
        tags: [{ type: 'SkillType' as const, skillType: 'Triggered' }],
      },
    ],
  },
  {
    pattern: /^Nearby Chilled Enemies deal (\d+)% reduced Damage with Hits$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageDealt', 'INC', -Number(m[1]), src, ModFlag.Hit),
        tags: [{ type: 'Condition' as const, var: 'EnemyChilled' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% reduced Damage taken from Blinded Enemies$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'INC', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemyBlinded' }],
      },
    ],
  },
  {
    pattern: /^Defences from Equipped Body Armour are doubled if it has no Socketed Gems$/i,
    build: (_, src) => [mkMod('OathOfTheMajiBodyArmour', 'FLAG', true, src)],
  },
  {
    pattern: /^Tinctures applied to you have (\d+)% increased Effect per empty Flask Slot$/i,
    build: (m, src) => [
      {
        ...mkMod('TinctureEffect', 'INC', Number(m[1]), src),
        tags: [{ type: 'Multiplier' as const, var: 'EmptyFlaskSlot' }],
      },
    ],
  },
  // Wave 4X: Vaal Skills (Yaomac's Accord / Soul Catcher), Roiling Tempest, Luminary, Critical Ailment DoT Multi
  {
    pattern: /^(\d+)% increased Damage with Vaal Skills(?: during effect)?$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src),
        tags: [{ type: 'SkillType' as const, skillType: 'Vaal' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Critical Strike Chance with Vaal Skills(?: during effect)?$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src),
        tags: [{ type: 'SkillType' as const, skillType: 'Vaal' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased (Attack and Cast |Attack |Cast )?Speed with Vaal Skills(?: during effect)?$/i,
    build: (m, src) => {
      const scope = (m[2] ?? '').trim().toLowerCase();
      const flags =
        scope === 'attack'
          ? ModFlag.Attack
          : scope === 'cast'
            ? ModFlag.Spell
            : ModFlag.Attack | ModFlag.Spell;
      return [
        {
          ...mkMod('Speed', 'INC', Number(m[1]), src, flags),
          tags: [{ type: 'SkillType' as const, skillType: 'Vaal' }],
        },
      ];
    },
  },
  {
    pattern: /^Cannot deal non-(Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
    build: (m, src) => {
      const keep = capFirst(m[1]!);
      return (['Physical', 'Fire', 'Cold', 'Lightning', 'Chaos'] as const)
        .filter((dt) => dt !== keep)
        .map((dt) => mkMod(`DealNo${dt}`, 'FLAG', true, src));
    },
  },
  {
    pattern: /^Your Mercenary has (\d+)% increased effect of Non-Curse Auras from Skills$/i,
    build: (m, src) => [mkMod('MercenaryAuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Your Mercenary and their Minions deal (\d+)% increased Damage$/i,
    build: (m, src) => [mkMod('MercenaryDamage', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^\+(\d+)% to Damage over Time Multiplier for Ailments from Critical Strikes$/i,
    build: (m, src) => [
      {
        ...mkMod('DotMultiplier', 'BASE', Number(m[1]), src, ModFlag.Dot, KeywordFlag.Ailment),
        tags: [{ type: 'Condition' as const, var: 'Crit' }],
      },
    ],
  },
  // Wave 4Y: Bloodline (Catarina/Farrul), Necromancer Plaguebringer, Assassin Opportunistic, Armour/Evasion 4-slot Masteries
  {
    pattern: /^Minions deal (\d+)% more Damage while they are on Low Life$/i,
    build: (m, src) => [
      {
        ...mkMod('MinionDamage', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'MinionLowLife' }],
      },
    ],
  },
  {
    pattern: /^Minions deal (\d+)% increased Damage if you have Warcried Recently$/i,
    build: (m, src) => [
      {
        ...mkMod('MinionDamage', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'UsedWarcryRecently' }],
      },
    ],
  },
  {
    pattern: /^Maximum number of Raised Spectres is (\d+)$/i,
    build: (m, src) => [mkMod('ActiveSpectreLimit', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^With at least one corpse within \d+ metres, Enemies within \d+ metres deal (\d+)% reduced Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageDealt', 'INC', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'NearbyCorpse' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% less Damage taken while there are at least two Rare or Unique Enemies within \d+ metres$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'MORE', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'TwoRareOrUniqueNearby' }],
      },
    ],
  },
  {
    pattern: /^\+(\d+)% to all maximum Elemental Resistances if Equipped Helmet, Body Armour, Gloves, and Boots all have Armour$/i,
    build: (m, src) => {
      const val = Number(m[1]);
      const tags = [{ type: 'Condition' as const, var: 'AllFourArmourSlotsHaveArmour' }];
      return [
        { ...mkMod('FireResistMax', 'BASE', val, src), tags },
        { ...mkMod('ColdResistMax', 'BASE', val, src), tags },
        { ...mkMod('LightningResistMax', 'BASE', val, src), tags },
      ];
    },
  },
  {
    pattern: /^\+(\d+)% chance to Suppress Spell Damage if Equipped Helmet, Body Armour, Gloves, and Boots all have Evasion Rating$/i,
    build: (m, src) => [
      {
        ...mkMod('SpellSuppressionChance', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'AllFourArmourSlotsHaveEvasion' }],
      },
    ],
  },
  // Wave 5A: Cinderswallow Urn, Doppelganger Guise (Sane/Insane), Per-Aura/Curse Effect, Wilma's Requital, Sandstorm Visage, Coruscating Elixir
  {
    pattern: /^Enemies Ignited by you(?: during Effect)? take (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemyIgnited' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% less Physical and Chaos Damage taken while Sane$/i,
    build: (m, src) => {
      const val = -Number(m[1]);
      const tags = [{ type: 'Condition' as const, var: 'Sane' }];
      return [
        { ...mkMod('PhysicalDamageTaken', 'MORE', val, src), tags },
        { ...mkMod('ChaosDamageTaken', 'MORE', val, src), tags },
      ];
    },
  },
  {
    pattern: /^(\d+)% increased Attack and Cast Speed while Insane$/i,
    build: (m, src) => [
      {
        ...mkMod('Speed', 'INC', Number(m[1]), src, ModFlag.Attack | ModFlag.Spell),
        tags: [{ type: 'Condition' as const, var: 'Insane' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% more Damage while Insane$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'Insane' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Damage taken while Insane$/i,
    build: (m, src) => [
      {
        ...mkMod('DamageTaken', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'Insane' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% more Critical Strike Chance while Insane$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'MORE', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'Insane' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased ([A-Z][a-zA-Z' ]+?) (Curse|Mark) Effect$/,
    build: (m, src) => [
      mkMod(`${m[3] === 'Mark' ? 'MarkEffect' : 'CurseEffect'}:${m[2]!.trim()}`, 'INC', Number(m[1]), src),
    ],
  },
  {
    pattern: /^(\d+)% increased (Arctic Armour|Tempest Shield|Molten Shell|Steelskin|Immortal Call|Blood Rage|Righteous Fire) Buff Effect$/i,
    build: (m, src) => [mkMod(`BuffEffect:${m[2]!.trim()}`, 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^(\d+)% more Minion Life$/i,
    build: (m, src) => [mkMod('MinionLife', 'MORE', Number(m[1]), src)],
  },
  {
    pattern: /^Increases and Reductions to Cast Speed apply to Attack Speed$/i,
    build: (_, src) => [mkMod('CastSpeedAppliesToAttackSpeed', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% increased Armour from Equipped Helmet and Gloves$/i,
    build: (m, src) => [mkMod('ArmourFromHelmetAndGloves', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Cannot deal Critical Strikes with Attacks$/i,
    build: (_, src) => [mkMod('NeverCrit', 'FLAG', true, src, ModFlag.Attack)],
  },
  {
    pattern: /^Chaos Damage taken does not bypass Energy Shield(?: during effect)?$/i,
    build: (_, src) => [mkMod('ChaosDamageDoesNotBypassES', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% of Non-Chaos Damage taken bypasses Energy Shield$/i,
    build: (m, src) => [mkMod('NonChaosDamageBypassesES', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^You cannot have more than (\d+) Summoned Totems of the same type$/i,
    build: (m, src) => [mkMod('ActiveTotemLimit', 'MAX', Number(m[1]), src)],
  },
  // Wave 5B: Pathfinder Master Distiller (upstream PoB1 ModParser.lua:3017-3028)
  {
    pattern: /^If Diamond Flask Charges are consumed, (\d+)% increased Critical Strike Chance$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src),
        tags: [
          { type: 'SkillType' as const, skillType: 'Triggered', neg: true },
          { type: 'SkillType' as const, skillType: 'Channel', neg: true },
          { type: 'Condition' as const, var: 'HaveDiamondFlask' },
        ],
      },
    ],
  },
  {
    pattern: /^If Diamond Flask Charges are consumed, \+(\d+)% to Critical Strike Multiplier$/i,
    build: (m, src) => [
      {
        ...mkMod('CritMultiplier', 'BASE', Number(m[1]), src),
        tags: [
          { type: 'SkillType' as const, skillType: 'Triggered', neg: true },
          { type: 'SkillType' as const, skillType: 'Channel', neg: true },
          { type: 'Condition' as const, var: 'HaveDiamondFlask' },
        ],
      },
    ],
  },
  {
    pattern: /^If Bismuth Flask Charges are consumed, Penetrate (\d+)% Elemental Resistances$/i,
    build: (m, src) => [
      {
        ...mkMod('ElementalPenetration', 'BASE', Number(m[1]), src),
        tags: [
          { type: 'SkillType' as const, skillType: 'Triggered', neg: true },
          { type: 'SkillType' as const, skillType: 'Channel', neg: true },
          { type: 'Condition' as const, var: 'HaveBismuthFlask' },
        ],
      },
    ],
  },
  {
    pattern: /^If Amethyst Flask Charges are consumed, (\d+)% of Physical Damage as Extra Chaos Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('PhysicalDamageGainAsChaos', 'BASE', Number(m[1]), src),
        tags: [
          { type: 'SkillType' as const, skillType: 'Triggered', neg: true },
          { type: 'SkillType' as const, skillType: 'Channel', neg: true },
          { type: 'Condition' as const, var: 'HaveAmethystFlask' },
        ],
      },
    ],
  },
  // Wave 5C: Saboteur Demolitions Specialist (MineAuraEffect — avoids polluting global AuraEffect!), Calculated Risk (DamageIsUnlucky), Pyromaniac, Eternal Struggle
  {
    pattern: /^(\d+)% increased Effect of Auras from Mines$/i,
    build: (m, src) => [mkMod('MineAuraEffect', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Damage with Hits is Unlucky$/i,
    build: (_, src) => [mkMod('DamageIsUnlucky', 'FLAG', true, src, ModFlag.Hit)],
  },
  {
    pattern: /^Regenerate (\d+(?:\.\d+)?)% of Life per [Ss]econd for each (Mine Detonated|Trap Triggered) Recently, up to (\d+(?:\.\d+)?)% per second$/i,
    build: (m, src) => [
      {
        ...mkMod('LifeRegenPercent', 'BASE', Number(m[1]), src),
        tags: [
          {
            type: 'Multiplier' as const,
            var: /mine/i.test(m[2]!) ? 'MinesDetonatedRecently' : 'TrapsTriggeredRecently',
            limit: Math.round(Number(m[3]) / Math.max(0.01, Number(m[1]))),
          },
        ],
      },
    ],
  },
  {
    pattern: /^Kill Enemies that have (\d+)% or lower Life on Hit if The Searing Exarch is dominant$/i,
    build: (m, src) => [
      {
        ...mkMod('CullPercent', 'MAX', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'SearingExarchDominant' }],
      },
    ],
  },
  // Wave 5D: Mine/Warcry/Impale/Minion/Spider high-frequency PoE 1 rules
  {
    pattern: /^(\d+)% increased Critical Strike Chance for each Mine Detonated(?: Recently, up to (\d+)%)?$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      const lim = m[2] ? Math.round(Number(m[2]) / Math.max(1, v)) : 10;
      return [
        {
          ...mkMod('CritChance', 'INC', v, src),
          tags: [{ type: 'Multiplier' as const, var: 'MinesDetonatedRecently', limit: lim }],
        },
      ];
    },
  },
  {
    pattern: /^\+(\d+)% to Critical Strike Multiplier for each Mine Detonated(?: Recently, up to (\d+)%)?$/i,
    build: (m, src) => {
      const v = Number(m[1]);
      const lim = m[2] ? Math.round(Number(m[2]) / Math.max(1, v)) : 10;
      return [
        {
          ...mkMod('CritMultiplier', 'BASE', v, src),
          tags: [{ type: 'Multiplier' as const, var: 'MinesDetonatedRecently', limit: lim }],
        },
      ];
    },
  },
  {
    pattern: /^Warcries Exert (\d+) additional Attacks?$/i,
    build: (m, src) => [mkMod('WarcryExertCount', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Warcries Exert twice as many Attacks$/i,
    build: (_, src) => [mkMod('WarcryExertCount', 'MORE', 100, src)],
  },
  {
    pattern: /^Enemies Taunted by your Warcries take (\d+)% increased Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemyTaunted' }],
      },
    ],
  },
  {
    pattern: /^Skills used by Mines deal (\d+)% increased Area Damage if you Detonated a Mine Recently$/i,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Area, KeywordFlag.Mine),
        tags: [{ type: 'Condition' as const, var: 'DetonatedMineRecently' }],
      },
    ],
  },
  {
    pattern: /^Skills used by Mines have (\d+)% increased Area of Effect if you Detonated a Mine Recently$/i,
    build: (m, src) => [
      {
        ...mkMod('AreaOfEffect', 'INC', Number(m[1]), src, 0, KeywordFlag.Mine),
        tags: [{ type: 'Condition' as const, var: 'DetonatedMineRecently' }],
      },
    ],
  },
  {
    pattern: /^Attacks Exerted by [A-Z][a-zA-Z' ]+ deal (\d+)% increased Damage$/,
    build: (m, src) => [
      {
        ...mkMod('Damage', 'INC', Number(m[1]), src, ModFlag.Attack),
        tags: [{ type: 'Condition' as const, var: 'ExertedAttack' }],
      },
    ],
  },
  {
    pattern: /^(\d+)% increased Spell Critical Strike Chance per Raised Spectre$/i,
    build: (m, src) => [
      {
        ...mkMod('CritChance', 'INC', Number(m[1]), src, ModFlag.Spell),
        tags: [{ type: 'Multiplier' as const, var: 'RaisedSpectreCount' }],
      },
    ],
  },
  {
    pattern: /^Critical Strikes with Spells inflict Impale$/i,
    build: (_, src) => [mkMod('SpellCritInflictsImpale', 'FLAG', true, src, ModFlag.Spell)],
  },
  {
    pattern: /^Increases and Reductions to Minion Damage also affect you at (\d+)% of their value$/i,
    build: (m, src) => [
      mkMod('MinionDamageAppliesToPlayer', 'FLAG', true, src),
      mkMod('MinionDamageAppliesToPlayerPct', 'BASE', Number(m[1]), src),
    ],
  },
  {
    pattern: /^Enemies affected by your Spider's Webs deal (\d+)% reduced Damage$/i,
    build: (m, src) => [
      {
        ...mkMod('EnemyDamageDealt', 'INC', -Number(m[1]), src),
        tags: [{ type: 'Condition' as const, var: 'EnemySpiderWeb' }],
      },
    ],
  },
  {
    pattern: /^Enemies affected by your Spider's Webs have -(\d+)% to All Resistances$/i,
    build: (m, src) => {
      const val = -Number(m[1]);
      const tags = [{ type: 'Condition' as const, var: 'EnemySpiderWeb' }];
      return (['Fire', 'Cold', 'Lightning', 'Chaos'] as const).map((el) => ({
        ...mkMod(`${el}Resist`, 'BASE', val, src),
        target: 'enemy' as const,
        tags,
      }));
    },
  },
  // Wave 5F: Circle of Anguish/Guilt/Fear/Nostalgia/Regret Herald Buff Effect, Stampede, Nimis, Redblade/Sione, Azadi Crest
  {
    pattern: /^(Herald of (?:Ash|Ice|Thunder|Purity|Agony)) has (\d+)% increased Buff Effect$/i,
    build: (m, src) => [mkMod(`HeraldBuffEffect:${m[1]!.trim()}`, 'INC', Number(m[2]), src)],
  },
  {
    pattern: /^Your Movement Speed is (\d+)% of its base value$/i,
    build: (m, src) => [mkMod('MovementSpeed', 'OVERRIDE', Number(m[1]), src)],
  },
  {
    pattern: /^Projectiles Return to you$/i,
    build: (_, src) => [mkMod('ProjectilesReturn', 'FLAG', true, src, ModFlag.Projectile)],
  },
  {
    pattern: /^Warcries have infinite Power$/i,
    build: (_, src) => [mkMod('WarcryInfinitePower', 'FLAG', true, src)],
  },
  {
    pattern: /^Focus has (\d+)% increased Cooldown Recovery Rate$/i,
    build: (m, src) => [mkMod('CooldownRecovery:Focus', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Your Lucky or Unlucky effects use the best or worst from three rolls instead of two$/i,
    build: (_, src) => [mkMod('LuckyUsesThreeRolls', 'FLAG', true, src)],
  },
  // Wave 6A: PoE 1 3.27/3.28 Graft local-skill isolation & Foulborn unique modifiers
  {
    // Prevent "Skills used by this Graft have X% increased Cooldown Recovery Rate / Skill Effect Duration"
    // from falling through to compositionalModParser and polluting global player CooldownRecovery/Duration.
    pattern: /^Skills used by this Graft\b/i,
    build: (_, src) => [mkMod('GraftSkillLocalMod', 'FLAG', true, src)],
  },
  {
    pattern: /^Your Damage with Hits is Lucky while on Low Life$/i,
    build: (_, src) => [
      {
        ...mkMod('DamageIsLucky', 'FLAG', true, src, ModFlag.Hit),
        tags: [{ type: 'Condition' as const, var: 'LowLife' }],
      },
    ],
  },
  {
    pattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage for each Shocked Enemy you've Killed Recently$/i,
    build: (m, src) => {
      const elem = capFirst(m[3]!);
      const tags = [{ type: 'Multiplier' as const, var: 'ShockedEnemiesKilledRecently' }];
      return [
        { ...mkMod(`${elem}Min`, 'BASE', Number(m[1]), src), tags },
        { ...mkMod(`${elem}Max`, 'BASE', Number(m[2]), src), tags },
      ];
    },
  },
  {
    pattern: /^Minions have \+(\d+)% to Critical Strike Multiplier per Withered Debuff on Enemy$/i,
    build: (m, src) => [
      {
        ...mkMod('MinionCritMultiplier', 'BASE', Number(m[1]), src),
        tags: [{ type: 'Multiplier' as const, var: 'WitheredStack' }],
      },
    ],
  },
  {
    pattern: /^Take no Extra Damage from Critical Strikes$/i,
    build: (_, src) => [mkMod('CritExtraDamageTaken', 'MORE', -100, src)],
  },
  {
    pattern: /^Gain no inherent bonuses from Strength$/i,
    build: (_, src) => [mkMod('NoStrengthBonus', 'FLAG', true, src)],
  },
  {
    pattern: /^Cannot Block Attack Damage$/i,
    build: (_, src) => [mkMod('CannotBlockAttacks', 'FLAG', true, src)],
  },
  {
    pattern: /^Maximum Energy Shield is increased by Chaos Resistance$/i,
    build: (_, src) => [mkMod('EsIncreasedByChaosRes', 'FLAG', true, src)],
  },
  {
    pattern: /^(\d+)% chance to gain Unholy Might for \d+ seconds on Kill$/i,
    build: (_, src) => [
      {
        ...mkMod('UnholyMight', 'FLAG', true, src),
        tags: [{ type: 'Condition' as const, var: 'KilledRecently' }],
      },
    ],
  },
  {
    pattern: /^Increases and Reductions to Spell Damage also apply to Attack Damage with Retaliation Skills at (\d+)% of their value$/i,
    build: (m, src) => [mkMod('SpellDamageAppliesToRetaliationPct', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Cover Enemies in Ash when they Hit you$/i,
    build: (_, src) => [mkMod('EnemyCoveredInAshOnHitYou', 'FLAG', true, src)],
  },
  // Wave 6B: Svalinn Block Lucky, ES Overleech, Buff Effect & Per-Skill Mana Reservation Efficiency
  {
    pattern: /^Chance to Block is Lucky$/i,
    build: (_, src) => [
      mkMod('BlockChanceIsLucky', 'FLAG', true, src),
      mkMod('SpellBlockChanceIsLucky', 'FLAG', true, src),
    ],
  },
  {
    pattern: /^Energy Shield Leech Effects from Attacks are not removed at Full Energy Shield$/i,
    build: (_, src) => [mkMod('EsOverleech', 'FLAG', true, src)],
  },
  {
    pattern: /^Maximum Recovery per Energy Shield Leech is Doubled$/i,
    build: (_, src) => [mkMod('EsLeechMaxRecovery', 'MORE', 100, src)],
  },
  {
    pattern: /^(Arctic Armour|Tempest Shield|Molten Shell|Steelskin|Immortal Call|Blood Rage|Righteous Fire) has (\d+)% increased Buff Effect$/i,
    build: (m, src) => [mkMod(`BuffEffect:${m[1]!.trim()}`, 'INC', Number(m[2]), src)],
  },
  {
    pattern: /^([A-Z][a-zA-Z' ]+?) has (\d+)% increased Mana Reservation Efficiency$/,
    build: (m, src) => [mkMod(`ManaReservationEfficiency:${m[1]!.trim()}`, 'INC', Number(m[2]), src)],
  },
  // Wave 6C: Block Unlucky, DoT Taken, Whispers of Infinity, Warcry/Echoes, Alchemist's Mark, Ailment Can-Inflict & Luminary Mercenary
  {
    pattern: /^Chance to Block (Attack |Spell )?Damage is Unlucky$/i,
    build: (m, src) => {
      const scope = (m[1] ?? '').trim().toLowerCase();
      if (scope === 'attack') return [mkMod('BlockChanceIsUnlucky', 'FLAG', true, src)];
      if (scope === 'spell') return [mkMod('SpellBlockChanceIsUnlucky', 'FLAG', true, src)];
      return [
        mkMod('BlockChanceIsUnlucky', 'FLAG', true, src),
        mkMod('SpellBlockChanceIsUnlucky', 'FLAG', true, src),
      ];
    },
  },
  {
    pattern: /^(\d+)% (increased|reduced) (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage taken over time$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]);
      const elem = m[3]![0]!.toUpperCase() + m[3]!.slice(1).toLowerCase();
      return [mkMod(`${elem}DamageTakenOverTime`, 'INC', val, src)];
    },
  },
  {
    pattern: /^Skills Cost Energy Shield instead of Mana(?: or Life)?$/i,
    build: (_, src) => [mkMod('SkillsCostEnergyShield', 'FLAG', true, src)],
  },
  {
    pattern: /^Warcries have (\d+)% (increased|reduced) Cooldown Recovery Rate$/i,
    build: (m, src) => {
      const val = m[2]!.toLowerCase() === 'reduced' ? -Number(m[1]) : Number(m[1]);
      return [
        {
          ...mkMod('CooldownRecovery', 'INC', val, src),
          tags: [{ type: 'SkillType' as const, skillType: 'Warcry' }],
        },
      ];
    },
  },
  {
    pattern: /^Warcries cannot Exert Travel Skills$/i,
    build: (_, src) => [mkMod('WarcriesCannotExertTravelSkills', 'FLAG', true, src)],
  },
  {
    pattern: /^When you Attack, take (\d+)% of Life as Physical Damage for each Warcry Exerting the Attack$/i,
    build: (m, src) => [mkMod('EchoesSelfDamagePerExert', 'BASE', Number(m[1]), src)],
  },
  {
    pattern: /^Marked Enemy takes (\d+)% increased Damage from (Poison|Bleeding|Ignite|Ailments)$/i,
    build: (m, src) => {
      const kwMap: Record<string, number> = {
        poison: KeywordFlag.Poison,
        bleeding: KeywordFlag.Bleed,
        ignite: KeywordFlag.Ignite,
        ailments: 0,
      };
      const kw = kwMap[m[2]!.toLowerCase()] ?? 0;
      return [
        {
          ...mkMod('EnemyDamageTaken', 'INC', Number(m[1]), src, ModFlag.Ailment | ModFlag.Dot, kw),
          target: 'enemy' as const,
        },
      ];
    },
  },
  {
    pattern: /^All Damage with Hits can (Chill|Freeze|Shock|Ignite|Poison|Bleed)$/i,
    build: (m, src) => {
      const kind = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
      return [mkMod(`AllDamageCan${kind}`, 'FLAG', true, src)];
    },
  },
  {
    pattern: /^All Damage from Critical Strikes can apply (Lightning|Cold|Fire|Elemental) Ailments(?: during effect)?$/i,
    build: (m, src) => {
      const elem = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
      return [mkMod(`CritDamageCanApply${elem}Ailments`, 'FLAG', true, src)];
    },
  },
  {
    pattern: /^Your Mercenary and their Minions have (\d+)% increased maximum Life$/i,
    build: (m, src) => [mkMod('MercenaryLife', 'INC', Number(m[1]), src)],
  },
  {
    pattern: /^Your Mercenary and their Minions deal (\d+)% more Damage for each Unique item they have equipped$/i,
    build: (m, src) => [mkMod('MercenaryDamagePerUnique', 'BASE', Number(m[1]), src)],
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
