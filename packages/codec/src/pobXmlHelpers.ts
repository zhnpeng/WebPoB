import type { GameId, PassiveTreeData, WeaponSetId } from '@webpob/core';

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function parseAttributes(tagHeader: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(tagHeader)) !== null) {
    attrs[match[1]!] = unescapeXml(match[2]!);
  }
  return attrs;
}

/**
 * Parses PoB1 `<Spec masteryEffects="{nodeId,effectId},...">` into `TreeSpec.masteryEffects`.
 * Resolves `effectId` against `tree.nodes[nodeId]?.masteryEffects` (with global mastery lookup fallback)
 * to produce `stats.join('\n')`, falling back to `String(effectId)` when the tree is not hydrated.
 */
export function parseMasteryEffectsAttr(
  raw: string | undefined,
  tree?: PassiveTreeData,
): Record<number, string> {
  const result: Record<number, string> = {};
  if (!raw) return result;

  let globalEffectLookup: Map<number, string[]> | null = null;
  const pairRegex = /\{(\d+)\s*,\s*(\d+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(raw)) !== null) {
    const nodeId = Number(match[1]);
    const effectId = Number(match[2]);
    if (!Number.isFinite(nodeId) || !Number.isFinite(effectId) || nodeId <= 0 || effectId <= 0) {
      continue;
    }

    const node = tree?.nodes[nodeId];
    const directEffect = node?.masteryEffects?.find((eff) => eff.id === effectId);
    if (directEffect && directEffect.stats.length > 0) {
      result[nodeId] = directEffect.stats.join('\n');
      continue;
    }

    if (tree) {
      if (!globalEffectLookup) {
        globalEffectLookup = new Map<number, string[]>();
        for (const treeNode of Object.values(tree.nodes)) {
          if (!treeNode.masteryEffects) continue;
          for (const eff of treeNode.masteryEffects) {
            if (!globalEffectLookup.has(eff.id) && eff.stats.length > 0) {
              globalEffectLookup.set(eff.id, eff.stats);
            }
          }
        }
      }
      const fallbackStats = globalEffectLookup.get(effectId);
      if (fallbackStats && fallbackStats.length > 0) {
        result[nodeId] = fallbackStats.join('\n');
        continue;
      }
    }

    result[nodeId] = String(effectId);
  }

  return result;
}

/**
 * Serializes `TreeSpec.masteryEffects` back into PoB1's `{nodeId,effectId},...` attribute format.
 */
export function serializeMasteryEffectsAttr(
  masteryEffects: Record<number, string> | undefined,
  tree?: PassiveTreeData,
): string {
  if (!masteryEffects) return '';

  const entries = Object.entries(masteryEffects)
    .map(([nodeIdStr, value]) => ({ nodeId: Number(nodeIdStr), value: value?.trim() ?? '' }))
    .filter((entry) => Number.isFinite(entry.nodeId) && entry.nodeId > 0 && entry.value.length > 0)
    .sort((a, b) => a.nodeId - b.nodeId);

  if (entries.length === 0) return '';

  let globalStatsToId: Map<string, number> | null = null;
  const normalizeStats = (text: string): string =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

  const pairs: string[] = [];
  for (const { nodeId, value } of entries) {
    if (/^\d+$/.test(value)) {
      pairs.push(`{${nodeId},${value}}`);
      continue;
    }

    const normalizedTarget = normalizeStats(value);
    const node = tree?.nodes[nodeId];
    const directMatch = node?.masteryEffects?.find(
      (eff) => normalizeStats(eff.stats.join('\n')) === normalizedTarget,
    );
    if (directMatch) {
      pairs.push(`{${nodeId},${directMatch.id}}`);
      continue;
    }

    if (tree) {
      if (!globalStatsToId) {
        globalStatsToId = new Map<string, number>();
        for (const treeNode of Object.values(tree.nodes)) {
          if (!treeNode.masteryEffects) continue;
          for (const eff of treeNode.masteryEffects) {
            const key = normalizeStats(eff.stats.join('\n'));
            if (key && !globalStatsToId.has(key)) {
              globalStatsToId.set(key, eff.id);
            }
          }
        }
      }
      const globalMatch = globalStatsToId.get(normalizedTarget);
      if (globalMatch !== undefined) {
        pairs.push(`{${nodeId},${globalMatch}}`);
      }
    }
  }

  return pairs.join(',');
}

/**
 * Parses PoE 1 `<Overrides><Override nodeId="..." dn="...">stat lines</Override></Overrides>`
 * (Tattoos & Runegrafts) into `TreeSpec.nodeOverrides`.
 */
export function parseNodeOverrides(
  specInner: string,
): Record<number, { name?: string; stats: string[] }> {
  const overrides: Record<number, { name?: string; stats: string[] }> = {};
  const overrideRegex = /<Override\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Override>)/gi;
  let match: RegExpExecArray | null;
  while ((match = overrideRegex.exec(specInner)) !== null) {
    const attrs = parseAttributes(match[1]!);
    const nodeId = Number(attrs.nodeId);
    if (!Number.isFinite(nodeId) || nodeId <= 0) continue;
    const name = attrs.dn?.trim() || undefined;
    const rawBody = unescapeXml(match[2] ?? '');
    const stats = rawBody
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    overrides[nodeId] = {
      ...(name ? { name } : {}),
      stats,
    };
  }
  return overrides;
}

/**
 * Serializes `TreeSpec.nodeOverrides` into PoB `<Override ...>` XML lines (indented for `<Overrides>`).
 */
export function serializeNodeOverrides(
  nodeOverrides: Record<number, { name?: string; stats: string[] }> | undefined,
): string[] {
  if (!nodeOverrides) return [];
  const entries = Object.entries(nodeOverrides)
    .map(([nodeIdStr, data]) => ({ nodeId: Number(nodeIdStr), data }))
    .filter((entry) => Number.isFinite(entry.nodeId) && entry.nodeId > 0)
    .sort((a, b) => a.nodeId - b.nodeId);

  const lines: string[] = [];
  for (const { nodeId, data } of entries) {
    const dnAttr = data.name ? ` dn="${escapeXml(data.name)}"` : '';
    const stats = data.stats.map((s) => s.trim()).filter(Boolean);
    if (stats.length > 0) {
      lines.push(`        <Override nodeId="${nodeId}"${dnAttr}>`);
      for (const stat of stats) {
        lines.push(`          ${escapeXml(stat)}`);
      }
      lines.push(`        </Override>`);
    } else {
      lines.push(`        <Override nodeId="${nodeId}"${dnAttr} />`);
    }
  }
  return lines;
}

/**
 * Extracts `<ModRange id="N" range="X"/>` entries from raw PoB `<Item>` inner XML/text.
 */
export function extractModRanges(rawText: string): Map<number, number> {
  const ranges = new Map<number, number>();
  const regex = /<ModRange\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const attrs = parseAttributes(match[1]!);
    const id = Number(attrs.id);
    const range = Number(attrs.range);
    if (Number.isFinite(id) && id > 0 && Number.isFinite(range)) {
      ranges.set(id, range);
    }
  }
  return ranges;
}

export interface ItemVariantSelection {
  activeVariants: Set<number>;
  usesVariantGroups: boolean;
  selectedVersion?: number;
  variantGroupSelections: Map<number, number>;
}

/**
 * Extracts variant IDs from `{variant:1,2,3}` tag on a PoB mod line.
 */
export function parseModLineVariantTag(line: string): number[] | null {
  const match = line.match(/\{variant:([\d,\s]+)\}/i);
  if (!match) return null;
  const ids = match[1]!
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * Extracts range number(s) from `{range:0.5}` (or comma-separated `{range:0.5,1}`) tag on a PoB mod line.
 */
export function parseModLineRangeTag(line: string): number[] | null {
  const match = line.match(/\{range:([^}]+)\}/i);
  if (!match) return null;
  const values = match[1]!
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return values.length > 0 ? values : null;
}

/**
 * Evaluates whether a PoB item mod line should be kept given the item's active variant/version selection.
 * Mirrors upstream PoB `ItemClass:CheckModLineVariant`.
 */
export function shouldIncludeVariantLine(line: string, selection: ItemVariantSelection): boolean {
  const variantIds = parseModLineVariantTag(line);
  const versionMatch = line.match(/\{version:([\d,\s]+)\}/i);
  const groupMatch = line.match(/\{group:([\d,\s]+)\}/i);

  if (selection.usesVariantGroups) {
    if (versionMatch) {
      const versionIds = versionMatch[1]!
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (selection.selectedVersion === undefined || !versionIds.includes(selection.selectedVersion)) {
        return false;
      }
    }
    if (groupMatch) {
      if (!variantIds) return false;
      const groupIds = groupMatch[1]!
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      for (const gid of groupIds) {
        const selectedForGroup = selection.variantGroupSelections.get(gid);
        if (selectedForGroup !== undefined && variantIds.includes(selectedForGroup)) {
          return true;
        }
      }
      return false;
    }
    if (!variantIds) return true;
    return variantIds.some((id) => selection.activeVariants.has(id));
  }

  if (!variantIds) return true;
  return variantIds.some((id) => selection.activeVariants.has(id));
}

const ANTONYM_WORDS: Record<string, string> = {
  increased: 'reduced',
  reduced: 'increased',
  more: 'less',
  less: 'more',
};

function decimalPlaces(numStr: string): number {
  const dotIdx = numStr.indexOf('.');
  return dotIdx >= 0 ? numStr.length - dotIdx - 1 : 0;
}

function roundInterpolatedValue(rawValue: number, decimals: number): number {
  if (decimals <= 0) {
    // Match PoB `math.floor(min + (max - min) * r + 0.5)` (symmetric for negative numbers)
    return rawValue >= 0 ? Math.floor(rawValue + 0.5) : Math.ceil(rawValue - 0.5);
  }
  const scale = 10 ** decimals;
  return Math.round(rawValue * scale) / scale;
}

function formatInterpolatedNumber(value: number, decimals: number): string {
  if (Object.is(value, -0)) return '0';
  if (decimals <= 0) return String(value);
  return String(Number(value.toFixed(decimals)));
}

/**
 * Interpolates PoB `(min-max)` ranges on a mod line using `{range:X}` / `<ModRange>` (default `0.5`).
 * Also handles in-game Alt+Ctrl+C advanced copy `current(min-max)` by keeping `current`.
 * MUST be invoked BEFORE stripping `{...}` tags.
 */
export function interpolateModRanges(line: string, rangeValues?: number | number[]): string {
  // First strip in-game advanced copy parenthetical ranges attached to a rolled value, e.g. `32(25-35)` -> `32`
  let processed = line.replace(
    /(-?\d+(?:\.\d+)?)\((-?\d+(?:\.\d+)?(?:--?\d+(?:\.\d+)?)?)\)/g,
    '$1',
  );

  // Determine range array: explicit param > inline {range:...} > default 0.5
  let ranges: number[];
  if (typeof rangeValues === 'number' && Number.isFinite(rangeValues)) {
    ranges = [rangeValues];
  } else if (Array.isArray(rangeValues) && rangeValues.length > 0) {
    ranges = rangeValues;
  } else {
    ranges = parseModLineRangeTag(processed) ?? [0.5];
  }

  let rangeIdx = 0;
  processed = processed.replace(
    /([+-]?)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g,
    (_full, sign: string, minStr: string, maxStr: string) => {
      const r = ranges[rangeIdx] ?? ranges[0] ?? 0.5;
      rangeIdx++;
      const min = Number(minStr);
      const max = Number(maxStr);
      const decimals = Math.max(decimalPlaces(minStr), decimalPlaces(maxStr));
      let val = roundInterpolatedValue(min + (max - min) * r, decimals);
      if (sign === '-') {
        val = -val;
      }
      const formatted = formatInterpolatedNumber(val, decimals);
      if (sign === '+' && val > 0) {
        return `+${formatted}`;
      }
      return formatted;
    },
  );

  // Convert negative percentage + antonym word (`-10% increased` -> `10% reduced`) matching PoB ItemTools.lua
  processed = processed.replace(
    /-(\d+(?:\.\d+)?%)\s+(increased|reduced|more|less)\b/gi,
    (_full, pct: string, word: string) => {
      const antonym = ANTONYM_WORDS[word.toLowerCase()];
      return antonym ? `${pct} ${antonym}` : `-${pct} ${word}`;
    },
  );

  return processed;
}

/**
 * Canonical PoE 1 Utility Flask base names for resolving MAGIC flasks like
 * `"Alchemist's Granite Flask of the Armadillo"` -> `"Granite Flask"`.
 */
export const CANONICAL_UTILITY_FLASK_BASES: readonly string[] = [
  'Granite Flask',
  'Jade Flask',
  'Quicksilver Flask',
  'Silver Flask',
  'Diamond Flask',
  'Amethyst Flask',
  'Ruby Flask',
  'Sapphire Flask',
  'Topaz Flask',
  'Bismuth Flask',
  'Quartz Flask',
  'Sulphur Flask',
  'Basalt Flask',
  'Stibnite Flask',
  'Aquamarine Flask',
  'Corundum Flask',
  'Gold Flask',
  'Iron Flask',
] as const;

const UTILITY_FLASK_PATTERNS: Array<{ base: string; regex: RegExp }> =
  CANONICAL_UTILITY_FLASK_BASES.map((base) => ({
    base,
    regex: new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  }));

/**
 * Extracts the canonical Utility Flask base name from a MAGIC (or NORMAL) flask display name.
 * Returns `null` if the item name does not match a known utility flask base.
 */
export function resolveMagicUtilityFlaskBase(name: string): string | null {
  if (!name || !/flask/i.test(name)) return null;
  for (const entry of UTILITY_FLASK_PATTERNS) {
    if (entry.regex.test(name)) {
      return entry.base;
    }
  }
  return null;
}

/**
 * Extracts ONLY the active `<ConfigSet>` inner XML matching `<Config activeConfigSet="...">`.
 * Falls back to legacy direct `<Config>` children when no `<ConfigSet>` blocks are present.
 */
export function extractActiveConfigSetXml(xml: string): string {
  const configMatch = xml.match(/<Config\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Config>)/i);
  if (!configMatch) return '';

  const configAttrs = parseAttributes(configMatch[1]!);
  const configInner = configMatch[2] ?? '';
  if (!configInner.trim()) return '';

  const requestedId = configAttrs.activeConfigSet || '1';
  const sets: Array<{ id: string; inner: string }> = [];
  const configSetRegex = /<ConfigSet\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ConfigSet>)/gi;
  let match: RegExpExecArray | null;
  while ((match = configSetRegex.exec(configInner)) !== null) {
    const setAttrs = parseAttributes(match[1]!);
    const id = setAttrs.id || String(sets.length + 1);
    sets.push({ id, inner: match[2] ?? '' });
  }

  if (sets.length === 0) {
    // Legacy PoB XML without <ConfigSet> wrappers
    return configInner;
  }

  const exactMatch = sets.find((s) => s.id === requestedId);
  if (exactMatch) return exactMatch.inner;

  const numericIdx = Number(requestedId) - 1;
  if (Number.isFinite(numericIdx) && numericIdx >= 0 && numericIdx < sets.length) {
    return sets[numericIdx]!.inner;
  }

  return sets[0]!.inner;
}

/**
 * Extracts enabled `<CustomModifierBlock>` text lines from an active `<ConfigSet>` XML snippet.
 * Matches PoB `ConfigTab.lua` semantics: enabled unless `enabled="false"`.
 */
export function extractCustomModifierBlocks(configXml: string): string[] {
  const results: string[] = [];
  const blockRegex = /<CustomModifierBlock\b([^>]*?)(?:\/>|>([\s\S]*?)<\/CustomModifierBlock>)/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(configXml)) !== null) {
    const attrs = parseAttributes(match[1]!);
    if (attrs.enabled === 'false') continue;
    const text = unescapeXml(match[2] ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
    if (text) {
      results.push(text);
    }
  }
  return results;
}

/**
 * Parses `<Skill>` weapon-set flags supporting BOTH official PoB2 `set1="true" set2="false"`
 * attributes AND WebPoB `weaponSets="1,2"`.
 */
export function parseSkillWeaponSets(
  attrs: Record<string, string>,
  game: GameId,
): WeaponSetId[] | undefined {
  const hasSet1Attr = attrs.set1 !== undefined;
  const hasSet2Attr = attrs.set2 !== undefined;

  if (hasSet1Attr || hasSet2Attr) {
    const sets: WeaponSetId[] = [];
    if (attrs.set1 === 'true') sets.push(1);
    if (attrs.set2 === 'true') sets.push(2);
    return sets;
  }

  if (attrs.weaponSets) {
    const parsed = attrs.weaponSets
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v): v is WeaponSetId => v === 1 || v === 2);
    if (parsed.length > 0) {
      return [...new Set(parsed)];
    }
  }

  return game === 'poe2' ? [1, 2] : undefined;
}
