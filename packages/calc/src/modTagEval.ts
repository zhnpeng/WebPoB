import type { Mod, ModTag } from '@webpob/core';

/**
 * Evaluation context for Path of Building-style `ModTag`s (`Condition`, `Multiplier`, `PerStat`,
 * `SkillType`, `SocketedIn`).
 */
export interface ModEvalContext {
  conditions: Record<string, boolean>;
  multipliers: Record<string, number>;
  stats: Record<string, number>;
  skillTypes?: Record<string, boolean>;
  socketedIn?: string;
}

export interface ModTagEvalResult {
  active: boolean;
  scale: number;
  /** Additive offset accumulated from `Multiplier` tags with `base` (PoB: `value = value * mult + base`). */
  offset?: number;
}

export function createEmptyEvalContext(): ModEvalContext {
  return {
    conditions: {},
    multipliers: {},
    stats: {},
  };
}

/**
 * Evaluates all `ModTag` entries attached to a `Mod` against an optional `ModEvalContext`,
 * following Path of Building's `ModStore:EvalMod` semantics:
 * - `Condition` / `SkillType` / `SocketedIn`: gate activation (respecting `neg`).
 * - `Multiplier`: scales by `Math.floor(val + 0.0001)`, clamped by optional `limit`,
 *   and accumulates optional additive `base`.
 * - `PerStat`: scales by `Math.floor(statVal / div + 0.0001)`, clamped by optional `limit`.
 */
function evalSingleConditionVar(varExpr: string, ctx?: ModEvalContext): boolean {
  if (!ctx) return false;
  if (ctx.conditions[varExpr]) return true;
  if (varExpr.startsWith('MultiplierThreshold:')) {
    const parts = varExpr.split(':');
    const name = parts[1] ?? '';
    const thresh = Number(parts[2] ?? 0);
    return (ctx.multipliers[name] ?? 0) >= thresh;
  }
  if (varExpr.startsWith('StatThreshold:')) {
    const parts = varExpr.split(':');
    const name = parts[1] ?? '';
    const thresh = Number(parts[2] ?? 0);
    return (ctx.stats[name] ?? 0) >= thresh;
  }
  return false;
}

function evalConditionVar(varExpr: string, ctx?: ModEvalContext): boolean {
  if (varExpr.includes('|')) {
    return varExpr.split('|').some((part) => evalSingleConditionVar(part.trim(), ctx));
  }
  return evalSingleConditionVar(varExpr, ctx);
}

export function evaluateModTags(mod: Mod, ctx?: ModEvalContext): ModTagEvalResult {
  const tags = mod.tags;
  if (!tags || tags.length === 0) {
    return { active: true, scale: 1 };
  }

  let scale = 1;
  let offset = 0;

  for (const tag of tags) {
    switch (tag.type) {
      case 'Condition': {
        let match = evalConditionVar(tag.var, ctx);
        if (tag.neg) match = !match;
        if (!match) {
          return { active: false, scale: 0 };
        }
        break;
      }
      case 'SkillType': {
        const norm = tag.skillType.trim().toLowerCase().replace(/[\s_-]+/g, '');
        let match = Boolean(
          ctx?.skillTypes?.[tag.skillType] || (norm ? ctx?.skillTypes?.[norm] : false),
        );
        if (tag.neg) match = !match;
        if (!match) {
          return { active: false, scale: 0 };
        }
        break;
      }
      case 'SocketedIn': {
        let match = tag.slotName
          ? ctx?.socketedIn === tag.slotName
          : Boolean(ctx?.socketedIn);
        if (tag.neg) match = !match;
        if (!match) {
          return { active: false, scale: 0 };
        }
        break;
      }
      case 'Multiplier': {
        const raw = ctx?.multipliers[tag.var] ?? 0;
        let mult = Math.floor(raw + 0.0001);
        if (tag.limit !== undefined) {
          mult = Math.min(mult, tag.limit);
        }
        scale *= mult;
        if (offset !== 0 || tag.base !== undefined) {
          offset = offset * mult + (tag.base ?? 0);
        }
        break;
      }
      case 'PerStat': {
        const statVal = ctx?.stats[tag.stat] ?? 0;
        const div = tag.div > 0 ? tag.div : 1;
        let mult = Math.floor(statVal / div + 0.0001);
        if (tag.limit !== undefined) {
          mult = Math.min(mult, tag.limit);
        }
        scale *= mult;
        if (offset !== 0) {
          offset *= mult;
        }
        break;
      }
    }
  }

  return offset !== 0 ? { active: true, scale, offset } : { active: true, scale };
}

/**
 * Applies a `ModTagEvalResult` to a numeric modifier value.
 */
export function applyModTagEval(value: number, evalResult: ModTagEvalResult): number {
  return value * evalResult.scale + (evalResult.offset ?? 0);
}

interface SuffixRule {
  regex: RegExp;
  toTag: (match: RegExpMatchArray) => ModTag;
}

function mapEquipStat(slotPrefix: 'BodyArmour' | 'Helmet' | 'Shield', rawStat: string): string {
  const lower = rawStat.toLowerCase();
  if (lower.startsWith('energy shield')) return `${slotPrefix}ES`;
  if (lower.startsWith('evasion')) return `${slotPrefix}Evasion`;
  return `${slotPrefix}Armour`;
}

/**
 * Ordered suffix rules: more specific rules (e.g., negated conditions, equipment-slot PerStat)
 * MUST precede broader rules so they match cleanly without partial stripping.
 */
const SUFFIX_RULES: readonly SuffixRule[] = [
  // --- PerStat: Equipped item defences (most specific first) ---
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Item\s+)?(Energy Shield|Evasion Rating|Evasion|Armour)\s+on\s+Equipped\s+Body\s+Armour\s*$/i,
    toTag: (m) => ({
      type: 'PerStat',
      stat: mapEquipStat('BodyArmour', m[2]!),
      div: Number(m[1]),
    }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Item\s+)?(Energy Shield|Evasion Rating|Evasion|Armour)\s+on\s+Equipped\s+Helmet\s*$/i,
    toTag: (m) => ({
      type: 'PerStat',
      stat: mapEquipStat('Helmet', m[2]!),
      div: Number(m[1]),
    }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Item\s+)?(Energy Shield|Evasion Rating|Evasion|Armour)\s+on\s+Equipped\s+Shield\s*$/i,
    toTag: (m) => ({
      type: 'PerStat',
      stat: mapEquipStat('Shield', m[2]!),
      div: Number(m[1]),
    }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)%?\s+Chance\s+to\s+Block\s+on\s+Equipped\s+Shield\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'ShieldBlock', div: Number(m[1]) }),
  },

  // --- PerStat: Attributes & character stats ---
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+Strength\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Str', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+Dexterity\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Dex', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+Intelligence\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Int', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+of\s+your\s+lowest\s+Attribute\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'LowestAttr', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+Accuracy\s+Rating\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Accuracy', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Maximum\s+)?Life\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Life', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Maximum\s+)?Mana\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'Mana', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Maximum\s+)?Energy\s+Shield\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'EnergyShield', div: Number(m[1]) }),
  },

  // --- Multipliers ---
  {
    regex: /\s*(?:,\s*)?per\s+Power\s+Charge\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'PowerCharge' }),
  },
  {
    regex: /\s*(?:,\s*)?per\s+Frenzy\s+Charge\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'FrenzyCharge' }),
  },
  {
    regex: /\s*(?:,\s*)?per\s+Endurance\s+Charge\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'EnduranceCharge' }),
  },
  {
    regex: /\s*(?:,\s*)?per\s+Rage\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'Rage' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+Corrupted\s+Item\s+Equipped\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'CorruptedItem' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+Socket\s+filled\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'SocketFilled' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+Allocated\s+Mastery\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'AllocatedMastery' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+(?:Active|Summoned)\s+Golem\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'ActiveGolem' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+Blue\s+Support\s+Gem\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'BlueSupportGem' }),
  },

  // --- Conditions (negated first, then positive) ---
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+not\s+on\s+Low\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'LowLife', neg: true }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+not\s+on\s+Full\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'FullLife', neg: true }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+not\s+Dual\s+Wielding\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'DualWielding', neg: true }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+on\s+Low\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'LowLife' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+on\s+Full\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'FullLife' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Dual\s+Wielding\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'DualWielding' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+holding\s+a\s+Shield\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingShield' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Staff\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingStaff' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Two[\s-]Handed\s+(?:Melee\s+)?Weapon\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingTwoHandedWeapon' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Bow\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingBow' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Claw\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingClaw' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Wand\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingWand' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+wielding\s+a\s+Quarterstaff\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'UsingQuarterstaff' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+affected\s+by\s+a\s+Herald\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByHerald' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Channelling\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Channelling' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Leeching\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Leeching' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+on\s+Consecrated\s+Ground\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'OnConsecratedGround' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Dazed\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyDazed' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Shocked\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyShocked' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Chilled\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyChilled' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Ignited\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyIgnited' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Bleeding\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyBleeding' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Taunted\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyTaunted' }),
  },
];

const PREFIX_RULES: readonly SuffixRule[] = [
  {
    regex: /^(?:while|when)\s+not\s+on\s+Low\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'LowLife', neg: true }),
  },
  {
    regex: /^(?:while|when)\s+not\s+on\s+Full\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'FullLife', neg: true }),
  },
  {
    regex: /^(?:while|when)\s+on\s+Low\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'LowLife' }),
  },
  {
    regex: /^(?:while|when)\s+on\s+Full\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'FullLife' }),
  },
  {
    regex: /^while\s+Dual\s+Wielding,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'DualWielding' }),
  },
  {
    regex: /^while\s+holding\s+a\s+Shield,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'UsingShield' }),
  },
  {
    regex: /^while\s+wielding\s+a\s+Staff,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'UsingStaff' }),
  },
  {
    regex: /^while\s+affected\s+by\s+a\s+Herald,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByHerald' }),
  },
  {
    regex: /^while\s+Channelling,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Channelling' }),
  },
  {
    regex: /^while\s+Leeching,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Leeching' }),
  },
  {
    regex: /^while\s+on\s+Consecrated\s+Ground,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'OnConsecratedGround' }),
  },
];

/**
 * Extracts PoB-style conditional, multiplier, and per-stat clauses from a modifier stat line,
 * returning the stripped `baseLine` and the list of extracted `ModTag`s.
 * Supports both trailing suffixes, leading comma-delimited prefixes, and stacked clauses.
 */
export function parseConditionalSuffix(rawLine: string): { baseLine: string; tags: ModTag[] } {
  let baseLine = rawLine.trim();
  const tags: ModTag[] = [];

  // Strip leading conditional prefixes first (e.g. "While on Low Life, 30% more Spell Damage")
  let matchedPrefix = true;
  while (matchedPrefix) {
    matchedPrefix = false;
    for (const rule of PREFIX_RULES) {
      const m = baseLine.match(rule.regex);
      if (m) {
        tags.push(rule.toTag(m));
        baseLine = baseLine.slice(m[0].length).trim();
        matchedPrefix = true;
        break;
      }
    }
  }

  // Strip trailing suffixes iteratively (e.g. "4% increased Spell Damage per Power Charge while on Low Life")
  const suffixTags: ModTag[] = [];
  let matchedSuffix = true;
  while (matchedSuffix) {
    matchedSuffix = false;
    for (const rule of SUFFIX_RULES) {
      const m = baseLine.match(rule.regex);
      if (m) {
        suffixTags.unshift(rule.toTag(m));
        baseLine = baseLine.slice(0, baseLine.length - m[0].length).trim();
        matchedSuffix = true;
        break;
      }
    }
  }

  tags.push(...suffixTags);
  return { baseLine, tags };
}
