let activeCombat = null;

const CombatEngine = {
  _narrationBusy: false,

  // Helper to send combat actions to the AI
  async _callCombatAI(actionType, actionData) {
    const c = activeCombat;

    const prompt = `You are the AI controlling combat in a gritty cyberpunk RPG.

Current combat state:
- Player: ${State.playerName} (LV ${State.level})
  HP: ${State.hp}/${State.maxHp}
  Energy: ${State.energy}/${State.maxEnergy}
  Stats: STR ${State.stats.str} AGI ${State.stats.agi} INT ${State.stats.int} CHA ${State.stats.cha} TEC ${State.stats.tec} END ${State.stats.end}
  Statuses: ${JSON.stringify(c.playerStatusEffects)}
  Skills: ${State.skills.map(s => `${s.name} (${s.energyCost}en, cd ${s.cooldown})`).join(', ')}

- Enemy: ${c.enemy.name} (LV ${c.enemy.level})
  HP: ${c.enemy.hp}/${c.enemy.maxHp}
  Statuses: ${JSON.stringify(c.enemy.statusEffects)}
  Skills: ${c.enemy.skills.map(s => `${s.name} (dmg ${s.damage ? s.damage.join('-') : 'none'})`).join(', ')}

Round: ${c.round}
Action: ${actionType}
${actionData}

You must respond with a JSON object that describes the outcome. Use this schema:
{
  "narration": "string — one gritty sentence",
  "damage": number (positive damage dealt to target),
  "selfDamage": number (optional, damage to self, e.g., recoil),
  "heal": number (optional, healing to self),
  "energyChange": number (optional, net change to energy),
  "statusEffect": null | {
    "name": "string",
    "description": "string",
    "type": "dot|skip|expose|debuff_agi|buff_shield|buff_hp",
    "duration": number,
    "value": number
  },
  "target": "player|enemy"
}

Rules:
- The acting character must have enough energy to perform the action. If not, the action fails (set "damage": 0, "narration" describing the failure).
- For enemy actions, choose a skill from enemy.skills. For player actions, use the provided skill data.
- Damage must be consistent with the skill's damage range and stat bonuses (use player stats for player actions, enemy stats for enemy actions). Crit chance ~15% if AGI high.
- Status effects should succeed only if a d20 roll beats a target of 10 + stat modifier. You may simulate this or simply decide.
- If the enemy is stunned (type 'skip'), they cannot act; respond with narration indicating they are stunned.
- If fleeing, determine success based on AGI check (d20 + AGI bonus vs DC 12). If successful, set "fled": true.
- For item use, calculate healing (20 + TEC*2) and reduce item count. The item is already removed from inventory before this call.
- Energy changes: for player skills, deduct the skill's energyCost unless specified otherwise. For WAIT, add +25 energy.
- Return ONLY valid JSON. No markdown, no extra text.`;

    try {
      const resp = await Llm.send(prompt, 'combat_action', 1000);
      return resp;
    } catch (e) {
      console.error('AI combat action failed:', e);
      // Fallback: a harmless action
      return { narration: 'The combatants hesitate...', damage: 0 };
    }
  },

  async narrateAction(promptText, context) {
    if (!COMBAT_NARRATION_ENABLED) return promptText;
    if (this._narrationBusy)       return promptText;

    this._narrationBusy = true;
    try {
      const fullPrompt = `You are the narrator of a gritty cyberpunk RPG. A combat event just happened:
${promptText}

Current situation:
- Player HP: ${State.hp}/${State.maxHp}
- Enemy: ${activeCombat.enemy.name} HP: ${activeCombat.enemy.hp}/${activeCombat.enemy.maxHp}
- Round: ${activeCombat.round}

Write ONE sentence of immersive, suspenseful narration. Use vivid, gritty cyberpunk language. No game mechanics or numbers. Respond with: {"narration":"your sentence here"}.`;

      const resp = await Llm.send(fullPrompt, context || 'combat_narration');
      return resp.narration || promptText;
    } catch(e) {
      console.warn('AI narration failed:', e);
      return promptText;
    } finally {
      this._narrationBusy = false;
    }
  },

  start(combatData) {
    const enemy = combatData.enemy;
    activeCombat = {
      enemy: {
        name:          enemy.name,
        level:         enemy.level || 1,
        hp:            enemy.hp,
        maxHp:         enemy.hp,
        description:   enemy.description || '',
        skills:        (enemy.skills || []).map(s => ({ ...s, currentCooldown:0 })),
        statusEffects: [],
      },
      playerStatusEffects: [],
      round:    1,
      cooldowns:{},
      locked:   false,
    };

    State.energy = Math.min(State.energy + 20, State.maxEnergy);
    document.getElementById('combatLog').innerHTML = '';
    this.clog(`⚔ Combat begins: ${enemy.name} (LV${enemy.level||1})`, 'cl-system');
    this.refresh();
    document.getElementById('combatOverlay').classList.add('open');
    Ui.setInputLocked(true);
  },

  clog(text, cls = 'cl-system') {
    const log = document.getElementById('combatLog');
    const el  = document.createElement('div');
    el.className  = 'cl-entry ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = 999999;
  },

  refresh() {
    if (!activeCombat) return;
    const c = activeCombat;
    document.getElementById('ceEnemyName').textContent  = c.enemy.name.toUpperCase();
    document.getElementById('ceEnemyLevel').textContent = `LVL ${c.enemy.level}`;
    document.getElementById('ceEnemyDesc').textContent  = c.enemy.description;
    document.getElementById('ceHpText').textContent     = `${Math.max(0,c.enemy.hp)}/${c.enemy.maxHp}`;
    document.getElementById('ceHpFill').style.width     = `${Math.max(0, c.enemy.hp/c.enemy.maxHp*100)}%`;
    document.getElementById('ceRound').textContent      = c.round;
    this.renderStatuses('ceStatuses', c.enemy.statusEffects);
    this.renderStatuses('cpStatuses', c.playerStatusEffects);
    document.getElementById('cpHpFill').style.width  = `${State.hp/State.maxHp*100}%`;
    document.getElementById('cpHpText').textContent  = `${State.hp}/${State.maxHp}`;
    document.getElementById('cpEnFill').style.width  = `${State.energy/State.maxEnergy*100}%`;
    document.getElementById('cpEnText').textContent  = `${State.energy}/${State.maxEnergy}`;
    Ui.updateHeader();
    this.buildSkillGrid();
  },

  renderStatuses(elId, statuses) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = statuses.map(sf => {
      const cls = { dot:'sc-dot', skip:'sc-skip', expose:'sc-expose', buff_shield:'sc-buff', buff_hp:'sc-buff' }[sf.type] || 'sc-debuff';
      const desc = sf.description || (sf.type === 'dot' ? `Deals ${sf.value || 5} damage each turn` :
                                    sf.type === 'skip' ? 'Skips next turn' :
                                    sf.type === 'expose' ? 'Takes 50% more damage' :
                                    sf.type === 'buff_shield' ? `Absorbs ${sf.value} damage` :
                                    sf.type === 'buff_hp' ? `Heals ${sf.value} HP` :
                                    sf.type === 'debuff_agi' ? `AGI -${sf.value}` :
                                    `Effect: ${sf.name} (duration: ${sf.duration})`);
      return `<span class="status-chip ${cls}" title="${desc}">${sf.name} ${sf.duration}T</span>`;
    }).join('');
  },

  buildSkillGrid() {
    const grid   = document.getElementById('combatSkillGrid');
    const c      = activeCombat;
    const buttons = [];

    State.skills.forEach(sk => {
      const cd      = c.cooldowns[sk.name] || 0;
      const canUse  = cd === 0 && State.energy >= sk.energyCost && !c.locked;
      const stunned = c.playerStatusEffects.some(s => s.type === 'skip');
      const dmgStr  = sk.damage ? `${sk.damage[0]}-${sk.damage[1]}` : '—';
      buttons.push(`<button class="cb-skill-btn" data-skill="${sk.name}" ${(!canUse || stunned) ? 'disabled' : ''}>
        ${cd > 0 ? `<span class="csb-cd">${cd}T</span>` : ''}
        <span class="csb-name">${sk.name}</span>
        <span class="csb-meta">${sk.energyCost}en · ${dmgStr}dmg</span>
      </button>`);
    });

    const consumable = State.inventory.find(i =>
      /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0
    );

    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__wait" ${c.locked ? 'disabled' : ''}>
      <span class="csb-name">WAIT</span>
      <span class="csb-meta">+25 energy</span>
    </button>`);

    buttons.push(`<button class="cb-skill-btn csb-special" data-skill="__item" ${(!consumable||c.locked) ? 'disabled' : ''}>
      <span class="csb-name">USE ITEM</span>
      <span class="csb-meta">${consumable ? consumable.name : 'none'}</span>
    </button>`);

    buttons.push(`<button class="cb-skill-btn csb-flee" data-skill="__flee" ${c.locked ? 'disabled' : ''}>
      <span class="csb-name">FLEE</span>
      <span class="csb-meta">AGI check</span>
    </button>`);

    grid.innerHTML = buttons.join('');
    grid.querySelectorAll('.cb-skill-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => this.playerAction(btn.dataset.skill));
    });
  },

  async playerAction(skillName) {
    if (!activeCombat || activeCombat.locked) return;
    activeCombat.locked = true;
    document.getElementById('ceTurnLabel').textContent = 'ENEMY TURN';
    document.getElementById('ceTurnLabel').style.color = '#ff6b7a';

    const c = activeCombat;

    // Check for stun
    const stunIdx = c.playerStatusEffects.findIndex(s => s.type === 'skip');
    if (stunIdx !== -1) {
      c.playerStatusEffects[stunIdx].duration--;
      if (c.playerStatusEffects[stunIdx].duration <= 0)
        c.playerStatusEffects.splice(stunIdx, 1);
      const n = await this.narrateAction('You are stunned and cannot act.', 'player_stunned');
      this.clog(n, 'cl-system');
      setTimeout(() => this.enemyTurn(), 600);
      return;
    }

    // Handle special actions
    if (skillName === '__wait') {
      State.energy = Math.min(State.maxEnergy, State.energy + 25);
      this.clog(`You wait and recover energy. (EN: ${State.energy}/${State.maxEnergy})`, 'cl-player');
      setTimeout(() => this.enemyTurn(), 500);
      return;
    }

    if (skillName === '__flee') {
      const actionData = `The player attempts to flee.`;
      const outcome = await this._callCombatAI('flee', actionData);
      if (outcome.fled) {
        this.clog(`You slip away into the dark.`, 'cl-system');
        setTimeout(() => this.endCombat('flee'), 800);
      } else {
        this.clog(`You fail to escape!`, 'cl-miss');
        if (outcome.damage) {
          State.hp = Math.max(0, State.hp - outcome.damage);
          this.clog(`You take ${outcome.damage} damage.`, 'cl-miss');
        }
        setTimeout(() => this.enemyTurn(), 600);
      }
      return;
    }

    if (skillName === '__item') {
      const consumable = State.inventory.find(i =>
        /stim|heal|med|inject|boost|patch|syringe/i.test(i.name) && i.amount > 0
      );
      if (consumable) {
        const actionData = `The player uses a ${consumable.name}.`;
        const outcome = await this._callCombatAI('use_item', actionData);
        const healAmt = outcome.heal || (20 + State.stats.tec * 2);
        State.hp = Math.min(State.maxHp, State.hp + healAmt);
        if (window.Sound) Sound.itemUse();
        consumable.amount--;
        if (consumable.amount <= 0) State.inventory.splice(State.inventory.indexOf(consumable), 1);
        this.clog(`You use ${consumable.name}: +${healAmt} HP`, 'cl-player');
        if (outcome.narration) this.clog(outcome.narration, 'cl-player');
        setTimeout(() => this.enemyTurn(), 500);
      }
      return;
    }

    // Regular skill
    const skill = State.skills.find(s => s.name === skillName);
    if (!skill) { activeCombat.locked = false; return; }
    if (State.energy < skill.energyCost) { activeCombat.locked = false; return; }

    // Deduct energy now; AI may adjust later
    State.energy -= skill.energyCost;
    c.cooldowns[skill.name] = skill.cooldown || 0;

    const actionData = `Player uses skill "${skill.name}".
Skill data: ${JSON.stringify(skill)}`;
    const outcome = await this._callCombatAI('player_skill', actionData);

    // Apply results
    let dmg = outcome.damage || 0;
    let heal = outcome.heal || 0;
    let selfDmg = outcome.selfDamage || 0;
    let energyChange = outcome.energyChange || 0;

    if (dmg > 0) {
      c.enemy.hp = Math.max(0, c.enemy.hp - dmg);
      if (window.Sound) Sound.combatHit(true);
    }
    if (heal > 0) State.hp = Math.min(State.maxHp, State.hp + heal);
    if (selfDmg > 0) State.hp = Math.max(0, State.hp - selfDmg);
    if (energyChange !== 0) State.energy = Math.min(State.maxEnergy, Math.max(0, State.energy + energyChange));

    if (outcome.statusEffect && outcome.target === 'enemy') {
      const existing = c.enemy.statusEffects.find(s => s.name === outcome.statusEffect.name);
      if (existing) existing.duration = outcome.statusEffect.duration;
      else c.enemy.statusEffects.push({ ...outcome.statusEffect });
    } else if (outcome.statusEffect && outcome.target === 'player') {
      const existing = c.playerStatusEffects.find(s => s.name === outcome.statusEffect.name);
      if (existing) existing.duration = outcome.statusEffect.duration;
      else c.playerStatusEffects.push({ ...outcome.statusEffect });
    }

    const narText = outcome.narration || `${skill.name} hits!`;
    this.clog(narText, dmg > 0 ? (outcome.crit ? 'cl-crit' : 'cl-player') : 'cl-player');

    if (c.enemy.hp <= 0) {
      setTimeout(() => this.endCombat('win'), 600);
      return;
    }

    // Update UI
    this.refresh();
    setTimeout(() => this.enemyTurn(), 700);
  },

  async enemyTurn() {
    if (!activeCombat) return;
    const c = activeCombat;

    const enemyStun = c.enemy.statusEffects.find(s => s.type === 'skip');
    if (enemyStun) {
      const n = await this.narrateAction(`${c.enemy.name} is stunned and cannot act.`, 'enemy_stunned');
      this.clog(n, 'cl-status');
      // Reduce stun duration
      enemyStun.duration--;
      if (enemyStun.duration <= 0) {
        c.enemy.statusEffects = c.enemy.statusEffects.filter(s => s !== enemyStun);
      }
    } else {
      // Call AI for enemy action
      const actionData = `Enemy ${c.enemy.name} must choose an action.`;
      const outcome = await this._callCombatAI('enemy_turn', actionData);

      let dmg = outcome.damage || 0;
      let selfDmg = outcome.selfDamage || 0;
      let heal = outcome.heal || 0;

      if (dmg > 0) {
        // Dodge chance based on AGI
        const agi = State.stats.agi;
        const dodge = Math.random() * 100 < (agi * 3);
        if (dodge) {
          const n = await this.narrateAction(`You dodge ${c.enemy.name}'s attack!`, 'enemy_miss');
          this.clog(n, 'cl-miss');
          dmg = 0;
        } else {
          State.hp = Math.max(0, State.hp - dmg);
          if (window.Sound) Sound.combatHit(false);
        }
      }
      if (selfDmg > 0) c.enemy.hp = Math.max(0, c.enemy.hp - selfDmg);
      if (heal > 0) c.enemy.hp = Math.min(c.enemy.maxHp, c.enemy.hp + heal);

      if (outcome.statusEffect && outcome.target === 'player') {
        const existing = c.playerStatusEffects.find(s => s.name === outcome.statusEffect.name);
        if (existing) existing.duration = outcome.statusEffect.duration;
        else c.playerStatusEffects.push({ ...outcome.statusEffect });
      } else if (outcome.statusEffect && outcome.target === 'enemy') {
        const existing = c.enemy.statusEffects.find(s => s.name === outcome.statusEffect.name);
        if (existing) existing.duration = outcome.statusEffect.duration;
        else c.enemy.statusEffects.push({ ...outcome.statusEffect });
      }

      const narText = outcome.narration || `${c.enemy.name} attacks.`;
      this.clog(narText, 'cl-enemy');
    }

    // Tick down cooldowns and statuses
    this.tickStatuses();

    State.skills.forEach(sk => { if (c.cooldowns[sk.name] > 0) c.cooldowns[sk.name]--; });
    c.enemy.skills.forEach(sk => { if (sk.currentCooldown > 0) sk.currentCooldown--; });

    // Energy regen
    State.energy = Math.min(State.maxEnergy, State.energy + 5 + Math.floor(State.stats.int / 2));
    c.round++;

    if (State.hp <= 0) {
      checkDeath(`You succumbed to your wounds in round ${c.round}.`);
      this.endCombat('death');
      return;
    }

    this.refresh();
    document.getElementById('ceTurnLabel').textContent = 'YOUR TURN';
    document.getElementById('ceTurnLabel').style.color = 'var(--green)';
    activeCombat.locked = false;
    this.refresh();
  },

  tickStatuses() {
    const c    = activeCombat;
    const tick = (effects, isPlayer) => {
      for (let i = effects.length-1; i >= 0; i--) {
        const sf = effects[i];
        if (sf.type === 'dot') {
          const dmg = sf.value || 5;
          if (isPlayer) { State.hp = Math.max(0, State.hp - dmg); this.clog(`  ${sf.name}: -${dmg} HP`, 'cl-status'); }
          else          { c.enemy.hp = Math.max(0, c.enemy.hp - dmg); this.clog(`  ${sf.name}: ${c.enemy.name} -${dmg} HP`, 'cl-status'); }
        }
        if (sf.type === 'buff_hp' && isPlayer) {
          State.hp = Math.min(State.maxHp, State.hp + sf.value);
          this.clog(`  ${sf.name}: +${sf.value} HP`, 'cl-status');
        }
        sf.duration--;
        if (sf.duration <= 0) {
          this.clog(`  ${sf.name} fades.`, 'cl-system');
          effects.splice(i, 1);
        }
      }
    };
    tick(c.playerStatusEffects, true);
    tick(c.enemy.statusEffects,  false);
  },

  endCombat(outcome) {
    const c = activeCombat;
    if (!c) return;
    document.getElementById('combatOverlay').classList.remove('open');
    activeCombat = null;

    const enemyName = c.enemy.name;
    const rounds    = c.round - 1;

    if (outcome === 'win') {
      const baseXp = c.enemy.level * 25 + Math.floor(Math.random() * 20);
      Ui.addInstant(`[ COMBAT VICTORY: ${enemyName} defeated in ${rounds} rounds ]`, 'system');

      const deadNpc = State.npcs.find(n => n.name.toLowerCase() === enemyName.toLowerCase());
      if (deadNpc) {
        deadNpc.relationship = 'Dead';
      } else {
        State.npcs.push({
          name: enemyName,
          relationship: 'Dead',
          description: `Defeated in combat on Day ${State.gameDay}. ${c.enemy.description || ''}`.trim(),
        });
      }
      Ui.renderSidebar();
      Llm.send(`[COMBAT WON] Defeated ${enemyName} (LV${c.enemy.level}) in ${rounds} rounds. Player HP: ${State.hp}/${State.maxHp}. Narrate aftermath and grant ${baseXp} XP.`)
        .then(resp => {
          Engine.applyResponse(resp);
          if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
          StatSystem.gainXp(baseXp);
          const wq = () => { if (Ui.isTyping||Ui.typeQueue.length) setTimeout(wq,200); else { Ui.setInputLocked(false); Ui.updateHeader(); Ui.renderSidebar(); } };
          wq();
        });

    } else if (outcome === 'lose') {
      State.hp = 0;
      const deathReason = `You were defeated by ${enemyName} and succumbed to your wounds.`;
      Llm.send(`[COMBAT LOST] The player was killed by ${enemyName}. Describe their final moments in a grim, poetic way.`).then(resp => {
        if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
        const waitDeath = () => {
          if (Ui.isTyping || Ui.typeQueue.length) setTimeout(waitDeath, 200);
          else checkDeath(deathReason);
        };
        waitDeath();
      });
      return;
    } else if (outcome === 'death') {
      document.getElementById('combatOverlay').classList.remove('open');
      activeCombat = null;
      return;
    } else {
      Ui.addInstant(`[ You fled from ${enemyName} ]`, 'system');
      Llm.send(`[COMBAT FLED] Player fled from ${enemyName}. Narrate the brief escape. Minor consequence.`)
        .then(resp => {
          Engine.applyResponse(resp);
          if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
          const wq = () => { if (Ui.isTyping||Ui.typeQueue.length) setTimeout(wq,200); else { Ui.setInputLocked(false); Ui.updateHeader(); Ui.renderSidebar(); } };
          wq();
        });
    }
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