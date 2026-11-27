import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerGemsData, type CompactGemsPayload } from './treeLoader.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA_DIR = path.resolve(currentDir, '../../../apps/web/public/data');

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(PUBLIC_DATA_DIR, file), 'utf8')) as T;

const poe1GemsPayload = readJson<CompactGemsPayload>('poe1-gems.json');
const poe2GemsPayload = readJson<CompactGemsPayload>('poe2-gems.json');

type UniqueFile = {
  game: string;
  count: number;
  uniques: Array<{ en: string; zh?: string; b: string; bz?: string; s: string; i?: string[]; e: string[] }>;
};

const poe1Uniques = readJson<UniqueFile>('poe1-uniques.json');
const poe2Uniques = readJson<UniqueFile>('poe2-uniques.json');

function findGem(payload: CompactGemsPayload, name: string) {
  const lower = name.toLowerCase();
  return payload.gems.find(
    (g) => g.en.toLowerCase() === lower || g.en.toLowerCase() === `${lower} support`,
  );
}

describe('gem export alignment (PoE 1 + PoE 2)', () => {
  it('contains zero +- double-sign stat lines across poe1-gems.json and poe2-gems.json', () => {
    for (const [label, payload] of [
      ['poe1', poe1GemsPayload],
      ['poe2', poe2GemsPayload],
    ] as const) {
      const offenders: string[] = [];
      for (const g of payload.gems) {
        for (const line of g.st ?? []) {
          if (/\+-/.test(line)) offenders.push(`${label}:${g.en}:st:${line}`);
        }
        for (const [lv, snap] of Object.entries(g.ls ?? {})) {
          for (const line of snap.st ?? []) {
            if (/\+-/.test(line)) offenders.push(`${label}:${g.en}:ls[${lv}]:${line}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    }
  });

  it('exports clean Cursed enemies stat lines for PoE 1 & PoE 2 hex curses', () => {
    expect(findGem(poe1GemsPayload, 'Flammability')?.st).toContain(
      'Cursed enemies have -36% to Fire Resistance',
    );
    expect(findGem(poe1GemsPayload, 'Frostbite')?.st).toContain(
      'Cursed enemies have -36% to Cold Resistance',
    );
    expect(findGem(poe1GemsPayload, 'Conductivity')?.st).toContain(
      'Cursed enemies have -36% to Lightning Resistance',
    );
    expect(findGem(poe1GemsPayload, 'Elemental Weakness')?.st).toContain(
      'Cursed enemies have -30% to Elemental Resistances',
    );
    expect(findGem(poe1GemsPayload, 'Despair')?.st).toContain(
      'Cursed enemies have -30% to Chaos Resistance',
    );
    expect(findGem(poe1GemsPayload, 'Vulnerability')?.st).toContain(
      'Cursed enemies take 30% increased Physical Damage',
    );
    expect(findGem(poe1GemsPayload, 'Punishment')?.st).toContain(
      'Cursed enemies take 58% increased Damage',
    );

    expect(findGem(poe2GemsPayload, 'Elemental Weakness')?.st).toContain(
      'Cursed enemies have -59% to Elemental Resistances',
    );
    expect(findGem(poe2GemsPayload, 'Despair')?.st).toContain(
      'Cursed enemies have -49% to Chaos Resistance',
    );
    expect(findGem(poe2GemsPayload, 'Vulnerability')?.st?.some((s) => /Cursed enemies have -\d+ to Armour/.test(s))).toBe(true);
  });

  it('extends levelScaling (ls) up to Lv.40 for PoE 2 Spark and Grim Pillars', () => {
    const spark = findGem(poe2GemsPayload, 'Spark');
    expect(spark?.ls?.['35']?.bd?.Lightning).toBeDefined();
    expect(spark?.ls?.['38']?.bd?.Lightning).toBeDefined();
    expect(spark?.ls?.['40']?.bd?.Lightning).toBeDefined();
    expect(spark!.ls!['38']!.bd!.Lightning![1]).toBeGreaterThan(spark!.ls!['30']!.bd!.Lightning![1]);

    const grimPillars = findGem(poe2GemsPayload, 'Grim Pillars');
    expect(grimPillars?.ls?.['35']?.bd?.Cold).toBeDefined();
    expect(grimPillars?.ls?.['38']?.bd?.Cold).toBeDefined();
    expect(grimPillars?.ls?.['40']?.bd?.Cold).toBeDefined();
    expect(grimPillars!.ls!['36']!.bd!.Cold![1]).toBeGreaterThan(grimPillars!.ls!['30']!.bd!.Cold![1]);
  });

  it('exports full PoE 1 support gem & active buff stats from upstream Lua', () => {
    const multistrike = findGem(poe1GemsPayload, 'Multistrike');
    expect(multistrike?.st).toContain('44% more Attack Speed');
    expect(multistrike?.st).toContain('22% more Damage on First Repeat');
    expect(multistrike?.st).toContain('44% more Damage on Second Repeat');

    expect(findGem(poe1GemsPayload, 'Spell Echo')?.st).toContain('54% more Cast Speed');
    expect(findGem(poe1GemsPayload, 'Archmage')?.st?.some((s) => /Unreserved Mana/i.test(s))).toBe(true);
    expect(findGem(poe1GemsPayload, 'Arcane Surge')?.st).toContain('35% more Spell Damage');
    expect(findGem(poe1GemsPayload, 'Righteous Fire')?.st).toContain('39% more Spell Damage');
    expect(findGem(poe1GemsPayload, 'Trinity')?.st).toContain('30% more Elemental Damage');
    expect(findGem(poe1GemsPayload, 'Trinity')?.st).toContain('Damage Penetrates 16% Elemental Resistance');
    expect(findGem(poe1GemsPayload, 'Infused Channelling')?.st).toContain('29% more Damage');
    expect(findGem(poe1GemsPayload, 'Power Charge On Critical')?.st).toContain('4% more Damage per Power Charge');
    expect(findGem(poe1GemsPayload, 'Volatility')?.st).toContain('58% more Maximum Damage');
    expect(findGem(poe1GemsPayload, 'Ruthless')?.st).toContain('98% more Melee Damage with Ruthless Blows');
    expect(findGem(poe1GemsPayload, 'Pinpoint')?.st).toContain('60% more Projectile Damage');

    const eleHit = findGem(poe1GemsPayload, 'Elemental Hit');
    expect(eleHit?.st?.some((s) => /Adds \d+ to \d+ Fire Damage/.test(s))).toBe(true);
    expect(eleHit?.st?.some((s) => /Adds \d+ to \d+ Cold Damage/.test(s))).toBe(true);
    expect(eleHit?.st?.some((s) => /Adds \d+ to \d+ Lightning Damage/.test(s))).toBe(true);

    const vaalFb = findGem(poe1GemsPayload, 'Vaal Flameblast');
    expect(vaalFb?.st).toContain('3000% more Spell Damage');
  });

  it('exports full PoE 2 support gem & persistent buff stats from upstream Lua', () => {
    expect(findGem(poe2GemsPayload, 'Archmage')?.st).toContain(
      'Gain 4% of Damage as Extra Lightning Damage per 100 Maximum Mana',
    );
    const chargeReg = findGem(poe2GemsPayload, 'Charge Regulation');
    expect(chargeReg?.st).toContain('20% more Armour');
    expect(chargeReg?.st).toContain('20% more Evasion Rating');
    expect(chargeReg?.st).toContain('20% more maximum Energy Shield');
    expect(chargeReg?.st).toContain('26% more Critical Strike Chance');

    expect(findGem(poe2GemsPayload, 'Wind Dancer')?.st).toContain('30% more Evasion Rating');
    expect(findGem(poe2GemsPayload, 'Spell Echo')?.st).toContain('Repeats 1 additional time');
    expect(findGem(poe2GemsPayload, "Rakiata's Flow")?.st).toContain(
      'Hits treat Enemy Monster Elemental Resistance values as inverted',
    );
    expect(findGem(poe2GemsPayload, 'Minion Pact II')?.st).toContain('35% more Damage');
    expect(findGem(poe2GemsPayload, 'Zenith II')?.st).toContain('30% more Damage');
    expect(findGem(poe2GemsPayload, 'Execute III')?.st).toContain('30% more Damage with Hits');
    expect(findGem(poe2GemsPayload, "Garukhan's Resolve")?.st).toContain('Critical Hits are Bifurcated');
    expect(findGem(poe2GemsPayload, "Vorana's Siege")?.st).toContain('20% more Damage with Hits');
    expect(findGem(poe2GemsPayload, 'Urgent Totems III')?.st).toContain('20% increased Cast Speed');
    expect(findGem(poe2GemsPayload, 'Heft')?.st).toContain('30% more Maximum Physical Damage');
    expect(findGem(poe2GemsPayload, 'Aftershock I')?.st).toContain('25% chance to create an Aftershock');
  });

  it('does NOT fabricate fake 18-25% more Damage on utility supports with empty st', () => {
    const hydratedPoe1 = registerGemsData('poe1', poe1GemsPayload);
    const hydratedPoe2 = registerGemsData('poe2', poe2GemsPayload);

    const hextouch = hydratedPoe1.find((g) => g.name.en.toLowerCase().startsWith('hextouch'));
    expect(hextouch).toBeDefined();
    expect(hextouch!.stats.some((s) => /more .*Damage/i.test(s))).toBe(false);

    const arrogance = hydratedPoe1.find((g) => g.name.en.toLowerCase().startsWith('arrogance'));
    expect(arrogance).toBeDefined();
    expect(arrogance!.stats.some((s) => /more .*Damage/i.test(s))).toBe(false);

    const blasphemy = hydratedPoe1.find((g) => g.name.en.toLowerCase().startsWith('blasphemy'));
    expect(blasphemy).toBeDefined();
    expect(blasphemy!.stats.some((s) => /more .*Damage/i.test(s))).toBe(false);

    const cannibalism = hydratedPoe2.find((g) => g.name.en.toLowerCase() === 'cannibalism i');
    expect(cannibalism).toBeDefined();
    expect(cannibalism!.stats).toEqual([]);
  });

  it('preserves all Chinese gem names with zero ZH regression', () => {
    const p1Zh = poe1GemsPayload.gems.filter((g) => g.zh && /[\u4e00-\u9fff]/.test(g.zh)).length;
    const p2Zh = poe2GemsPayload.gems.filter((g) => g.zh && /[\u4e00-\u9fff]/.test(g.zh)).length;
    expect(p1Zh).toBeGreaterThanOrEqual(822);
    expect(p2Zh).toBeGreaterThanOrEqual(961);
  });

  it('strips Corrupted/Version/Influence metadata noise from uniques without losing ZH names', () => {
    const noiseRe = /^(?:Corrupted|Elder Item|Shaper Item|Historic|Synthesised Item|Fractured Item|Mirrored)$|^Version:/;
    for (const [label, dataset] of [
      ['poe1', poe1Uniques],
      ['poe2', poe2Uniques],
    ] as const) {
      const leaked = dataset.uniques.filter((u) => u.e.some((line) => noiseRe.test(line)));
      expect(leaked, `${label} leaked unique metadata`).toEqual([]);
    }
    const p1UniqueZh = poe1Uniques.uniques.filter((u) => u.zh && /[\u4e00-\u9fff]/.test(u.zh)).length;
    const p2UniqueZh = poe2Uniques.uniques.filter((u) => u.zh && /[\u4e00-\u9fff]/.test(u.zh)).length;
    expect(p1UniqueZh).toBeGreaterThanOrEqual(1280);
    expect(p2UniqueZh).toBeGreaterThanOrEqual(420);
  });
});
