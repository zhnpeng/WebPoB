import { describe, expect, it } from 'vitest';
import { createEmptyBuild } from '@webpob/data';
import type { Item, PassiveNode } from '@webpob/core';
import { createEmptyCalcOutput } from './emptyCalcOutput';
import {
  canWieldTwoHandedMartialInOneHand,
  canWieldWeaponInOneHand,
  hasCantUseBodyArmour,
} from './itemSlotRules';

describe('emptyCalcOutput & itemSlotRules (main-thread lightweight helpers)', () => {
  it('produces finite zero-NaN placeholder CalcOutput for both PoE 1 and PoE 2', () => {
    for (const game of ['poe1', 'poe2'] as const) {
      const build = createEmptyBuild(game);
      const calc = createEmptyCalcOutput(build);
      expect(calc.game).toBe(game);
      expect(Number.isFinite(calc.offence.totalDps)).toBe(true);
      expect(Number.isFinite(calc.defence.effectiveHitPool)).toBe(true);
      expect(calc.defence.spirit).toBe(game === 'poe2' ? 100 : 0);
      expect(calc.defence.fireMaxResist).toBe(75);
    }
  });

  it("recognizes Giant's Blood keystone and Bringer of Rain item constraints in PoE 2", () => {
    const poe2Build = createEmptyBuild('poe2');
    expect(canWieldTwoHandedMartialInOneHand(poe2Build, [])).toBe(false);
    expect(hasCantUseBodyArmour(poe2Build)).toBe(false);

    const giantsBloodNode: PassiveNode = {
      id: 99999,
      name: { en: "Giant's Blood", zh: '巨人之血' },
      kind: 'keystone',
      x: 0,
      y: 0,
      stats: ['You can wield Two-Handed Axes, Maces and Swords in one hand'],
      adjacent: [],
    };
    expect(canWieldTwoHandedMartialInOneHand(poe2Build, [giantsBloodNode])).toBe(true);
    expect(canWieldWeaponInOneHand({ weaponType: 'Mace', twoHanded: true }, true)).toBe(true);
    expect(canWieldWeaponInOneHand({ weaponType: 'Bow', twoHanded: true }, true)).toBe(false);

    const bringerHelmet: Item = {
      id: 'helm_bor',
      name: '祭礼之雨',
      baseName: 'Greathelm',
      rarity: 'UNIQUE',
      slotType: 'Helmet',
      quality: 20,
      implicits: [],
      explicits: ['无法使用胸甲'],
    };
    const withBringer = {
      ...poe2Build,
      items: { [bringerHelmet.id]: bringerHelmet },
      equipped: { Helmet: bringerHelmet.id },
    };
    expect(canWieldTwoHandedMartialInOneHand(withBringer, [])).toBe(true);
    expect(hasCantUseBodyArmour(withBringer)).toBe(true);
  });
});
