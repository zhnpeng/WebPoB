import type { OracleBenchmarkCase } from './benchmarks.js';

/**
 * High-coverage Layer-2 mechanism-isolated golden benchmarks locked to upstream
 * PathOfBuilding (PoE 1 3.30 & PoE 2 0.5) LuaJIT ground truth.
 *
 * Covers:
 *   A. PoE 2 Keystones & Pool Conversions (CI, EB, MoM, AoF, IR, Giant's Blood, RT, Blood Magic, Blackflame Covenant)
 *   B. PoE 2 Special Uniques & Slot Multipliers (Ingenuity, Kalandra's Touch, Astramentis, Ghostwrithe, Atziri's Disdain, Widowhail, Morior Invictus, Veil of the Night, Prism of Belief, MaxRes Override, Mageblood Legacy)
 *   C. PoE 2 Jewels, Radius & Amulet Anoints (Allocates Notable, Megalomaniac, From Nothing, Time-Lost Sapphire, Against the Darkness, Controlled Metamorphosis)
 *   D. PoE 2 Sceptre Spirit, Focus Off-Hand, Runes, Bonded Idols & Multi-Spirit Reservation
 *   E. PoE 2 Ascendancies Across Classes (Stormweaver, Invoker, Infernalist, Gemling Legionnaire, Ritualist Ring 3, Deadeye, Blood Mage, Acolyte of Chayula)
 *   F. PoE 1 Endgame Uniques & Mechanics (Mageblood, Ashes of the Stars, Melding of the Flesh, Crystallised Omniscience, Doryani's Prototype, Aegis Aurora)
 */
export const POE2_EXPANSION_BENCHMARKS: OracleBenchmarkCase[] = [
  // =========================================================================
  // Family A — PoE 2 Core Keystones & Pool Conversions (9)
  // =========================================================================
  {
    id: 'poe2_keystone_chaos_inoculation_es',
    title: 'PoE 2 — Keystone: Chaos Inoculation (Life=1, ChaosRes=100%) + ES Robe + Spark',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 CI ES"/>
  <Tree activeSpec="1">
    <Spec title="CI" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,56216,9485,60685,42736,4203,49046,8569,46034,41029,25557,4059,10382,21984,61403,56349"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Sanctum Shroud
Elementalist Robe
Quality: 20
Implicits: 0
100% increased Energy Shield
+60 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_eldritch_battery_archmage',
    title: 'PoE 2 — Keystone: Eldritch Battery (100% ES -> Mana, 2x Mana Cost) + Archmage Spark',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Eldritch Battery Archmage"/>
  <Tree activeSpec="1">
    <Spec title="EB" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,56216,9485,60685,42736,4203,49046,8569,46034,41029,25557,55668,29240,57513"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Archmage">
        <Gem gemId="Metadata/Items/Gems/SkillGemArchmage" skillId="ArchmagePlayer" nameSpec="Archmage" variantId="Archmage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Arcane Vestment
Elementalist Robe
Quality: 20
Implicits: 0
100% increased Energy Shield
+80 to maximum Energy Shield
+120 to maximum Mana
+50 to Spirit
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_mind_over_matter_druid',
    title: 'PoE 2 — Keystone: Mind Over Matter (100% Damage from Mana before Life, 50% less Mana Regen)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Mind Over Matter"/>
  <Tree activeSpec="1">
    <Spec title="MoM" treeVersion="0_5" classId="5" classInternalId="11" ascendClassId="0" nodes="61525,13855,64370,53396,10156,59795,3041,19240,46358,30979,44733,1433,31238,45918"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcano">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcano" skillId="VolcanoPlayer" nameSpec="Volcano" variantId="Volcano" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Mana Cloak
Elementalist Robe
Quality: 20
Implicits: 0
+200 to maximum Mana
+100 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_avatar_of_fire_comet',
    title: 'PoE 2 — Keystone: Avatar of Fire (75% Converted to Fire, Deal no Non-Fire) + Comet',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Avatar of Fire Comet"/>
  <Tree activeSpec="1">
    <Spec title="AoF" treeVersion="0_5" classId="3" classInternalId="6" ascendClassId="0" nodes="47175,3936,13397,1207,38323,22928,27373,16725,54811,57703,26725,63114,21387,53719,59777,27296,18684"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Comet">
        <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" variantId="Comet" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Pyre Wand
Attuned Wand
Implicits: 0
80% increased Fire Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_iron_reflexes_mercenary',
    title: 'PoE 2 — Keystone: Iron Reflexes (All Evasion Converted to Armour) + Mercenary',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Mercenary" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Iron Reflexes"/>
  <Tree activeSpec="1">
    <Spec title="IR" treeVersion="0_5" classId="4" classInternalId="9" ascendClassId="0" nodes="50986,59915,7741,42500,59881,54417,49657,63526,48635,21755,54127,54282,52125,2847,54099,28492"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Explosive Shot">
        <Gem gemId="Metadata/Items/Gem/SkillGemExplosiveShot" skillId="ExplosiveShotAmmoPlayer" nameSpec="Explosive Shot" variantId="ExplosiveShot" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crossbow
Siege Crossbow
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="2">
Rarity: RARE
Reflex Grips
Adorned Wraps
Quality: 20
Implicits: 0
+150 to Evasion Rating
100% increased Evasion Rating
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Gloves" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_giants_blood_2h_shield',
    title: "PoE 2 — Keystone: Giant's Blood (2H Mace in 1H + Shield, Halved Strength Life)",
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Giants Blood 2H + Shield"/>
  <Tree activeSpec="1">
    <Spec title="GiantsBlood" treeVersion="0_5" classId="3" classInternalId="6" ascendClassId="0" nodes="47175,3936,13397,1207,38323,22928,27373,16725,54811,57703,26725,63114,21387,53719,27082,3446,32349"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcanic Fissure">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcanicFissure" skillId="VolcanicFissurePlayer" nameSpec="Volcanic Fissure" variantId="VolcanicFissure" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Colossus Maul
Cultist Greathammer
Quality: 20
Implicits: 0
120% increased Physical Damage
+40 to Strength
    </Item>
    <Item id="2">
Rarity: RARE
Bastion Wall
Ancestor Tower Shield
Quality: 20
Implicits: 0
+100 to maximum Life
+35% to Fire Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_resolute_technique_sunder',
    title: 'PoE 2 — Keystone: Resolute Technique (Accuracy Doubled, Never Crit) + Sunder',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Resolute Technique"/>
  <Tree activeSpec="1">
    <Spec title="RT" treeVersion="0_5" classId="3" classInternalId="6" ascendClassId="0" nodes="47175,3936,13397,1207,38323,22928,27373,16725,54811,57703,26725,52298,4527,44017"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Sunder">
        <Gem gemId="Metadata/Items/Gems/SkillGemSunder" skillId="SunderPlayer" nameSpec="Sunder" variantId="Sunder" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Heavy Hammer
Cultist Greathammer
Quality: 20
Implicits: 0
120% increased Physical Damage
30% increased Critical Hit Chance
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_blood_magic_volcano',
    title: 'PoE 2 — Keystone: Blood Magic (Mana=0, Mana Costs -> Life) + Druid Volcano',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Blood Magic"/>
  <Tree activeSpec="1">
    <Spec title="BM" treeVersion="0_5" classId="5" classInternalId="11" ascendClassId="0" nodes="61525,50084,45923,52319,48305,8406,35426,48631,22616,14654,58295,47263,18448,30141,51749"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcano">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcano" skillId="VolcanoPlayer" nameSpec="Volcano" variantId="Volcano" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crimson Robe
Elementalist Robe
Quality: 20
Implicits: 0
+140 to maximum Life
+120 to maximum Mana
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_keystone_blackflame_covenant_fireball',
    title: 'PoE 2 — Keystone: Blackflame Covenant (Fire Spells 100% Fire -> Chaos) + Fireball',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Blackflame Covenant"/>
  <Tree activeSpec="1">
    <Spec title="Blackflame" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,56216,9485,60685,1826,39037,57710,8616,46819,61419,49512,15885,42680"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="FireballPlayer" nameSpec="Fireball" variantId="Fireball" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Void Wand
Attuned Wand
Implicits: 0
60% increased Chaos Damage
+2 to Level of all Fire Spell Skills
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },

  // =========================================================================
  // Family B — PoE 2 Special Uniques & Equipment Slot Mechanics (11)
  // =========================================================================
  {
    id: 'poe2_unique_ingenuity_belt_dual_rings',
    title: 'PoE 2 — Unique: Ingenuity Belt (30% Left & 30% Right Ring Bonus Scaling) + Dual Rare Rings',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ingenuity Belt"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Ingenuity
Utility Belt
Implicits: 1
20% of Flask Recovery applied Instantly
30% increased bonuses gained from left Equipped Ring
30% increased bonuses gained from right Equipped Ring
    </Item>
    <Item id="2">
Rarity: RARE
Storm Band
Emerald Ring
Implicits: 0
+100 to maximum Mana
+30 to Intelligence
+30% to Fire Resistance
30% increased Lightning Damage
    </Item>
    <Item id="3">
Rarity: RARE
Frost Band
Emerald Ring
Implicits: 0
+80 to maximum Life
+20 to Strength
+30% to Cold Resistance
20% increased Cast Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Belt" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Ring 2" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_kalandras_touch_mirror_ring',
    title: "PoE 2 — Unique: Kalandra's Touch (Reflects Opposite Ring Stats, Resists & Attributes)",
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Kalandras Touch"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Mirrored Loop
Amethyst Ring
Implicits: 1
+13% to Chaos Resistance
+90 to maximum Life
+110 to maximum Mana
+32 to Intelligence
+35% to Lightning Resistance
28% increased Spell Damage
    </Item>
    <Item id="2">
Rarity: UNIQUE
Kalandra's Touch
Ring
Implicits: 0
Reflects opposite Ring
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
      <Slot name="Ring 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_astramentis_int_stacking',
    title: 'PoE 2 — Unique: Astramentis (+100 All Attributes) + Per-Intelligence Spell Damage',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Astramentis"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Astramentis
Stellar Amulet
Implicits: 1
+7 to all Attributes
+95 to all Attributes
    </Item>
    <Item id="2">
Rarity: RARE
Mind Wand
Attuned Wand
Implicits: 0
2% increased Spell Damage per 10 Intelligence
20% increased Cast Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_ghostwrithe_life_to_es',
    title: 'PoE 2 — Unique: Ghostwrithe (50% Maximum Life Converted to Energy Shield + Chaos Res)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ghostwrithe"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="6" classInternalId="1" ascendClassId="0" nodes="54447,44871,56216,9485,60685"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Essence Drain">
        <Gem gemId="Metadata/Items/Gems/SkillGemEssenceDrain" skillId="EssenceDrainPlayer" nameSpec="Essence Drain" variantId="EssenceDrain" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Ghostwrithe
Tattered Robe
Quality: 20
Implicits: 0
+100 to maximum Energy Shield
+35% to Chaos Resistance
50% of Maximum Life Converted to Energy Shield
    </Item>
    <Item id="2">
Rarity: RARE
Vital Girdle
Heavy Belt
Implicits: 0
+120 to maximum Life
+30 to Strength
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Belt" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_atziris_disdain_life_extra_es',
    title: "PoE 2 — Unique: Atziri's Disdain (Gain % of Maximum Life as Extra Maximum Energy Shield)",
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Atziris Disdain"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,56216,9485,60685"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Atziri's Disdain
Gold Circlet
Quality: 20
Implicits: 0
+80 to maximum Mana
Gain 20% of maximum Life as Extra maximum Energy Shield
    </Item>
    <Item id="2">
Rarity: RARE
Life Vest
Elementalist Robe
Quality: 20
Implicits: 0
+160 to maximum Life
60% increased Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_widowhail_quiver_scaling',
    title: 'PoE 2 — Unique: Widowhail (250% Increased Bonuses from Equipped Quiver) + Rare Quiver',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Widowhail Quiver"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="1" classInternalId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrowPlayer" nameSpec="Lightning Arrow" variantId="LightningArrow" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Widowhail
Crude Bow
Quality: 20
Implicits: 0
250% increased bonuses gained from Equipped Quiver
    </Item>
    <Item id="2">
Rarity: RARE
Storm Spike
Broadhead Quiver
Implicits: 1
Adds 1 to 3 Physical Damage to Attacks
Adds 12 to 24 Lightning Damage to Attacks
+2 to Level of all Projectile Skills
+30 to Dexterity
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_morior_invictus_5_sockets',
    title: 'PoE 2 — Unique: Morior Invictus (5 Filled Sockets scaling Spirit, Mana & Chaos Res)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Morior Invictus 5S"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Morior Invictus
Grand Regalia
Quality: 20
Sockets: S S S S S
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Rune: Perfect Mind Rune
Implicits: 1
{enchant}{rune}+250 to maximum Mana
350% increased Armour, Evasion and Energy Shield
+12% to Chaos Resistance per Socket filled
+50 to maximum Mana per Socket filled
+12 to Spirit per Socket filled
Corrupted
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_veil_of_the_night_zero_ele_res',
    title: 'PoE 2 — Unique: Veil of the Night (50% inc Max Life, Elemental Resistances are Zero)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Veil of the Night"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="3" classInternalId="6" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcanic Fissure">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcanicFissure" skillId="VolcanicFissurePlayer" nameSpec="Volcanic Fissure" variantId="VolcanicFissure" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Veil of the Night
Martyr Crown
Quality: 20
Implicits: 0
50% increased maximum Life
+15 to all Attributes
You have no Elemental Resistances
    </Item>
    <Item id="2">
Rarity: RARE
Prism Band
Emerald Ring
Implicits: 0
+40% to all Elemental Resistances
+25% to Chaos Resistance
+100 to maximum Life
    </Item>
    <Item id="3">
Rarity: RARE
Heavy Mace
Cultist Greathammer
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Weapon 1" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_unique_prism_of_belief_plus3_spark',
    title: 'PoE 2 — Unique Jewel: Prism of Belief (+3 to Level of all Spark Skills -> Lv.23 Spark)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Prism of Belief"/>
  <Tree activeSpec="1">
    <Spec title="Jewel" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Prism of Belief
Diamond
Implicits: 0
+10 to all Attributes
+3 to Level of all Spark Skills
    </Item>
    <ItemSet id="1"/>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_max_resist_override_79_less_life',
    title: 'PoE 2 — WeGame CN Mechanics: Your Maximum Resistances are 79% + 20% less maximum Life',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 MaxRes Override 79"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Aegis Pendant
Gold Amulet
Implicits: 0
Your Maximum Resistances are 79%
+180% to all Elemental Resistances
+180% to Chaos Resistance
    </Item>
    <Item id="2">
Rarity: RARE
Cursed Robe
Elementalist Robe
Quality: 20
Implicits: 0
20% less maximum Life
+100 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_mageblood_legacy_belt_rings',
    title: 'PoE 2 — WeGame CN Mageblood Legacy Belt (100% Left & Right Ring Bonus Multiplier)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Legacy Ring Belt"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Mageblood
Heavy Belt
Implicits: 0
100% increased bonuses gained from left Equipped Ring
100% increased bonuses gained from right Equipped Ring
    </Item>
    <Item id="2">
Rarity: RARE
Left Ring
Emerald Ring
Implicits: 0
+60 to maximum Life
+25 to Intelligence
+25% to Fire Resistance
    </Item>
    <Item id="3">
Rarity: RARE
Right Ring
Emerald Ring
Implicits: 0
+80 to maximum Mana
+25 to Dexterity
+25% to Cold Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Belt" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Ring 2" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },

  // =========================================================================
  // Family C — PoE 2 Jewels, Radius Allocation & Amulet Anoints (6)
  // =========================================================================
  {
    id: 'poe2_amulet_anoint_pure_energy',
    title: 'PoE 2 — Amulet Anoint: {enchant}Allocates Pure Energy (+30% Max ES, +10 Int)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Amulet Anoint"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Anointed Torc
Gold Amulet
Implicits: 1
{enchant}Allocates Pure Energy
+80 to maximum Mana
    </Item>
    <Item id="2">
Rarity: RARE
Sanctum Robe
Elementalist Robe
Quality: 20
Implicits: 0
+100 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_jewel_megalomaniac_triple_notable',
    title: 'PoE 2 — Unique Jewel: Megalomaniac Allocating 3 Disconnected Notables',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Megalomaniac"/>
  <Tree activeSpec="1">
    <Spec title="Jewel" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Megalomaniac
Diamond
Implicits: 3
{enchant}Allocates Pure Energy
{enchant}Allocates Insightfulness
{enchant}Allocates Turn the Clock Forward
Corrupted
    </Item>
    <Item id="2">
Rarity: RARE
ES Robe
Elementalist Robe
Quality: 20
Implicits: 0
+100 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_jewel_from_nothing_ci_radius',
    title: 'PoE 2 — Unique Jewel: From Nothing (Chaos Inoculation Small Radius Disconnected Passives)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 From Nothing CI"/>
  <Tree activeSpec="1">
    <Spec title="FromNothing" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196,19003,12166">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Comet">
        <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" variantId="Comet" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
From Nothing
Diamond
Radius: Small
Implicits: 0
Passives in Radius of Chaos Inoculation can be Allocated
without being connected to your tree
Corrupted
    </Item>
    <ItemSet id="1"/>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_jewel_time_lost_sapphire_radius',
    title: 'PoE 2 — Time-Lost Sapphire Jewel: Small Passives in Large Radius Grant ES% & Spell Damage%',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Time-Lost Sapphire"/>
  <Tree activeSpec="1">
    <Spec title="TimeLost" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Chrono Star
Time-Lost Sapphire
Radius: Large
Implicits: 0
Small Passive Skills in Radius also grant 6% increased maximum Energy Shield
Small Passive Skills in Radius also grant 8% increased Spell Damage
    </Item>
    <Item id="2">
Rarity: RARE
ES Robe
Elementalist Robe
Quality: 20
Implicits: 0
+100 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_jewel_against_the_darkness_resists',
    title: 'PoE 2 — Unique Jewel: Against the Darkness (Time-Lost Diamond Small Passives Grant Resists)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Against the Darkness"/>
  <Tree activeSpec="1">
    <Spec title="ATD" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Against the Darkness
Time-Lost Diamond
Radius: Large
Implicits: 0
Small Passive Skills in Radius also grant +5% to Fire Resistance
Small Passive Skills in Radius also grant +5% to Cold Resistance
    </Item>
    <ItemSet id="1"/>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_jewel_controlled_metamorphosis_penalties',
    title: 'PoE 2 — Unique Jewel: Controlled Metamorphosis (Elemental & Chaos Resistance Penalties)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Controlled Metamorphosis"/>
  <Tree activeSpec="1">
    <Spec title="CM" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,22419,18407,47555,53697,3041,59795,10156,6744,49357,32194,28002,49938,26196">
      <Sockets>
        <Socket nodeId="26196" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Controlled Metamorphosis
Diamond
Radius: Massive Ring
Implicits: 0
Only affects Passives in Massive Ring
Passives in Radius can be Allocated without being connected to your tree
-15% to all Elemental Resistances
-13% to Chaos Resistance
    </Item>
    <Item id="2">
Rarity: RARE
Ward Robe
Elementalist Robe
Quality: 20
Implicits: 0
+60% to all Elemental Resistances
+30% to Chaos Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },

  // =========================================================================
  // Family D — PoE 2 Sceptre Spirit, Focus, Runes, Bonded Idols & Reservations (6)
  // =========================================================================
  {
    id: 'poe2_sceptre_offhand_local_spirit_scaling',
    title: 'PoE 2 — Off-Hand Sceptre Local Spirit Scaling (Base 100 Spirit + 50% inc Spirit)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Sceptre Spirit"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Spark Rod
Attuned Wand
Implicits: 0
60% increased Spell Damage
    </Item>
    <Item id="2">
Rarity: RARE
Command Baton
Hallowed Sceptre
Quality: 0
Implicits: 0
50% increased Spirit
+80 to maximum Mana
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_wand_focus_offhand_spell_es',
    title: 'PoE 2 — Wand + Off-Hand Crystal Focus (Local ES + +2 Spell Skills + Spell Crit)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Wand + Focus"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Wand
Attuned Wand
Implicits: 0
70% increased Spell Damage
20% increased Cast Speed
    </Item>
    <Item id="2">
Rarity: RARE
Aether Tome
Crystal Focus
Quality: 20
Implicits: 0
80% increased Energy Shield
+45 to maximum Energy Shield
60% increased Spell Damage
+2 to Level of all Spell Skills
40% increased Critical Hit Chance for Spells
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_armour_socketed_iron_runes_local_es',
    title: 'PoE 2 — Body Armour w/ 2x Greater Iron Runes ({enchant}{rune}36% Local Defences)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Armour Iron Runes"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Runed Regalia
Elementalist Robe
Quality: 20
Sockets: S S
Rune: Greater Iron Rune
Rune: Greater Iron Rune
Implicits: 1
{enchant}{rune}36% increased Armour, Evasion and Energy Shield
100% increased Energy Shield
+60 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_weapon_socketed_iron_runes_local_phys',
    title: 'PoE 2 — Bow w/ 2x Greater Iron Runes ({enchant}{rune}36% Local Physical Damage)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Weapon Iron Runes"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="1" classInternalId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrowPlayer" nameSpec="Lightning Arrow" variantId="LightningArrow" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Runed Longbow
Recurve Bow
Quality: 20
Sockets: S S
Rune: Greater Iron Rune
Rune: Greater Iron Rune
Implicits: 1
{enchant}{rune}36% increased Physical Damage
110% increased Physical Damage
16% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_shaman_wisdom_of_the_maji_bonded',
    title: 'PoE 2 — Ascendancy: Druid Shaman (Wisdom of the Maji Unlocking Socketed Bonded Modifiers)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="Shaman" ascendancyName="Shaman" mainSocketGroup="1" buildName="Oracle: PoE2 Shaman Bonded"/>
  <Tree activeSpec="1">
    <Spec title="Shaman" treeVersion="0_5" classId="5" classInternalId="11" ascendClassId="2" ascendancyInternalId="Druid2" nodes="61525,35535,33824,42253"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcano">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcano" skillId="VolcanoPlayer" nameSpec="Volcano" variantId="Volcano" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Shaman Tunic
Elementalist Robe
Quality: 20
Sockets: S S
Rune: Adept Rune
Rune: Adept Rune
Implicits: 3
{enchant}{rune}+18 to Dexterity
{enchant}{rune}Bonded: +40 to maximum Life
{enchant}{rune}Bonded: +40 to maximum Mana
+50 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_multi_spirit_auras_archmage_arctic_armour',
    title: 'PoE 2 — Multi-Spirit Reservation: Archmage (100) + Arctic Armour (30) + +60 Spirit Robe',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Multi Spirit Reservation"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Archmage">
        <Gem gemId="Metadata/Items/Gems/SkillGemArchmage" skillId="ArchmagePlayer" nameSpec="Archmage" variantId="Archmage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Arctic Armour">
        <Gem gemId="Metadata/Items/Gems/SkillGemArcticArmour" skillId="ArcticArmourPlayer" variantId="ArcticArmour" nameSpec="Arctic Armour" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Spirit Shroud
Elementalist Robe
Quality: 20
Implicits: 0
+60 to Spirit
+180 to maximum Mana
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },

  // =========================================================================
  // Family E — PoE 2 Ascendancies Across Classes (8)
  // =========================================================================
  {
    id: 'poe2_asc_stormweaver_force_of_will',
    title: 'PoE 2 — Ascendancy: Stormweaver (Constant Gale + Force of Will Mana-Scaled Arcane Surge)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="Stormweaver" ascendancyName="Stormweaver" mainSocketGroup="1" buildName="Oracle: PoE2 Stormweaver Force of Will"/>
  <Tree activeSpec="1">
    <Spec title="Stormweaver" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="1" ascendancyInternalId="Sorceress1" nodes="54447,40721,64789,8867,7246,39204"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Mana Robe
Elementalist Robe
Quality: 20
Implicits: 0
+250 to maximum Mana
80% increased Mana Regeneration Rate
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_invoker_lead_me_through_grace_spirit',
    title: 'PoE 2 — Ascendancy: Monk Invoker (Lead me through Grace... Body Armour ES/Eva -> Spirit)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="Invoker" ascendancyName="Invoker" mainSocketGroup="1" buildName="Oracle: PoE2 Invoker Spirit"/>
  <Tree activeSpec="1">
    <Spec title="Invoker" treeVersion="0_5" classId="8" classInternalId="10" ascendClassId="2" ascendancyInternalId="Monk2" nodes="44683,9994,23415,8143"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Ice Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceStrike" skillId="IceStrikePlayer" nameSpec="Ice Strike" variantId="IceStrike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Frost Staff
Gothic Quarterstaff
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="2">
Rarity: RARE
Grace Vestment
Elementalist Robe
Quality: 20
Implicits: 0
120% increased Energy Shield
+100 to maximum Energy Shield
+50 to Spirit
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_infernalist_altered_flesh_beidats_hand',
    title: "PoE 2 — Ascendancy: Witch Infernalist (Altered Flesh + Beidat's Hand Life -> Max ES)",
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="Infernalist" ascendancyName="Infernalist" mainSocketGroup="1" buildName="Oracle: PoE2 Infernalist Beidats Hand"/>
  <Tree activeSpec="1">
    <Spec title="Infernalist" treeVersion="0_5" classId="6" classInternalId="1" ascendClassId="1" ascendancyInternalId="Witch1" nodes="54447,32699,7793,18348,46016,24039"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="FireballPlayer" nameSpec="Fireball" variantId="Fireball" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Hell Robe
Elementalist Robe
Quality: 20
Implicits: 0
+180 to maximum Life
+40% to Fire Resistance
+30% to Chaos Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_gemling_enhanced_effectiveness',
    title: 'PoE 2 — Ascendancy: Gemling Legionnaire (Enhanced Effectiveness Doubled Attribute Inherent Bonuses)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Mercenary" ascendClassName="Gemling Legionnaire" ascendancyName="Gemling Legionnaire" mainSocketGroup="1" buildName="Oracle: PoE2 Gemling Enhanced Effectiveness"/>
  <Tree activeSpec="1">
    <Spec title="Gemling" treeVersion="0_5" classId="4" classInternalId="9" ascendClassId="3" ascendancyInternalId="Mercenary3" nodes="50986,55536,1442,53108,36822,58591"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Explosive Shot">
        <Gem gemId="Metadata/Items/Gem/SkillGemExplosiveShot" skillId="ExplosiveShotAmmoPlayer" nameSpec="Explosive Shot" variantId="ExplosiveShot" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crossbow
Siege Crossbow
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="2">
Rarity: RARE
Omni Pendant
Gold Amulet
Implicits: 0
+60 to Strength
+60 to Dexterity
+60 to Intelligence
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Amulet" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_ritualist_unfurled_finger_ring3',
    title: 'PoE 2 — Ascendancy: Huntress Ritualist (Unfurled Finger Ring 3 + Mystic Attunement 25% Jewellery)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Huntress" ascendClassName="Ritualist" ascendancyName="Ritualist" mainSocketGroup="1" buildName="Oracle: PoE2 Ritualist Ring 3"/>
  <Tree activeSpec="1">
    <Spec title="Ritualist" treeVersion="0_5" classId="2" classInternalId="8" ascendClassId="3" ascendancyInternalId="Huntress3" nodes="50459,36365,17058,34785,3223,7068"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Spear">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningSpear" skillId="LightningSpearPlayer" nameSpec="Lightning Spear" variantId="LightningSpear" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Lance
Akoyan Spear
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="2">
Rarity: RARE
Ring Alpha
Emerald Ring
Implicits: 0
+80 to maximum Life
+24% to Fire Resistance
    </Item>
    <Item id="3">
Rarity: RARE
Ring Beta
Emerald Ring
Implicits: 0
+80 to maximum Mana
+24% to Cold Resistance
    </Item>
    <Item id="4">
Rarity: RARE
Ring Gamma
Emerald Ring
Implicits: 0
+24 to Dexterity
+24% to Lightning Resistance
    </Item>
    <Item id="5">
Rarity: RARE
Ritual Torc
Gold Amulet
Implicits: 0
+40 to Spirit
+20 to Strength
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Ring 2" itemId="3"/>
      <Slot name="Ring 3" itemId="4"/>
      <Slot name="Amulet" itemId="5"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_deadeye_gathering_winds_tailwind',
    title: 'PoE 2 — Ascendancy: Ranger Deadeye (Gathering Winds Tailwind Skill Speed & Evasion)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="Deadeye" ascendancyName="Deadeye" mainSocketGroup="1" buildName="Oracle: PoE2 Deadeye Gathering Winds"/>
  <Tree activeSpec="1">
    <Spec title="Deadeye" treeVersion="0_5" classId="1" classInternalId="2" ascendClassId="1" ascendancyInternalId="Ranger1" nodes="50459,46990,3987,30"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrowPlayer" nameSpec="Lightning Arrow" variantId="LightningArrow" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Swift Bow
Recurve Bow
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="2">
Rarity: RARE
Wind Garb
Adorned Wraps
Quality: 20
Implicits: 0
+200 to Evasion Rating
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Gloves" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_blood_mage_crimson_power_chest_es_life',
    title: 'PoE 2 — Ascendancy: Witch Blood Mage (Crimson Power Body Armour ES Added as Maximum Life)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="Blood Mage" ascendancyName="Blood Mage" mainSocketGroup="1" buildName="Oracle: PoE2 Blood Mage Crimson Power"/>
  <Tree activeSpec="1">
    <Spec title="BloodMage" treeVersion="0_5" classId="6" classInternalId="1" ascendClassId="2" ascendancyInternalId="Witch2" nodes="54447,59822,8415,3165,56162,50192,31223"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Bone Cage">
        <Gem gemId="Metadata/Items/Gems/SkillGemBoneCage" skillId="BoneCagePlayer" nameSpec="Bone Cage" variantId="BoneCage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Sanguine Vestment
Elementalist Robe
Quality: 20
Implicits: 0
120% increased Energy Shield
+80 to maximum Energy Shield
+100 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_asc_acolyte_chayula_grasp_of_the_void',
    title: 'PoE 2 — Ascendancy: Monk Acolyte of Chayula (Grasp of the Void Chaos Scaling)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="Acolyte of Chayula" ascendancyName="Acolyte of Chayula" mainSocketGroup="1" buildName="Oracle: PoE2 Acolyte of Chayula"/>
  <Tree activeSpec="1">
    <Spec title="Chayula" treeVersion="0_5" classId="8" classInternalId="10" ascendClassId="3" ascendancyInternalId="Monk3" nodes="44683,74,25885,31116"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Ice Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceStrike" skillId="IceStrikePlayer" nameSpec="Ice Strike" variantId="IceStrike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Void Quarterstaff
Gothic Quarterstaff
Quality: 20
Implicits: 0
120% increased Physical Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },

  // =========================================================================
  // Family F — PoE 1 Endgame Special Uniques & Mechanics (6)
  // =========================================================================
  {
    id: 'poe1_unique_mageblood_3_magic_utility_flasks',
    title: 'PoE 1 — Unique: Mageblood (Permanent Leftmost 3 Enkindled Magic Utility Flasks)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Mageblood"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Mageblood
Heavy Belt
Implicits: 1
+30 to Strength
+45 to Dexterity
+22% to Fire Resistance
+22% to Cold Resistance
Magic Utility Flasks cannot be Used
Leftmost 3 Magic Utility Flasks constantly apply their Flask Effects to you
Magic Utility Flask Effects cannot be removed
    </Item>
    <Item id="2">
Rarity: MAGIC
Abecedarian's Granite Flask of the Armadillo
Granite Flask
Quality: 20
Implicits: 1
70% increased effect
25% increased Duration
25% increased effect
60% increased Armour during Effect
    </Item>
    <Item id="3">
Rarity: MAGIC
Abecedarian's Jade Flask of the Impala
Jade Flask
Quality: 20
Implicits: 1
70% increased effect
25% increased Duration
25% increased effect
60% increased Evasion Rating during Effect
    </Item>
    <Item id="4">
Rarity: MAGIC
Abecedarian's Silver Flask
Silver Flask
Quality: 20
Implicits: 1
70% increased effect
25% increased Duration
25% increased effect
    </Item>
    <ItemSet id="1">
      <Slot name="Belt" itemId="1"/>
      <Slot name="Flask 1" itemId="2"/>
      <Slot name="Flask 2" itemId="3"/>
      <Slot name="Flask 3" itemId="4"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_unique_ashes_of_the_stars_level_quality_res',
    title: 'PoE 1 — Unique: Ashes of the Stars (+1 All Skill Gems, +30% Quality, 20% Reservation Eff)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Ashes of the Stars"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="20" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Wrath">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Ashes of the Stars
Onyx Amulet
Implicits: 1
+16 to all Attributes
20% increased Reservation Efficiency of Skills
+1 to Level of all Skill Gems
+30% to Quality of all Skill Gems
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_unique_melding_of_the_flesh_max_fire_cap',
    title: 'PoE 1 — Unique Jewel: Melding of the Flesh (Elemental Max Resists Capped by Highest Fire Max Res)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Melding of the Flesh"/>
  <Tree activeSpec="1">
    <Spec title="Melding" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,31875,60398,7388,36634">
      <Sockets>
        <Socket nodeId="36634" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Melding of the Flesh
Cobalt Jewel
Implicits: 0
-75% to all Elemental Resistances
-4% to all maximum Elemental Resistances
Elemental Resistances are capped by your highest Maximum Elemental Resistance instead
    </Item>
    <Item id="2">
Rarity: RARE
Phoenix Ward
Titanium Spirit Shield
Quality: 20
Implicits: 0
+9% to maximum Fire Resistance
+220% to all Elemental Resistances
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_unique_crystallised_omniscience_ele_pen_res',
    title: 'PoE 1 — Unique: Crystallised Omniscience (Attributes -> Omniscience -> Ele Res & Ele Pen)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Crystallised Omniscience"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Weapon 1" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrow" nameSpec="Lightning Arrow" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Crystallised Omniscience
Onyx Amulet
Implicits: 1
+16 to all Attributes
Modifiers to Attributes instead apply to Omniscience
+1% to all Elemental Resistances per 15 Omniscience
Penetrate 1% Elemental Resistances per 15 Omniscience
Attribute Requirements can be satisfied by 25% of Omniscience
    </Item>
    <Item id="2">
Rarity: RARE
Omni Bow
Spine Bow
Quality: 20
Implicits: 0
100% increased Physical Damage
    </Item>
    <Item id="3">
Rarity: RARE
Omni Chest
Vaal Regalia
Quality: 20
Implicits: 0
+150 to Strength
+150 to Dexterity
+150 to Intelligence
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
      <Slot name="Body Armour" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_unique_doryanis_prototype_neg_light_res',
    title: "PoE 1 — Unique: Doryani's Prototype (Nearby Enemies Have Your Negative Lightning Resistance)",
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Doryanis Prototype"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Doryani's Prototype
Saint's Hauberk
Quality: 20
Implicits: 0
180% increased Armour and Energy Shield
+80 to maximum Life
Deal no Non-Lightning Damage
Armour also applies to Lightning Damage taken from Hits
Lightning Resistance does not affect Lightning Damage taken
Enemies within 6 metres have Lightning Resistance equal to yours
    </Item>
    <Item id="2">
Rarity: RARE
Ventor Loop
Gold Ring
Implicits: 0
-50% to Lightning Resistance
+60% to Fire Resistance
+60% to Cold Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_unique_aegis_aurora_max_cold_res',
    title: 'PoE 1 — Unique: Aegis Aurora (+5% Max Cold Res, 350% Armour/ES) + Cold Cap',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE1 Aegis Aurora"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Aegis Aurora
Champion Kite Shield
Quality: 20
Implicits: 0
350% increased Armour and Energy Shield
+10% to all Elemental Resistances
+5% to maximum Cold Resistance
+6% Chance to Block
Recover Energy Shield equal to 2% of Armour when you Block
    </Item>
    <Item id="2">
Rarity: RARE
Glacier Band
Gold Ring
Implicits: 0
+140% to Cold Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 2" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
];
