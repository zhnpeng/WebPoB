import { KeywordFlag, ModFlag, type GameId, type GemDefinition } from '@webpob/core';

export const POE1_GEMS: GemDefinition[] = [
  // Active Spells (Synced from official PoB 3.30 Lv.20 values)
  {
    id: 'poe1_arc',
    name: { en: 'Arc', zh: '电弧' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Lightning', 'Chaining'],
    modFlags: ModFlag.Spell | ModFlag.Hit,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Lightning | KeywordFlag.Hit,
    baseDamage: { Lightning: [198, 1122] },
    damageEffectivenessPct: 120,
    castTime: 0.6,
    baseCritChance: 6,
    manaCost: 29,
    // Remaining chains (4 + floor((lv-1)/5) + trunc(quality * 0.05)) * 15% more Damage are evaluated dynamically in engine.ts
    stats: [],
    qualityStats: [],
  },
  {
    id: 'poe1_fireball',
    name: { en: 'Fireball', zh: '火球' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Fire', 'Projectile', 'Area'],
    modFlags: ModFlag.Spell | ModFlag.Hit | ModFlag.Projectile | ModFlag.Area,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Fire | KeywordFlag.Hit | KeywordFlag.Ignite,
    baseDamage: { Fire: [1883, 2825] },
    damageEffectivenessPct: 480,
    castTime: 0.75,
    baseCritChance: 5,
    manaCost: 20,
    stats: [],
    qualityStats: [],
  },
  {
    id: 'poe1_ice_nova',
    name: { en: 'Ice Nova of Frostbolts', zh: '冰霜新星（寒冰弹）' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Cold', 'Area'],
    modFlags: ModFlag.Spell | ModFlag.Hit | ModFlag.Area,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Cold | KeywordFlag.Hit,
    baseDamage: { Cold: [590, 885] },
    damageEffectivenessPct: 130,
    castTime: 0.7,
    baseCritChance: 7.5,
    manaCost: 23,
    stats: [],
    qualityStats: [],
  },
  // Active Attacks (Synced from official PoB 3.30 Lv.20 values)
  {
    id: 'poe1_lightning_arrow',
    name: { en: 'Lightning Arrow', zh: '闪电箭矢' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Attack', 'Projectile', 'Lightning', 'Bow'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Projectile | ModFlag.Bow,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Lightning | KeywordFlag.Hit,
    attackDamageMultiplierPct: 177.1,
    damageEffectivenessPct: 177.1,
    attackSpeedMultiplier: 1.0,
    manaCost: 10,
    stats: ['50% of Physical Damage Converted to Lightning Damage'],
    qualityStats: [],
  },
  {
    id: 'poe1_cyclone',
    name: { en: 'Cyclone', zh: '旋风斩' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Attack', 'Melee', 'Area', 'Physical', 'Channelling'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Melee | ModFlag.Area,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Physical | KeywordFlag.Hit,
    attackDamageMultiplierPct: 150,
    damageEffectivenessPct: 150,
    attackSpeedMultiplier: 3.0,
    manaCost: 3,
    stats: [],
    qualityStats: [],
  },
  {
    id: 'poe1_summon_raging_spirit',
    name: { en: 'Summon Raging Spirit', zh: '召唤愤怒狂灵' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Minion', 'Fire', 'Duration'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Melee,
    keywordFlags: KeywordFlag.Minion | KeywordFlag.Fire | KeywordFlag.Hit,
    damageEffectivenessPct: 100,
    castTime: 0.5,
    manaCost: 16,
    stats: ['100% of Physical Damage Converted to Fire Damage'],
    qualityStats: [],
    minionBase: {
      physicalMin: 158,
      physicalMax: 237,
      attacksPerSecond: 1 / 0.57,
      critChance: 5,
      critMultiplier: 130,
      moreAttackSpeedPct: 40,
    },
  },
  {
    id: 'poe1_raise_zombie',
    name: { en: 'Raise Zombie', zh: '魔卫复苏' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Minion'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Melee,
    keywordFlags: KeywordFlag.Minion | KeywordFlag.Physical | KeywordFlag.Hit,
    damageEffectivenessPct: 100,
    castTime: 0.85,
    manaCost: 23,
    stats: [],
    qualityStats: [],
    minionBase: {
      physicalMin: 260,
      physicalMax: 390,
      attacksPerSecond: 1.18,
      critChance: 5,
      critMultiplier: 130,
    },
  },
  // Auras (PoE 1 3.30 Lv.20)
  {
    id: 'poe1_wrath',
    name: { en: 'Wrath', zh: '雷霆' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Aura', 'Spell', 'Lightning'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Lightning,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['21% more Lightning Damage', 'Adds 16 to 248 Lightning Damage to Attacks'],
  },
  {
    id: 'poe1_determination',
    name: { en: 'Determination', zh: '坚定' },
    category: 'active',
    game: 'poe1',
    color: 'red',
    tags: ['Aura', 'Spell'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['+1026 to Armour', '49% more Armour'],
  },
  {
    id: 'poe1_grace',
    name: { en: 'Grace', zh: '优雅' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Aura', 'Spell'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['+1545 to Evasion Rating', '29% more Evasion Rating'],
  },
  {
    id: 'poe1_discipline',
    name: { en: 'Discipline', zh: '纪律' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Aura', 'Spell'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 35,
    isAuraOrBuff: true,
    stats: ['+217 to maximum Energy Shield'],
  },
  {
    id: 'poe1_hatred',
    name: { en: 'Hatred', zh: '憎恨' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Aura', 'Spell', 'Cold'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Cold,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['Gain 39% of Physical Damage as Extra Cold Damage'],
  },
  {
    id: 'poe1_anger',
    name: { en: 'Anger', zh: '愤怒' },
    category: 'active',
    game: 'poe1',
    color: 'red',
    tags: ['Aura', 'Spell', 'Fire'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura | KeywordFlag.Fire,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['Adds 109 to 155 Fire Damage to Spells', 'Adds 109 to 155 Fire Damage to Attacks'],
  },
  {
    id: 'poe1_zealotry',
    name: { en: 'Zealotry', zh: '奋锐光环' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Aura', 'Spell'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['39% increased Critical Strike Chance for Spells', '15% more Spell Damage'],
  },
  {
    id: 'poe1_haste',
    name: { en: 'Haste', zh: '迅捷' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Aura', 'Spell'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Aura,
    manaReservationPct: 50,
    isAuraOrBuff: true,
    stats: ['24% increased Attack and Cast Speed', '16% increased Movement Speed'],
  },
  // Curses & Marks (PoE 1 3.30 Lv.20)
  {
    id: 'poe1_conductivity',
    name: { en: 'Conductivity', zh: '导电' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Hex', 'Lightning', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse | KeywordFlag.Lightning,
    isAuraOrBuff: true,
    stats: ['Cursed enemies have -36% to Lightning Resistance'],
    qualityStats: [],
  },
  {
    id: 'poe1_flammability',
    name: { en: 'Flammability', zh: '易燃' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Hex', 'Fire', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse | KeywordFlag.Fire,
    isAuraOrBuff: true,
    stats: ['Cursed enemies have -36% to Fire Resistance'],
    qualityStats: [],
  },
  {
    id: 'poe1_frostbite',
    name: { en: 'Frostbite', zh: '冻伤' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Hex', 'Cold', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse | KeywordFlag.Cold,
    isAuraOrBuff: true,
    stats: ['Cursed enemies have -36% to Cold Resistance'],
    qualityStats: [],
  },
  {
    id: 'poe1_elemental_weakness',
    name: { en: 'Elemental Weakness', zh: '元素要害' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Hex', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse,
    isAuraOrBuff: true,
    stats: ['Cursed enemies have -30% to Elemental Resistances'],
    qualityStats: [],
  },
  {
    id: 'poe1_despair',
    name: { en: 'Despair', zh: '绝望' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Hex', 'Chaos', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse | KeywordFlag.Chaos,
    isAuraOrBuff: true,
    stats: ['Cursed enemies have -30% to Chaos Resistance'],
    qualityStats: [],
  },
  {
    id: 'poe1_vulnerability',
    name: { en: 'Vulnerability', zh: '脆弱' },
    category: 'active',
    game: 'poe1',
    color: 'red',
    tags: ['Spell', 'Curse', 'Hex', 'Physical', 'Area'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse | KeywordFlag.Physical,
    isAuraOrBuff: true,
    stats: ['Cursed enemies take 30% increased Physical Damage'],
    qualityStats: [],
  },
  {
    id: 'poe1_assassins_mark',
    name: { en: "Assassin's Mark", zh: '刺客印记' },
    category: 'active',
    game: 'poe1',
    color: 'blue',
    tags: ['Spell', 'Curse', 'Mark'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse,
    isAuraOrBuff: true,
    stats: [
      'Hits against Cursed Enemies have +1.5% to Critical Strike Chance',
      'Hits against Cursed Enemies have +49% to Critical Strike Multiplier',
    ],
    qualityStats: [],
  },
  {
    id: 'poe1_snipers_mark',
    name: { en: "Sniper's Mark", zh: '狙击印记' },
    category: 'active',
    game: 'poe1',
    color: 'green',
    tags: ['Spell', 'Curse', 'Mark'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Curse,
    isAuraOrBuff: true,
    stats: ['Cursed enemies take 29% increased Projectile Damage'],
    qualityStats: [],
  },
  // Supports (PoE 1 3.30 Lv.20)
  {
    id: 'poe1_sup_spell_echo',
    name: { en: 'Spell Echo Support', zh: '法术回响（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['54% more Cast Speed'],
    qualityStats: [{ template: '{v}% increased Spell Damage', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_lightning_pen',
    name: { en: 'Lightning Penetration Support', zh: '闪电穿透（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Lightning'],
    modFlags: ModFlag.Hit,
    keywordFlags: KeywordFlag.Lightning,
    stats: ['Damage Penetrates 34% Lightning Resistance'],
    qualityStats: [{ template: '{v}% increased Lightning Damage', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_controlled_destruction',
    name: { en: 'Controlled Destruction Support', zh: '精准破坏（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['39% more Spell Damage', '80% less Critical Strike Chance'],
    qualityStats: [{ template: '{v}% increased Spell Damage', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_inspiration',
    name: { en: 'Inspiration Support', zh: '启迪（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['Support'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.None,
    stats: ['25% more Elemental Damage', '40% increased Critical Strike Chance'],
    qualityStats: [],
  },
  {
    id: 'poe1_sup_increased_crit_damage',
    name: { en: 'Increased Critical Damage Support', zh: '提高暴击伤害（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.None,
    stats: ['+138% to Critical Strike Multiplier'],
    qualityStats: [{ template: '+{v}% to Critical Strike Multiplier', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_elemental_focus',
    name: { en: 'Elemental Focus Support', zh: '元素集中（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Elemental'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.None,
    stats: ['34% more Elemental Damage', 'Cannot inflict Elemental Ailments'],
    qualityStats: [{ template: '{v}% increased Elemental Damage', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_faster_casting',
    name: { en: 'Faster Casting Support', zh: '快速施法（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['39% increased Cast Speed'],
    qualityStats: [{ template: '{v}% increased Cast Speed', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_wed',
    name: { en: 'Elemental Damage with Attacks Support', zh: '武器元素伤害（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['Support', 'Attack'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Attack,
    stats: ['34% more Elemental Damage'],
    qualityStats: [{ template: '{v}% increased Elemental Damage with Attack Skills', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_brutality',
    name: { en: 'Brutality Support', zh: '残暴（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['Support', 'Physical'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Physical,
    stats: ['39% more Physical Damage', 'Deal no Elemental Damage', 'Deal no Chaos Damage'],
    qualityStats: [{ template: '{v}% increased Physical Damage', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_faster_attacks',
    name: { en: 'Faster Attacks Support', zh: '快速攻击（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'green',
    tags: ['Support', 'Attack'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Attack,
    stats: ['44% increased Attack Speed'],
    qualityStats: [{ template: '{v}% increased Attack Speed', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_spell_totem',
    name: { en: 'Spell Totem Support', zh: '法术图腾（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'red',
    tags: ['Support', 'Totem', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Totem | KeywordFlag.Spell,
    stats: ['50% less Damage', '40% less Cast Speed'],
    qualityStats: [],
  },
  {
    id: 'poe1_sup_ballista_totem',
    name: { en: 'Ballista Totem Support', zh: '弩炮图腾（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'green',
    tags: ['Support', 'Totem', 'Attack'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Totem | KeywordFlag.Attack,
    stats: ['30% less Damage', '50% less Attack Speed'],
    qualityStats: [],
  },
  {
    id: 'poe1_sup_trap',
    name: { en: 'Trap Support', zh: '陷阱（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'green',
    tags: ['Support', 'Trap'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Trap,
    stats: ['6% less Damage'],
    qualityStats: [],
  },
  {
    id: 'poe1_sup_impale',
    name: { en: 'Impale Support', zh: '穿刺（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'green',
    tags: ['Support', 'Attack', 'Physical'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Physical,
    stats: ['60% chance to Impale Enemies on Hit with Attacks', '28% increased Impale Effect'],
    qualityStats: [{ template: '{v}% increased Impale Effect', perQuality: 0.5 }],
  },
  {
    id: 'poe1_sup_cast_on_crit',
    name: { en: 'Cast On Critical Strike Support', zh: '暴击时施放（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'green',
    tags: ['Support', 'Trigger', 'Critical'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['10% less Spell Damage', 'Trigger Supported Spells on Melee Critical Strike'],
    qualityStats: [{ template: '{v}% increased Critical Strike Chance for Spells', perQuality: 1 }],
  },
  {
    id: 'poe1_sup_minion_damage',
    name: { en: 'Minion Damage Support', zh: '召唤生物伤害（辅）' },
    category: 'support',
    game: 'poe1',
    color: 'blue',
    tags: ['Support', 'Minion'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Minion,
    stats: ['39% more Minion Damage'],
    qualityStats: [{ template: 'Minions deal {v}% increased Damage', perQuality: 0.5 }],
  },
];

export const POE2_GEMS: GemDefinition[] = [
  // Active Spells (Synced from official PoB-PoE2 0.5 Lv.20 values)
  {
    id: 'poe2_spark',
    name: { en: 'Spark', zh: '电球' },
    category: 'active',
    game: 'poe2',
    color: 'blue',
    tags: ['Spell', 'Lightning', 'Projectile'],
    modFlags: ModFlag.Spell | ModFlag.Hit | ModFlag.Projectile,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Lightning | KeywordFlag.Hit,
    baseDamage: { Lightning: [11, 216] },
    damageEffectivenessPct: 100,
    castTime: 0.7,
    baseCritChance: 9,
    manaCost: 56,
    stats: [],
  },
  {
    id: 'poe2_comet',
    name: { en: 'Comet', zh: '彗星' },
    category: 'active',
    game: 'poe2',
    color: 'blue',
    tags: ['Spell', 'Cold', 'Area'],
    modFlags: ModFlag.Spell | ModFlag.Hit | ModFlag.Area,
    keywordFlags: KeywordFlag.Spell | KeywordFlag.Cold | KeywordFlag.Hit,
    baseDamage: { Cold: [787, 1181] },
    damageEffectivenessPct: 100,
    castTime: 2.0,
    baseCritChance: 13,
    manaCost: 173,
    stats: [],
    qualityStats: [],
  },
  // Active Attacks (PoE 2)
  {
    id: 'poe2_ice_strike',
    name: { en: 'Ice Strike', zh: '寒冰打击' },
    category: 'active',
    game: 'poe2',
    color: 'green',
    tags: ['Attack', 'Melee', 'Area', 'Cold', 'Quarterstaff'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Melee | ModFlag.Area | ModFlag.Quarterstaff,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Cold | KeywordFlag.Hit,
    attackDamageMultiplierPct: 187,
    damageEffectivenessPct: 187,
    attackSpeedMultiplier: 1.4,
    manaCost: 36,
    stats: ['80% of Physical Damage Converted to Cold Damage'],
    qualityStats: [],
  },
  {
    id: 'poe2_lightning_arrow',
    name: { en: 'Lightning Arrow', zh: '闪电箭矢' },
    category: 'active',
    game: 'poe2',
    color: 'green',
    tags: ['Attack', 'Projectile', 'Lightning', 'Bow'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Projectile | ModFlag.Bow,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Lightning | KeywordFlag.Hit,
    attackDamageMultiplierPct: 250,
    damageEffectivenessPct: 250,
    attackSpeedMultiplier: 0.9,
    manaCost: 40,
    stats: ['80% of Physical Damage Converted to Lightning Damage'],
    qualityStats: [],
  },
  {
    id: 'poe2_hammer_of_the_gods',
    name: { en: 'Hammer of the Gods', zh: '众神之锤' },
    category: 'active',
    game: 'poe2',
    color: 'red',
    tags: ['Attack', 'Melee', 'Area', 'Physical', 'Slam'],
    modFlags: ModFlag.Attack | ModFlag.Hit | ModFlag.Melee | ModFlag.Area,
    keywordFlags: KeywordFlag.Attack | KeywordFlag.Physical | KeywordFlag.Hit,
    attackDamageMultiplierPct: 820,
    damageEffectivenessPct: 820,
    attackSpeedMultiplier: 0.4,
    manaCost: 65,
    stats: ['30% more Melee Damage'],
  },
  // Persistent Spirit Buffs (PoE 2 Spirit Reservation)
  {
    id: 'poe2_archmage',
    name: { en: 'Archmage', zh: '大法师' },
    category: 'active',
    game: 'poe2',
    color: 'blue',
    tags: ['Spirit', 'Buff', 'Lightning', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spirit | KeywordFlag.Lightning | KeywordFlag.Spell,
    spiritReservation: 100,
    isAuraOrBuff: true,
    stats: ['Gain 4% of Damage as Extra Lightning Damage per 100 Maximum Mana'],
  },
  {
    id: 'poe2_herald_of_thunder',
    name: { en: 'Herald of Thunder', zh: '闪电之捷' },
    category: 'active',
    game: 'poe2',
    color: 'green',
    tags: ['Spirit', 'Buff', 'Lightning'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Spirit | KeywordFlag.Lightning,
    spiritReservation: 30,
    isAuraOrBuff: true,
    stats: ['Adds 24 to 145 Lightning Damage to Attacks', '15% increased Lightning Damage'],
  },
  {
    id: 'poe2_herald_of_ice',
    name: { en: 'Herald of Ice', zh: '寒冰之捷' },
    category: 'active',
    game: 'poe2',
    color: 'green',
    tags: ['Spirit', 'Buff', 'Cold'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Spirit | KeywordFlag.Cold,
    spiritReservation: 30,
    isAuraOrBuff: true,
    stats: ['Adds 42 to 74 Cold Damage to Attacks', '15% increased Cold Damage'],
  },
  {
    id: 'poe2_grim_feast',
    name: { en: 'Grim Feast', zh: '冷酷盛宴' },
    category: 'active',
    game: 'poe2',
    color: 'blue',
    tags: ['Spirit', 'Buff'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Spirit,
    spiritReservation: 30,
    isAuraOrBuff: true,
    stats: ['25% increased maximum Energy Shield', '+120 to maximum Energy Shield'],
  },
  // PoE 2 Support Gems
  {
    id: 'poe2_sup_arcane_tempo',
    name: { en: 'Arcane Tempo', zh: '奥术节拍' },
    category: 'support',
    game: 'poe2',
    color: 'blue',
    tags: ['Support', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['25% more Cast Speed'],
  },
  {
    id: 'poe2_sup_considered_casting',
    name: { en: 'Considered Casting', zh: '审慎施法' },
    category: 'support',
    game: 'poe2',
    color: 'blue',
    tags: ['Support', 'Spell'],
    modFlags: ModFlag.Spell,
    keywordFlags: KeywordFlag.Spell,
    stats: ['40% more Spell Damage'],
  },
  {
    id: 'poe2_sup_lightning_infusion',
    name: { en: 'Lightning Infusion', zh: '闪电灌注' },
    category: 'support',
    game: 'poe2',
    color: 'blue',
    tags: ['Support', 'Lightning'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.Lightning,
    stats: ['Gain 25% of Physical Damage as Extra Lightning Damage', '25% more Lightning Damage'],
  },
  {
    id: 'poe2_sup_martial_tempo',
    name: { en: 'Martial Tempo', zh: '武术节拍' },
    category: 'support',
    game: 'poe2',
    color: 'green',
    tags: ['Support', 'Attack'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Attack,
    stats: ['25% more Attack Speed'],
  },
  {
    id: 'poe2_sup_primal_armament',
    name: { en: 'Primal Armament', zh: '原始武装' },
    category: 'support',
    game: 'poe2',
    color: 'red',
    tags: ['Support', 'Attack'],
    modFlags: ModFlag.Attack,
    keywordFlags: KeywordFlag.Attack,
    stats: ['25% more Elemental Damage'],
  },
  {
    id: 'poe2_sup_supercritical',
    name: { en: 'Supercritical', zh: '超级暴击' },
    category: 'support',
    game: 'poe2',
    color: 'blue',
    tags: ['Support'],
    modFlags: ModFlag.None,
    keywordFlags: KeywordFlag.None,
    stats: ['+100% to Critical Strike Multiplier'],
  },
];

interface GemLookupIndex {
  byId: Map<string, GemDefinition>;
  byIdLower: Map<string, GemDefinition>;
  byAltIdLower: Map<string, GemDefinition>;
  byStrippedIdLower: Map<string, GemDefinition>;
  byExactNameLower: Map<string, GemDefinition>;
  byBaseNameLower: Map<string, GemDefinition>;
}

const GEM_PREFIX_RE = /^poe[12]_/i;
const SUPPORT_SUFFIX_RE = /\s+support$/i;

function normalizeGemBaseName(name: string): string {
  return name.toLowerCase().trim().replace(SUPPORT_SUFFIX_RE, '');
}

function buildGemLookupIndex(gems: GemDefinition[]): GemLookupIndex {
  const byId = new Map<string, GemDefinition>();
  const byIdLower = new Map<string, GemDefinition>();
  const byAltIdLower = new Map<string, GemDefinition>();
  const byStrippedIdLower = new Map<string, GemDefinition>();
  const byExactNameLower = new Map<string, GemDefinition>();
  const byBaseNameLower = new Map<string, GemDefinition>();

  for (const gem of gems) {
    if (!byId.has(gem.id)) byId.set(gem.id, gem);

    const idLower = gem.id.toLowerCase().trim();
    if (idLower && !byIdLower.has(idLower)) byIdLower.set(idLower, gem);

    const strippedId = idLower.replace(GEM_PREFIX_RE, '');
    if (strippedId && strippedId !== idLower && !byStrippedIdLower.has(strippedId)) {
      byStrippedIdLower.set(strippedId, gem);
    }

    if (gem.altIds) {
      for (const alt of gem.altIds) {
        const altLower = alt.toLowerCase().trim();
        if (!altLower) continue;
        if (!byAltIdLower.has(altLower)) byAltIdLower.set(altLower, gem);
        const strippedAlt = altLower.replace(GEM_PREFIX_RE, '');
        if (strippedAlt && strippedAlt !== altLower && !byStrippedIdLower.has(strippedAlt)) {
          byStrippedIdLower.set(strippedAlt, gem);
        }
      }
    }

    const enLower = gem.name.en.toLowerCase().trim();
    if (enLower && !byExactNameLower.has(enLower)) byExactNameLower.set(enLower, gem);

    const baseEn = enLower.replace(SUPPORT_SUFFIX_RE, '');
    if (baseEn && !byBaseNameLower.has(baseEn)) byBaseNameLower.set(baseEn, gem);

    const zhLower = gem.name.zh.toLowerCase().trim();
    if (zhLower && !byExactNameLower.has(zhLower)) byExactNameLower.set(zhLower, gem);

    const zhTwLower = gem.name.zhTw?.toLowerCase().trim();
    if (zhTwLower && !byExactNameLower.has(zhTwLower)) byExactNameLower.set(zhTwLower, gem);
  }

  return {
    byId,
    byIdLower,
    byAltIdLower,
    byStrippedIdLower,
    byExactNameLower,
    byBaseNameLower,
  };
}

const registeredOfficialGems: Partial<Record<GameId, GemDefinition[]>> = {};
const gemIndexCache: Partial<Record<GameId, { source: GemDefinition[]; index: GemLookupIndex }>> = {};

function getGemLookupIndex(game: GameId): GemLookupIndex {
  const gems = getGemsForGame(game);
  const cached = gemIndexCache[game];
  if (cached && cached.source === gems) return cached.index;
  const index = buildGemLookupIndex(gems);
  gemIndexCache[game] = { source: gems, index };
  return index;
}

export function setRegisteredGems(game: GameId, gems: GemDefinition[]): void {
  registeredOfficialGems[game] = gems;
  gemIndexCache[game] = { source: gems, index: buildGemLookupIndex(gems) };
}

export function getGemsForGame(game: GameId): GemDefinition[] {
  return registeredOfficialGems[game] ?? (game === 'poe2' ? POE2_GEMS : POE1_GEMS);
}

/**
 * Looks up a gem by canonical WebPoB `id` or any lowercased `altIds` alias
 * (such as PoB `grantedEffect.id`, `variantId`, or `gemData.id`).
 */
export function getGemById(game: GameId, gemId: string): GemDefinition | undefined {
  if (!gemId) return undefined;
  const index = getGemLookupIndex(game);
  const exact = index.byId.get(gemId);
  if (exact) return exact;

  const lower = gemId.toLowerCase().trim();
  if (!lower) return undefined;
  return (
    index.byIdLower.get(lower) ??
    index.byAltIdLower.get(lower) ??
    index.byStrippedIdLower.get(lower)
  );
}

/**
 * Looks up a gem by exact normalized English or Chinese display name, falling back
 * to matching with or without a trailing `" Support"` suffix.
 */
export function findGemByName(game: GameId, name: string): GemDefinition | undefined {
  const lower = name.toLowerCase().trim();
  if (!lower) return undefined;
  const index = getGemLookupIndex(game);

  const exact = index.byExactNameLower.get(lower);
  if (exact) return exact;

  const withSupport = index.byExactNameLower.get(`${lower} support`);
  if (withSupport) return withSupport;

  const stripped = lower.replace(SUPPORT_SUFFIX_RE, '');
  if (stripped !== lower) {
    const exactStripped = index.byExactNameLower.get(stripped);
    if (exactStripped) return exactStripped;
  }

  const byBase = index.byBaseNameLower.get(stripped);
  if (byBase) return byBase;

  // Fallback for zh-TW locale overlays applied after registration.
  return getGemsForGame(game).find((g) => g.name.zhTw?.toLowerCase().trim() === lower);
}

export interface PobGemRef {
  gemId?: string;
  nameSpec?: string;
  skillId?: string;
  variantId?: string;
}

/**
 * Resolves a PoB XML `<Gem>` reference (`skillId`, `variantId`, `nameSpec`, `gemId`) to a
 * registered `GemDefinition`. Prioritizes `skillId` / `variantId` and exact `nameSpec` over
 * `gemId`, because PoB Transfigured Gems carry the base gem's `Metadata/Items/Gems/...` path
 * in `gemId` while identifying the transfigured variant via `skillId`, `variantId`, and `nameSpec`.
 */
export function resolveGemFromPobRef(game: GameId, ref: PobGemRef): GemDefinition | undefined {
  const { gemId: rawGemId, nameSpec: rawNameSpec, skillId: rawSkillId, variantId: rawVariantId } = ref;
  const index = getGemLookupIndex(game);

  // 1. Prioritize explicit skillId / variantId (exact ID / altIds lookup).
  if (rawSkillId) {
    const bySkill = getGemById(game, rawSkillId);
    if (bySkill) return bySkill;
  }
  if (rawVariantId) {
    const byVariant = getGemById(game, rawVariantId);
    if (byVariant) return byVariant;
  }

  // 2. Preserve WebPoB canonical gem.id round-trips when skillId/variantId are absent
  //    (buildToPobXml strips " Support" from nameSpec, e.g. Barrage Support -> "Barrage").
  //    If nameSpec names a different, more specific gem (e.g. "Heavy Strike of Trarthus"),
  //    let step 3 resolve nameSpec instead of returning a base gem.
  if (!rawSkillId && !rawVariantId && rawGemId) {
    const exactCanonical = index.byId.get(rawGemId);
    if (exactCanonical) {
      if (
        !rawNameSpec ||
        normalizeGemBaseName(exactCanonical.name.en) === normalizeGemBaseName(rawNameSpec) ||
        exactCanonical.name.zh.toLowerCase().trim() === rawNameSpec.toLowerCase().trim()
      ) {
        return exactCanonical;
      }
    }
  }

  // 3. Exact normalized English / Chinese nameSpec lookup (with " Support" suffix fallback).
  if (rawNameSpec) {
    const byName = findGemByName(game, rawNameSpec);
    if (byName) return byName;
  }

  // 4. Check skillId / variantId against name index if they did not match as IDs.
  if (rawSkillId) {
    const bySkillName = findGemByName(game, rawSkillId);
    if (bySkillName) return bySkillName;
  }
  if (rawVariantId) {
    const byVariantName = findGemByName(game, rawVariantId);
    if (byVariantName) return byVariantName;
  }

  // 5. Fallback to gemId only if skillId / variantId / nameSpec did not match a more specific gem.
  if (rawGemId) {
    const byGem = getGemById(game, rawGemId) ?? findGemByName(game, rawGemId);
    if (byGem) return byGem;
  }

  // 6. Last-resort fuzzy fallback (preferring the longest matching English gem name).
  const gems = getGemsForGame(game);
  const candidates = [rawNameSpec, rawSkillId, rawVariantId, rawGemId]
    .filter((s): s is string => Boolean(s))
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);

  for (const needle of candidates) {
    let bestMatch: GemDefinition | undefined;
    let bestLen = -1;
    for (const g of gems) {
      const enLower = g.name.en.toLowerCase();
      if (!enLower) continue;
      if (needle.includes(enLower) || enLower.replace(SUPPORT_SUFFIX_RE, '') === needle) {
        if (enLower.length > bestLen) {
          bestLen = enLower.length;
          bestMatch = g;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }
  return undefined;
}
