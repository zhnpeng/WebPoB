import type { ArmourBaseStats, GameId, Item, WeaponBaseStats } from '@webpob/core';
import { getBaseItemStats, getPoe2RunesData } from '@webpob/data';
import { normalizeStatLineToEn } from '@webpob/i18n';
import { normalizeWeaponType } from './offenceUpgrade.js';

export interface ResolvedItemStats {
  armourStats?: ArmourBaseStats;
  weaponStats?: WeaponBaseStats;
  globalImplicits: string[];
  globalExplicits: string[];
}

interface LocalArmourAccum {
  flatArmour: number;
  flatEvasion: number;
  flatEs: number;
  flatBlock: number;
  incBlock: number;
  flatWard: number;
  incArmour: number;
  incEvasion: number;
  incEs: number;
  incWard: number;
}

interface LocalWeaponAccum {
  flatPhysMin: number;
  flatPhysMax: number;
  incPhys: number;
  incAttackSpeed: number;
  flatCrit: number;
  incCrit: number;
  eleDamage: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>>;
}

function tryConsumeLocalArmourMod(
  rawLine: string,
  acc: LocalArmourAccum,
  allowBonded?: boolean,
  isShield?: boolean,
): boolean {
  let line = normalizeStatLineToEn(rawLine);
  if (!line) return false;
  if (/^Bonded\s*:/i.test(line)) {
    if (!allowBonded) return false;
    line = line.replace(/^Bonded\s*:\s*/i, '').trim();
  }

  let m = line.match(/^\+(\d+) to Armour$/i);
  if (m) {
    acc.flatArmour += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+) to Evasion Rating$/i);
  if (m) {
    acc.flatEvasion += Number(m[1]);
    return true;
  }
  m = line.match(/^\+(\d+) to maximum Energy Shield$/i);
  if (m) {
    acc.flatEs += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Armour$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incArmour += s * Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Evasion Rating$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incEvasion += s * Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) (?:maximum )?Energy Shield$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incEs += s * Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Armour and Evasion(?: Rating)?$/i);
  if (m) {
    const v = (m[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(m[1]);
    acc.incArmour += v;
    acc.incEvasion += v;
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Armour and Energy Shield$/i);
  if (m) {
    const v = (m[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(m[1]);
    acc.incArmour += v;
    acc.incEs += v;
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Evasion(?: Rating)? and Energy Shield$/i);
  if (m) {
    const v = (m[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(m[1]);
    acc.incEvasion += v;
    acc.incEs += v;
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Armour, Evasion(?: Rating)? and Energy Shield$/i);
  if (m) {
    const v = (m[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(m[1]);
    acc.incArmour += v;
    acc.incEvasion += v;
    acc.incEs += v;
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) Defences$/i);
  if (m) {
    const v = (m[2]!.toLowerCase() === 'reduced' ? -1 : 1) * Number(m[1]);
    acc.incArmour += v;
    acc.incEvasion += v;
    acc.incEs += v;
    acc.incWard += v;
    return true;
  }
  if (isShield) {
    m = line.match(/^\+(\d+)% Chance to Block$/i);
    if (m) {
      acc.flatBlock += Number(m[1]);
      return true;
    }
    m = line.match(/^(\d+)% (increased|reduced) (?:Block Chance|Chance to Block)$/i);
    if (m) {
      const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
      acc.incBlock += s * Number(m[1]);
      return true;
    }
  }
  m = line.match(/^\+(\d+) to (?:maximum )?(?:Runic )?Ward$/i);
  if (m) {
    acc.flatWard += Number(m[1]);
    return true;
  }
  m = line.match(/^(\d+)% (increased|reduced) (?:maximum )?(?:Runic )?Ward$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incWard += s * Number(m[1]);
    return true;
  }
  return false;
}

function tryConsumeLocalWeaponMod(
  rawLine: string,
  acc: LocalWeaponAccum,
  allowBonded?: boolean,
): boolean {
  let line = normalizeStatLineToEn(rawLine);
  if (!line) return false;
  if (/^Bonded\s*:/i.test(line)) {
    if (!allowBonded) return false;
    line = line.replace(/^Bonded\s*:\s*/i, '').trim();
  }

  // Strictly global weapon modifiers must never be consumed into local weapon stats
  // (e.g. "83% increased Elemental Damage with Attacks", "increased Elemental Damage with Attack Skills",
  // "Adds X to Y Fire Damage to Attacks/Spells", "Global Critical Strike Chance").
  if (
    /\b(?:with\s+Attacks?|with\s+Attack\s+Skills?|to\s+Attacks?|to\s+Spells?|for\s+Spells?|Global)\b/i.test(
      line,
    )
  ) {
    return false;
  }

  // Local flat damage: "Adds X to Y <Type> Damage" (NOT "to Spells" / "to Attacks")
  let m = line.match(/^Adds (\d+) to (\d+) (Physical|Fire|Cold|Lightning|Chaos) Damage$/i);
  if (m) {
    const mn = Number(m[1]);
    const mx = Number(m[2]);
    const dt = m[3] as 'Physical' | 'Fire' | 'Cold' | 'Lightning' | 'Chaos';
    if (dt === 'Physical') {
      acc.flatPhysMin += mn;
      acc.flatPhysMax += mx;
    } else {
      const prev = acc.eleDamage[dt] ?? [0, 0];
      acc.eleDamage[dt] = [prev[0] + mn, prev[1] + mx];
    }
    return true;
  }

  m = line.match(/^(\d+)% (increased|reduced) Physical Damage$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incPhys += s * Number(m[1]);
    return true;
  }

  m = line.match(/^(\d+)% (increased|reduced) Attack Speed$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incAttackSpeed += s * Number(m[1]);
    return true;
  }

  // Local Crit Chance: "X% increased Critical Strike Chance" (NOT "Global" / "for Spells")
  m = line.match(/^(\d+)% (increased|reduced) Critical (?:Strike|Hit) Chance$/i);
  if (m) {
    const s = m[2]!.toLowerCase() === 'reduced' ? -1 : 1;
    acc.incCrit += s * Number(m[1]);
    return true;
  }

  m = line.match(/^\+(\d+(?:\.\d+)?)% to Critical (?:Strike|Hit) Chance$/i);
  if (m) {
    acc.flatCrit += Number(m[1]);
    return true;
  }

  return false;
}

function normalizeBondedTemplate(line: string): string {
  return normalizeStatLineToEn(line.replace(/\{[^}]*\}/g, '').trim())
    .replace(/^Bonded\s*:\s*/i, '')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#')
    .trim()
    .toLowerCase();
}

function extractItemRuneNames(item: Item): string[] {
  const runeNames: string[] = [];
  if (Array.isArray(item.runes)) {
    for (const r of item.runes) {
      const cleaned = r.trim();
      if (cleaned && cleaned.toLowerCase() !== 'none') runeNames.push(cleaned);
    }
  }
  if (runeNames.length === 0 && item.rawText) {
    for (const raw of item.rawText.split(/\r?\n/)) {
      const m = raw.match(/^\s*Rune\s*:\s*(.+)$/i);
      if (m) {
        const cleaned = m[1]!.trim();
        if (cleaned && cleaned.toLowerCase() !== 'none') runeNames.push(cleaned);
      }
    }
  }
  return runeNames;
}

function getItemAugmentSlotTypes(item: Item): { broad: string; specific: string } {
  const allLines = [...item.implicits, ...item.explicits];
  for (const raw of allLines) {
    const clean = normalizeStatLineToEn(raw.replace(/\{[^}]*\}/g, '').trim()).toLowerCase();
    const m = clean.match(/^this item gains bonuses from socketed items as though it was a? ?(.+)$/);
    if (m) {
      return { broad: 'armour', specific: m[1]!.trim() };
    }
  }
  const slot = (item.slotType ?? '').toLowerCase();
  const base = item.baseName.toLowerCase();
  if (item.weaponStats) {
    const wt = (item.weaponStats.weaponType ?? '').toLowerCase();
    if (wt.includes('wand') || /\bwand\b/.test(base)) return { broad: 'weapon', specific: 'wand' };
    if (wt.includes('staff') || /\bstaff\b|quarterstaff|fork/.test(base)) {
      return { broad: 'weapon', specific: wt.includes('quarterstaff') || base.includes('quarterstaff') ? 'quarterstaff' : 'staff' };
    }
    if (wt.includes('bow') || /\bbow\b/.test(base)) return { broad: 'weapon', specific: 'bow' };
    if (wt.includes('crossbow') || /\bcrossbow\b/.test(base)) return { broad: 'weapon', specific: 'crossbow' };
    if (wt.includes('sceptre') || /\bsceptre\b/.test(base)) return { broad: 'weapon', specific: 'sceptre' };
    return { broad: 'weapon', specific: wt || 'weapon' };
  }
  if (slot === 'body armour' || /\b(?:regalia|robe|cuirass|plate|garb|vestment|jacket|doublet|brigandine|coat|tunic|mail|raiment|mantle|garment)\b/.test(base)) {
    return { broad: 'armour', specific: 'body armour' };
  }
  if (slot === 'helmet' || /\b(?:helmet|helm|crown|tiara|circlet|cap|hood|mask|burgonet|bascinet|greathelm)\b/.test(base)) {
    return { broad: 'armour', specific: 'helmet' };
  }
  if (slot === 'gloves' || /\b(?:gloves|gauntlets|mitts|bracers|wraps|cuffs)\b/.test(base)) {
    return { broad: 'armour', specific: 'gloves' };
  }
  if (slot === 'boots' || /\b(?:boots|greaves|sandals|shoes|slippers|sabatons|leggings)\b/.test(base)) {
    return { broad: 'armour', specific: 'boots' };
  }
  if (/\b(?:focus)\b/.test(base)) return { broad: 'armour', specific: 'focus' };
  if (/\b(?:buckler)\b/.test(base)) return { broad: 'armour', specific: 'buckler' };
  if (/\b(?:shield|targe)\b/.test(base)) return { broad: 'armour', specific: 'shield' };
  if (/\bquiver\b/.test(base)) return { broad: 'quiver', specific: 'quiver' };
  return { broad: 'armour', specific: slot || 'armour' };
}

function extractNumericSignature(line: string): number[] {
  const nums: number[] = [];
  for (const m of line.matchAll(/[+-]?(\d+(?:\.\d+)?)/g)) {
    nums.push(Number(m[1]));
  }
  return nums;
}

function scaleRuneLineByEffect(line: string, mult: number): string {
  if (mult === 1 || !Number.isFinite(mult)) return line;
  return line.replace(/([+-]?)(\d+(?:\.\d+)?)/g, (_full, sign: string, numStr: string) => {
    const val = Number(numStr);
    const dotIdx = numStr.indexOf('.');
    if (dotIdx === -1) {
      return `${sign}${Math.trunc(val * mult + 1e-9)}`;
    }
    const decimals = numStr.length - dotIdx - 1;
    const factor = Math.pow(10, decimals);
    return `${sign}${Math.trunc(val * mult * factor + 1e-9) / factor}`;
  });
}

/**
 * Upstream PoB 2 `Classes/Item.lua:1280, 1499-1615, 2179-2228, 2825-2840`:
 * 1. `"This item gains bonuses from Socketed Soul Cores as though it was also a <SlotType>"`
 *    (e.g. `Atziri's Splendour` -> `Helmet`): injects Soul Core lines for that additional slot type
 *    when they are absent from the item's exported `{rune}` implicits.
 * 2. `"X% increased effect of Socketed (Augment Items|Items|Runes|Soul Cores)"`:
 *    scales `{rune}` lines whose numeric values match the raw unscaled sum of socketed runes
 *    (leaving already-scaled in-game item copies untouched so there is zero double-scaling).
 */
function applyPoe2SocketedAugmentBonuses(
  item: Item,
  game: GameId,
  implicits: readonly string[],
  explicits: readonly string[],
): { implicits: string[]; explicits: string[] } {
  if (game !== 'poe2') return { implicits: [...implicits], explicits: [...explicits] };

  const runeNames = extractItemRuneNames(item);
  if (runeNames.length === 0) return { implicits: [...implicits], explicits: [...explicits] };

  const allClean = [...implicits, ...explicits].map((l) =>
    normalizeStatLineToEn(l.replace(/\{[^}]*\}/g, '').trim()),
  );

  const extraSoulCoreTypes = new Set<string>();
  let augmentEffectPct = 0;
  let runeEffectPct = 0;
  let soulCoreEffectPct = 0;

  for (const clean of allClean) {
    const mSc = clean.match(
      /^This item gains bonuses from Socketed Soul Cores as though it was also a? ?(.+)$/i,
    );
    if (mSc) {
      extraSoulCoreTypes.add(mSc[1]!.trim().toLowerCase());
      continue;
    }
    let mEff = clean.match(/^(\d+)% increased effect of Socketed (?:Augment )?Items$/i);
    if (mEff) {
      augmentEffectPct += Number(mEff[1]);
      continue;
    }
    mEff = clean.match(/^(\d+)% increased effect of Socketed Runes$/i);
    if (mEff) {
      runeEffectPct += Number(mEff[1]);
      continue;
    }
    mEff = clean.match(/^(\d+)% increased effect of Socketed Soul Cores$/i);
    if (mEff) {
      soulCoreEffectPct += Number(mEff[1]);
      continue;
    }
  }

  if (
    extraSoulCoreTypes.size === 0 &&
    augmentEffectPct === 0 &&
    runeEffectPct === 0 &&
    soulCoreEffectPct === 0
  ) {
    return { implicits: [...implicits], explicits: [...explicits] };
  }

  const ds = getPoe2RunesData();
  if (!ds?.runes) {
    return { implicits: [...implicits], explicits: [...explicits] };
  }

  const byLower = new Map<
    string,
    Record<string, { type?: string; lines?: string[]; bonded?: string[] }>
  >();
  for (const [k, v] of Object.entries(ds.runes)) {
    if (v && typeof v === 'object') {
      byLower.set(
        k.trim().toLowerCase(),
        v as Record<string, { type?: string; lines?: string[]; bonded?: string[] }>,
      );
    }
  }

  const outImplicits = [...implicits];
  const outExplicits = [...explicits];

  // 1. Inject extra Soul Core slot bonuses (e.g. Atziri's Splendour "as though it was also a Helmet")
  if (extraSoulCoreTypes.size > 0) {
    const existingTemplates = new Set(outImplicits.map((l) => normalizeBondedTemplate(l)));
    const scMult = 1 + (augmentEffectPct + soulCoreEffectPct) / 100;
    for (const rn of runeNames) {
      const entry = byLower.get(rn.toLowerCase());
      if (!entry) continue;
      for (const scType of extraSoulCoreTypes) {
        const sub = entry[scType];
        if (!sub || sub.type !== 'SoulCore' || !Array.isArray(sub.lines)) continue;
        for (const scLine of sub.lines) {
          const tpl = normalizeBondedTemplate(scLine);
          if (existingTemplates.has(tpl)) continue;
          outImplicits.push(scMult !== 1 ? scaleRuneLineByEffect(scLine, scMult) : scLine);
        }
      }
    }
  }

  // 2. Scale unscaled {rune} lines when item has Socketed Augment/Rune/SoulCore effect
  if (augmentEffectPct > 0 || runeEffectPct > 0 || soulCoreEffectPct > 0) {
    const { broad, specific } = getItemAugmentSlotTypes(item);
    // Aggregate raw unscaled numeric sums per (template, isBonded) across all socketed runes
    const rawSums = new Map<string, { nums: number[]; augType: string }>();
    for (const rn of runeNames) {
      const entry = byLower.get(rn.toLowerCase());
      if (!entry) continue;
      const slotEntries: Array<{ type?: string; lines?: string[]; bonded?: string[] }> = [];
      if (entry[broad]) slotEntries.push(entry[broad]!);
      if (specific !== broad && entry[specific]) slotEntries.push(entry[specific]!);
      for (const scType of extraSoulCoreTypes) {
        if (scType !== broad && scType !== specific && entry[scType]?.type === 'SoulCore') {
          slotEntries.push(entry[scType]!);
        }
      }
      for (const sub of slotEntries) {
        const augType = sub.type ?? 'Rune';
        for (const rl of sub.lines ?? []) {
          const key = `0:${normalizeBondedTemplate(rl)}`;
          const nums = extractNumericSignature(rl);
          if (nums.length === 0) continue;
          const prev = rawSums.get(key);
          if (prev && prev.nums.length === nums.length) {
            for (let i = 0; i < nums.length; i++) prev.nums[i] = (prev.nums[i] ?? 0) + nums[i]!;
          } else if (!prev) {
            rawSums.set(key, { nums: [...nums], augType });
          }
        }
        for (const bl of sub.bonded ?? []) {
          const key = `1:${normalizeBondedTemplate(bl)}`;
          const nums = extractNumericSignature(bl);
          if (nums.length === 0) continue;
          const prev = rawSums.get(key);
          if (prev && prev.nums.length === nums.length) {
            for (let i = 0; i < nums.length; i++) prev.nums[i] = (prev.nums[i] ?? 0) + nums[i]!;
          } else if (!prev) {
            rawSums.set(key, { nums: [...nums], augType });
          }
        }
      }
    }

    const scaleIfUnscaled = (rawLine: string): string => {
      const clean = normalizeStatLineToEn(rawLine.replace(/\{[^}]*\}/g, '').trim());
      const isBonded = /^Bonded\s*:/i.test(clean);
      const key = `${isBonded ? '1' : '0'}:${normalizeBondedTemplate(clean)}`;
      const expected = rawSums.get(key);
      if (!expected) return rawLine;
      const actualNums = extractNumericSignature(clean);
      if (actualNums.length !== expected.nums.length) return rawLine;
      const matchesRaw = actualNums.every((v, idx) => Math.abs(v - expected.nums[idx]!) < 1e-6);
      if (!matchesRaw) return rawLine;

      let effPct = augmentEffectPct;
      if (expected.augType === 'Rune') effPct += runeEffectPct;
      else if (expected.augType === 'SoulCore') effPct += soulCoreEffectPct;
      if (effPct <= 0) return rawLine;

      const body = isBonded ? clean.replace(/^Bonded\s*:\s*/i, '').trim() : clean;
      const scaled = scaleRuneLineByEffect(body, 1 + effPct / 100);
      return isBonded ? `Bonded: ${scaled}` : scaled;
    };

    for (let i = 0; i < outImplicits.length; i++) {
      outImplicits[i] = scaleIfUnscaled(outImplicits[i]!);
    }
  }

  return { implicits: outImplicits, explicits: outExplicits };
}

/**
 * Upstream PoB 2 `Classes/Item.lua:2232-2240, 2824`:
 * When an item carries `"Idols socketed in this item gain the benefits of their Bonded modifiers"`
 * (e.g. `Fox Idol` or `The Brass Dome` / `Darkness Enthroned`), bonded modifiers originating from
 * socketed `Idol`-type augments are unlocked even on non-Shaman characters, while bonded modifiers
 * from non-Idol Runes (e.g. `Rune of the Blossom`) remain locked unless `allowBonded` is true.
 */
function unlockSocketedIdolBondedLines(
  item: Item,
  game: GameId,
  lines: readonly string[],
  allowBonded?: boolean,
): string[] {
  if (game !== 'poe2' || allowBonded) return [...lines];
  const hasIdolBondedEnabler = [...item.implicits, ...item.explicits].some((l) =>
    /Idols socketed in this item gain the benefits of their Bonded modifiers/i.test(
      normalizeStatLineToEn(l.replace(/\{[^}]*\}/g, '').trim()),
    ),
  );
  if (!hasIdolBondedEnabler) return [...lines];

  const runeNames = extractItemRuneNames(item);
  if (runeNames.length === 0) return [...lines];

  const ds = getPoe2RunesData();
  const idolBondedTemplates = new Set<string>();
  if (ds?.runes) {
    const byLower = new Map<string, Record<string, { type?: string; bonded?: string[] }>>();
    for (const [k, v] of Object.entries(ds.runes)) {
      if (v && typeof v === 'object') {
        byLower.set(k.trim().toLowerCase(), v as Record<string, { type?: string; bonded?: string[] }>);
      }
    }
    for (const rn of runeNames) {
      const entry = byLower.get(rn.trim().toLowerCase());
      if (!entry) continue;
      for (const sub of Object.values(entry)) {
        if (sub?.type === 'Idol' && Array.isArray(sub.bonded)) {
          for (const bl of sub.bonded) {
            idolBondedTemplates.add(normalizeBondedTemplate(bl));
          }
        }
      }
    }
  } else {
    // Minimal built-in fallback when poe2-runes.json dataset is not loaded (e.g. isolated unit tests)
    for (const rn of runeNames) {
      if (rn.trim().toLowerCase() === 'fox idol') {
        idolBondedTemplates.add(normalizeBondedTemplate('+5% to Quality of all Skills'));
        idolBondedTemplates.add(normalizeBondedTemplate('Minions have 30% increased Area of Effect'));
      }
    }
  }
  if (idolBondedTemplates.size === 0) return [...lines];

  return lines.map((rawLine) => {
    const stripped = rawLine.replace(/\{[^}]*\}/g, '').trim();
    const en = normalizeStatLineToEn(stripped);
    if (!/^Bonded\s*:/i.test(en)) return rawLine;
    const tpl = normalizeBondedTemplate(en);
    if (!idolBondedTemplates.has(tpl)) return rawLine;
    return en.replace(/^Bonded\s*:\s*/i, '').trim();
  });
}

const ARMOUR_BASE_NAME_RE =
  /\b(?:shield|buckler|focus|targe|cuirass|plate|robe|garb|vestment|vestments|jacket|doublet|brigandine|coat|tunic|mail|regalia|raiment|mantle|garment|helmet|helm|crown|tiara|circlet|cap|hood|mask|burgonet|bascinet|greathelm|gloves|gauntlets|mitts|bracers|wraps|cuffs|boots|greaves|sandals|shoes|slippers|sabatons|leggings)\b/i;

/**
 * Resolves Path of Building-authentic Local Armour & Local Weapon stats
 * (PoE 1 3.25+/3.30 & PoE 2 0.5 multiplicative quality formula) and returns
 * only the non-local modifiers that should be fed to the global `ModDB`.
 */
export function resolveItemEffectiveStats(
  item: Item,
  game: GameId,
  opts?: { allowBonded?: boolean },
): ResolvedItemStats {
  // Hand-crafted starter presets without `localStatsPrecomputed` flag retain backward compatibility
  if (item.localStatsPrecomputed === undefined) {
    return {
      armourStats: item.armourStats,
      weaponStats: item.weaponStats,
      globalImplicits: item.implicits,
      globalExplicits: item.explicits,
    };
  }

  const augResolved = applyPoe2SocketedAugmentBonuses(item, game, item.implicits, item.explicits);
  const effectiveImplicits = unlockSocketedIdolBondedLines(item, game, augResolved.implicits, opts?.allowBonded);
  const effectiveExplicits = unlockSocketedIdolBondedLines(item, game, augResolved.explicits, opts?.allowBonded);

  const hasPrecomputedSpiritHeader = Boolean(
    item.rawText && /^(?:Spirit|精魂)\s*[:：]\s*\+?\d+/im.test(item.rawText),
  );
  const stripLocalSpirit = (lines: readonly string[]): string[] =>
    hasPrecomputedSpiritHeader
      ? lines.filter((l) => !/^\d+%\s+increased\s+Spirit$/i.test(normalizeStatLineToEn(l)))
      : [...lines];

  const isWeapon = Boolean(item.weaponStats);
  const isArmour =
    !isWeapon &&
    (Boolean(item.armourStats) ||
      item.slotType === 'Body Armour' ||
      item.slotType === 'Helmet' ||
      item.slotType === 'Gloves' ||
      item.slotType === 'Boots' ||
      ARMOUR_BASE_NAME_RE.test(item.baseName));

  if (!isWeapon && !isArmour) {
    return {
      armourStats: item.armourStats,
      weaponStats: item.weaponStats,
      globalImplicits: stripLocalSpirit(effectiveImplicits),
      globalExplicits: stripLocalSpirit(effectiveExplicits),
    };
  }

  const globalImplicits: string[] = [];
  const globalExplicits: string[] = [];

  if (isArmour) {
    const baseBlockFromDb = getBaseItemStats(item.baseName, 0, game)?.armour?.blockChance;
    const isShield =
      /\b(?:shield|buckler|targe)\b/i.test(item.baseName) ||
      Boolean(baseBlockFromDb || item.armourStats?.blockChance);

    const acc: LocalArmourAccum = {
      flatArmour: 0,
      flatEvasion: 0,
      flatEs: 0,
      flatBlock: 0,
      incBlock: 0,
      flatWard: 0,
      incArmour: 0,
      incEvasion: 0,
      incEs: 0,
      incWard: 0,
    };
    for (const line of effectiveImplicits) {
      if (!tryConsumeLocalArmourMod(line, acc, opts?.allowBonded, isShield)) {
        globalImplicits.push(line);
      }
    }
    for (const line of effectiveExplicits) {
      if (!tryConsumeLocalArmourMod(line, acc, opts?.allowBonded, isShield)) {
        globalExplicits.push(line);
      }
    }

    if (item.localStatsPrecomputed) {
      let preArmour = item.armourStats;
      const hasPrecomputedBlockHeader = Boolean(
        item.rawText && /^\s*(?:Chance to Block|Block Chance|格挡几率)\s*[:：]\s*\d+/im.test(item.rawText),
      );
      if (preArmour && isShield && !hasPrecomputedBlockHeader) {
        const baseBlock = baseBlockFromDb ?? preArmour.blockChance;
        if (baseBlock || acc.flatBlock) {
          preArmour = {
            ...preArmour,
            blockChance: Math.min(
              100,
              Math.floor(
                ((baseBlock ?? 0) + acc.flatBlock) * Math.max(0, 1 + acc.incBlock / 100) + 1e-9,
              ),
            ),
          };
        }
      }
      return {
        armourStats: preArmour,
        weaponStats: undefined,
        globalImplicits: stripLocalSpirit(globalImplicits),
        globalExplicits: stripLocalSpirit(globalExplicits),
      };
    }

    // Official PoB Item.lua: Tabula Rasa, Skin of the Loyal/Lords & The Apostate have zero base defences
    const ZERO_BASE_DEFENCE_UNIQUES = new Set([
      'Tabula Rasa',
      'Skin of the Loyal',
      'Skin of the Lords',
      'The Apostate',
    ]);
    // Compute exact PoB 3.30 / PoE 2 0.5 local Armour/Evasion/ES/Ward with multiplicative Quality
    const rawBase = ZERO_BASE_DEFENCE_UNIQUES.has(item.name)
      ? {}
      : (getBaseItemStats(item.baseName, 0, game)?.armour ?? item.armourStats ?? {});
    const qMult = 1 + Math.max(0, item.quality) / 100;
    const baseArm = (rawBase.armour ?? 0) + acc.flatArmour;
    const baseEva = (rawBase.evasion ?? 0) + acc.flatEvasion;
    const baseEs = (rawBase.energyShield ?? 0) + acc.flatEs;
    const baseWard = (rawBase.ward ?? 0) + acc.flatWard;
    const rawBlock = (rawBase.blockChance ?? 0) + acc.flatBlock;

    const computedArmour: ArmourBaseStats = {
      ...(baseArm > 0 ? { armour: Math.round(baseArm * Math.max(0, 1 + acc.incArmour / 100) * qMult) } : {}),
      ...(baseEva > 0 ? { evasion: Math.round(baseEva * Math.max(0, 1 + acc.incEvasion / 100) * qMult) } : {}),
      ...(baseEs > 0 ? { energyShield: Math.round(baseEs * Math.max(0, 1 + acc.incEs / 100) * qMult) } : {}),
      ...(baseWard > 0 ? { ward: Math.round(baseWard * Math.max(0, 1 + acc.incWard / 100) * qMult) } : {}),
      ...(rawBlock > 0
        ? {
            blockChance: Math.min(
              100,
              Math.floor(rawBlock * Math.max(0, 1 + acc.incBlock / 100) + 1e-9),
            ),
          }
        : {}),
    };

    return {
      armourStats: Object.keys(computedArmour).length > 0 ? computedArmour : undefined,
      weaponStats: undefined,
      globalImplicits: stripLocalSpirit(globalImplicits),
      globalExplicits: stripLocalSpirit(globalExplicits),
    };
  }

  // Weapon local computation
  const acc: LocalWeaponAccum = {
    flatPhysMin: 0,
    flatPhysMax: 0,
    incPhys: 0,
    incAttackSpeed: 0,
    flatCrit: 0,
    incCrit: 0,
    eleDamage: {},
  };
  for (const line of effectiveImplicits) {
    if (!tryConsumeLocalWeaponMod(line, acc, opts?.allowBonded)) globalImplicits.push(line);
  }
  for (const line of effectiveExplicits) {
    if (!tryConsumeLocalWeaponMod(line, acc, opts?.allowBonded)) globalExplicits.push(line);
  }

  if (item.localStatsPrecomputed) {
    const preWeapon = item.weaponStats
      ? {
          ...item.weaponStats,
          weaponType: normalizeWeaponType(
            item.baseName,
            item.weaponStats.weaponType,
          ) as WeaponBaseStats['weaponType'],
        }
      : undefined;
    return {
      armourStats: undefined,
      weaponStats: preWeapon,
      globalImplicits: stripLocalSpirit(globalImplicits),
      globalExplicits: stripLocalSpirit(globalExplicits),
    };
  }

  const rawBase = getBaseItemStats(item.baseName, 0, game)?.weapon ?? item.weaponStats!;
  const qMult = 1 + Math.max(0, item.quality) / 100;
  const physMin = Math.round((rawBase.physicalMin + acc.flatPhysMin) * (1 + acc.incPhys / 100) * qMult);
  const physMax = Math.round((rawBase.physicalMax + acc.flatPhysMax) * (1 + acc.incPhys / 100) * qMult);
  const attacksPerSecond = Math.round(rawBase.attacksPerSecond * (1 + acc.incAttackSpeed / 100) * 100) / 100;
  const critChance = Math.round((rawBase.critChance + acc.flatCrit) * (1 + acc.incCrit / 100) * 100) / 100;

  const mergedEle: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>> = {};
  for (const dt of ['Fire', 'Cold', 'Lightning', 'Chaos'] as const) {
    const baseR = rawBase.elementalDamage?.[dt];
    const addR = acc.eleDamage[dt];
    if (baseR || addR) {
      mergedEle[dt] = [(baseR?.[0] ?? 0) + (addR?.[0] ?? 0), (baseR?.[1] ?? 0) + (addR?.[1] ?? 0)];
    }
  }

  const computedWeapon: WeaponBaseStats = {
    ...rawBase,
    weaponType: normalizeWeaponType(item.baseName, rawBase.weaponType) as WeaponBaseStats['weaponType'],
    physicalMin: physMin,
    physicalMax: physMax,
    elementalDamage: Object.keys(mergedEle).length > 0 ? mergedEle : undefined,
    attacksPerSecond,
    critChance,
  };

  return {
    armourStats: undefined,
    weaponStats: computedWeapon,
    globalImplicits: stripLocalSpirit(globalImplicits),
    globalExplicits: stripLocalSpirit(globalExplicits),
  };
}
