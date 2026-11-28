import type { Build, EquipmentSlotId, Item } from '@webpob/core';
import { getBaseItemStats, getUniquesForGame, instantiateUniqueItem, type CompactUniqueEntry } from '@webpob/data';
import { calculateBuild, canWieldTwoHandedMartialInOneHand, canWieldWeaponInOneHand } from './engine.js';

export interface RankedUniqueUpgrade {
  unique: CompactUniqueEntry;
  item: Item;
  dpsDelta: number;
  dpsDeltaPct: number;
  ehpDelta: number;
  ehpDeltaPct: number;
  lifeDelta: number;
  esDelta: number;
}

function slotMatchesUnique(
  slot: EquipmentSlotId,
  unique: CompactUniqueEntry,
  build: Build,
  canWield2HIn1H: boolean,
): boolean {
  const uniqueSlot = unique.s;
  if (slot === uniqueSlot) return true;
  if ((slot === 'Ring 1' || slot === 'Ring 2' || slot === 'Ring 3') && uniqueSlot === 'Ring 1') return true;
  if (slot.startsWith('Flask ') && uniqueSlot === 'Flask 1') return true;
  if (slot.startsWith('Charm ') && uniqueSlot === 'Charm 1') return true;
  if (slot === 'Weapon 1 Swap' && uniqueSlot === 'Weapon 1') return true;
  if (slot === 'Weapon 2 Swap' && uniqueSlot === 'Weapon 2') return true;
  if ((slot === 'Weapon 2' || slot === 'Weapon 2 Swap') && uniqueSlot === 'Weapon 1') {
    const base = getBaseItemStats(unique.b, 0, build.game);
    return canWieldWeaponInOneHand(base?.weapon, canWield2HIn1H);
  }
  return false;
}

/**
 * Ranks compatible official Unique items for a given equipment slot by live simulated
 * Total DPS (or EHP) upgrade delta, inspired by desktop PoB's Unique Upgrade Advisor.
 */
export function rankUniqueUpgradesForSlot(
  build: Build,
  slot: EquipmentSlotId,
  sortBy: 'dps' | 'ehp' = 'dps',
  limit = 8,
): RankedUniqueUpgrade[] {
  const baseline = calculateBuild(build);
  const baseDps = baseline.offence.fullDps ?? baseline.offence.totalDps;
  const baseEhp = Math.max(1, baseline.defence.effectiveHitPool);
  const currentItemId = build.equipped[slot];
  const currentName = currentItemId ? build.items[currentItemId]?.name.toLowerCase() : '';
  const canWield2HIn1H = canWieldTwoHandedMartialInOneHand(build);

  const uniques = getUniquesForGame(build.game).filter(
    (u) => slotMatchesUnique(slot, u, build, canWield2HIn1H) && u.en.toLowerCase() !== currentName,
  );

  // Deduplicate by unique name and simulate live
  const seen = new Set<string>();
  const results: RankedUniqueUpgrade[] = [];

  for (const u of uniques) {
    const key = u.en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const item = instantiateUniqueItem(build.game, u);
    const simId = `__sim_uniq_${results.length}`;
    item.id = simId;
    const simBuild: Build = {
      ...build,
      items: { ...build.items, [simId]: item },
      equipped: { ...build.equipped, [slot]: simId },
      ...(slot.startsWith('Flask ')
        ? { activeFlaskSlots: { ...(build.activeFlaskSlots ?? {}), [slot]: true } }
        : {}),
    };
    const next = calculateBuild(simBuild);
    const nextDps = next.offence.fullDps ?? next.offence.totalDps;
    const dpsDelta = Math.round((nextDps - baseDps) * 100) / 100;
    const ehpDelta = Math.round((next.defence.effectiveHitPool - baseline.defence.effectiveHitPool) * 100) / 100;

    if (sortBy === 'dps' ? dpsDelta <= 0.5 : ehpDelta <= 5) continue;

    const dpsDeltaPct = baseDps > 0 ? Math.round((dpsDelta / baseDps) * 1000) / 10 : 100;
    const ehpDeltaPct = Math.round((ehpDelta / baseEhp) * 1000) / 10;

    results.push({
      unique: u,
      item,
      dpsDelta,
      dpsDeltaPct,
      ehpDelta,
      ehpDeltaPct,
      lifeDelta: next.defence.life - baseline.defence.life,
      esDelta: next.defence.energyShield - baseline.defence.energyShield,
    });
  }

  results.sort((a, b) =>
    sortBy === 'dps'
      ? b.dpsDelta - a.dpsDelta || b.ehpDelta - a.ehpDelta
      : b.ehpDelta - a.ehpDelta || b.dpsDelta - a.dpsDelta,
  );
  return results.slice(0, limit);
}
