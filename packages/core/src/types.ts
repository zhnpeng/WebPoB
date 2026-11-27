export type GameId = 'poe1' | 'poe2';

export type Locale = 'zh-CN' | 'zh-TW' | 'en';

export interface LocalizedText {
  en: string;
  zh: string;
  /** Official International Traditional Chinese (繁體中文 · 國際服) label when available. */
  zhTw?: string;
}

export type DamageType = 'Physical' | 'Lightning' | 'Cold' | 'Fire' | 'Chaos';

export const DAMAGE_TYPES: readonly DamageType[] = [
  'Physical',
  'Lightning',
  'Cold',
  'Fire',
  'Chaos',
] as const;

export type AttributeType = 'Str' | 'Dex' | 'Int';

export type ItemRarity = 'NORMAL' | 'MAGIC' | 'RARE' | 'UNIQUE';

export type WeaponSetId = 1 | 2;

/**
 * Equipment slot identifiers covering both PoE 1 and PoE 2.
 * GameRuleset.slots determines which slots are active for a given game.
 */
export type EquipmentSlotId =
  | 'Weapon 1'
  | 'Weapon 2'
  | 'Weapon 1 Swap'
  | 'Weapon 2 Swap'
  | 'Helmet'
  | 'Body Armour'
  | 'Gloves'
  | 'Boots'
  | 'Amulet'
  | 'Ring 1'
  | 'Ring 2'
  | 'Belt'
  | 'Flask 1'
  | 'Flask 2'
  | 'Flask 3'
  | 'Flask 4'
  | 'Flask 5'
  | 'Charm 1'
  | 'Charm 2'
  | 'Charm 3';

export type ModType = 'BASE' | 'INC' | 'MORE' | 'OVERRIDE' | 'FLAG' | 'LIST';

/**
 * Bitmask flags matching Path of Building's ModFlag taxonomy.
 */
export const ModFlag = {
  None: 0,
  Attack: 1 << 0,
  Spell: 1 << 1,
  Hit: 1 << 2,
  Dot: 1 << 3,
  Cast: 1 << 4,
  Melee: 1 << 5,
  Area: 1 << 6,
  Projectile: 1 << 7,
  Ailment: 1 << 8,
  Weapon1H: 1 << 9,
  Weapon2H: 1 << 10,
  WeaponRanged: 1 << 11,
  Bow: 1 << 12,
  Wand: 1 << 13,
  Sword: 1 << 14,
  Axe: 1 << 15,
  Mace: 1 << 16,
  Staff: 1 << 17,
  Dagger: 1 << 18,
  Claw: 1 << 19,
  Crossbow: 1 << 20,
  Quarterstaff: 1 << 21,
} as const;

export const KeywordFlag = {
  None: 0,
  Aura: 1 << 0,
  Curse: 1 << 1,
  Warcry: 1 << 2,
  Movement: 1 << 3,
  Fire: 1 << 4,
  Cold: 1 << 5,
  Lightning: 1 << 6,
  Chaos: 1 << 7,
  Physical: 1 << 8,
  Minion: 1 << 9,
  Totem: 1 << 10,
  Trap: 1 << 11,
  Mine: 1 << 12,
  Attack: 1 << 13,
  Spell: 1 << 14,
  Hit: 1 << 15,
  Ailment: 1 << 16,
  Ignite: 1 << 17,
  Bleed: 1 << 18,
  Poison: 1 << 19,
  Spirit: 1 << 20,
} as const;

export interface ModCondition {
  type: 'Condition' | 'Multiplier' | 'StatThreshold';
  var: string;
  neg?: boolean;
  threshold?: number;
}

export interface Mod {
  name: string;
  type: ModType;
  value: number | boolean | string;
  flags: number;
  keywordFlags: number;
  source: string;
  condition?: ModCondition;
}

export type PassiveNodeKind = 'start' | 'small' | 'notable' | 'keystone' | 'mastery' | 'jewel';

export interface MasteryEffect {
  id: number;
  stats: string[];
  statsZh?: string[];
  statsZhTw?: string[];
}

export interface PassiveNode {
  id: number;
  name: LocalizedText;
  kind: PassiveNodeKind;
  x: number;
  y: number;
  /** Group center ID for orbit arc rendering. */
  group?: number;
  orbit?: number;
  orbitRadius?: number;
  angle?: number;
  /** Canonical English stat lines (fed to ModParser). */
  stats: string[];
  /** Optional localized display stat lines for Simplified Chinese UI (CN). */
  statsZh?: string[];
  /** Optional localized display stat lines for Official Traditional Chinese UI (International). */
  statsZhTw?: string[];
  /** Adjacent node IDs in the undirected passive graph. */
  adjacent: number[];
  /** If this is a class start node, the class ID it belongs to. */
  classStartId?: string;
  /** Optional ascendancy ID if this node belongs to an ascendancy sub-tree. */
  ascendancyId?: string;
  /** Mastery effect choices for PoE 1 mastery nodes. */
  masteryEffects?: MasteryEffect[];
  /** Optional icon tag for canvas badge rendering. */
  iconTag?: string;
}

export interface PassiveTreeData {
  game: GameId;
  version: string;
  isOfficialFull?: boolean;
  bounds?: { minX: number; maxX: number; minY: number; maxY: number };
  groups?: Record<number, { x: number; y: number }>;
  nodes: Record<number, PassiveNode>;
  classStartNodeIds: Record<string, number>;
}

export interface CharacterClassDef {
  id: string;
  name: LocalizedText;
  baseStr: number;
  baseDex: number;
  baseInt: number;
  ascendancies: Array<{
    id: string;
    name: LocalizedText;
    summary: LocalizedText;
  }>;
}

export type SkillCategory = 'active' | 'support';

export interface GemDefinition {
  id: string;
  name: LocalizedText;
  category: SkillCategory;
  game: GameId;
  color: 'red' | 'green' | 'blue' | 'white';
  tags: string[];
  modFlags: number;
  keywordFlags: number;
  /** For active skills: base damage by type at level 20 (scales with gem level). */
  baseDamage?: Partial<Record<DamageType, [number, number]>>;
  /** For attack skills: weapon damage multiplier as percentage (e.g., 165 = 165% of base). */
  attackDamageMultiplierPct?: number;
  /** Added damage effectiveness as percentage (e.g., 120 = 120%). */
  damageEffectivenessPct?: number;
  /** Base cast time in seconds (for spells) or attack speed multiplier (for attacks). */
  castTime?: number;
  attackSpeedMultiplier?: number;
  /** Base skill cooldown in seconds (e.g., 5s for PoE 2 Explosive Grenade). */
  cooldown?: number;
  /** Inherent hit multiplier per use (e.g., 2 for Double Strike / Dual Strike). */
  dpsMultiplier?: number;
  /** Base critical strike chance percentage (e.g., 6 for spells, 0 for weapon-based attacks). */
  baseCritChance?: number;
  /** Mana cost at level 20. */
  manaCost?: number;
  /** Spirit reservation (PoE 2 persistent skills / auras). */
  spiritReservation?: number;
  /** Mana reservation percentage (PoE 1 auras). */
  manaReservationPct?: number;
  /** Flat mana reservation (PoE 1 Precision / Clarity / Vitality). */
  manaReservationFlat?: number;
  /** Canonical stat lines granted by this gem (or support gem) to supported skill / player. */
  stats: string[];
  statsZh?: string[];
  statsZhTw?: string[];
  /** Official per-quality stat lines (substituted with Math.trunc(quality * perQuality)). */
  qualityStats?: Array<{ template: string; perQuality: number }>;
  /** Exact per-level scaling table (1..30) synced from official PoB Lua data when available. */
  levelScaling?: Record<
    number,
    {
      baseDamage?: Partial<Record<DamageType, [number, number]>>;
      attackDamageMultiplierPct?: number;
      damageEffectivenessPct?: number;
      manaCost?: number;
      stats?: string[];
    }
  >;
  /** Whether stats apply globally (auras/buffs) vs only to the skill group. */
  isAuraOrBuff?: boolean;
  /** Optional Lv.20 Minion combat profile for Minion-summoning active skills (SRS / Skeletons / Zombies). */
  minionBase?: {
    physicalMin: number;
    physicalMax: number;
    attacksPerSecond: number;
    critChance: number;
    critMultiplier: number;
    moreAttackSpeedPct?: number;
  };
}

export interface GemInstance {
  instanceId: string;
  gemId: string;
  level: number;
  quality: number;
  enabled: boolean;
  /** Number of active instances for Full DPS (e.g. 20 SRS minions, 4 Spell Totems). Defaults to 1. */
  count?: number;
  /** Optional explicit Spirit reservation override (e.g. 0 for Sceptre-granted PoE 2 auras). */
  spiritReservationOverride?: number;
}

export interface SkillGroup {
  id: string;
  label: string;
  enabled: boolean;
  /** Whether this skill group is included in PoB's multi-skill Full DPS aggregation. */
  includeInFullDps?: boolean;
  /** PoE 1: item slot holding this linked group (e.g. 'Body Armour'). PoE 2: optional/empty. */
  slot?: EquipmentSlotId;
  /** PoE 2: which weapon set(s) this skill is enabled for. */
  weaponSets?: WeaponSetId[];
  /** 1-based index of the selected active gem within this group (PoB `mainActiveSkill`). */
  mainActiveSkillIndex?: number;
  gems: GemInstance[];
}

export interface WeaponBaseStats {
  physicalMin: number;
  physicalMax: number;
  elementalDamage?: Partial<Record<'Fire' | 'Cold' | 'Lightning' | 'Chaos', [number, number]>>;
  attacksPerSecond: number;
  critChance: number;
  weaponType: 'Sword' | 'Axe' | 'Mace' | 'Bow' | 'Wand' | 'Staff' | 'Dagger' | 'Claw' | 'Crossbow' | 'Quarterstaff';
  twoHanded: boolean;
}

export interface ArmourBaseStats {
  armour?: number;
  evasion?: number;
  energyShield?: number;
  blockChance?: number;
  ward?: number;
}

export interface Item {
  id: string;
  name: string;
  nameZh?: string;
  nameZhTw?: string;
  baseName: string;
  baseNameZh?: string;
  baseNameZhTw?: string;
  rarity: ItemRarity;
  slotType: EquipmentSlotId | 'Any';
  quality: number;
  sockets?: string;
  levelReq?: number;
  weaponStats?: WeaponBaseStats;
  armourStats?: ArmourBaseStats;
  /** Canonical English implicit mod lines. */
  implicits: string[];
  /** Canonical English explicit mod lines. */
  explicits: string[];
  /** Optional raw source text (EN or ZH) preserved for tooltip/export. */
  rawText?: string;
  /** Whether the item is Corrupted (or Twice Corrupted in PoE 2). */
  corrupted?: boolean;
  /** Selected unique variant index (PoB `<Item variant="N">` / `Selected Variant: N`). */
  variant?: number;
  /** Selected unique variant index when specified in PoB item text (`Selected Variant: N`). */
  selectedVariant?: number;
  /**
   * Whether `armourStats` / `weaponStats` already include local modifiers & quality
   * (true for in-game Ctrl+C clipboard text; false for PoB XML `<Item>` & Unique catalog).
   */
  localStatsPrecomputed?: boolean;
}

export interface BuildConfig {
  enemyLevel: number;
  enemyIsBoss: 'None' | 'Guardian' | 'Pinnacle';
  enemyFireResist: number;
  enemyColdResist: number;
  enemyLightningResist: number;
  enemyChaosResist: number;
  enemyArmour: number;
  enemyEvasion: number;
  usePowerCharges: boolean;
  powerCharges: number;
  useFrenzyCharges: boolean;
  frenzyCharges: number;
  useEnduranceCharges: boolean;
  enduranceCharges: number;
  onslaught: boolean;
  enemyShocked: boolean;
  shockValue: number;
  enemyChilled: boolean;
  /** Endgame combat conditions (matching official PoB ConfigOptions). */
  conditionLowLife?: boolean;
  conditionFullLife?: boolean;
  buffArcaneSurge?: boolean;
  buffTailwind?: boolean;
  enemyIntimidated?: boolean;
  enemyUnnerved?: boolean;
  witheredStacks?: number;
  enemyFireExposure?: boolean;
  enemyColdExposure?: boolean;
  enemyLightningExposure?: boolean;
  /** Current Rage stacks (0–30 base cap; 1% more Attack Damage per Rage in PoE 1 3.30 & PoE 2 0.5). */
  rage?: number;
  /** Fortification buff (PoE 1: 1% less Damage taken from Hits per stack, default 20). */
  fortified?: boolean;
  fortificationStacks?: number;
  /** Enemy is Blinded (20% less Enemy Accuracy, increasing Evade Chance). */
  enemyBlinded?: boolean;
  /** Enemy is Taunted (activates Worthy Foe / Taunt modifiers). */
  enemyTaunted?: boolean;
  /** Active guard skill (PoE 1 guard gem). */
  activeGuardSkill?: 'None' | 'MoltenShell' | 'Steelskin' | 'ArcaneCloak';
  /** PoE 1 Pantheon major god. */
  pantheonMajor?: 'None' | 'BrineKing' | 'Lunaris' | 'Solaris' | 'Arakaali';
  /** PoE 1 Pantheon minor god. */
  pantheonMinor?: 'None' | 'Abberath' | 'Gruthkul' | 'Ralakesh' | 'Shakari' | 'Tukohama' | 'Garukhan';
  /** Free-form custom modifiers (supports both English and Chinese lines!). */
  customMods: string;
}

export interface TreeSpec {
  title: string;
  treeVersion: string;
  /** Allocated shared passive node IDs. */
  allocatedNodeIds: number[];
  /** PoE 2: Weapon Set 1 exclusive passive node IDs. */
  weaponSet1NodeIds: number[];
  /** PoE 2: Weapon Set 2 exclusive passive node IDs. */
  weaponSet2NodeIds: number[];
  /** Selected mastery effects: nodeId -> effectId/stat line. */
  masteryEffects: Record<number, string>;
  /** Passive tree jewel sockets: jewelNodeId -> itemId in `build.items`. */
  socketedJewels?: Record<number, string>;
  /** PoE 2: Chosen attribute overrides on "+5 to any Attribute" travel nodes. */
  attributeOverrides?: Record<number, 'str' | 'dex' | 'int'>;
  /** PoE 1: Tattoo / Runegraft passive node overrides (`<Overrides><Override nodeId="..." dn="...">`). */
  nodeOverrides?: Record<number, { name?: string; stats: string[] }>;
}

export interface ItemSetSpec {
  id: string;
  title: string;
  equipped: Partial<Record<EquipmentSlotId, string>>;
  activeFlaskSlots?: Partial<Record<EquipmentSlotId, boolean>>;
}

export interface SkillSetSpec {
  id: string;
  title: string;
  skills: SkillGroup[];
  mainSkillGroupId: string;
}

export interface Build {
  id: string;
  name: string;
  game: GameId;
  level: number;
  classId: string;
  ascendancyId: string;
  /** Active weapon set for calculation (especially meaningful in PoE 2). */
  activeWeaponSet: WeaponSetId;
  tree: TreeSpec;
  /** Optional multi-spec passive trees (PoB `<Tree activeSpec="N">` `<Spec>` list). Active spec stays synced with `tree`. */
  treeSpecs?: TreeSpec[];
  activeTreeSpecIndex?: number;
  skills: SkillGroup[];
  mainSkillGroupId: string;
  /** Optional multi-skill loadout sets (PoB `<Skills activeSkillSet="N">` `<SkillSet>` list). Active set stays synced with `skills`. */
  skillSets?: SkillSetSpec[];
  activeSkillSetIndex?: number;
  items: Record<string, Item>;
  equipped: Partial<Record<EquipmentSlotId, string>>;
  /** Which Flask slots are currently active in calculations (matches PoB `<Slot active="true">`). */
  activeFlaskSlots?: Partial<Record<EquipmentSlotId, boolean>>;
  /** Optional multi-item equipment sets (PoB `<Items activeItemSet="N">` `<ItemSet>` list). Active set stays synced with `equipped`. */
  itemSets?: ItemSetSpec[];
  activeItemSetIndex?: number;
  config: BuildConfig;
  notes: string;
  /** Bandits (PoE 1) or Campaign Buffs. */
  bandit?: 'None' | 'Alira' | 'Kraityn' | 'Oak';
}

export interface GameRuleset {
  game: GameId;
  displayName: LocalizedText;
  maxLevel: number;
  baseLife: number;
  lifePerLevel: number;
  campaignLifeFlat: number;
  campaignLifeIncPct: number;
  baseMana: number;
  manaPerLevel: number;
  campaignManaIncPct: number;
  /** PoE 2 has Spirit; PoE 1 = 0. */
  baseSpirit: number;
  baseEvasion: number;
  accuracyPerLevel: number;
  maxBlockChance: number;
  supportsSpirit: boolean;
  supportsWeaponSetPassives: boolean;
  supportsSpellSuppression: boolean;
  /** Life gained per point of Strength. */
  lifePerStrength: number;
  /** Melee physical damage % inc per point of Strength (0.2 in PoE 1, 0 in PoE 2). */
  meleePhysPctPerStrength: number;
  /** Accuracy gained per point of Dexterity. */
  accuracyPerDexterity: number;
  /** Evasion % inc per point of Dexterity (0.2 in PoE 1, 0 in PoE 2). */
  evasionPctPerDexterity: number;
  /** Mana gained per point of Intelligence. */
  manaPerIntelligence: number;
  /** ES % inc per point of Intelligence (0.2 in PoE 1, 0 in PoE 2). */
  esPctPerIntelligence: number;
  /** Default resistance cap (75). */
  defaultMaxResist: number;
  /** Endgame campaign resistance penalty (-60 in PoE 1, -50 in PoE 2). */
  endgameResistPenalty: number;
  /** Chaos resistance penalty (-60 in PoE 1, 0 in PoE 2). */
  endgameChaosResistPenalty: number;
  /** Default non-boss enemy elemental resistance (0 in PoE 1, 50 in PoE 2). */
  defaultEnemyEleResist: number;
  /** Armour mitigation denominator multiplier (5 in PoE 1, 12 in PoE 2). */
  armourFormulaFactor: number;
  /** Default critical strike multiplier percentage (150 in PoE 1, 200 in PoE 2). */
  baseCritMultiplier: number;
  /** Active equipment slots for this game. */
  equipmentSlots: EquipmentSlotId[];
}

export interface StatBreakdownRow {
  label: string;
  labelZh: string;
  labelZhTw?: string;
  base: number;
  incPct: number;
  moreMultiplier: number;
  total: number;
  sources: Array<{ source: string; type: ModType; value: number | string }>;
}

export interface DamageRange {
  min: number;
  max: number;
  average: number;
}

export interface CalcOffenceOutput {
  mainSkillName: LocalizedText;
  mainSkillLevel?: number;
  mainSkillBaseLevel?: number;
  mainSkillQuality?: number;
  skillType: 'Attack' | 'Spell' | 'None';
  damageByType: Record<DamageType, DamageRange>;
  averageHit: number;
  speed: number;
  critChance: number;
  critMultiplier: number;
  hitChance: number;
  effectiveCritMultiplier: number;
  hitDps: number;
  impaleDps?: number;
  igniteDps: number;
  bleedDps: number;
  poisonDps: number;
  totalDps: number;
  /** PoB-compatible multi-skill / multi-entity Full DPS sum across all `includeInFullDps` groups. */
  fullDps?: number;
  fullDpsBreakdown?: Array<{
    groupId: string;
    label: string;
    skillName: LocalizedText;
    count: number;
    dps: number;
  }>;
  triggerRate?: number;
  manaCost: number;
  manaPerSecond: number;
}

export interface CalcDefenceOutput {
  str: number;
  dex: number;
  int: number;
  life: number;
  lifeUnreserved: number;
  lifeRegen: number;
  energyShield: number;
  esRegen: number;
  ward?: number;
  mana: number;
  manaUnreserved: number;
  manaRegen: number;
  spirit: number;
  spiritReserved: number;
  spiritUnreserved: number;
  armour: number;
  physDamageReduction: number;
  evasion: number;
  evadeChance: number;
  blockChance: number;
  spellBlockChance: number;
  spellSuppressionChance: number;
  fireResist: number;
  fireResistOvercap: number;
  fireMaxResist: number;
  coldResist: number;
  coldResistOvercap: number;
  coldMaxResist: number;
  lightningResist: number;
  lightningResistOvercap: number;
  lightningMaxResist: number;
  chaosResist: number;
  chaosResistOvercap: number;
  chaosMaxResist: number;
  movementSpeedPct: number;
  effectiveHitPool: number;
  maxPhysHitTaken: number;
  maxEleHitTaken: number;
  lifeLeechRate?: number;
  esLeechRate?: number;
}

export interface CalcOutput {
  game: GameId;
  offence: CalcOffenceOutput;
  defence: CalcDefenceOutput;
  breakdowns: StatBreakdownRow[];
  allocatedPoints: number;
  ascendancyPoints?: number;
  weaponSet1Points: number;
  weaponSet2Points: number;
  warnings: Array<{ code: string; message: LocalizedText }>;
}

export interface NodePowerDelta {
  nodeId: number;
  isAllocated: boolean;
  dpsDelta: number;
  dpsDeltaPct: number;
  lifeDelta: number;
  esDelta: number;
  ehpDelta: number;
}
