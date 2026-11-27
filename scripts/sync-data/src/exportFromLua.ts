import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTranslationCsv } from './csvParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');
const CACHE_DIR = process.env.WEBPOB_CACHE_DIR
  ? path.resolve(process.env.WEBPOB_CACHE_DIR)
  : path.join(ROOT_DIR, '.cache');
const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'apps/web/public/data');
const LUAJIT_BIN = path.join(CACHE_DIR, 'luajit-src/src/luajit');
const CLIBS_DIR = path.join(CACHE_DIR, 'clibs');
const EXPORT_LUA = path.join(__dirname, '../lua/export_pob_data.lua');

interface ExportedGemData {
  en: string;
  sup: number;
  ct?: number;
  cd?: number;
  dm?: number;
  cc?: number;
  asm?: number;
  mrp?: number;
  mrf?: number;
  sr?: number;
  bd?: Record<string, [number, number]>;
  am?: number;
  de?: number;
  mc?: number;
  st?: string[];
  qs?: Array<{ t: string; q: number }>;
  ls?: Record<
    string,
    {
      bd?: Record<string, [number, number]>;
      am?: number;
      de?: number;
      mc?: number;
      st?: string[];
    }
  >;
}

interface ExistingGemsFile {
  game: 'poe1' | 'poe2';
  count: number;
  gems: Array<{
    id: string;
    en: string;
    zh?: string;
    cat: 'active' | 'support';
    color: 'red' | 'green' | 'blue' | 'white';
    tags: string[];
    [k: string]: unknown;
  }>;
}

async function fetchUniqueZhDict(game: 'poe1' | 'poe2'): Promise<Map<string, string>> {
  const repo = game === 'poe1' ? 'PoeCharm' : 'PoeCharm2';
  const files = [
    'Uniques.txt.csv',
    'Items_Armour.txt.csv',
    'Items_Weapons.txt.csv',
    'Items_Accessories.txt.csv',
    'Items_Flasks.txt.csv',
    'Items_Jewels.txt.csv',
  ];
  const merged = new Map<string, string>();
  await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/Chuanhsing/${repo}/master/Data/Translate/zh-rCN/${f}`,
          { headers: { 'User-Agent': 'WebPoB-Sync/0.3' } },
        );
        if (!res.ok) return;
        const text = await res.text();
        const dict = parseTranslationCsv(text);
        for (const [k, v] of dict) {
          if (!merged.has(k)) merged.set(k, v);
        }
      } catch {
        // tolerate optional network hiccups
      }
    }),
  );
  return merged;
}

async function fetchClusterZhDict(): Promise<{ dn: Map<string, string>; sd: Map<string, string> }> {
  const dn = new Map<string, string>();
  const sd = new Map<string, string>();
  await Promise.all([
    (async () => {
      try {
        const res = await fetch(
          'https://raw.githubusercontent.com/Chuanhsing/PoeCharm/master/Data/Translate/zh-rCN/tree_dn.csv',
          { headers: { 'User-Agent': 'WebPoB-Sync/0.3' } },
        );
        if (res.ok) {
          for (const [k, v] of parseTranslationCsv(await res.text())) dn.set(k, v);
        }
      } catch {}
    })(),
    (async () => {
      try {
        const res = await fetch(
          'https://raw.githubusercontent.com/Chuanhsing/PoeCharm/master/Data/Translate/zh-rCN/tree_sd.csv',
          { headers: { 'User-Agent': 'WebPoB-Sync/0.3' } },
        );
        if (res.ok) {
          for (const [k, v] of parseTranslationCsv(await res.text())) sd.set(k, v);
        }
      } catch {}
    })(),
  ]);
  return { dn, sd };
}

async function runGameExport(game: 'poe1' | 'poe2') {
  const upstreamSrc = path.join(
    CACHE_DIR,
    game === 'poe1' ? 'upstream-pob/src' : 'upstream-pob2/src',
  );
  const outBases = path.join(PUBLIC_DATA_DIR, `${game}-bases.json`);
  const tmpGems = path.join(CACHE_DIR, `${game}-gems-lua.json`);
  const outUniques = path.join(PUBLIC_DATA_DIR, `${game}-uniques.json`);
  const outClusters = game === 'poe1' ? path.join(PUBLIC_DATA_DIR, 'poe1-clusters.json') : '';

  // Snapshot existing unique ZH translations so offline runs never lose translations
  const prevUniqueZh = new Map<string, { zh?: string; bz?: string }>();
  try {
    const prevUniques = JSON.parse(await fs.readFile(outUniques, 'utf-8')) as {
      uniques?: Array<{ en?: string; zh?: string; bz?: string }>;
    };
    for (const u of prevUniques.uniques ?? []) {
      if (u.en && (u.zh || u.bz)) prevUniqueZh.set(u.en, { zh: u.zh, bz: u.bz });
    }
  } catch {
    // ignore if missing
  }

  console.log(`\n=== Exporting ${game.toUpperCase()} Bases, Uniques, Clusters & Official Skill Tables via LuaJIT ===`);
  const [zhDict, clusterZh] = await Promise.all([
    fetchUniqueZhDict(game),
    game === 'poe1' ? fetchClusterZhDict() : Promise.resolve(null),
  ]);
  const luaArgs = [EXPORT_LUA, game, outBases, tmpGems, outUniques, ...(outClusters ? [outClusters] : [])];
  const stdout = execFileSync(LUAJIT_BIN, luaArgs, {
    cwd: upstreamSrc,
    env: {
      ...process.env,
      LUA_PATH: './?.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua;;',
      LUA_CPATH: `${CLIBS_DIR}/?.so;;`,
    },
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  for (const line of stdout.split('\n')) {
    if (line.startsWith('Exported ')) console.log('  ' + line);
  }

  if (outClusters && clusterZh) {
    const rawCl = JSON.parse(await fs.readFile(outClusters, 'utf-8')) as {
      game: 'poe1';
      count: number;
      notables: Record<string, { en: string; st: string[] }>;
    };
    const enrichedClusters: Record<string, { en: string; zh?: string; st: string[]; sz?: string[] }> = {};
    let zhClHits = 0;
    for (const [k, v] of Object.entries(rawCl.notables)) {
      const zh = clusterZh.dn.get(v.en);
      if (zh) zhClHits++;
      const sz = v.st.map((l) => clusterZh.sd.get(l) ?? l);
      const anySz = sz.some((l, idx) => l !== v.st[idx]);
      enrichedClusters[k] = {
        en: v.en,
        ...(zh ? { zh } : {}),
        st: v.st,
        ...(anySz ? { sz } : {}),
      };
    }
    await fs.writeFile(
      outClusters,
      JSON.stringify({ game: 'poe1', count: rawCl.count, notables: enrichedClusters }),
      'utf-8',
    );
    console.log(`  ✓ Enriched ${zhClHits}/${rawCl.count} PoE 1 Cluster Jewel notables with ZH names`);
  }

  // Enrich exported Uniques with Chinese names & base names from PoeCharm
  const rawUniques = JSON.parse(await fs.readFile(outUniques, 'utf-8')) as {
    game: 'poe1' | 'poe2';
    count: number;
    uniques: Array<{ en: string; b: string; s: string; i?: string[]; e: string[] }>;
  };
  let zhUniqueHits = 0;
  const enrichedUniques = rawUniques.uniques.map((u) => {
    const prev = prevUniqueZh.get(u.en);
    const zh = zhDict.get(u.en) ?? prev?.zh;
    const bzh = zhDict.get(u.b) ?? prev?.bz;
    if (zh) zhUniqueHits++;
    return {
      en: u.en,
      ...(zh ? { zh } : {}),
      b: u.b,
      ...(bzh ? { bz: bzh } : {}),
      s: u.s,
      ...(Array.isArray(u.i) && u.i.length > 0 ? { i: u.i } : {}),
      e: Array.isArray(u.e) ? u.e : [],
    };
  });
  await fs.writeFile(
    outUniques,
    JSON.stringify({ game, count: enrichedUniques.length, uniques: enrichedUniques }),
    'utf-8',
  );
  const uniqKb = Math.round(((await fs.stat(outUniques)).size / 1024) * 10) / 10;
  console.log(
    `  ✓ Enriched ${zhUniqueHits}/${enrichedUniques.length} ${game.toUpperCase()} Uniques with ZH names (${uniqKb} KB)`,
  );

  // Merge Lua-evaluated official skill numbers into existing bilingual poeX-gems.json (preserving all ZH names!)
  const existingPath = path.join(PUBLIC_DATA_DIR, `${game}-gems.json`);
  const existing = JSON.parse(await fs.readFile(existingPath, 'utf-8')) as ExistingGemsFile;
  const luaPayload = JSON.parse(await fs.readFile(tmpGems, 'utf-8')) as {
    gems: Record<string, ExportedGemData>;
  };

  let enrichedCount = 0;
  const mergedGems = existing.gems.map((entry) => {
    const key = entry.en.toLowerCase().trim();
    const altKey = key.replace(/\s+support$/i, '');
    const lua = luaPayload.gems[key] ?? luaPayload.gems[altKey];
    if (!lua) return entry;
    enrichedCount++;
    const enriched: Record<string, unknown> = {
      id: entry.id,
      en: entry.en,
      ...(entry.zh ? { zh: entry.zh } : {}),
      cat: entry.cat,
      color: entry.color,
      tags: entry.tags,
    };
    if (lua.ct !== undefined) enriched.ct = lua.ct;
    if (lua.cd !== undefined) enriched.cd = lua.cd;
    if (lua.dm !== undefined) enriched.dm = lua.dm;
    if (lua.cc !== undefined) enriched.cc = lua.cc;
    if (lua.asm !== undefined) enriched.asm = lua.asm;
    if (lua.mrp !== undefined) enriched.mrp = lua.mrp;
    if (lua.mrf !== undefined) enriched.mrf = lua.mrf;
    if (lua.sr !== undefined) enriched.sr = lua.sr;
    if (lua.bd !== undefined) enriched.bd = lua.bd;
    if (lua.am !== undefined) enriched.am = lua.am;
    if (lua.de !== undefined) enriched.de = lua.de;
    if (lua.mc !== undefined) enriched.mc = lua.mc;
    if (lua.st !== undefined && lua.st.length > 0) enriched.st = lua.st;
    if (lua.qs !== undefined) enriched.qs = lua.qs;
    if (lua.ls !== undefined) enriched.ls = lua.ls;
    return enriched;
  });

  const outPayload = {
    game,
    count: mergedGems.length,
    gems: mergedGems,
  };
  await fs.writeFile(existingPath, JSON.stringify(outPayload), 'utf-8');
  const sizeKb = Math.round((Buffer.byteLength(JSON.stringify(outPayload)) / 1024) * 10) / 10;
  const baseSizeKb = Math.round(((await fs.stat(outBases)).size / 1024) * 10) / 10;
  console.log(
    `  ✓ Enriched ${enrichedCount}/${mergedGems.length} ${game.toUpperCase()} gems with official Lv.1-40 stats (${sizeKb} KB); bases (${baseSizeKb} KB)`,
  );
}

async function main() {
  await runGameExport('poe1');
  await runGameExport('poe2');
  console.log('\nDone!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
