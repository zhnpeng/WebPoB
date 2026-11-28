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
});
