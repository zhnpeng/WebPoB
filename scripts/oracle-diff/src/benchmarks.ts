import type { GameId } from '@webpob/core';

export interface OracleBenchmarkCase {
  id: string;
  title: string;
  game: GameId;
  /** Official PoB XML compatible with BOTH upstream PathOfBuilding Lua and WebPoB codec. */
  xml: string;
}

export const ORACLE_BENCHMARKS: OracleBenchmarkCase[] = [
  {
    id: 'poe1_naked_witch_fireball',
    title: 'PoE 1 — Naked Lv.90 Witch (Fireball Lv.20, 0Q)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Naked Witch Fireball"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_tree_witch_arc',
    title: 'PoE 1 — Lv.92 Witch w/ 3.30 Tree + Arc Lv.20',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="Alira" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Witch 3.30 Tree Arc"/>
  <Tree activeSpec="1">
    <Spec title="Arc Tree" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,11420,48362,27203,7938,1031,33755,21958,14021,12379,44183,7555,57226,21678,32210,8948,27929,7503,4432,42795"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="bandit" string="Alira"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_geared_spell_arc',
    title: 'PoE 1 — Geared Lv.92 Witch (Arc + Supports + Wrath + Rare Gear)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="Alira" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Geared Spell Arc"/>
  <Tree activeSpec="1">
    <Spec title="Arc Tree" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,11420,48362,27203,7938,1031,33755,21958,57226,21678,32210,8948"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Main Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemLightningPenetration" skillId="SupportLightningPenetration" nameSpec="Lightning Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Wand
Prophecy Wand
Quality: 0
Implicits: 1
36% increased Spell Damage
65% increased Spell Damage
18% increased Cast Speed
+48 to maximum Mana
    </Item>
    <Item id="2">
Rarity: RARE
Astral Robe
Vaal Regalia
Quality: 20
Implicits: 0
+88 to maximum Life
+42% to Fire Resistance
+38% to Cold Resistance
+36% to Lightning Resistance
    </Item>
    <Item id="3">
Rarity: RARE
Dread Belt
Leather Belt
Quality: 0
Implicits: 1
+40 to maximum Life
+90 to maximum Life
+40% to Fire Resistance
+40% to Cold Resistance
+40% to Lightning Resistance
+40 to Strength
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
      <Slot name="Belt" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="bandit" string="Alira"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ci_es_witch',
    title: 'PoE 1 — Chaos Inoculation ES Witch + Discipline',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: CI ES Witch"/>
  <Tree activeSpec="1">
    <Spec title="CI" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57226,21678,32210,8948,27659,37671,27415,32710,49605,60440,11455"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Discipline">
        <Gem gemId="Metadata/Items/Gems/SkillGemDiscipline" skillId="Discipline" nameSpec="Discipline" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Vaal Shell
Vaal Regalia
Quality: 20
Implicits: 0
+16% to all Elemental Resistances
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_armour_rt_marauder',
    title: 'PoE 1 — Resolute Technique Marauder + Determination + Armour',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="Oak" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: RT Armour Marauder"/>
  <Tree activeSpec="1">
    <Spec title="RT" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175,31628,9511,23881,26523,6446,10221,50422,50570,29353,63282,31961,58449,50904,6981,36543,49412,40653,53793,62017,33287"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Determination">
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Brutal Cleaver
Vaal Axe
Quality: 20
Implicits: 0
+30 to Strength
    </Item>
    <Item id="2">
Rarity: RARE
Titan Plate
Glorious Plate
Quality: 20
Implicits: 0
+100 to maximum Life
+40% to Fire Resistance
+40% to Cold Resistance
+40% to Lightning Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="bandit" string="Oak"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ranger_bow_la',
    title: 'PoE 1 — Lv.90 Ranger Bow Lightning Arrow + Grace',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Ranger Bow LA"/>
  <Tree activeSpec="1">
    <Spec title="Bow" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459,39821,52904,444,61306,54142,45035,59370,63795,38662,50338,60942,41866,9206,19858"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Weapon 1" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrow" nameSpec="Lightning Arrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemWeaponElementalDamage" skillId="SupportWeaponElementalDamage" nameSpec="Elemental Damage with Attacks" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Grace">
        <Gem gemId="Metadata/Items/Gems/SkillGemGrace" skillId="Grace" nameSpec="Grace" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Tempest Bow
Spine Bow
Quality: 20
Implicits: 0
+30% to Global Critical Strike Multiplier
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_naked_sorc_spark',
    title: 'PoE 2 — Naked Lv.90 Sorceress (Spark Lv.20)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Naked Sorceress Spark"/>
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
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_tree_sorc_spark',
    title: 'PoE 2 — Lv.90 Sorceress w/ 0.5 Tree + Spark Lv.20',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Tree Sorc Spark"/>
  <Tree activeSpec="1">
    <Spec title="Tree" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,30346,29695,43736,2254,13769,59636,4739,18845,1755,41965,51184"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe1_elementalist_ascendancy',
    title: 'PoE 1 — Lv.92 Elementalist Ascendancy + Lua-Exported Ice Spear + Elemental Focus',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="Alira" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1" buildName="Oracle: Elementalist Ascendancy Ice Spear"/>
  <Tree activeSpec="1">
    <Spec title="Elementalist" treeVersion="3_30" classId="3" ascendClassId="2" nodes="54447,57264,37569,36542,16023,6052,47873,37114,54279"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ice Spear">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceSpear" skillId="IceSpear" nameSpec="Ice Spear" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemElementalFocus" skillId="SupportElementalFocus" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="bandit" string="Alira"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_utility_flasks_active',
    title: 'PoE 1 — Active Utility Flasks (Granite + Jade + Diamond) + Frostbolt Lv.20',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Utility Flasks"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Frostbolt">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostbolt" skillId="Frostbolt" nameSpec="Frostbolt" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: MAGIC
Granite Flask
Quality: 0
Implicits: 0
50% increased Armour during effect
    </Item>
    <Item id="2">
Rarity: MAGIC
Jade Flask
Quality: 0
Implicits: 0
45% increased Evasion Rating during effect
    </Item>
    <Item id="3">
Rarity: MAGIC
Diamond Flask
Quality: 0
Implicits: 0
    </Item>
    <ItemSet id="1">
      <Slot name="Flask 1" itemId="1" active="true"/>
      <Slot name="Flask 2" itemId="2" active="true"/>
      <Slot name="Flask 3" itemId="3" active="true"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_mom_hierophant_frostbolt',
    title: 'PoE 1 — Mind Over Matter (40% MoM) + Lua-Exported Frostbolt Lv.21',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: MoM Frostbolt Lv.21"/>
  <Tree activeSpec="1">
    <Spec title="MoM" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,34098"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Frostbolt">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostbolt" skillId="Frostbolt" nameSpec="Frostbolt" level="21" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Mind Crown
Hubris Circlet
Quality: 20
Implicits: 0
+120 to maximum Mana
+90 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_comet_sorc',
    title: 'PoE 2 — Lv.90 Sorceress w/ Lua-Exported Comet Lv.20 + Tree',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Comet Sorc"/>
  <Tree activeSpec="1">
    <Spec title="Tree" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,30346,29695,43736,2254,13769"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Comet">
        <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" variantId="Comet" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe1_local_weapon_armour_rare',
    title: 'PoE 1 — Local-Mod Rare Vaal Axe (Phys/AS) + Local-Mod Rare Vaal Regalia (ES)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Local Weapon & Armour"/>
  <Tree activeSpec="1">
    <Spec title="RT" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175,31628,9511,23881,26523,6446,10221,50422,50570,29353,63282,31961"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Doom Reaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 25 to 45 Physical Damage
20% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Aether Vestment
Vaal Regalia
Quality: 20
Implicits: 0
+120 to maximum Energy Shield
110% increased Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_curses_conductivity_assmark',
    title: "PoE 1 — Arc + Conductivity (-36% Light Res) + Assassin's Mark (+1.5% Crit / +49% Multi)",
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Curses & Marks"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Curse">
        <Gem gemId="Metadata/Items/Gems/SkillGemConductivity" skillId="Conductivity" nameSpec="Conductivity" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_assassins_mark_spell',
    title: "PoE 1 — Arc + Assassin's Mark (+1.5% Base Crit & +49% Crit Multi)",
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Assassins Mark"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Mark">
        <Gem gemId="Metadata/Items/Gems/SkillGemAssassinsMark" skillId="AssassinsMark" nameSpec="Assassin's Mark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_socketed_jewel_uniques',
    title: "PoE 1 — Socketed Cobalt Jewel + Astramentis + Shavronne's Wrappings",
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Jewel & Uniques"/>
  <Tree activeSpec="1">
    <Spec title="Jewel" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,31875,60398,7388,36634">
      <Sockets>
        <Socket nodeId="36634" itemId="1"/>
      </Sockets>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Mind Eye
Cobalt Jewel
Implicits: 0
7% increased maximum Life
14% increased Spell Damage
+15% to Global Critical Strike Multiplier
    </Item>
    <Item id="2">
Rarity: UNIQUE
Astramentis
Onyx Amulet
Implicits: 1
+13 to all Attributes
+90 to all Attributes
    </Item>
    <Item id="3">
Rarity: UNIQUE
Shavronne's Wrappings
Occultist's Vestment
Quality: 20
Implicits: 1
6% increased Spell Damage
175% increased Energy Shield
+35% to Lightning Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Amulet" itemId="2"/>
      <Slot name="Body Armour" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_iron_reflexes_grace',
    title: 'PoE 1 — Iron Reflexes Keystone + Grace + Determination + Active Jade Flask',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Iron Reflexes"/>
  <Tree activeSpec="1">
    <Spec title="IR" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459,39821,52904,444,61306,60942,32555,22266,30679,5237,6363,29937,8544,10661"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemGrace" skillId="Grace" nameSpec="Grace" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: MAGIC
Jade Flask
Quality: 0
Implicits: 0
    </Item>
    <ItemSet id="1">
      <Slot name="Flask 1" itemId="1" active="true"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_spell_totem_arc',
    title: 'PoE 1 — Spell Totem Support + Arc Lv.20',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Spell Totem Arc"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc Totem">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemSpellTotem" skillId="SupportSpellTotem" nameSpec="Spell Totem" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_avatar_of_fire_frostbolt',
    title: 'PoE 1 — Avatar of Fire Keystone (50% Cold->Fire, Deal no Non-Fire) + Frostbolt',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Avatar of Fire"/>
  <Tree activeSpec="1">
    <Spec title="AoF" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,31875,60398,13009,17735,58402,10575,29199,15064,31931,15631,44967,50422,10221,44941"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Frostbolt">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostbolt" skillId="Frostbolt" nameSpec="Frostbolt" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_dual_wield_cyclone',
    title: 'PoE 1 — Dual-Wielding 1H Foil + 1H Axe Cyclone (+10% more AS, +20% Block, alternating)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Dual Wield Cyclone"/>
  <Tree activeSpec="1">
    <Spec title="DW" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175,31628,9511,23881,26523,6446,10221,50422,50570,29353,63282,31961"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Tempest Foil
Jewelled Foil
Quality: 20
Implicits: 1
+25% to Global Critical Strike Multiplier
150% increased Physical Damage
15% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Rift Cleaver
Siege Axe
Quality: 20
Implicits: 0
120% increased Physical Damage
10% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Weapon 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_pain_attunement_low_life',
    title: 'PoE 1 — Pain Attunement Keystone (Low Life 30% more Spell Damage) + Arc',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Pain Attunement Low Life"/>
  <Tree activeSpec="1">
    <Spec title="PA" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57226,21678,32210,8948,27659,37671,31703"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="conditionLowLife" boolean="true"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_wither_despair_soulrend',
    title: 'PoE 1 — Lua-Exported Soulrend Lv.20 + Despair (-30% Chaos Res) + 15x Withered (+90% Taken)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Wither Despair Soulrend"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Soulrend">
        <Gem gemId="Metadata/Items/Gems/SkillGemSoulrend" skillId="Soulrend" nameSpec="Soulrend" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Curse">
        <Gem gemId="Metadata/Items/Gems/SkillGemDespair" skillId="Despair" nameSpec="Despair" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Wither">
        <Gem gemId="Metadata/Items/Gems/SkillGemWither" skillId="Wither" nameSpec="Wither" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"><Input name="multiplierWitheredStackCount" number="15"/></ConfigSet></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_exposure_arcane_tailwind_unnerve',
    title: 'PoE 1 — Elementalist Mastermind of Discord (-35% Light Exposure) + Arcane Surge + Tailwind + Unnerve',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="92" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1" buildName="Oracle: Exposure Arcane Tailwind Unnerve"/>
  <Tree activeSpec="1">
    <Spec title="Elem" treeVersion="3_30" classId="3" ascendClassId="2" nodes="54447,16023,37114,61259"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Exposure">
        <Gem gemId="Metadata/Items/Gems/SkillGemHydrosphere" skillId="Hydrosphere" nameSpec="Hydrosphere" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="buffArcaneSurge" boolean="true"/>
      <Input name="buffTailwind" boolean="true"/>
      <Input name="conditionEnemyUnnerved" boolean="true"/>
      <Input name="conditionEnemyLightningExposure" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_cluster_jewel_large',
    title: 'PoE 1 — Large Lightning Cluster Jewel (Storm Drinker + Prismatic Heart + 4x 12% Small)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Large Cluster Jewel"/>
  <Tree activeSpec="1">
    <Spec title="Cluster" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57226,21678,32210,8948,27659,37671,27415,32710,49605,22618,21033,21984,65888,65890,65893,65895,65894,65898,64583,13170">
      <Sockets>
        <Socket nodeId="21984" itemId="1"/>
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
Rarity: RARE
Storm Cluster
Large Cluster Jewel
Implicits: 3
Adds 8 Passive Skills
2 Added Passive Skills are Jewel Sockets
Added Small Passive Skills grant: 12% increased Lightning Damage
1 Added Passive Skill is Storm Drinker
1 Added Passive Skill is Prismatic Heart
    </Item>
    <ItemSet id="1"/>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_monk_quarterstaff_ice_strike',
    title: 'PoE 2 — Lv.90 Monk w/ Local-Mod Gothic Quarterstaff + Ice Strike Lv.20',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Monk Ice Strike"/>
  <Tree activeSpec="1">
    <Spec title="Monk" treeVersion="0_5" classId="10" classInternalId="10" ascendClassId="0" nodes="44683"/>
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
Frost Pillar
Gothic Quarterstaff
Quality: 20
Implicits: 0
120% increased Physical Damage
Adds 15 to 30 Physical Damage
15% increased Attack Speed
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
    id: 'poe1_impale_cyclone_marauder',
    title: 'PoE 1 — Impale Support + Brutality Cyclone Marauder (Hit DPS + Impale DPS + Combined DPS)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Impale Cyclone"/>
  <Tree activeSpec="1">
    <Spec title="RT" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175,31628,9511,23881,26523,6446,10221,50422,50570,29353,63282,31961"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemImpale" skillId="SupportImpale" nameSpec="Impale" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Doom Reaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ward_expedition_armour',
    title: 'PoE 1 — Expedition Ward Gear (Runic Crown + Runic Gauntlets + Runic Sabatons)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Expedition Ward"/>
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
Rarity: RARE
Rune Crown
Runic Crown
Quality: 20
Implicits: 0
+50 to Ward
80% increased Ward
    </Item>
    <Item id="2">
Rarity: RARE
Rune Grip
Runic Gauntlets
Quality: 20
Implicits: 0
+30 to Ward
60% increased Ward
    </Item>
    <Item id="3">
Rarity: RARE
Rune Stride
Runic Sabatons
Quality: 20
Implicits: 0
+40 to Ward
70% increased Ward
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
      <Slot name="Gloves" itemId="2"/>
      <Slot name="Boots" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_timeless_corrupted_soul_inner_conviction',
    title: 'PoE 1 — Timeless Keystones: Corrupted Soul (Replica Soul Tether) + Inner Conviction (3 Power Charges)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Timeless Keystones"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Replica Soul Tether
Cloth Belt
Implicits: 1
20% increased Stun and Block Recovery
+30 to Strength
Gain 6% of Maximum Life as Extra Maximum Energy Shield
Corrupted Soul
    </Item>
    <Item id="2">
Rarity: UNIQUE
Skin of the Lords
Simple Robe
Implicits: 0
Inner Conviction
    </Item>
    <ItemSet id="1">
      <Slot name="Belt" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="usePowerCharges" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_coc_trigger_cdr_ice_nova',
    title: 'PoE 1 — Cast On Critical Strike Ice Nova + Cyclone (15% CDR 7.57/s Breakpoint)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: CoC Ice Nova 15% CDR"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="2" mainActiveSkillCalcs="2" slot="Body Armour" label="CoC Ice Nova">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemIceNova" skillId="IceNova" nameSpec="Ice Nova" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemCastOnCrit" skillId="SupportCastOnCrit" nameSpec="Cast On Critical Strike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
CoC Foil
Jewelled Foil
Quality: 20
Implicits: 0
Your Hits can't be Evaded
25% increased Attack Speed
+100% to Critical Strike Chance
    </Item>
    <Item id="2">
Rarity: RARE
Cooldown Belt
Leather Belt
Implicits: 0
15% increased Cooldown Recovery Rate
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Belt" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_ranger_bow_lightning_arrow',
    title: 'PoE 2 — Lv.90 Ranger w/ 0.5 Tree + Local-Mod Recurve Bow + Lightning Arrow Lv.20',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ranger LA"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="0_5" classId="2" classInternalId="2" ascendClassId="0" nodes="50459,13828,56651,1140,49691,35234,38143,15507,31409"/>
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
Storm Recurve
Recurve Bow
Quality: 20
Implicits: 0
120% increased Physical Damage
Adds 12 to 24 Physical Damage
15% increased Attack Speed
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
    id: 'poe1_minion_srs_necromancer',
    title: 'PoE 1 — Minion Summon Raging Spirit Lv.20 + Minion Damage + Lord of the Dead + Anger',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: SRS Minion"/>
  <Tree activeSpec="1">
    <Spec title="Minion" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,11420,60554,27611"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="SRS">
        <Gem gemId="Metadata/Items/Gems/SkillGemSummonRagingSpirit" skillId="SummonRagingSpirit" nameSpec="Summon Raging Spirit" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemMinionDamage" skillId="SupportMinionDamage" nameSpec="Minion Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Anger">
        <Gem gemId="Metadata/Items/Gems/SkillGemAnger" skillId="Anger" nameSpec="Anger" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_auras_hatred_zealotry_haste',
    title: 'PoE 1 — Ethereal Knives Phys Spell + Hatred (39% Extra Cold) + Zealotry (15% More) + Haste',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: EK Triple Auras"/>
  <Tree activeSpec="1">
    <Spec title="Default" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ethereal Knives">
        <Gem gemId="Metadata/Items/Gems/SkillGemEtherealKnives" skillId="EtherealKnives" nameSpec="Ethereal Knives" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemHatred" skillId="Hatred" nameSpec="Hatred" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemZealotry" skillId="Zealotry" nameSpec="Zealotry" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemHaste" skillId="Haste" nameSpec="Haste" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_elemental_overload_fireball',
    title: 'PoE 1 — Elemental Overload Keystone (40% more Ele, No Crit Extra) + Fireball Lv.20',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Elemental Overload"/>
  <Tree activeSpec="1">
    <Spec title="EO" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,7938,14021,55332,22088"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_viper_strike_chaos_claw',
    title: 'PoE 1 — Viper Strike (60% Phys->Chaos) + Local-Mod Imperial Claw + Despair',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Viper Strike Chaos"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Viper Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemViperStrike" skillId="ViperStrike" nameSpec="Viper Strike" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Curse">
        <Gem gemId="Metadata/Items/Gems/SkillGemDespair" skillId="Despair" nameSpec="Despair" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Venom Talon
Imperial Claw
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 18 to 34 Physical Damage
20% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_warrior_mace_volcanic_fissure',
    title: 'PoE 2 — Lv.90 Warrior w/ 0.5 Tree + Local-Mod Aberrant Sledge + Volcanic Fissure Lv.20',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Warrior Volcanic Fissure"/>
  <Tree activeSpec="1">
    <Spec title="Warrior" treeVersion="0_5" classId="6" classInternalId="6" ascendClassId="0" nodes="47175,3936,38646,46325,1913,39581,33556"/>
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
Magma Crusher
Aberrant Sledge
Quality: 20
Implicits: 0
130% increased Physical Damage
Adds 20 to 40 Physical Damage
15% increased Attack Speed
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
    id: 'poe1_heralds_determination_precision',
    title: 'PoE 1 — Heavy Strike + Determination + Precision + Herald of Ash & Herald of Ice + Rare Vaal Axe',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Heralds + Determination + Precision"/>
  <Tree activeSpec="1">
    <Spec title="Duelist" treeVersion="3_30" classId="4" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras &amp; Heralds">
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemPrecision" skillId="Precision" nameSpec="Precision" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemHeraldOfAsh" skillId="HeraldOfAsh" nameSpec="Herald of Ash" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemHeraldOfIce" skillId="HeraldOfIce" nameSpec="Herald of Ice" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Blood Cleaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Iron Carapace
Glorious Plate
Quality: 20
Implicits: 0
+80 to maximum Life
80% increased Armour
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Body Armour" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_melee_phys_cruelty_lacerate',
    title: 'PoE 1 — Lacerate + Melee Physical Damage + Brutality + Cruelty + Rare Jewelled Foil',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Lacerate Melee Phys Brutality"/>
  <Tree activeSpec="1">
    <Spec title="Duelist" treeVersion="3_30" classId="4" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Lacerate">
        <Gem gemId="Metadata/Items/Gems/SkillGemLacerate" skillId="Lacerate" nameSpec="Lacerate" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage" skillId="SupportMeleePhysicalDamage" nameSpec="Melee Physical Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportCruelty" skillId="SupportCruelty" nameSpec="Cruelty" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crimson Needle
Jewelled Foil
Quality: 20
Implicits: 1
+25% to Global Critical Strike Multiplier
150% increased Physical Damage
Adds 18 to 36 Physical Damage
20% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_deadly_ailments_combustion_fireball',
    title: 'PoE 1 — Fireball + Combustion + Deadly Ailments (80% less Hit) + Elemental Focus',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Fireball Deadly Ailments"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportCombustion" skillId="SupportCombustion" nameSpec="Combustion" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportDeadlyAilments" skillId="SupportDeadlyAilments" nameSpec="Deadly Ailments" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportElementalFocus" skillId="SupportElementalFocus" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_void_manipulation_chaos_soulrend',
    title: 'PoE 1 — Soulrend + Void Manipulation + Controlled Destruction + Swift Affliction + Despair',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Soulrend Chaos Supports"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Soulrend">
        <Gem gemId="Metadata/Items/Gems/SkillGemSoulrend" skillId="Soulrend" nameSpec="Soulrend" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportVoidManipulation" skillId="SupportVoidManipulation" nameSpec="Void Manipulation" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSwiftAffliction" skillId="SupportSwiftAffliction" nameSpec="Swift Affliction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Curse">
        <Gem gemId="Metadata/Items/Gems/SkillGemDespair" skillId="Despair" nameSpec="Despair" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_evasion_suppression_snipers_mark_bow',
    title: 'PoE 1 — Ranger Lightning Arrow + Vicious Projectiles + Added Cold/Lightning + Sniper\'s Mark + Grace + Suppression',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Ranger Bow Mark &amp; Suppression"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrow" nameSpec="Lightning Arrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportViciousProjectiles" skillId="SupportViciousProjectiles" nameSpec="Vicious Projectiles" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedColdDamage" skillId="SupportAddedColdDamage" nameSpec="Added Cold Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedLightningDamage" skillId="SupportAddedLightningDamage" nameSpec="Added Lightning Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Aura &amp; Mark">
        <Gem gemId="Metadata/Items/Gems/SkillGemGrace" skillId="Grace" nameSpec="Grace" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSnipersMark" skillId="SnipersMark" nameSpec="Sniper's Mark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Reach
Imperial Bow
Quality: 20
Implicits: 1
24% increased Elemental Damage with Attack Skills
140% increased Physical Damage
16% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Gale Grips
Slink Gloves
Quality: 20
Implicits: 0
+70 to maximum Life
+14% chance to Suppress Spell Damage
80% increased Evasion Rating
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Gloves" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_frostbolt_totem_cold_pen',
    title: 'PoE 1 — Templar Frostbolt + Spell Totem + Cold Penetration + Added Cold + Controlled Destruction',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Cold Spell Totem"/>
  <Tree activeSpec="1">
    <Spec title="Templar" treeVersion="3_30" classId="5" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Frostbolt Totem">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostbolt" skillId="Frostbolt" nameSpec="Frostbolt" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSpellTotem" skillId="SupportSpellTotem" nameSpec="Spell Totem" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportColdPenetration" skillId="SupportColdPenetration" nameSpec="Cold Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedColdDamage" skillId="SupportAddedColdDamage" nameSpec="Added Cold Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_archmage_spark_spirit',
    title: 'PoE 2 — Lv.90 Sorceress Spark + Archmage (100 Spirit, 4% Extra Lightning / 100 Mana) + High-Mana Gear',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Archmage Spark"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,18845"/>
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
Mind Band
Sapphire Ring
Implicits: 1
+25% to Cold Resistance
+160 to maximum Mana
+30 to Intelligence
    </Item>
    <Item id="2">
Rarity: RARE
Mana Loop
Ruby Ring
Implicits: 1
+25% to Fire Resistance
+140 to maximum Mana
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
    id: 'poe2_witch_bone_cage_phys_spell',
    title: 'PoE 2 — Lv.90 Witch Bone Cage (Physical Spell, 15% Base Crit) + Spell Crit Rare Gear',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Witch Bone Cage"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="0_5" classId="1" classInternalId="1" ascendClassId="0" nodes="54447,4739,18845"/>
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
Ossuary Loop
Topaz Ring
Implicits: 1
+25% to Lightning Resistance
+60 to maximum Life
+25 to Intelligence
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_ranger_poisonburst_arrow_bow',
    title: 'PoE 2 — Lv.90 Ranger Poisonburst Arrow (274% AM) + Local-Mod Rare Gemini Bow',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ranger Poisonburst Arrow"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="0_5" classId="2" classInternalId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Poisonburst Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemPoisonBurstArrow" skillId="PoisonBurstArrowPlayer" nameSpec="Poisonburst Arrow" variantId="PoisonBurstArrow" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Venom Recurve
Gemini Bow
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 18 to 36 Physical Damage
15% increased Attack Speed
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
    id: 'poe2_weapon_set2_passives_swap',
    title: 'PoE 2 — Lv.90 Sorceress Weapon Set II Passive Swap (<WeaponSet1> ES vs <WeaponSet2> Spell Dmg)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Weapon Set 2 Passives"/>
  <Tree activeSpec="1">
    <Spec title="WeaponSetSwap" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,44871,30346,4739,18845">
      <WeaponSet1 nodes="44871,30346"/>
      <WeaponSet2 nodes="4739,18845"/>
    </Spec>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="FireballPlayer" nameSpec="Fireball" variantId="Fireball" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <ItemSet id="1" useSecondWeaponSet="true"/>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe1_full_dps_multi_srs_20x',
    title: 'PoE 1 — Full DPS: 20x Summon Raging Spirit Minions + Minion Damage + Anger',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 20x SRS Full DPS"/>
  <Tree activeSpec="1">
    <Spec title="Minion" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,11420,60554,27611"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" includeInFullDPS="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="20x SRS">
        <Gem gemId="Metadata/Items/Gems/SkillGemSummonRagingSpirit" skillId="SummonRagingSpirit" nameSpec="Summon Raging Spirit" level="20" quality="0" count="20" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SupportGemMinionDamage" skillId="SupportMinionDamage" nameSpec="Minion Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Anger">
        <Gem gemId="Metadata/Items/Gems/SkillGemAnger" skillId="Anger" nameSpec="Anger" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_full_dps_spell_totems_4x',
    title: 'PoE 1 — Full DPS: 4x Arc Spell Totems + Lightning Penetration + Controlled Destruction',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 4x Arc Spell Totems Full DPS"/>
  <Tree activeSpec="1">
    <Spec title="Templar" treeVersion="3_30" classId="5" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" includeInFullDPS="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="4x Arc Totem">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" count="4" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSpellTotem" skillId="SupportSpellTotem" nameSpec="Spell Totem" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportLightningPenetration" skillId="SupportLightningPenetration" nameSpec="Lightning Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ignite_elementalist_fireball_dot',
    title: 'PoE 1 — Elementalist Shaper of Flames Fireball + Combustion + Deadly Ailments + Swift Affliction (Hit & Ignite DPS)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1" buildName="Oracle: Elementalist Ignite Fireball"/>
  <Tree activeSpec="1">
    <Spec title="Ignite" treeVersion="3_30" classId="3" ascendClassId="2" nodes="54447,16023,12738,53123"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ignite Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportCombustion" skillId="SupportCombustion" nameSpec="Combustion" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportDeadlyAilments" skillId="SupportDeadlyAilments" nameSpec="Deadly Ailments" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSwiftAffliction" skillId="SupportSwiftAffliction" nameSpec="Swift Affliction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_bleed_lacerate_deadly_ailments',
    title: 'PoE 1 — Duelist Lacerate + Brutality + Deadly Ailments + Chance to Bleed + Rare Jewelled Foil',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Bleed Lacerate"/>
  <Tree activeSpec="1">
    <Spec title="Duelist" treeVersion="3_30" classId="4" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Lacerate Bleed">
        <Gem gemId="Metadata/Items/Gems/SkillGemLacerate" skillId="Lacerate" nameSpec="Lacerate" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportDeadlyAilments" skillId="SupportDeadlyAilments" nameSpec="Deadly Ailments" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportChancetoBleed" skillId="SupportChanceToBleed" nameSpec="Chance to Bleed" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Blood Edge
Jewelled Foil
Quality: 20
Implicits: 1
+25% to Global Critical Strike Multiplier
150% increased Physical Damage
Adds 18 to 36 Physical Damage
20% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_herald_of_thunder_wrath_spark',
    title: 'PoE 1 — Spark + Spell Echo + Faster Casting + Wrath + Herald of Thunder',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Spark Wrath Herald of Thunder"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="Spark" nameSpec="Spark" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSpellEcho" skillId="SupportSpellEcho" nameSpec="Spell Echo" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportFasterCasting" skillId="SupportFasterCasting" nameSpec="Faster Casting" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras &amp; Herald">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemHeraldOfThunder" skillId="HeraldOfThunder" nameSpec="Herald of Thunder" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ci_discipline_high_es_gear',
    title: 'PoE 1 — CI Witch + Discipline + Zealotry + Rare Vaal Regalia & Hubris Circlet + Arc Elemental Focus',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: CI Discipline High-ES"/>
  <Tree activeSpec="1">
    <Spec title="CI" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57226,21678,32210,8948,27659,37671,27415,32710,49605,60440,11455"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportElementalFocus" skillId="SupportElementalFocus" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemDiscipline" skillId="Discipline" nameSpec="Discipline" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemZealotry" skillId="Zealotry" nameSpec="Zealotry" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Astral Shroud
Vaal Regalia
Quality: 20
Implicits: 0
+90 to maximum Energy Shield
95% increased Energy Shield
+40 to Intelligence
    </Item>
    <Item id="2">
Rarity: RARE
Mind Crown
Hubris Circlet
Quality: 20
Implicits: 0
+65 to maximum Energy Shield
80% increased Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Helmet" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_huntress_spear_lightning_spear',
    title: 'PoE 2 — Lv.90 Huntress Lightning Spear (343% AM, 80% Phys->Light) + Local-Mod Rare Akoyan Spear',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Huntress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Huntress Lightning Spear"/>
  <Tree activeSpec="1">
    <Spec title="Huntress" treeVersion="0_5" classId="8" classInternalId="8" ascendClassId="0" nodes="50459"/>
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
Tempest Pike
Akoyan Spear
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 16 to 32 Physical Damage
15% increased Attack Speed
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
    id: 'poe2_druid_volcano_fire_spell',
    title: 'PoE 2 — Lv.90 Druid Volcano (Fire Spell, 8% Base Crit) + Rare Resistance Ring',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Druid Volcano"/>
  <Tree activeSpec="1">
    <Spec title="Druid" treeVersion="0_5" classId="11" classInternalId="11" ascendClassId="0" nodes="61525"/>
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
Ember Band
Ruby Ring
Implicits: 1
+25% to Fire Resistance
+65 to maximum Life
+25 to Strength
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_full_dps_dual_spell_sorc',
    title: 'PoE 2 — Full DPS: Lv.90 Sorceress Dual-Skill Spark + Comet Multi-Skill Aggregation',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Dual Spell Full DPS"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,18845"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" includeInFullDPS="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" count="1" enabled="true"/>
      </Skill>
      <Skill enabled="true" includeInFullDPS="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Comet">
        <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" variantId="Comet" level="20" quality="0" count="1" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_witch_chaos_essence_drain',
    title: 'PoE 2 — Lv.90 Witch Chaos Spell Essence Drain (Chaos [138, 257], 7% Base Crit)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Witch Essence Drain"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="0_5" classId="1" classInternalId="1" ascendClassId="0" nodes="54447,4739,18845"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Essence Drain">
        <Gem gemId="Metadata/Items/Gems/SkillGemEssenceDrain" skillId="EssenceDrainPlayer" nameSpec="Essence Drain" variantId="EssenceDrain" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe1_ice_trap_shadow_cold',
    title: 'PoE 1 — Shadow Ice Trap + Cold Penetration + Added Cold + Controlled Destruction',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Ice Trap Cold"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ice Trap">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceTrap" skillId="IceTrap" nameSpec="Ice Trap" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportColdPenetration" skillId="SupportColdPenetration" nameSpec="Cold Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedColdDamage" skillId="SupportAddedColdDamage" nameSpec="Added Cold Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_high_impact_mine_arc',
    title: 'PoE 1 — Shadow Arc + High-Impact Mine + Lightning Penetration + Added Lightning',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Arc High-Impact Mine"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc Mine">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportHighImpactMine" skillId="SupportHighImpactMine" nameSpec="High-Impact Mine" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportLightningPenetration" skillId="SupportLightningPenetration" nameSpec="Lightning Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedLightningDamage" skillId="SupportAddedLightningDamage" nameSpec="Added Lightning Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_essence_drain_chaos_spell',
    title: 'PoE 1 — Witch Essence Drain + Void Manipulation + Controlled Destruction + Swift Affliction + Despair',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Essence Drain Chaos"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Essence Drain">
        <Gem gemId="Metadata/Items/Gems/SkillGemEssenceDrain" skillId="EssenceDrain" nameSpec="Essence Drain" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportVoidManipulation" skillId="SupportVoidManipulation" nameSpec="Void Manipulation" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSwiftAffliction" skillId="SupportSwiftAffliction" nameSpec="Swift Affliction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Curse">
        <Gem gemId="Metadata/Items/Gems/SkillGemDespair" skillId="Despair" nameSpec="Despair" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ballista_totem_3x_full_dps',
    title: 'PoE 1 — Full DPS: 3x Ranger Lightning Arrow Ballista Totems + WED + Rare Imperial Bow',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 3x Ballista Totem Full DPS"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" includeInFullDPS="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="3x LA Ballista">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrow" nameSpec="Lightning Arrow" level="20" quality="0" count="3" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBallistaTotem" skillId="SupportBallistaTotem" nameSpec="Ballista Totem" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportWeaponElementalDamage" skillId="SupportWeaponElementalDamage" nameSpec="Elemental Damage with Attacks" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Tempest Bow
Imperial Bow
Quality: 20
Implicits: 1
24% increased Elemental Damage with Attack Skills
140% increased Physical Damage
16% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_exquisite_blade_cyclone_impale',
    title: 'PoE 1 — Marauder 2H Exquisite Blade (+50% Crit Multi) Cyclone + Brutality + Impale + Melee Phys + Determination',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 2H Sword Cyclone Impale"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone Impale">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportImpale" skillId="SupportImpale" nameSpec="Impale" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage" skillId="SupportMeleePhysicalDamage" nameSpec="Melee Physical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Aura">
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Starforged Edge
Exquisite Blade
Quality: 20
Implicits: 1
+50% to Global Critical Strike Multiplier
150% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_alira_bandit_herald_ice_nova',
    title: 'PoE 1 — Shadow Alira Bandit (+15% Ele Res) + Ice Nova + Spell Echo + Inc Crit Dmg + Herald of Ice + Assassin\'s Mark',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="Alira" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Alira Crit Ice Nova"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ice Nova">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceNova" skillId="IceNova" nameSpec="Ice Nova" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportSpellEcho" skillId="SupportSpellEcho" nameSpec="Spell Echo" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportIncreasedCriticalDamage" skillId="SupportIncreasedCriticalDamage" nameSpec="Increased Critical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Herald &amp; Mark">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeraldOfIce" skillId="HeraldOfIce" nameSpec="Herald of Ice" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemAssassinsMark" skillId="AssassinsMark" nameSpec="Assassin's Mark" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="bandit" string="Alira"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_mercenary_crossbow_explosive_grenade',
    title: 'PoE 2 — Lv.90 Mercenary (8/8 Classes) Explosive Grenade (878% AM, 80% Phys->Fire) + Rare Bombard Crossbow',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Mercenary" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Mercenary Crossbow Grenade"/>
  <Tree activeSpec="1">
    <Spec title="Mercenary" treeVersion="0_5" classId="9" classInternalId="9" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Explosive Grenade">
        <Gem gemId="Metadata/Items/Gems/SkillGemExplosiveGrenade" skillId="ExplosiveGrenadePlayer" nameSpec="Explosive Grenade" variantId="ExplosiveGrenade" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Hellfire Launcher
Bombard Crossbow
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 20 to 40 Physical Damage
15% increased Attack Speed
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
    id: 'poe2_monk_quarterstaff_storm_wave',
    title: 'PoE 2 — Lv.90 Monk Storm Wave (343% AM, 80% Phys->Light) + Local-Mod Crackling Quarterstaff',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Monk Storm Wave"/>
  <Tree activeSpec="1">
    <Spec title="Monk" treeVersion="0_5" classId="10" classInternalId="10" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Storm Wave">
        <Gem gemId="Metadata/Items/Gems/SkillGemStormWave" skillId="StormWavePlayer" nameSpec="Storm Wave" variantId="StormWave" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Gale Pillar
Crackling Quarterstaff
Quality: 20
Implicits: 0
130% increased Physical Damage
Adds 18 to 34 Physical Damage
15% increased Attack Speed
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
    id: 'poe2_sorc_arc_spell_crit_rings',
    title: 'PoE 2 — Lv.90 Sorceress Arc (Lightning [20, 386], 9% Base Crit) + Rare Rings & Spell Tree',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Sorc Arc"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447,4739,18845"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="ArcPlayer" nameSpec="Arc" variantId="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Loop
Topaz Ring
Implicits: 1
+25% to Lightning Resistance
+80 to maximum Mana
+30 to Intelligence
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_warrior_shield_sunder_block',
    title: 'PoE 2 — Lv.90 Warrior Sunder (653% AM) + Rare Bandit Mace + Ancestor Tower Shield (Armour & Block)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Warrior Sunder &amp; Shield"/>
  <Tree activeSpec="1">
    <Spec title="Warrior" treeVersion="0_5" classId="6" classInternalId="6" ascendClassId="0" nodes="47175"/>
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
Earthbreaker
Bandit Mace
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 15 to 30 Physical Damage
15% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Iron Bastion
Ancestor Tower Shield
Quality: 20
Implicits: 0
+80 to maximum Life
80% increased Armour
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
  // ─── Phase 12 Benchmarks (66..75): +Gem Level / Quality / Empower / Socketed / PoE 2 +Skills ───
  {
    id: 'poe1_ashes_of_stars_arc_gem_level',
    title: 'PoE 1 — Lv.90 Witch Arc + Wrath + Ashes of the Stars (+1 All Skill Gems, +25% Quality)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Ashes of the Stars Arc"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
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
+1 to Level of all Skill Gems
+25% to Quality of all Skill Gems
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
    id: 'poe1_plus2_lightning_wand_empower_ball_lightning',
    title: 'PoE 1 — Lv.90 Witch Ball Lightning + Empower Lv.3 + +2 Wand (+1 Spell, +1 Lightning Spell)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +2 Wand Empower Ball Lightning"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ball Lightning">
        <Gem gemId="Metadata/Items/Gems/SkillGemBallLightning" skillId="BallLightning" nameSpec="Ball Lightning" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEmpower" skillId="SupportEmpower" nameSpec="Empower" level="3" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Sceptre
Prophecy Wand
Implicits: 0
+1 to Level of all Spell Skill Gems
+1 to Level of all Lightning Spell Skill Gems
60% increased Spell Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_socketed_gems_chest_empower_spark',
    title: 'PoE 1 — Lv.90 Witch Spark + Empower Lv.3 in +1 Socketed Gems / +2 Socketed Support Chest (Lv.26 Spark)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +3 Socketed Empower Spark"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="Spark" nameSpec="Spark" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEmpower" skillId="SupportEmpower" nameSpec="Empower" level="3" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Arcane Shroud
Vaal Regalia
Quality: 20
Implicits: 0
+1 to Level of Socketed Gems
+2 to Level of Socketed Support Gems
+80 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_socketed_cold_helmet_ice_spear',
    title: 'PoE 1 — Lv.90 Shadow Ice Spear in +2 Socketed Cold Helmet + +1 Cold Spell Amulet (Lv.23)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +2 Socketed Cold Ice Spear"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Ice Spear">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceSpear" skillId="IceSpear" nameSpec="Ice Spear" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Frost Crown
Hubris Circlet
Quality: 20
Implicits: 0
+2 to Level of Socketed Cold Gems
+70 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Winter Pendant
Onyx Amulet
Implicits: 0
+1 to Level of all Cold Spell Skill Gems
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
      <Slot name="Amulet" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_fireball_plus3_staff_ignite',
    title: 'PoE 1 — Lv.90 Witch Fireball + +3 Fire Staff (+2 Fire Spell, +1 All Skill Gems) Hit & Ignite',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +3 Fireball Staff"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportCombustion" skillId="SupportCombustion" nameSpec="Combustion" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Pyre Spire
Eclipse Staff
Implicits: 0
+2 to Level of all Fire Spell Skill Gems
+1 to Level of all Skill Gems
80% increased Fire Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_aura_empower_plus2_helmet_wrath',
    title: 'PoE 1 — Lv.90 Templar Arc (Body) + Wrath & Empower Lv.3 in +2 Socketed Aura Helmet (Lv.24 Wrath)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +2 Aura Helmet Empower Wrath"/>
  <Tree activeSpec="1">
    <Spec title="Templar" treeVersion="3_30" classId="5" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Wrath">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEmpower" skillId="SupportEmpower" nameSpec="Empower" level="3" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Archon Crown
Mind Cage
Quality: 20
Implicits: 0
+2 to Level of Socketed Aura Gems
+60 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_plus4_lightning_wand_spark',
    title: 'PoE 2 — Lv.90 Sorceress Spark Lv.20 + +4 Lightning Spell Skills Attuned Wand (Lv.24 Spark)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 +4 Lightning Wand Spark"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
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
Tempest Rod
Attuned Wand
Implicits: 0
+4 to Level of all Lightning Spell Skills
70% increased Spell Damage
18% increased Cast Speed
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
    id: 'poe2_witch_plus3_chaos_wand_essence_drain',
    title: 'PoE 2 — Lv.90 Witch Essence Drain Lv.20 + +3 Chaos Spell Skills Bone Wand (Lv.23)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 +3 Chaos Wand Essence Drain"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="0_5" classId="1" classInternalId="1" ascendClassId="0" nodes="54447"/>
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
Rarity: RARE
Void Sceptre
Bone Wand
Implicits: 0
+3 to Level of all Chaos Spell Skills
60% increased Spell Damage
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
    id: 'poe2_ranger_plus3_projectile_bow_lightning_arrow',
    title: 'PoE 2 — Lv.90 Ranger Lightning Arrow Lv.20 + +3 Projectile Skills Composite Bow (Lv.23)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 +3 Projectile Bow Lightning Arrow"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="0_5" classId="2" classInternalId="2" ascendClassId="0" nodes="50459"/>
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
Stormstring
Composite Bow
Quality: 20
Implicits: 0
+3 to Level of all Projectile Skills
140% increased Physical Damage
18% increased Attack Speed
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
    id: 'poe2_monk_plus2_melee_quarterstaff_tempest_flurry',
    title: 'PoE 2 — Lv.90 Monk Tempest Flurry Lv.20 + +2 Melee Skills Crackling Quarterstaff (Lv.22)',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 +2 Melee Quarterstaff Tempest Flurry"/>
  <Tree activeSpec="1">
    <Spec title="Monk" treeVersion="0_5" classId="10" classInternalId="10" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Tempest Flurry">
        <Gem gemId="Metadata/Items/Gems/SkillGemTempestFlurry" skillId="TempestFlurryPlayer" nameSpec="Tempest Flurry" variantId="TempestFlurry" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Thunder Pillar
Crackling Quarterstaff
Quality: 20
Implicits: 0
+2 to Level of all Melee Skills
130% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 13 Benchmarks (76..85): Rage, Enlighten, Tempest Shield Spell Block & PoE 2 0.5 Supports ───
  {
    id: 'poe1_rage_30_marauder_heavy_strike',
    title: 'PoE 1 — Lv.90 Marauder Heavy Strike + Rage Support (30 Rage = 30% more Attack Dmg) + Rare Vaal Axe',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Marauder 30 Rage Heavy Strike"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportRage" skillId="SupportRage" nameSpec="Rage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Fury Cleaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="multiplierRage" number="30"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_enlighten4_double_aura_mana',
    title: 'PoE 1 — Lv.90 Templar Arc + Wrath & Discipline linked to Enlighten Lv.4 (88% Mana Multiplier)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Enlighten Lv.4 Auras"/>
  <Tree activeSpec="1">
    <Spec title="Templar" treeVersion="3_30" classId="5" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras + Enlighten">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemDiscipline" skillId="Discipline" nameSpec="Discipline" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEnlighten" skillId="SupportEnlighten" nameSpec="Enlighten" level="4" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_enlighten_socketed_plus1_plus2_auras',
    title: 'PoE 1 — Lv.90 Witch Spark + Wrath & Zealotry + Enlighten Lv.3 in +1 Gems/+2 Support Chest (Enlighten Lv.6 = 80%)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +3 Socketed Enlighten Auras"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="Spark" nameSpec="Spark" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Auras + Enlighten">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemZealotry" skillId="Zealotry" nameSpec="Zealotry" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEnlighten" skillId="SupportEnlighten" nameSpec="Enlighten" level="3" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Aura Shroud
Vaal Regalia
Quality: 20
Implicits: 0
+1 to Level of Socketed Gems
+2 to Level of Socketed Support Gems
+80 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_tempest_shield_spell_block_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + Tempest Shield (+25% Spell Block, 25% Mana Res) + Titanium Spirit Shield',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Tempest Shield Spell Block"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Weapon 2" label="Tempest Shield">
        <Gem gemId="Metadata/Items/Gems/SkillGemTempestShield" skillId="TempestShield" nameSpec="Tempest Shield" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Aegis Shell
Titanium Spirit Shield
Quality: 20
Implicits: 0
+80 to maximum Energy Shield
60% increased Energy Shield
+12% Chance to Block Spell Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 2" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_glacial_cascade_hatred_conc_effect',
    title: 'PoE 1 — Lv.90 Shadow Glacial Cascade (100% Phys->Cold) + Concentrated Effect + Controlled Destruction + Hatred',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Glacial Cascade Hatred Conc Effect"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Glacial Cascade">
        <Gem gemId="Metadata/Items/Gems/SkillGemGlacialCascade" skillId="GlacialCascade" nameSpec="Glacial Cascade" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportConcentratedEffect" skillId="SupportConcentratedEffect" nameSpec="Concentrated Effect" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Hatred">
        <Gem gemId="Metadata/Items/Gems/SkillGemHatred" skillId="Hatred" nameSpec="Hatred" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_double_strike_rage20_impale_brutality',
    title: 'PoE 1 — Lv.90 Duelist Double Strike + Rage (20) + Brutality + Melee Phys + Impale + Rare Jewelled Foil',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Double Strike Rage Impale"/>
  <Tree activeSpec="1">
    <Spec title="Duelist" treeVersion="3_30" classId="4" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Double Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemDoubleStrike" skillId="DoubleStrike" nameSpec="Double Strike" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportRage" skillId="SupportRage" nameSpec="Rage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage" skillId="SupportMeleePhysicalDamage" nameSpec="Melee Physical Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportImpale" skillId="SupportImpale" nameSpec="Impale" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crimson Spike
Jewelled Foil
Quality: 20
Implicits: 1
+25% to Global Critical Strike Multiplier
150% increased Physical Damage
Adds 18 to 36 Physical Damage
20% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="multiplierRage" number="20"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_spark_controlled_destruction_rapid_casting',
    title: 'PoE 2 — Lv.90 Sorceress Spark + Controlled Destruction + Rapid Casting I + Elemental Focus',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Spark Multi-Supports"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidCastingSupport" skillId="SupportRapidCastingPlayer" nameSpec="Rapid Casting I" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_warrior_rage_30_sunder_brutality_conc_area',
    title: 'PoE 2 — Lv.90 Warrior Sunder + Rage I (30 Rage) + Brutality I + Concentrated Area + Rare Bandit Mace',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Warrior 30 Rage Sunder"/>
  <Tree activeSpec="1">
    <Spec title="Warrior" treeVersion="0_5" classId="6" classInternalId="6" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Sunder">
        <Gem gemId="Metadata/Items/Gems/SkillGemSunder" skillId="SunderPlayer" nameSpec="Sunder" variantId="Sunder" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRageSupport" skillId="SupportRagePlayer" nameSpec="Rage I" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemBrutalitySupport" skillId="SupportBrutalityPlayer" nameSpec="Brutality I" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Rage Crusher
Bandit Mace
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 15 to 30 Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="multiplierRage" number="30"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  {
    id: 'poe2_ranger_lightning_arrow_elemental_focus_rapid_attacks',
    title: 'PoE 2 — Lv.90 Ranger Lightning Arrow + Elemental Focus + Rapid Attacks I + Rare Composite Bow',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ranger LA Supports"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="0_5" classId="2" classInternalId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrowPlayer" nameSpec="Lightning Arrow" variantId="LightningArrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Gale Bow
Composite Bow
Quality: 20
Implicits: 0
140% increased Physical Damage
18% increased Attack Speed
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
    id: 'poe2_monk_ice_strike_elemental_focus_conc_area',
    title: 'PoE 2 — Lv.90 Monk Ice Strike + Elemental Focus + Concentrated Area + Rapid Attacks I + Crackling Quarterstaff',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Monk Ice Strike Supports"/>
  <Tree activeSpec="1">
    <Spec title="Monk" treeVersion="0_5" classId="10" classInternalId="10" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Ice Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceStrike" skillId="IceStrikePlayer" nameSpec="Ice Strike" variantId="IceStrike" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Frost Pillar
Crackling Quarterstaff
Quality: 20
Implicits: 0
130% increased Physical Damage
Adds 18 to 34 Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 14 Benchmarks (86..100 — 100/100 MILESTONE!): Purity Auras, Fortify, Multi-Spec/ItemSet & PoE 2 Mastery ───
  {
    id: 'poe1_purity_of_elements_fire_max_res',
    title: 'PoE 1 — Lv.90 Marauder Purity of Elements (+34% All Res) + Purity of Fire (+41% Fire, +4% Max Fire = 79%)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Purity Max Fire Res"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Purity Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemPurityOfElements" skillId="PurityOfElements" nameSpec="Purity of Elements" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemPurityOfFire" skillId="PurityOfFire" nameSpec="Purity of Fire" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Ember Mail
Glorious Plate
Quality: 20
Implicits: 0
+90 to maximum Life
+45% to Fire Resistance
+45% to Cold Resistance
+45% to Lightning Resistance
    </Item>
    <Item id="2">
Rarity: RARE
Ruby Loop
Ruby Ring
Implicits: 1
+30% to Fire Resistance
+40% to Fire Resistance
+40% to Cold Resistance
+40% to Lightning Resistance
    </Item>
    <Item id="3">
Rarity: RARE
Iron Cleaver
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Weapon 1" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_fortify_20_marauder_earthshatter',
    title: 'PoE 1 — Lv.90 Marauder Earthshatter + Brutality + Melee Phys + 20 Fortification + Rare Vaal Axe',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Fortified Earthshatter"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Earthshatter">
        <Gem gemId="Metadata/Items/Gems/SkillGemEarthshatter" skillId="Earthshatter" nameSpec="Earthshatter" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage" skillId="SupportMeleePhysicalDamage" nameSpec="Melee Physical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Quake Cleaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="buffFortification" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_frost_blades_cold_pen_wed_claw',
    title: 'PoE 1 — Lv.90 Shadow Frost Blades (60% Phys->Cold) + WED + Cold Penetration + Added Cold + Imperial Claw',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Frost Blades Claw"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Frost Blades">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostBlades" skillId="FrostBlades" nameSpec="Frost Blades" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportElementalDamageWithAttacks" skillId="SupportElementalDamageWithAttacks" nameSpec="Elemental Damage with Attacks" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportColdPenetration" skillId="SupportColdPenetration" nameSpec="Cold Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedColdDamage" skillId="SupportAddedColdDamage" nameSpec="Added Cold Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Glacier Fang
Imperial Claw
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 18 to 34 Physical Damage
20% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ethereal_knives_hatred_herald_ash_phys_spell',
    title: 'PoE 1 — Lv.90 Shadow Ethereal Knives (Pure Phys Spell) + Added Fire + Controlled Destruction + Hatred + Herald of Ash',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: EK Hatred Herald of Ash"/>
  <Tree activeSpec="1">
    <Spec title="Shadow" treeVersion="3_30" classId="6" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ethereal Knives">
        <Gem gemId="Metadata/Items/Gems/SkillGemEtherealKnives" skillId="EtherealKnives" nameSpec="Ethereal Knives" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportAddedFireDamage" skillId="SupportAddedFireDamage" nameSpec="Added Fire Damage" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemHatred" skillId="Hatred" nameSpec="Hatred" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemHeraldOfAsh" skillId="HeraldOfAsh" nameSpec="Herald of Ash" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_split_arrow_brutality_vicious_impale_bow',
    title: 'PoE 1 — Lv.90 Ranger Split Arrow + Brutality + Vicious Projectiles + Impale + Rare Imperial Bow',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Split Arrow Impale Bow"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Split Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemSplitArrow" skillId="SplitArrow" nameSpec="Split Arrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportViciousProjectiles" skillId="SupportViciousProjectiles" nameSpec="Vicious Projectiles" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportImpale" skillId="SupportImpale" nameSpec="Impale" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Steelstring
Imperial Bow
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 20 to 40 Physical Damage
16% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_ground_slam_conc_brutality_melee_phys_mace',
    title: 'PoE 1 — Lv.90 Marauder Ground Slam + Concentrated Effect + Brutality + Melee Phys + Karui Maul',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Ground Slam Karui Maul"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ground Slam">
        <Gem gemId="Metadata/Items/Gems/SkillGemGroundSlam" skillId="GroundSlam" nameSpec="Ground Slam" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportConcentratedEffect" skillId="SupportConcentratedEffect" nameSpec="Concentrated Effect" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage" skillId="SupportMeleePhysicalDamage" nameSpec="Melee Physical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Titan Hammer
Karui Maul
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 20 to 40 Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_bladefall_phys_to_light_wrath',
    title: 'PoE 1 — Lv.90 Witch Bladefall + Physical to Lightning + Lightning Penetration + Controlled Destruction + Wrath',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Bladefall Phys-to-Light"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Bladefall">
        <Gem gemId="Metadata/Items/Gems/SkillGemBladefall" skillId="Bladefall" nameSpec="Bladefall" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportPhysicalToLightning" skillId="SupportPhysicalToLightning" nameSpec="Physical to Lightning" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportLightningPenetration" skillId="SupportLightningPenetration" nameSpec="Lightning Penetration" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Wrath">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_purity_of_ice_lightning_max_res_templar',
    title: 'PoE 1 — Lv.90 Templar Arc + Purity of Ice (+4% Max Cold) + Purity of Lightning (+4% Max Light) -> 79%/79% Res',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Purity Ice &amp; Lightning Max Res"/>
  <Tree activeSpec="1">
    <Spec title="Templar" treeVersion="3_30" classId="5" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Purities">
        <Gem gemId="Metadata/Items/Gems/SkillGemPurityOfIce" skillId="PurityOfIce" nameSpec="Purity of Ice" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemPurityOfLightning" skillId="PurityOfLightning" nameSpec="Purity of Lightning" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Band
Two-Stone Ring
Implicits: 1
+16% to Cold and Lightning Resistances
+45% to Cold Resistance
+45% to Lightning Resistance
    </Item>
    <Item id="2">
Rarity: RARE
Frost Belt
Leather Belt
Implicits: 1
+40 to maximum Life
+45% to Cold Resistance
+45% to Lightning Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
      <Slot name="Belt" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_multi_spec_multi_itemset_arc_empower',
    title: 'PoE 1 — Multi-Spec (<Tree activeSpec="2">) + Multi-ItemSet (<Items activeItemSet="2">) Arc + Empower Lv.4 + +1 Wand',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Multi-Spec &amp; Multi-ItemSet"/>
  <Tree activeSpec="2">
    <Spec title="Leveling" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
    <Spec title="Endgame" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57264,37569,36542,4397,11420"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportEmpower" skillId="SupportEmpower" nameSpec="Empower" level="4" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="2">
    <Item id="1">
Rarity: RARE
Starter Twig
Driftwood Wand
Implicits: 0
20% increased Spell Damage
    </Item>
    <Item id="2">
Rarity: RARE
Endgame Rod
Prophecy Wand
Implicits: 0
+1 to Level of all Spell Skill Gems
70% increased Spell Damage
18% increased Cast Speed
    </Item>
    <ItemSet id="1" title="Leveling Gear">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
    <ItemSet id="2" title="Endgame Gear">
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_fireball_plus3_wand_supports',
    title: 'PoE 2 — Lv.90 Sorceress Fireball + Elemental Focus + Rapid Casting I + Controlled Destruction + +3 Fire Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Fireball +3 Wand"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="FireballPlayer" nameSpec="Fireball" variantId="Fireball" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidCastingSupport" skillId="SupportRapidCastingPlayer" nameSpec="Rapid Casting I" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Cinder Rod
Attuned Wand
Implicits: 0
+3 to Level of all Fire Spell Skills
65% increased Spell Damage
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
    id: 'poe2_witch_ice_nova_plus3_cold_wand',
    title: 'PoE 2 — Lv.90 Witch Ice Nova + Controlled Destruction + Concentrated Area + Elemental Focus + +3 Cold Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ice Nova +3 Cold Wand"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="0_5" classId="1" classInternalId="1" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Ice Nova">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceNova" skillId="IceNovaPlayer" nameSpec="Ice Nova" variantId="IceNova" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Frost Sceptre
Bone Wand
Implicits: 0
+3 to Level of all Cold Spell Skills
55% increased Spell Damage
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
    id: 'poe2_huntress_lightning_spear_plus2_proj_supports',
    title: 'PoE 2 — Lv.90 Huntress Lightning Spear + Elemental Focus + Rapid Attacks I + +2 Projectile Akoyan Spear',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Huntress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Huntress +2 Lightning Spear"/>
  <Tree activeSpec="1">
    <Spec title="Huntress" treeVersion="0_5" classId="8" classInternalId="8" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Spear">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningSpear" skillId="LightningSpearPlayer" nameSpec="Lightning Spear" variantId="LightningSpear" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
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
+2 to Level of all Projectile Skills
130% increased Physical Damage
15% increased Attack Speed
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
    id: 'poe2_mercenary_explosive_grenade_conc_ele_focus',
    title: 'PoE 2 — Lv.90 Mercenary Explosive Grenade + Concentrated Area + Elemental Focus + Rare Bombard Crossbow',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Mercenary" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Mercenary Grenade Supports"/>
  <Tree activeSpec="1">
    <Spec title="Mercenary" treeVersion="0_5" classId="9" classInternalId="9" ascendClassId="0" nodes="50986"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Explosive Grenade">
        <Gem gemId="Metadata/Items/Gems/SkillGemExplosiveGrenade" skillId="ExplosiveGrenadePlayer" nameSpec="Explosive Grenade" variantId="ExplosiveGrenade" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Siege Repeater
Bombard Crossbow
Quality: 20
Implicits: 0
140% increased Physical Damage
Adds 15 to 30 Physical Damage
15% increased Attack Speed
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
    id: 'poe2_druid_volcano_plus3_fire_wand_supports',
    title: 'PoE 2 — Lv.90 Druid Volcano + Elemental Focus + Concentrated Area + Controlled Destruction + +3 Fire Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Druid Volcano +3 Wand"/>
  <Tree activeSpec="1">
    <Spec title="Druid" treeVersion="0_5" classId="11" classInternalId="11" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcano">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcano" skillId="VolcanoPlayer" nameSpec="Volcano" variantId="Volcano" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Magma Wand
Attuned Wand
Implicits: 0
+3 to Level of all Fire Spell Skills
60% increased Spell Damage
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
    id: 'poe2_warrior_volcanic_fissure_rage30_plus2_melee',
    title: 'PoE 2 — #100 Milestone: Lv.90 Warrior Volcanic Fissure + 30 Rage + Conc Area + Rapid Attacks I + +2 Melee Sledge',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Oracle #100: PoE2 Warrior Volcanic Fissure"/>
  <Tree activeSpec="1">
    <Spec title="Warrior" treeVersion="0_5" classId="6" classInternalId="6" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcanic Fissure">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcanicFissure" skillId="VolcanicFissurePlayer" nameSpec="Volcanic Fissure" variantId="VolcanicFissure" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRageSupport" skillId="SupportRagePlayer" nameSpec="Rage I" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Volcanic Crusher
Aberrant Sledge
Quality: 20
Implicits: 0
+2 to Level of all Melee Skills
130% increased Physical Damage
Adds 20 to 40 Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="multiplierRage" number="30"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 15 Benchmarks (101..105): Inquisitor Inevitable Judgement, +All Max Res, Multi-SkillSet, Eldritch Battery & PoE 2 Archmage +4 Wand ───
  {
    id: 'poe1_inquisitor_inevitable_judgement_crit_arc',
    title: 'PoE 1 — Lv.90 Templar Inquisitor (Righteous Providence + Inevitable Judgement) Crit Arc vs Pinnacle Boss',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="Inquisitor" mainSocketGroup="1" buildName="Oracle: Inquisitor Inevitable Judgement"/>
  <Tree activeSpec="1">
    <Spec title="Inquisitor" treeVersion="3_30" classId="5" ascendClassId="1" nodes="61525,61871,662,53884,37486,48214"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportIncreasedCriticalDamage" skillId="SupportIncreasedCriticalDamage" nameSpec="Increased Critical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Judgement Rod
Prophecy Wand
Implicits: 0
100% increased Critical Strike Chance for Spells
+35% to Global Critical Strike Multiplier
60% increased Spell Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="enemyIsBoss" string="Pinnacle"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_all_max_ele_res_brass_dome_marauder',
    title: 'PoE 1 — Lv.90 Marauder +5% to all maximum Elemental Resistances (80%/80%/80% Capped Ele Res)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: +5% All Max Ele Res"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Bastion Plate
Glorious Plate
Quality: 20
Implicits: 0
+5% to all maximum Elemental Resistances
+100 to maximum Life
+45% to Fire Resistance
+45% to Cold Resistance
+45% to Lightning Resistance
    </Item>
    <Item id="2">
Rarity: RARE
Prism Loop
Prismatic Ring
Implicits: 0
+45% to Fire Resistance
+45% to Cold Resistance
+45% to Lightning Resistance
    </Item>
    <Item id="3">
Rarity: RARE
Bastion Ring
Prismatic Ring
Implicits: 0
+50% to Fire Resistance
+50% to Cold Resistance
+50% to Lightning Resistance
    </Item>
    <Item id="4">
Rarity: RARE
Iron Cleaver
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
      <Slot name="Ring 2" itemId="3"/>
      <Slot name="Weapon 1" itemId="4"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_multi_skillset_arc_fireball_xml',
    title: 'PoE 1 — Lv.90 Witch Multi-SkillSet XML (<Skills activeSkillSet="2">: Set 1 Arc -> Active Set 2 Fireball)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Multi-SkillSet XML"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="2" defaultGemQuality="0">
    <SkillSet id="1" title="Clear">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
    <SkillSet id="2" title="Boss">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Fireball">
        <Gem gemId="Metadata/Items/Gems/SkillGemFireball" skillId="Fireball" nameSpec="Fireball" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportCombustion" skillId="SupportCombustion" nameSpec="Combustion" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_eldritch_battery_mom_witch_es',
    title: 'PoE 1 — Lv.90 Witch Eldritch Battery Keystone + High-ES Vaal Regalia + Arc',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Eldritch Battery Witch"/>
  <Tree activeSpec="1">
    <Spec title="Witch EB" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447,57226,21678,32210,8948,38176,49651,5296,33310,56075"/>
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
Rarity: RARE
Eldritch Shroud
Vaal Regalia
Quality: 20
Implicits: 0
+120 to maximum Energy Shield
80% increased Energy Shield
+90 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_archmage_spark_plus4_wand_rapid_casting',
    title: 'PoE 2 — Lv.90 Sorceress Archmage (100 Spirit) Spark + Elemental Focus + Rapid Casting I + +4 Lightning Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Archmage +4 Wand Spark"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="SparkPlayer" nameSpec="Spark" variantId="Spark" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidCastingSupport" skillId="SupportRapidCastingPlayer" nameSpec="Rapid Casting I" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Archmage">
        <Gem gemId="Metadata/Items/Gems/SkillGemArchmage" skillId="ArchmagePlayer" nameSpec="Archmage" variantId="Archmage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Stormcaller
Attuned Wand
Implicits: 0
+4 to Level of all Lightning Spell Skills
80% increased Spell Damage
+150 to maximum Mana
    </Item>
    <Item id="2">
Rarity: RARE
Mind Vestment
Hexer's Robe
Implicits: 0
+200 to maximum Mana
+100 to Spirit
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
  // ─── Phase 16 Benchmarks (106..110): Berserker, Slayer Overwhelm, Iron Will, Necromancer SRS & PoE 2 Frenzy Bow ───
  {
    id: 'poe1_berserker_aspect_of_carnage_crave_the_slaughter_rage30',
    title: 'PoE 1 — Lv.90 Marauder Berserker (Aspect of Carnage + Crave the Slaughter + 30 Rage) Heavy Strike',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="Berserker" mainSocketGroup="1" buildName="Oracle: Berserker Carnage + Crave"/>
  <Tree activeSpec="1">
    <Spec title="Berserker" treeVersion="3_30" classId="1" ascendClassId="2" nodes="47175,29294,63673,59920,63583,24528"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportRage" skillId="SupportRage" nameSpec="Rage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Carnage Cleaver
Vaal Axe
Quality: 20
Implicits: 0
150% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="multiplierRage" number="30"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_slayer_overwhelm_8pct_base_crit_cyclone',
    title: 'PoE 1 — Lv.90 Duelist Slayer (Overwhelm 8% Base Weapon Crit) Crit Cyclone + Vaal Axe',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="Slayer" mainSocketGroup="1" buildName="Oracle: Slayer Overwhelm 8% Base Crit"/>
  <Tree activeSpec="1">
    <Spec title="Slayer" treeVersion="3_30" classId="4" ascendClassId="1" nodes="50986,33795,61393,17315"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Cyclone">
        <Gem gemId="Metadata/Items/Gems/SkillGemCyclone" skillId="Cyclone" nameSpec="Cyclone" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportBrutality" skillId="SupportBrutality" nameSpec="Brutality" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportIncreasedCriticalDamage" skillId="SupportIncreasedCriticalDamage" nameSpec="Increased Critical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Slayer Chopper
Vaal Axe
Quality: 20
Implicits: 0
160% increased Physical Damage
Adds 20 to 40 Physical Damage
18% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Precision Loop
Diamond Ring
Implicits: 1
25% increased Global Critical Strike Chance
+400 to Accuracy Rating
+30% to Global Critical Strike Multiplier
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_iron_will_strength_stacking_marauder_arc',
    title: 'PoE 1 — Lv.90 Marauder Iron Will Keystone (Strength-Stacking Spell Damage) + Arc',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Iron Will Strength Stacker"/>
  <Tree activeSpec="1">
    <Spec title="Iron Will" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175,31628,9511,23881,26523,44606,50862,15405,33740,46910,50288"/>
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
Rarity: RARE
Titan Sash
Heavy Belt
Implicits: 1
+35 to Strength
+55 to Strength
+80 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Brute Amulet
Amber Amulet
Implicits: 1
+30 to Strength
+55 to Strength
+30 to all Attributes
    </Item>
    <Item id="3">
Rarity: RARE
Titan Ring
Ruby Ring
Implicits: 0
+55 to Strength
+30 to all Attributes
    </Item>
    <ItemSet id="1">
      <Slot name="Belt" itemId="1"/>
      <Slot name="Amulet" itemId="2"/>
      <Slot name="Ring 1" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_necromancer_mindless_aggression_srs_20',
    title: 'PoE 1 — Lv.90 Witch Necromancer (Mindless Aggression 10% More Minion Dmg) + 20x SRS Full DPS + Wrath',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="Necromancer" mainSocketGroup="1" buildName="Oracle: Necromancer Mindless Aggression SRS"/>
  <Tree activeSpec="1">
    <Spec title="Necromancer" treeVersion="3_30" classId="3" ascendClassId="3" nodes="54447,60791,26298,54159"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" includeInFullDPS="true" slot="Body Armour" label="SRS">
        <Gem gemId="Metadata/Items/Gems/SkillGemSummonRagingSpirit" skillId="SummonRagingSpirit" nameSpec="Summon Raging Spirit" level="20" quality="0" enabled="true" count="20"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportMinionDamage" skillId="SupportMinionDamage" nameSpec="Minion Damage" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Wrath">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_ranger_lightning_arrow_frenzy3_plus3_bow_supports',
    title: 'PoE 2 — Lv.90 Ranger Lightning Arrow + Elemental Focus + Rapid Attacks I + +3 Projectile Bow + Onslaught',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Ranger LA +3 Bow Onslaught"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="0_5" classId="2" classInternalId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrowPlayer" nameSpec="Lightning Arrow" variantId="LightningArrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Tempest Arc
Composite Bow
Quality: 20
Implicits: 0
+3 to Level of all Projectile Skills
150% increased Physical Damage
Adds 20 to 40 Physical Damage
20% increased Attack Speed
    </Item>
    <Item id="2">
Rarity: RARE
Hawk Eye
Emerald Ring
Implicits: 0
+300 to Accuracy Rating
25% increased Lightning Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Ring 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="buffOnslaught" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 17 Benchmarks (111..115 — 3 codex-ais Orchestrated Workers): Juggernaut Unbreakable, Trickster Escape Artist/Polymath, Flat Base Crit & PoE 2 Monk Onslaught ───
  {
    id: 'poe1_juggernaut_unbreakable_double_body_armour',
    title: 'PoE 1 — Lv.90 Marauder Juggernaut (Unbreakable: Body Armour Doubled) + Glorious Plate + Heavy Strike',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="Juggernaut" mainSocketGroup="1" buildName="Oracle: Juggernaut Unbreakable"/>
  <Tree activeSpec="1">
    <Spec title="Juggernaut" treeVersion="3_30" classId="1" ascendClassId="1" nodes="47175,17765,51998,53816"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Titan Plate
Glorious Plate
Quality: 20
Implicits: 0
+400 to Armour
100% increased Armour
+100 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Jugg Axe
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_trickster_escape_artist_evasion_es',
    title: 'PoE 1 — Lv.90 Shadow Trickster (Escape Artist: Body Evasion -> ES & Helmet ES -> Evasion) + Ice Spear',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="Trickster" mainSocketGroup="1" buildName="Oracle: Trickster Escape Artist"/>
  <Tree activeSpec="1">
    <Spec title="Trickster" treeVersion="3_30" classId="6" ascendClassId="2" nodes="44683,55236,19587,29825"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ice Spear">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceSpear" skillId="IceSpear" nameSpec="Ice Spear" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Shadow Garb
Assassin's Garb
Quality: 20
Implicits: 0
+400 to Evasion Rating
100% increased Evasion Rating
+90 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Phantom Circlet
Hubris Circlet
Quality: 20
Implicits: 0
+80 to maximum Energy Shield
80% increased Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Helmet" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_flat_base_crit_body_armour_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + Flat +2% Base Crit Chance + Spell Crit Wand',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Flat +2% Base Crit Arc"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportIncreasedCriticalDamage" skillId="SupportIncreasedCriticalDamage" nameSpec="Increased Critical Damage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Crit Shroud
Vaal Regalia
Quality: 20
Implicits: 0
+2% to Critical Strike Chance
+90 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Spark Rod
Prophecy Wand
Implicits: 0
100% increased Critical Strike Chance for Spells
+30% to Global Critical Strike Multiplier
50% increased Spell Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_trickster_polymath_spark_wand',
    title: 'PoE 1 — Lv.90 Shadow Trickster (Polymath Ascendancy) Spark + Elemental Focus + Controlled Destruction',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Shadow" ascendClassName="Trickster" mainSocketGroup="1" buildName="Oracle: Trickster Polymath Spark"/>
  <Tree activeSpec="1">
    <Spec title="Trickster" treeVersion="3_30" classId="6" ascendClassId="2" nodes="44683,55236,13219,55867"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Spark">
        <Gem gemId="Metadata/Items/Gems/SkillGemSpark" skillId="Spark" nameSpec="Spark" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportElementalFocus" skillId="SupportElementalFocus" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportControlledDestruction" skillId="SupportControlledDestruction" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Storm Wand
Prophecy Wand
Implicits: 0
+1 to Level of all Lightning Spell Skill Gems
70% increased Spell Damage
16% increased Cast Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_monk_tempest_flurry_onslaught_plus2_quarterstaff',
    title: 'PoE 2 — Lv.90 Monk Tempest Flurry + Elemental Focus + Rapid Attacks I + +2 Melee Quarterstaff + Onslaught',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Monk" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: PoE2 Monk Tempest Flurry Onslaught"/>
  <Tree activeSpec="1">
    <Spec title="Monk" treeVersion="0_5" classId="10" classInternalId="10" ascendClassId="0" nodes="44683"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Tempest Flurry">
        <Gem gemId="Metadata/Items/Gems/SkillGemTempestFlurry" skillId="TempestFlurryPlayer" nameSpec="Tempest Flurry" variantId="TempestFlurry" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidAttacksSupport" skillId="SupportRapidAttacksPlayer" nameSpec="Rapid Attacks I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Gale Pillar
Crackling Quarterstaff
Quality: 20
Implicits: 0
+2 to Level of all Melee Skills
140% increased Physical Damage
Adds 18 to 34 Physical Damage
18% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="buffOnslaught" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 18 Benchmarks (116..120 — 120/120 MILESTONE!): Aura Effect, Curse Effect, Ele Conversion Chain & PoE 2 Comet Archmage ───
  {
    id: 'poe1_aura_effect_50_wrath_discipline_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + Wrath & Discipline + 50% increased Non-Curse Aura Effect',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 50% Aura Effect Wrath Discipline"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Auras">
        <Gem gemId="Metadata/Items/Gems/SkillGemWrath" skillId="Wrath" nameSpec="Wrath" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemDiscipline" skillId="Discipline" nameSpec="Discipline" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Aura Vestment
Vaal Regalia
Quality: 20
Implicits: 0
50% increased effect of Non-Curse Auras from your Skills
+90 to maximum Life
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_curse_effect_50_conductivity_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + Conductivity + 50% increased Curse Effect (-54% Enemy Light Res)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 50% Curse Effect Conductivity"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Conductivity">
        <Gem gemId="Metadata/Items/Gems/SkillGemConductivity" skillId="Conductivity" nameSpec="Conductivity" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Hex Talisman
Onyx Amulet
Implicits: 0
50% increased Effect of your Curses
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
    id: 'poe1_lightning_to_cold_to_fire_conversion_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + 40% Lightning->Cold + 50% Cold->Fire Conversion Chain',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Light to Cold to Fire Conversion"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
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
Rarity: RARE
Brotherhood Band
Two-Stone Ring
Implicits: 0
40% of Lightning Damage Converted to Cold Damage
40% increased Cold Damage
    </Item>
    <Item id="2">
Rarity: RARE
Pyre Band
Two-Stone Ring
Implicits: 0
50% of Cold Damage Converted to Fire Damage
40% increased Fire Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Ring 1" itemId="1"/>
      <Slot name="Ring 2" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_aura_effect_40_determination_armour_marauder',
    title: 'PoE 1 — Lv.90 Marauder Determination + 40% Non-Curse Aura Effect + Glorious Plate Armour Scaling',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 40% Aura Effect Determination"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Helmet" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Determination">
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Fortress Plate
Glorious Plate
Quality: 20
Implicits: 0
40% increased effect of Non-Curse Auras from your Skills
+300 to Armour
+90 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Iron Axe
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_sorc_comet_plus4_cold_wand_archmage',
    title: 'PoE 2 — #120 Milestone: Lv.90 Sorceress Comet + Archmage + Conc Area + Controlled Destruction + +4 Cold Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Sorceress" ascendClassName="None" mainSocketGroup="1" buildName="Oracle #120: PoE2 Archmage Comet +4 Wand"/>
  <Tree activeSpec="1">
    <Spec title="Sorceress" treeVersion="0_5" classId="7" classInternalId="7" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Comet">
        <Gem gemId="Metadata/Items/Gems/SkillGemComet" skillId="CometPlayer" nameSpec="Comet" variantId="Comet" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Archmage">
        <Gem gemId="Metadata/Items/Gems/SkillGemArchmage" skillId="ArchmagePlayer" nameSpec="Archmage" variantId="Archmage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Glacier Rod
Attuned Wand
Implicits: 0
+4 to Level of all Cold Spell Skills
80% increased Spell Damage
+150 to maximum Mana
    </Item>
    <Item id="2">
Rarity: RARE
Archmage Garb
Hexer's Robe
Implicits: 0
+200 to maximum Mana
+100 to Spirit
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
  // ─── Phase 19 Benchmarks (121..125 — 125/125 MILESTONE!): Charge Scaling, Attribute Stacking, Flat PDR & PoE 2 Essence Drain ───
  {
    id: 'poe1_power_charge_scaling_void_battery_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + 6 Power Charges + 25% Spell Dmg & +10% Crit Multi per Power Charge',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 6 Power Charge Scaling Arc"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
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
Rarity: RARE
Charge Sceptre
Prophecy Wand
Implicits: 0
+3 to Maximum Power Charges
25% increased Spell Damage per Power Charge
+10% to Critical Strike Multiplier per Power Charge
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="usePowerCharges" boolean="true"/>
      <Input name="powerCharges" number="6"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_int_stacking_spell_damage_witch_arc',
    title: 'PoE 1 — Lv.90 Witch Arc + 1% increased Spell Damage per 10 Intelligence + High-Int Gear',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Int Stacking Spell Damage Arc"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="3_30" classId="3" ascendClassId="0" nodes="54447"/>
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
Rarity: RARE
Mind Rod
Prophecy Wand
Implicits: 0
1% increased Spell Damage per 10 Intelligence
+50 to Intelligence
    </Item>
    <Item id="2">
Rarity: RARE
Savants Talisman
Lapis Amulet
Implicits: 1
+30 to Intelligence
+80 to Intelligence
+60 to maximum Energy Shield
    </Item>
    <Item id="3">
Rarity: RARE
Scholar Garb
Vaal Regalia
Quality: 20
Implicits: 0
+80 to Intelligence
+90 to maximum Energy Shield
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Amulet" itemId="2"/>
      <Slot name="Body Armour" itemId="3"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_additional_pdr_chest_marauder',
    title: 'PoE 1 — Lv.90 Marauder Heavy Strike + +8% additional Physical Damage Reduction Glorious Plate',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Marauder" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: Additional PDR Glorious Plate"/>
  <Tree activeSpec="1">
    <Spec title="Marauder" treeVersion="3_30" classId="1" ascendClassId="0" nodes="47175"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Bulwark Plate
Glorious Plate
Quality: 20
Implicits: 0
+8% additional Physical Damage Reduction
+100 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Iron Axe
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_frenzy_charge_scaling_ranger_la',
    title: 'PoE 1 — Lv.90 Ranger Lightning Arrow + 5 Frenzy Charges + 10% increased Damage per Frenzy Charge',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Ranger" ascendClassName="None" mainSocketGroup="1" buildName="Oracle: 5 Frenzy Charge Scaling LA"/>
  <Tree activeSpec="1">
    <Spec title="Ranger" treeVersion="3_30" classId="2" ascendClassId="0" nodes="50459"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Lightning Arrow">
        <Gem gemId="Metadata/Items/Gems/SkillGemLightningArrow" skillId="LightningArrow" nameSpec="Lightning Arrow" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemSupportElementalDamageWithAttacks" skillId="SupportElementalDamageWithAttacks" nameSpec="Elemental Damage with Attacks" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Gale Bow
Imperial Bow
Quality: 20
Implicits: 0
140% increased Physical Damage
16% increased Attack Speed
+2 to Maximum Frenzy Charges
10% increased Damage per Frenzy Charge
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="useFrenzyCharges" boolean="true"/>
      <Input name="frenzyCharges" number="5"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_witch_essence_drain_plus4_chaos_wand_supports',
    title: 'PoE 2 — #125 Milestone: Lv.90 Witch Essence Drain + Controlled Destruction + Rapid Casting I + +4 Chaos Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Witch" ascendClassName="None" mainSocketGroup="1" buildName="Oracle #125: PoE2 Essence Drain +4 Chaos Wand"/>
  <Tree activeSpec="1">
    <Spec title="Witch" treeVersion="0_5" classId="1" classInternalId="1" ascendClassId="0" nodes="54447"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Essence Drain">
        <Gem gemId="Metadata/Items/Gems/SkillGemEssenceDrain" skillId="EssenceDrainPlayer" nameSpec="Essence Drain" variantId="EssenceDrain" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemRapidCastingSupport" skillId="SupportRapidCastingPlayer" nameSpec="Rapid Casting I" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Blight Rod
Bone Wand
Implicits: 0
+4 to Level of all Chaos Spell Skills
70% increased Spell Damage
    </Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
  // ─── Phase 20 Benchmarks (126..130 — 130/130 MILESTONE!): Hierophant, Occultist, Champion & PoE 2 Archmage Volcano ───
  {
    id: 'poe1_hierophant_sanctuary_of_thought_mana_es',
    title: 'PoE 1 — Lv.90 Hierophant Sanctuary of Thought (20% Max Mana as Extra ES) + Divine Guidance (Transfiguration of Mind)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="Hierophant" mainSocketGroup="1" buildName="Oracle: Hierophant Sanctuary of Thought"/>
  <Tree activeSpec="1">
    <Spec title="Hierophant" treeVersion="3_30" classId="5" ascendClassId="2" nodes="61525,30940,11046,922,29994,29026"/>
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
Rarity: RARE
Archon Robe
Vaal Regalia
Quality: 20
Implicits: 0
+160 to maximum Mana
+80 to maximum Energy Shield
    </Item>
    <Item id="2">
Rarity: RARE
Mind Pendant
Lapis Amulet
Implicits: 1
+30 to Intelligence
+120 to maximum Mana
+50 to Intelligence
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Amulet" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_hierophant_conviction_of_power_min_charges',
    title: 'PoE 1 — Lv.90 Hierophant Conviction of Power (+4 Min Power & Endurance Charges Active Without Config Toggle)',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Templar" ascendClassName="Hierophant" mainSocketGroup="1" buildName="Oracle: Hierophant Conviction of Power"/>
  <Tree activeSpec="1">
    <Spec title="Hierophant" treeVersion="3_30" classId="5" ascendClassId="2" nodes="61525,30940,22637,25651"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Arc">
        <Gem gemId="Metadata/Items/Gems/SkillGemArc" skillId="Arc" nameSpec="Arc" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_occultist_void_beacon_profane_bloom_ice_nova',
    title: 'PoE 1 — Lv.90 Witch Occultist Void Beacon (-20% Cold/Chaos Res) + Profane Bloom + Ice Nova + Frostbite',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Witch" ascendClassName="Occultist" mainSocketGroup="1" buildName="Oracle: Occultist Void Beacon Frostbite"/>
  <Tree activeSpec="1">
    <Spec title="Occultist" treeVersion="3_30" classId="3" ascendClassId="1" nodes="54447,18378,32417,27096,31984,37127"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Ice Nova">
        <Gem gemId="Metadata/Items/Gems/SkillGemIceNova" skillId="IceNova" nameSpec="Ice Nova" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Frostbite">
        <Gem gemId="Metadata/Items/Gems/SkillGemFrostbite" skillId="Frostbite" nameSpec="Frostbite" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1"><ItemSet id="1"/></Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe1_champion_inspirational_worthy_foe_determination',
    title: 'PoE 1 — Lv.90 Duelist Champion Inspirational (35% Aura Effect) + Worthy Foe (Taunt +15% Dmg Taken & Cannot Evade) + Determination',
    game: 'poe1',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="90" targetVersion="3_0" bandit="None" className="Duelist" ascendClassName="Champion" mainSocketGroup="1" buildName="Oracle: Champion Inspirational Worthy Foe"/>
  <Tree activeSpec="1">
    <Spec title="Champion" treeVersion="3_30" classId="4" ascendClassId="3" nodes="50986,24984,25111,11412,6982,56967"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Body Armour" label="Heavy Strike">
        <Gem gemId="Metadata/Items/Gems/SkillGemHeavyStrike" skillId="HeavyStrike" nameSpec="Heavy Strike" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" slot="Gloves" label="Determination">
        <Gem gemId="Metadata/Items/Gems/SkillGemDetermination" skillId="Determination" nameSpec="Determination" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Vanguard Plate
Glorious Plate
Quality: 20
Implicits: 0
+90 to maximum Life
    </Item>
    <Item id="2">
Rarity: RARE
Steel Cleaver
Vaal Axe
Quality: 20
Implicits: 0
140% increased Physical Damage
15% increased Attack Speed
    </Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1">
    <ConfigSet id="1">
      <Input name="conditionEnemyTaunted" boolean="true"/>
    </ConfigSet>
  </Config>
  <Notes/>
</PathOfBuilding>`,
  },
  {
    id: 'poe2_milestone_130_druid_volcano_archmage_plus4_fire_wand',
    title: 'PoE 2 — #130 Milestone: Lv.90 Druid Volcano + Archmage + Elemental Focus + Conc Area + Controlled Destruction + +4 Fire Wand',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Druid" ascendClassName="None" mainSocketGroup="1" buildName="Oracle #130: PoE2 Druid Archmage Volcano"/>
  <Tree activeSpec="1">
    <Spec title="Druid" treeVersion="0_5" classId="11" classInternalId="11" ascendClassId="0" nodes="61525"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemQuality="0">
    <SkillSet id="1">
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Volcano">
        <Gem gemId="Metadata/Items/Gems/SkillGemVolcano" skillId="VolcanoPlayer" nameSpec="Volcano" variantId="Volcano" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemElementalFocusSupport" skillId="SupportElementalFocusPlayer" nameSpec="Elemental Focus" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemConcentratedAreaSupport" skillId="SupportConcentratedAreaPlayer" nameSpec="Concentrated Area" level="20" quality="0" enabled="true"/>
        <Gem gemId="Metadata/Items/Gems/SkillGemControlledDestructionSupport" skillId="SupportControlledDestructionPlayer" nameSpec="Controlled Destruction" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill enabled="true" mainActiveSkill="1" mainActiveSkillCalcs="1" set1="true" set2="true" label="Archmage">
        <Gem gemId="Metadata/Items/Gems/SkillGemArchmage" skillId="ArchmagePlayer" nameSpec="Archmage" variantId="Archmage" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: RARE
Magma Rod
Attuned Wand
Implicits: 0
+4 to Level of all Fire Spell Skills
80% increased Spell Damage
+150 to maximum Mana
    </Item>
    <Item id="2">
Rarity: RARE
Archmage Vestment
Hexer's Robe
Implicits: 0
+200 to maximum Mana
+100 to Spirit
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
    id: 'poe2_warrior_bringer_of_rain_dual_2h_mace',
    title: 'PoE 2 — Regression: Lv.90 Warrior The Bringer of Rain (祭礼之雨) Dual-Wield 2H Maces + Disabled Body Armour',
    game: 'poe2',
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding2>
  <Build level="90" targetVersion="0_1" className="Warrior" ascendClassName="None" mainSocketGroup="1" buildName="Regression: PoE2 The Bringer of Rain Dual-Wield 2H Maces"/>
  <Tree activeSpec="1">
    <Spec title="Warrior" treeVersion="0_5" classId="6" classInternalId="6" ascendClassId="0" nodes="47175"/>
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
The Bringer of Rain
Decorated Helm
Quality: 20
Implicits: 0
700% increased Armour and Evasion
+250 to Accuracy Rating
100% increased Critical Hit Chance
45 Life Regeneration per second
Can't use Body Armour
You can wield Two-Handed Axes, Maces and Swords in one hand
This item gains bonuses from Socketed Items as though it was a Body Armour
    </Item>
    <Item id="2">
Rarity: RARE
Titan Maul Alpha
Aberrant Sledge
Quality: 20
Implicits: 0
120% increased Physical Damage
15% increased Attack Speed
    </Item>
    <Item id="3">
Rarity: RARE
Titan Maul Beta
Cultist Greathammer
Quality: 20
Implicits: 0
140% increased Physical Damage
20% increased Attack Speed
    </Item>
    <Item id="4">
Rarity: RARE
Disabled Chest
Iron Cuirass
Quality: 20
Implicits: 0
+200 to maximum Life
+40% to Fire Resistance
    </Item>
    <ItemSet id="1">
      <Slot name="Helmet" itemId="1"/>
      <Slot name="Weapon 1" itemId="2"/>
      <Slot name="Weapon 2" itemId="3"/>
      <Slot name="Body Armour" itemId="4"/>
    </ItemSet>
  </Items>
  <Config activeConfigSet="1"><ConfigSet id="1"/></Config>
  <Notes/>
</PathOfBuilding2>`,
  },
];
