import { KeywordFlag, type Mod, type ModType } from '@webpob/core';
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

/**
 * Pure-TypeScript port of Path of Building's `ModDB`.
 * Stores modifiers keyed by canonical stat name and evaluates them against
 * bitmask `ModFlag`, `KeywordFlag`, and `ModTag` contexts.
 */
export class ModDB {
  private readonly store = new Map<string, Mod[]>();
  private evalContext: ModEvalContext = createEmptyEvalContext();

  setCondition(name: string, value: boolean): void {
    this.evalContext.conditions[name] = value;
  }

  setMultiplier(name: string, value: number): void {
    this.evalContext.multipliers[name] = value;
  }

  setStat(name: string, value: number): void {
    this.evalContext.stats[name] = value;
  }

  setEvalContext(ctx: ModEvalContext): void {
    this.evalContext = {
      conditions: { ...ctx.conditions },
      multipliers: { ...ctx.multipliers },
      stats: { ...ctx.stats },
      ...(ctx.skillTypes ? { skillTypes: { ...ctx.skillTypes } } : {}),
      ...(ctx.socketedIn !== undefined ? { socketedIn: ctx.socketedIn } : {}),
    };
  }

  getEvalContext(): ModEvalContext {
    return this.evalContext;
  }

  addMod(mod: Mod): void {
    let bucket = this.store.get(mod.name);
    if (!bucket) {
      bucket = [];
      this.store.set(mod.name, bucket);
    }
    bucket.push(mod);
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
    if (mod.flags !== 0 && (mod.flags & flags) !== mod.flags) {
      return false;
    }
    let reqKw = mod.keywordFlags;
    if (reqKw !== 0) {
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
      if (reqKw !== 0 && (reqKw & keywordFlags) !== reqKw) {
        return false;
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
    let total = 0;
    for (const mod of this.collect(names, flags, keywordFlags)) {
      if (mod.type === modType && typeof mod.value === 'number') {
        const evalRes = evaluateModTags(mod, this.evalContext);
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
          const evalRes = evaluateModTags(mod, this.evalContext);
          if (!evalRes.active) continue;
          const effectiveVal = applyModTagEval(mod.value, evalRes);
          modResult *= 1 + effectiveVal / 100;
        }
      }
      result *= Math.floor(modResult * 100 + 0.5) / 100;
    }
    return Math.max(0, result);
  }

  flag(name: string, flags = 0, keywordFlags = 0): boolean {
    for (const mod of this.collect(name, flags, keywordFlags)) {
      if (mod.type === 'FLAG' && mod.value === true) {
        const evalRes = evaluateModTags(mod, this.evalContext);
        if (evalRes.active) {
          return true;
        }
      }
    }
    return false;
  }

  override(name: string, flags = 0, keywordFlags = 0): number | null {
    let value: number | null = null;
    for (const mod of this.collect(name, flags, keywordFlags)) {
      if (mod.type === 'OVERRIDE' && typeof mod.value === 'number') {
        const evalRes = evaluateModTags(mod, this.evalContext);
        if (!evalRes.active) continue;
        value = applyModTagEval(mod.value, evalRes);
      }
    }
    return value;
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
    const matched = this.collect(names, flags, keywordFlags);
    let base = 0;
    let incPct = 0;
    let moreMultiplier = 1;
    let overrideVal: number | null = null;
    const sources: EvaluatedStat['sources'] = [];

    for (const mod of matched) {
      if (typeof mod.value !== 'number') continue;
      const evalRes = evaluateModTags(mod, this.evalContext);
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
