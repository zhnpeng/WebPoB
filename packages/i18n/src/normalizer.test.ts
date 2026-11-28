import { describe, expect, it } from 'vitest';
import { localizeStatLine, normalizeStatLineToEn } from './normalizer.js';

describe('normalizer bilingual parity (PoE 1 & PoE 2)', () => {
  const roundTripCases: Array<{ zh: string; en: string }> = [
    // PoE 2 Crossbow reload & bolt count
    { zh: '弩装填速度提高 25%', en: '25% increased Crossbow Reload Speed' },
    { zh: '弩可额外装填 1 发弩箭', en: 'Crossbows load an additional Bolt' },
    { zh: '可额外装填 1 发弩箭', en: 'Loads an additional Bolt' },
    { zh: '有 15% 几率不消耗弩箭', en: '15% chance to not consume a Bolt' },
    // PoE 2 Archon / Culling / Spirit / Reservation
    { zh: '执政官增益效果提高 30%', en: '30% increased Effect of Archon Buffs on you' },
    { zh: '扑杀阈值提高 20%', en: '20% increased Culling Strike Threshold' },
    { zh: '扑杀', en: 'Culling Strike' },
    { zh: '精魂提高 12%', en: '12% increased Spirit' },
    { zh: '精魂保留效能提高 18%', en: '18% increased Spirit Reservation Efficiency' },
    { zh: '技能的魔力保留效能提高 16%', en: '16% increased Mana Reservation Efficiency of Skills' },
    // Exposure / Curse & Ailment Magnitudes / Aura Magnitude
    { zh: '诅咒幅度提高 18%', en: '18% increased Curse Magnitudes' },
    { zh: '光环技能幅度提高 15%', en: 'Aura Skills have 15% increased Magnitude' },
    { zh: '你可以额外施加 1 个诅咒', en: 'You can apply an additional Curse' },
    {
      zh: '你施加的曝露使对应抗性额外降低 12%',
      en: 'Exposure you inflict lowers the affected Resistance by an additional 12%',
    },
    {
      zh: '你施加的火焰曝露使总火焰抗性额外降低 10%',
      en: 'Fire Exposure you inflict lowers Total Fire Resistance by an extra 10%',
    },
    { zh: '凋零幅度提高 20%', en: '20% increased Withered Magnitude' },
    { zh: '感电幅度提高 25%', en: '25% increased Magnitude of Shock you inflict' },
    // Ward
    { zh: '结界 +120', en: '+120 to Ward' },
    { zh: '结界提高 35%', en: '35% increased Ward' },
    { zh: '结界恢复速度加快 40%', en: '40% faster Restoration of Ward' },
    // PoE 1 Impale / Overleech / Suppression / DoT Multiplier
    { zh: '攻击击中时有 20% 几率穿刺敌人', en: '20% chance to Impale Enemies on Hit with Attacks' },
    { zh: '穿刺效果提高 15%', en: '15% increased Impale Effect' },
    {
      zh: '未保留生命回满时不会移除生命偷取效果',
      en: 'Life Leech effects are not removed when Unreserved Life is Filled',
    },
    { zh: '压制法术伤害时额外防止 +5% 伤害', en: 'Prevent +5% of Suppressed Spell Damage' },
    { zh: '物理持续伤害加成 +14%', en: '+14% to Physical Damage over Time Multiplier' },
    { zh: '持续伤害加成 +10%', en: '+10% to Damage over Time Multiplier' },
    // Keystones (3.30 / Timeless / PoE 2)
    { zh: '灵魂升华', en: 'Transfiguration of Soul' },
    { zh: '心灵升华', en: 'Transfiguration of Mind' },
    { zh: '躯体升华', en: 'Transfiguration of Body' },
    { zh: '腐化之魂', en: 'Corrupted Soul' },
    { zh: '神圣血肉', en: 'Divine Flesh' },
    { zh: '永恒青春', en: 'Eternal Youth' },
    { zh: '苦痛灵曲', en: 'Pain Attunement' },
    { zh: '钢铁意志', en: 'Iron Will' },
    { zh: '零点射击', en: 'Point Blank' },
    { zh: '巨人之血', en: "Giant's Blood" },
  ];

  it('normalizes ZH-CN stat lines to canonical English', () => {
    for (const { zh, en } of roundTripCases) {
      expect(normalizeStatLineToEn(zh)).toBe(en);
    }
  });

  it('localizes canonical English stat lines back to ZH-CN and ZH-TW', () => {
    for (const { zh, en } of roundTripCases) {
      const zhCn = localizeStatLine(en, 'zh-CN');
      expect(zhCn).not.toBe(en);
      expect(normalizeStatLineToEn(zhCn)).toBe(en);

      const zhTw = localizeStatLine(en, 'zh-TW');
      expect(zhTw).not.toBe(en);
      expect(normalizeStatLineToEn(zhTw)).toBe(en);
      expect(zh).toBeTruthy();
    }
  });

  it('preserves Bonded prefix across ZH-CN, ZH-TW, and EN', () => {
    expect(normalizeStatLineToEn('羁绊：弩装填速度提高 15%')).toBe(
      'Bonded: 15% increased Crossbow Reload Speed',
    );
    expect(normalizeStatLineToEn('羈絆：精魂提高 10%')).toBe('Bonded: 10% increased Spirit');
    expect(localizeStatLine('Bonded: 15% increased Crossbow Reload Speed', 'zh-CN')).toBe(
      '羁绊：弩装填速度提高 15%',
    );
    expect(localizeStatLine('Bonded: 20% increased Critical Damage Bonus', 'zh-CN')).toBe(
      '羁绊：暴击伤害加成提高 20%',
    );
    expect(localizeStatLine('18% increased Critical Spell Damage Bonus', 'zh-CN')).toBe(
      '法术暴击伤害加成提高 18%',
    );
  });

  it('normalizes and localizes top 12 poe2-wegame-cn Chinese mod lines (Wave 6G Addendum)', () => {
    const wegameCases: Array<{ zh: string; en: string }> = [
      { zh: '暴击几率 +7.79%', en: '+7.79% to Critical Hit Chance' },
      { zh: '暴击球数量上限 +1', en: '+1 to Maximum Power Charges' },
      { zh: '召唤生物的伤害提高 47%', en: 'Minions deal 47% increased Damage' },
      { zh: '投射物速度提高 23%', en: '23% increased Projectile Speed' },
      {
        zh: '获得相当于闪避值 21% 的偏转值',
        en: 'Gain Deflection Rating equal to 21% of Evasion Rating',
      },
      { zh: '将所受伤害的10%吸纳为生命', en: '10% of Damage Taken Recouped as Life' },
      { zh: '生命每秒再生 22.4', en: 'Regenerate 22.4 Life per second' },
      {
        zh: '在场的友军获得相当于伤害 28% 的额外火焰伤害',
        en: 'Allies in your Presence Gain 28% of Damage as Extra Fire Damage',
      },
      {
        zh: '在场的敌人根据最低的抗性抵抗元素伤害',
        en: 'Enemies in your Presence resist Elemental Damage based on their Lowest Resistance',
      },
      { zh: '属性需求降低 15%', en: '15% reduced Attribute Requirements' },
      { zh: '你受到的诅咒效果降低 50%', en: '50% reduced Effect of Curses on you' },
      { zh: '晕眩阈值提高 20%', en: '20% increased Stun Threshold' },
      { zh: '+361 晕眩阈值', en: '+361 to Stun Threshold' },
    ];

    for (const { zh, en } of wegameCases) {
      expect(normalizeStatLineToEn(zh)).toBe(en);
      const zhCn = localizeStatLine(en, 'zh-CN');
      expect(zhCn).not.toBe(en);
      expect(normalizeStatLineToEn(zhCn)).toBe(en);
    }
  });

  it('normalizes Wave 6H poe2-wegame-cn combat, minion, presence, unique & Time-Lost lines', () => {
    const cases: Array<[string, string]> = [
      ['你不具有精魂', 'You have no Spirit'],
      ['你不具有元素抗性', 'You have no Elemental Resistances'],
      ['50% 的伤害优先从魔力扣除', '50% of Damage is taken from Mana before Life'],
      ['Bonded: 生命上限的 8% 转化为能量护盾', 'Bonded: 8% of Maximum Life Converted to Energy Shield'],
      ['你的暴击伤害加成为 250%', 'Your Critical Damage Bonus is 250%'],
      ['攻击伤害的暴击伤害加成 20%', '20% increased Critical Damage Bonus for Attacks'],
      ['Notable Passive Skills in Radius also grant 攻击伤害的暴击伤害加成 9%', 'Notable Passive Skills in Radius also grant 9% increased Critical Damage Bonus for Attacks'],
      ['范围内显赫天赋同时提供 战矛暴击伤害加成 12%', 'Notable Passive Skills in Radius also grant 12% increased Critical Damage Bonus with Spears'],
      ['每 100 生命上限使非吟唱法术的暴击率提高 5%', 'Non-Channelling Spells have 5% increased Critical Hit Chance per 100 maximum Life'],
      ['每 100 生命上限使非吟唱法术的伤害提高 10%', 'Non-Channelling Spells deal 10% increased Damage per 100 maximum Life'],
      ['召唤生物的攻击和施法速度提高 3%', 'Minions have 3% increased Attack and Cast Speed'],
      ['召唤生物的暴击率提高 12%', 'Minions have 12% increased Critical Hit Chance'],
      ['召唤生物的生命上限提高 43%', 'Minions have 43% increased maximum Life'],
      ['召唤生物有 +3% 元素抗性', 'Minions have +3% to all Elemental Resistances'],
      ['召唤生物技能的保留效能提高 8%', 'Minion Skills have 8% increased Reservation Efficiency'],
      ['技能的精魂保留效能提高 7%', '7% increased Spirit Reservation Efficiency of Skills'],
      ['在场的友军造成的伤害提高 40%', 'Allies in your Presence deal 40% increased Damage'],
      ['在场的友军的暴击几率提高 36%', 'Allies in your Presence have 36% increased Critical Hit Chance'],
      ['在场的友军附加 8 - 12 攻击冰霜伤害', 'Allies in your Presence deal 8 to 12 additional Attack Cold Damage'],
      ['在场范围提高 50%', '50% increased Presence Area of Effect'],
      ['物理攻击伤害的 8.71% 转化为生命偷取', '8.71% of Physical Attack Damage Leeched as Life'],
      ['格挡几率提高 15%', '15% increased Block chance'],
      ['物品稀有度提高 15%', '15% increased Rarity of Items found'],
      ['此药剂无法使用，但效果持续生效', 'This Flask cannot be used, but its Effect is always active'],
      ['装备的戒指加成效果提高 50%', '50% increased bonuses gained from Equipped Rings'],
      ['击败敌人时有 25% 的几率获得一个能量球', '25% chance to gain a Charge on Kill'],
      ['魔力在击败敌人时恢复 3%', 'Recover 3% of Mana on Kill'],
      ['Bonded: 你身上的执政官增益效果提高 40%', 'Bonded: 40% increased Effect of Archon Buffs on you'],
      ['Bonded: 诅咒强度提高 8%', 'Bonded: 8% increased Curse Magnitudes'],
      ['Bonded: 变形时伤害提高 40%', 'Bonded: 40% increased Damage while Shapeshifted'],
      ['效果期间获得猛攻', 'Gain Onslaught during Effect'],
      ['具有 2 个咒符位', 'Has 2 Charm Slots'],
      ['对稀有或传奇敌人的攻击伤害提高 30%', '30% increased Attack Damage against Rare or Unique Enemies'],
      ['对稀有或传奇敌人的伤害提高 25%', '25% increased Damage against Rare or Unique Enemies'],
      ['使用时开始能量护盾充能', 'Energy Shield Recharge starts on use'],
      ['效果期间将所受伤害的 28% 吸纳为生命', '28% of Damage Taken Recouped as Life during Effect'],
      ['效果期间被敌人击中时获得 3 点怒火', 'Gain 3 Rage when Hit by an Enemy during Effect'],
      ['效果期间不具有固有的怒火损失', 'No inherent loss of Rage during Effect'],
      ['Bonded: 执政官间隔期的消减速度加快 30%', 'Bonded: Archon recovery period expires 30% faster'],
      ['充能次数提高 47%', '47% increased Charges'],
      ['获得的充能提高 55%', '55% increased Charges gained'],
      ['每次使用消耗的充能次数降低 27%', '27% reduced Charges per use'],
      ['回复量提高 60%', '60% increased Amount Recovered'],
      ['回复量降低 70%', '70% reduced Amount Recovered'],
      ['允许的前缀 -1', '-1 Prefix Modifier allowed'],
      ['允许的后缀 +1', '+1 Suffix Modifier allowed'],
      ['生命回复提高 99%', '99% increased Life Recovery'],
    ];

    for (const [zh, en] of cases) {
      expect(normalizeStatLineToEn(zh)).toBe(en);
    }
  });
});
