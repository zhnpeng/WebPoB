import { useMemo, useState } from 'react';
import { ClipboardPaste, Copy, ExternalLink, FlaskConical, GitCompareArrows, Hammer, Layers, Power, PowerOff, Search, Shield, Sparkles, Trash2, TrendingUp, X } from 'lucide-react';
import type { EquipmentSlotId, Item } from '@webpob/core';
import {
  getBaseItemStats,
  getLocalizedBaseName,
  getLocalizedUniqueName,
  getPresetItemsForGame,
  getRuleset,
  getUniquesForGame,
  instantiateUniqueItem,
  listBaseItemsForGame,
  type CompactUniqueEntry,
} from '@webpob/data';
import { parseItemText } from '@webpob/codec';
import {
  calculateBuild,
  canWieldTwoHandedMartialInOneHand,
  canWieldWeaponInOneHand,
  hasCantUseBodyArmour,
  parseModLine,
  rankUniqueUpgradesForSlot,
  resolveItemEffectiveStats,
} from '@webpob/calc';
import { getSlotLabel, localizeStatLine, t, toTraditionalZh, uiText } from '@webpob/i18n';
import { useWebPobStore } from '../store/useWebPobStore';
import { ItemCompareModal } from './ItemCompareModal';
import { GearSummaryDrawer } from './GearSummaryDrawer';

const EXAMPLE_EN_ITEM = `Item Class: Body Armours
Rarity: Rare
Storm Shroud
Vaal Regalia
--------
Quality: +20% (augmented)
Energy Shield: 620 (augmented)
--------
+95 to maximum Life
+44% to Fire Resistance
+42% to Lightning Resistance
32% increased Spell Damage`;

const EXAMPLE_ZH_ITEM = `物品类别: 胸甲
稀有度: 稀有
风暴帷幕
瓦尔法衣
--------
品质: +20%（已增强）
能量护盾: 620（已增强）
--------
最大生命 +95
火焰抗性 +44%
闪电抗性 +42%
法术伤害提高 32%`;

const RARITY_COLOR: Record<Item['rarity'], string> = {
  NORMAL: 'text-zinc-200 border-zinc-600/50',
  MAGIC: 'text-blue-300 border-blue-500/40',
  RARE: 'text-yellow-200 border-yellow-500/40',
  UNIQUE: 'text-orange-400 border-orange-500/50',
};

const UNIQUE_SLOT_FILTERS = [
  'ALL',
  'Weapon 1',
  'Weapon 2',
  'Body Armour',
  'Helmet',
  'Gloves',
  'Boots',
  'Amulet',
  'Ring 1',
  'Belt',
  'Flask 1',
  'Jewel',
] as const;

function buildTradeSearchUrl(item: Item, game: 'poe1' | 'poe2', cn: boolean): string {
  const query = item.rarity === 'UNIQUE' ? { name: item.name, type: item.baseName } : { type: item.baseName };
  const payload = JSON.stringify({
    query: {
      status: { option: 'online' },
      ...query,
    },
    sort: { price: 'asc' },
  });
  const encoded = encodeURIComponent(payload);
  if (cn && game === 'poe1') {
    return `https://poe.game.qq.com/trade/search/Standard?q=${encoded}`;
  }
  return game === 'poe2'
    ? `https://www.pathofexile.com/trade2/search/poe2/Standard?q=${encoded}`
    : `https://www.pathofexile.com/trade/search/Standard?q=${encoded}`;
}

const CRAFT_AFFIX_POOL: Record<'weapon' | 'armour' | 'accessory', Array<{ en: string; zh: string }>> = {
  weapon: [
    { en: '150% increased Physical Damage', zh: '物理伤害提高 150% (局部)' },
    { en: 'Adds 25 to 45 Physical Damage', zh: '附加 25 - 45 点物理伤害 (局部)' },
    { en: '20% increased Attack Speed', zh: '攻击速度提高 20% (局部)' },
    { en: '30% increased Critical Strike Chance', zh: '暴击率提高 30% (局部)' },
    { en: '75% increased Spell Damage', zh: '法术伤害提高 75%' },
    { en: '22% increased Cast Speed', zh: '施法速度提高 22%' },
    { en: '+35% to Global Critical Strike Multiplier', zh: '全局暴击伤害加成 +35%' },
    { en: 'Adds 35 to 75 Lightning Damage to Spells', zh: '法术附加 35 - 75 点闪电伤害' },
    { en: 'Adds 35 to 75 Fire Damage to Spells', zh: '法术附加 35 - 75 点火焰伤害' },
    { en: 'Adds 35 to 75 Cold Damage to Spells', zh: '法术附加 35 - 75 点冰霜伤害' },
    { en: "Your Hits can't be Evaded", zh: '你的击中无法被闪避' },
    { en: '10% chance to deal Double Damage', zh: '10% 几率造成双倍伤害' },
    { en: '+1 to Level of all Spell Skill Gems', zh: '所有法术技能宝石等级 +1' },
    { en: '+2 to Level of all Lightning Spell Skills', zh: '所有闪电法术技能等级 +2' },
    { en: '+2 to Level of all Projectile Skills', zh: '所有投射物技能等级 +2' },
    { en: '+2 to Level of all Melee Skills', zh: '所有近战技能等级 +2' },
  ],
  armour: [
    { en: '+105 to maximum Life', zh: '最大生命 +105' },
    { en: '+95 to maximum Energy Shield', zh: '最大能量护盾 +95 (局部)' },
    { en: '110% increased Energy Shield', zh: '能量护盾提高 110% (局部)' },
    { en: '110% increased Armour', zh: '护甲提高 110% (局部)' },
    { en: '110% increased Evasion Rating', zh: '闪避值提高 110% (局部)' },
    { en: '+50 to Ward', zh: '结界 +50 (局部)' },
    { en: '80% increased Ward', zh: '结界提高 80% (局部)' },
    { en: '+45% to Fire Resistance', zh: '火焰抗性 +45%' },
    { en: '+45% to Cold Resistance', zh: '冰霜抗性 +45%' },
    { en: '+45% to Lightning Resistance', zh: '闪电抗性 +45%' },
    { en: '+35% to Chaos Resistance', zh: '混沌抗性 +35%' },
    { en: '+14% chance to Suppress Spell Damage', zh: '法术伤害压制率 +14%' },
    { en: '30% increased Movement Speed', zh: '移动速度提高 30%' },
  ],
  accessory: [
    { en: '+85 to maximum Life', zh: '最大生命 +85' },
    { en: '+45 to maximum Energy Shield', zh: '最大能量护盾 +45' },
    { en: '+45% to Fire Resistance', zh: '火焰抗性 +45%' },
    { en: '+45% to Cold Resistance', zh: '冰霜抗性 +45%' },
    { en: '+45% to Lightning Resistance', zh: '闪电抗性 +45%' },
    { en: '+35% to Chaos Resistance', zh: '混沌抗性 +35%' },
    { en: '+45 to Strength', zh: '力量 +45' },
    { en: '+45 to Dexterity', zh: '敏捷 +45' },
    { en: '+45 to Intelligence', zh: '智慧 +45' },
    { en: '+35% to Global Critical Strike Multiplier', zh: '全局暴击伤害加成 +35%' },
    { en: '18% increased Cast Speed', zh: '施法速度提高 18%' },
    { en: '15% increased Cooldown Recovery Rate', zh: '冷却回复速度提高 15%' },
    { en: '35% increased Elemental Damage with Attack Skills', zh: '攻击技能元素伤害提高 35%' },
    { en: '+1 to Level of all Skill Gems', zh: '所有技能宝石等级 +1' },
    { en: '+25% to Quality of all Skill Gems', zh: '所有技能宝石品质 +25%' },
  ],
};

function getCraftCategoryForSlot(slot: EquipmentSlotId): 'weapon' | 'armour' | 'accessory' {
  if (slot.startsWith('Weapon')) return 'weapon';
  if (slot === 'Helmet' || slot === 'Body Armour' || slot === 'Gloves' || slot === 'Boots') {
    return 'armour';
  }
  return 'accessory';
}

export function ItemsTab() {
  const {
    locale,
    build,
    calc,
    treeRevision,
    addItem,
    equipItem,
    unequipSlot,
    toggleFlaskActive,
    switchItemSet,
    addItemSet,
    deleteItemSet,
  } = useWebPobStore();
  const [pasteText, setPasteText] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlotId>('Weapon 1');
  const [compareSlot, setCompareSlot] = useState<EquipmentSlotId | null>(null);
  const [gearSummaryOpen, setGearSummaryOpen] = useState(false);
  const [uniqueSearch, setUniqueSearch] = useState('');
  const [uniqueSlotFilter, setUniqueSlotFilter] = useState<(typeof UNIQUE_SLOT_FILTERS)[number]>('ALL');
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorSort, setAdvisorSort] = useState<'dps' | 'ehp'>('dps');

  // Rare Item Crafting Bench state
  const [craftOpen, setCraftOpen] = useState(false);
  const [craftBaseSearch, setCraftBaseSearch] = useState('');
  const [craftBaseName, setCraftBaseName] = useState('');
  const [craftQuality, setCraftQuality] = useState(20);
  const [craftAffixes, setCraftAffixes] = useState<string[]>([
    '+105 to maximum Life',
    '+45% to Fire Resistance',
    '+45% to Lightning Resistance',
  ]);

  const ruleset = getRuleset(build.game);
  const presets = getPresetItemsForGame(build.game);

  const officialUniques = useMemo(() => {
    void treeRevision;
    return getUniquesForGame(build.game);
  }, [build.game, treeRevision]);

  const canWield2HIn1H = useMemo(() => {
    void treeRevision;
    return canWieldTwoHandedMartialInOneHand(build);
  }, [build, treeRevision]);

  const cantUseBodyArmour = useMemo(() => hasCantUseBodyArmour(build), [build]);

  const resolveTargetEquipSlot = (
    itemSlotType: EquipmentSlotId | 'Any',
    weaponStats: Item['weaponStats'],
    preferredSlot: EquipmentSlotId,
  ): EquipmentSlotId => {
    if (itemSlotType === 'Any') return preferredSlot;
    if (itemSlotType === 'Weapon 1') {
      if (
        (preferredSlot === 'Weapon 2' || preferredSlot === 'Weapon 2 Swap') &&
        canWieldWeaponInOneHand(weaponStats, canWield2HIn1H)
      ) {
        return preferredSlot;
      }
      if (preferredSlot === 'Weapon 1 Swap') return 'Weapon 1 Swap';
      if (build.game === 'poe2' && build.activeWeaponSet === 2) return 'Weapon 1 Swap';
      return 'Weapon 1';
    }
    if (itemSlotType === 'Weapon 2') {
      if (preferredSlot === 'Weapon 2 Swap') return 'Weapon 2 Swap';
      if (build.game === 'poe2' && build.activeWeaponSet === 2) return 'Weapon 2 Swap';
      return 'Weapon 2';
    }
    if (itemSlotType === 'Ring 1' && (preferredSlot === 'Ring 1' || preferredSlot === 'Ring 2' || preferredSlot === 'Ring 3')) {
      return preferredSlot;
    }
    if (itemSlotType === 'Flask 1' && preferredSlot.startsWith('Flask ')) {
      return preferredSlot;
    }
    if (itemSlotType === 'Charm 1' && preferredSlot.startsWith('Charm ')) {
      return preferredSlot;
    }
    return itemSlotType;
  };

  const filteredUniques = useMemo(() => {
    const q = uniqueSearch.trim().toLowerCase();
    const list: CompactUniqueEntry[] = [];
    for (const u of officialUniques) {
      if (uniqueSlotFilter !== 'ALL' && u.s !== uniqueSlotFilter) {
        const allowWeaponInOffhand =
          uniqueSlotFilter === 'Weapon 2' &&
          u.s === 'Weapon 1' &&
          canWieldWeaponInOneHand(getBaseItemStats(u.b, 0, build.game)?.weapon, canWield2HIn1H);
        if (!allowWeaponInOffhand) continue;
      }
      if (q) {
        const hay = `${u.en} ${u.zh ?? ''} ${u.zhTw ?? ''} ${u.b} ${u.bz ?? ''} ${u.bzTw ?? ''} ${u.e.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      list.push(u);
      if (list.length >= 60) break;
    }
    return list;
  }, [officialUniques, uniqueSearch, uniqueSlotFilter, build.game, canWield2HIn1H]);

  const handleParse = (autoEquip: boolean) => {
    const parsed = parseItemText(pasteText, undefined, build.game);
    if (!parsed) {
      setStatusMsg({ ok: false, text: t(locale, 'items.parseError') });
      return;
    }
    const targetSlot = autoEquip
      ? resolveTargetEquipSlot(parsed.slotType, parsed.weaponStats, selectedSlot)
      : undefined;
    const beforeCalc = calc;
    addItem(parsed, targetSlot);
    if (targetSlot) {
      setSelectedSlot(targetSlot);
    }

    // Count how many item modifiers + base stats actively participate in calculation
    const resolved = resolveItemEffectiveStats(parsed, build.game);
    const totalModLines = parsed.implicits.length + parsed.explicits.length;
    const consumedLocalCount =
      totalModLines - (resolved.globalImplicits.length + resolved.globalExplicits.length);
    const parsedGlobalCount = [...resolved.globalImplicits, ...resolved.globalExplicits].filter(
      (line) => parseModLine(line, 'Check').length > 0,
    ).length;
    const activeModCount = consumedLocalCount + parsedGlobalCount;

    let deltaSummary = '';
    if (targetSlot) {
      const afterCalc = useWebPobStore.getState().calc;
      const parts: string[] = [];
      const dDps = Math.round(afterCalc.offence.totalDps - beforeCalc.offence.totalDps);
      const dLife = Math.round(afterCalc.defence.life - beforeCalc.defence.life);
      const dEs = Math.round(afterCalc.defence.energyShield - beforeCalc.defence.energyShield);
      const dArm = Math.round(afterCalc.defence.armour - beforeCalc.defence.armour);
      const dEva = Math.round(afterCalc.defence.evasion - beforeCalc.defence.evasion);
      const dRes =
        (afterCalc.defence.fireResist - beforeCalc.defence.fireResist) +
        (afterCalc.defence.coldResist - beforeCalc.defence.coldResist) +
        (afterCalc.defence.lightningResist - beforeCalc.defence.lightningResist) +
        (afterCalc.defence.chaosResist - beforeCalc.defence.chaosResist);
      if (dDps !== 0) parts.push(`DPS ${dDps > 0 ? '+' : ''}${dDps.toLocaleString()}`);
      if (dLife !== 0) parts.push(`${uiText(locale, '生命', 'Life')} ${dLife > 0 ? '+' : ''}${dLife}`);
      if (dEs !== 0) parts.push(`${uiText(locale, '护盾', 'ES')} ${dEs > 0 ? '+' : ''}${dEs}`);
      if (dArm !== 0) parts.push(`${uiText(locale, '护甲', 'Armour')} ${dArm > 0 ? '+' : ''}${dArm}`);
      if (dEva !== 0) parts.push(`${uiText(locale, '闪避', 'Evasion')} ${dEva > 0 ? '+' : ''}${dEva}`);
      if (dRes !== 0) parts.push(`${uiText(locale, '抗性', 'Res')} ${dRes > 0 ? '+' : ''}${dRes}%`);
      if (parts.length > 0) {
        deltaSummary = ` · ${parts.join(' / ')}`;
      }
    }
    const modCountNote =
      totalModLines > 0
        ? ` · ${uiText(locale, `词缀已生效 ${activeModCount}/${totalModLines}`, `${activeModCount}/${totalModLines} mods active`)}`
        : '';

    setStatusMsg({
      ok: true,
      text: `${t(locale, 'items.parseSuccess')} (${parsed.name} → ${
        targetSlot ? getSlotLabel(locale, targetSlot) : t(locale, 'items.stash')
      }${modCountNote}${deltaSummary})`,
    });
    setPasteText('');
  };

  const handleEquipUnique = (entry: CompactUniqueEntry, explicitSlot?: EquipmentSlotId) => {
    const item = instantiateUniqueItem(build.game, entry, 20);
    if (entry.s === 'Jewel') {
      addItem(item);
      setStatusMsg({
        ok: true,
        text:
          uiText(locale, `已将传奇珠宝「${entry.zh ?? entry.en}」加入物品栏，可在天赋树点击珠宝插槽镶嵌`, `Added unique jewel "${entry.en}" to stash. Click any allocated Jewel Socket on the Tree to socket it.`),
      });
      return;
    }
    const targetSlot =
      explicitSlot ?? resolveTargetEquipSlot(item.slotType, item.weaponStats, selectedSlot);
    addItem(item, targetSlot);
    equipItem(targetSlot, item.id);
    if (targetSlot.startsWith('Flask ') && !build.activeFlaskSlots?.[targetSlot]) {
      toggleFlaskActive(targetSlot);
    }
    setSelectedSlot(targetSlot);
  };

  const displayUniqueEntryName = (u: CompactUniqueEntry) =>
    locale === 'zh-TW'
      ? u.zhTw || (u.zh ? toTraditionalZh(u.zh) : u.en)
      : locale === 'zh-CN'
        ? u.zh || u.en
        : u.en;

  const displayName = (item: Item) => {
    if (locale === 'en') return item.name;
    if (locale === 'zh-TW') {
      if (item.nameZhTw) return item.nameZhTw;
      const fromOverlay = getLocalizedUniqueName(item.name, 'zh-TW', build.game);
      if (fromOverlay !== item.name) return fromOverlay;
      if (item.nameZh) return toTraditionalZh(item.nameZh);
      return item.name;
    }
    return item.nameZh || item.name;
  };

  const displayBase = (item: Item) => {
    if (locale === 'en') return item.baseName;
    if (locale === 'zh-TW') {
      if (item.baseNameZhTw) return item.baseNameZhTw;
      const fromOverlay = getLocalizedBaseName(item.baseName, 'zh-TW', build.game);
      if (fromOverlay !== item.baseName) return fromOverlay;
      if (item.baseNameZh) return toTraditionalZh(item.baseNameZh);
      return item.baseName;
    }
    return item.baseNameZh || item.baseName;
  };

  const equippedItem = build.equipped[selectedSlot]
    ? build.items[build.equipped[selectedSlot]!]
    : undefined;

  const resolvedEquipped = useMemo(
    () => (equippedItem ? resolveItemEffectiveStats(equippedItem, build.game) : undefined),
    [equippedItem, build.game],
  );

  // Crafting Bench candidates & live simulated ΔDPS / ΔEHP preview
  const craftCategory = getCraftCategoryForSlot(selectedSlot);
  const allBases = useMemo(() => {
    void treeRevision;
    return listBaseItemsForGame(build.game);
  }, [build.game, treeRevision]);

  const craftBases = useMemo(() => {
    const q = craftBaseSearch.trim().toLowerCase();
    return allBases
      .filter(({ name, entry }) => {
        if (craftCategory === 'weapon' && !entry.weapon) return false;
        if (craftCategory === 'armour' && !entry.armour) return false;
        if (q && !name.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, 80);
  }, [allBases, craftCategory, craftBaseSearch]);

  const effectiveCraftBase =
    craftBases.find((b) => b.name === craftBaseName) ?? craftBases[0];

  const craftedDraftItem = useMemo<Item | null>(() => {
    if (!craftOpen) return null;
    const baseName =
      effectiveCraftBase?.name ??
      (craftCategory === 'weapon'
        ? 'Prophecy Wand'
        : craftCategory === 'armour'
          ? 'Vaal Regalia'
          : 'Leather Belt');
    const baseEntry = effectiveCraftBase?.entry;
    return {
      id: '__craft_preview__',
      name: `Crafted ${baseName}`,
      baseName,
      rarity: 'RARE',
      slotType: selectedSlot,
      quality: craftQuality,
      weaponStats: baseEntry?.weapon,
      armourStats: baseEntry?.armour,
      implicits: baseEntry?.implicit ? [baseEntry.implicit] : [],
      explicits: craftAffixes,
      localStatsPrecomputed: false,
    };
  }, [craftOpen, effectiveCraftBase, craftCategory, selectedSlot, craftQuality, craftAffixes]);

  const craftPreviewDelta = useMemo(() => {
    if (!craftedDraftItem) return null;
    const simBuild = {
      ...build,
      items: { ...build.items, [craftedDraftItem.id]: craftedDraftItem },
      equipped: { ...build.equipped, [selectedSlot]: craftedDraftItem.id },
    };
    const nextCalc = calculateBuild(simBuild);
    const resolved = resolveItemEffectiveStats(craftedDraftItem, build.game);
    return {
      resolved,
      dpsDelta: nextCalc.offence.totalDps - calc.offence.totalDps,
      dpsDeltaPct:
        calc.offence.totalDps > 0
          ? ((nextCalc.offence.totalDps - calc.offence.totalDps) / calc.offence.totalDps) * 100
          : 0,
      lifeDelta: nextCalc.defence.life - calc.defence.life,
      esDelta: nextCalc.defence.energyShield - calc.defence.energyShield,
      wardDelta: (nextCalc.defence.ward ?? 0) - (calc.defence.ward ?? 0),
      ehpDelta: nextCalc.defence.effectiveHitPool - calc.defence.effectiveHitPool,
    };
  }, [craftedDraftItem, build, selectedSlot, calc]);

  const rankedUniqueUpgrades = useMemo(() => {
    void treeRevision;
    if (!advisorOpen) return [];
    return rankUniqueUpgradesForSlot(build, selectedSlot, advisorSort, 8);
  }, [advisorOpen, build, selectedSlot, advisorSort, treeRevision]);

  const itemSets = useMemo(
    () =>
      build.itemSets && build.itemSets.length > 0
        ? build.itemSets
        : [{ id: '1', title: uiText(locale, '默认配装', 'Default Set'), equipped: build.equipped, activeFlaskSlots: build.activeFlaskSlots }],
    [build.itemSets, build.equipped, build.activeFlaskSlots, locale],
  );
  const activeItemSetIdx = Math.max(0, Math.min(itemSets.length - 1, build.activeItemSetIndex ?? 0));

  const itemSetBaselineDelta = useMemo(() => {
    if (itemSets.length <= 1 || activeItemSetIdx === 0) return null;
    const baseSet = itemSets[0]!;
    const baseCalc = calculateBuild({
      ...build,
      equipped: baseSet.equipped,
      activeFlaskSlots: baseSet.activeFlaskSlots ?? {},
    });
    const baseDps = baseCalc.offence.fullDps ?? baseCalc.offence.totalDps;
    const curDps = calc.offence.fullDps ?? calc.offence.totalDps;
    const baseEhp = Math.max(1, baseCalc.defence.effectiveHitPool);
    return {
      dpsPct: baseDps > 0 ? ((curDps - baseDps) / baseDps) * 100 : 0,
      ehpPct: ((calc.defence.effectiveHitPool - baseEhp) / baseEhp) * 100,
    };
  }, [itemSets, activeItemSetIdx, build, calc]);

  const trackedSlots = ruleset.equipmentSlots.filter(
    (slot) => !(build.game === 'poe2' && (slot === 'Weapon 1 Swap' || slot === 'Weapon 2 Swap')),
  );
  const equippedCount = trackedSlots.filter((slot) => {
    if (slot.startsWith('Flask ') || slot.startsWith('Charm ')) {
      return Boolean(build.equipped[slot]) && Boolean(build.activeFlaskSlots?.[slot]);
    }
    return Boolean(build.equipped[slot]);
  }).length;

  const equippedFlaskSlots = ruleset.equipmentSlots.filter(
    (slot) => slot.startsWith('Flask ') && Boolean(build.equipped[slot]),
  );
  const allFlasksActive =
    equippedFlaskSlots.length > 0 &&
    equippedFlaskSlots.every((slot) => Boolean(build.activeFlaskSlots?.[slot]));

  const toggleAllFlasks = () => {
    const shouldEnable = !allFlasksActive;
    for (const slot of equippedFlaskSlots) {
      if (Boolean(build.activeFlaskSlots?.[slot]) !== shouldEnable) {
        toggleFlaskActive(slot);
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
      {/* Left: Equipment Slots */}
      <div className="lg:col-span-5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-amber-200">{t(locale, 'items.title')}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setGearSummaryOpen(true)}
              title={uiText(locale, '查看装备汇总与市集搜索', 'View gear stat totals & trade search')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-3 h-3 shrink-0" />
              {uiText(locale, '装备汇总', 'Gear Totals')}
              <span className="font-mono text-[10px] text-emerald-300">
                {equippedCount}/{trackedSlots.length}
              </span>
            </button>
            <select
              value={activeItemSetIdx}
              onChange={(e) => switchItemSet(Number(e.target.value))}
              className="pob-input rounded px-2 py-1 text-xs max-w-[140px]"
              title={uiText(locale, '切换配装方案', 'Switch Item Set')}
            >
              {itemSets.map((s, idx) => (
                <option key={s.id} value={idx}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                addItemSet(
                  uiText(locale, `配装方案 ${itemSets.length + 1}`, `Item Set ${itemSets.length + 1}`),
                  true,
                )
              }
              title={uiText(locale, '复制当前配装为新方案', 'Clone current loadout as new Item Set')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[#161c2b] hover:bg-[#1e263a] border border-[#2a3147] text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Copy className="w-3 h-3 shrink-0" />
              {uiText(locale, '新方案', 'Clone')}
            </button>
            {itemSets.length > 1 && (
              <button
                type="button"
                onClick={() => deleteItemSet(activeItemSetIdx)}
                title={uiText(locale, '删除当前配装方案', 'Delete active Item Set')}
                className="p-1 rounded text-zinc-400 hover:text-rose-400 border border-[#2a3147] cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        {itemSetBaselineDelta && (
          <div className="rounded bg-[#111624] border border-sky-500/30 px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2 font-mono">
            <span className="font-sans text-zinc-400">
              {uiText(locale, `对比「${itemSets[0]!.title}」:`, `vs "${itemSets[0]!.title}":`)}
            </span>
            <span className="flex items-center gap-2">
              <span className={itemSetBaselineDelta.dpsPct >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                DPS {itemSetBaselineDelta.dpsPct >= 0 ? '+' : ''}{itemSetBaselineDelta.dpsPct.toFixed(1)}%
              </span>
              <span className={itemSetBaselineDelta.ehpPct >= 0 ? 'text-sky-300 font-semibold' : 'text-rose-400 font-semibold'}>
                EHP {itemSetBaselineDelta.ehpPct >= 0 ? '+' : ''}{itemSetBaselineDelta.ehpPct.toFixed(1)}%
              </span>
            </span>
          </div>
        )}
        {build.game === 'poe1' && equippedFlaskSlots.length > 0 && (
          <div className="rounded bg-[#111624] border border-[#2a3147] px-2.5 py-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-300" />
              {uiText(locale, `药剂 (${equippedFlaskSlots.filter((slot) => build.activeFlaskSlots?.[slot]).length}/${equippedFlaskSlots.length} 已启用)`, `Flasks (${equippedFlaskSlots.filter((slot) => build.activeFlaskSlots?.[slot]).length}/${equippedFlaskSlots.length} active)`)}
            </span>
            <button
              type="button"
              onClick={toggleAllFlasks}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer transition ${
                allFlasksActive
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-200 hover:bg-rose-500/25'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
              }`}
            >
              {allFlasksActive ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
              {allFlasksActive
                ? uiText(locale, '全部关闭', 'Disable All')
                : uiText(locale, '全部开启', 'Enable All')}
            </button>
          </div>
        )}
        <div className="space-y-1.5">
          {ruleset.equipmentSlots.map((slot) => {
            const itemId = build.equipped[slot];
            const item = itemId ? build.items[itemId] : undefined;
            const isSelected = selectedSlot === slot;
            return (
              <div
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`pob-panel rounded-md px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition ${
                  isSelected ? 'ring-1 ring-amber-500/70 bg-[#191e2c]' : 'hover:bg-[#171b27]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 flex-wrap">
                    <span>{getSlotLabel(locale, slot)}</span>
                    {canWield2HIn1H && (slot === 'Weapon 2' || slot === 'Weapon 2 Swap') && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-200">
                        {uiText(locale, '支持双持双手锤/斧/剑', '2H Martial OK')}
                      </span>
                    )}
                    {cantUseBodyArmour && slot === 'Body Armour' && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/15 border border-rose-500/40 text-rose-300">
                        {uiText(locale, '祭礼之雨已禁用', 'Disabled')}
                      </span>
                    )}
                  </div>
                  {item ? (
                    <div
                      className={`text-xs font-semibold truncate ${RARITY_COLOR[item.rarity].split(' ')[0]} ${
                        cantUseBodyArmour && slot === 'Body Armour' ? 'opacity-50 line-through' : ''
                      }`}
                    >
                      {displayName(item)}{' '}
                      <span className="text-zinc-400 font-normal">({displayBase(item)})</span>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500 italic">{t(locale, 'items.empty')}</div>
                  )}
                </div>
                {item && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSlot(slot);
                        setCompareSlot(slot);
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-500/40 cursor-pointer"
                      title={uiText(locale, '对比 / 编辑该装备', 'Compare / Edit this item')}
                    >
                      <GitCompareArrows className="w-3 h-3" />
                      {uiText(locale, '对比 / 编辑', 'Compare / Edit')}
                    </button>
                    {slot.startsWith('Flask ') && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFlaskActive(slot);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition ${
                          build.activeFlaskSlots?.[slot]
                            ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                            : 'bg-zinc-900/60 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {build.activeFlaskSlots?.[slot]
                          ? uiText(locale, '已启用', 'Active')
                          : uiText(locale, '未启用', 'Off')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        unequipSlot(slot);
                      }}
                      className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                      title={t(locale, 'items.unequip')}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Inspector + Unique Browser + Bilingual Clipboard Parser + Preset Library */}
      <div className="lg:col-span-7 space-y-4">
        {/* Selected Slot Item Tooltip Card */}
        <div className="pob-panel rounded-lg p-4">
          <div className="flex items-center justify-between border-b border-[#252b3d] pb-2 mb-3 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                {getSlotLabel(locale, selectedSlot)}
              </span>
              <button
                type="button"
                onClick={() => setCompareSlot(selectedSlot)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border border-sky-500/40 cursor-pointer"
                title={uiText(locale, '对比 / 编辑该槽位装备', 'Compare / Edit this slot')}
              >
                <GitCompareArrows className="w-3 h-3" />
                {uiText(locale, '对比 / 编辑', 'Compare / Edit')}
              </button>
            </div>
            {equippedItem && (
              <div className="flex items-center gap-2">
                <a
                  href={buildTradeSearchUrl(equippedItem, build.game, locale === 'zh-CN')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/35"
                >
                  <ExternalLink className="w-3 h-3" />
                  {uiText(locale, '市集搜索', 'Trade')}
                </a>
                <span className="text-[11px] font-mono text-zinc-400">
                  Q{equippedItem.quality}%
                </span>
              </div>
            )}
          </div>

          {equippedItem ? (
            <div className={`rounded border p-3 bg-[#0b0d14] space-y-2 ${RARITY_COLOR[equippedItem.rarity]}`}>
              <div>
                <div className="text-sm font-bold">{displayName(equippedItem)}</div>
                <div className="text-xs text-zinc-400">{displayBase(equippedItem)}</div>
              </div>
              {(resolvedEquipped?.armourStats || resolvedEquipped?.weaponStats) && (
                <div className="text-xs text-zinc-300 border-t border-[#232838] pt-2 flex flex-wrap gap-3 font-mono">
                  {resolvedEquipped.armourStats?.armour && <span>Armour: {resolvedEquipped.armourStats.armour}</span>}
                  {resolvedEquipped.armourStats?.evasion && <span>Evasion: {resolvedEquipped.armourStats.evasion}</span>}
                  {resolvedEquipped.armourStats?.energyShield && <span className="text-sky-300">ES: {resolvedEquipped.armourStats.energyShield}</span>}
                  {resolvedEquipped.armourStats?.ward && <span className="text-indigo-300">Ward: {resolvedEquipped.armourStats.ward}</span>}
                  {resolvedEquipped.armourStats?.blockChance && <span>Block: {resolvedEquipped.armourStats.blockChance}%</span>}
                  {resolvedEquipped.weaponStats && (
                    <>
                      <span>Phys: {resolvedEquipped.weaponStats.physicalMin}-{resolvedEquipped.weaponStats.physicalMax}</span>
                      <span>APS: {resolvedEquipped.weaponStats.attacksPerSecond}</span>
                      <span>Crit: {resolvedEquipped.weaponStats.critChance}%</span>
                    </>
                  )}
                </div>
              )}
              {equippedItem.implicits.length > 0 && (
                <div className="border-t border-[#232838] pt-2 space-y-0.5 text-xs text-sky-300">
                  {equippedItem.implicits.map((line, i) => (
                    <div key={i}>{localizeStatLine(line, locale)}</div>
                  ))}
                </div>
              )}
              <div className="border-t border-[#232838] pt-2 space-y-0.5 text-xs text-indigo-200">
                {equippedItem.explicits.map((line, i) => (
                  <div key={i}>{localizeStatLine(line, locale)}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-500 py-4 text-center">{t(locale, 'items.empty')}</div>
          )}
        </div>

        {/* Interactive Rare Item Crafting Bench (with Live ΔDPS / ΔEHP Upgrade Preview) */}
        <div className="pob-panel rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-yellow-300 flex items-center gap-1.5">
              <Hammer className="w-4 h-4" />
              {uiText(locale, `稀有装备制作台 — ${getSlotLabel(locale, selectedSlot)} (${allBases.length} 官方基底)`, `Rare Item Crafting Bench — ${getSlotLabel(locale, selectedSlot)} (${allBases.length} bases)`)}
            </h3>
            <button
              type="button"
              onClick={() => {
                setCraftOpen((v) => !v);
                const cat = getCraftCategoryForSlot(selectedSlot);
                if (!craftOpen) {
                  setCraftAffixes(
                    cat === 'weapon'
                      ? ['150% increased Physical Damage', 'Adds 25 to 45 Physical Damage', '20% increased Attack Speed']
                      : ['+105 to maximum Life', '+45% to Fire Resistance', '+45% to Lightning Resistance'],
                  );
                }
              }}
              className="px-2.5 py-1 rounded text-xs font-semibold bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-200 border border-yellow-500/40 cursor-pointer"
            >
              {craftOpen
                ? uiText(locale, '收起制作台', 'Hide Bench')
                : uiText(locale, '打开制作台', 'Open Craft Bench')}
            </button>
          </div>

          {craftOpen && (
            <div className="space-y-3 text-xs pt-1 border-t border-[#242a3c]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={craftBaseSearch}
                  onChange={(e) => setCraftBaseSearch(e.target.value)}
                  placeholder={uiText(locale, '搜索基底 (如 Vaal / Runic)...', 'Filter base item...')}
                  className="pob-input rounded px-2 py-1 text-xs"
                />
                <select
                  value={effectiveCraftBase?.name ?? ''}
                  onChange={(e) => setCraftBaseName(e.target.value)}
                  className="pob-input rounded px-2 py-1 text-xs"
                >
                  {craftBases.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#0c0e15] border border-[#22283a]">
                  <span className="text-zinc-400">{uiText(locale, '品质', 'Quality')}</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={craftQuality}
                    onChange={(e) => setCraftQuality(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                    className="pob-input rounded w-14 px-1.5 py-0.5 text-center font-mono"
                  />
                </label>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">
                  {uiText(locale, `点选词缀 (${craftAffixes.length}/6):`, `Toggle T1/T2 Affixes (${craftAffixes.length}/6):`)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CRAFT_AFFIX_POOL[craftCategory].map((affix) => {
                    const active = craftAffixes.includes(affix.en);
                    return (
                      <button
                        key={affix.en}
                        type="button"
                        onClick={() =>
                          setCraftAffixes((prev) =>
                            prev.includes(affix.en)
                              ? prev.filter((x) => x !== affix.en)
                              : prev.length < 6
                                ? [...prev, affix.en]
                                : prev,
                          )
                        }
                        className={`px-2 py-1 rounded border text-[11px] cursor-pointer transition ${
                          active
                            ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-200 font-semibold'
                            : 'bg-[#0e111a] border-[#252c40] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {uiText(locale, affix.zh, affix.en)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {craftPreviewDelta && (
                <div className="rounded bg-[#0a0d14] border border-yellow-500/30 p-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                    <span className={craftPreviewDelta.dpsDelta >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                      ΔDPS: {craftPreviewDelta.dpsDelta >= 0 ? '+' : ''}
                      {Math.round(craftPreviewDelta.dpsDelta).toLocaleString()} (
                      {craftPreviewDelta.dpsDeltaPct >= 0 ? '+' : ''}
                      {craftPreviewDelta.dpsDeltaPct.toFixed(1)}%)
                    </span>
                    <span className={craftPreviewDelta.lifeDelta >= 0 ? 'text-emerald-300' : 'text-rose-400'}>
                      ΔLife: {craftPreviewDelta.lifeDelta >= 0 ? '+' : ''}{craftPreviewDelta.lifeDelta}
                    </span>
                    <span className={craftPreviewDelta.esDelta >= 0 ? 'text-sky-300' : 'text-rose-400'}>
                      ΔES: {craftPreviewDelta.esDelta >= 0 ? '+' : ''}{craftPreviewDelta.esDelta}
                    </span>
                    {craftPreviewDelta.wardDelta !== 0 && (
                      <span className="text-indigo-300">
                        ΔWard: {craftPreviewDelta.wardDelta >= 0 ? '+' : ''}{craftPreviewDelta.wardDelta}
                      </span>
                    )}
                    <span className={craftPreviewDelta.ehpDelta >= 0 ? 'text-emerald-300' : 'text-rose-400'}>
                      ΔEHP: {craftPreviewDelta.ehpDelta >= 0 ? '+' : ''}{Math.round(craftPreviewDelta.ehpDelta).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!craftedDraftItem) return;
                      const finalItem: Item = {
                        ...craftedDraftItem,
                        id: `craft_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                      };
                      addItem(finalItem, selectedSlot);
                      equipItem(selectedSlot, finalItem.id);
                      setStatusMsg({
                        ok: true,
                        text:
                          uiText(locale, `已制作并装备 ${finalItem.name} → ${getSlotLabel(locale, selectedSlot)}`, `Crafted & equipped ${finalItem.name} → ${getSlotLabel(locale, selectedSlot)}`),
                      });
                    }}
                    className="px-3 py-1 rounded text-xs font-semibold bg-yellow-500/25 hover:bg-yellow-500/35 text-yellow-200 border border-yellow-400/60 cursor-pointer"
                  >
                    {uiText(locale, '制作并装备', 'Craft & Equip')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Smart Unique Upgrade Advisor (live DPS/EHP ranking for selected slot) */}
        <div className="pob-panel rounded-lg p-4 space-y-3 border-emerald-500/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" />
              {uiText(locale, `暗金升级推荐 — ${getSlotLabel(locale, selectedSlot)}`, `Unique Upgrade Advisor — ${getSlotLabel(locale, selectedSlot)}`)}
            </h3>
            <div className="flex items-center gap-1.5">
              {advisorOpen && (
                <div className="flex items-center rounded bg-[#0c0f18] border border-[#252c40] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setAdvisorSort('dps')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      advisorSort === 'dps'
                        ? 'bg-orange-500/25 text-orange-200 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {uiText(locale, '按 DPS', 'By DPS')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvisorSort('ehp')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      advisorSort === 'ehp'
                        ? 'bg-sky-500/25 text-sky-200 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {uiText(locale, '按 EHP', 'By EHP')}
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setAdvisorOpen((v) => !v)}
                className={`px-2.5 py-1 rounded text-xs font-semibold border cursor-pointer transition ${
                  advisorOpen
                    ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200'
                    : 'bg-[#161c2b] hover:bg-[#1e263a] border-emerald-500/40 text-emerald-300'
                }`}
              >
                {advisorOpen
                  ? uiText(locale, '收起推荐', 'Hide Advisor')
                  : uiText(locale, '计算最优暗金', 'Rank Best Uniques')}
              </button>
            </div>
          </div>

          {advisorOpen && (
            rankedUniqueUpgrades.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">
                {uiText(locale, '当前部位暂未发现更高收益的官方传奇暗金（或该部位当前已装备毕业装）。', 'No higher-value official Unique found for this slot.')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {rankedUniqueUpgrades.map((rec) => (
                  <div
                    key={rec.unique.en}
                    className="rounded border border-emerald-500/30 bg-[#0c0e15] p-2.5 flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-orange-300 truncate">
                          {displayUniqueEntryName(rec.unique)}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">
                          {locale === 'zh-TW'
                            ? rec.unique.bzTw || (rec.unique.bz ? toTraditionalZh(rec.unique.bz) : rec.unique.b)
                            : locale === 'zh-CN' && rec.unique.bz
                              ? rec.unique.bz
                              : rec.unique.b}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const fresh = instantiateUniqueItem(build.game, rec.unique);
                          addItem(fresh, selectedSlot);
                          equipItem(selectedSlot, fresh.id);
                          if (selectedSlot.startsWith('Flask ') && !build.activeFlaskSlots?.[selectedSlot]) {
                            toggleFlaskActive(selectedSlot);
                          }
                          setStatusMsg({
                            ok: true,
                            text:
                              uiText(locale, `已穿戴推荐暗金 ${fresh.nameZh ?? fresh.name} → ${getSlotLabel(locale, selectedSlot)}`, `Equipped ${fresh.name} → ${getSlotLabel(locale, selectedSlot)}`),
                          });
                        }}
                        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-400/50 shrink-0 cursor-pointer"
                      >
                        {uiText(locale, '立即穿戴', 'Equip')}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                      <span className={rec.dpsDelta >= 0 ? 'text-orange-300 font-bold' : 'text-rose-400'}>
                        ΔDPS {rec.dpsDeltaPct >= 0 ? '+' : ''}{rec.dpsDeltaPct.toFixed(1)}%
                      </span>
                      <span className={rec.ehpDelta >= 0 ? 'text-sky-300 font-bold' : 'text-rose-400'}>
                        ΔEHP {rec.ehpDeltaPct >= 0 ? '+' : ''}{rec.ehpDeltaPct.toFixed(1)}%
                      </span>
                      {rec.lifeDelta !== 0 && (
                        <span className={rec.lifeDelta > 0 ? 'text-emerald-300' : 'text-rose-400'}>
                          Life {rec.lifeDelta > 0 ? '+' : ''}{rec.lifeDelta}
                        </span>
                      )}
                      {rec.esDelta !== 0 && (
                        <span className={rec.esDelta > 0 ? 'text-sky-300' : 'text-rose-400'}>
                          ES {rec.esDelta > 0 ? '+' : ''}{rec.esDelta}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Official Bilingual Unique Item Browser (1,304 PoE 1 / 427 PoE 2 Uniques) */}
        <div className="pob-panel rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-orange-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              {uiText(locale, `官方传奇暗金库 (${officialUniques.length} 件)`, `Official Unique Database (${officialUniques.length} items)`)}
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={uniqueSearch}
                  onChange={(e) => setUniqueSearch(e.target.value)}
                  placeholder={uiText(locale, '搜暗金名/词缀 (如 猎首 / 薛朗)...', 'Search unique or mod...')}
                  className="pob-input rounded pl-7 pr-2 py-1 text-xs w-52"
                />
              </div>
              <select
                value={uniqueSlotFilter}
                onChange={(e) => setUniqueSlotFilter(e.target.value as (typeof UNIQUE_SLOT_FILTERS)[number])}
                className="pob-input rounded px-2 py-1 text-xs"
              >
                {UNIQUE_SLOT_FILTERS.map((sf) => (
                  <option key={sf} value={sf}>
                    {sf === 'ALL'
                      ? uiText(locale, '全部部位', 'All Slots')
                      : sf === 'Jewel'
                        ? uiText(locale, '珠宝', 'Jewel')
                        : getSlotLabel(locale, sf)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 pr-1">
            {filteredUniques.map((u) => (
              <div
                key={`${u.en}_${u.b}`}
                className="rounded bg-[#0c0e15] border border-orange-500/25 hover:border-orange-400/50 p-2.5 flex flex-col justify-between gap-1.5 text-xs transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-orange-300 truncate">
                      {displayUniqueEntryName(u)}
                    </div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      {locale === 'zh-TW' && (u.bzTw || u.bz)
                        ? `${u.bzTw || toTraditionalZh(u.bz!)} (${u.en})`
                        : locale === 'zh-CN' && u.bz
                          ? `${u.bz} (${u.en})`
                          : u.b}{' '}
                      ·{' '}
                      {u.s === 'Jewel'
                        ? uiText(locale, '珠宝', 'Jewel')
                        : getSlotLabel(locale, u.s as EquipmentSlotId)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEquipUnique(u)}
                      className="px-2 py-0.5 rounded text-[11px] bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/40 shrink-0 cursor-pointer"
                    >
                      {u.s === 'Jewel'
                        ? uiText(locale, '添加', 'Add')
                        : t(locale, 'items.equip')}
                    </button>
                    {u.s === 'Weapon 1' &&
                      canWieldWeaponInOneHand(getBaseItemStats(u.b, 0, build.game)?.weapon, canWield2HIn1H) && (
                        <button
                          type="button"
                          onClick={() =>
                            handleEquipUnique(
                              u,
                              build.game === 'poe2' && build.activeWeaponSet === 2 ? 'Weapon 2 Swap' : 'Weapon 2',
                            )
                          }
                          className="px-1.5 py-0.5 rounded text-[11px] bg-amber-500/15 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 shrink-0 cursor-pointer"
                          title={uiText(locale, '装备到副手（支持双持）', 'Equip to Offhand (Dual Wield)')}
                        >
                          {uiText(locale, '副手', 'Off')}
                        </button>
                      )}
                  </div>
                </div>
                {u.e.length > 0 && (
                  <div className="text-[10px] text-indigo-200/80 line-clamp-2 leading-tight">
                    {u.e.slice(0, 2).map((line) => localizeStatLine(line, locale)).join(' · ')}
                  </div>
                )}
              </div>
            ))}
            {filteredUniques.length === 0 && (
              <div className="col-span-2 text-center text-xs text-zinc-500 py-4">
                {uiText(locale, '未找到匹配的传奇装备', 'No matching unique items found')}
              </div>
            )}
          </div>
        </div>

        {/* Bilingual Ctrl+C Item Text Parser */}
        <div className="pob-panel rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
              <ClipboardPaste className="w-4 h-4" />
              {t(locale, 'items.pasteTitle')}
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPasteText(EXAMPLE_ZH_ITEM)}
                className="px-2 py-1 rounded text-[11px] bg-[#1a1f2e] hover:bg-[#232a3e] text-amber-200 border border-[#2c3348] cursor-pointer"
              >
                {t(locale, 'items.loadExampleZh')}
              </button>
              <button
                type="button"
                onClick={() => setPasteText(EXAMPLE_EN_ITEM)}
                className="px-2 py-1 rounded text-[11px] bg-[#1a1f2e] hover:bg-[#232a3e] text-sky-200 border border-[#2c3348] cursor-pointer"
              >
                {t(locale, 'items.loadExampleEn')}
              </button>
            </div>
          </div>

          <textarea
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={t(locale, 'items.pastePlaceholder')}
            className="pob-input w-full rounded p-2.5 text-xs font-mono"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs">
              {statusMsg && (
                <span className={statusMsg.ok ? 'text-emerald-400' : 'text-rose-400'}>
                  {statusMsg.text}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleParse(false)}
                className="px-3 py-1.5 rounded text-xs bg-[#1b2030] hover:bg-[#252c40] text-zinc-200 border border-[#2e364d] cursor-pointer"
              >
                {t(locale, 'items.parseOnly')}
              </button>
              <button
                type="button"
                onClick={() => handleParse(true)}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-500/25 hover:bg-amber-500/35 text-amber-200 border border-amber-500/50 cursor-pointer"
              >
                {t(locale, 'items.parseAndEquip')}
              </button>
            </div>
          </div>
        </div>

        {/* Starter Preset Library */}
        <div className="pob-panel rounded-lg p-4 space-y-2.5">
          <h3 className="text-xs font-bold text-amber-200">{t(locale, 'items.presetLibrary')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {presets.map((item) => (
              <div
                key={item.id}
                className="rounded bg-[#0c0e15] border border-[#22283a] p-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className={`font-semibold truncate ${RARITY_COLOR[item.rarity].split(' ')[0]}`}>
                    {displayName(item)}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate">
                    {displayBase(item)} · {item.slotType !== 'Any' ? getSlotLabel(locale, item.slotType) : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const slot = resolveTargetEquipSlot(item.slotType, item.weaponStats, selectedSlot);
                    addItem(item, slot);
                    equipItem(slot, item.id);
                  }}
                  className="px-2 py-1 rounded text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/35 shrink-0 cursor-pointer"
                >
                  {t(locale, 'items.equip')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {compareSlot && (
        <ItemCompareModal
          open={compareSlot !== null}
          slot={compareSlot}
          onClose={() => setCompareSlot(null)}
        />
      )}

      <GearSummaryDrawer
        open={gearSummaryOpen}
        onClose={() => setGearSummaryOpen(false)}
        selectedSlot={selectedSlot}
        onSelectSlot={setSelectedSlot}
      />
    </div>
  );
}
