import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
import { calculateBuild } from '@webpob/calc';
import type { OracleNumericOutput } from './generate.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const LUA_RUNNER = path.resolve(__dirname, '../lua/run_oracle.lua');
const SNAPSHOT_PATH = path.join(ROOT_DIR, 'fixtures/oracle/ninja-oracle-snapshots.json');

export interface NinjaOracleSnapshotEntry {
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
  oracle: OracleNumericOutput;
}

export interface NinjaOracleSnapshotsFile {
  version: number;
  generatedAt: string;
  poe1Commit: string;
  poe2Commit: string;
  snapshots: NinjaOracleSnapshotEntry[];
}

interface MetricDelta {
  key: string;
  oracle: number;
  webpob: number;
  absDiff: number;
  relPct: number;
}

interface BuildAuditResult {
  snap: NinjaOracleSnapshotEntry;
  metrics: Record<string, MetricDelta>;
  defencePass: boolean;
  resistPass: boolean;
  dpsPass: boolean;
  maxDefenceErrPct: number;
  maxResistAbsErr: number;
  dpsErrPct: number;
  topGap: { key: string; relPct: number; absDiff: number; oracle: number; webpob: number };
}

function decodePobCodeToXml(pobCode: string): string {
  const normalized = pobCode.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const buf = Buffer.from(normalized + '='.repeat(padLen), 'base64');
  return zlib.inflateSync(buf).toString('utf-8');
}

async function getGitRev(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function runUpstreamOracleForPobCode(
  id: string,
  game: 'poe1' | 'poe2',
  pobCode: string,
  cacheDir: string,
): Promise<OracleNumericOutput> {
  const repoDir = path.join(cacheDir, game === 'poe2' ? 'upstream-pob2' : 'upstream-pob');
  const srcDir = path.join(repoDir, 'src');
  const xml = decodePobCodeToXml(pobCode);

  const tmpXml = path.join(os.tmpdir(), `webpob_ninja_oracle_${id}_${Date.now()}.xml`);
  await fs.writeFile(tmpXml, xml, 'utf-8');

  const luajitBin = process.env.LUAJIT_BIN || path.join(cacheDir, 'luajit-src/src/luajit');
  const clibsPath = path.join(cacheDir, 'clibs/?.so');

  try {
    const env = {
      ...process.env,
      LUA_PATH: `${path.join(repoDir, 'runtime/lua/?.lua')};${path.join(repoDir, 'runtime/lua/?/init.lua')};${srcDir}/?.lua;;`,
      LUA_CPATH: `${clibsPath};;`,
    };
    const { stdout, stderr } = await execFileAsync(luajitBin, [LUA_RUNNER, tmpXml], {
      cwd: srcDir,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });

    const startMarker = '__ORACLE_JSON_START__';
    const endMarker = '__ORACLE_JSON_END__';
    const sIdx = stdout.indexOf(startMarker);
    const eIdx = stdout.indexOf(endMarker);
    if (sIdx === -1 || eIdx === -1) {
      throw new Error(`Oracle marker missing for ${id}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    const jsonStr = stdout.slice(sIdx + startMarker.length, eIdx).trim();
    return JSON.parse(jsonStr) as OracleNumericOutput;
  } finally {
    await fs.unlink(tmpXml).catch(() => {});
  }
}

async function loadLocalDatasets(): Promise<void> {
  const dataDir = path.join(ROOT_DIR, 'apps/web/public/data');
  const [poe1Tree, poe2Tree, poe1Gems, poe2Gems, poe1Bases, poe2Bases, poe1Clusters] = await Promise.all([
    fs.readFile(path.join(dataDir, 'poe1-tree-3_30.json'), 'utf-8').then((s) => JSON.parse(s) as CompactTreePayload),
    fs.readFile(path.join(dataDir, 'poe2-tree-0_5.json'), 'utf-8').then((s) => JSON.parse(s) as CompactTreePayload),
    fs.readFile(path.join(dataDir, 'poe1-gems.json'), 'utf-8').then((s) => JSON.parse(s) as CompactGemsPayload),
    fs.readFile(path.join(dataDir, 'poe2-gems.json'), 'utf-8').then((s) => JSON.parse(s) as CompactGemsPayload),
    fs.readFile(path.join(dataDir, 'poe1-bases.json'), 'utf-8').then((s) => JSON.parse(s) as CompactBaseItemsPayload),
    fs.readFile(path.join(dataDir, 'poe2-bases.json'), 'utf-8').then((s) => JSON.parse(s) as CompactBaseItemsPayload),
    fs.readFile(path.join(dataDir, 'poe1-clusters.json'), 'utf-8').then((s) => JSON.parse(s) as CompactClusterNotablesPayload),
  ]);

  registerTreeData(hydrateCompactTree(poe1Tree));
  registerTreeData(hydrateCompactTree(poe2Tree));
  registerGemsData('poe1', poe1Gems);
  registerGemsData('poe2', poe2Gems);
  registerBaseItems(poe1Bases);
  registerBaseItems(poe2Bases);
  registerClusterNotables(poe1Clusters);
}

function makeDelta(key: string, oracle: number, webpob: number): MetricDelta {
  const absDiff = webpob - oracle;
  const denom = Math.max(1, Math.abs(oracle));
  const relPct = Math.abs(oracle) < 0.001 && Math.abs(webpob) < 0.001
    ? 0
    : Math.round((Math.abs(absDiff) / denom) * 1000) / 10;
  return {
    key,
    oracle: Math.round(oracle * 100) / 100,
    webpob: Math.round(webpob * 100) / 100,
    absDiff: Math.round(absDiff * 100) / 100,
    relPct,
  };
}

function fmtSignedPct(d: MetricDelta): string {
  if (Math.abs(d.oracle) < 0.001 && Math.abs(d.webpob) < 0.001) return '0%';
  if (Math.abs(d.absDiff) <= 1 && d.relPct <= 0.5) return '0%';
  const sign = d.absDiff >= 0 ? '+' : '-';
  return `${sign}${d.relPct.toFixed(1)}%`;
}

function fmtCompactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtAttrCell(str: MetricDelta, dex: MetricDelta, int: MetricDelta): string {
  const parts = [str, dex, int].map((d) => {
    const diff = Math.round(d.absDiff);
    if (diff === 0) return '0';
    return diff > 0 ? `+${diff}` : `${diff}`;
  });
  return parts.join('/');
}

function fmtResCell(fire: MetricDelta, cold: MetricDelta, light: MetricDelta, chaos: MetricDelta): string {
  const parts = [fire, cold, light, chaos].map((d) => {
    const diff = Math.round(d.absDiff);
    if (diff === 0) return '0';
    return diff > 0 ? `+${diff}` : `${diff}`;
  });
  return parts.join('/');
}

function evaluateSnapshot(snap: NinjaOracleSnapshotEntry): BuildAuditResult {
  const { build } = importBuildFromCode(snap.pobCode);
  const out = calculateBuild(build);
  const o = snap.oracle;

  const oracleCritMultiPct = (o.CritMultiplier ?? 0) * 100;

  const metrics: Record<string, MetricDelta> = {
    Str: makeDelta('Str', o.Str ?? 0, out.defence.str),
    Dex: makeDelta('Dex', o.Dex ?? 0, out.defence.dex),
    Int: makeDelta('Int', o.Int ?? 0, out.defence.int),
    Life: makeDelta('Life', o.Life ?? 0, out.defence.life),
    ES: makeDelta('ES', o.EnergyShield ?? 0, out.defence.energyShield),
    Mana: makeDelta('Mana', o.Mana ?? 0, out.defence.mana),
    Spirit: makeDelta('Spirit', o.Spirit ?? 0, out.defence.spirit),
    Armour: makeDelta('Armour', o.Armour ?? 0, out.defence.armour),
    Evasion: makeDelta('Evasion', o.Evasion ?? 0, out.defence.evasion),
    Block: makeDelta('Block', o.BlockChance ?? 0, out.defence.blockChance),
    FireRes: makeDelta('FireRes', o.FireResist ?? 0, out.defence.fireResist),
    ColdRes: makeDelta('ColdRes', o.ColdResist ?? 0, out.defence.coldResist),
    LightRes: makeDelta('LightRes', o.LightningResist ?? 0, out.defence.lightningResist),
    ChaosRes: makeDelta('ChaosRes', o.ChaosResist ?? 0, out.defence.chaosResist),
    CritChance: makeDelta('CritChance', o.CritChance ?? 0, out.offence.critChance),
    CritMulti: makeDelta('CritMulti', oracleCritMultiPct, out.offence.critMultiplier),
    TotalDPS: makeDelta('TotalDPS', o.TotalDPS ?? 0, out.offence.hitDps),
    CombinedDPS: makeDelta('CombinedDPS', o.CombinedDPS ?? 0, out.offence.totalDps),
  };

  // Defence ±5% check across active non-trivial defence pools (Life, ES, Mana, Spirit, Armour, Evasion)
  const defenceKeys = ['Life', 'ES', 'Mana', ...(snap.game === 'poe2' ? ['Spirit'] : []), 'Armour', 'Evasion'];
  let maxDefenceErrPct = 0;
  let defencePass = true;
  for (const k of defenceKeys) {
    const m = metrics[k]!;
    if (m.oracle < 20 && m.webpob < 20) continue;
    if (Math.abs(m.absDiff) <= 2) continue;
    maxDefenceErrPct = Math.max(maxDefenceErrPct, m.relPct);
    if (m.relPct > 5) defencePass = false;
  }

  // Resists ±1pt check
  const resKeys = ['FireRes', 'ColdRes', 'LightRes', 'ChaosRes'];
  let maxResistAbsErr = 0;
  for (const k of resKeys) {
    maxResistAbsErr = Math.max(maxResistAbsErr, Math.abs(Math.round(metrics[k]!.absDiff)));
  }
  const resistPass = maxResistAbsErr <= 1;

  // DPS ±25% check (using CombinedDPS when Oracle CombinedDPS > 0, else TotalDPS)
  const dpsMetric = (o.CombinedDPS ?? 0) > 0 ? metrics.CombinedDPS! : metrics.TotalDPS!;
  const dpsErrPct = (o.CombinedDPS ?? 0) <= 0 && (o.TotalDPS ?? 0) <= 0 ? 0 : dpsMetric.relPct;
  const dpsPass = (o.CombinedDPS ?? 0) <= 0 && (o.TotalDPS ?? 0) <= 0 ? true : dpsErrPct <= 25;

  // Top remaining gap across tracked metrics (preferring significant metrics)
  const gapCandidates = [
    metrics.Life!,
    metrics.ES!,
    metrics.Mana!,
    ...(snap.game === 'poe2' ? [metrics.Spirit!] : []),
    metrics.Armour!,
    metrics.Evasion!,
    metrics.Block!,
    metrics.CritChance!,
    metrics.CritMulti!,
    dpsMetric,
  ].filter((m) => Math.max(Math.abs(m.oracle), Math.abs(m.webpob)) >= 5);

  gapCandidates.sort((a, b) => b.relPct - a.relPct);
  const top = gapCandidates[0] ?? metrics.Life!;

  return {
    snap,
    metrics,
    defencePass,
    resistPass,
    dpsPass,
    maxDefenceErrPct: Math.round(maxDefenceErrPct * 10) / 10,
    maxResistAbsErr,
    dpsErrPct: Math.round(dpsErrPct * 10) / 10,
    topGap: {
      key: top.key,
      relPct: top.relPct,
      absDiff: top.absDiff,
      oracle: top.oracle,
      webpob: top.webpob,
    },
  };
}

function printSummarySection(label: string, results: BuildAuditResult[]): void {
  const n = results.length;
  if (n === 0) return;
  const defOk = results.filter((r) => r.defencePass).length;
  const resOk = results.filter((r) => r.resistPass).length;
  const dpsOk = results.filter((r) => r.dpsPass).length;
  const pct = (k: number) => `${k}/${n} (${Math.round((k / n) * 100)}%)`;
  console.log(
    `| ${label.padEnd(22)} | ${pct(defOk).padEnd(14)} | ${pct(resOk).padEnd(14)} | ${pct(dpsOk).padEnd(14)} |`,
  );
}

async function regenSnapshots(fileData: NinjaOracleSnapshotsFile): Promise<NinjaOracleSnapshotsFile> {
  const cacheDir = process.env.WEBPOB_CACHE_DIR || path.join(ROOT_DIR, '.cache');
  const poe1Rev = await getGitRev(path.join(cacheDir, 'upstream-pob'));
  const poe2Rev = await getGitRev(path.join(cacheDir, 'upstream-pob2'));

  console.error(`Regenerating ${fileData.snapshots.length} LuaJIT Oracle snapshots (PoB1=${poe1Rev}, PoB2=${poe2Rev})...`);
  const updated: NinjaOracleSnapshotEntry[] = [];
  for (const snap of fileData.snapshots) {
    process.stderr.write(`  [${snap.game}] ${snap.id}... `);
    const oracle = await runUpstreamOracleForPobCode(snap.id, snap.game, snap.pobCode, cacheDir);
    process.stderr.write(
      `OK (Life=${Math.round(oracle.Life)}, ES=${Math.round(oracle.EnergyShield)}, DPS=${fmtCompactNum(oracle.CombinedDPS)})\n`,
    );
    updated.push({
      ...snap,
      pobCommit: snap.game === 'poe2' ? poe2Rev : poe1Rev,
      oracle,
    });
  }

  const nextFile: NinjaOracleSnapshotsFile = {
    version: fileData.version || 1,
    generatedAt: new Date().toISOString(),
    poe1Commit: poe1Rev,
    poe2Commit: poe2Rev,
    snapshots: updated,
  };
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(nextFile, null, 2) + '\n', 'utf-8');
  console.error(`✓ Updated ${path.relative(ROOT_DIR, SNAPSHOT_PATH)}\n`);
  return nextFile;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const shouldRegen = args.has('--regen');

  let fileData = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf-8')) as NinjaOracleSnapshotsFile;
  if (shouldRegen) {
    fileData = await regenSnapshots(fileData);
  }

  await loadLocalDatasets();

  const results = fileData.snapshots.map(evaluateSnapshot);
  const cleanResults = results.filter((r) => !r.snap.oracleTreeCaveat);
  const poe1Clean = cleanResults.filter((r) => r.snap.game === 'poe1');
  const poe2Clean = cleanResults.filter((r) => r.snap.game === 'poe2');

  console.log('# WebPoB vs Official PoB1 & PoB2 Endgame Oracle Scorecard\n');
  console.log(
    `- **Snapshots**: ${results.length} real endgame builds (${results.filter((r) => r.snap.game === 'poe1').length} PoE 1 @ \`${fileData.poe1Commit}\`, ${results.filter((r) => r.snap.game === 'poe2').length} PoE 2 @ \`${fileData.poe2Commit}\`)`,
  );
  console.log(`- **Generated**: \`${fileData.generatedAt}\``);
  console.log('- **Pass Criteria**: Defence `±5%` (Life/ES/Mana/Spirit/Armour/Evasion), Resists `±1pt` (F/C/L/Ch), DPS `±25%` (CombinedDPS)\n');

  console.log('## Per-Build Differential Matrix\n');
  console.log(
    '| Build | Game | S/D/I Δ | Life Δ | ES Δ | Mana Δ | Spirit Δ | Arm Δ | Eva Δ | Block Δ | Res Δ (F/C/L/Ch) | Crit% Δ | CritM Δ | HitDPS Δ | CombDPS Δ | Pass (D/R/O) |',
  );
  console.log(
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |',
  );

  for (const r of results) {
    const m = r.metrics;
    const tag = r.snap.oracleTreeCaveat ? `${r.snap.id}*` : r.snap.id;
    const spiritCell = r.snap.game === 'poe2' ? fmtSignedPct(m.Spirit!) : '—';
    const blockDiff = Math.round(m.Block!.absDiff);
    const blockCell = blockDiff === 0 ? '0' : blockDiff > 0 ? `+${blockDiff}` : `${blockDiff}`;
    const passCell = `${r.defencePass ? '✓' : '✗'}/${r.resistPass ? '✓' : '✗'}/${r.dpsPass ? '✓' : '✗'}`;
    console.log(
      `| \`${tag}\` | ${r.snap.game} | ${fmtAttrCell(m.Str!, m.Dex!, m.Int!)} | ${fmtSignedPct(m.Life!)} | ${fmtSignedPct(m.ES!)} | ${fmtSignedPct(m.Mana!)} | ${spiritCell} | ${fmtSignedPct(m.Armour!)} | ${fmtSignedPct(m.Evasion!)} | ${blockCell} | ${fmtResCell(m.FireRes!, m.ColdRes!, m.LightRes!, m.ChaosRes!)} | ${fmtSignedPct(m.CritChance!)} | ${fmtSignedPct(m.CritMulti!)} | ${fmtSignedPct(m.TotalDPS!)} | ${fmtSignedPct(m.CombinedDPS!)} | ${passCell} |`,
    );
  }

  const caveatBuilds = results.filter((r) => r.snap.oracleTreeCaveat);
  if (caveatBuilds.length > 0) {
    console.log('');
    for (const c of caveatBuilds) {
      console.log(`> *\`${c.snap.id}\`: ${c.snap.oracleTreeCaveatNote ?? 'Oracle tree version caveat'}`);
    }
  }

  console.log('\n## Overall Pass Rates\n');
  console.log('| Cohort | Defence (±5%) | Resists (±1pt) | DPS (±25%) |');
  console.log('| :--- | :---: | :---: | :---: |');
  printSummarySection('PoE 1 (excl. caveat)', poe1Clean);
  printSummarySection('PoE 2', poe2Clean);
  printSummarySection('Overall (excl. caveat)', cleanResults);
  if (caveatBuilds.length > 0) {
    printSummarySection('All Builds (incl. caveat)', results);
  }

  // Top remaining gaps across clean builds
  console.log('\n## Top Remaining Gaps (Non-Caveat Builds)\n');
  const sortedGaps = [...cleanResults]
    .filter((r) => r.topGap.relPct > 1)
    .sort((a, b) => b.topGap.relPct - a.topGap.relPct)
    .slice(0, 10);

  if (sortedGaps.length === 0) {
    console.log('All non-caveat builds are within 1% across all tracked metrics!');
  } else {
    console.log('| Build | Game | Top Gap Metric | Official PoB | WebPoB | Err% |');
    console.log('| :--- | :---: | :--- | :---: | :---: | :---: |');
    for (const r of sortedGaps) {
      const g = r.topGap;
      console.log(
        `| \`${r.snap.id}\` | ${r.snap.game} | ${g.key} | ${fmtCompactNum(g.oracle)} | ${fmtCompactNum(g.webpob)} | ${g.relPct.toFixed(1)}% |`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
