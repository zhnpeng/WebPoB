import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  hydrateCompactTree,
  registerBaseItems,
  registerClusterNotables,
  registerGemsData,
  registerTreeData,
  type CompactBaseItemsPayload,
  type CompactClusterNotablesPayload,
  type CompactGemsPayload,
  type CompactTreePayload,
} from '@webpob/data';
import { importBuildFromCode } from '@webpob/codec';
import { calculateBuild } from './index.js';

interface NinjaOracleSnapshotEntry {
  id: string;
  title: string;
  game: 'poe1' | 'poe2';
  className: string;
  ascendancyName: string;
  level: number;
  mainSkill: string;
  source: 'ninja-fixture' | 'ninja-live';
  oracleTreeCaveat?: boolean;
  oracleTreeCaveatNote?: string;
  pobCommit: string;
  pobCode: string;
  oracle: Record<string, number>;
}

interface NinjaOracleSnapshotsFile {
  version: number;
  generatedAt: string;
  poe1Commit: string;
  poe2Commit: string;
  snapshots: NinjaOracleSnapshotEntry[];
}

interface MonotonicBaseline {
  /** Max allowed relative error (%) on Life (skipped when null, e.g. CI=1 baseline). */
  maxLifeErrPct: number | null;
  /** Max allowed relative error (%) on Energy Shield (skipped when oracle ES < 20). */
  maxEsErrPct: number | null;
  /** Max allowed relative error (%) on Mana (skipped when null, e.g. Blood Magic 0 baseline). */
  maxManaErrPct: number | null;
  /** Max allowed absolute resist error across Fire/Cold/Lightning/Chaos. */
  maxResAbsErr: number;
  /** Optional tighter ceiling on Elemental Resists (Fire/Cold/Lightning). */
  maxElemResAbsErr?: number;
}

/**
 * Monotonic non-regression ceilings for real endgame builds (Track 10 baseline).
 * As calculation accuracy improves across Tracks 01-09, tighten these ceilings downward —
 * never loosen them.
 */
const MONOTONIC_BASELINES: Record<string, MonotonicBaseline> = {
  // PoE 1 (9 non-caveat builds)
  'poe1-elementalist-chaos-golem': { maxLifeErrPct: 11, maxEsErrPct: 20, maxManaErrPct: 2, maxResAbsErr: 93 },
  'poe1-assassin-winter-orb': { maxLifeErrPct: 8, maxEsErrPct: 2, maxManaErrPct: 4, maxResAbsErr: 66, maxElemResAbsErr: 1 },
  'poe1-juggernaut-heavy-strike': { maxLifeErrPct: 23, maxEsErrPct: 8, maxManaErrPct: 8, maxResAbsErr: 60 },
  'poe1-scion-luminary-static-strike': { maxLifeErrPct: 1, maxEsErrPct: 25, maxManaErrPct: 18, maxResAbsErr: 153 },
  'poe1-slayer-elemental-hit': { maxLifeErrPct: 10, maxEsErrPct: 1, maxManaErrPct: 3, maxResAbsErr: 80 },
  'poe1-trickster-splitting-steel': { maxLifeErrPct: 1, maxEsErrPct: 45, maxManaErrPct: 27, maxResAbsErr: 162 },
  'poe1-necro-raise-spectre': { maxLifeErrPct: 1, maxEsErrPct: 61, maxManaErrPct: 29, maxResAbsErr: 128 },
  'poe1-pathfinder-mamba-poison': { maxLifeErrPct: 4, maxEsErrPct: 2, maxManaErrPct: 2, maxResAbsErr: 17 },
  'poe1-gladiator-bleed-lacerate': { maxLifeErrPct: 4, maxEsErrPct: 7, maxManaErrPct: 7, maxResAbsErr: 88, maxElemResAbsErr: 2 },

  // PoE 2 (10 builds)
  'poe2-stormweaver-spark': { maxLifeErrPct: 8, maxEsErrPct: 30, maxManaErrPct: 3, maxResAbsErr: 1 },
  'poe2-deadeye-ice-shot': { maxLifeErrPct: 2, maxEsErrPct: 27, maxManaErrPct: 2, maxResAbsErr: 1 },
  'poe2-invoker-flicker-strike': { maxLifeErrPct: null, maxEsErrPct: 32, maxManaErrPct: 5, maxResAbsErr: 1 },
  'poe2-bloodmage-crit-detonate-dead': { maxLifeErrPct: 0.5, maxEsErrPct: 0.5, maxManaErrPct: 5, maxResAbsErr: 0 },
  'poe2-titan-earthshatter': { maxLifeErrPct: 3, maxEsErrPct: 1, maxManaErrPct: null, maxResAbsErr: 1 },
  'poe2-oracle-spell-totem': { maxLifeErrPct: 1, maxEsErrPct: 24, maxManaErrPct: 4, maxResAbsErr: 12 },
  'poe2-witchhunter-permafrost-bolts': { maxLifeErrPct: 1, maxEsErrPct: 1, maxManaErrPct: 1, maxResAbsErr: 1 },
  'poe2-varashta-kelari-ci': { maxLifeErrPct: null, maxEsErrPct: 19, maxManaErrPct: 10, maxResAbsErr: 57 },
  'poe2-warbringer-bloodbarrier': { maxLifeErrPct: 16, maxEsErrPct: 24, maxManaErrPct: null, maxResAbsErr: 24 },
  'poe2-martial-artist-shattering-palm': { maxLifeErrPct: 3, maxEsErrPct: 71, maxManaErrPct: 1, maxResAbsErr: 1 },
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '../../..');
const snapFile = path.join(rootDir, 'fixtures/oracle/ninja-oracle-snapshots.json');

const loadedFile: NinjaOracleSnapshotsFile | null = fs.existsSync(snapFile)
  ? (JSON.parse(fs.readFileSync(snapFile, 'utf-8')) as NinjaOracleSnapshotsFile)
  : null;
const snapshots = loadedFile?.snapshots ?? [];

function relErrPct(actual: number, expected: number): number {
  if (Math.abs(actual - expected) <= 1) return 0;
  return (Math.abs(actual - expected) / Math.max(1, Math.abs(expected))) * 100;
}

describe('Real Endgame poe.ninja Oracle Differential Regression Suite (PoE 1 & PoE 2)', () => {
  beforeAll(() => {
    const dataDir = path.join(rootDir, 'apps/web/public/data');
    const poe1Tree = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-tree-3_30.json'), 'utf-8')) as CompactTreePayload;
    const poe2Tree = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-tree-0_5.json'), 'utf-8')) as CompactTreePayload;
    const poe1Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-gems.json'), 'utf-8')) as CompactGemsPayload;
    const poe2Gems = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-gems.json'), 'utf-8')) as CompactGemsPayload;
    const poe1Bases = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-bases.json'), 'utf-8')) as CompactBaseItemsPayload;
    const poe2Bases = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe2-bases.json'), 'utf-8')) as CompactBaseItemsPayload;
    const poe1Clusters = JSON.parse(fs.readFileSync(path.join(dataDir, 'poe1-clusters.json'), 'utf-8')) as CompactClusterNotablesPayload;

    registerTreeData(hydrateCompactTree(poe1Tree));
    registerTreeData(hydrateCompactTree(poe2Tree));
    registerGemsData('poe1', poe1Gems);
    registerGemsData('poe2', poe2Gems);
    registerBaseItems(poe1Bases);
    registerBaseItems(poe2Bases);
    registerClusterNotables(poe1Clusters);
  });

  it('loads >= 18 verified PoE 1 & PoE 2 real endgame Oracle snapshots with valid schema', () => {
    expect(loadedFile).not.toBeNull();
    expect(snapshots.length).toBeGreaterThanOrEqual(18);

    const poe1Count = snapshots.filter((s) => s.game === 'poe1').length;
    const poe2Count = snapshots.filter((s) => s.game === 'poe2').length;
    expect(poe1Count).toBeGreaterThanOrEqual(8);
    expect(poe2Count).toBeGreaterThanOrEqual(8);

    const seen = new Set<string>();
    for (const s of snapshots) {
      expect(seen.has(s.id), `duplicate snapshot id: ${s.id}`).toBe(false);
      seen.add(s.id);
      expect(s.pobCode.trim().length).toBeGreaterThan(20);
      expect(typeof s.oracle.Life).toBe('number');
      expect(Number.isFinite(s.oracle.Life)).toBe(true);
      expect(typeof s.oracle.CombinedDPS).toBe('number');
      expect(Number.isFinite(s.oracle.CombinedDPS)).toBe(true);
    }
  });

  it('matches official PoB2 exact defence & resists on poe2-bloodmage-crit-detonate-dead', () => {
    const snap = snapshots.find((s) => s.id === 'poe2-bloodmage-crit-detonate-dead');
    expect(snap).toBeDefined();
    const { build } = importBuildFromCode(snap!.pobCode);
    const out = calculateBuild(build);
    const o = snap!.oracle;

    expect(out.defence.str).toBe(Math.round(o.Str!));
    expect(out.defence.dex).toBe(Math.round(o.Dex!));
    expect(out.defence.int).toBe(Math.round(o.Int!));
    expect(out.defence.life).toBe(4300);
    expect(out.defence.energyShield).toBe(556);
    expect(out.defence.spirit).toBe(374);
    expect(out.defence.armour).toBe(1851);
    expect(out.defence.evasion).toBe(1964);
    expect(out.defence.fireResist).toBe(76);
    expect(out.defence.coldResist).toBe(76);
    expect(out.defence.lightningResist).toBe(76);
    expect(out.defence.chaosResist).toBe(69);
    expect(relErrPct(out.defence.mana, o.Mana!)).toBeLessThanOrEqual(5);
    expect(out.offence.critMultiplier).toBe(Math.round(o.CritMultiplier! * 100));
  });

  for (const snap of snapshots) {
    it(`decodes, calculates, and holds monotonic accuracy baseline for [${snap.id}] (${snap.game})`, () => {
      const { build } = importBuildFromCode(snap.pobCode);
      expect(build.game).toBe(snap.game);

      const out = calculateBuild(build);
      const o = snap.oracle;

      // Finite numeric sanity across all core outputs
      for (const val of [
        out.defence.str,
        out.defence.dex,
        out.defence.int,
        out.defence.life,
        out.defence.energyShield,
        out.defence.mana,
        out.defence.spirit,
        out.defence.armour,
        out.defence.evasion,
        out.defence.fireResist,
        out.defence.coldResist,
        out.defence.lightningResist,
        out.defence.chaosResist,
        out.defence.effectiveHitPool,
        out.offence.totalDps,
        out.offence.hitDps,
        out.offence.critChance,
        out.offence.critMultiplier,
      ]) {
        expect(Number.isFinite(val), `${snap.id}: non-finite calc output`).toBe(true);
      }

      if (snap.oracleTreeCaveat) return;

      const baseline = MONOTONIC_BASELINES[snap.id];
      expect(baseline, `Missing monotonic baseline for ${snap.id}`).toBeDefined();
      if (!baseline) return;

      if (baseline.maxLifeErrPct !== null) {
        expect(
          relErrPct(out.defence.life, o.Life!),
          `${snap.id}: Life regression (webpob=${out.defence.life}, oracle=${Math.round(o.Life!)})`,
        ).toBeLessThanOrEqual(baseline.maxLifeErrPct);
      }

      if (baseline.maxEsErrPct !== null && (o.EnergyShield ?? 0) >= 20) {
        expect(
          relErrPct(out.defence.energyShield, o.EnergyShield!),
          `${snap.id}: ES regression (webpob=${out.defence.energyShield}, oracle=${Math.round(o.EnergyShield!)})`,
        ).toBeLessThanOrEqual(baseline.maxEsErrPct);
      }

      if (baseline.maxManaErrPct !== null && (o.Mana ?? 0) >= 20) {
        expect(
          relErrPct(out.defence.mana, o.Mana!),
          `${snap.id}: Mana regression (webpob=${out.defence.mana}, oracle=${Math.round(o.Mana!)})`,
        ).toBeLessThanOrEqual(baseline.maxManaErrPct);
      }

      const maxResErr = Math.max(
        Math.abs(out.defence.fireResist - Math.round(o.FireResist!)),
        Math.abs(out.defence.coldResist - Math.round(o.ColdResist!)),
        Math.abs(out.defence.lightningResist - Math.round(o.LightningResist!)),
        Math.abs(out.defence.chaosResist - Math.round(o.ChaosResist!)),
      );
      expect(
        maxResErr,
        `${snap.id}: Resist regression (max abs diff ${maxResErr} > ${baseline.maxResAbsErr})`,
      ).toBeLessThanOrEqual(baseline.maxResAbsErr);

      if (baseline.maxElemResAbsErr !== undefined) {
        const maxElemErr = Math.max(
          Math.abs(out.defence.fireResist - Math.round(o.FireResist!)),
          Math.abs(out.defence.coldResist - Math.round(o.ColdResist!)),
          Math.abs(out.defence.lightningResist - Math.round(o.LightningResist!)),
        );
        expect(
          maxElemErr,
          `${snap.id}: Elemental Resist regression (max abs diff ${maxElemErr} > ${baseline.maxElemResAbsErr})`,
        ).toBeLessThanOrEqual(baseline.maxElemResAbsErr);
      }
    });
  }

  it('maintains aggregate PoE 2 accuracy floors (Resists ±1pt >= 7/10, Defence ±5% >= 1/10)', () => {
    const poe2Snaps = snapshots.filter((s) => s.game === 'poe2' && !s.oracleTreeCaveat);
    let resistPass = 0;
    let defencePass = 0;

    for (const snap of poe2Snaps) {
      const { build } = importBuildFromCode(snap.pobCode);
      const out = calculateBuild(build);
      const o = snap.oracle;

      const maxResErr = Math.max(
        Math.abs(out.defence.fireResist - Math.round(o.FireResist!)),
        Math.abs(out.defence.coldResist - Math.round(o.ColdResist!)),
        Math.abs(out.defence.lightningResist - Math.round(o.LightningResist!)),
        Math.abs(out.defence.chaosResist - Math.round(o.ChaosResist!)),
      );
      if (maxResErr <= 1) resistPass++;

      const poolPairs: Array<[number, number]> = [
        [out.defence.life, o.Life!],
        [out.defence.energyShield, o.EnergyShield!],
        [out.defence.mana, o.Mana!],
        [out.defence.spirit, o.Spirit!],
        [out.defence.armour, o.Armour!],
        [out.defence.evasion, o.Evasion!],
      ];
      const allDefWithin5 = poolPairs.every(([actual, expected]) => {
        if (actual < 20 && expected < 20) return true;
        if (Math.abs(actual - expected) <= 2) return true;
        return relErrPct(actual, expected) <= 5;
      });
      if (allDefWithin5) defencePass++;
    }

    expect(resistPass).toBeGreaterThanOrEqual(7);
    expect(defencePass).toBeGreaterThanOrEqual(1);
  });
});
