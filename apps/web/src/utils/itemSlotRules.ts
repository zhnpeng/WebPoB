import type { Build, EquipmentSlotId, Item, PassiveNode } from '@webpob/core';
import { getRuleset, getTreeForGame } from '@webpob/data';

const TWO_HANDED_IN_ONE_HAND_MOD_RE =
  /You can wield Two-Handed Axes, Maces and Swords in one hand|可以[单單]手[装裝][备備][双雙]手斧、[双雙]手[锤錘]和[双雙]手[剑劍]/i;
const CANT_USE_BODY_ARMOUR_MOD_RE =
  /Can't use (?:Body|Chest) armour|[无無]法使用胸甲/i;
const BRINGER_OF_RAIN_NAME_RE = /^(?:the\s+)?bringer of rain$|^祭[礼禮]之雨$/i;

function isBringerOfRainItem(item: Item): boolean {
  return (
    BRINGER_OF_RAIN_NAME_RE.test(item.name.trim()) ||
    Boolean(item.nameZh && BRINGER_OF_RAIN_NAME_RE.test(item.nameZh.trim())) ||
    Boolean(item.nameZhTw && BRINGER_OF_RAIN_NAME_RE.test(item.nameZhTw.trim()))
  );
}

function getActiveEquippedItems(build: Build): Array<{ slot: EquipmentSlotId; item: Item }> {
  const result: Array<{ slot: EquipmentSlotId; item: Item }> = [];
  const ruleset = getRuleset(build.game);

  for (const slot of ruleset.equipmentSlots) {
    if (build.game === 'poe2') {
      if (build.activeWeaponSet === 1 && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')) {
        continue;
      }
      if (build.activeWeaponSet === 2 && (slot === 'Weapon 1' || slot === 'Weapon 2')) {
        const hasSwap = Boolean(build.equipped['Weapon 1 Swap'] || build.equipped['Weapon 2 Swap']);
        if (hasSwap) continue;
      }
    }

    const itemId = build.equipped[slot];
    if (!itemId) continue;
    const item = build.items[itemId];
    if (item) {
      result.push({ slot, item });
    }
  }
  if (!ruleset.equipmentSlots.includes('Ring 3') && build.equipped['Ring 3']) {
    const r3 = build.items[build.equipped['Ring 3']];
    if (r3) {
      result.push({ slot: 'Ring 3', item: r3 });
    }
  }
  return result;
}

/**
 * Lightweight UI slot-constraint check matching `@webpob/calc` Giant's Blood /
 * Bringer of Rain rules without importing the full calculation engine on the main thread.
 */
export function canWieldTwoHandedMartialInOneHand(
  build: Build,
  allocatedNodes?: PassiveNode[],
): boolean {
  if (build.game !== 'poe2') return false;
  const nodes =
    allocatedNodes ??
    (() => {
      const tree = getTreeForGame(build.game, build.tree.treeVersion);
      const out: PassiveNode[] = [];
      const seen = new Set<number>();
      const activeSetNodes =
        build.activeWeaponSet === 2 ? build.tree.weaponSet2NodeIds : build.tree.weaponSet1NodeIds;
      for (const id of [...build.tree.allocatedNodeIds, ...activeSetNodes]) {
        if (seen.has(id)) continue;
        seen.add(id);
        const node = tree.nodes[id];
        if (node) out.push(node);
      }
      return out;
    })();

  if (
    nodes.some(
      (n) =>
        n.name.en.trim().toLowerCase() === "giant's blood" ||
        n.stats.some((s) => TWO_HANDED_IN_ONE_HAND_MOD_RE.test(s)),
    )
  ) {
    return true;
  }

  for (const { slot, item } of getActiveEquippedItems(build)) {
    if (slot.startsWith('Flask ') || slot.startsWith('Charm ')) continue;
    if (isBringerOfRainItem(item)) return true;
    if ([...item.implicits, ...item.explicits].some((line) => TWO_HANDED_IN_ONE_HAND_MOD_RE.test(line))) {
      return true;
    }
  }
  return false;
}

export function canWieldWeaponInOneHand(
  weaponStats: { weaponType?: string; twoHanded?: boolean } | undefined,
  canWield2HIn1H: boolean,
): boolean {
  if (!weaponStats) return false;
  if (!weaponStats.twoHanded) return true;
  if (!canWield2HIn1H) return false;
  return (
    weaponStats.weaponType === 'Axe' ||
    weaponStats.weaponType === 'Mace' ||
    weaponStats.weaponType === 'Sword'
  );
}

export function hasCantUseBodyArmour(build: Build): boolean {
  for (const { slot, item } of getActiveEquippedItems(build)) {
    if (slot === 'Body Armour' || slot.startsWith('Flask ') || slot.startsWith('Charm ')) continue;
    if (isBringerOfRainItem(item)) return true;
    if ([...item.implicits, ...item.explicits].some((line) => CANT_USE_BODY_ARMOUR_MOD_RE.test(line))) {
      return true;
    }
  }
  return false;
}
