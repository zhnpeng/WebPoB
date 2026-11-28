import { KeywordFlag, ModFlag, type Mod, type ModType } from '@webpob/core';
import {
  applyModTagEval,
  createEmptyEvalContext,
  evaluateModTags,
  type ModEvalContext,
} from './modTagEval.js';

export interface EvaluatedStat {
  base: number;
  incPct: number;
  moreMultiplier: number;
  total: number;
  sources: Array<{ source: string; type: ModType; value: number | string }>;
}

const KEYWORD_FLAG_MATCH_ALL = 0x40000000;

/**
 * Pure-TypeScript port of Path of Building's `ModDB`.
 * Stores modifiers keyed by canonical stat name and evaluates them against
 * bitmask `ModFlag`, `KeywordFlag`, and `ModTag` contexts.
 */
export class ModDB {
  private static readonly mirroredMultsByObj = new WeakMap<
    Record<string, number>,
    Map<string, number>
  >();
  private static readonly explicitMultsByObj = new WeakMap<
    Record<string, number>,
    Set<string>
  >();

  private readonly store = new Map<string, Mod[]>();
  private evalContext: ModEvalContext = createEmptyEvalContext();
  private readonly conditionModVars = new Set<string>();
  private readonly multiplierModVars = new Set<string>();
  private readonly mirroredMults = new Map<string, number>();
  private readonly explicitMults = new Set<string>();
  private readonly activeDynamicKeys = new Set<string>();
  private dynamicEvalView: ModEvalContext | null = null;

  constructor() {
    ModDB.mirroredMultsByObj.set(this.evalContext.multipliers, this.mirroredMults);
    ModDB.explicitMultsByObj.set(this.evalContext.multipliers, this.explicitMults);
  }

  setCondition(name: string, value: boolean): void {
    this.evalContext.conditions[name] = value;
  }

  setMultiplier(name: string, value: number): void {
    this.evalContext.multipliers[name] = value;
    this.mirroredMults.delete(name);
    this.explicitMults.add(name);
  }

  setStat(name: string, value: number): void {
    this.evalContext.stats[name] = value;
  }

  setEvalContext(ctx: ModEvalContext): void {
    const prevMirrored =
      ctx.multipliers === this.evalContext.multipliers
        ? new Map(this.mirroredMults)
        : ModDB.mirroredMultsByObj.get(ctx.multipliers);
    const prevExplicit =
      ctx.multipliers === this.evalContext.multipliers
        ? new Set(this.explicitMults)
        : ModDB.explicitMultsByObj.get(ctx.multipliers);
    this.evalContext = {
      conditions: { ...ctx.conditions },
      multipliers: { ...ctx.multipliers },
      stats: { ...ctx.stats },
      ...(ctx.skillTypes ? { skillTypes: { ...ctx.skillTypes } } : {}),
      ...(ctx.socketedIn !== undefined ? { socketedIn: ctx.socketedIn } : {}),
    };
    this.mirroredMults.clear();
    if (prevMirrored) {
      for (const [k, v] of prevMirrored.entries()) {
        if (this.evalContext.multipliers[k] !== undefined) {
          this.mirroredMults.set(k, v);
        }
      }
    }
    this.explicitMults.clear();
    if (prevExplicit) {
      for (const k of prevExplicit) {
        if (this.evalContext.multipliers[k] !== undefined) {
          this.explicitMults.add(k);
        }
      }
    } else {
      // Fresh external evalContext with pre-populated multipliers: treat pre-existing keys
      // as explicit so store Multiplier:* mods do not double-count engine/config values.
      for (const k of Object.keys(this.evalContext.multipliers)) {
        if (!this.mirroredMults.has(k)) {
          this.explicitMults.add(k);
        }
      }
    }
    ModDB.mirroredMultsByObj.set(this.evalContext.multipliers, this.mirroredMults);
    ModDB.explicitMultsByObj.set(this.evalContext.multipliers, this.explicitMults);
    this.dynamicEvalView = null;
  }

  getEvalContext(): ModEvalContext {
    return this.evalContext;
  }

  private getEffectiveEvalContext(): ModEvalContext {
    if (this.conditionModVars.size === 0 && this.multiplierModVars.size === 0) {
      return this.evalContext;
    }
    if (this.dynamicEvalView) {
      return this.dynamicEvalView;
    }

    const baseCtx = this.evalContext;
    const conditionsProxy =
      this.conditionModVars.size > 0
        ? new Proxy(baseCtx.conditions, {
            get: (target, prop, receiver) => {
              const direct = Reflect.get(target, prop, receiver);
              if (direct) return direct;
              if (typeof prop === 'string' && this.conditionModVars.has(prop)) {
                return this.evalDynamicCondition(prop);
              }
              return direct;
            },
          })
        : baseCtx.conditions;

    const multipliersProxy =
      this.multiplierModVars.size > 0
        ? new Proxy(baseCtx.multipliers, {
            get: (target, prop, receiver) => {
              const direct = Reflect.get(target, prop, receiver) as number | undefined;
              if (typeof prop === 'string' && this.multiplierModVars.has(prop)) {
                return this.evalDynamicMultiplier(prop, direct);
              }
              return direct;
            },
          })
        : baseCtx.multipliers;

    this.dynamicEvalView = {
      conditions: conditionsProxy,
      multipliers: multipliersProxy,
      stats: baseCtx.stats,
      ...(baseCtx.skillTypes ? { skillTypes: baseCtx.skillTypes } : {}),
      ...(baseCtx.socketedIn !== undefined ? { socketedIn: baseCtx.socketedIn } : {}),
    };
    return this.dynamicEvalView;
  }

  private evalDynamicCondition(condVar: string): boolean {
    const guardKey = `C:${condVar}`;
    if (this.activeDynamicKeys.has(guardKey)) return false;
    this.activeDynamicKeys.add(guardKey);
    try {
      const ctx = this.getEffectiveEvalContext();
      const checkBucket = (name: string): boolean => {
        const bucket = this.store.get(name);
        if (!bucket) return false;
        for (const mod of bucket) {
          if (mod.type === 'FLAG' && mod.value === true && mod.flags === 0 && mod.keywordFlags === 0) {
            const evalRes = evaluateModTags(mod, ctx);
            if (evalRes.active) return true;
          }
        }
        return false;
      };
      if (checkBucket(`Condition:${condVar}`)) return true;
      if (condVar === 'Shocked' && checkBucket('Condition:AlreadyShocked')) return true;
      return false;
    } finally {
      this.activeDynamicKeys.delete(guardKey);
    }
  }

  private evalDynamicMultiplier(multVar: string, direct: number | undefined): number | undefined {
    const guardKey = `M:${multVar}`;
    if (this.activeDynamicKeys.has(guardKey)) return direct;
    this.activeDynamicKeys.add(guardKey);
    try {
      const bucket = this.store.get(`Multiplier:${multVar}`);
      const ctx = this.getEffectiveEvalContext();
      if (!bucket) {
        if (direct === undefined && multVar === 'TotalCharges') {
          return (
            (ctx.multipliers.PowerCharge ?? 0) +
            (ctx.multipliers.FrenzyCharge ?? 0) +
            (ctx.multipliers.EnduranceCharge ?? 0)
          );
        }
        return direct;
      }
      let overrideVal: number | null = null;
      let storeSum = 0;
      let anyActiveBase = false;
      for (const mod of bucket) {
        if (typeof mod.value !== 'number' || mod.flags !== 0 || mod.keywordFlags !== 0) continue;
        if (mod.type === 'OVERRIDE') {
          const evalRes = evaluateModTags(mod, ctx);
          if (evalRes.active) {
            overrideVal = applyModTagEval(mod.value, evalRes);
          }
        } else if (mod.type === 'BASE') {
          const evalRes = evaluateModTags(mod, ctx);
          if (evalRes.active) {
            anyActiveBase = true;
            storeSum += applyModTagEval(mod.value, evalRes);
          }
        }
      }
      if (overrideVal !== null) {
        return overrideVal;
      }
      if (direct === undefined) {
        return anyActiveBase ? storeSum : undefined;
      }
      if (this.explicitMults.has(multVar)) {
        return direct;
      }
      const mirrored = this.mirroredMults.get(multVar) ?? 0;
      return direct + (storeSum - mirrored);
    } finally {
      this.activeDynamicKeys.delete(guardKey);
    }
  }

  addMod(mod: Mod): void {
    let bucket = this.store.get(mod.name);
    if (!bucket) {
      bucket = [];
      this.store.set(mod.name, bucket);
    }
    bucket.push(mod);

    // Ensure derived composite multipliers (e.g. TotalCharges = Power + Frenzy + Endurance)
    // activate the lazy dynamic eval view even when no explicit `Multiplier:*` mod is stored.
    if (mod.tags) {
      for (const tag of mod.tags) {
        if (tag.type === 'Multiplier' && tag.var === 'TotalCharges') {
          const wasEmpty = this.multiplierModVars.size === 0;
          this.multiplierModVars.add('TotalCharges');
          if (wasEmpty) this.dynamicEvalView = null;
        }
      }
    }

    // Mirror PoB Condition:<Var> and Multiplier:<Var> modifiers into evalContext
    // and register them for lazy dynamic re-evaluation (PoB ModStore:GetCondition / GetMultiplier).
    if (mod.name.startsWith('Condition:') && mod.type === 'FLAG' && typeof mod.value === 'boolean') {
      const condVar = mod.name.slice('Condition:'.length);
      if (condVar) {
        if (mod.value && mod.flags === 0 && mod.keywordFlags === 0) {
          const wasEmpty = this.conditionModVars.size === 0;
          this.conditionModVars.add(condVar);
          if (condVar === 'AlreadyShocked') {
            this.conditionModVars.add('Shocked');
          }
          if (wasEmpty) this.dynamicEvalView = null;
        }
        const evalRes = evaluateModTags(mod, this.getEffectiveEvalContext());
        if (evalRes.active) {
          this.evalContext.conditions[condVar] = mod.value;
          if (condVar === 'AlreadyShocked' && mod.value) {
            this.evalContext.conditions.Shocked = true;
          }
        }
      }
    } else if (
      mod.name.startsWith('Multiplier:') &&
      (mod.type === 'BASE' || mod.type === 'OVERRIDE') &&
      typeof mod.value === 'number'
    ) {
      const multVar = mod.name.slice('Multiplier:'.length);
      if (multVar) {
        if (mod.flags === 0 && mod.keywordFlags === 0) {
          const wasEmpty = this.multiplierModVars.size === 0;
          this.multiplierModVars.add(multVar);
          if (wasEmpty) this.dynamicEvalView = null;
        }
        if (mod.type === 'BASE' && !this.explicitMults.has(multVar)) {
          const evalRes = evaluateModTags(mod, this.getEffectiveEvalContext());
          if (evalRes.active) {
            const delta = applyModTagEval(mod.value, evalRes);
            this.evalContext.multipliers[multVar] =
              (this.evalContext.multipliers[multVar] ?? 0) + delta;
            if (mod.flags === 0 && mod.keywordFlags === 0) {
              this.mirroredMults.set(multVar, (this.mirroredMults.get(multVar) ?? 0) + delta);
            }
          }
        }
      }
    }
  }

  addMods(mods: readonly Mod[]): void {
    for (const mod of mods) {
      this.addMod(mod);
    }
  }

  clone(): ModDB {
    const copy = new ModDB();
    for (const [key, list] of this.store.entries()) {
      copy.store.set(key, [...list]);
    }
    for (const v of this.conditionModVars) copy.conditionModVars.add(v);
    for (const v of this.multiplierModVars) copy.multiplierModVars.add(v);
    copy.setEvalContext(this.evalContext);
    return copy;
  }

  entriesByPrefix(prefix: string): Array<[string, Mod[]]> {
    const out: Array<[string, Mod[]]> = [];
    for (const [key, list] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        out.push([key, list]);
      }
    }
    return out;
  }

  private matches(mod: Mod, flags: number, keywordFlags: number): boolean {
    let reqFlags = mod.flags;
    if (reqFlags !== 0) {
      const hitOrAilmentFlag = ModFlag.Hit | ModFlag.Ailment;
      if ((reqFlags & hitOrAilmentFlag) === hitOrAilmentFlag) {
        if ((flags & hitOrAilmentFlag) === 0) return false;
        reqFlags &= ~hitOrAilmentFlag;
      }
      const atkOrSpellFlag = ModFlag.Attack | ModFlag.Spell;
      if ((reqFlags & atkOrSpellFlag) === atkOrSpellFlag) {
        if ((flags & atkOrSpellFlag) === 0) return false;
        reqFlags &= ~atkOrSpellFlag;
      }
      if (reqFlags !== 0 && (reqFlags & flags) !== reqFlags) {
        return false;
      }
    }
    let reqKw = mod.keywordFlags;
    if (reqKw !== 0) {
      if ((reqKw & KEYWORD_FLAG_MATCH_ALL) !== 0) {
        const exactKw = reqKw & ~KEYWORD_FLAG_MATCH_ALL;
        if (exactKw !== 0 && (exactKw & keywordFlags) !== exactKw) {
          return false;
        }
      } else {
        const hitOrAilment = KeywordFlag.Hit | KeywordFlag.Ailment;
        if ((reqKw & hitOrAilment) === hitOrAilment) {
          if ((keywordFlags & hitOrAilment) === 0) return false;
          reqKw &= ~hitOrAilment;
        }
        const atkOrSpell = KeywordFlag.Attack | KeywordFlag.Spell;
        if ((reqKw & atkOrSpell) === atkOrSpell) {
          if ((keywordFlags & atkOrSpell) === 0) return false;
          reqKw &= ~atkOrSpell;
        }
        const trapOrMine = KeywordFlag.Trap | KeywordFlag.Mine;
        if ((reqKw & trapOrMine) === trapOrMine) {
          if ((keywordFlags & trapOrMine) === 0) return false;
          reqKw &= ~trapOrMine;
        }
        const ailmentsMask = KeywordFlag.Ignite | KeywordFlag.Bleed | KeywordFlag.Poison;
        const reqAilments = reqKw & ailmentsMask;
        if (reqAilments !== 0 && (reqAilments & (reqAilments - 1)) !== 0) {
          if ((keywordFlags & reqAilments) === 0) return false;
          reqKw &= ~reqAilments;
        }
        const eleMask = KeywordFlag.Fire | KeywordFlag.Cold | KeywordFlag.Lightning;
        const reqEle = reqKw & eleMask;
        if (reqEle !== 0 && (reqEle & (reqEle - 1)) !== 0) {
          if ((keywordFlags & reqEle) === 0) return false;
          reqKw &= ~reqEle;
        }
        if (reqKw !== 0 && (reqKw & keywordFlags) !== reqKw) {
          return false;
        }
      }
    }
    return true;
  }

  private collect(
    names: string | readonly string[],
    flags = 0,
    keywordFlags = 0,
  ): Mod[] {
    const nameList = typeof names === 'string' ? [names] : names;
    const result: Mod[] = [];
    for (const name of nameList) {
      const bucket = this.store.get(name);
      if (!bucket) continue;
      for (const mod of bucket) {
        if (this.matches(mod, flags, keywordFlags)) {
          result.push(mod);
        }
      }
    }
    return result;
  }

  sum(
    modType: 'BASE' | 'INC',
    names: string | readonly string[],
    flags = 0,
    keywordFlags = 0,
  ): number {
    const ctx = this.getEffectiveEvalContext();
    let total = 0;
    for (const mod of this.collect(names, flags, keywordFlags)) {
      if (mod.type === modType && typeof mod.value === 'number') {
        const evalRes = evaluateModTags(mod, ctx);
        if (!evalRes.active) continue;
        total += applyModTagEval(mod.value, evalRes);
      }
    }
    return total;
  }

  more(
    names: string | readonly string[],
    flags = 0,
    keywordFlags = 0,
  ): number {
    // Matches official PoB ModList:MoreInternal — each stat bucket's product is rounded to the nearest percent
    const ctx = this.getEffectiveEvalContext();
    const nameList = typeof names === 'string' ? [names] : names;
    let result = 1;
    for (const name of nameList) {
      const bucket = this.store.get(name);
      if (!bucket) continue;
      let modResult = 1;
      for (const mod of bucket) {
        if (
          mod.type === 'MORE' &&
          typeof mod.value === 'number' &&
          this.matches(mod, flags, keywordFlags)
        ) {
          const evalRes = evaluateModTags(mod, ctx);
          if (!evalRes.active) continue;
          const effectiveVal = applyModTagEval(mod.value, evalRes);
          modResult *= 1 + effectiveVal / 100;
        }
      }
      modResult = Math.max(0, modResult);
      result *= Math.floor(modResult * 100 + 0.5) / 100;
    }
    return Math.max(0, result);
  }

  flag(name: string, flags = 0, keywordFlags = 0): boolean {
    const ctx = this.getEffectiveEvalContext();
    for (const mod of this.collect(name, flags, keywordFlags)) {
      if (mod.type === 'FLAG' && mod.value === true) {
        const evalRes = evaluateModTags(mod, ctx);
        if (evalRes.active) {
          return true;
        }
      }
    }
    return false;
  }

  override(name: string, flags = 0, keywordFlags = 0): number | null {
    const ctx = this.getEffectiveEvalContext();
    let value: number | null = null;
    for (const mod of this.collect(name, flags, keywordFlags)) {
      if (mod.type === 'OVERRIDE' && typeof mod.value === 'number') {
        const evalRes = evaluateModTags(mod, ctx);
        if (!evalRes.active) continue;
        value = applyModTagEval(mod.value, evalRes);
      }
    }
    return value;
  }

  max(
    names: string | readonly string[],
    flags = 0,
    keywordFlags = 0,
  ): number | null {
    const ctx = this.getEffectiveEvalContext();
    let best: number | null = null;
    for (const mod of this.collect(names, flags, keywordFlags)) {
      if (mod.type === 'MAX' && typeof mod.value === 'number') {
        const evalRes = evaluateModTags(mod, ctx);
        if (!evalRes.active) continue;
        const val = applyModTagEval(mod.value, evalRes);
        if (best === null || val > best) {
          best = val;
        }
      }
    }
    return best;
  }

  /**
   * Computes `base * (1 + incPct / 100) * moreMultiplier`, respecting OVERRIDE if present,
   * and returns full source attribution for the Calcs breakdown panel.
   */
  calcStat(
    names: string | readonly string[],
    flags = 0,
    keywordFlags = 0,
  ): EvaluatedStat {
    const ctx = this.getEffectiveEvalContext();
    const matched = this.collect(names, flags, keywordFlags);
    let base = 0;
    let incPct = 0;
    let moreMultiplier = 1;
    let overrideVal: number | null = null;
    const sources: EvaluatedStat['sources'] = [];

    for (const mod of matched) {
      if (typeof mod.value !== 'number') continue;
      const evalRes = evaluateModTags(mod, ctx);
      if (!evalRes.active) continue;
      const effectiveVal = applyModTagEval(mod.value, evalRes);
      if (mod.tags && mod.tags.length > 0 && effectiveVal === 0 && mod.type !== 'OVERRIDE') {
        continue;
      }

      if (mod.type === 'BASE') {
        base += effectiveVal;
        sources.push({ source: mod.source, type: 'BASE', value: effectiveVal });
      } else if (mod.type === 'INC') {
        incPct += effectiveVal;
        sources.push({ source: mod.source, type: 'INC', value: effectiveVal });
      } else if (mod.type === 'MORE') {
        moreMultiplier *= 1 + effectiveVal / 100;
        sources.push({ source: mod.source, type: 'MORE', value: effectiveVal });
      } else if (mod.type === 'OVERRIDE') {
        overrideVal = effectiveVal;
        sources.push({ source: mod.source, type: 'OVERRIDE', value: effectiveVal });
      }
    }

    moreMultiplier = Math.max(0, moreMultiplier);
    const total =
      overrideVal !== null
        ? overrideVal
        : Math.max(0, base * (1 + incPct / 100) * moreMultiplier);

    return { base, incPct, moreMultiplier, total, sources };
  }
}
