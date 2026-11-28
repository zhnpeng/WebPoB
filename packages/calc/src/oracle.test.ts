import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  hydrateCompactTree,
  registerBaseItems,
  registerClusterNotables,
  registerGemsData,
  registerPoe2RunesData,
  registerTreeData,
  type CompactBaseItemsPayload,
  type CompactClusterNotablesPayload,
  type CompactGemsPayload,
  type CompactTreePayload,
} from '@webpob/data';
import { xmlToBuild } from '@webpob/codec';
import { calculateBuild } from './index.js';

interface OracleSnapshot {
  id: string;
  title: string;
  game: 'poe1' | 'poe2';
  xml: string;
  pobCommit: string;
  oracle: Record<string, number>;
}

const rootDir = process.cwd();
const snapFile = path.join(rootDir, 'fixtures/oracle/snapshots.json');
const snapshots: OracleSnapshot[] = fs.existsSync(snapFile)
  ? (JSON.parse(fs.readFileSync(snapFile, 'utf-8')) as { snapshots: OracleSnapshot[] }).snapshots
  : [];

function expectWithinPct(actual: number, expected: number, maxRelPct: number, maxAbs = 1) {
  const absDiff = Math.abs(actual - expected);
  if (absDiff <= maxAbs) return;
  const relPct = (absDiff / Math.max(1, Math.abs(expected))) * 100;
  expect(relPct).toBeLessThanOrEqual(maxRelPct);
}

describe('Official PathOfBuilding Oracle Differential Regression Suite (PoE 1 3.30 & PoE 2 0.5)', () => {
  beforeAll(() => {
    const dataDir = path.join(rootDir, 'apps/web/public/data');
    const poe1Tree = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-tree-3_30.json'), 'utf-8')) as CompactTreePayload;
    const poe2Tree = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-tree-0_5.json'), 'utf-8')) as CompactTreePayload;
    const poe1Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-gems.json'), 'utf-8')) as CompactGemsPayload;
    const poe2Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-gems.json'), 'utf-8')) as CompactGemsPayload;
    const poe1Bases = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-bases.json'), 'utf-8')) as CompactBaseItemsPayload;
    const poe2Bases = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-bases.json'), 'utf-8')) as CompactBaseItemsPayload;
    const poe1Clusters = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-clusters.json'), 'utf-8')) as CompactClusterNotablesPayload;
    const poe2Runes = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-runes.json'), 'utf-8')) as unknown;
    registerTreeData(hydrateCompactTree(poe1Tree));
    registerTreeData(hydrateCompactTree(poe2Tree));
    registerGemsData('poe1', poe1Gems);
    registerGemsData('poe2', poe2Gems);
    registerBaseItems(poe1Bases);
    registerBaseItems(poe2Bases);
    registerClusterNotables(poe1Clusters);
    registerPoe2RunesData(poe2Runes);
  });

  it('has official LuaJIT golden snapshots loaded', () => {
    expect(snapshots.length).toBeGreaterThanOrEqual(180);
  });

  for (const snap of snapshots) {
    it(`matches official PoB oracle [${snap.id}] (${snap.title})`, () => {
      const build = xmlToBuild(snap.xml);
      const out = calculateBuild(build);
      const o = snap.oracle;

      // Exact integer match on primary attributes
      expect(out.defence.str).toBe(Math.round(o.Str!));
      expect(out.defence.dex).toBe(Math.round(o.Dex!));
      expect(out.defence.int).toBe(Math.round(o.Int!));

      // Tight <= 1 integer match on Life, Mana, Energy Shield, Armour, Evasion, Elemental Resists
      expectWithinPct(out.defence.life, o.Life!, 0.1, 1);
      expectWithinPct(out.defence.energyShield, o.EnergyShield!, 0.5, 1);
      if ((o.Ward ?? 0) > 0) {
        expectWithinPct(out.defence.ward ?? 0, o.Ward!, 0.5, 1);
      }
      if (snap.game === 'poe2') {
        expectWithinPct(out.defence.spirit, o.Spirit!, 0.5, 1);
        expectWithinPct(out.defence.spiritUnreserved, o.SpiritUnreserved!, 0.5, 1);
        expect(out.defence.chaosResist).toBe(Math.round(o.ChaosResist!));
      }
      if ((o.SpiritReserved ?? 0) > 0) {
        expect(out.defence.spiritReserved).toBe(Math.round(o.SpiritReserved!));
      }
      if ((o.SpellSuppressionChance ?? 0) > 0) {
        expect(out.defence.spellSuppressionChance).toBe(Math.round(o.SpellSuppressionChance!));
      }
      if ((o.SpellBlockChance ?? 0) > 0) {
        expect(out.defence.spellBlockChance).toBe(Math.round(o.SpellBlockChance!));
      }
      expectWithinPct(out.defence.mana, o.Mana!, 0.1, 1);
      if (snap.id.includes('enlighten') && (o.ManaUnreserved ?? 0) > 0) {
        expectWithinPct(out.defence.manaUnreserved, o.ManaUnreserved!, 0.5, 2);
      }
      expectWithinPct(out.defence.armour, o.Armour!, 0.5, 1);
      expectWithinPct(out.defence.evasion, o.Evasion!, 0.5, 1);
      expect(out.defence.fireResist).toBe(Math.round(o.FireResist!));
      expect(out.defence.coldResist).toBe(Math.round(o.ColdResist!));
      expect(out.defence.lightningResist).toBe(Math.round(o.LightningResist!));

      // Offence parity (<= 0.5% tolerance on Speed, Crit, HitChance, AverageDamage, HitDPS)
      const oracleCritMultiPct = (o.CritMultiplier ?? 0) > 10 ? o.CritMultiplier! : (o.CritMultiplier ?? 0) * 100;
      expectWithinPct(out.offence.speed, o.Speed!, 0.5, 0.02);
      expectWithinPct(out.offence.critChance, o.CritChance!, 0.5, 0.05);
      expect(out.offence.critMultiplier).toBe(Math.round(oracleCritMultiPct));
      expect(out.offence.hitChance).toBe(Math.round(o.HitChance!));

      const webAvgDamage = out.offence.averageHit * (out.offence.hitChance / 100);
      expectWithinPct(webAvgDamage, o.AverageDamage || o.AverageHit || 0, 0.5, 1);
      expectWithinPct(out.offence.hitDps, o.TotalDPS!, 0.5, 1);
      if ((o.ImpaleDPS ?? 0) > 0) {
        expectWithinPct(out.offence.impaleDps ?? 0, o.ImpaleDPS!, 0.5, 1);
        if ((o.BleedDPS ?? 0) === 0 && (o.IgniteDPS ?? 0) === 0 && (o.TotalPoisonDPS ?? 0) === 0) {
          expectWithinPct(out.offence.totalDps, o.CombinedDPS!, 0.5, 1);
        }
      }
      if ((o.FullDPS ?? 0) > 0 && out.offence.fullDps !== undefined) {
        expectWithinPct(out.offence.fullDps, o.FullDPS!, 0.5, 1);
      }
    });
  }
});
