-- Official Path of Building (PoE 1 & PoE 2) LuaJIT Data Exporter
-- Exports evaluated Lv.1-40 skill scaling, support modifiers, quality stats,
-- and complete base item stats directly from upstream PoB HeadlessWrapper.
--
-- Usage:
--   luajit export_pob_data.lua <poe1|poe2> <out_bases.json> <out_gems_raw.json>

local game = arg[1] or "poe1"
local outBasesPath = arg[2]
local outGemsPath = arg[3]
local outUniquesPath = arg[4]
local outClustersPath = arg[5]
local isPoe2 = (game == "poe2")

-- Strip PoB's #@ preprocessor header when loading Lua files
local orig_loadfile = loadfile
function loadfile(filename, mode, env)
  local fh = io.open(filename, "r")
  if not fh then return orig_loadfile(filename, mode, env) end
  local content = fh:read("*a")
  fh:close()
  if content:sub(1, 2) == "#@" then
    content = content:gsub("^#@[^\r\n]*", "")
  end
  return loadstring(content, "@" .. filename)
end
function dofile(filename)
  local fn, err = loadfile(filename)
  if not fn then error(err) end
  return fn()
end

dofile("HeadlessWrapper.lua")

-- Minimal JSON encoder (deterministic key order)
local function escapeStr(s)
  return s:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t')
end

local function toJson(val)
  local t = type(val)
  if t == "nil" then return "null" end
  if t == "boolean" then return val and "true" or "false" end
  if t == "number" then
    if val ~= val or val == math.huge or val == -math.huge then return "0" end
    if math.floor(val) == val then return tostring(math.floor(val)) end
    return string.format("%.4g", val)
  end
  if t == "string" then return '"' .. escapeStr(val) .. '"' end
  if t == "table" then
    local isArr = true
    local n = 0
    for k, _ in pairs(val) do
      if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then
        isArr = false
        break
      end
      if k > n then n = k end
    end
    if isArr and n > 0 then
      local parts = {}
      for i = 1, n do parts[i] = toJson(val[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    -- Empty table -> [] only if explicitly empty array? Use {} for maps.
    local keys = {}
    for k, _ in pairs(val) do
      if type(k) == "string" or type(k) == "number" then
        table.insert(keys, k)
      end
    end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local parts = {}
    for _, k in ipairs(keys) do
      table.insert(parts, '"' .. escapeStr(tostring(k)) .. '":' .. toJson(val[k]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function mapWeaponType(rawType, tags)
  if not rawType then return nil end
  local lt = rawType:lower()
  if lt:find("crossbow") then return "Crossbow" end
  if lt:find("bow") then return "Bow" end
  if lt:find("wand") then return "Wand" end
  if lt:find("quarterstaff") or (isPoe2 and lt:find("staff") and tags and tags.quarterstaff) then return "Quarterstaff" end
  if lt:find("staff") then return "Staff" end
  if lt:find("axe") then return "Axe" end
  if lt:find("mace") or lt:find("sceptre") or lt:find("flail") then return "Mace" end
  if lt:find("sword") or lt:find("spear") then return "Sword" end
  if lt:find("dagger") then return "Dagger" end
  if lt:find("claw") then return "Claw" end
  return nil
end

-- 1. Export Base Items
local basesOut = {}
local baseCount = 0
for name, base in pairs(data.itemBases or {}) do
  if type(base) == "table" and type(name) == "string" then
    local entry = {}
    local hasUseful = false
    if base.armour then
      local arm = base.armour.ArmourBaseMax or base.armour.Armour or 0
      local eva = base.armour.EvasionBaseMax or base.armour.Evasion or 0
      local es = base.armour.EnergyShieldBaseMax or base.armour.EnergyShield or 0
      local blk = base.armour.BlockChance or 0
      local ward = base.armour.WardBaseMax or base.armour.Ward or 0
      if arm > 0 or eva > 0 or es > 0 or blk > 0 or ward > 0 then
        entry.a = ward > 0 and { arm, eva, es, blk, ward } or { arm, eva, es, blk }
        hasUseful = true
      end
    end
    if base.weapon and ((base.weapon.PhysicalMax and base.weapon.PhysicalMax > 0) or (base.weapon.LightningMax and base.weapon.LightningMax > 0) or (base.weapon.FireMax and base.weapon.FireMax > 0) or (base.weapon.ColdMax and base.weapon.ColdMax > 0) or (base.weapon.ChaosMax and base.weapon.ChaosMax > 0)) then
      local wt = mapWeaponType(base.type, base.tags)
      if wt then
        local twoH = (base.tags and (base.tags.two_hand_weapon or base.tags.twohand or base.tags.bow or base.tags.staff or base.tags.crossbow or base.tags.quarterstaff or base.tags.warstaff)) and 1 or 0
        entry.w = {
          base.weapon.PhysicalMin or 0,
          base.weapon.PhysicalMax or 0,
          base.weapon.AttackRateBase or 1.2,
          base.weapon.CritChanceBase or 5,
          wt,
          twoH
        }
        local we = {}
        local hasWe = false
        for _, dt in ipairs({ "Fire", "Cold", "Lightning", "Chaos" }) do
          local mn = base.weapon[dt .. "Min"]
          local mx = base.weapon[dt .. "Max"]
          if mx and mx > 0 then
            we[dt] = { mn or 0, mx }
            hasWe = true
          end
        end
        if hasWe then entry.we = we end
        hasUseful = true
      end
    end
    if base.implicit and type(base.implicit) == "string" and #base.implicit > 0 then
      entry.i = base.implicit
      hasUseful = true
    end
    if hasUseful then
      basesOut[name] = entry
      baseCount = baseCount + 1
    end
  end
end

local fh1 = assert(io.open(outBasesPath, "w"))
fh1:write(toJson({ game = game, count = baseCount, bases = basesOut }))
fh1:close()
print(string.format("Exported %d %s base items -> %s", baseCount, game, outBasesPath))

-- 2. Helper: translate a PoB mod entry + numeric value into canonical WebPoB stat text
local function fmtSigned(v)
  return (v >= 0 and "+" or "") .. tostring(v)
end

local function modToStatLine(m, val, ctx)
  if type(m) ~= "table" or type(m.name) ~= "string" then return nil end
  ctx = ctx or {}

  -- Unwrap MinionModifier:LIST { mod = innerMod }
  if m.name == "MinionModifier" and m.type == "LIST" and type(m.value) == "table" and type(m.value.mod) == "table" then
    return modToStatLine(m.value.mod, val, {
      isSupport = ctx.isSupport,
      forceMinion = true,
      stats = ctx.stats,
      maxStages = ctx.maxStages,
    })
  end

  -- Inspect extra condition/scope tables on the mod
  local isCurse = false
  local perStat = nil
  local percentStat = nil
  local multVar = nil
  local multDiv = nil
  for _, extra in ipairs(m) do
    if type(extra) == "table" and extra.type then
      local et = extra.type
      if et == "GlobalEffect" then
        if extra.effectType == "Curse" then isCurse = true end
      elseif et == "ModFlagOr" or et == "SkillType" or et == "GemTag" or et == "Limit" then
        -- Scope/flag qualifiers: safe to keep
      elseif et == "ActorCondition" then
        -- Allow standard parent-negation boilerplate and enemy conditions on supports/curses
        if not ((extra.neg == true and extra.actor == "parent") or ctx.isSupport or isCurse) then
          return nil
        end
      elseif et == "Condition" or et == "MultiplierThreshold" then
        -- Allow primary conditional effects on supports, buffs, and curses
        if not (ctx.isSupport or isCurse) then
          -- Also allow simple buff conditions on active buffs (e.g. Righteous Fire)
          if extra.var ~= "LowLife" and extra.var ~= "AffectedByArcaneSurge" then
            return nil
          end
        end
      elseif et == "StatThreshold" then
        if extra.stat ~= "LifeUnreserved" and extra.stat ~= "PowerCharges" and extra.stat ~= "FrenzyCharges" and extra.stat ~= "EnduranceCharges" then
          return nil
        end
      elseif et == "PerStat" then
        perStat = extra
      elseif et == "PercentStat" then
        percentStat = extra
      elseif et == "Multiplier" then
        multVar = extra.var
        multDiv = extra.div
      else
        -- Skip SkillPart, DistanceRamp, MeleeProximity, etc.
        return nil
      end
    end
  end

  local v = m.value
  if v == nil then v = val end
  if type(v) == "number" and m.div then v = v / m.div end
  if type(v) == "number" and m.mult then v = v * m.mult end
  if type(v) == "number" then v = math.floor(v * 100 + 0.5) / 100 end
  if v == 0 then return nil end

  local flags = type(m.flags) == "number" and m.flags or 0
  local kflags = type(m.keywordFlags) == "number" and m.keywordFlags or 0
  local isSpell = bit.band(flags, ModFlag.Spell or 0) ~= 0
  local isCast = bit.band(flags, ModFlag.Cast or 0) ~= 0
  local isAttack = bit.band(flags, ModFlag.Attack or 0) ~= 0
  local isMelee = bit.band(flags, ModFlag.Melee or 0) ~= 0
  local isProj = bit.band(flags, ModFlag.Projectile or 0) ~= 0
  local isArea = bit.band(flags, ModFlag.Area or 0) ~= 0
  local isHit = bit.band(flags, ModFlag.Hit or 0) ~= 0
  local isAilment = bit.band(flags, ModFlag.Ailment or 0) ~= 0
    or bit.band(kflags, bit.bor(KeywordFlag.Ailment or 0, KeywordFlag.Bleed or 0, KeywordFlag.Poison or 0, KeywordFlag.Ignite or 0)) ~= 0
  local isDot = bit.band(flags, ModFlag.Dot or 0) ~= 0
    or bit.band(kflags, bit.bor(KeywordFlag.PhysicalDot or 0, KeywordFlag.ChaosDot or 0, KeywordFlag.FireDot or 0, KeywordFlag.ColdDot or 0, KeywordFlag.LightningDot or 0)) ~= 0
  local isMinion = ctx.forceMinion or (bit.band(kflags, KeywordFlag.Minion or 0) ~= 0)
  local isProxy = bit.band(kflags, bit.bor(KeywordFlag.Totem or 0, KeywordFlag.Trap or 0, KeywordFlag.Mine or 0, KeywordFlag.Brand or 0)) ~= 0
  if isProxy and not ctx.isSupport then return nil end

  local name = m.name
  local mtype = m.type

  -- Handle PerStat (e.g. PoE 2 Archmage: Gain X% of Damage as Extra Lightning Damage per 100 Maximum Mana)
  if perStat then
    if mtype == "BASE" and type(v) == "number" and perStat.stat == "Mana" and perStat.div and perStat.div > 0 then
      local gainMap = {
        DamageGainAsFire = "Fire",
        DamageGainAsCold = "Cold",
        DamageGainAsLightning = "Lightning",
        DamageGainAsChaos = "Chaos",
      }
      local dt = gainMap[name]
      if dt then
        return "Gain " .. v .. "% of Damage as Extra " .. dt .. " Damage per " .. perStat.div .. " Maximum Mana"
      end
    end
    return nil
  end

  -- Handle PercentStat (e.g. PoE 1 Archmage: Added Lightning Damage equal to X% of Unreserved Mana)
  if percentStat then
    if mtype == "BASE" and type(v) == "number" and percentStat.stat == "ManaUnreserved" and name == "LightningMin" then
      return "Added Lightning Damage equal to " .. v .. "% of Unreserved Mana"
    end
    return nil
  end

  -- Handle Multiplier-scaled mods (Wind Dancer, Power Charge On Crit, Trinity, Pinpoint, Vaal Flameblast)
  if multVar then
    if type(v) ~= "number" then return nil end
    if multVar == "WindDancerStacks" and name == "Evasion" and mtype == "MORE" then
      local stages = (ctx.stats and ctx.stats["wind_dancer_maximum_number_of_stages"]) or 3
      return (v * stages) .. "% more Evasion Rating"
    elseif multVar == "PowerCharge" and name == "Damage" and mtype == "MORE" then
      if isSpell then return v .. "% more Spell Damage per Power Charge" end
      return v .. "% more Damage per Power Charge"
    elseif multVar == "ResonanceCount" and name == "ElementalDamage" and mtype == "MORE" then
      local mult = multDiv and (50 / multDiv) or 10
      return math.floor(v * mult + 0.5) .. "% more Elemental Damage"
    elseif multVar == "Intensity" and name == "Damage" and mtype == "MORE" then
      return (v * 3) .. "% more Projectile Damage"
    elseif multVar == "VaalFlameblastStage" and name == "Damage" and mtype == "MORE" then
      local stages = ctx.maxStages or 15
      if isAilment then return (v * stages) .. "% more Damage with Ailments" end
      return (v * stages) .. "% more Spell Damage"
    end
    return nil
  end

  if mtype == "MORE" and type(v) == "number" then
    local word = v < 0 and "less" or "more"
    local av = math.abs(v)
    if name == "Damage" then
      if isMinion then return "Minions deal " .. av .. "% " .. word .. " Damage" end
      if isAilment then return av .. "% " .. word .. " Damage with Ailments" end
      if isDot then return av .. "% " .. word .. " Damage over Time" end
      if isHit then return av .. "% " .. word .. " Damage with Hits" end
      if isSpell then return av .. "% " .. word .. " Spell Damage" end
      if isMelee then return av .. "% " .. word .. " Melee Damage" end
      if isAttack then return av .. "% " .. word .. " Attack Damage" end
      if isProj then return av .. "% " .. word .. " Projectile Damage" end
      if isArea then return av .. "% " .. word .. " Area Damage" end
      return av .. "% " .. word .. " Damage"
    elseif name == "PhysicalDamage" or name == "FireDamage" or name == "ColdDamage" or name == "LightningDamage" or name == "ChaosDamage" or name == "ElementalDamage" then
      local dt = name:gsub("Damage$", "")
      if isAilment then return av .. "% " .. word .. " Damage with Ailments" end
      if isDot then return av .. "% " .. word .. " Damage over Time" end
      if isMelee and dt == "Physical" then return av .. "% " .. word .. " Melee Physical Damage" end
      if isAttack then return av .. "% " .. word .. " " .. dt .. " Damage with Attack Skills" end
      return av .. "% " .. word .. " " .. dt .. " Damage"
    elseif name == "AilmentMagnitude" then
      return av .. "% " .. word .. " Damage with Ailments"
    elseif name == "Speed" then
      if isMinion and v > 0 then return "Minions have " .. av .. "% more Attack and Cast Speed" end
      if isSpell or isCast then return av .. "% " .. word .. " Cast Speed" end
      if isAttack then return av .. "% " .. word .. " Attack Speed" end
      return av .. "% " .. word .. " Attack and Cast Speed"
    elseif name == "CritChance" then
      return av .. "% " .. word .. " Critical Strike Chance"
    elseif name == "CritMultiplier" then
      return av .. "% " .. word .. " Critical Damage Bonus"
    elseif name == "Armour" then
      return av .. "% " .. word .. " Armour"
    elseif name == "Evasion" then
      return av .. "% " .. word .. " Evasion Rating"
    elseif name == "EnergyShield" then
      return av .. "% " .. word .. " maximum Energy Shield"
    elseif name == "Life" then
      if isMinion then return "Minions have " .. av .. "% " .. word .. " maximum Life" end
      return av .. "% " .. word .. " maximum Life"
    elseif name == "Ward" then
      return av .. "% " .. word .. " Ward"
    elseif name == "RepeatOneDamage" then
      return av .. "% " .. word .. " Damage on First Repeat"
    elseif name == "RepeatTwoDamage" then
      return av .. "% " .. word .. " Damage on Second Repeat"
    elseif name == "MaxDamage" then
      return av .. "% " .. word .. " Maximum Damage"
    elseif name == "MinDamage" then
      return av .. "% " .. word .. " Minimum Damage"
    elseif name == "MaxPhysicalDamage" then
      return av .. "% " .. word .. " Maximum Physical Damage"
    elseif name == "AreaOfEffect" then
      return av .. "% " .. word .. " Area of Effect"
    elseif name == "Duration" then
      return av .. "% " .. word .. " Skill Effect Duration"
    elseif name == "ProjectileSpeed" then
      return av .. "% " .. word .. " Projectile Speed"
    elseif name == "Accuracy" then
      return av .. "% " .. word .. " Accuracy Rating"
    elseif name == "CooldownRecovery" then
      return av .. "% " .. word .. " Cooldown Recovery Rate"
    elseif name == "CurseEffect" then
      return av .. "% " .. word .. " Effect of Curses"
    end
  elseif mtype == "INC" and type(v) == "number" then
    local word = v < 0 and "reduced" or "increased"
    local av = math.abs(v)
    if isCurse and v > 0 then
      if name == "PhysicalDamageTaken" then return "Cursed enemies take " .. av .. "% increased Physical Damage"
      elseif name == "DamageTaken" then
        if isProj then return "Cursed enemies take " .. av .. "% increased Projectile Damage" end
        return "Cursed enemies take " .. av .. "% increased Damage"
      end
    end
    if name == "Damage" then
      if isMinion then return "Minions deal " .. av .. "% " .. word .. " Damage" end
      if isAilment then return av .. "% " .. word .. " Damage with Ailments" end
      if isDot then return av .. "% " .. word .. " Damage over Time" end
      if isHit then return av .. "% " .. word .. " Damage with Hits" end
      if isSpell then return av .. "% " .. word .. " Spell Damage" end
      if isMelee then return av .. "% " .. word .. " Melee Damage" end
      if isAttack then return av .. "% " .. word .. " Attack Damage" end
      if isProj then return av .. "% " .. word .. " Projectile Damage" end
      if isArea then return av .. "% " .. word .. " Area Damage" end
      return av .. "% " .. word .. " Damage"
    elseif name == "PhysicalDamage" or name == "FireDamage" or name == "ColdDamage" or name == "LightningDamage" or name == "ChaosDamage" or name == "ElementalDamage" then
      local dt = name:gsub("Damage$", "")
      if isAilment then return av .. "% " .. word .. " Damage with Ailments" end
      if isDot then return av .. "% " .. word .. " Damage over Time" end
      if isAttack then return av .. "% " .. word .. " " .. dt .. " Damage with Attack Skills" end
      return av .. "% " .. word .. " " .. dt .. " Damage"
    elseif name == "AilmentMagnitude" and v > 0 then
      return av .. "% increased Damage with Ailments"
    elseif name == "Speed" then
      if isMinion and v > 0 then return "Minions have " .. av .. "% increased Attack and Cast Speed" end
      if isSpell or isCast then return av .. "% " .. word .. " Cast Speed" end
      if isAttack then return av .. "% " .. word .. " Attack Speed" end
      return av .. "% " .. word .. " Attack and Cast Speed"
    elseif name == "CritChance" then
      if isSpell and v > 0 then return av .. "% increased Critical Strike Chance for Spells" end
      return av .. "% " .. word .. " Critical Strike Chance"
    elseif name == "CritMultiplier" and v > 0 then return av .. "% increased Critical Damage Bonus"
    elseif name == "Armour" and v > 0 then return av .. "% increased Armour"
    elseif name == "Evasion" and v > 0 then return av .. "% increased Evasion Rating"
    elseif name == "EnergyShield" and v > 0 then return av .. "% increased maximum Energy Shield"
    elseif name == "Life" and v > 0 then
      if isMinion then return "Minions have " .. av .. "% increased maximum Life" end
      return av .. "% increased maximum Life"
    elseif name == "Mana" and v > 0 then return av .. "% increased maximum Mana"
    elseif name == "ManaRegen" and v > 0 then return av .. "% increased Mana Regeneration Rate"
    elseif name == "MovementSpeed" and v > 0 then return av .. "% increased Movement Speed"
    elseif name == "Accuracy" and v > 0 then return av .. "% increased Accuracy Rating"
    elseif name == "AuraEffect" and v > 0 then return av .. "% increased Aura Effect"
    elseif name == "CurseEffect" and v > 0 then return av .. "% increased Effect of Curses"
    elseif name == "CooldownRecovery" and v > 0 then return av .. "% increased Cooldown Recovery Rate"
    elseif name == "ImpaleEffect" and v > 0 then return av .. "% increased Impale Effect"
    elseif name == "ManaReservationEfficiency" and v > 0 then return av .. "% increased Mana Reservation Efficiency"
    elseif name == "AreaOfEffect" then return av .. "% " .. word .. " Area of Effect"
    elseif name == "Duration" then return av .. "% " .. word .. " Skill Effect Duration"
    elseif name == "ProjectileSpeed" then return av .. "% " .. word .. " Projectile Speed"
    end
  elseif mtype == "BASE" and type(v) == "number" then
    if isCurse then
      if name == "ElementalResist" then return "Cursed enemies have " .. fmtSigned(v) .. "% to Elemental Resistances"
      elseif name == "FireResist" then return "Cursed enemies have " .. fmtSigned(v) .. "% to Fire Resistance"
      elseif name == "ColdResist" then return "Cursed enemies have " .. fmtSigned(v) .. "% to Cold Resistance"
      elseif name == "LightningResist" then return "Cursed enemies have " .. fmtSigned(v) .. "% to Lightning Resistance"
      elseif name == "ChaosResist" then return "Cursed enemies have " .. fmtSigned(v) .. "% to Chaos Resistance"
      elseif name == "IgnoreArmour" and v > 0 then return "Cursed enemies have -" .. v .. " to Armour"
      elseif name == "CritChance" and v > 0 then return "Hits against Cursed Enemies have +" .. v .. "% to Critical Strike Chance"
      elseif name == "CritMultiplier" and v > 0 then return "Hits against Cursed Enemies have +" .. v .. "% to Critical Strike Multiplier"
      end
    end
    if name == "FirePenetration" and v > 0 then return "Damage Penetrates " .. v .. "% Fire Resistance"
    elseif name == "ColdPenetration" and v > 0 then return "Damage Penetrates " .. v .. "% Cold Resistance"
    elseif name == "LightningPenetration" and v > 0 then return "Damage Penetrates " .. v .. "% Lightning Resistance"
    elseif name == "ChaosPenetration" and v > 0 then return "Damage Penetrates " .. v .. "% Chaos Resistance"
    elseif name == "ElementalPenetration" and v > 0 then return "Damage Penetrates " .. v .. "% Elemental Resistance"
    elseif name == "CritChance" and v > 0 then return "Hits have +" .. v .. "% to Critical Strike Chance"
    elseif name == "CritMultiplier" and v > 0 then return "+" .. v .. "% to Critical Strike Multiplier"
    elseif name == "DotMultiplier" and v > 0 then return "+" .. v .. "% to Damage over Time Multiplier"
    elseif name == "FireDotMultiplier" and v > 0 then return "+" .. v .. "% to Fire Damage over Time Multiplier"
    elseif name == "ColdDotMultiplier" and v > 0 then return "+" .. v .. "% to Cold Damage over Time Multiplier"
    elseif name == "ChaosDotMultiplier" and v > 0 then return "+" .. v .. "% to Chaos Damage over Time Multiplier"
    elseif name == "PhysicalDotMultiplier" and v > 0 then return "+" .. v .. "% to Physical Damage over Time Multiplier"
    elseif name == "Armour" and v > 0 then return "+" .. v .. " to Armour"
    elseif name == "Evasion" and v > 0 then return "+" .. v .. " to Evasion Rating"
    elseif name == "EnergyShield" and v > 0 then return "+" .. v .. " to maximum Energy Shield"
    elseif name == "Ward" and v > 0 then return "+" .. v .. " to Ward"
    elseif name == "Life" and v > 0 then return "+" .. v .. " to maximum Life"
    elseif name == "Mana" and v > 0 then return "+" .. v .. " to maximum Mana"
    elseif name == "LifeRegen" and v > 0 then return "Regenerate " .. v .. " Life per second"
    elseif name == "LifeRegenPercent" and v > 0 then return "Regenerate " .. v .. "% of Life per second"
    elseif name == "Accuracy" and v > 0 then return "+" .. v .. " to Accuracy Rating"
    elseif name == "BlockChance" and v > 0 then return "+" .. v .. "% Chance to Block Attack Damage"
    elseif name == "SpellBlockChance" and v > 0 then return "+" .. v .. "% Chance to Block Spell Damage"
    elseif name == "SpellSuppressionChance" and v > 0 then return "+" .. v .. "% chance to Suppress Spell Damage"
    elseif name == "ElementalResist" and v ~= 0 then return fmtSigned(v) .. "% to all Elemental Resistances"
    elseif name == "FireResist" and v ~= 0 then return fmtSigned(v) .. "% to Fire Resistance"
    elseif name == "ColdResist" and v ~= 0 then return fmtSigned(v) .. "% to Cold Resistance"
    elseif name == "LightningResist" and v ~= 0 then return fmtSigned(v) .. "% to Lightning Resistance"
    elseif name == "ChaosResist" and v ~= 0 then return fmtSigned(v) .. "% to Chaos Resistance"
    elseif name == "FireResistMax" and v ~= 0 then return fmtSigned(v) .. "% to maximum Fire Resistance"
    elseif name == "ColdResistMax" and v ~= 0 then return fmtSigned(v) .. "% to maximum Cold Resistance"
    elseif name == "LightningResistMax" and v ~= 0 then return fmtSigned(v) .. "% to maximum Lightning Resistance"
    elseif name == "ChaosResistMax" and v ~= 0 then return fmtSigned(v) .. "% to maximum Chaos Resistance"
    elseif name == "DoubleDamageChance" and v > 0 then return v .. "% chance to deal Double Damage"
    elseif (name == "IgniteChance" or name == "EnemyIgniteChance") and v > 0 then return v .. "% chance to Ignite"
    elseif (name == "BleedChance" or name == "EnemyBleedChance") and v > 0 then return v .. "% chance to cause Bleeding"
    elseif (name == "PoisonChance" or name == "EnemyPoisonChance") and v > 0 then return v .. "% chance to Poison on Hit"
    elseif name == "ImpaleChance" and v > 0 then return v .. "% chance to Impale Enemies on Hit with Attacks"
    elseif name == "PhysicalDamageConvertToFire" and v > 0 then return v .. "% of Physical Damage Converted to Fire Damage"
    elseif name == "PhysicalDamageConvertToCold" and v > 0 then return v .. "% of Physical Damage Converted to Cold Damage"
    elseif name == "PhysicalDamageConvertToLightning" and v > 0 then return v .. "% of Physical Damage Converted to Lightning Damage"
    elseif name == "PhysicalDamageConvertToChaos" and v > 0 then return v .. "% of Physical Damage Converted to Chaos Damage"
    elseif name == "ColdDamageConvertToFire" and v > 0 then return v .. "% of Cold Damage Converted to Fire Damage"
    elseif name == "LightningDamageConvertToCold" and v > 0 then return v .. "% of Lightning Damage Converted to Cold Damage"
    elseif name == "LightningDamageConvertToFire" and v > 0 then return v .. "% of Lightning Damage Converted to Fire Damage"
    elseif name == "FireDamageConvertToChaos" and v > 0 then return v .. "% of Fire Damage Converted to Chaos Damage"
    elseif name == "PhysicalDamageGainAsFire" and v > 0 then return "Gain " .. v .. "% of Physical Damage as Extra Fire Damage"
    elseif name == "PhysicalDamageGainAsCold" and v > 0 then return "Gain " .. v .. "% of Physical Damage as Extra Cold Damage"
    elseif name == "PhysicalDamageGainAsLightning" and v > 0 then return "Gain " .. v .. "% of Physical Damage as Extra Lightning Damage"
    elseif name == "PhysicalDamageGainAsChaos" and v > 0 then return "Gain " .. v .. "% of Physical Damage as Extra Chaos Damage"
    elseif name == "ElementalDamageGainAsChaos" and v > 0 then return "Gain " .. v .. "% of Elemental Damage as Extra Chaos Damage"
    elseif name == "DamageGainAsFire" and v > 0 then return "Gain " .. v .. "% of Damage as Extra Fire Damage"
    elseif name == "DamageGainAsCold" and v > 0 then return "Gain " .. v .. "% of Damage as Extra Cold Damage"
    elseif name == "DamageGainAsLightning" and v > 0 then return "Gain " .. v .. "% of Damage as Extra Lightning Damage"
    elseif name == "DamageGainAsChaos" and v > 0 then return "Gain " .. v .. "% of Damage as Extra Chaos Damage"
    elseif name == "RepeatCount" and v > 0 then return "Repeats " .. v .. " additional " .. (v == 1 and "time" or "times")
    elseif name == "ProjectileCount" and v > 0 then return "Fires " .. v .. " additional " .. (v == 1 and "Projectile" or "Projectiles")
    elseif name == "ChainCountMax" and v > 0 then return "Chains +" .. v .. " " .. (v == 1 and "time" or "times")
    elseif name == "PierceCount" and v > 0 then return "Projectiles Pierce " .. v .. " additional " .. (v == 1 and "Target" or "Targets")
    elseif name == "AftershockChance" and v > 0 then return v .. "% chance to create an Aftershock"
    elseif name == "RuthlessBlowHitMultiplier" and v > 0 then return v .. "% more Melee Damage with Ruthless Blows"
    end
  elseif mtype == "CHANCE" and type(v) == "number" and v > 0 then
    if name == "HitsInvertEleResChance" then return "Hits treat Enemy Monster Elemental Resistance values as inverted" end
  elseif mtype == "FLAG" and v == true then
    if name == "DealNoElemental" then return "Deal no Elemental Damage"
    elseif name == "DealNoChaos" then return "Deal no Chaos Damage"
    elseif name == "DealNoFire" then return "Deal no Fire Damage"
    elseif name == "DealNoCold" then return "Deal no Cold Damage"
    elseif name == "DealNoLightning" then return "Deal no Lightning Damage"
    elseif name == "CannotBeEvaded" then return "Your Hits can't be Evaded"
    elseif name == "NeverCrit" then return "Never deal Critical Strikes"
    elseif name == "BifurcateCrit" then return "Critical Hits are Bifurcated"
    elseif name == "ForkOnce" then return "Projectiles Fork"
    elseif name == "CannotIgnite" then return "Cannot inflict Ignite"
    elseif name == "CannotFreeze" then return "Cannot inflict Freeze"
    elseif name == "CannotShock" then return "Cannot inflict Shock"
    end
  end
  return nil
end

local QUALITY_KEY_MAP = {
  ["damage_+%"] = "{v}% increased Damage",
  ["spell_damage_+%"] = "{v}% increased Spell Damage",
  ["attack_damage_+%"] = "{v}% increased Attack Damage",
  ["physical_damage_+%"] = "{v}% increased Physical Damage",
  ["fire_damage_+%"] = "{v}% increased Fire Damage",
  ["cold_damage_+%"] = "{v}% increased Cold Damage",
  ["lightning_damage_+%"] = "{v}% increased Lightning Damage",
  ["chaos_damage_+%"] = "{v}% increased Chaos Damage",
  ["elemental_damage_+%"] = "{v}% increased Elemental Damage",
  ["projectile_damage_+%"] = "{v}% increased Projectile Damage",
  ["melee_damage_+%"] = "{v}% increased Melee Damage",
  ["area_damage_+%"] = "{v}% increased Area Damage",
  ["attack_speed_+%"] = "{v}% increased Attack Speed",
  ["base_cast_speed_+%"] = "{v}% increased Cast Speed",
  ["critical_strike_chance_+%"] = "{v}% increased Critical Strike Chance",
  ["base_critical_strike_multiplier_+"] = "+{v}% to Critical Strike Multiplier",
  ["chance_to_deal_double_damage_%"] = "{v}% chance to deal Double Damage",
  ["attack_skills_elemental_damage_+%"] = "{v}% increased Elemental Damage with Attack Skills",
}

local SAMPLE_LEVELS = {
  1, 5, 10, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
}

local function extractLevelSnapshot(ge, ss, level)
  local ok, stats = pcall(function()
    if isPoe2 then
      return calcLib.buildSkillInstanceStats({ level = level, quality = 0 }, ge, ss)
    else
      return calcLib.buildSkillInstanceStats({ level = level, quality = 0 }, ge)
    end
  end)
  if not ok or type(stats) ~= "table" then return nil end

  local lvl = (ge.levels and ge.levels[level]) or (ss and ss.levels and ss.levels[level]) or {}
  local ssLvl = (ss and ss.levels and ss.levels[level]) or lvl
  local out = {}

  -- Base spell damage
  local dmg = {}
  local hasDmg = false
  local dtypes = {
    { "Physical", "physical" },
    { "Fire", "fire" },
    { "Cold", "cold" },
    { "Lightning", "lightning" },
    { "Chaos", "chaos" },
  }
  for _, dt in ipairs(dtypes) do
    local mn = stats["spell_minimum_base_" .. dt[2] .. "_damage"]
    local mx = stats["spell_maximum_base_" .. dt[2] .. "_damage"]
    if mn and mx and mx > 0 then
      dmg[dt[1]] = { math.floor(mn + 0.5), math.floor(mx + 0.5) }
      hasDmg = true
    end
  end
  if hasDmg then out.bd = dmg end

  -- Attack multiplier & damage effectiveness
  local baseMult = ssLvl.baseMultiplier or lvl.baseMultiplier
  local dmgEff = ssLvl.damageEffectiveness or lvl.damageEffectiveness
  if baseMult and baseMult > 0 then
    out.am = math.floor(baseMult * 1000 + 0.5) / 10
  end
  if dmgEff and dmgEff > 0 then
    out.de = math.floor(dmgEff * 1000 + 0.5) / 10
  end
  if lvl.cost and type(lvl.cost) == "table" and lvl.cost.Mana and lvl.cost.Mana > 0 then
    out.mc = math.floor(lvl.cost.Mana + 0.5)
  elseif lvl.manaCost and lvl.manaCost > 0 then
    out.mc = math.floor(lvl.manaCost + 0.5)
  end

  -- Convert evaluated stats to canonical stat lines via statMap + common direct keys
  local lines = {}
  local seenLine = {}
  local function addLine(l)
    if l and not seenLine[l] then
      seenLine[l] = true
      table.insert(lines, l)
    end
  end

  -- Direct added damage pairs
  local handledAddedStatKeys = {}
  for _, dt in ipairs(dtypes) do
    for _, scope in ipairs({ { "spell", "to Spells" }, { "attack", "to Attacks" }, { "global", "" } }) do
      local kMin = scope[1] .. "_minimum_added_" .. dt[2] .. "_damage"
      local kMax = scope[1] .. "_maximum_added_" .. dt[2] .. "_damage"
      if stats[kMin] and stats[kMax] and stats[kMax] > 0 then
        handledAddedStatKeys[kMin] = true
        handledAddedStatKeys[kMax] = true
        local suffix = #scope[2] > 0 and (" " .. scope[2]) or ""
        addLine("Adds " .. math.floor(stats[kMin] + 0.5) .. " to " .. math.floor(stats[kMax] + 0.5) .. " " .. dt[1] .. " Damage" .. suffix)
      end
    end
    -- Conversions
    local c1 = stats["skill_physical_damage_%_to_convert_to_" .. dt[2]] or stats["active_skill_base_physical_damage_%_to_convert_to_" .. dt[2]]
    if c1 and c1 > 0 and dt[1] ~= "Physical" then
      addLine(c1 .. "% of Physical Damage Converted to " .. dt[1] .. " Damage")
    end
  end
  if stats["deal_no_elemental_damage"] and stats["deal_no_elemental_damage"] ~= 0 then addLine("Deal no Elemental Damage") end
  if stats["base_deal_no_chaos_damage"] and stats["base_deal_no_chaos_damage"] ~= 0 then addLine("Deal no Chaos Damage") end
  if stats["global_always_hit"] and stats["global_always_hit"] ~= 0 then addLine("Your Hits can't be Evaded") end

  -- Extract maxStages from baseMods if present (e.g. Vaal Flameblast)
  local maxStages = nil
  local baseModsList = (ss and ss.baseMods) or ge.baseMods
  if type(baseModsList) == "table" then
    for _, bm in ipairs(baseModsList) do
      if type(bm) == "table" and bm.name == "Multiplier:VaalFlameblastMaxStages" and type(bm.value) == "number" then
        maxStages = bm.value
      end
    end
  end

  local modCtx = {
    isSupport = ge.support == true,
    stats = stats,
    maxStages = maxStages,
  }

  -- Walk statMap (skill-local + global data.skillStatMap)
  local localStatMap = (ss and ss.statMap) or ge.statMap or {}
  local globalStatMap = data.skillStatMap or {}
  local statKeys = {}
  for k, _ in pairs(stats) do table.insert(statKeys, k) end
  table.sort(statKeys)
  local addedMinMax = {}
  for _, sk in ipairs(statKeys) do
    local sv = stats[sk]
    if type(sv) == "number" and sv ~= 0 then
      local mapEntry = localStatMap[sk] or globalStatMap[sk]
      if type(mapEntry) == "table" then
        for _, m in ipairs(mapEntry) do
          -- Collect flat added Min/Max pairs from statMap (e.g. Elemental Hit, Added Cold/Lightning/Chaos)
          local hasComplexExtra = false
          if type(m) == "table" then
            for _, ex in ipairs(m) do
              if type(ex) == "table" and (ex.type == "PercentStat" or ex.type == "PerStat" or ex.type == "Multiplier" or ex.type == "SkillPart") then
                hasComplexExtra = true
              end
            end
          end
          local MINMAX_MAP = {
            PhysicalMin = { "Physical", "Min" }, PhysicalMax = { "Physical", "Max" },
            FireMin = { "Fire", "Min" }, FireMax = { "Fire", "Max" },
            ColdMin = { "Cold", "Min" }, ColdMax = { "Cold", "Max" },
            LightningMin = { "Lightning", "Min" }, LightningMax = { "Lightning", "Max" },
            ChaosMin = { "Chaos", "Min" }, ChaosMax = { "Chaos", "Max" },
          }
          if type(m) == "table" and m.type == "BASE" and type(m.name) == "string" and not hasComplexExtra and not handledAddedStatKeys[sk] then
            local mm = MINMAX_MAP[m.name]
            if mm then
              local dt, bound = mm[1], mm[2]
              local f = type(m.flags) == "number" and m.flags or 0
              local scope = bit.band(f, ModFlag.Spell or 0) ~= 0 and "to Spells"
                or (bit.band(f, ModFlag.Attack or 0) ~= 0 and "to Attacks" or "")
              local pairKey = scope .. ":" .. dt
              addedMinMax[pairKey] = addedMinMax[pairKey] or { dt = dt, scope = scope }
              local val = m.value ~= nil and m.value or sv
              if type(val) == "number" and val > 0 then
                addedMinMax[pairKey][bound] = math.floor(val + 0.5)
              end
            end
          end
          local line = modToStatLine(m, sv, modCtx)
          addLine(line)
        end
      end
    end
  end

  -- Emit collected statMap Min/Max flat added damage pairs
  local pairKeys = {}
  for pk, _ in pairs(addedMinMax) do table.insert(pairKeys, pk) end
  table.sort(pairKeys)
  for _, pk in ipairs(pairKeys) do
    local p = addedMinMax[pk]
    if p.Min and p.Max and p.Max > 0 then
      local suffix = #p.scope > 0 and (" " .. p.scope) or ""
      addLine("Adds " .. p.Min .. " to " .. p.Max .. " " .. p.dt .. " Damage" .. suffix)
    end
  end

  -- Also walk static baseMods (skip SkillData)
  if type(baseModsList) == "table" then
    for _, bm in ipairs(baseModsList) do
      if type(bm) == "table" and bm.name ~= "SkillData" and bm.value ~= nil then
        local line = modToStatLine(bm, bm.value, modCtx)
        addLine(line)
      end
    end
  end

  if #lines > 0 then out.st = lines end
  return out, stats, lvl, ssLvl
end

-- 3. Export Enriched Official Gems
local gemsOut = {}
local gemCount = 0
for gemId, g in pairs(data.gems or {}) do
  local ge = g.grantedEffect
  if ge and type(g.name) == "string" and #g.name > 0 then
    local ss = isPoe2 and (ge.statSets and ge.statSets[1]) or nil
    if (not isPoe2) or ss then
      local targetLv = (ge.levels and ge.levels[20]) and 20 or (ge.levels and ge.levels[1] and 1) or 20
      local lv20, stats20, lvl20, ssLvl20 = extractLevelSnapshot(ge, ss, targetLv)
      if lv20 then
        local rec = {
          en = g.name,
          sup = ge.support and 1 or 0,
        }
        if ge.castTime and ge.castTime > 0 then rec.ct = ge.castTime end
        local cd = (lvl20 and lvl20.cooldown) or (ssLvl20 and ssLvl20.cooldown)
        if cd and cd > 0 then rec.cd = cd end
        if ge.baseMods and type(ge.baseMods) == "table" then
          for _, bm in ipairs(ge.baseMods) do
            if type(bm) == "table" and bm.name == "SkillData" and type(bm.value) == "table" and bm.value.key == "dpsMultiplier" and type(bm.value.value) == "number" and bm.value.value > 1 and bm[1] == nil then
              rec.dm = bm.value.value
            end
          end
        end
        local crit = (ssLvl20 and ssLvl20.critChance) or (lvl20 and lvl20.critChance)
        if crit and crit > 0 then rec.cc = crit end
        if lvl20 and lvl20.attackSpeedMultiplier and lvl20.attackSpeedMultiplier ~= 100 then
          rec.asm = math.floor((1 + lvl20.attackSpeedMultiplier / 100) * 1000 + 0.5) / 1000
        elseif stats20 and stats20["active_skill_attack_speed_+%_final"] and stats20["active_skill_attack_speed_+%_final"] ~= 0 then
          rec.asm = math.floor((1 + stats20["active_skill_attack_speed_+%_final"] / 100) * 1000 + 0.5) / 1000
        end
        if lvl20 and lvl20.manaReservationPercent and lvl20.manaReservationPercent > 0 then
          rec.mrp = lvl20.manaReservationPercent
        end
        if lvl20 and lvl20.manaReservationFlat and lvl20.manaReservationFlat > 0 then
          rec.mrf = lvl20.manaReservationFlat
        end
        if lvl20 and lvl20.spiritReservationFlat and lvl20.spiritReservationFlat > 0 then
          rec.sr = lvl20.spiritReservationFlat
        end
        if lv20.bd then rec.bd = lv20.bd end
        if lv20.am then rec.am = lv20.am end
        if lv20.de then rec.de = lv20.de end
        if lv20.mc then rec.mc = lv20.mc end
        if lv20.st then rec.st = lv20.st end

        -- Quality stats
        if ge.qualityStats and type(ge.qualityStats) == "table" then
          local qout = {}
          for _, row in ipairs(ge.qualityStats) do
            local tpl = QUALITY_KEY_MAP[row[1]]
            if tpl and type(row[2]) == "number" and row[2] ~= 0 then
              table.insert(qout, { t = tpl, q = row[2] })
            end
          end
          rec.qs = qout
        end

        -- Multi-level scaling snapshots
        local ls = {}
        local lsCount = 0
        for _, L in ipairs(SAMPLE_LEVELS) do
          if ge.levels and ge.levels[L] and L ~= targetLv then
            local snap = extractLevelSnapshot(ge, ss, L)
            if snap and (snap.bd or snap.am or snap.st) then
              ls[tostring(L)] = snap
              lsCount = lsCount + 1
            end
          end
        end
        if lsCount > 0 then rec.ls = ls end

        gemsOut[g.name:lower()] = rec
        gemCount = gemCount + 1
      end
    end
  end
end

local fh2 = assert(io.open(outGemsPath, "w"))
fh2:write(toJson({ game = game, count = gemCount, gems = gemsOut }))
fh2:close()
print(string.format("Exported %d %s official skill definitions -> %s", gemCount, game, outGemsPath))

-- 4. Export Official Unique Items (resolving latest variant & midpoint ranges)
if outUniquesPath then
  local CAT_TO_SLOT = {
    body = "Body Armour",
    helmet = "Helmet",
    gloves = "Gloves",
    boots = "Boots",
    amulet = "Amulet",
    ring = "Ring 1",
    belt = "Belt",
    shield = "Weapon 2",
    focus = "Weapon 2",
    quiver = "Weapon 2",
    flask = "Flask 1",
    jewel = "Jewel",
    axe = "Weapon 1",
    bow = "Weapon 1",
    claw = "Weapon 1",
    crossbow = "Weapon 1",
    dagger = "Weapon 1",
    flail = "Weapon 1",
    mace = "Weapon 1",
    sceptre = "Weapon 1",
    spear = "Weapon 1",
    staff = "Weapon 1",
    sword = "Weapon 1",
    wand = "Weapon 1",
  }

  local function resolveRollMidpoint(line)
    -- Replace numeric ranges like (80-120) or (1.5-2.5) with PoB-style midpoint
    local s = line:gsub("%((%-?%d+%.?%d*)%-(%-?%d+%.?%d*)%)", function(a, b)
      local na, nb = tonumber(a), tonumber(b)
      if not na or not nb then return a end
      local isFloat = a:find("%.") or b:find("%.")
      local mid = (na + nb) / 2
      if not isFloat then return tostring(math.floor(mid)) end
      return tostring(math.floor(mid * 10 + 0.5) / 10)
    end)
    return s
  end

  local function variantMatches(line, targetVar)
    local varSpec = line:match("{variant:([^}]+)}")
    if not varSpec then return true end
    for num in varSpec:gmatch("%d+") do
      if tonumber(num) == targetVar then return true end
    end
    return false
  end

  local function stripTags(line)
    local s = line:gsub("{[^}]+}", "")
    return s:match("^%s*(.-)%s*$")
  end

  local uniquesOut = {}
  local seenUnique = {}
  local catKeys = {}
  for cat, list in pairs(data.uniques or {}) do
    if type(list) == "table" and CAT_TO_SLOT[cat] then
      table.insert(catKeys, cat)
    end
  end
  table.sort(catKeys)

  for _, cat in ipairs(catKeys) do
    local slot = CAT_TO_SLOT[cat]
    for _, raw in ipairs(data.uniques[cat]) do
      if type(raw) == "string" then
        local lines = {}
        for l in raw:gmatch("[^\r\n]+") do
          local t = l:match("^%s*(.-)%s*$")
          if #t > 0 then table.insert(lines, t) end
        end
        if #lines >= 2 then
          -- Count variants; pick last variant ("Current")
          local variantCount = 0
          for _, l in ipairs(lines) do
            if l:match("^Variant:") then variantCount = variantCount + 1 end
          end
          local pickVar = variantCount > 0 and variantCount or 1
          local name = stripTags(lines[1])
          local baseName = nil
          local impCount = 0
          local modLines = {}
          local inMods = false
          for i = 2, #lines do
            local l = lines[i]
            local isMeta = l:match("^Variant:") or l:match("^Version:") or l:match("^League:") or l:match("^Source:") or l:match("^Requires") or l:match("^Selected") or l:match("^Has Alt") or l:match("^Upgrade") or l:match("^LevelReq:") or l:match("^Sockets:") or l:match("^Limited") or l:match("^Radius:") or l:match("^Item Level:") or l:match("^Quality:") or l == "Corrupted" or l == "Elder Item" or l == "Shaper Item" or l == "Historic" or l == "Synthesised Item" or l == "Fractured Item" or l == "Mirrored" or l == "Searing Exarch Item" or l == "Eater of Worlds Item" or l == "Crusader Item" or l == "Hunter Item" or l == "Redeemer Item" or l == "Warlord Item" or l:match("^Implicit Modifier") or l:match("^Prefix Modifier") or l:match("^Suffix Modifier")
            if l:match("^Implicits:%s*(%d+)") then
              impCount = tonumber(l:match("^Implicits:%s*(%d+)")) or 0
              inMods = true
            elseif not baseName and not isMeta then
              if variantMatches(l, pickVar) then
                baseName = stripTags(l)
              end
            elseif baseName and not isMeta then
              inMods = true
              if variantMatches(l, pickVar) then
                local clean = resolveRollMidpoint(stripTags(l))
                local isCleanedMeta = clean == "Corrupted" or clean == "Elder Item" or clean == "Shaper Item" or clean == "Historic" or clean == "Synthesised Item" or clean == "Fractured Item" or clean == "Mirrored" or clean == "Searing Exarch Item" or clean == "Eater of Worlds Item" or clean == "Crusader Item" or clean == "Hunter Item" or clean == "Redeemer Item" or clean == "Warlord Item" or clean:match("^Version:")
                if #clean > 0 and not isCleanedMeta then table.insert(modLines, clean) end
              end
            end
          end

          if name and #name > 0 and baseName and #baseName > 0 and not seenUnique[name] then
            seenUnique[name] = true
            local imps = {}
            local exps = {}
            for idx, ml in ipairs(modLines) do
              if idx <= impCount then table.insert(imps, ml) else table.insert(exps, ml) end
            end
            local entry = {
              en = name,
              b = baseName,
              s = slot,
              e = exps,
            }
            if #imps > 0 then entry.i = imps end
            table.insert(uniquesOut, entry)
          end
        end
      end
    end
  end

  local fh3 = assert(io.open(outUniquesPath, "w"))
  fh3:write(toJson({ game = game, count = #uniquesOut, uniques = uniquesOut }))
  fh3:close()
  print(string.format("Exported %d %s official unique items -> %s", #uniquesOut, game, outUniquesPath))
end

-- 5. Export Official PoE 1 Cluster Jewel Notables (308 cluster notables)
if outClustersPath and not isPoe2 then
  local tree = main.tree and (main.tree["3_30"] or main.tree[latestTreeVersion])
  local clustersOut = {}
  local ccount = 0
  if tree and tree.clusterNodeMap then
    local names = {}
    for name, _ in pairs(tree.clusterNodeMap) do table.insert(names, name) end
    table.sort(names)
    for _, name in ipairs(names) do
      local node = tree.clusterNodeMap[name]
      if type(node) == "table" and node.sd and #node.sd > 0 then
        local st = {}
        for _, line in ipairs(node.sd) do
          if type(line) == "string" and #line > 0 then table.insert(st, line) end
        end
        if #st > 0 then
          clustersOut[name] = { en = name, st = st }
          ccount = ccount + 1
        end
      end
    end
  end
  local fh4 = assert(io.open(outClustersPath, "w"))
  fh4:write(toJson({ game = game, count = ccount, notables = clustersOut }))
  fh4:close()
  print(string.format("Exported %d %s official Cluster Jewel notables -> %s", ccount, game, outClustersPath))
end
