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
 * Resolves the effective enemy/projectile distance in PoB units (1m = 10 units).
 * Defaults to `20` (2.0m — official PoB 2 default combat distance).
 */
export function resolveSkillDistance(ctx?: ModEvalContext): number {
  const candidates = [
    ctx?.stats.SkillDistance,
    ctx?.stats.EnemyDistance,
    ctx?.stats.ProjectileDistance,
    ctx?.multipliers.SkillDistance,
    ctx?.multipliers.EnemyDistance,
    ctx?.multipliers.ProjectileDistance,
  ];
  for (const val of candidates) {
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      return val;
    }
  }
  return 20;
}

/**
 * Evaluates a Path of Building `DistanceRamp` piecewise-linear ramp (`Classes/ModStore.lua:722-738`)
 * at `skillDist` (in PoB units where 1m = 10 units).
 */
export function evaluateDistanceRamp(
  ramp: ReadonlyArray<readonly [number, number]>,
  skillDist: number,
): number {
  if (ramp.length === 0) return 0;
  if (skillDist <= ramp[0]![0]) {
    return ramp[0]![1];
  }
  const last = ramp[ramp.length - 1]!;
  if (skillDist >= last[0]) {
    return last[1];
  }
  for (let i = 0; i < ramp.length - 1; i++) {
    const cur = ramp[i]!;
    const next = ramp[i + 1]!;
    if (skillDist <= next[0]) {
      const span = next[0] - cur[0];
      if (span <= 0) return next[1];
      return cur[1] + ((next[1] - cur[1]) * (skillDist - cur[0])) / span;
    }
  }
  return last[1];
}

function parseEncodedDistanceRamp(spec: string): Array<[number, number]> | null {
  const points: Array<[number, number]> = [];
  for (const seg of spec.split(',')) {
    const parts = seg.trim().split(':');
    if (parts.length !== 2) return null;
    const d = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(d) || !Number.isFinite(m)) return null;
    points.push([d, m]);
  }
  return points.length >= 2 ? points : null;
}

/**
 * Infers the official PoB 2 `DistanceRamp` points for bare `{ type: 'Condition', var: 'DistanceRamp' }`
 * tags exported in `poe2-gems.json` (`Close Combat I/II`, `Longshot I/II`, `Point Blank`, `Far Shot`).
 */
function inferDistanceRampFromSource(source: string): ReadonlyArray<readonly [number, number]> {
  if (/longshot|far\s*combat/i.test(source)) {
    // PoB 2 sup_dex.lua:2926 SupportFarCombatPlayer / SupportFarCombatPlayerTwo
    return [
      [35, 0],
      [70, 1],
    ];
  }
  if (/far\s*shot/i.test(source)) {
    // PoB CalcOffence.lua:1446 Far Shot
    return [
      [10, -0.2],
      [25, 0],
      [70, 0.6],
    ];
  }
  if (/point\s*blank/i.test(source)) {
    // PoE 2 Point Blank (Tree:41875): full bonus up to 3.5m (35), linearly drops to 0 at 7m (70)
    return [
      [35, 1],
      [70, 0],
    ];
  }
  // Default: PoB 2 sup_dex.lua:1245 SupportCloseCombatPlayer / SupportCloseCombatPlayerTwo
  // At default 2m (20 units): (35 - 20) / (35 - 10) = 0.60 -> 12% MORE (CC I) / 18% MORE (CC II)
  return [
    [10, 1],
    [35, 0],
  ];
}

/**
 * Evaluates all `ModTag` entries attached to a `Mod` against an optional `ModEvalContext`,
 * following Path of Building's `ModStore:EvalMod` semantics:
 * - `Condition` / `SkillType` / `SocketedIn`: gate activation (respecting `neg`).
 * - `DistanceRamp`: linearly scales value by distance (`Classes/ModStore.lua:722-738`).
 * - `Multiplier`: scales by `Math.floor(val + 0.0001)`, clamped by optional `limit`,
 *   and accumulates optional additive `base`.
 * - `PerStat`: scales by `Math.floor(statVal / div + 0.0001)`, clamped by optional `limit`.
 */
function evalSingleConditionVar(varExpr: string, ctx?: ModEvalContext): boolean {
  if (varExpr.startsWith('EnemyDistanceGt:')) {
    const thresh = Number(varExpr.slice('EnemyDistanceGt:'.length));
    if (ctx?.conditions[varExpr]) return true;
    const metres = thresh / 10;
    if (Number.isInteger(metres) && ctx?.conditions[`NoEnemiesWithin${metres}m`]) return true;
    return Number.isFinite(thresh) && resolveSkillDistance(ctx) > thresh;
  }
  if (varExpr.startsWith('EnemyDistanceGe:')) {
    const thresh = Number(varExpr.slice('EnemyDistanceGe:'.length));
    if (ctx?.conditions[varExpr]) return true;
    return Number.isFinite(thresh) && resolveSkillDistance(ctx) >= thresh;
  }
  if (varExpr.startsWith('EnemyDistanceLe:')) {
    const thresh = Number(varExpr.slice('EnemyDistanceLe:'.length));
    if (ctx?.conditions[varExpr]) return true;
    return Number.isFinite(thresh) && resolveSkillDistance(ctx) <= thresh;
  }
  if (varExpr.startsWith('EnemyDistanceLt:')) {
    const thresh = Number(varExpr.slice('EnemyDistanceLt:'.length));
    if (ctx?.conditions[varExpr]) return true;
    return Number.isFinite(thresh) && resolveSkillDistance(ctx) < thresh;
  }
  if (!ctx) return false;
  if (ctx.conditions[varExpr]) return true;
  if (varExpr.startsWith('MultiplierThreshold:')) {
    const parts = varExpr.split(':');
    const name = parts[1] ?? '';
    const thresh = Number(parts[2] ?? 0);
    const val = ctx.multipliers[name] ?? ctx.stats[name] ?? 0;
    return val >= thresh;
  }
  if (varExpr.startsWith('StatThreshold:')) {
    const parts = varExpr.split(':');
    const name = parts[1] ?? '';
    const thresh = Number(parts[2] ?? 0);
    const val = ctx.stats[name] ?? ctx.multipliers[name] ?? 0;
    return val >= thresh;
  }
  if (varExpr.startsWith('AffectedByHeraldOf')) {
    const alt = `AffectedByHeraldof${varExpr.slice('AffectedByHeraldOf'.length)}`;
    if (ctx.conditions[alt]) return true;
  } else if (varExpr.startsWith('AffectedByHeraldof')) {
    const alt = `AffectedByHeraldOf${varExpr.slice('AffectedByHeraldof'.length)}`;
    if (ctx.conditions[alt]) return true;
  }
  if (varExpr === 'EnemyExposure') {
    return Boolean(
      ctx.conditions.EnemyFireExposure ||
        ctx.conditions.EnemyColdExposure ||
        ctx.conditions.EnemyLightningExposure ||
        ctx.conditions.FireExposure ||
        ctx.conditions.ColdExposure ||
        ctx.conditions.LightningExposure,
    );
  }
  if (varExpr === 'EnemyFireExposure') return Boolean(ctx.conditions.FireExposure);
  if (varExpr === 'EnemyColdExposure') return Boolean(ctx.conditions.ColdExposure);
  if (varExpr === 'EnemyLightningExposure') return Boolean(ctx.conditions.LightningExposure);
  if (varExpr === 'EnemyAffectedByElementalAilment') {
    return Boolean(
      ctx.conditions.EnemyShocked ||
        ctx.conditions.EnemyChilled ||
        ctx.conditions.EnemyFrozen ||
        ctx.conditions.EnemyIgnited ||
        ctx.conditions.EnemyScorched ||
        ctx.conditions.EnemyBrittle ||
        ctx.conditions.EnemySapped ||
        (ctx.multipliers.EnemyElementalAilmentCount ?? 0) > 0,
    );
  }
  if (varExpr === 'EnemyAffectedByAilment') {
    return Boolean(
      ctx.conditions.EnemyAffectedByElementalAilment ||
        ctx.conditions.EnemyShocked ||
        ctx.conditions.EnemyChilled ||
        ctx.conditions.EnemyFrozen ||
        ctx.conditions.EnemyIgnited ||
        ctx.conditions.EnemyScorched ||
        ctx.conditions.EnemyBrittle ||
        ctx.conditions.EnemySapped ||
        ctx.conditions.EnemyBleeding ||
        ctx.conditions.EnemyPoisoned ||
        (ctx.multipliers.EnemyElementalAilmentCount ?? 0) > 0 ||
        (ctx.multipliers.EnemyAilmentCount ?? 0) > 0,
    );
  }
  if (varExpr === 'EnemyChilled') {
    return Boolean(ctx.conditions.EnemyFrozen || ctx.conditions.Frozen);
  }
  if (varExpr === 'Chilled') {
    return Boolean(ctx.conditions.Frozen);
  }
  if (varExpr === 'Unarmed') {
    return Boolean(ctx.conditions.IsUnarmed);
  }
  if (varExpr === 'Shapeshifted') {
    return Boolean(
      ctx.conditions.ShapeshiftedToAnimalRecently || ctx.conditions.ShapeshiftToAnimal,
    );
  }
  if (varExpr === 'TwisterLightning') {
    return Boolean(ctx.conditions.twisterLightning);
  }
  if (varExpr === 'TwisterCold') {
    return Boolean(ctx.conditions.twisterCold);
  }
  if (varExpr === 'TwisterFire') {
    return Boolean(ctx.conditions.twisterFire);
  }
  if (varExpr === 'AtMostOneNearbyRareOrUniqueEnemy') {
    const nearbyRareUnique = ctx.multipliers.NearbyRareOrUniqueEnemies;
    return nearbyRareUnique !== undefined && nearbyRareUnique <= 1;
  }
  if (varExpr === 'ConsumedElementalInfusionRecently') {
    return Boolean(ctx.conditions.InfusionConsumedRecently);
  }
  if (varExpr === 'InfusionConsumedRecently') {
    return Boolean(ctx.conditions.ConsumedElementalInfusionRecently);
  }
  if (varExpr === 'HaveTotem') {
    return (
      (ctx.multipliers.SummonedTotem ??
        ctx.multipliers.ActiveTotem ??
        ctx.multipliers.TotemsSummoned ??
        0) > 0
    );
  }
  if (varExpr === 'EnemySlowed') {
    // PoB 2 CalcPerform.lua:847-854: enemy is Slowed if any negative ActionSpeed/MovementSpeed debuff applies
    return Boolean(
      ctx.conditions.Slowed ||
        ctx.conditions.EnemyChilled ||
        ctx.conditions.EnemyFrozen ||
        ctx.conditions.EnemyMaimed ||
        ctx.conditions.EnemyHindered ||
        ctx.conditions.EnemyTemporalChains ||
        (ctx.multipliers.EnemyChillEffect ?? 0) > 0,
    );
  }
  if (varExpr === 'EnemyCursed') {
    return Boolean(
      ctx.conditions.Cursed ||
        (ctx.multipliers.CurseOnEnemy ?? 0) > 0 ||
        (ctx.multipliers.CursesOnEnemy ?? 0) > 0,
    );
  }
  if (varExpr === 'EnemyMarked') {
    return Boolean(ctx.conditions.Marked);
  }
  if (varExpr === 'Marked') {
    return Boolean(ctx.conditions.EnemyMarked);
  }
  if (varExpr === 'EnemyPoisoned') {
    return Boolean(
      ctx.conditions.Poisoned ||
        (ctx.multipliers.PoisonStacks ?? ctx.multipliers.PoisonOnEnemy ?? 0) > 0,
    );
  }
  if (varExpr === 'EnemyArmourBroken') {
    return Boolean(
      ctx.conditions.ArmourBroken ||
        ctx.conditions.ArmourFullyBroken ||
        ctx.conditions.EnemyArmourFullyBroken,
    );
  }
  if (varExpr === 'EnemyElectrocuted') {
    return Boolean(ctx.conditions.Electrocuted);
  }
  if (varExpr === 'Electrocuted') {
    return Boolean(ctx.conditions.EnemyElectrocuted);
  }
  if (varExpr === 'EnemyHasOpenWeakness') {
    return Boolean(ctx.conditions.EnemyOpenWeakness);
  }
  if (varExpr === 'EnemyOpenWeakness') {
    return Boolean(ctx.conditions.EnemyHasOpenWeakness);
  }
  if (varExpr === 'ShapeshiftedToHumanRecently') {
    return Boolean(ctx.conditions.ShapeshiftToHuman);
  }
  if (varExpr === 'ShapeshiftToHuman') {
    return Boolean(ctx.conditions.ShapeshiftedToHumanRecently);
  }
  return false;
}

function resolveMultiplierValue(varName: string, ctx?: ModEvalContext): number {
  if (!ctx) return 0;
  const direct = ctx.multipliers[varName];
  if (direct !== undefined) return direct;
  if (varName === 'ActiveTotem' || varName === 'SummonedTotem' || varName === 'TotemsSummoned') {
    return ctx.multipliers.ActiveTotem ?? ctx.multipliers.SummonedTotem ?? ctx.multipliers.TotemsSummoned ?? 0;
  }
  if (varName === 'NonInstantSpellCastRecently' || varName === 'DifferentSpellsCastRecently') {
    return ctx.multipliers.NonInstantSpellCastRecently ?? ctx.multipliers.DifferentSpellsCastRecently ?? 0;
  }
  if (varName === 'PoisonStacks' || varName === 'PoisonStack' || varName === 'PoisonOnEnemy') {
    return ctx.multipliers.PoisonStacks ?? ctx.multipliers.PoisonOnEnemy ?? ctx.multipliers.PoisonStack ?? 0;
  }
  if (varName === 'EnemyElementalAilmentCount' || varName === 'ElementalHitAilmentOnEnemy') {
    const alt =
      varName === 'EnemyElementalAilmentCount'
        ? ctx.multipliers.ElementalHitAilmentOnEnemy
        : ctx.multipliers.EnemyElementalAilmentCount;
    if (alt !== undefined) return alt;
    return (
      (ctx.conditions.EnemyIgnited ? 1 : 0) +
      (ctx.conditions.EnemyChilled ? 1 : 0) +
      (ctx.conditions.EnemyFrozen ? 1 : 0) +
      (ctx.conditions.EnemyShocked ? 1 : 0) +
      (ctx.conditions.EnemyScorched ? 1 : 0) +
      (ctx.conditions.EnemyBrittle ? 1 : 0) +
      (ctx.conditions.EnemySapped ? 1 : 0)
    );
  }
  return 0;
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
    // Support runtime PoB-style `{ type: 'DistanceRamp', ramp: [[d, m], ...] }` tags even if
    // not yet present in the narrow `@webpob/core` ModTag union.
    const runtimeTag = tag as unknown as {
      type: string;
      ramp?: ReadonlyArray<readonly [number, number]>;
    };
    if (runtimeTag.type === 'DistanceRamp') {
      const ramp =
        Array.isArray(runtimeTag.ramp) && runtimeTag.ramp.length >= 2
          ? runtimeTag.ramp
          : inferDistanceRampFromSource(mod.source);
      const factor = evaluateDistanceRamp(ramp, resolveSkillDistance(ctx));
      if (factor === 0) {
        return { active: false, scale: 0 };
      }
      scale *= factor;
      if (offset !== 0) offset *= factor;
      continue;
    }

    switch (tag.type) {
      case 'Condition': {
        if (tag.var === 'DistanceRamp' || tag.var.startsWith('DistanceRamp:')) {
          const encoded = tag.var.startsWith('DistanceRamp:')
            ? parseEncodedDistanceRamp(tag.var.slice('DistanceRamp:'.length))
            : null;
          const ramp = encoded ?? inferDistanceRampFromSource(mod.source);
          const factor = evaluateDistanceRamp(ramp, resolveSkillDistance(ctx));
          if (factor === 0) {
            return { active: false, scale: 0 };
          }
          scale *= factor;
          if (offset !== 0) offset *= factor;
          break;
        }
        if (tag.var.startsWith('PercentStat:')) {
          const parts = tag.var.split(':');
          const statName = parts[1] ?? '';
          const pctRaw = parts[2] ?? '100';
          const statVal = ctx?.stats[statName] ?? ctx?.multipliers[statName] ?? 0;
          const pctAsNum = Number(pctRaw);
          const pctVal = Number.isFinite(pctAsNum)
            ? pctAsNum
            : (ctx?.multipliers[pctRaw] ?? ctx?.stats[pctRaw] ?? 0);
          // PoB PercentStat encodes percentage points in `mod.value` (e.g. Arcane Cloak
          // `v=10` for 10% of consumed mana, `v=100` for 100% guard limit, with
          // `ArcaneCloakConsumedMana = 0.64`), so `factor = (statVal * pctVal) / 100`.
          const factor = (statVal * pctVal) / 100;
          if (factor <= 0) {
            return { active: false, scale: 0 };
          }
          scale *= factor;
          break;
        }
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
        const raw = resolveMultiplierValue(tag.var, ctx);
        let mult = Math.floor(raw + 0.0001);
        const runtimeLimit = tag as {
          limit?: number;
          limitTotal?: boolean;
          limitNegTotal?: boolean;
        };
        // Bridge legacy PoE 2 cmods whose `limitTotal = true` was not yet exported in poe2-gems.json
        const useLimitTotal =
          runtimeLimit.limitTotal === true ||
          (runtimeLimit.limitTotal === undefined &&
            tag.limit !== undefined &&
            (tag.var === 'IncisionConsumedRecently' || tag.var === 'SuperchargedSlamStage'));
        if (tag.limit !== undefined && !useLimitTotal && !runtimeLimit.limitNegTotal) {
          mult = Math.min(mult, tag.limit);
        }
        scale *= mult;
        if (offset !== 0 || tag.base !== undefined) {
          offset = offset * mult + (tag.base ?? 0);
        }
        if (tag.limit !== undefined && typeof mod.value === 'number' && mod.value !== 0) {
          const curTotal = mod.value * scale + offset;
          if (useLimitTotal && curTotal > tag.limit) {
            scale = tag.limit / mod.value;
            offset = 0;
          } else if (runtimeLimit.limitNegTotal && curTotal < tag.limit) {
            scale = tag.limit / mod.value;
            offset = 0;
          }
        }
        break;
      }
      case 'PerStat': {
        const statVal =
          tag.stat === 'ShieldArmourAndEvasion'
            ? (ctx?.stats.ShieldArmourAndEvasion ??
                (ctx?.stats.ShieldArmour ?? 0) + (ctx?.stats.ShieldEvasion ?? 0))
            : (ctx?.stats[tag.stat] ?? ctx?.multipliers[tag.stat] ?? 0);
        const div = tag.div > 0 ? tag.div : 1;
        let mult = Math.floor(statVal / div + 0.0001);
        const runtimeLimit = tag as {
          limit?: number;
          limitTotal?: boolean;
          limitNegTotal?: boolean;
        };
        // Bridge legacy PoE 2 cmods (`Atalui's Bloodletting`, `Refraction III`) whose `limitTotal = true`
        // was not yet serialized into poe2-gems.json (PoB 2 ModStore.lua:629-653)
        const useLimitTotal =
          runtimeLimit.limitTotal === true ||
          (runtimeLimit.limitTotal === undefined &&
            tag.limit !== undefined &&
            ((tag.stat === 'LifeCost' && mod.name === 'DamageGainAsPhysical') ||
              (tag.stat === 'Armour' && /Exposure$/.test(mod.name))));
        if (tag.limit !== undefined && !useLimitTotal && !runtimeLimit.limitNegTotal) {
          mult = Math.min(mult, tag.limit);
        }
        scale *= mult;
        if (offset !== 0) {
          offset *= mult;
        }
        if (tag.limit !== undefined && typeof mod.value === 'number' && mod.value !== 0) {
          const curTotal = mod.value * scale + offset;
          if (useLimitTotal && curTotal > tag.limit) {
            scale = tag.limit / mod.value;
            offset = 0;
          } else if (runtimeLimit.limitNegTotal && curTotal < tag.limit) {
            scale = tag.limit / mod.value;
            offset = 0;
          }
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
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+(?:Item\s+)?Armour\s+(?:and|or)\s+Evasion(?:\s+Rating)?\s+on\s+(?:Equipped\s+)?Shield\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'ShieldArmourAndEvasion', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)%?\s+Chance\s+to\s+Block\s+on\s+Equipped\s+Shield\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'ShieldBlock', div: Number(m[1]) }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)%?\s+Chance\s+to\s+Block\s*$/i,
    toTag: (m) => ({ type: 'PerStat', stat: 'BlockChance', div: Number(m[1]) }),
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
    regex: /\s*(?:,\s*)?(?:for every|per)\s+(\d+)\s+Accuracy\s+Rating,\s*up\s+to\s+(\d+)%?\s*$/i,
    toTag: (m) =>
      ({
        type: 'PerStat',
        stat: 'Accuracy',
        div: Number(m[1]),
        limit: Number(m[2]),
        limitTotal: true,
      }) as unknown as ModTag,
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
  {
    regex: /\s*(?:,\s*)?for\s+each\s+type\s+of\s+Elemental\s+Ailment\s+on\s+(?:the\s+)?Enemy\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'EnemyElementalAilmentCount' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:for each|per)\s+Summoned\s+Totem(?:\s+in\s+your\s+Presence)?\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'ActiveTotem' }),
  },
  {
    regex: /\s*(?:,\s*)?for\s+each\s+Hazard\s+triggered\s+Recently,\s*up\s+to\s+(\d+)%?\s*$/i,
    toTag: (m) =>
      ({
        type: 'Multiplier',
        var: 'HazardTriggeredRecently',
        limit: Number(m[1]),
        limitTotal: true,
      }) as unknown as ModTag,
  },
  {
    regex: /\s*(?:,\s*)?for\s+each\s+type\s+of\s+Ammunition\s+fired\s+in\s+the\s+past\s+\d+\s+seconds\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'DifferentAmmoFired' }),
  },
  {
    regex: /\s*(?:,\s*)?for\s+every\s+different\s+Grenade\s+fired\s+in\s+the\s+past\s+\d+\s+seconds\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'DifferentGrenadeFired' }),
  },
  {
    regex: /\s*(?:,\s*)?for\s+each\s+different\s+Spell\s+you(?:'ve|\s+have)\s+Cast\s+in\s+the\s+last\s+(?:\d+|eight)\s+seconds\s*$/i,
    toTag: () => ({ type: 'Multiplier', var: 'NonInstantSpellCastRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?per\s+Enemy\s+you(?:'ve|\s+have)\s+Ignited\s+in\s+the\s+last\s+\d+\s+seconds,\s*up\s+to\s+(\d+)%?\s*$/i,
    toTag: (m) =>
      ({
        type: 'Multiplier',
        var: 'EnemyIgnitedRecently',
        limit: Number(m[1]),
        limitTotal: true,
      }) as unknown as ModTag,
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
    regex: /\s*(?:,\s*)?(?:while|when)\s+not\s+on\s+Low\s+Mana\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'LowMana', neg: true }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+not\s+on\s+Full\s+Mana\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'FullMana', neg: true }),
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
    regex: /\s*(?:,\s*)?(?:while|when)\s+on\s+Low\s+Mana\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'LowMana' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:while|when)\s+on\s+Full\s+Mana\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'FullMana' }),
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
    regex: /\s*(?:,\s*)?while\s+affected\s+by\s+Herald\s+of\s+(Thunder|Ice|Ash|Plague|Blood|Purity|Agony)\s*$/i,
    toTag: (m) => {
      const cap = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      return { type: 'Condition', var: `AffectedByHeraldOf${cap}` };
    },
  },
  {
    regex: /\s*(?:,\s*)?while\s+affected\s+by\s+a\s+Herald\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByHerald' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Shapeshifted\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Shapeshifted' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+there\s+are\s+no\s+Enemies\s+within\s+(\d+(?:\.\d+)?)m(?:etres?)?\s*$/i,
    toTag: (m) => ({ type: 'Condition', var: `EnemyDistanceGt:${Math.round(Number(m[1]) * 10)}` }),
  },
  {
    regex: /\s*(?:,\s*)?(?:against\s+Enemies\s+)?further\s+than\s+(\d+(?:\.\d+)?)m(?:etres?)?(?:\s+away)?\s*$/i,
    toTag: (m) => ({ type: 'Condition', var: `EnemyDistanceGt:${Math.round(Number(m[1]) * 10)}` }),
  },
  {
    regex: /\s*(?:,\s*)?(?:against\s+Enemies\s+)?within\s+(\d+(?:\.\d+)?)m(?:etres?)?(?:\s+distance\s+of\s+you)?\s*$/i,
    toTag: (m) => ({ type: 'Condition', var: `EnemyDistanceLe:${Math.round(Number(m[1]) * 10)}` }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+consumed\s+a\s+(Power|Frenzy|Endurance)\s+Charge\s+Recently\s*$/i,
    toTag: (m) => {
      const cap = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      return { type: 'Condition', var: `Consumed${cap}ChargeRecently` };
    },
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+gained\s+a\s+(Power|Frenzy|Endurance)\s+Charge\s+Recently\s*$/i,
    toTag: (m) => {
      const cap = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      return { type: 'Condition', var: `Gained${cap}ChargeRecently` };
    },
  },
  {
    regex: /\s*(?:,\s*)?against\s+Heavy\s+Stunned\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyHeavyStunned' }),
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
  {
    regex: /\s*(?:,\s*)?against\s+Blinded\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyBlinded' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Hindered\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyHindered' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+with\s+(?:(Fire|Cold|Lightning)\s+)?Exposure\s*$/i,
    toTag: (m) => {
      if (m[1]) {
        const cap = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
        return { type: 'Condition', var: `Enemy${cap}Exposure` };
      }
      return { type: 'Condition', var: 'EnemyExposure' };
    },
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+affected\s+by\s+(?:an\s+)?Elemental\s+Ailments?\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyAffectedByElementalAilment' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+affected\s+by\s+(?:an\s+)?Ailments?\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyAffectedByAilment' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+that\s+are\s+on\s+Low\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyLowLife' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+that\s+are\s+on\s+Full\s+Life\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyFullLife' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+dealt\s+a\s+Critical\s+(?:Hit|Strike)\s+in\s+the\s+past\s+8\s+seconds\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'CritInPast8Sec' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+been\s+Hit\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'BeenHitRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+consumed\s+an\s+Elemental\s+Infusion\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'ConsumedElementalInfusionRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+Shapeshifted\s+to\s+an\s+Animal\s+form\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'ShapeshiftedToAnimalRecently|Shapeshifted' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+Shapeshifted\s+to\s+Human\s+form\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'ShapeshiftedToHumanRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+summoned\s+a\s+Totem\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'SummonedTotemRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+you\s+have\s+Arcane\s+Surge\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByArcaneSurge' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Ignited\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Ignited' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+(?:your\s+Companion\s+is\s+in\s+your\s+Presence|in\s+the\s+Presence\s+of\s+your\s+Companion)\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'CompanionInPresence' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Unarmed\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Unarmed' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+dealt\s+a\s+Non-Critical\s+(?:Hit|Strike)\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'NonCritRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+Triggered\s+a\s+Skill\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'TriggeredSkillRecently' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+you\s+have\s+a\s+Totem\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'HaveTotem' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Slowed\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemySlowed' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:against|on)\s+Cursed\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyCursed' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Marked\s+Enem(?:y|ies)\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyMarked' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Poisoned\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyPoisoned' }),
  },
  {
    regex: /\s*(?:,\s*)?(?:with|on|from)\s+Critical\s+(?:Hits?|Strikes?)\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'CriticalStrike' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+a\s+Rare\s+or\s+Unique\s+Enemy\s+is\s+in\s+your\s+Presence\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyRareOrUnique' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+with\s+Fully\s+Broken\s+Armour\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyArmourBroken' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+you\s+have\s+an\s+Ally\s+in\s+your\s+Presence\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'MultiplierThreshold:NearbyAlly:1|CompanionInPresence' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Chilled\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Chilled' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+Surrounded\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'Surrounded' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Electrocuted\s+Enemies\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyElectrocuted' }),
  },
  {
    regex: /\s*(?:,\s*)?against\s+Enemies\s+with\s+an\s+Open\s+Weakness\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'EnemyHasOpenWeakness|EnemyOpenWeakness' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+an\s+Enemy\s+with\s+an\s+Open\s+Weakness\s+is\s+in\s+your\s+Presence\s*$/i,
    toTag: () => ({
      type: 'Condition',
      var: 'OpenWeaknessEnemyPresence|EnemyHasOpenWeakness|EnemyOpenWeakness',
    }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+Shapeshifted\s+to\s+Human\s+form\s+Recently\s*$/i,
    toTag: () => ({ type: 'Condition', var: 'ShapeshiftedToHumanRecently|ShapeshiftToHuman' }),
  },
  {
    regex: /\s*(?:,\s*)?while\s+affected\s+by\s+an\s+Ailment\s*$/i,
    toTag: () => ({
      type: 'Condition',
      var: 'Bleeding|Poisoned|Ignited|Chilled|Frozen|Shocked|Electrocuted',
    }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+consumed\s+an?\s+(Power|Frenzy|Endurance)\s+Charge\s+Recently\s*$/i,
    toTag: (m) => ({
      type: 'Condition',
      var: `Consumed${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()}ChargeRecently`,
    }),
  },
  {
    regex: /\s*(?:,\s*)?if\s+you(?:'ve|\s+have)\s+gained\s+an?\s+(Power|Frenzy|Endurance)\s+Charge\s+Recently\s*$/i,
    toTag: (m) => ({
      type: 'Condition',
      var: `Gained${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()}ChargeRecently`,
    }),
  },
];

const PREFIX_RULES: readonly SuffixRule[] = [
  {
    regex: /^while\s+you\s+have\s+a\s+Totem,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'HaveTotem' }),
  },
  {
    regex: /^(?:while|when)\s+not\s+on\s+Low\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'LowLife', neg: true }),
  },
  {
    regex: /^(?:while|when)\s+not\s+on\s+Full\s+Life,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'FullLife', neg: true }),
  },
  {
    regex: /^(?:while|when)\s+not\s+on\s+Low\s+Mana,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'LowMana', neg: true }),
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
    regex: /^(?:while|when)\s+on\s+Low\s+Mana,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'LowMana' }),
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
    regex: /^while\s+affected\s+by\s+Herald\s+of\s+(Thunder|Ice|Ash|Plague|Blood|Purity|Agony),\s+/i,
    toTag: (m) => {
      const cap = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      return { type: 'Condition', var: `AffectedByHeraldOf${cap}` };
    },
  },
  {
    regex: /^while\s+affected\s+by\s+a\s+Herald,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByHerald' }),
  },
  {
    regex: /^while\s+Shapeshifted,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Shapeshifted' }),
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
  {
    regex: /^while\s+you\s+have\s+Arcane\s+Surge,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'AffectedByArcaneSurge' }),
  },
  {
    regex: /^while\s+Ignited,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Ignited' }),
  },
  {
    regex: /^while\s+Unarmed,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Unarmed' }),
  },
  {
    regex: /^while\s+Surrounded,\s+/i,
    toTag: () => ({ type: 'Condition', var: 'Surrounded' }),
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
