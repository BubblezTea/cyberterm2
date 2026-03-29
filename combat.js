let activeCombat = null;

const CombatEngine = {
  _narrationBusy: false,

  // calls the model for flavor only — never touches State.history
  async _narrate(mechMsg, aiCtx, cls) {
    if (!COMBAT_NARRATION_ENABLED || this._narrationBusy) {
      this.clog(mechMsg, cls);
      return;
    }
    this._narrationBusy = true;
    try {
      const c = activeCombat;
      const prompt = `Cyberpunk RPG combat narrator. Event: ${aiCtx}
Current combatants:
- Player: ${State.hp}/${State.maxHp} HP
- ${c.combatants.map(cb => `${cb.name}: ${Math.max(0,cb.hp)}/${cb.maxHp} HP (${cb.team})`).join(', ')}
Round ${c.round}.
One terse, visceral sentence. No numbers, no mechanics. Reply only: {"narration":"..."}`;
      const raw  = await callProvider([{ role:'user', content: prompt }], 100);
      const hit  = raw.match(/"narration"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      this.clog(hit ? hit[1] : mechMsg, cls);
    } catch(e) {
      this.clog(mechMsg, cls);
    } finally {
      this._narrationBusy = false;
    }
  },

  // ── deterministic mechanics ───────────────────────────────────────────────

  _rollPlayerSkill(skill, targetIndex) {
    const c = activeCombat;
    const target = c.combatants[targetIndex];
    if (!target) return { dmg: 0, isCrit: false, statusApplied: false };
    
    const base      = skill.damage[0] + Math.floor(Math.random() * (skill.damage[1] - skill.damage[0] + 1));
    const statMod   = skill.statScaling ? Math.floor(State.stats[skill.statScaling] * 0.4) : 0;
    const isCrit    = Math.random() * 100 < State.stats.agi * 1.5;
    const expose    = target.statusEffects.find(s => s.type === 'expose') ? 1.5 : 1;
    const dmg       = Math.max(1, Math.floor((base + statMod) * (isCrit ? 1.5 : 1) * expose));

    let statusApplied = false;
    if (skill.statusEffect) {
      const roll   = Math.floor(Math.random() * 20) + 1;
      const targetStat = 10 + Math.floor((skill.statScaling ? State.stats[skill.statScaling] : State.stats.cha) * 0.5);
      if (roll >= targetStat) {
        const ex = target.statusEffects.find(s => s.name === skill.statusEffect.name);
        if (ex) ex.duration = skill.statusEffect.duration;
        else    target.statusEffects.push({ ...skill.statusEffect });
        statusApplied = true;
      }
    }
    return { dmg, isCrit, statusApplied, targetIndex };
  },

  _rollEnemyAction(combatant) {
    const c = activeCombat;
    let available = combatant.skills.filter(s => (s.currentCooldown || 0) === 0);
    
    // If no skills available, add a default punch
    if (available.length === 0 && combatant.skills.length === 0) {
      combatant.skills.push({
        name: 'Punch',
        damage: [5, 12],
        energyCost: 5,
        cooldown: 0,
        currentCooldown: 0,
        statusEffect: null
      });
      available = combatant.skills;
    }
    
    const skill = available.length ? available[Math.floor(Math.random() * available.length)] : null;
    if (!skill) return { skill: null, dmg: 0, dodged: false };
    
    // Select a random target (player or other NPCs not on same team)
    const validTargets = c.combatants.filter(cb => cb.team !== combatant.team && cb.hp > 0);
    if (validTargets.length === 0) return { skill: null, dmg: 0, dodged: false };
    
    const target = validTargets[Math.floor(Math.random() * validTargets.length)];
    
    // Dodge calculation based on target's AGI
    const slowDebuff = target.statusEffects.find(s => s.type === 'debuff_agi');
    const effectiveAgi = (target === c.playerObj ? State.stats.agi : target.agi) - (slowDebuff ? slowDebuff.value : 0);
    const dodgeChance = Math.max(0, effectiveAgi * 3);
    const dodged = Math.random() * 100 < dodgeChance;
    
    // If dodged, return immediately with no damage
    if (dodged) {
      return { skill, dmg: 0, dodged: true, target };
    }
    
    // Only calculate damage if not dodged
    const rawDmg = (skill.damage?.[0] || 5) + Math.floor(Math.random() * ((skill.damage?.[1] || 12) - (skill.damage?.[0] || 5) + 1));
    const shield = target.statusEffects.find(s => s.type === 'buff_shield');
    let finalDmg = rawDmg;
    if (shield) {
      const absorbed = Math.min(shield.value, rawDmg);
      finalDmg -= absorbed;
      shield.value -= absorbed;
      if (shield.value <= 0) {
        const idx = target.statusEffects.indexOf(shield);
        if (idx !== -1) target.statusEffects.splice(idx, 1);
      }
    }
    return { skill, dmg: Math.max(0, finalDmg), dodged: false, target };
  },

  // ── ui helpers ────────────────────────────────────────────────────────────

  start(combatData) {
    // Create combatants array
    const combatants = [];
    
    // Add player as combatant
    const playerCombatant = {
      id: 'player',
      name: State.playerName || 'You',
      team: 'player',
      hp: State.hp,
      maxHp: State.maxHp,
      agi: State.stats.agi,
      statusEffects: [],
      skills: [], // Player skills handled separately
      isPlayer: true
    };
    combatants.push(playerCombatant);
    
    // Add enemies from combatData
    const enemies = Array.isArray(combatData.enemies) ? combatData.enemies : [combatData.enemy];
    enemies.forEach((enemy, idx) => {
      // Ensure enemy has at least one skill
      let enemySkills = enemy.skills || [];
      if (enemySkills.length === 0) {
        // Add a default attack skill
        enemySkills = [{
          name: 'Punch',
          damage: [5, 12],
          energyCost: 5,
          cooldown: 0,
          currentCooldown: 0,
          statusEffect: null
        }];
        console.log(`[COMBAT] Added default skill to ${enemy.name}`);
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
        agi: enemy.agi || 5,
        isPlayer: false
      });
    });
    
    // Add allies if provided
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
          agi: ally.agi || 5,
          isPlayer: false
        });
      });
    }
    
    activeCombat = {
      combatants: combatants,
      playerObj: playerCombatant,
      round: 1,
      cooldowns: {},
      locked: false,
      turnOrder: [],
      currentTurnIndex: 0,
      combatLog: [],
      dialogueEnabled: true,
      defeatedEnemies: []
    };

    
    
    // Calculate turn order based on AGI
    this._calculateTurnOrder();
    
    State.energy = Math.min(State.energy + 20, State.maxEnergy);
    document.getElementById('combatLog').innerHTML = '';
    this.clog(`⚔ Combat begins!`, 'cl-system');
    this.clog(`Combatants: ${combatants.map(c => `${c.name} (${c.team})`).join(', ')}`, 'cl-system');
    this.refresh();
    document.getElementById('combatOverlay').classList.add('open');
    document.getElementById('combatChatInput').focus();
    Ui.setInputLocked(true);
  },
  
  _calculateTurnOrder() {
    const c = activeCombat;
    const alive = c.combatants.filter(cb => cb.hp > 0);
    c.turnOrder = alive.sort((a, b) => {
      const aAgi = a.isPlayer ? State.stats.agi : a.agi;
      const bAgi = b.isPlayer ? State.stats.agi : b.agi;
      return bAgi - aAgi;
    });
    c.currentTurnIndex = 0;
  },

  clog(text, cls = 'cl-system') {
    const log = document.getElementById('combatLog');
    const el  = document.createElement('div');
    el.className   = 'cl-entry ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop  = 999999;
    if (activeCombat) activeCombat.combatLog.push({ text, cls, timestamp: Date.now() });
  },

  refresh() {
    if (!activeCombat) return;
    const c = activeCombat;
    
    // Update enemy display (show all enemies)
    const enemyContainer = document.getElementById('ceEnemyContainer');
    if (enemyContainer) {
      const enemies = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
      if (enemies.length > 0) {
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
          </div>
        `).join('');
        
        // Render statuses for each enemy
        enemies.forEach(enemy => {
          const statusEl = document.getElementById(`ceStatuses_${enemy.id}`);
          if (statusEl) {
            statusEl.innerHTML = this._renderStatuses(enemy.statusEffects);
          }
        });
      } else {
        enemyContainer.innerHTML = '<div class="panel-empty">All enemies defeated!</div>';
      }
    }
    
    // Update allies display
    const allyContainer = document.getElementById('ceAllyContainer');
    if (allyContainer) {
      const allies = c.combatants.filter(cb => cb.team === 'ally' && cb.hp > 0);
      if (allies.length > 0) {
        allyContainer.innerHTML = allies.map(ally => `
          <div class="ce-ally-card" data-id="${ally.id}">
            <div class="ce-header">
              <span class="ce-name">${ally.name}</span>
            </div>
            <div class="ce-hp-row">
              <div class="ce-hp-bar"><div class="ce-hp-fill ally-fill" style="width:${Math.max(0, ally.hp/ally.maxHp*100)}%"></div></div>
              <span class="ce-hp-text">${Math.max(0, ally.hp)}/${ally.maxHp}</span>
            </div>
            <div class="ce-statuses" id="ceStatuses_${ally.id}"></div>
          </div>
        `).join('');
        
        allies.forEach(ally => {
          const statusEl = document.getElementById(`ceStatuses_${ally.id}`);
          if (statusEl) {
            statusEl.innerHTML = this._renderStatuses(ally.statusEffects);
          }
        });
      }
    }
    
    // Update current turn display
    const currentTurn = c.turnOrder[c.currentTurnIndex];
    const turnLabel = document.getElementById('ceTurnLabel');
    if (turnLabel) {
      if (currentTurn?.isPlayer) {
        turnLabel.textContent = 'YOUR TURN';
        turnLabel.style.color = 'var(--green)';
      } else if (currentTurn) {
        turnLabel.textContent = `${currentTurn.name.toUpperCase()}'S TURN`;
        turnLabel.style.color = '#ff6b7a';
      }
    }
    
    document.getElementById('ceRound').textContent = c.round;
    this._renderPlayerStatuses();
    this.buildSkillGrid();
    
    // Update player HP/Energy display
    document.getElementById('cpHpFill').style.width = `${State.hp/State.maxHp*100}%`;
    document.getElementById('cpHpText').textContent = `${State.hp}/${State.maxHp}`;
    document.getElementById('cpEnFill').style.width = `${State.energy/State.maxEnergy*100}%`;
    document.getElementById('cpEnText').textContent = `${State.energy}/${State.maxEnergy}`;
    Ui.updateHeader();
  },
  
  _renderStatuses(statuses) {
    if (!statuses || statuses.length === 0) return '';
    return statuses.map(sf => {
      const cls = { dot:'sc-dot', skip:'sc-skip', expose:'sc-expose', buff_shield:'sc-buff', buff_hp:'sc-buff' }[sf.type] || 'sc-debuff';
      const desc = sf.description || (
        sf.type === 'dot' ? `Deals ${sf.value||5} damage each turn` :
        sf.type === 'skip' ? 'Skips next turn' :
        sf.type === 'expose' ? 'Takes 50% more damage' :
        sf.type === 'buff_shield' ? `Absorbs ${sf.value} damage` :
        sf.type === 'buff_hp' ? `Heals ${sf.value} HP` :
        sf.type === 'debuff_agi' ? `AGI -${sf.value}` :
        `${sf.name} (${sf.duration}T)`
      );
      return `<span class="status-chip ${cls}" title="${desc}">${sf.name} ${sf.duration}T</span>`;
    }).join('');
  },
  
  _renderPlayerStatuses() {
    const container = document.getElementById('cpStatuses');
    if (!container) return;
    const player = activeCombat.combatants.find(c => c.id === 'player');
    if (player && player.statusEffects) {
      container.innerHTML = this._renderStatuses(player.statusEffects);
    } else {
      container.innerHTML = '';
    }
  },

  buildSkillGrid() {
    const grid = document.getElementById('combatSkillGrid');
    if (!grid) return;
    const c = activeCombat;
    const currentTurn = c.turnOrder[c.currentTurnIndex];
    
    // Only show skills if it's player's turn and player is alive
    const isPlayerTurn = currentTurn?.isPlayer === true;
    const stunned = c.playerObj?.statusEffects?.some(s => s.type === 'skip');
    const canAct = isPlayerTurn && !c.locked && !stunned && State.hp > 0;
    
    const buttons = [];
    
    // Get valid targets for skills
    const validTargets = c.combatants.filter(cb => cb.team !== 'player' && cb.hp > 0);
    
    State.skills.forEach(sk => {
      const cd = c.cooldowns[sk.name] || 0;
      const canUse = cd === 0 && State.energy >= sk.energyCost && canAct;
      const dmgStr = sk.damage ? `${sk.damage[0]}-${sk.damage[1]}` : '—';
      buttons.push(`<button class="cb-skill-btn" data-skill="${sk.name}" ${!canUse ? 'disabled' : ''}>
        ${cd > 0 ? `<span class="csb-cd">${cd}T</span>` : ''}
        <span class="csb-name">${sk.name}</span>
        <span class="csb-meta">${sk.energyCost}en · ${dmgStr}dmg</span>
      </button>`);
    });
    
    // Add target selection for skills that need it
    if (validTargets.length > 1 && canAct) {
      buttons.push(`<select id="combatTargetSelect" class="combat-target-select">
        ${validTargets.map(t => `<option value="${t.id}">Target: ${t.name}</option>`).join('')}
      </select>`);
    }
    
    const consumable = State.inventory.find(i =>
      /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0
    );
    
    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__wait" ${!canAct ? 'disabled' : ''}>
      <span class="csb-name">WAIT</span>
      <span class="csb-meta">+25 energy</span>
    </button>`);
    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__item" ${(!consumable || !canAct) ? 'disabled' : ''}>
      <span class="csb-name">USE ITEM</span>
      <span class="csb-meta">${consumable ? consumable.name : 'none'}</span>
    </button>`);
    buttons.push(`<button class="cb-skill-btn csb-flee" data-skill="__flee" ${!canAct ? 'disabled' : ''}>
      <span class="csb-name">FLEE</span>
      <span class="csb-meta">AGI check</span>
    </button>`);
    
    grid.innerHTML = buttons.join('');
    
    grid.querySelectorAll('.cb-skill-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetSelect = document.getElementById('combatTargetSelect');
        const targetId = targetSelect ? targetSelect.value : validTargets[0]?.id;
        this.playerAction(btn.dataset.skill, targetId);
      });
    });
  },
  
  // Add combat chat handler
  async sendCombatChat(message) {
    if (!activeCombat || activeCombat.locked) return;
    
    const c = activeCombat;
    const currentTurn = c.turnOrder[c.currentTurnIndex];
    
    // Add chat message to log
    this.clog(`[YOU] ${message}`, 'cl-player');
    
    // Determine who responds based on current turn or random enemy
    const responders = c.combatants.filter(cb => cb.team !== 'player' && cb.hp > 0);
    if (responders.length === 0) return;
    
    const responder = responders[Math.floor(Math.random() * responders.length)];
    
    // AI decides response based on CHA and relationship
    const prompt = `Combat dialogue. Player says: "${message}" to ${responder.name}.
Current situation:
- Player HP: ${State.hp}/${State.maxHp}
- ${responder.name} HP: ${responder.hp}/${responder.maxHp}
- Player CHA: ${State.stats.cha}/10
- ${responder.name}'s current status: ${responder.hp > responder.maxHp * 0.5 ? 'healthy' : 'wounded'}
- Round: ${c.round}

Generate a short, in-character response from ${responder.name}. They can:
- Attack the player (if hostile or provoked)
- Try to persuade/negotiate (if neutral or willing)
- Plead for mercy (if wounded)
- Switch sides (rare, only if very wounded or if player's CHA is high)
- Call reinforcements (if losing)

Reply with JSON: {"response":"their spoken words","action":"attack|negotiate|switch|plead|reinforce","attackTarget":"player|ally|enemy","switchToTeam":"ally|enemy"}`;
    
    try {
      const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 300));
      const clean = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
      const result = JSON.parse(clean);
      
      this.clog(`[${responder.name}] ${result.response}`, 'cl-enemy');
      
      // Handle the action
      switch(result.action) {
        case 'attack':
          const target = result.attackTarget === 'player' ? c.playerObj : 
                        c.combatants.find(cb => cb.name.toLowerCase().includes(result.attackTarget));
          if (target && target.hp > 0) {
            await this._enemyAttack(responder, target);
          }
          break;
        case 'switch':
          if (result.switchToTeam) {
            const oldTeam = responder.team;
            responder.team = result.switchToTeam;
            this.clog(`⚔ ${responder.name} switches sides! Now fighting for the ${result.switchToTeam} team!`, 'cl-system');
            // Recalculate turn order
            this._calculateTurnOrder();
          }
          break;
        case 'plead':
          this.clog(`⚠ ${responder.name} is pleading for mercy...`, 'cl-system');
          // Could trigger a choice for player
          break;
        case 'reinforce':
          this.clog(`⚠ ${responder.name} calls for reinforcements!`, 'cl-system');
          // Add a new enemy next round
          this._addReinforcement(responder);
          break;
        case 'negotiate':
          // Just dialogue, no action this turn
          break;
      }
      
      this.refresh();
      
      // Check if combat should end
      const enemiesRemaining = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
      const alliesRemaining = c.combatants.filter(cb => cb.team === 'ally' && cb.hp > 0);
      
      if (enemiesRemaining.length === 0) {
        this.endCombat('win');
      } else if (State.hp <= 0) {
        this.endCombat('death');
      } else {
        // Continue to next turn
        this._nextTurn();
      }
      
    } catch(e) {
      console.error('Combat chat error:', e);
      this.clog(`[${responder.name}] *ignores you*`, 'cl-enemy');
      this._nextTurn();
    }
  },
  
  async _enemyAttack(attacker, target) {
    const { skill, dmg, dodged } = this._rollEnemyAction(attacker);
    
    if (dodged) {
      this.clog(`⚔ ${attacker.name} attacks ${target.name} — DODGED!`, 'cl-miss');
      return;
    }
    
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      this.clog(`⚔ ${attacker.name} hits ${target.name} for ${dmg} damage!`, 'cl-enemy');
      
      if (target.id === 'player') {
        State.hp = target.hp;
        if (State.hp <= 0) {
          this.endCombat('death');
          return;
        }
      }
    }
  },
  
  _addReinforcement(attacker) {
    const c = activeCombat;
    const newEnemy = {
      id: `reinforce_${Date.now()}`,
      name: `${attacker.name}'s Backup`,
      team: 'enemy',
      hp: 30,
      maxHp: 30,
      level: Math.max(1, (attacker.level || 1) - 1),
      description: 'A reinforcement that was called in',
      skills: [{ name: 'Punch', damage: [5, 10], energyCost: 5, cooldown: 0, currentCooldown: 0 }],
      statusEffects: [],
      agi: 5,
      isPlayer: false
    };
    c.combatants.push(newEnemy);
    this._calculateTurnOrder();
  },
  
  async playerAction(skillName, targetId) {
    if (!activeCombat || activeCombat.locked) return;
    const c = activeCombat;
    const currentTurn = c.turnOrder[c.currentTurnIndex];
    
    if (!currentTurn?.isPlayer) {
      this.clog('Not your turn!', 'cl-system');
      return;
    }
    
    activeCombat.locked = true;
    
    // Check if stunned
    const stunIdx = c.playerObj.statusEffects.findIndex(s => s.type === 'skip');
    if (stunIdx !== -1) {
      c.playerObj.statusEffects[stunIdx].duration--;
      if (c.playerObj.statusEffects[stunIdx].duration <= 0)
        c.playerObj.statusEffects.splice(stunIdx, 1);
      await this._narrate(
        '▶ STUNNED — you cannot act this turn',
        `Player is stunned and loses their turn.`,
        'cl-system'
      );
      this._nextTurn();
      return;
    }
    
    if (skillName === '__wait') {
      State.energy = Math.min(State.maxEnergy, State.energy + 25);
      await this._narrate(
        `▶ WAIT — +25 EN (${State.energy}/${State.maxEnergy})`,
        `Player waits and recovers energy.`,
        'cl-player'
      );
      this._nextTurn();
      return;
    }
    
    if (skillName === '__flee') {
      const roll = Math.floor(Math.random() * 20) + 1;
      const thr = 8 - Math.floor(State.stats.agi / 2);
      const success = roll >= thr;
      
      const fleeResult = {
        roll: roll,
        threshold: thr,
        success: success,
        agi: State.stats.agi
      };
      
      if (success) {
        await this._narrate(
          `▶ FLEE — success (roll ${roll})`,
          `Player successfully flees the fight.`,
          'cl-system'
        );
        setTimeout(() => this.endCombat('flee', fleeResult), 800);
      } else {
        await this._narrate(
          `▶ FLEE — failed (roll ${roll}, needed ${thr}+)`,
          `Player tries to flee but fails.`,
          'cl-miss'
        );
        this._nextTurn();
      }
      return;
    }
    
    if (skillName === '__item') {
      const consumable = State.inventory.find(i =>
        /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0
      );
      if (consumable) {
        const healAmt = 20 + State.stats.tec * 2;
        State.hp = Math.min(State.maxHp, State.hp + healAmt);
        c.playerObj.hp = State.hp;
        if (window.Sound) Sound.itemUse();
        consumable.amount--;
        if (consumable.amount <= 0) State.inventory.splice(State.inventory.indexOf(consumable), 1);
        await this._narrate(
          `▶ ${consumable.name} — +${healAmt} HP (${State.hp}/${State.maxHp})`,
          `Player uses a ${consumable.name} and heals ${healAmt} HP.`,
          'cl-player'
        );
        this._nextTurn();
      }
      return;
    }
    
    const skill = State.skills.find(s => s.name === skillName);
    if (!skill) { activeCombat.locked = false; return; }
    if (State.energy < skill.energyCost) { activeCombat.locked = false; return; }
    
    State.energy -= skill.energyCost;
    c.cooldowns[skill.name] = skill.cooldown || 0;
    
    // Find target
    let targetIndex = -1;
    if (targetId) {
      targetIndex = c.combatants.findIndex(cb => cb.id === targetId);
    } else {
      const enemies = c.combatants.filter(cb => cb.team !== 'player' && cb.hp > 0);
      if (enemies.length > 0) {
        targetIndex = c.combatants.findIndex(cb => cb.id === enemies[0].id);
      }
    }
    
    if (skill.damage && targetIndex !== -1) {
      const { dmg, isCrit, statusApplied } = this._rollPlayerSkill(skill, targetIndex);
      const target = c.combatants[targetIndex];
      target.hp -= dmg;
      
      if (window.Sound) Sound.combatHit(true);
      
      let mechMsg = `▶ ${skill.name} on ${target.name} — ${dmg} dmg${isCrit ? ' [CRIT]' : ''}`;
      let aiCtx = `Player uses ${skill.name} on ${target.name}, dealing ${dmg} damage${isCrit ? ' with a critical hit' : ''}`;
      
      if (skill.statusEffect && statusApplied) {
        mechMsg += ` [${skill.statusEffect.name} applied]`;
        aiCtx += `, inflicting ${skill.statusEffect.name}`;
      }
      
      await this._narrate(mechMsg, aiCtx + '.', isCrit ? 'cl-crit' : 'cl-player');
      
      if (target.hp <= 0) {
        this.clog(`⚔ ${target.name} has been defeated!`, 'cl-system');
        activeCombat.defeatedEnemies.push({ name: target.name, id: target.id });
        const defeatedIndex = c.combatants.findIndex(cb => cb.id === target.id);
        if (defeatedIndex !== -1) c.combatants.splice(defeatedIndex, 1);
      }
    }
    
    this.refresh();
    
    // Check if all enemies defeated
    const enemiesRemaining = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
    if (enemiesRemaining.length === 0) {
      setTimeout(() => this.endCombat('win'), 600);
      return;
    }
    
    this._nextTurn();
  },
  
  async _nextTurn() {
    if (!activeCombat) return;
    const c = activeCombat;
    
    // Move to next combatant
    c.currentTurnIndex++;
    if (c.currentTurnIndex >= c.turnOrder.length) {
      // End of round, start new round
      c.currentTurnIndex = 0;
      c.round++;
      this._processEndOfRound();
      this._calculateTurnOrder();
    }
    
    const currentTurn = c.turnOrder[c.currentTurnIndex];
    
    // Update turn label
    const turnLabel = document.getElementById('ceTurnLabel');
    if (turnLabel) {
      if (currentTurn?.isPlayer) {
        turnLabel.textContent = 'YOUR TURN';
        turnLabel.style.color = 'var(--green)';
        activeCombat.locked = false;
        this.refresh();
      } else if (currentTurn) {
        turnLabel.textContent = `${currentTurn.name.toUpperCase()}'S TURN`;
        turnLabel.style.color = '#ff6b7a';
        // Process non-player turn immediately
        if (currentTurn.hp > 0) {
          setTimeout(() => this._processNonPlayerTurn(currentTurn), 500);
        } else {
          // Skip dead combatants and go to next turn
          this._nextTurn();
        }
      }
    }
  },
  
  async _processNonPlayerTurn(combatant) {
    console.log(`[COMBAT] Processing ${combatant.name}'s turn`);
    if (!activeCombat) return;
    const c = activeCombat;
    
    // Check if combatant is stunned
    const stunIdx = combatant.statusEffects.findIndex(s => s.type === 'skip');
    if (stunIdx !== -1) {
      combatant.statusEffects[stunIdx].duration--;
      if (combatant.statusEffects[stunIdx].duration <= 0)
        combatant.statusEffects.splice(stunIdx, 1);
      this.clog(`${combatant.name} is stunned and cannot act!`, 'cl-status');
      this._nextTurn();
      return;
    }
    
    // Enemy/ally action
    const { skill, dmg, dodged, target } = this._rollEnemyAction(combatant);
    
    console.log(`[COMBAT] ${combatant.name} action:`, { skill: skill?.name, dmg, dodged, target: target?.name });
    
    if (!skill) {
      this.clog(`${combatant.name} holds their position.`, 'cl-system');
      this._nextTurn();
      return;
    }
    
    if (dodged) {
      this.clog(`${combatant.name}'s ${skill.name} — DODGED!`, 'cl-miss');
      this._nextTurn();
      return;
    }
    
    // Hit - apply damage
    if (dmg > 0 && target) {
      target.hp = Math.max(0, target.hp - dmg);
      if (window.Sound) Sound.combatHit(false);
      
      if (target.id === 'player') {
        State.hp = target.hp;
        this.clog(`${combatant.name}'s ${skill.name} — ${dmg} dmg to you (${State.hp}/${State.maxHp} HP)`, 'cl-enemy');
        
        if (State.hp <= 0) {
          this.endCombat('death');
          return;
        }
      } else {
        this.clog(`${combatant.name}'s ${skill.name} — ${dmg} dmg to ${target.name} (${target.hp}/${target.maxHp} HP)`, 'cl-enemy');
      }
      
      if (skill.statusEffect) {
        const ex = target.statusEffects.find(s => s.name === skill.statusEffect.name);
        if (ex) ex.duration = skill.statusEffect.duration;
        else target.statusEffects.push({ ...skill.statusEffect });
        this.clog(`  ✦ ${skill.statusEffect.name} inflicted on ${target.name}`, 'cl-status');
      }
      if (target.hp <= 0 && target.team === 'enemy') {
        this.clog(`${target.name} has been defeated!`, 'cl-system');
        activeCombat.defeatedEnemies.push({ name: target.name, id: target.id });
        const defeatedIndex = c.combatants.findIndex(cb => cb.id === target.id);
        if (defeatedIndex !== -1) c.combatants.splice(defeatedIndex, 1);
      }
    }
    
    this.refresh();
    
    // Check for defeat
    const enemiesRemaining = c.combatants.filter(cb => cb.team === 'enemy' && cb.hp > 0);
    if (enemiesRemaining.length === 0) {
      this.endCombat('win');
      return;
    }
    
    if (State.hp <= 0) {
      this.endCombat('death');
      return;
    }
    
    // Move to next turn
    this._nextTurn();
  },
  
  _processEndOfRound() {
    const c = activeCombat;
    
    // Process status effects for all combatants
    c.combatants.forEach(combatant => {
      for (let i = combatant.statusEffects.length - 1; i >= 0; i--) {
        const sf = combatant.statusEffects[i];
          if (sf.type === 'dot') {
            const dmg = sf.value || 5;
            combatant.hp = Math.max(0, combatant.hp - dmg);
            this.clog(`  ${sf.name}: ${combatant.name} -${dmg} HP`, 'cl-status');
            
            if (combatant.id === 'player') State.hp = combatant.hp;
            
            // If enemy dies from DoT, track it
            if (combatant.hp <= 0 && combatant.team === 'enemy') {
              // Avoid duplicate entries
              if (!activeCombat.defeatedEnemies.some(e => e.id === combatant.id)) {
                activeCombat.defeatedEnemies.push({ name: combatant.name, id: combatant.id });
              }
              this.clog(`${combatant.name} has been defeated!`, 'cl-system');
              // Do NOT splice here – we are iterating over combatants.
              // The combatant will be removed when turn order recalculates.
            }
          }
        if (sf.type === 'buff_hp' && combatant.id === 'player') {
          State.hp = Math.min(State.maxHp, State.hp + sf.value);
          combatant.hp = State.hp;
          this.clog(`  ${sf.name}: +${sf.value} HP`, 'cl-status');
        }
        sf.duration--;
        if (sf.duration <= 0) {
          this.clog(`  ${sf.name} fades from ${combatant.name}.`, 'cl-system');
          combatant.statusEffects.splice(i, 1);
        }
      }
    });
    
    // Update player object
    c.playerObj.hp = State.hp;
    
    // Reduce cooldowns
    Object.keys(c.cooldowns).forEach(key => {
      if (c.cooldowns[key] > 0) c.cooldowns[key]--;
    });
    
    c.combatants.forEach(cb => {
      if (cb.skills) {
        cb.skills.forEach(sk => {
          if (sk.currentCooldown > 0) sk.currentCooldown--;
        });
      }
    });
    
    // Regenerate energy for player
    State.energy = Math.min(State.maxEnergy, State.energy + 5 + Math.floor(State.stats.int / 2));
  },

    endCombat(outcome, fleeResult) {
    const c = activeCombat;
    if (!c) return;
    document.getElementById('combatOverlay').classList.remove('open');
    
    const defeatedCount = c.defeatedEnemies.length;
    const defeatedNames = c.defeatedEnemies.map(e => e.name).join(', ');
    const alliesSurvived = c.combatants.filter(cb => cb.team === 'ally' && cb.hp > 0);
    
    if (outcome === 'win') {
      // Use c.defeatedEnemies – not enemiesDefeated
      if (defeatedNames) addKeyFact(`Defeated ${defeatedNames} in combat`);
      const baseXp = defeatedCount * 25 + Math.floor(Math.random() * 20);
      Ui.addInstant(`[ COMBAT VICTORY: ${defeatedCount} enemies defeated in ${c.round} rounds ]`, 'system');
      
      // Mark defeated enemies as dead in NPC log using c.defeatedEnemies
      c.defeatedEnemies.forEach(enemy => {
        const deadNpc = State.npcs.find(n => n.name.toLowerCase() === enemy.name.toLowerCase());
        if (deadNpc) {
          deadNpc.relationship = 'Dead';
        } else {
          State.npcs.push({ name: enemy.name, relationship: 'Dead', description: `Defeated in combat on Day ${State.gameDay}.` });
        }
      });
      
      // Update ally relationships if they survived
      alliesSurvived.forEach(ally => {
        const allyNpc = State.npcs.find(n => n.name.toLowerCase() === ally.name.toLowerCase());
        if (allyNpc && allyNpc.relationship !== 'Ally') {
          allyNpc.relationship = 'Ally';
          Ui.addInstant(`[ ${ally.name} now trusts you after fighting alongside you! ]`, 'system');
        }
      });
      
      Ui.renderSidebar();
      Llm.send(`[COMBAT WON] Defeated ${defeatedCount} enemies in ${c.round} rounds. Player HP: ${State.hp}/${State.maxHp}. Allies present: ${alliesSurvived.map(a => a.name).join(', ') || 'none'}. Narrate aftermath and grant ${baseXp} XP.`)
        .then(resp => {
          Engine.applyResponse(resp);
          if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
          const tickerEl = buildTicker(resp, State.hp, State.credits, State.npcs);
          if (tickerEl) {
            document.getElementById('narrativeLog').appendChild(tickerEl);
            document.getElementById('narrativeLog').scrollTop = 999999;
          }
          StatSystem.gainXp(baseXp);
          const wq = () => { if (Ui.isTyping||Ui.typeQueue.length) setTimeout(wq,200); else { Ui.setInputLocked(false); Ui.updateHeader(); Ui.renderSidebar(); } };
          wq();
        });
        
    } else if (outcome === 'death') {
      return;    
    } else {
      // FLEE outcome
      Ui.addInstant(`[ You fled from combat ]`, 'system');
      
      let fleeContext = '';
      if (fleeResult) {
        fleeContext = `\nFlee roll: ${fleeResult.roll}/${fleeResult.threshold} needed. AGI: ${fleeResult.agi}.
    - Success (roll >= threshold): Clean escape, no consequences
    - Failure (roll < threshold): Escape but with consequences (lost credits, dropped items, etc.)
    The roll was ${fleeResult.success ? 'SUCCESS' : 'FAILURE'}. Adjust consequences accordingly.`;
      }
      
      Llm.send(`[COMBAT FLED] Player fled after ${c.round} rounds.${fleeContext} Narrate the escape.`)
        .then(resp => {
          Engine.applyResponse(resp);
          if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
          const tickerEl = buildTicker(resp, State.hp, State.credits, State.npcs);
          if (tickerEl) {
            document.getElementById('narrativeLog').appendChild(tickerEl);
            document.getElementById('narrativeLog').scrollTop = 999999;
          }
          const wq = () => { if (Ui.isTyping||Ui.typeQueue.length) setTimeout(wq,200); else { Ui.setInputLocked(false); Ui.updateHeader(); Ui.renderSidebar(); } };
          wq();
        });
    }
    
    activeCombat = null;
  },
};

const Qte = {
  active:  false,
  timer:   null,
  resolve: null,

  trigger(qteData) {
    return new Promise(resolve => {
      this.active  = true;
      this.resolve = resolve;

      const overlay   = document.getElementById('qteOverlay');
      const promptEl  = document.getElementById('qtePrompt');
      const btn       = document.getElementById('qteBtn');
      const timerFill = document.getElementById('qteTimerFill');

      promptEl.textContent = qteData.prompt || 'React now!';
      btn.textContent      = qteData.action || 'ACT';

      const ms = (qteData.timeLimit || 4) * 1000;
      timerFill.style.transition = 'none';
      timerFill.style.width      = '100%';
      overlay.classList.add('open');
      Ui.setInputLocked(true);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        timerFill.style.transition = `width ${ms}ms linear`;
        timerFill.style.width      = '0%';
      }));

      this.timer  = setTimeout(() => this.finish(false), ms);
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
  },
};

document.addEventListener('keydown', e => {
  if (e.code === 'Space' && Qte.active) {
    e.preventDefault();
    Qte.finish(true);
  }
});
