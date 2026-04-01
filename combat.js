// combat.js - Full multiplayer cooperative combat engine

let activeCombat = null;
let combatProcessingLock = false;

const CombatEngine = {
  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  start(combatData) {
    if (window.Multiplayer && window.Multiplayer.enabled) {
      this._startMultiplayer(combatData);
    } else {
      this._startSolo(combatData);
    }
  },

  playerAction(skillName, targetId) {
    if (!activeCombat || activeCombat.locked) return;
    
    if (window.Multiplayer && window.Multiplayer.enabled) {
      this._sendPlayerAction(skillName, targetId);
    } else {
      this._processPlayerAction(skillName, targetId);
    }
  },

  endCombat(outcome, data = null) {
    if (!activeCombat) return;
    const c = activeCombat;
    
    // Cleanup UI
    document.getElementById('combatOverlay').classList.remove('open');
    
    if (window.Multiplayer && window.Multiplayer.enabled && window.Multiplayer.isHost()) {
      this._broadcastCombatEnd(outcome, data);
    }
    
    // Apply rewards locally (host handles for everyone via sync)
    if (!window.Multiplayer?.enabled || window.Multiplayer.isHost()) {
      this._applyCombatOutcome(outcome, data);
    }
    
    activeCombat = null;
  },

  clog(text, cls = 'cl-system') {
    const log = document.getElementById('combatLog');
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'cl-entry ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = 999999;
    if (activeCombat) activeCombat.combatLog.push({ text, cls, timestamp: Date.now() });
  },

  refresh() {
    if (!activeCombat) return;
    if (window.Multiplayer && window.Multiplayer.enabled && !window.Multiplayer.isHost()) {
      // Clients rely on sync messages; only host refreshes UI directly
      return;
    }
    this._renderCombatUI();
  },

  // ------------------------------------------------------------
  // Multiplayer Mode
  // ------------------------------------------------------------
  _startMultiplayer(combatData) {
    if (!window.Multiplayer.isHost()) {
      console.warn('Non-host cannot start combat');
      return;
    }
    
    const c = this._initCombatState(combatData);
    activeCombat = c;
    
    // Broadcast to all clients
    this._broadcastCombatStart();
    this._calculateTurnOrder();
    this.clog(`⚔ Combat begins!`, 'cl-system');
    this._renderCombatUI();
    document.getElementById('combatOverlay').classList.add('open');
    Ui.setInputLocked(true);
    this._nextTurn();
  },

  _initCombatState(combatData) {
    const combatants = [];
    const players = [];
    
    // Get all players from multiplayer
    const allPlayers = window.Multiplayer.players || [];
    for (const p of allPlayers) {
      const snap = p.snapshot || {};
      const stats = snap.stats || { str: 10, agi: 10, int: 10, cha: 10, tec: 10, end: 10 };
      players.push({
        id: p.id,
        name: p.name,
        hp: snap.hp || 100,
        maxHp: snap.maxHp || 100,
        agi: stats.agi || 10,
        stats: stats,
        skills: (snap.skills || []).map(s => ({ ...s, currentCooldown: 0 })),
        statusEffects: [],
        pendingActions: [],
        tempMods: {},
        statModDurations: {},
        reflectPercent: 0,
        reflectDuration: 0,
        immunities: [],
        isPlayer: true,
        playerId: p.id
      });
      
      combatants.push({
        id: p.id,
        name: p.name,
        team: 'player',
        hp: snap.hp || 100,
        maxHp: snap.maxHp || 100,
        agi: stats.agi || 10,
        skills: (snap.skills || []).map(s => ({ ...s, currentCooldown: 0 })),
        statusEffects: [],
        pendingActions: [],
        tempMods: {},
        statModDurations: {},
        reflectPercent: 0,
        reflectDuration: 0,
        immunities: [],
        isPlayer: true,
        playerId: p.id
      });
    }
    
    // Enemies
    const enemies = Array.isArray(combatData.enemies) ? combatData.enemies : [combatData.enemy];
    enemies.forEach((enemy, idx) => {
      let enemySkills = enemy.skills || [];
      if (enemySkills.length === 0) {
        enemySkills = [{
          name: 'Punch',
          damage: [5, 12],
          energyCost: 5,
          cooldown: 0,
          currentCooldown: 0,
          statusEffect: null
        }];
      }
      combatants.push({
        id: `enemy_${idx}`,
        name: enemy.name,
        team: 'enemy',
        hp: enemy.hp,
        maxHp: enemy.hp,
        level: enemy.level || 1,
        description: enemy.description || '',
        skills: enemySkills.map(s => ({ ...s, currentCooldown: 0 })),
        statusEffects: [],
        pendingActions: [],
        tempMods: {},
        statModDurations: {},
        reflectPercent: 0,
        reflectDuration: 0,
        immunities: [],
        agi: enemy.agi || 5,
        isPlayer: false
      });
    });
    
    // Allies
    if (combatData.allies && Array.isArray(combatData.allies)) {
      combatData.allies.forEach((ally, idx) => {
        combatants.push({
          id: `ally_${idx}`,
          name: ally.name,
          team: 'ally',
          hp: ally.hp,
          maxHp: ally.hp,
          level: ally.level || 1,
          description: ally.description || '',
          skills: (ally.skills || []).map(s => ({ ...s, currentCooldown: 0 })),
          statusEffects: [],
          pendingActions: [],
          tempMods: {},
          statModDurations: {},
          reflectPercent: 0,
          reflectDuration: 0,
          immunities: [],
          agi: ally.agi || 5,
          isPlayer: false
        });
      });
    }
    
    return {
      combatants: combatants,
      players: players,
      round: 1,
      cooldowns: {},
      locked: false,
      turnOrder: [],
      currentTurnIndex: 0,
      currentCombatant: null,
      combatLog: [],
      dialogueEnabled: true,
      defeatedEnemies: []
    };
  },

  _broadcastCombatStart() {
    window.Multiplayer._send('combat_start', {
      combat: this._serializeCombatState()
    });
  },

  _broadcastCombatSync() {
    window.Multiplayer._send('combat_sync', {
      combat: this._serializeCombatState()
    });
  },

  _broadcastCombatEnd(outcome, data) {
    window.Multiplayer._send('combat_end', { outcome, data });
  },

  _sendPlayerAction(skillName, targetId) {
    window.Multiplayer._send('combat_action', {
      skill: skillName,
      targetId: targetId
    });
  },

  _serializeCombatState() {
    const c = activeCombat;
    if (!c) return null;
    return {
      combatants: c.combatants.map(cb => ({
        id: cb.id,
        name: cb.name,
        team: cb.team,
        hp: cb.hp,
        maxHp: cb.maxHp,
        statusEffects: cb.statusEffects,
        tempMods: cb.tempMods,
        reflectPercent: cb.reflectPercent,
        reflectDuration: cb.reflectDuration,
        immunities: cb.immunities,
        isPlayer: cb.isPlayer,
        playerId: cb.playerId
      })),
      players: c.players.map(p => ({
        id: p.id,
        name: p.name,
        hp: p.hp,
        maxHp: p.maxHp,
        agi: p.agi,
        stats: p.stats,
        skills: p.skills,
        statusEffects: p.statusEffects
      })),
      round: c.round,
      cooldowns: c.cooldowns,
      turnOrder: c.turnOrder.map(cb => cb.id),
      currentTurnIndex: c.currentTurnIndex,
      combatLog: c.combatLog.slice(-50)
    };
  },

  _deserializeCombatState(data) {
    const c = activeCombat;
    if (!c) return;
    
    // Update combatants
    for (const newCb of data.combatants) {
      const existing = c.combatants.find(cb => cb.id === newCb.id);
      if (existing) {
        existing.hp = newCb.hp;
        existing.statusEffects = newCb.statusEffects;
        existing.tempMods = newCb.tempMods;
        existing.reflectPercent = newCb.reflectPercent;
        existing.reflectDuration = newCb.reflectDuration;
        existing.immunities = newCb.immunities;
      }
    }
    
    // Update players (for UI)
    for (const newP of data.players) {
      const existing = c.players.find(p => p.id === newP.id);
      if (existing) {
        existing.hp = newP.hp;
        existing.stats = newP.stats;
      }
    }
    
    c.round = data.round;
    c.cooldowns = data.cooldowns;
    c.currentTurnIndex = data.currentTurnIndex;
    c.currentCombatant = c.combatants.find(cb => cb.id === data.turnOrder[data.currentTurnIndex]);
    
    this._renderCombatUI();
  },

  _processPlayerAction(skillName, targetId) {
    if (!activeCombat || activeCombat.locked) return;
    const c = activeCombat;
    const current = c.currentCombatant;
    if (!current || !current.isPlayer) return;
    
    activeCombat.locked = true;
    
    // Find the player data for this combatant
    const playerData = c.players.find(p => p.id === current.playerId);
    if (!playerData) {
      activeCombat.locked = false;
      return;
    }
    
    // Check stun
    if (this._isStunned(current)) {
      this._removeStun(current);
      this.clog(`${current.name} is stunned and loses turn!`, 'cl-status');
      this._nextTurn();
      return;
    }
    
    // Handle special actions
    if (skillName === '__wait') {
      this._handleWait(current, playerData);
      this._nextTurn();
      return;
    }
    
    if (skillName === '__flee') {
      this._handleFlee(current, playerData);
      return;
    }
    
    if (skillName === '__item') {
      this._handleItemUse(current, playerData);
      this._nextTurn();
      return;
    }
    
    // Regular skill
    const skill = (playerData.skills || []).find(s => s.name === skillName);
    if (!skill) {
      activeCombat.locked = false;
      return;
    }
    
    const target = c.combatants.find(cb => cb.id === targetId);
    if (!target || target.hp <= 0) {
      activeCombat.locked = false;
      return;
    }
    
    // Check energy (use player's local state, but host may have its own copy)
    const energyCost = skill.energyCost || 0;
    const currentEnergy = playerData.stats.energy || 0;
    if (currentEnergy < energyCost) {
      this.clog(`Not enough energy!`, 'cl-system');
      activeCombat.locked = false;
      return;
    }
    
    // Deduct energy
    playerData.stats.energy = currentEnergy - energyCost;
    if (playerData.id === 'player' || playerData.id === window.Multiplayer?.playerId) {
      State.energy = playerData.stats.energy;
    }
    
    // Apply cooldown
    c.cooldowns[skill.name] = skill.cooldown || 0;
    
    // Calculate damage
    let dmg = 0;
    let isCrit = false;
    let exposeMultiplier = 1;
    const exposeEffect = target.statusEffects.find(s => s.type === 'expose');
    if (exposeEffect) exposeMultiplier = 1.5;
    
    if (skill.damage) {
      const base = skill.damage[0] + Math.floor(Math.random() * (skill.damage[1] - skill.damage[0] + 1));
      const statMod = skill.statScaling ? Math.floor((playerData.stats[skill.statScaling] || 0) * 0.4) : 0;
      isCrit = Math.random() * 100 < (playerData.stats.agi || 0) * 1.5;
      dmg = Math.max(1, Math.floor((base + statMod) * (isCrit ? 1.5 : 1) * exposeMultiplier));
    }
    
    let finalDmg = dmg;
    const damageType = skill.damageType || 'physical';
    
    // Immunity check
    if (target.immunities && target.immunities.some(imm => imm.type === 'all' || imm.type === damageType)) {
      this.clog(`${target.name} is immune to ${damageType}!`, 'cl-status');
      finalDmg = 0;
    }
    
    // Reflect
    if (target.reflectPercent > 0 && dmg > 0) {
      const reflectDmg = Math.floor(dmg * target.reflectPercent / 100);
      if (reflectDmg > 0) {
        EffectEngine.execute(current, { type: 'damage', value: reflectDmg, target: 'self' }, `${target.name}'s reflection`);
      }
    }
    
    if (finalDmg > 0) {
      target.hp = Math.max(0, target.hp - finalDmg);
      if (target.isPlayer) {
        const targetPlayer = c.players.find(p => p.id === target.playerId);
        if (targetPlayer) targetPlayer.hp = target.hp;
        if (target.playerId === window.Multiplayer?.playerId) State.hp = target.hp;
      }
    }
    
    // Log
    let mechMsg = `${current.name} uses ${skill.name} on ${target.name}`;
    if (finalDmg > 0) mechMsg += ` — ${finalDmg} dmg${isCrit ? ' [CRIT]' : ''}`;
    this.clog(mechMsg, isCrit ? 'cl-crit' : 'cl-player');
    
    // Apply status effects
    const effectsToApply = skill.statusEffects || (skill.statusEffect ? [skill.statusEffect] : null);
    if (effectsToApply && effectsToApply.length) {
      this._applyStatusEffects(effectsToApply, current, target, skill.name);
    }
    
    this._renderCombatUI();
    
    // Check if target defeated
    if (target.hp <= 0 && target.team === 'enemy') {
      this.clog(`${target.name} has been defeated!`, 'cl-system');
      c.defeatedEnemies.push({ name: target.name, id: target.id });
      const idx = c.combatants.findIndex(cb => cb.id === target.id);
      if (idx !== -1) c.combatants.splice(idx, 1);
    }
    
    // Check if all enemies defeated
    const enemiesRemaining = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
    if (enemiesRemaining.length === 0) {
      this.endCombat('win');
      return;
    }
    
    // Check if any player defeated
    const playersRemaining = c.combatants.filter(cb => cb.isPlayer && cb.hp > 0);
    if (playersRemaining.length === 0) {
      this.endCombat('death');
      return;
    }
    
    activeCombat.locked = false;
    this._nextTurn();
  },

  // ------------------------------------------------------------
  // Solo Mode (preserved from original, simplified)
  // ------------------------------------------------------------
  _startSolo(combatData) {
    // Keep original solo logic, but reuse the new state structure
    const c = this._initSoloState(combatData);
    activeCombat = c;
    this._calculateTurnOrder();
    this.clog(`⚔ Combat begins!`, 'cl-system');
    this._renderCombatUI();
    document.getElementById('combatOverlay').classList.add('open');
    Ui.setInputLocked(true);
    this._nextTurn();
  },

  _initSoloState(combatData) {
    const combatants = [];
    const players = [];
    
    const playerCombatant = {
      id: 'player',
      name: State.playerName || 'You',
      team: 'player',
      hp: State.hp,
      maxHp: State.maxHp,
      agi: State.stats.agi,
      stats: State.stats,
      skills: State.skills.map(s => ({ ...s, currentCooldown: 0 })),
      statusEffects: [],
      pendingActions: [],
      tempMods: {},
      statModDurations: {},
      reflectPercent: 0,
      reflectDuration: 0,
      immunities: [],
      isPlayer: true,
      playerId: 'player'
    };
    combatants.push(playerCombatant);
    
    players.push({
      id: 'player',
      name: State.playerName || 'You',
      hp: State.hp,
      maxHp: State.maxHp,
      agi: State.stats.agi,
      stats: State.stats,
      skills: State.skills,
      statusEffects: [],
      isPlayer: true
    });
    
    const enemies = Array.isArray(combatData.enemies) ? combatData.enemies : [combatData.enemy];
    enemies.forEach((enemy, idx) => {
      let enemySkills = enemy.skills || [];
      if (enemySkills.length === 0) {
        enemySkills = [{
          name: 'Punch',
          damage: [5, 12],
          energyCost: 5,
          cooldown: 0,
          currentCooldown: 0,
          statusEffect: null
        }];
      }
      combatants.push({
        id: `enemy_${idx}`,
        name: enemy.name,
        team: 'enemy',
        hp: enemy.hp,
        maxHp: enemy.hp,
        level: enemy.level || 1,
        description: enemy.description || '',
        skills: enemySkills.map(s => ({ ...s, currentCooldown: 0 })),
        statusEffects: [],
        pendingActions: [],
        tempMods: {},
        statModDurations: {},
        reflectPercent: 0,
        reflectDuration: 0,
        immunities: [],
        agi: enemy.agi || 5,
        isPlayer: false
      });
    });
    
    if (combatData.allies && Array.isArray(combatData.allies)) {
      combatData.allies.forEach((ally, idx) => {
        combatants.push({
          id: `ally_${idx}`,
          name: ally.name,
          team: 'ally',
          hp: ally.hp,
          maxHp: ally.hp,
          level: ally.level || 1,
          description: ally.description || '',
          skills: (ally.skills || []).map(s => ({ ...s, currentCooldown: 0 })),
          statusEffects: [],
          pendingActions: [],
          tempMods: {},
          statModDurations: {},
          reflectPercent: 0,
          reflectDuration: 0,
          immunities: [],
          agi: ally.agi || 5,
          isPlayer: false
        });
      });
    }
    
    return {
      combatants: combatants,
      players: players,
      round: 1,
      cooldowns: {},
      locked: false,
      turnOrder: [],
      currentTurnIndex: 0,
      currentCombatant: null,
      combatLog: [],
      dialogueEnabled: true,
      defeatedEnemies: []
    };
  },

  // ------------------------------------------------------------
  // Turn Management
  // ------------------------------------------------------------
  _calculateTurnOrder() {
    const c = activeCombat;
    const alive = c.combatants.filter(cb => cb.hp > 0);
    c.turnOrder = alive.sort((a, b) => {
      const aAgi = a.agi + (a.tempMods?.agi || 0);
      const bAgi = b.agi + (b.tempMods?.agi || 0);
      return bAgi - aAgi;
    });
    c.currentTurnIndex = 0;
    c.currentCombatant = c.turnOrder[0];
    
    if (window.Multiplayer && window.Multiplayer.enabled && window.Multiplayer.isHost()) {
      this._broadcastCombatSync();
    }
  },

  _nextTurn() {
    if (!activeCombat) return;
    const c = activeCombat;
    
    // Process end-of-turn effects
    this._processEndOfTurn();
    
    c.currentTurnIndex++;
    if (c.currentTurnIndex >= c.turnOrder.length) {
      c.currentTurnIndex = 0;
      c.round++;
      this._processEndOfRound();
      this._calculateTurnOrder();
    }
    c.currentCombatant = c.turnOrder[c.currentTurnIndex];
    
    // Sync turn to clients
    if (window.Multiplayer && window.Multiplayer.enabled && window.Multiplayer.isHost()) {
      this._broadcastCombatSync();
    }
    
    this._renderCombatUI();
    
    // If it's an AI turn, process it
    if (c.currentCombatant && !c.currentCombatant.isPlayer) {
      setTimeout(() => this._processAITurn(c.currentCombatant), 500);
    } else {
      // Player turn: unlock
      activeCombat.locked = false;
      this._renderCombatUI();
    }
  },

  _processAITurn(combatant) {
    if (!activeCombat || activeCombat.currentCombatant !== combatant) return;
    if (combatant.hp <= 0) {
      this._nextTurn();
      return;
    }
    
    // Check stun
    if (this._isStunned(combatant)) {
      this._removeStun(combatant);
      this.clog(`${combatant.name} is stunned and loses turn!`, 'cl-status');
      this._nextTurn();
      return;
    }
    
    // Choose target and skill
    const { skill, dmg, target } = this._rollEnemyAction(combatant);
    if (!skill) {
      this.clog(`${combatant.name} holds their position.`, 'cl-system');
      this._nextTurn();
      return;
    }
    
    // Apply damage
    if (dmg > 0 && target) {
      target.hp = Math.max(0, target.hp - dmg);
      if (target.isPlayer) {
        const targetPlayer = activeCombat.players.find(p => p.id === target.playerId);
        if (targetPlayer) targetPlayer.hp = target.hp;
        if (target.playerId === window.Multiplayer?.playerId) State.hp = target.hp;
      }
      this.clog(`${combatant.name}'s ${skill.name} — ${dmg} dmg to ${target.name} (${target.hp}/${target.maxHp} HP)`, 'cl-enemy');
      
      // Apply status effects from AI skill
      const effectsToApply = skill.statusEffects || (skill.statusEffect ? [skill.statusEffect] : null);
      if (effectsToApply && effectsToApply.length) {
        this._applyStatusEffects(effectsToApply, combatant, target, skill.name);
      }
    }
    
    this._renderCombatUI();
    
    // Check for player death
    const playersAlive = activeCombat.combatants.filter(cb => cb.isPlayer && cb.hp > 0);
    if (playersAlive.length === 0) {
      this.endCombat('death');
      return;
    }
    
    // Check enemy defeat
    const enemiesRemaining = activeCombat.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
    if (enemiesRemaining.length === 0) {
      this.endCombat('win');
      return;
    }
    
    this._nextTurn();
  },

  _rollEnemyAction(combatant) {
    let available = combatant.skills.filter(s => (s.currentCooldown || 0) === 0);
    if (available.length === 0 && combatant.skills.length === 0) {
      combatant.skills.push({ name: 'Punch', damage: [5,12], energyCost:5, cooldown:0, currentCooldown:0, statusEffect:null });
      available = combatant.skills;
    }
    const skill = available.length ? available[Math.floor(Math.random() * available.length)] : null;
    if (!skill) return { skill: null, dmg: 0, target: null };
    
    const validTargets = activeCombat.combatants.filter(cb => cb.team !== combatant.team && cb.hp > 0);
    if (validTargets.length === 0) return { skill: null, dmg: 0, target: null };
    const target = validTargets[Math.floor(Math.random() * validTargets.length)];
    
    // Dodge chance based on target AGI
    const targetAgi = target.isPlayer ? (target.stats?.agi || 10) : target.agi;
    const slowDebuff = target.statusEffects.find(s => s.type === 'debuff_agi');
    const effectiveAgi = targetAgi - (slowDebuff ? slowDebuff.value : 0);
    const dodgeChance = Math.max(0, effectiveAgi * 3);
    const dodged = Math.random() * 100 < dodgeChance;
    if (dodged) return { skill, dmg: 0, dodged: true, target };
    
    const rawDmg = (skill.damage?.[0] || 5) + Math.floor(Math.random() * ((skill.damage?.[1] || 12) - (skill.damage?.[0] || 5) + 1));
    const shield = target.statusEffects.find(s => s.type === 'buff_shield');
    let finalDmg = rawDmg;
    if (shield) {
      const absorbed = Math.min(shield.value, rawDmg);
      finalDmg -= absorbed;
      shield.value -= absorbed;
      if (shield.value <= 0) target.statusEffects = target.statusEffects.filter(s => s !== shield);
    }
    return { skill, dmg: Math.max(0, finalDmg), target };
  },

  // ------------------------------------------------------------
  // Helper Methods
  // ------------------------------------------------------------
  _isStunned(combatant) {
    return combatant.statusEffects.some(s => s.type === 'skip');
  },
  
  _removeStun(combatant) {
    const stunIdx = combatant.statusEffects.findIndex(s => s.type === 'skip');
    if (stunIdx !== -1) {
      combatant.statusEffects[stunIdx].duration--;
      if (combatant.statusEffects[stunIdx].duration <= 0) {
        combatant.statusEffects.splice(stunIdx, 1);
      }
    }
  },
  
  _handleWait(current, playerData) {
    if (playerData.id === 'player' || playerData.id === window.Multiplayer?.playerId) {
      State.energy = Math.min(State.maxEnergy, State.energy + 25);
      playerData.stats.energy = State.energy;
    }
    this.clog(`${current.name} waits and recovers energy.`, 'cl-player');
  },
  
  _handleFlee(current, playerData) {
    const roll = Math.floor(Math.random() * 20) + 1;
    const thr = 8 - Math.floor((playerData.stats?.agi || 10) / 2);
    const success = roll >= thr;
    if (success) {
      this.clog(`${current.name} flees successfully!`, 'cl-system');
      this.endCombat('flee', { roll, threshold: thr, player: current.name });
    } else {
      this.clog(`${current.name} tries to flee but fails!`, 'cl-miss');
      this._nextTurn();
    }
  },
  
  _handleItemUse(current, playerData) {
    // Simplified: find first stim item and use it
    const inventory = playerData.id === 'player' ? State.inventory : [];
    const consumable = inventory?.find(i => /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0);
    if (consumable) {
      const healAmt = 20 + (playerData.stats?.tec || 0) * 2;
      current.hp = Math.min(current.maxHp, current.hp + healAmt);
      if (playerData.id === 'player' || playerData.id === window.Multiplayer?.playerId) {
        State.hp = current.hp;
        consumable.amount--;
        if (consumable.amount <= 0) {
          const idx = State.inventory.indexOf(consumable);
          if (idx !== -1) State.inventory.splice(idx, 1);
        }
      }
      this.clog(`${current.name} uses ${consumable.name} and heals ${healAmt} HP.`, 'cl-player');
    } else {
      this.clog(`${current.name} has no usable items.`, 'cl-system');
    }
  },
  
  _applyStatusEffects(effects, source, target, skillName) {
    for (const eff of effects) {
      if (eff.effects && Array.isArray(eff.effects)) {
        for (const action of eff.effects) {
          const actionTarget = action.target === 'self' ? source :
                               (action.target === 'ally' ? target : target);
          EffectEngine.execute(actionTarget, action, skillName);
        }
        if (eff.duration > 0) {
          target.statusEffects.push({
            name: eff.name,
            description: eff.description || `${eff.name} effect.`,
            duration: eff.duration,
            effects: eff.effects,
            type: 'custom'
          });
        }
      } else {
        // Simple status effect
        if (eff.type === 'skip') {
          const skipEffect = target.statusEffects.find(e => e.name === 'Stunned' && e.type === 'skip');
          if (skipEffect) {
            skipEffect.duration = Math.max(skipEffect.duration, eff.duration);
          } else {
            target.statusEffects.push({
              name: 'Stunned',
              type: 'skip',
              duration: eff.duration,
              value: 0,
              description: `Stunned for ${eff.duration} turns.`
            });
          }
          this.clog(`${target.name} is stunned for ${eff.duration} turn(s)!`, 'cl-status');
        } 
        else if (eff.type === 'dot') {
          const dotEffect = target.statusEffects.find(e => e.type === 'dot');
          if (dotEffect) {
            dotEffect.duration = Math.max(dotEffect.duration, eff.duration);
            dotEffect.value = Math.max(dotEffect.value, eff.value);
            if (eff.damageType) dotEffect.damageType = eff.damageType;
          } else {
            target.statusEffects.push({
              name: eff.name,
              type: 'dot',
              duration: eff.duration,
              value: eff.value,
              icon: eff.icon,
              description: `${eff.value} damage per turn.`,
              damageType: eff.damageType || 'poison',
            });
          }
        }
        else if (eff.type === 'expose') {
          const exposeEffect = target.statusEffects.find(e => e.type === 'expose');
          if (exposeEffect) {
            exposeEffect.duration = Math.max(exposeEffect.duration, eff.duration);
            exposeEffect.value = Math.max(exposeEffect.value, eff.value);
          } else {
            target.statusEffects.push({
              name: eff.name,
              type: 'expose',
              duration: eff.duration,
              value: eff.value,
              description: `Takes ${eff.value}% extra damage.`
            });
          }
          this.clog(`${target.name} is exposed — taking +${eff.value}% damage!`, 'cl-status');
        }
        else if (eff.type === 'debuff') {
          const debuffEffect = target.statusEffects.find(e => e.type === 'debuff_agi');
          if (debuffEffect) {
            debuffEffect.duration = Math.max(debuffEffect.duration, eff.duration);
            debuffEffect.value = Math.max(debuffEffect.value, eff.value);
          } else {
            target.statusEffects.push({
              name: eff.name,
              type: 'debuff_agi',
              duration: eff.duration,
              value: eff.value,
              description: `AGI reduced by ${eff.value}.`
            });
          }
          this.clog(`${target.name}'s AGI is reduced by ${eff.value}!`, 'cl-status');
        }
        else if (eff.type === 'buff') {
          // Energy restore
          if (target.isPlayer) {
            const player = activeCombat.players.find(p => p.id === target.playerId);
            if (player) {
              player.stats.energy = Math.min(State.maxEnergy, (player.stats.energy || 0) + eff.value);
              if (target.playerId === window.Multiplayer?.playerId) State.energy = player.stats.energy;
            }
          }
          this.clog(`+${eff.value} energy restored to ${target.name}!`, 'cl-player');
        }
        else if (eff.type === 'buff_hp') {
          const heal = Math.min(target.maxHp - target.hp, eff.value);
          if (heal > 0) {
            target.hp += heal;
            if (target.isPlayer) {
              const player = activeCombat.players.find(p => p.id === target.playerId);
              if (player) player.hp = target.hp;
              if (target.playerId === window.Multiplayer?.playerId) State.hp = target.hp;
            }
            this.clog(`${target.name} heals ${heal} HP!`, 'cl-player');
          }
        }
        else if (eff.type === 'buff_shield') {
          const shieldEffect = target.statusEffects.find(e => e.type === 'buff_shield');
          if (shieldEffect) {
            shieldEffect.value += eff.value;
            shieldEffect.duration = Math.max(shieldEffect.duration, eff.duration);
          } else {
            target.statusEffects.push({
              name: 'Shield',
              type: 'buff_shield',
              duration: eff.duration,
              value: eff.value,
              description: `Absorbs ${eff.value} damage.`
            });
          }
          this.clog(`${target.name} gains a shield for ${eff.value} damage!`, 'cl-status');
        }
      }
    }
  },
  
  _processEndOfTurn() {
    const c = activeCombat;
    // Decrease cooldowns
    Object.keys(c.cooldowns).forEach(key => {
      if (c.cooldowns[key] > 0) c.cooldowns[key]--;
    });
    c.combatants.forEach(cb => {
      cb.skills.forEach(sk => {
        if (sk.currentCooldown > 0) sk.currentCooldown--;
      });
    });
  },
  
  _processEndOfRound() {
    const c = activeCombat;
    for (const combatant of c.combatants) {
      // Process DOT
      for (let i = 0; i < combatant.statusEffects.length; i++) {
        const sf = combatant.statusEffects[i];
        if (sf.type === 'dot') {
          const dmg = sf.value || 5;
          const damageType = sf.damageType || 'poison';
          if (combatant.immunities && combatant.immunities.some(imm => imm.type === 'all' || imm.type === damageType)) {
            this.clog(`${combatant.name} is immune to ${damageType}!`, 'cl-status');
          } else {
            combatant.hp = Math.max(0, combatant.hp - dmg);
            if (combatant.isPlayer) {
              const player = c.players.find(p => p.id === combatant.playerId);
              if (player) player.hp = combatant.hp;
              if (combatant.playerId === window.Multiplayer?.playerId) State.hp = combatant.hp;
            }
            this.clog(`${sf.name}: ${combatant.name} -${dmg} HP`, 'cl-status');
          }
        }
        
        // Decrement duration
        if (sf.type !== 'skip') { // skip decremented in turn check
          sf.duration--;
          if (sf.duration <= 0) {
            this.clog(`${sf.name} fades from ${combatant.name}.`, 'cl-system');
            combatant.statusEffects.splice(i, 1);
            i--;
          }
        }
      }
      
      // Temp mods
      if (combatant.statModDurations) {
        for (const [stat, dur] of Object.entries(combatant.statModDurations)) {
          if (dur <= 1) {
            delete combatant.statModDurations[stat];
            combatant.tempMods[stat] = 0;
          } else {
            combatant.statModDurations[stat] = dur - 1;
          }
        }
      }
      
      // Reflect
      if (combatant.reflectDuration > 0) {
        combatant.reflectDuration--;
        if (combatant.reflectDuration <= 0) combatant.reflectPercent = 0;
      }
      
      // Immunities
      if (combatant.immunities) {
        combatant.immunities = combatant.immunities.filter(imm => {
          imm.remaining--;
          return imm.remaining > 0;
        });
      }
    }
    
    // Regen energy for players
    for (const player of c.players) {
      const regen = 5 + Math.floor((player.stats.int || 0) / 2);
      player.stats.energy = Math.min(State.maxEnergy, (player.stats.energy || 0) + regen);
      if (player.id === window.Multiplayer?.playerId) State.energy = player.stats.energy;
    }
  },
  
  _applyCombatOutcome(outcome, data) {
    if (outcome === 'win') {
      const defeatedCount = activeCombat.defeatedEnemies.length;
      const baseXp = defeatedCount * 25 + Math.floor(Math.random() * 20);
      Ui.addInstant(`[ COMBAT VICTORY: ${defeatedCount} enemies defeated in ${activeCombat.round} rounds ]`, 'system');
      activeCombat.defeatedEnemies.forEach(enemy => {
        const deadNpc = State.npcs.find(n => n.name.toLowerCase() === enemy.name.toLowerCase());
        if (deadNpc) deadNpc.relationship = 'Dead';
        else State.npcs.push({ name: enemy.name, relationship: 'Dead', description: `Defeated in combat on Day ${State.gameDay}.` });
      });
      Ui.renderSidebar();
      StatSystem.gainXp(baseXp);
    } else if (outcome === 'death') {
      showDeathScreen('You were killed in combat.');
    } else {
      Ui.addInstant(`[ Combat escaped ]`, 'system');
    }
  },
  
  // ------------------------------------------------------------
  // UI Rendering
  // ------------------------------------------------------------
  _renderCombatUI() {
    const c = activeCombat;
    if (!c) return;
    
    // Update enemy list
    const enemyContainer = document.getElementById('ceEnemyContainer');
    if (enemyContainer) {
      const enemies = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
      if (enemies.length) {
        enemyContainer.innerHTML = enemies.map(enemy => `
          <div class="ce-enemy-card" data-id="${enemy.id}">
            <div class="ce-header">
              <span class="ce-name">${enemy.name}</span>
              <span class="ce-level">LVL ${enemy.level || 1}</span>
            </div>
            <div class="ce-desc">${enemy.description || ''}</div>
            <div class="ce-hp-row">
              <div class="ce-hp-bar"><div class="ce-hp-fill" style="width:${Math.max(0, enemy.hp/enemy.maxHp*100)}%"></div></div>
              <span class="ce-hp-text">${Math.max(0, enemy.hp)}/${enemy.maxHp}</span>
            </div>
            <div class="ce-statuses" id="ceStatuses_${enemy.id}"></div>
          </div>`).join('');
        enemies.forEach(enemy => {
          const statusEl = document.getElementById(`ceStatuses_${enemy.id}`);
          if (statusEl) statusEl.innerHTML = this._renderStatuses(enemy.statusEffects);
        });
      } else {
        enemyContainer.innerHTML = '<div class="panel-empty">All enemies defeated!</div>';
      }
    }
    
    // Update ally list
    const allyContainer = document.getElementById('ceAllyContainer');
    if (allyContainer) {
      const allies = c.combatants.filter(cb => cb.team === 'ally' && cb.hp > 0);
      const allyLabel = document.getElementById('ceAllyLabel');
      if (allyLabel) allyLabel.style.display = allies.length ? 'block' : 'none';
      if (allies.length) {
        allyContainer.innerHTML = allies.map(ally => `
          <div class="ce-ally-card" data-id="${ally.id}">
            <div class="ce-header"><span class="ce-name">${ally.name}</span></div>
            <div class="ce-hp-row">
              <div class="ce-hp-bar"><div class="ce-hp-fill ally-fill" style="width:${Math.max(0, ally.hp/ally.maxHp*100)}%"></div></div>
              <span class="ce-hp-text">${Math.max(0, ally.hp)}/${ally.maxHp}</span>
            </div>
            <div class="ce-statuses" id="ceStatuses_${ally.id}"></div>
          </div>`).join('');
        allies.forEach(ally => {
          const statusEl = document.getElementById(`ceStatuses_${ally.id}`);
          if (statusEl) statusEl.innerHTML = this._renderStatuses(ally.statusEffects);
        });
      }
    }
    
    // Update player list (for sidebar or header)
    const playerContainer = document.getElementById('cePlayerContainer');
    if (playerContainer) {
      const players = c.players.filter(p => p.hp > 0);
      playerContainer.innerHTML = players.map(p => `
        <div class="ce-player-card ${c.currentCombatant?.playerId === p.id ? 'active-turn' : ''}" data-id="${p.id}">
          <div class="ce-header">
            <span class="ce-name">${p.name}</span>
            <span class="ce-hp-text">${p.hp}/${p.maxHp} HP</span>
          </div>
          <div class="ce-hp-row">
            <div class="ce-hp-bar"><div class="ce-hp-fill player-fill" style="width:${Math.max(0, p.hp/p.maxHp*100)}%"></div></div>
          </div>
          <div class="ce-statuses" id="ceStatuses_${p.id}"></div>
        </div>`).join('');
      players.forEach(p => {
        const statusEl = document.getElementById(`ceStatuses_${p.id}`);
        if (statusEl) statusEl.innerHTML = this._renderStatuses(p.statusEffects);
      });
    }
    
    // Turn display
    const turnLabel = document.getElementById('ceTurnLabel');
    if (turnLabel && c.currentCombatant) {
      if (c.currentCombatant.isPlayer) {
        const player = c.players.find(p => p.id === c.currentCombatant.playerId);
        turnLabel.textContent = player ? `${player.name}'s TURN` : 'PLAYER TURN';
        turnLabel.style.color = 'var(--green)';
      } else {
        turnLabel.textContent = `${c.currentCombatant.name.toUpperCase()}'S TURN`;
        turnLabel.style.color = '#ff6b7a';
      }
    }
    
    document.getElementById('ceRound').textContent = c.round;
    
    // Player vitals (for the local player)
    const localPlayer = c.players.find(p => p.id === (window.Multiplayer?.playerId || 'player'));
    if (localPlayer) {
      document.getElementById('cpHpFill').style.width = `${localPlayer.hp/localPlayer.maxHp*100}%`;
      document.getElementById('cpHpText').textContent = `${localPlayer.hp}/${localPlayer.maxHp}`;
      const localEnergy = localPlayer.stats?.energy || State.energy;
      const localMaxEnergy = State.maxEnergy;
      document.getElementById('cpEnFill').style.width = `${localEnergy/localMaxEnergy*100}%`;
      document.getElementById('cpEnText').textContent = `${localEnergy}/${localMaxEnergy}`;
    }
    
    // Build skill grid for the local player if it's their turn
    this._buildSkillGrid();
  },
  
  _renderStatuses(statuses) {
    if (!statuses || !statuses.length) return '';
    return statuses.map(sf => {
      let cls = 'sc-debuff';
      if (sf.type === 'dot') cls = 'sc-dot';
      else if (sf.type === 'skip') cls = 'sc-skip';
      else if (sf.type === 'expose') cls = 'sc-expose';
      else if (sf.type === 'buff_shield') cls = 'sc-buff';
      const desc = sf.description || `${sf.name} (${sf.duration}T)`;
      return `<span class="status-chip ${cls}" title="${desc}">${sf.name} ${sf.duration}T</span>`;
    }).join('');
  },
  
  _buildSkillGrid() {
    const grid = document.getElementById('combatSkillGrid');
    if (!grid) return;
    const c = activeCombat;
    const isPlayerTurn = c.currentCombatant?.isPlayer === true;
    const isLocalTurn = isPlayerTurn && (c.currentCombatant.playerId === (window.Multiplayer?.playerId || 'player'));
    const stunned = c.currentCombatant?.statusEffects?.some(s => s.type === 'skip');
    const canAct = isLocalTurn && !c.locked && !stunned;
    
    // Only show skills for local player if it's their turn
    if (!canAct) {
      grid.innerHTML = '<div class="panel-empty">Wait for your turn...</div>';
      return;
    }
    
    const localPlayer = c.players.find(p => p.id === (window.Multiplayer?.playerId || 'player'));
    const skills = localPlayer?.skills || [];
    const buttons = [];
    
    // Valid targets for skills (enemies + maybe allies for healing)
    const validTargets = c.combatants.filter(cb => cb.team !== 'player' && cb.hp > 0);
    
    skills.forEach(sk => {
      const cd = c.cooldowns[sk.name] || 0;
      const canUse = cd === 0 && (localPlayer.stats?.energy || State.energy) >= sk.energyCost && canAct;
      const dmgStr = sk.damage ? `${sk.damage[0]}-${sk.damage[1]}` : '—';
      buttons.push(`<button class="cb-skill-btn" data-skill="${sk.name}" ${!canUse ? 'disabled' : ''}>
        ${cd > 0 ? `<span class="csb-cd">${cd}T</span>` : ''}
        <span class="csb-name">${sk.name}</span>
        <span class="csb-meta">${sk.energyCost}en · ${dmgStr}dmg</span>
      </button>`);
    });
    
    if (validTargets.length > 1 && canAct) {
      const targetButtonsHtml = validTargets.map(t => `
        <button class="combat-target-btn" data-target-id="${t.id}">
          <span class="target-name">${t.name}</span>
          <span class="target-hp">${Math.max(0, t.hp)}/${t.maxHp} HP</span>
        </button>
      `).join('');
      buttons.push(`<div class="combat-targets-group">
        <div class="combat-targets-label">TARGET</div>
        <div class="combat-targets-buttons" id="combatTargetButtons">${targetButtonsHtml}</div>
      </div>`);
    }
    
    const consumable = State.inventory.find(i => /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0);
    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__wait" ${!canAct ? 'disabled' : ''}>
      <span class="csb-name">WAIT</span><span class="csb-meta">+25 energy</span>
    </button>`);
    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__item" ${(!consumable || !canAct) ? 'disabled' : ''}>
      <span class="csb-name">USE ITEM</span><span class="csb-meta">${consumable ? consumable.name : 'none'}</span>
    </button>`);
    buttons.push(`<button class="cb-skill-btn csb-flee" data-skill="__flee" ${!canAct ? 'disabled' : ''}>
      <span class="csb-name">FLEE</span><span class="csb-meta">AGI check</span>
    </button>`);
    
    grid.innerHTML = buttons.join('');
    
    let currentSelectedTargetId = validTargets[0]?.id;
    const targetContainer = document.getElementById('combatTargetButtons');
    if (targetContainer) {
      targetContainer.querySelectorAll('.combat-target-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          targetContainer.querySelectorAll('.combat-target-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentSelectedTargetId = btn.dataset.targetId;
        });
        if (btn === targetContainer.querySelector('.combat-target-btn:first-child')) btn.classList.add('active');
      });
    }
    
    grid.querySelectorAll('.cb-skill-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = currentSelectedTargetId || validTargets[0]?.id;
        this.playerAction(btn.dataset.skill, targetId);
      });
    });
  },
  
  // ------------------------------------------------------------
  // Multiplayer Message Handling (called from multiplayer.js)
  // ------------------------------------------------------------
  handleMultiplayerMessage(msg) {
    switch (msg.type) {
      case 'combat_start':
        this._receiveCombatStart(msg.combat);
        break;
      case 'combat_sync':
        this._receiveCombatSync(msg.combat);
        break;
      case 'combat_action':
        if (window.Multiplayer.isHost()) {
          this._processPlayerAction(msg.skill, msg.targetId);
        }
        break;
      case 'combat_end':
        this._receiveCombatEnd(msg.outcome, msg.data);
        break;
    }
  },
  
  _receiveCombatStart(serialized) {
    if (activeCombat) return;
    const c = this._deserializeCombatState(serialized);
    activeCombat = c;
    this._renderCombatUI();
    document.getElementById('combatOverlay').classList.add('open');
    Ui.setInputLocked(true);
    this.clog(`⚔ Combat begins!`, 'cl-system');
    // If it's the client's turn, the UI will reflect
    this._renderCombatUI();
  },
  
  _receiveCombatSync(serialized) {
    if (!activeCombat) return;
    this._deserializeCombatState(serialized);
    this._renderCombatUI();
  },
  
  _receiveCombatEnd(outcome, data) {
    document.getElementById('combatOverlay').classList.remove('open');
    if (outcome === 'win') {
      Ui.addInstant(`[ Combat victory! ]`, 'system');
    } else if (outcome === 'death') {
      // Only show death if local player died
      const localPlayer = activeCombat?.players.find(p => p.id === window.Multiplayer.playerId);
      if (localPlayer && localPlayer.hp <= 0) {
        showDeathScreen('You were killed in combat.');
      }
    } else {
      Ui.addInstant(`[ Combat escaped ]`, 'system');
    }
    activeCombat = null;
    Ui.setInputLocked(false);
  }
};

// ------------------------------------------------------------
// Effect Engine (unchanged, but integrated)
// ------------------------------------------------------------
const EffectEngine = {
  execute(combatant, action, sourceName) {
    const target = this._resolveTarget(combatant, action.target);
    if (!target) return false;
    
    switch (action.type) {
      case 'damage':
        return this._applyDamage(target, action.value, sourceName);
      case 'heal':
        return this._applyHeal(target, action.value, sourceName);
      case 'skip_turn':
        return this._applySkipTurn(target, action.duration || 1, sourceName);
      case 'change_team':
        return this._applyChangeTeam(target, action.newTeam, sourceName);
      case 'stat_mod':
        return this._applyStatMod(target, action.stat, action.delta, action.duration || 1, sourceName);
      case 'extra_turn':
        return this._applyExtraTurn(target, sourceName);
      case 'reflect_damage':
        return this._applyReflect(target, action.percent, action.duration || 1, sourceName);
      case 'spread':
        return this._applySpread(combatant, action.effectName, action.radius || 1, sourceName);
      case 'immune':
        return this._applyImmune(target, action.damageType, action.duration || 1, sourceName);
      case 'transform_skill':
        return this._applyTransformSkill(target, action.oldSkillName, action.newSkillName, sourceName);
      case 'wait':
        return true;
      default:
        console.warn('Unknown action type:', action.type);
        return false;
    }
  },
  
  _resolveTarget(combatant, targetId) {
    if (!targetId || targetId === 'self') return combatant;
    if (targetId === 'player') return activeCombat?.combatants.find(c => c.isPlayer);
    return activeCombat?.combatants.find(c => c.id === targetId || c.name === targetId);
  },
  
  _applyDamage(target, value, sourceName) {
    const actualDmg = Math.max(1, Math.floor(value));
    target.hp = Math.max(0, target.hp - actualDmg);
    if (target.isPlayer) {
      const player = activeCombat.players.find(p => p.id === target.playerId);
      if (player) player.hp = target.hp;
      if (target.playerId === window.Multiplayer?.playerId) State.hp = target.hp;
    }
    CombatEngine.clog(`${sourceName || 'Effect'} deals ${actualDmg} damage to ${target.name}.`, 'cl-effect');
    return true;
  },
  
  _applyHeal(target, value, sourceName) {
    const actualHeal = Math.max(1, Math.floor(value));
    target.hp = Math.min(target.maxHp, target.hp + actualHeal);
    if (target.isPlayer) {
      const player = activeCombat.players.find(p => p.id === target.playerId);
      if (player) player.hp = target.hp;
      if (target.playerId === window.Multiplayer?.playerId) State.hp = target.hp;
    }
    CombatEngine.clog(`${sourceName || 'Effect'} heals ${target.name} for ${actualHeal} HP.`, 'cl-effect');
    return true;
  },
  
  _applySkipTurn(target, duration, sourceName) {
    const skipEffect = target.statusEffects.find(e => e.name === 'Stunned' && e.type === 'skip');
    if (skipEffect) {
      skipEffect.duration = Math.max(skipEffect.duration, duration);
    } else {
      target.statusEffects.push({
        name: 'Stunned',
        type: 'skip',
        duration: duration,
        description: 'Cannot act for the duration.'
      });
    }
    CombatEngine.clog(`${target.name} is stunned for ${duration} turn(s).`, 'cl-effect');
    return true;
  },
  
  _applyChangeTeam(target, newTeam, sourceName) {
    target.team = newTeam;
    CombatEngine.clog(`${target.name} switches sides! Now fighting for ${newTeam}.`, 'cl-effect');
    CombatEngine._calculateTurnOrder();
    return true;
  },
  
  _applyStatMod(target, stat, delta, duration, sourceName) {
    if (!target.tempMods) target.tempMods = {};
    target.tempMods[stat] = (target.tempMods[stat] || 0) + delta;
    target.statModDurations = target.statModDurations || {};
    target.statModDurations[stat] = Math.max(target.statModDurations[stat] || 0, duration);
    const sign = delta >= 0 ? '+' : '';
    CombatEngine.clog(`${target.name}: ${stat.toUpperCase()} ${sign}${delta} for ${duration} turn(s).`, 'cl-effect');
    return true;
  },
  
  _applyExtraTurn(target, sourceName, count = 1, duration = 1) {
    const existing = target.statusEffects.find(e => e.type === 'extra_turn');
    if (existing) {
      existing.extraCount += count;
      existing.duration = Math.max(existing.duration, duration);
    } else {
      target.statusEffects.push({
        name: 'Haste',
        type: 'extra_turn',
        extraCount: count,
        duration: duration,
        description: `Grants ${count} extra action(s) each turn for ${duration} turns.`
      });
    }
    CombatEngine.clog(`${target.name} gains ${count} extra action(s) per turn for ${duration} turn(s).`, 'cl-effect');
    return true;
  },
  
  _applyReflect(target, percent, duration, sourceName) {
    target.reflectPercent = (target.reflectPercent || 0) + percent;
    target.reflectDuration = Math.max(target.reflectDuration || 0, duration);
    CombatEngine.clog(`${target.name} reflects ${percent}% damage for ${duration} turn(s).`, 'cl-effect');
    return true;
  },
  
  _applySpread(source, effectName, radius, sourceName) {
    const targets = activeCombat.combatants.filter(c => c.team !== source.team && c.id !== source.id);
    targets.forEach(target => {
      const sourceEffect = source.statusEffects.find(e => e.name === effectName);
      if (sourceEffect) {
        const newEffect = JSON.parse(JSON.stringify(sourceEffect));
        newEffect.duration = Math.max(1, sourceEffect.duration - 1);
        target.statusEffects.push(newEffect);
        CombatEngine.clog(`${effectName} spreads from ${source.name} to ${target.name}!`, 'cl-effect');
      }
    });
    return true;
  },
  
  _applyImmune(target, damageType, duration, sourceName) {
    if (!target.immunities) target.immunities = [];
    target.immunities.push({ type: damageType, remaining: duration });
    CombatEngine.clog(`${target.name} is immune to ${damageType} for ${duration} turn(s).`, 'cl-effect');
    return true;
  },
  
  _applyTransformSkill(target, oldSkillName, newSkillName, sourceName) {
    const skillIdx = target.skills.findIndex(s => s.name === oldSkillName);
    if (skillIdx !== -1) {
      const newSkill = {
        name: newSkillName,
        description: `Transformed from ${oldSkillName}`,
        damage: [5, 12],
        energyCost: 5,
        cooldown: 0,
        currentCooldown: 0,
        statScaling: null,
        statusEffect: null
      };
      target.skills[skillIdx] = newSkill;
      CombatEngine.clog(`${target.name}'s ${oldSkillName} becomes ${newSkillName}!`, 'cl-effect');
    }
    return true;
  }
};

// ------------------------------------------------------------
// QTE (Quick Time Event) - unchanged
// ------------------------------------------------------------
const Qte = {
  active: false,
  timer: null,
  resolve: null,
  
  trigger(qteData) {
    return new Promise(resolve => {
      this.active = true;
      this.resolve = resolve;
      
      const overlay = document.getElementById('qteOverlay');
      const promptEl = document.getElementById('qtePrompt');
      const btn = document.getElementById('qteBtn');
      const timerFill = document.getElementById('qteTimerFill');
      
      promptEl.textContent = qteData.prompt || 'React now!';
      btn.textContent = qteData.action || 'ACT';
      
      const ms = (qteData.timeLimit || 4) * 1000;
      timerFill.style.transition = 'none';
      timerFill.style.width = '100%';
      overlay.classList.add('open');
      Ui.setInputLocked(true);
      
      requestAnimationFrame(() => requestAnimationFrame(() => {
        timerFill.style.transition = `width ${ms}ms linear`;
        timerFill.style.width = '0%';
      }));
      
      this.timer = setTimeout(() => this.finish(false), ms);
      btn.onclick = () => this.finish(true);
    });
  },
  
  finish(success) {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    document.getElementById('qteOverlay').classList.remove('open');
    document.getElementById('qteBtn').onclick = null;
    this.resolve?.(success);
    this.resolve = null;
  }
};

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && Qte.active) {
    e.preventDefault();
    Qte.finish(true);
  }
});