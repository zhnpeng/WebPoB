import type { Locale } from '@webpob/core';
import { toSimplifiedZh, toTraditionalZh } from './traditional.js';

interface StatRewriteRule {
  zhPattern: RegExp;
  toEn: (...args: string[]) => string;
}

interface EnToZhRule {
  enPattern: RegExp;
  toZh: (...args: string[]) => string;
}

const ZH_DAMAGE_TYPE_TO_EN: Record<string, string> = {
  物理: 'Physical',
  火焰: 'Fire',
  冰霜: 'Cold',
  冰冷: 'Cold',
  闪电: 'Lightning',
  混沌: 'Chaos',
  元素: 'Elemental',
};

const EN_DAMAGE_TYPE_TO_ZH: Record<string, string> = {
  Physical: '物理',
  Fire: '火焰',
  Cold: '冰霜',
  Lightning: '闪电',
  Chaos: '混沌',
  Elemental: '元素',
};

const ZH_ATTR_TO_EN: Record<string, string> = {
  力量: 'Strength',
  敏捷: 'Dexterity',
  智慧: 'Intelligence',
  全属性: 'all Attributes',
  所有属性: 'all Attributes',
};

const EN_ATTR_TO_ZH: Record<string, string> = {
  Strength: '力量',
  Dexterity: '敏捷',
  Intelligence: '智慧',
  'all Attributes': '全属性',
};

const ZH_TO_EN_RULES: StatRewriteRule[] = [
  // Flat Life / Mana / ES / Spirit / Ward (supports PoE 1 最大生命, PoE 2 生命上限, and TW variants)
  {
    zhPattern: /^(?:(?:最大生命值?|生命值?上限)\s*\+?(\d+)|\+(\d+)\s*点?(?:最大生命值?|生命值?上限|生命))$/,
    toEn: (_, a, b) => `+${a || b} to maximum Life`,
  },
  {
    zhPattern: /^(?:(?:最大魔力值?|魔力值?上限)\s*\+?(\d+)|\+(\d+)\s*点?(?:最大魔力值?|魔力值?上限|魔力))$/,
    toEn: (_, a, b) => `+${a || b} to maximum Mana`,
  },
  {
    zhPattern: /^(?:(?:最大能量护盾|能量护盾上限|能量护盾)\s*\+?(\d+)|\+(\d+)\s*点?(?:最大能量护盾|能量护盾上限|能量护盾))$/,
    toEn: (_, a, b) => `+${a || b} to maximum Energy Shield`,
  },
  {
    zhPattern: /^(?:(?:最大精魂|精魂上限|精魂)\s*\+?(\d+)|\+(\d+)\s*点?(?:最大)?精魂(?:上限)?)$/,
    toEn: (_, a, b) => `+${a || b} to Spirit`,
  },
  {
    zhPattern: /^(?:(?:最大)?(?:符文)?结界(?:上限)?\s*\+?(\d+)|\+(\d+)\s*点?(?:最大)?(?:符文)?结界(?:上限)?)$/,
    toEn: (_, a, b) => `+${a || b} to Ward`,
  },
  // Increased % Life / ES / Mana / Armour / Evasion / Ward / Hybrid Defences
  {
    zhPattern: /^(?:最大生命值?|生命值?上限)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased maximum Life`,
  },
  {
    zhPattern: /^(?:最大能量护盾|能量护盾上限)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased maximum Energy Shield`,
  },
  {
    zhPattern: /^能量护盾(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Energy Shield`,
  },
  {
    zhPattern: /^(?:最大魔力值?|魔力值?上限)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased maximum Mana`,
  },
  {
    zhPattern: /^(?:符文)?结界(?:上限)?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Ward`,
  },
  {
    zhPattern: /^全局护甲值?[，,、]\s*闪避值?[和与]\s*能量护盾(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Global Defences`,
  },
  {
    zhPattern: /^护甲值?[，,、]\s*闪避值?[和与]\s*能量护盾(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Armour, Evasion and Energy Shield`,
  },
  {
    zhPattern: /^护甲值?[和与]闪避值?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Armour and Evasion`,
  },
  {
    zhPattern: /^闪避值?[和与]护甲值?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Evasion Rating and Armour`,
  },
  {
    zhPattern: /^(?:护甲值?[和与]能量护盾|能量护盾[和与]护甲值?)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Armour and Energy Shield`,
  },
  {
    zhPattern: /^(?:闪避值?[和与]能量护盾|能量护盾[和与]闪避值?)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Evasion and Energy Shield`,
  },
  {
    zhPattern: /^护甲值?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Armour`,
  },
  {
    zhPattern: /^闪避值?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Evasion Rating`,
  },
  {
    zhPattern: /^(?:护甲值?\s*\+(\d+)|\+(\d+)\s*点?护甲值?)$/,
    toEn: (_, a, b) => `+${a || b} to Armour`,
  },
  {
    zhPattern: /^(?:闪避值?\s*\+(\d+)|\+(\d+)\s*点?闪避值?)$/,
    toEn: (_, a, b) => `+${a || b} to Evasion Rating`,
  },
  // Attributes (single, dual, all)
  {
    zhPattern: /^(?:\+(\d+)\s*(力量|敏捷|智慧)[和与](力量|敏捷|智慧)|(力量|敏捷|智慧)[和与](力量|敏捷|智慧)\s*\+(\d+))$/,
    toEn: (_, v1, a1, b1, a2, b2, v2) => {
      const v = v1 || v2;
      const first = ZH_ATTR_TO_EN[a1 || a2] ?? (a1 || a2);
      const second = ZH_ATTR_TO_EN[b1 || b2] ?? (b1 || b2);
      return `+${v} to ${first} and ${second}`;
    },
  },
  {
    zhPattern: /^\+(\d+)\s*点?(力量|敏捷|智慧|全属性|所有属性)$/,
    toEn: (_, v, attr) => `+${v} to ${ZH_ATTR_TO_EN[attr] ?? attr}`,
  },
  {
    zhPattern: /^(力量|敏捷|智慧|全属性|所有属性)\s*\+(\d+)$/,
    toEn: (_, attr, v) => `+${v} to ${ZH_ATTR_TO_EN[attr] ?? attr}`,
  },
  // Resistances (all elemental, dual, max, single)
  {
    zhPattern: /^(?:全元素抗性|所有元素抗性)\s*([+-]?\d+)%$/,
    toEn: (_, v) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to all Elemental Resistances`,
  },
  {
    zhPattern: /^([+-]?\d+)%\s*(?:全元素抗性|所有元素抗性)$/,
    toEn: (_, v) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to all Elemental Resistances`,
  },
  {
    zhPattern: /^(?:(?:所有|全)?元素抗性上限\s*([+-]?\d+)%|([+-]?\d+)%\s*(?:所有|全)?元素抗性上限)$/,
    toEn: (_, a, b) => {
      const raw = (a || b)!;
      const signed = raw.startsWith('-') ? raw : `+${raw.replace(/^\+/, '')}`;
      return `${signed}% to all maximum Elemental Resistances`;
    },
  },
  // PoE 2 Mageblood Legacies, Kalandra's Touch, Morior Invictus (per Socket filled), Atziri's Disdain & 0.5 CN mods
  {
    zhPattern: /^(紫晶|玄武岩|灰岩|钻石|黄金|坚岩|青玉|水银|红玉|蓝玉|白银|辉锑|硫磺|黄玉)\s*继承$/,
    toEn: (_, k) => {
      const legacyMap: Record<string, string> = {
        紫晶: 'Amethyst',
        玄武岩: 'Basalt',
        灰岩: 'Bismuth',
        钻石: 'Diamond',
        黄金: 'Gold',
        坚岩: 'Granite',
        青玉: 'Jade',
        水银: 'Quicksilver',
        红玉: 'Ruby',
        蓝玉: 'Sapphire',
        白银: 'Silver',
        辉锑: 'Stibnite',
        硫磺: 'Sulphur',
        黄玉: 'Topaz',
      };
      return `Legacy of ${legacyMap[k] ?? k}`;
    },
  },
  {
    zhPattern: /^你每拥有一个重复的法师遗产[，,]\s*所有法师遗产效果提高\s*(\d+)%$/,
    toEn: (_, v) => `All Mage's Legacies have ${v}% increased effect per duplicate Mage's Legacy you have`,
  },
  {
    zhPattern: /^映射另一枚戒指$/,
    toEn: () => 'Reflects your other Ring',
  },
  {
    zhPattern: /^每个镶嵌的插槽使所有元素抗性\s*\+?(\d+)%$/,
    toEn: (_, v) => `+${v}% to all Elemental Resistances per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使(火焰|冰霜|冰冷|闪电|混沌)抗性\s*\+?(\d+)%$/,
    toEn: (_, el, v) => `+${v}% to ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使所有属性\s*\+?(\d+)$/,
    toEn: (_, v) => `+${v} to all Attributes per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使(力量|敏捷|智慧)\s*\+?(\d+)$/,
    toEn: (_, attr, v) => `+${v} to ${ZH_ATTR_TO_EN[attr] ?? attr} per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使精魂\s*\+?(\d+)$/,
    toEn: (_, v) => `+${v} to Spirit per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使(?:最大生命|生命上限)\s*\+?(\d+)$/,
    toEn: (_, v) => `+${v} to maximum Life per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使(?:最大魔力|魔力上限)\s*\+?(\d+)$/,
    toEn: (_, v) => `+${v} to maximum Mana per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使(?:最大能量护盾|能量护盾上限)\s*\+?(\d+)$/,
    toEn: (_, v) => `+${v} to maximum Energy Shield per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使?(?:最大生命|生命上限)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased maximum Life per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使?(?:最大魔力|魔力上限)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased maximum Mana per Socket filled`,
  },
  {
    zhPattern: /^每个镶嵌的插槽使?全局护甲值?[，,、]\s*闪避值?[和与]\s*能量护盾(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Global Defences per Socket filled`,
  },
  {
    zhPattern: /^(?:最大生命|生命上限)总降\s*(\d+)%$/,
    toEn: (_, v) => `${v}% less maximum Life`,
  },
  {
    zhPattern: /^(?:最大生命|生命上限)总增\s*(\d+)%$/,
    toEn: (_, v) => `${v}% more maximum Life`,
  },
  {
    zhPattern: /^(?:最大能量护盾|能量护盾上限)总降\s*(\d+)%$/,
    toEn: (_, v) => `${v}% less maximum Energy Shield`,
  },
  {
    zhPattern: /^(?:最大能量护盾|能量护盾上限)总增\s*(\d+)%$/,
    toEn: (_, v) => `${v}% more maximum Energy Shield`,
  },
  {
    zhPattern: /^你的抗性上限为\s*(\d+)%$/,
    toEn: (_, v) => `Your Maximum Resistances are ${v}%`,
  },
  {
    zhPattern: /^每个暴击球使所有元素抗性\s*([+-]?\d+)%$/,
    toEn: (_, v) => `${v}% to all Elemental Resistances per Power Charge`,
  },
  {
    zhPattern: /^每件有(火焰|冰霜|冰冷|闪电|混沌)抗性词缀的装备物品[，,]\s*使(火焰|冰霜|冰冷|闪电|混沌)[与和](火焰|冰霜|冰冷|闪电|混沌)抗性\s*\+(\d+)%$/,
    toEn: (_, condEl, e1, e2, v) =>
      `+${v}% to ${ZH_DAMAGE_TYPE_TO_EN[e1] ?? e1} and ${ZH_DAMAGE_TYPE_TO_EN[e2] ?? e2} Resistances per Equipped Item with a ${ZH_DAMAGE_TYPE_TO_EN[condEl] ?? condEl} Resistance Modifier`,
  },
  {
    zhPattern: /^(前缀|后缀)效果(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, affix, v) => `${v}% increased effect of ${affix === '前缀' ? 'Prefix' : 'Suffix'} Modifiers`,
  },
  {
    zhPattern: /^(力量|敏捷|智慧)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, attr, v) => `${v}% increased ${ZH_ATTR_TO_EN[attr] ?? attr}`,
  },
  {
    zhPattern: /^(?:所有|全)属性(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Attributes`,
  },
  {
    zhPattern: /^获得等同(?:于)?(?:最大生命|生命上限)\s*(\d+)%\s*的额外(?:最大)?能量护盾$/,
    toEn: (_, v) => `Gain ${v}% of Maximum Life as Extra Maximum Energy Shield`,
  },
  {
    zhPattern: /^\+?(\d+)%\s*的护甲同样作用于元素伤害$/,
    toEn: (_, v) => `${v}% of Armour also applies to Elemental Damage`,
  },
  {
    zhPattern: /^镶嵌的增幅器物品效果(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased effect of Socketed Items`,
  },
  {
    zhPattern: /^镶嵌在该物品上的雕像获得其自身的绑定词缀的强化效果$/,
    toEn: () => 'Idols socketed in this item gain the benefits of their Bonded modifiers',
  },
  {
    zhPattern: /^已装备的头盔每有\s*(\d+)\s*点护甲[，,]\s*(?:最大生命|生命上限)\s*\+(\d+)$/,
    toEn: (_, per, val) => `+${val} to maximum Life per ${per} Armour on Equipped Helmet`,
  },
  {
    zhPattern: /^装备法器的能量护盾(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Energy Shield from Equipped Focus`,
  },
  {
    zhPattern: /^同时获得\s*(\d+)\s*防卫$/,
    toEn: (_, v) => `+${v} to Ward`,
  },
  {
    zhPattern: /^冷却回复速度(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Cooldown Recovery Rate`,
  },
  {
    zhPattern: /^召唤生物的暴击伤害加成(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `Minions have ${v}% increased Critical Damage Bonus`,
  },
  {
    zhPattern: /^具有\s*(\d+)\s*个咒符位$/,
    toEn: (_, v) => `Has ${v} Charm Slots`,
  },
  {
    zhPattern: /^(?:(火焰|冰霜|冰冷|闪电|混沌)[和与](火焰|冰霜|冰冷|闪电|混沌)抗性\s*\+?(\d+)%|\+(\d+)%\s*(火焰|冰霜|冰冷|闪电|混沌)[和与](火焰|冰霜|冰冷|闪电|混沌)抗性)$/,
    toEn: (_, e1, e2, v1, v2, e3, e4) => {
      const v = v1 || v2;
      const first = ZH_DAMAGE_TYPE_TO_EN[e1 || e3] ?? (e1 || e3);
      const second = ZH_DAMAGE_TYPE_TO_EN[e2 || e4] ?? (e2 || e4);
      return `+${v}% to ${first} and ${second} Resistances`;
    },
  },
  {
    zhPattern: /^(火焰|冰霜|冰冷|闪电|混沌)抗性上限\s*([+-]?\d+)%$/,
    toEn: (_, el, v) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to maximum ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^([+-]?\d+)%\s*(?:最大)?(火焰|冰霜|冰冷|闪电|混沌)抗性上限$/,
    toEn: (_, v, el) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to maximum ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^\+(\d+)%\s*最大(火焰|冰霜|冰冷|闪电|混沌)抗性$/,
    toEn: (_, v, el) => `+${v}% to maximum ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^(火焰|冰霜|冰冷|闪电|混沌)抗性\s*([+-]?\d+)%$/,
    toEn: (_, el, v) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^([+-]?\d+)%\s*(火焰|冰霜|冰冷|闪电|混沌)抗性$/,
    toEn: (_, v, el) => `${v.startsWith('-') ? v : `+${v.replace(/^\+/, '')}`}% to ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  // Added flat damage
  {
    zhPattern: /^(?:击中)?附加\s*(\d+)\s*(?:-|–|~|到|至)\s*(\d+)\s*点?(?:基础)?(物理|火焰|冰霜|冰冷|闪电|混沌)伤害$/,
    toEn: (_, min, max, el) => `Adds ${min} to ${max} ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage`,
  },
  {
    zhPattern: /^法术附加\s*(\d+)\s*(?:-|–|~|到|至)\s*(\d+)\s*点?(?:基础)?(物理|火焰|冰霜|冰冷|闪电|混沌)伤害$/,
    toEn: (_, min, max, el) => `Adds ${min} to ${max} ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage to Spells`,
  },
  {
    zhPattern: /^攻击附加\s*(\d+)\s*(?:-|–|~|到|至)\s*(\d+)\s*点?(?:基础)?(物理|火焰|冰霜|冰冷|闪电|混沌)伤害$/,
    toEn: (_, min, max, el) => `Adds ${min} to ${max} ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage to Attacks`,
  },
  // Gain as Extra Damage (PoE 1 & PoE 2)
  {
    zhPattern: /^获得相当于伤害\s*(\d+)%\s*的所有元素额外伤害$/,
    toEn: (_, v) => `Gain ${v}% of Damage as Extra Elemental Damage`,
  },
  {
    zhPattern: /^获得相当于伤害\s*(\d+)%\s*的额外(火焰|冰霜|冰冷|闪电|混沌)伤害$/,
    toEn: (_, v, el) => `Gain ${v}% of Damage as Extra ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage`,
  },
  {
    zhPattern: /^获得相当于物理伤害\s*(\d+)%\s*的额外(火焰|冰霜|冰冷|闪电|混沌)伤害$/,
    toEn: (_, v, el) => `Gain ${v}% of Physical Damage as Extra ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage`,
  },
  {
    zhPattern: /^获得相当于元素伤害\s*(\d+)%\s*的额外混沌伤害$/,
    toEn: (_, v) => `Gain ${v}% of Elemental Damage as Extra Chaos Damage`,
  },
  // Increased / More Damage
  {
    zhPattern: /^(物理|火焰|冰霜|冰冷|闪电|混沌|元素)伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, el, v) => `${v}% increased ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage`,
  },
  {
    zhPattern: /^攻击(?:技能的?)?(物理|火焰|冰霜|冰冷|闪电|混沌|元素)伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, el, v) => `${v}% increased ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage with Attack Skills`,
  },
  {
    zhPattern: /^法术伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Spell Damage`,
  },
  {
    zhPattern: /^攻击伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Attack Damage`,
  },
  {
    zhPattern: /^投射物伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Projectile Damage`,
  },
  {
    zhPattern: /^近战物理伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Melee Physical Damage`,
  },
  {
    zhPattern: /^近战伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Melee Damage`,
  },
  {
    zhPattern: /^范围伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Area Damage`,
  },
  {
    zhPattern: /^伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Damage`,
  },
  {
    zhPattern: /^(物理|火焰|冰霜|冰冷|闪电|混沌|元素)伤害总增\s*(\d+)%$/,
    toEn: (_, el, v) => `${v}% more ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Damage`,
  },
  {
    zhPattern: /^法术伤害总增\s*(\d+)%$/,
    toEn: (_, v) => `${v}% more Spell Damage`,
  },
  {
    zhPattern: /^攻击伤害总增\s*(\d+)%$/,
    toEn: (_, v) => `${v}% more Attack Damage`,
  },
  {
    zhPattern: /^伤害总增\s*(\d+)%$/,
    toEn: (_, v) => `${v}% more Damage`,
  },
  // Speed
  {
    zhPattern: /^攻击[和与]施法速度(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Attack and Cast Speed`,
  },
  {
    zhPattern: /^攻击速度(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Attack Speed`,
  },
  {
    zhPattern: /^施法速度(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Cast Speed`,
  },
  {
    zhPattern: /^移动速度(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Movement Speed`,
  },
  // Crit
  {
    zhPattern: /^法术暴击(?:率|几率)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Critical Strike Chance for Spells`,
  },
  {
    zhPattern: /^全局暴击(?:率|几率)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Global Critical Strike Chance`,
  },
  {
    zhPattern: /^(?:攻击)?暴击(?:率|几率)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Critical Strike Chance`,
  },
  {
    zhPattern: /^(?:全局|法术)?暴击伤害加成(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `+${v}% to Global Critical Strike Multiplier`,
  },
  {
    zhPattern: /^(?:全局|法术)?暴击伤害加成\s*\+?(\d+)%$/,
    toEn: (_, v) => `+${v}% to Global Critical Strike Multiplier`,
  },
  {
    zhPattern: /^\+(\d+)%\s*(?:全局|法术)?暴击伤害加成$/,
    toEn: (_, v) => `+${v}% to Global Critical Strike Multiplier`,
  },
  // Accuracy, Block, Spell Suppression, Regen, Mana Regen, Penetration
  {
    zhPattern: /^(?:命中值?\s*\+?(\d+)|\+(\d+)\s*点?命中值?)$/,
    toEn: (_, a, b) => `+${a || b} to Accuracy Rating`,
  },
  {
    zhPattern: /^命中值?(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Accuracy Rating`,
  },
  {
    zhPattern: /^魔力(?:再生率|回复速度)(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Mana Regeneration Rate`,
  },
  {
    zhPattern: /^(?:法术伤害压制率\s*\+?(\d+)%|\+(\d+)%\s*法术伤害压制率)$/,
    toEn: (_, a, b) => `+${a || b}% chance to Suppress Spell Damage`,
  },
  {
    zhPattern: /^(?:\+(\d+)%\s*攻击格挡(?:率|几率)|攻击格挡(?:率|几率)\s*\+?(\d+)%)$/,
    toEn: (_, a, b) => `+${a || b}% Chance to Block Attack Damage`,
  },
  {
    zhPattern: /^(?:\+(\d+)%\s*法术格挡(?:率|几率)|法术格挡(?:率|几率)\s*\+?(\d+)%)$/,
    toEn: (_, a, b) => `+${a || b}% Chance to Block Spell Damage`,
  },
  {
    zhPattern: /^(?:每秒再生\s*(\d+(?:\.\d+)?)\s*(?:点)?生命|每秒(?:生命再生|回复)\s*(\d+(?:\.\d+)?)\s*(?:点)?生命?)$/,
    toEn: (_, a, b) => `Regenerate ${a || b} Life per second`,
  },
  {
    zhPattern: /^每秒(?:再生|回复|生命再生)\s*(\d+(?:\.\d+)?)%\s*(?:最大)?生命$/,
    toEn: (_, v) => `Regenerate ${v}% of Life per second`,
  },
  {
    zhPattern: /^(?:伤害|该武器的攻击)穿透\s*(\d+)%\s*的?(火焰|冰霜|冰冷|闪电|混沌|元素)抗性$/,
    toEn: (_, v, el) => `Damage Penetrates ${v}% ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^武器攻击的基础暴击率为\s*(\d+(?:\.\d+)?)%$/,
    toEn: (_, v) => `Base Critical Strike Chance for Attacks with Weapons is ${v}%`,
  },
  {
    zhPattern: /^击中基础暴击率\s*\+?(\d+(?:\.\d+)?)%$/,
    toEn: (_, v) => `Hits have +${v}% to Critical Strike Chance`,
  },
  {
    zhPattern: /^装备的胸甲提供的护甲翻倍$/,
    toEn: () => `Armour from Equipped Body Armour is doubled`,
  },
  {
    zhPattern: /^护甲值的\s*(\d+)%\s*同样作用于承受的火焰、冰霜和闪电击中伤害$/,
    toEn: (_, v) => `${v}% of Armour applies to Fire, Cold and Lightning Damage taken from Hits`,
  },
  {
    zhPattern: /^最大(暴击|狂怒|耐力)球数量\s*\+?(\d+)$/,
    toEn: (_, charge, v) => {
      const map: Record<string, string> = { 暴击: 'Power', 狂怒: 'Frenzy', 耐力: 'Endurance' };
      return `+${v} to Maximum ${map[charge] ?? charge} Charges`;
    },
  },
  {
    zhPattern: /^非诅咒光环效果(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased effect of Non-Curse Auras from your Skills`,
  },
  {
    zhPattern: /^诅咒效果(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Effect of your Curses`,
  },
  {
    zhPattern: /^(\d+)%\s*闪电伤害转化为冰霜伤害$/,
    toEn: (_, v) => `${v}% of Lightning Damage Converted to Cold Damage`,
  },
  {
    zhPattern: /^(\d+)%\s*冰霜伤害转化为火焰伤害$/,
    toEn: (_, v) => `${v}% of Cold Damage Converted to Fire Damage`,
  },
  {
    zhPattern: /^(\d+)%\s*火焰伤害转化为混沌伤害$/,
    toEn: (_, v) => `${v}% of Fire Damage Converted to Chaos Damage`,
  },
  {
    zhPattern: /^额外物理伤害减免\s*\+?(\d+)%$/,
    toEn: (_, v) => `+${v}% additional Physical Damage Reduction`,
  },
  {
    zhPattern: /^每个(暴击|狂怒|耐力)球使(法术)?伤害提高\s*(\d+)%$/,
    toEn: (_, charge, spell, v) => {
      const map: Record<string, string> = { 暴击: 'Power', 狂怒: 'Frenzy', 耐力: 'Endurance' };
      return `${v}% increased ${spell ? 'Spell ' : ''}Damage per ${map[charge] ?? charge} Charge`;
    },
  },
  {
    zhPattern: /^每个暴击球提供\s*\+?(\d+)%\s*暴击伤害加成$/,
    toEn: (_, v) => `+${v}% to Critical Strike Multiplier per Power Charge`,
  },
  {
    zhPattern: /^每\s*(\d+)\s*点(力量|敏捷|智慧)使(法术|攻击)?伤害提高\s*(\d+)%$/,
    toEn: (_, n, attr, scope, v) => {
      const scopeEn = scope === '法术' ? 'Spell ' : scope === '攻击' ? 'Attack ' : '';
      return `${v}% increased ${scopeEn}Damage per ${n} ${ZH_ATTR_TO_EN[attr] ?? attr}`;
    },
  },
  {
    zhPattern: /^伤害的\s*(\d+(?:\.\d+)?)%\s*偷取为(生命|能量护盾|魔力)$/,
    toEn: (_, v, pool) => {
      const map: Record<string, string> = { 生命: 'Life', 能量护盾: 'Energy Shield', 魔力: 'Mana' };
      return `${v}% of Damage Leeched as ${map[pool] ?? pool}`;
    },
  },
  {
    zhPattern: /^获得等同于最大魔力\s*(\d+)%\s*的额外最大能量护盾$/,
    toEn: (_, v) => `Gain ${v}% of Maximum Mana as Extra Maximum Energy Shield`,
  },
  {
    zhPattern: /^周围敌人的(火焰|冰霜|闪电|混沌)抗性\s*([+-]?\d+)%$/,
    toEn: (_, el, v) => `Nearby Enemies have ${v}% to ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Resistance`,
  },
  {
    zhPattern: /^被你嘲讽的敌人承受的伤害提高\s*(\d+)%$/,
    toEn: (_, v) => `Enemies Taunted by you take ${v}% increased Damage`,
  },
  {
    zhPattern: /^闪避值和护甲提高\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Evasion Rating and Armour`,
  },
  {
    zhPattern: /^最小(暴击|狂怒|耐力)球数量\s*\+?(\d+)$/,
    toEn: (_, charge, v) => {
      const map: Record<string, string> = { 暴击: 'Power', 狂怒: 'Frenzy', 耐力: 'Endurance' };
      return `+${v} to Minimum ${map[charge] ?? charge} Charges`;
    },
  },
  {
    zhPattern: /^每点怒火(?:同时)?提供\s*(\d+)%\s*攻击速度(?:提高|增加)$/,
    toEn: (_, v) => `Every Rage also grants ${v}% increased Attack Speed`,
  },
  {
    zhPattern: /^力量的伤害加成也作用于所有法术伤害$/,
    toEn: () => `Strength's Damage bonus applies to all Spell Damage as well`,
  },
  {
    zhPattern: /^受到的伤害(?:提高|增加)\s*(\d+)%$/,
    toEn: (_, v) => `${v}% increased Damage taken`,
  },
  // Skill Gem Level & Quality bonuses (PoE 1 & PoE 2 Chinese/TW clipboard / custom mods)
  {
    zhPattern: /^(?:\+(\d+)\s*)?所有技能(?:宝石|石)的?等级(?:\s*\+(\d+))?$/,
    toEn: (_, a, b) => `+${a || b} to Level of all Skill Gems`,
  },
  {
    zhPattern: /^(?:\+(\d+)\s*)?所有技能的?等级(?:\s*\+(\d+))?$/,
    toEn: (_, a, b) => `+${a || b} to Level of all Skills`,
  },
  {
    zhPattern: /^(?:\+(\d+)\s*)?所有(火焰|冰霜|冰冷|闪电|物理|混沌|元素)法术技能(?:宝石|石)?的?等级(?:\s*\+(\d+))?$/,
    toEn: (_, a, el, b) => `+${a || b} to Level of all ${ZH_DAMAGE_TYPE_TO_EN[el] ?? el} Spell Skill Gems`,
  },
  {
    zhPattern: /^(?:\+(\d+)\s*)?所有(法术|攻击|近战|投射物|弓|召唤生物|光环|诅咒|火焰|冰霜|冰冷|闪电|物理|混沌|元素)技能(?:宝石|石)?的?等级(?:\s*\+(\d+))?$/,
    toEn: (_, a, tag, b) => {
      const map: Record<string, string> = {
        法术: 'Spell',
        攻击: 'Attack',
        近战: 'Melee',
        投射物: 'Projectile',
        弓: 'Bow',
        召唤生物: 'Minion',
        光环: 'Aura',
        诅咒: 'Curse',
        ...ZH_DAMAGE_TYPE_TO_EN,
      };
      return `+${a || b} to Level of all ${map[tag] ?? tag} Skill Gems`;
    },
  },
  {
    zhPattern: /^(?:\+(\d+)%\s*)?所有技能(?:宝石|石)?的?品质(?:\s*\+(\d+)%)?$/,
    toEn: (_, a, b) => `+${a || b}% to Quality of all Skill Gems`,
  },
  {
    zhPattern: /^所有元素抗性上限\s*\+(\d+)%$/,
    toEn: (_, v) => `+${v}% to all maximum Elemental Resistances`,
  },
  {
    zhPattern: /^此物品上插槽中(?:(?:火焰|冰霜|冰冷|闪电|物理|混沌|元素|召唤生物|法术|攻击|光环|辅助|力量|敏捷|智慧)?)?(?:技能)?宝石等级\s*\+(\d+)$/,
    toEn: (full, v) => {
      const m = full.match(/插槽中(火焰|冰霜|冰冷|闪电|物理|混沌|元素|召唤生物|法术|攻击|光环|辅助|力量|敏捷|智慧)/);
      const map: Record<string, string> = {
        召唤生物: 'Minion',
        法术: 'Spell',
        攻击: 'Attack',
        光环: 'Aura',
        辅助: 'Support',
        力量: 'Strength',
        敏捷: 'Dexterity',
        智慧: 'Intelligence',
        ...ZH_DAMAGE_TYPE_TO_EN,
      };
      const tag = m?.[1] ? `${map[m[1]] ?? m[1]} ` : '';
      return `+${v} to Level of Socketed ${tag}Gems`;
    },
  },
];

const EN_TO_ZH_RULES: EnToZhRule[] = [
  { enPattern: /^\+(\d+) to maximum Life$/i, toZh: (_, v) => `最大生命 +${v}` },
  { enPattern: /^\+(\d+) to maximum Mana$/i, toZh: (_, v) => `最大魔力 +${v}` },
  { enPattern: /^\+(\d+) to maximum Energy Shield$/i, toZh: (_, v) => `最大能量护盾 +${v}` },
  { enPattern: /^\+(\d+) to Spirit$/i, toZh: (_, v) => `最大精魂 +${v}` },
  { enPattern: /^(\d+)% increased maximum Life$/i, toZh: (_, v) => `最大生命提高 ${v}%` },
  { enPattern: /^(\d+)% increased maximum Energy Shield$/i, toZh: (_, v) => `最大能量护盾提高 ${v}%` },
  { enPattern: /^(\d+)% increased Energy Shield$/i, toZh: (_, v) => `能量护盾提高 ${v}%` },
  { enPattern: /^(\d+)% increased maximum Mana$/i, toZh: (_, v) => `最大魔力提高 ${v}%` },
  { enPattern: /^(\d+)% increased Armour$/i, toZh: (_, v) => `护甲提高 ${v}%` },
  { enPattern: /^(\d+)% increased Evasion Rating$/i, toZh: (_, v) => `闪避值提高 ${v}%` },
  { enPattern: /^\+(\d+) to Armour$/i, toZh: (_, v) => `护甲 +${v}` },
  { enPattern: /^\+(\d+) to Evasion Rating$/i, toZh: (_, v) => `闪避值 +${v}` },
  {
    enPattern: /^\+(\d+) to (Strength|Dexterity|Intelligence|all Attributes)$/i,
    toZh: (_, v, attr) => `${EN_ATTR_TO_ZH[attr] ?? attr} +${v}`,
  },
  {
    enPattern: /^([+-]?\d+)% to all Elemental Resistances$/i,
    toZh: (_, v) => `全元素抗性 ${v}%`,
  },
  {
    enPattern: /^\+(\d+)% to maximum (Fire|Cold|Lightning|Chaos) Resistance$/i,
    toZh: (_, v, el) => `${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}抗性上限 +${v}%`,
  },
  {
    enPattern: /^([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i,
    toZh: (_, v, el) => `${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}抗性 ${v}%`,
  },
  {
    enPattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to Spells$/i,
    toZh: (_, min, max, el) => `法术附加 ${min} - ${max} 点${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害`,
  },
  {
    enPattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage to Attacks$/i,
    toZh: (_, min, max, el) => `攻击附加 ${min} - ${max} 点${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害`,
  },
  {
    enPattern: /^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i,
    toZh: (_, min, max, el) => `附加 ${min} - ${max} 点${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害`,
  },
  {
    enPattern: /^(\d+)% increased (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage with Attack Skills$/i,
    toZh: (_, v, el) => `攻击${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% increased (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i,
    toZh: (_, v, el) => `${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% more (Physical|Fire|Cold|Lightning|Chaos|Elemental) Damage$/i,
    toZh: (_, v, el) => `${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害总增 ${v}%`,
  },
  { enPattern: /^(\d+)% increased Spell Damage$/i, toZh: (_, v) => `法术伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Spell Damage$/i, toZh: (_, v) => `法术伤害总增 ${v}%` },
  { enPattern: /^(\d+)% increased Attack Damage$/i, toZh: (_, v) => `攻击伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Attack Damage$/i, toZh: (_, v) => `攻击伤害总增 ${v}%` },
  { enPattern: /^(\d+)% increased Projectile Damage$/i, toZh: (_, v) => `投射物伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Projectile Damage$/i, toZh: (_, v) => `投射物伤害总增 ${v}%` },
  { enPattern: /^(\d+)% increased Melee Damage$/i, toZh: (_, v) => `近战伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Melee Damage$/i, toZh: (_, v) => `近战伤害总增 ${v}%` },
  { enPattern: /^(\d+)% increased Area Damage$/i, toZh: (_, v) => `范围伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Area Damage$/i, toZh: (_, v) => `范围伤害总增 ${v}%` },
  { enPattern: /^(\d+)% increased Damage$/i, toZh: (_, v) => `伤害提高 ${v}%` },
  { enPattern: /^(\d+)% more Damage$/i, toZh: (_, v) => `伤害总增 ${v}%` },
  { enPattern: /^(\d+)% less Damage$/i, toZh: (_, v) => `伤害总降 ${v}%` },
  { enPattern: /^(\d+)% increased Attack and Cast Speed$/i, toZh: (_, v) => `攻击和施法速度提高 ${v}%` },
  { enPattern: /^(\d+)% increased Attack Speed$/i, toZh: (_, v) => `攻击速度提高 ${v}%` },
  { enPattern: /^(\d+)% more Attack Speed$/i, toZh: (_, v) => `攻击速度总增 ${v}%` },
  { enPattern: /^(\d+)% increased Cast Speed$/i, toZh: (_, v) => `施法速度提高 ${v}%` },
  { enPattern: /^(\d+)% more Cast Speed$/i, toZh: (_, v) => `施法速度总增 ${v}%` },
  { enPattern: /^(\d+)% increased Movement Speed$/i, toZh: (_, v) => `移动速度提高 ${v}%` },
  { enPattern: /^(\d+)% increased Critical Strike Chance for Spells$/i, toZh: (_, v) => `法术暴击率提高 ${v}%` },
  { enPattern: /^(\d+)% increased Critical Strike Chance$/i, toZh: (_, v) => `暴击率提高 ${v}%` },
  { enPattern: /^\+(\d+)% to Global Critical Strike Multiplier$/i, toZh: (_, v) => `全局暴击伤害加成 +${v}%` },
  { enPattern: /^\+(\d+)% to Critical Strike Multiplier$/i, toZh: (_, v) => `暴击伤害加成 +${v}%` },
  {
    enPattern: /^(?:Hits have )?\+(\d+(?:\.\d+)?)% to Critical Strike Chance$/i,
    toZh: (_, v) => `击中基础暴击率 +${v}%`,
  },
  {
    enPattern: /^Armour from Equipped Body Armour is doubled$/i,
    toZh: () => `装备的胸甲提供的护甲翻倍`,
  },
  {
    enPattern: /^(\d+)% of Armour applies to Fire, Cold and Lightning Damage taken from Hits$/i,
    toZh: (_, v) => `护甲值的 ${v}% 同样作用于承受的火焰、冰霜和闪电击中伤害`,
  },
  {
    enPattern: /^\+(\d+) to Maximum (Power|Frenzy|Endurance) Charges?$/i,
    toZh: (_, v, charge) => {
      const map: Record<string, string> = { Power: '暴击', Frenzy: '狂怒', Endurance: '耐力' };
      return `最大${map[charge] ?? charge}球数量 +${v}`;
    },
  },
  {
    enPattern: /^(\d+)% increased effect of Non-Curse Auras from your Skills$/i,
    toZh: (_, v) => `非诅咒光环效果提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% increased Aura Effect$/i,
    toZh: (_, v) => `非诅咒光环效果提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% increased Effect of (?:your )?Curses$/i,
    toZh: (_, v) => `诅咒效果提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% of Lightning Damage Converted to Cold Damage$/i,
    toZh: (_, v) => `${v}% 闪电伤害转化为冰霜伤害`,
  },
  {
    enPattern: /^(\d+)% of Cold Damage Converted to Fire Damage$/i,
    toZh: (_, v) => `${v}% 冰霜伤害转化为火焰伤害`,
  },
  {
    enPattern: /^(\d+)% of Fire Damage Converted to Chaos Damage$/i,
    toZh: (_, v) => `${v}% 火焰伤害转化为混沌伤害`,
  },
  {
    enPattern: /^\+(\d+)% additional Physical Damage Reduction$/i,
    toZh: (_, v) => `额外物理伤害减免 +${v}%`,
  },
  {
    enPattern: /^(\d+)% increased (Spell )?Damage per (Power|Frenzy|Endurance) Charge$/i,
    toZh: (_, v, spell, charge) => {
      const map: Record<string, string> = { Power: '暴击', Frenzy: '狂怒', Endurance: '耐力' };
      return `每个${map[charge] ?? charge}球使${spell ? '法术' : ''}伤害提高 ${v}%`;
    },
  },
  {
    enPattern: /^\+(\d+)% to Critical Strike Multiplier per Power Charge$/i,
    toZh: (_, v) => `每个暴击球提供 +${v}% 暴击伤害加成`,
  },
  {
    enPattern: /^(\d+)% increased (Spell |Attack |)?Damage per (\d+) (Strength|Dexterity|Intelligence)$/i,
    toZh: (_, v, scope, n, attr) => {
      const scopeZh = scope?.trim() === 'Spell' ? '法术' : scope?.trim() === 'Attack' ? '攻击' : '';
      return `每 ${n} 点${EN_ATTR_TO_ZH[attr] ?? attr}使${scopeZh}伤害提高 ${v}%`;
    },
  },
  {
    enPattern: /^(\d+(?:\.\d+)?)% of Damage Leeched as (Life|Energy Shield|Mana)$/i,
    toZh: (_, v, pool) => {
      const map: Record<string, string> = { Life: '生命', 'Energy Shield': '能量护盾', Mana: '魔力' };
      return `伤害的 ${v}% 偷取为${map[pool] ?? pool}`;
    },
  },
  {
    enPattern: /^Gain (\d+)% of Maximum Mana as Extra Maximum Energy Shield$/i,
    toZh: (_, v) => `获得等同于最大魔力 ${v}% 的额外最大能量护盾`,
  },
  {
    enPattern: /^Nearby Enemies have ([+-]?\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/i,
    toZh: (_, v, el) => `周围敌人的${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}抗性 ${v}%`,
  },
  {
    enPattern: /^Enemies Taunted by you take (\d+)% increased Damage$/i,
    toZh: (_, v) => `被你嘲讽的敌人承受的伤害提高 ${v}%`,
  },
  {
    enPattern: /^(\d+)% increased Evasion Rating and Armour$/i,
    toZh: (_, v) => `闪避值和护甲提高 ${v}%`,
  },
  {
    enPattern: /^\+(\d+) to Minimum (Power|Frenzy|Endurance) Charges?$/i,
    toZh: (_, v, charge) => {
      const map: Record<string, string> = { Power: '暴击', Frenzy: '狂怒', Endurance: '耐力' };
      return `最小${map[charge] ?? charge}球数量 +${v}`;
    },
  },
  { enPattern: /^\+(\d+) to Accuracy Rating$/i, toZh: (_, v) => `命中值 +${v}` },
  { enPattern: /^\+(\d+)% chance to Suppress Spell Damage$/i, toZh: (_, v) => `法术伤害压制率 +${v}%` },
  { enPattern: /^\+(\d+)% Chance to Block Attack Damage$/i, toZh: (_, v) => `攻击格挡率 +${v}%` },
  { enPattern: /^\+(\d+)% Chance to Block Spell Damage$/i, toZh: (_, v) => `法术格挡率 +${v}%` },
  { enPattern: /^Regenerate (\d+(?:\.\d+)?) Life per second$/i, toZh: (_, v) => `每秒再生 ${v} 生命` },
  { enPattern: /^Regenerate (\d+(?:\.\d+)?)% of Life per second$/i, toZh: (_, v) => `每秒再生 ${v}% 生命` },
  {
    enPattern: /^Damage Penetrates (\d+)% (Fire|Cold|Lightning|Chaos|Elemental) Resistance$/i,
    toZh: (_, v, el) => `伤害穿透 ${v}% ${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}抗性`,
  },
  {
    enPattern: /^(\d+)% of Physical Damage Converted to (Fire|Cold|Lightning|Chaos) Damage$/i,
    toZh: (_, v, el) => `${v}% 物理伤害转化为${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害`,
  },
  {
    enPattern: /^Gain (\d+)% of Physical Damage as Extra (Fire|Cold|Lightning|Chaos) Damage$/i,
    toZh: (_, v, el) => `获得相当于物理伤害 ${v}% 的额外${EN_DAMAGE_TYPE_TO_ZH[el] ?? el}伤害`,
  },
  {
    enPattern: /^Gain (\d+)% of Elemental Damage as Extra Chaos Damage$/i,
    toZh: (_, v) => `获得相当于元素伤害 ${v}% 的额外混沌伤害`,
  },
  {
    enPattern: /^Your Hits can't be Evaded$/i,
    toZh: () => `你的击中无法被闪避`,
  },
  {
    enPattern: /^Never deal Critical Strikes$/i,
    toZh: () => `永远不会造成暴击`,
  },
  {
    enPattern: /^Maximum Life becomes 1, Immune to Chaos Damage$/i,
    toZh: () => `最大生命变为 1，免疫混沌伤害`,
  },
  {
    enPattern: /^30% of Damage is taken from Mana before Life$/i,
    toZh: () => `承受伤害的 30% 优先从魔力扣除`,
  },
  {
    enPattern: /^\+(\d+) to Level of all Skill Gems$/i,
    toZh: (_, v) => `所有技能宝石等级 +${v}`,
  },
  {
    enPattern: /^\+(\d+) to Level of all Skills$/i,
    toZh: (_, v) => `所有技能等级 +${v}`,
  },
  {
    enPattern: /^\+(\d+)% to Quality of all Skill Gems$/i,
    toZh: (_, v) => `所有技能宝石品质 +${v}%`,
  },
  {
    enPattern: /^\+(\d+) to Level of all (Fire|Cold|Lightning|Physical|Chaos|Elemental) Spell (?:Skill Gems|Skills)$/i,
    toZh: (_, v, el) => {
      const map: Record<string, string> = {
        Fire: '火焰',
        Cold: '冰霜',
        Lightning: '闪电',
        Physical: '物理',
        Chaos: '混沌',
        Elemental: '元素',
      };
      return `所有${map[el] ?? el}法术技能等级 +${v}`;
    },
  },
  {
    enPattern: /^\+(\d+) to Level of all (Spell|Attack|Melee|Projectile|Bow|Minion|Aura|Curse|Fire|Cold|Lightning|Physical|Chaos|Elemental) (?:Skill Gems|Skills)$/i,
    toZh: (_, v, tag) => {
      const map: Record<string, string> = {
        Spell: '法术',
        Attack: '攻击',
        Melee: '近战',
        Projectile: '投射物',
        Bow: '弓',
        Minion: '召唤生物',
        Aura: '光环',
        Curse: '诅咒',
        Fire: '火焰',
        Cold: '冰霜',
        Lightning: '闪电',
        Physical: '物理',
        Chaos: '混沌',
        Elemental: '元素',
      };
      return `所有${map[tag] ?? tag}技能等级 +${v}`;
    },
  },
  {
    enPattern: /^\+(\d+) to Level of Socketed Gems$/i,
    toZh: (_, v) => `此物品上插槽中宝石等级 +${v}`,
  },
  {
    enPattern: /^\+(\d+)% to all maximum Elemental Resistances$/i,
    toZh: (_, v) => `所有元素抗性上限 +${v}%`,
  },
];

/**
 * Normalizes a Chinese (or already English) modifier line into canonical English
 * so `@webpob/calc`'s ModParser produces identical results regardless of input language.
 */
export function normalizeStatLineToEn(rawLine: string): string {
  // Preserve English keys embedded in PoE 2 / WeGame inline markup before stripping brackets:
  // e.g. "配置 [DeliriumAnoint_Paragon|典范]" -> "Allocates Paragon"
  // e.g. "[LegacyOfBismuth|灰岩] 继承" -> "Legacy of Bismuth"
  const rawTrimmed = rawLine.trim();
  const legacyMarkup = rawTrimmed.match(/^\[LegacyOf([A-Za-z]+)\|[^\]]+\]\s*继承$/i);
  if (legacyMarkup) {
    return `Legacy of ${legacyMarkup[1]}`;
  }
  const anointMarkup = rawTrimmed.match(/^配置\s*\[DeliriumAnoint_([A-Za-z0-9_]+)\|[^\]]+\]$/i);
  if (anointMarkup) {
    const spaced = anointMarkup[1]!
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
    return `Allocates ${spaced}`;
  }

  const preCleaned = rawTrimmed
    .replace(/\[(?:[^|\]]+\|)?([^\]]+)\]/g, '$1')
    .replace(/^\{[^}]+\}\s*/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(
      /\((?:implicit|crafted|enchant|fractured|rune|desecrated|scourge|mutated|augmented|unmet|crucible|veiled|synthetic)\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!preCleaned) return '';

  // Preserve PoE 2 Shaman-only Bonded prefix ("Bonded:" / "羁绊：" / "羈絆：") so the calc engine
  // activates Bonded modifiers ONLY for Shaman ascendancy characters.
  const bondedMatch = preCleaned.match(/^(?:Bonded|羁绊|羈絆)\s*[：:]\s*(.+)$/i);
  const isBonded = Boolean(bondedMatch);
  const cleaned = bondedMatch ? bondedMatch[1]!.trim() : preCleaned;
  if (!cleaned) return '';

  const wrapBonded = (en: string) => (isBonded ? `Bonded: ${en}` : en);

  // Fast path if purely ASCII
  if (/^[\x00-\x7F]+$/.test(cleaned)) {
    return wrapBonded(cleaned);
  }

  // Normalize Traditional Chinese (International TW) modifiers to Simplified Chinese
  // so both CN and TW client lines reuse the full rule table seamlessly.
  const normalized = toSimplifiedZh(cleaned);

  // PoE 2 Time-Lost / Against the Darkness / Controlled Metamorphosis radius jewel modifiers
  const mNotableGrant = normalized.match(/^范围内的核心天赋同时提供\s+(.+)$/);
  if (mNotableGrant) {
    return wrapBonded(`Notable Passive Skills in Radius also grant ${normalizeStatLineToEn(mNotableGrant[1]!)}`);
  }
  const mSmallGrant = normalized.match(/^范围内的小型?天赋同时提供\s+(.+)$/);
  if (mSmallGrant) {
    return wrapBonded(`Small Passive Skills in Radius also grant ${normalizeStatLineToEn(mSmallGrant[1]!)}`);
  }
  const mNotableEff = normalized.match(/^范围内的核心天赋效果(?:提高|增加)\s*(\d+)%$/);
  if (mNotableEff) {
    return wrapBonded(`Notable Passive Skills in Radius have ${mNotableEff[1]}% increased Effect`);
  }
  const mSmallEff = normalized.match(/^范围内的小型?天赋效果(?:提高|增加)\s*(\d+)%$/);
  if (mSmallEff) {
    return wrapBonded(`Small Passive Skills in Radius have ${mSmallEff[1]}% increased Effect`);
  }
  const mUpgradeRadius = normalized.match(/^将范围升级为(中型|大型|极大型)$/);
  if (mUpgradeRadius) {
    const rMap: Record<string, string> = { 中型: 'Medium', 大型: 'Large', 极大型: 'Very Large' };
    return wrapBonded(`Upgrades radius to ${rMap[mUpgradeRadius[1]!] ?? mUpgradeRadius[1]}`);
  }
  const mRingRadius = normalized.match(/^只影响(小型|中型|大型|非常大型|巨大)环形范围内的天赋$/);
  if (mRingRadius) {
    const rMap: Record<string, string> = {
      小型: 'Small',
      中型: 'Medium',
      大型: 'Large',
      非常大型: 'Very Large',
      巨大: 'Massive',
    };
    return wrapBonded(`Only affects Passives in ${rMap[mRingRadius[1]!] ?? mRingRadius[1]} Ring`);
  }
  // Strip local-item prefixes like "该装备的护甲提高 85%" / "该武器附加 12 - 24 点物理伤害"
  const withoutLocalPrefix = normalized.replace(/^(?:该|此)(?:装备|物品|武器)的?\s*/, '').trim();
  const baseCandidates =
    withoutLocalPrefix && withoutLocalPrefix !== normalized
      ? [normalized, withoutLocalPrefix]
      : [normalized];

  const candidates: string[] = [];
  for (const base of baseCandidates) {
    candidates.push(base);
    // Handle TW prefix-style "提高/增加 X% Y伤害" (e.g. "增加 24% 法術傷害" -> "法术伤害提高 24%")
    const twPrefixInc = base.match(/^(?:提高|增加)\s*(\d+)%\s*(.+)$/);
    if (twPrefixInc) {
      candidates.push(`${twPrefixInc[2]!.trim()}提高 ${twPrefixInc[1]}%`);
    }
  }

  for (const cand of candidates) {
    for (const rule of ZH_TO_EN_RULES) {
      const match = cand.match(rule.zhPattern);
      if (match) {
        return wrapBonded(rule.toEn(...match));
      }
    }
  }

  return wrapBonded(cleaned);
}

/**
 * Formats a canonical English stat line into the active UI locale.
 */
export function localizeStatLine(enLine: string, locale: Locale): string {
  if (locale === 'en') return enLine;
  const trimmed = enLine.trim();
  const bondedMatch = trimmed.match(/^Bonded:\s*(.+)$/i);
  const body = bondedMatch ? bondedMatch[1]!.trim() : trimmed;
  const prefix = bondedMatch ? (locale === 'zh-TW' ? '羈絆：' : '羁绊：') : '';
  for (const rule of EN_TO_ZH_RULES) {
    const match = body.match(rule.enPattern);
    if (match) {
      const zh = rule.toZh(...match);
      return `${prefix}${locale === 'zh-TW' ? toTraditionalZh(zh) : zh}`;
    }
  }
  return `${prefix}${locale === 'zh-TW' ? toTraditionalZh(body) : body}`;
}
