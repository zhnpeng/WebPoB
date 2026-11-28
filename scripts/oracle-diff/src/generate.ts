import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ORACLE_BENCHMARKS, type OracleBenchmarkCase } from './benchmarks.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const LUA_RUNNER = path.resolve(__dirname, '../lua/run_oracle.lua');
const FIXTURES_DIR = path.join(ROOT_DIR, 'fixtures/oracle');

export interface OracleNumericOutput {
  CombinedDPS: number;
  TotalDPS: number;
  FullDPS: number;
  AverageDamage: number;
  AverageHit: number;
  Speed: number;
  CritChance: number;
  CritMultiplier: number;
  HitChance: number;
  ManaCost: number;
  Life: number;
  LifeUnreserved: number;
  LifeRegen: number;
  EnergyShield: number;
  Ward?: number;
  Mana: number;
  ManaUnreserved: number;
  ManaRegen: number;
  Spirit: number;
  SpiritReserved: number;
  SpiritUnreserved: number;
  Armour: number;
  PhysicalDamageReduction: number;
  Evasion: number;
  MeleeEvadeChance: number;
  BlockChance: number;
  SpellBlockChance: number;
  SpellSuppressionChance: number;
  FireResist: number;
  FireResistOverCap: number;
  FireResistMax: number;
  ColdResist: number;
  ColdResistOverCap: number;
  ColdResistMax: number;
  LightningResist: number;
  LightningResistOverCap: number;
  LightningResistMax: number;
  ChaosResist: number;
  ChaosResistOverCap: number;
  ChaosResistMax: number;
  Str: number;
  Dex: number;
  Int: number;
  EffectiveMovementSpeedMod: number;
  TotalEHP: number;
  PhysicalMaximumHitTaken: number;
  FireMaximumHitTaken: number;
  ColdMaximumHitTaken: number;
  LightningMaximumHitTaken: number;
  IgniteDPS: number;
  BleedDPS: number;
  TotalPoisonDPS: number;
  ImpaleDPS?: number;
  SkillTriggerRate?: number;
  PhysicalMin: number;
  PhysicalMax: number;
  FireMin: number;
  FireMax: number;
  ColdMin: number;
  ColdMax: number;
  LightningMin: number;
  LightningMax: number;
  ChaosMin: number;
  ChaosMax: number;
}

export interface OracleGoldenSnapshot {
  id: string;
  title: string;
  game: 'poe1' | 'poe2';
  xml: string;
  pobCommit: string;
  generatedAt: string;
  oracle: OracleNumericOutput;
}

async function getGitRev(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function runUpstreamOracle(bench: OracleBenchmarkCase): Promise<OracleNumericOutput> {
  const repoDir = path.join(
    ROOT_DIR,
    bench.game === 'poe2' ? '.cache/upstream-pob2' : '.cache/upstream-pob',
  );
  const srcDir = path.join(repoDir, 'src');

  const tmpXml = path.join(
    os.tmpdir(),
    `webpob_oracle_${bench.id}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.xml`,
  );
  await fs.writeFile(tmpXml, bench.xml, 'utf-8');

  const luajitBin = process.env.LUAJIT_BIN || path.join(ROOT_DIR, '.cache/luajit-src/src/luajit');
  const clibsPath = path.join(ROOT_DIR, '.cache/clibs/?.so');

  try {
    const env = {
      ...process.env,
      LUA_PATH: `${path.join(repoDir, 'runtime/lua/?.lua')};${path.join(repoDir, 'runtime/lua/?/init.lua')};${srcDir}/?.lua;;`,
      LUA_CPATH: `${clibsPath};;`,
    };
    const { stdout, stderr } = await execFileAsync(luajitBin, [LUA_RUNNER, tmpXml], {
      cwd: srcDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });

    const startMarker = '__ORACLE_JSON_START__';
    const endMarker = '__ORACLE_JSON_END__';
    const sIdx = stdout.indexOf(startMarker);
    const eIdx = stdout.indexOf(endMarker);
    if (sIdx === -1 || eIdx === -1) {
      throw new Error(`Oracle marker missing for ${bench.id}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    const jsonStr = stdout.slice(sIdx + startMarker.length, eIdx).trim();
    return JSON.parse(jsonStr) as OracleNumericOutput;
  } finally {
    await fs.unlink(tmpXml).catch(() => {});
  }
}

async function loadExistingSnapshots(outPath: string): Promise<Map<string, OracleGoldenSnapshot>> {
  const map = new Map<string, OracleGoldenSnapshot>();
  try {
    const raw = await fs.readFile(outPath, 'utf-8');
    const parsed = JSON.parse(raw) as { snapshots?: OracleGoldenSnapshot[] };
    for (const s of parsed.snapshots ?? []) {
      map.set(s.id, s);
    }
  } catch {
    // ignore missing or unreadable file
  }
  return map;
}

async function main() {
  const forceAll = process.argv.includes('--force');
  console.log(
    `=== Generating Official PathOfBuilding Golden Snapshots (LuaJIT Oracle${forceAll ? ', --force' : ', incremental'}) ===\n`,
  );
  const poe1Rev = await getGitRev(path.join(ROOT_DIR, '.cache/upstream-pob'));
  const poe2Rev = await getGitRev(path.join(ROOT_DIR, '.cache/upstream-pob2'));
  const outPath = path.join(FIXTURES_DIR, 'snapshots.json');
  const existingMap = forceAll ? new Map<string, OracleGoldenSnapshot>() : await loadExistingSnapshots(outPath);

  const results = new Array<OracleGoldenSnapshot>(ORACLE_BENCHMARKS.length);
  const pendingIndices: number[] = [];
  let cachedCount = 0;

  for (let i = 0; i < ORACLE_BENCHMARKS.length; i++) {
    const bench = ORACLE_BENCHMARKS[i]!;
    const targetRev = bench.game === 'poe2' ? poe2Rev : poe1Rev;
    const prev = existingMap.get(bench.id);
    if (prev && prev.xml === bench.xml && prev.pobCommit === targetRev) {
      results[i] = prev.title === bench.title ? prev : { ...prev, title: bench.title };
      cachedCount++;
    } else {
      pendingIndices.push(i);
    }
  }

  if (cachedCount > 0) {
    console.log(`Reused ${cachedCount} unchanged snapshots; running LuaJIT on ${pendingIndices.length} benchmark(s)...\n`);
  }

  const concurrency = Math.min(6, Math.max(1, pendingIndices.length));
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= pendingIndices.length) return;
      const benchIdx = pendingIndices[idx]!;
      const bench = ORACLE_BENCHMARKS[benchIdx]!;
      const targetRev = bench.game === 'poe2' ? poe2Rev : poe1Rev;
      const oracle = await runUpstreamOracle(bench);
      console.log(
        `[${idx + 1}/${pendingIndices.length}] OK (${bench.game}) [${bench.id}] -> Life=${Math.round(oracle.Life)}, ES=${Math.round(oracle.EnergyShield)}, Spirit=${Math.round(oracle.Spirit)}, DPS=${Math.round(oracle.CombinedDPS)}`,
      );
      results[benchIdx] = {
        id: bench.id,
        title: bench.title,
        game: bench.game,
        xml: bench.xml,
        pobCommit: targetRev,
        generatedAt: new Date().toISOString(),
        oracle,
      };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ snapshots: results }, null, 2), 'utf-8');
  console.log(`\n✓ Wrote ${results.length} Golden Snapshots to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
