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
Player ${State.hp}/${State.maxHp} HP vs ${c.enemy.name} ${Math.max(0,c.enemy.hp)}/${c.enemy.maxHp} HP, round ${c.round}.
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

  _rollPlayerSkill(skill) {
    const base      = skill.damage[0] + Math.floor(Math.random() * (skill.damage[1] - skill.damage[0] + 1));
    const statMod   = skill.statScaling ? Math.floor(State.stats[skill.statScaling] * 0.4) : 0;
    const isCrit    = Math.random() * 100 < State.stats.agi * 1.5;
    const expose    = activeCombat.enemy.statusEffects.find(s => s.type === 'expose') ? 1.5 : 1;
    const dmg       = Math.max(1, Math.floor((base + statMod) * (isCrit ? 1.5 : 1) * expose));

    let statusApplied = false;
    if (skill.statusEffect) {
      const roll   = Math.floor(Math.random() * 20) + 1;
      const target = 10 + Math.floor((skill.statScaling ? State.stats[skill.statScaling] : State.stats.cha) * 0.5);
      if (roll >= target) {
        const c = activeCombat;
        const ex = c.enemy.statusEffects.find(s => s.name === skill.statusEffect.name);
        if (ex) ex.duration = skill.statusEffect.duration;
        else    c.enemy.statusEffects.push({ ...skill.statusEffect });
        statusApplied = true;
      }
    }
    return { dmg, isCrit, statusApplied };
  },

  _rollEnemyAction() {
    const c         = activeCombat;
    const available = c.enemy.skills.filter(s => (s.currentCooldown || 0) === 0);
    const skill     = available.length ? available[Math.floor(Math.random() * available.length)] : null;
    if (!skill) return { skill: null, dmg: 0, dodged: false };

    const slowDebuff  = c.playerStatusEffects.find(s => s.type === 'debuff_agi');
    const effectiveAgi = State.stats.agi - (slowDebuff ? slowDebuff.value : 0);
    const dodged      = Math.random() * 100 < Math.max(0, effectiveAgi * 3);
    if (dodged) return { skill, dmg: 0, dodged: true };

    const rawDmg  = (skill.damage?.[0] || 5) + Math.floor(Math.random() * ((skill.damage?.[1] || 12) - (skill.damage?.[0] || 5) + 1));
    const shield  = c.playerStatusEffects.find(s => s.type === 'buff_shield');
    let finalDmg  = rawDmg;
    if (shield) {
      const absorbed = Math.min(shield.value, rawDmg);
      finalDmg      -= absorbed;
      shield.value  -= absorbed;
      if (shield.value <= 0) c.playerStatusEffects.splice(c.playerStatusEffects.indexOf(shield), 1);
    }
    return { skill, dmg: Math.max(0, finalDmg), dodged: false };
  },

  // ── ui helpers ────────────────────────────────────────────────────────────

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
    el.className   = 'cl-entry ' + cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop  = 999999;
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
    document.getElementById('cpHpFill').style.width = `${State.hp/State.maxHp*100}%`;
    document.getElementById('cpHpText').textContent = `${State.hp}/${State.maxHp}`;
    document.getElementById('cpEnFill').style.width = `${State.energy/State.maxEnergy*100}%`;
    document.getElementById('cpEnText').textContent = `${State.energy}/${State.maxEnergy}`;
    Ui.updateHeader();
    this.buildSkillGrid();
  },

  renderStatuses(elId, statuses) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = statuses.map(sf => {
      const cls  = { dot:'sc-dot', skip:'sc-skip', expose:'sc-expose', buff_shield:'sc-buff', buff_hp:'sc-buff' }[sf.type] || 'sc-debuff';
      const desc = sf.description || (
        sf.type === 'dot'        ? `Deals ${sf.value||5} damage each turn` :
        sf.type === 'skip'       ? 'Skips next turn' :
        sf.type === 'expose'     ? 'Takes 50% more damage' :
        sf.type === 'buff_shield'? `Absorbs ${sf.value} damage` :
        sf.type === 'buff_hp'    ? `Heals ${sf.value} HP` :
        sf.type === 'debuff_agi' ? `AGI -${sf.value}` :
        `${sf.name} (${sf.duration}T)`
      );
      return `<span class="status-chip ${cls}" title="${desc}">${sf.name} ${sf.duration}T</span>`;
    }).join('');
  },

  buildSkillGrid() {
    const grid    = document.getElementById('combatSkillGrid');
    const c       = activeCombat;
    const buttons = [];
    const stunned = c.playerStatusEffects.some(s => s.type === 'skip');

    State.skills.forEach(sk => {
      const cd     = c.cooldowns[sk.name] || 0;
      const canUse = cd === 0 && State.energy >= sk.energyCost && !c.locked;
      const dmgStr = sk.damage ? `${sk.damage[0]}-${sk.damage[1]}` : '—';
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

  // ── player turn ───────────────────────────────────────────────────────────

  async playerAction(skillName) {
    if (!activeCombat || activeCombat.locked) return;
    activeCombat.locked = true;
    document.getElementById('ceTurnLabel').textContent = 'ENEMY TURN';
    document.getElementById('ceTurnLabel').style.color = '#ff6b7a';

    const c = activeCombat;

    const stunIdx = c.playerStatusEffects.findIndex(s => s.type === 'skip');
    if (stunIdx !== -1) {
      c.playerStatusEffects[stunIdx].duration--;
      if (c.playerStatusEffects[stunIdx].duration <= 0)
        c.playerStatusEffects.splice(stunIdx, 1);
      await this._narrate(
        '▶ STUNNED — you cannot act this turn',
        `Player is stunned and loses their turn.`,
        'cl-system'
      );
      setTimeout(() => this.enemyTurn(), 600);
      return;
    }

    if (skillName === '__wait') {
      State.energy = Math.min(State.maxEnergy, State.energy + 25);
      await this._narrate(
        `▶ WAIT — +25 EN (${State.energy}/${State.maxEnergy})`,
        `Player waits and recovers energy.`,
        'cl-player'
      );
      setTimeout(() => this.enemyTurn(), 500);
      return;
    }

    if (skillName === '__flee') {
      const roll = Math.floor(Math.random() * 20) + 1;
      const thr  = 8 - Math.floor(State.stats.agi / 2);
      if (roll >= thr) {
        await this._narrate(
          `▶ FLEE — success (roll ${roll})`,
          `Player successfully flees the fight.`,
          'cl-system'
        );
        setTimeout(() => this.endCombat('flee'), 800);
      } else {
        await this._narrate(
          `▶ FLEE — failed (roll ${roll}, needed ${thr}+)`,
          `Player tries to flee but fails.`,
          'cl-miss'
        );
        setTimeout(() => this.enemyTurn(), 600);
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
        if (window.Sound) Sound.itemUse();
        consumable.amount--;
        if (consumable.amount <= 0) State.inventory.splice(State.inventory.indexOf(consumable), 1);
        await this._narrate(
          `▶ ${consumable.name} — +${healAmt} HP (${State.hp}/${State.maxHp})`,
          `Player uses a ${consumable.name} and heals ${healAmt} HP.`,
          'cl-player'
        );
        setTimeout(() => this.enemyTurn(), 500);
      }
      return;
    }

    const skill = State.skills.find(s => s.name === skillName);
    if (!skill) { activeCombat.locked = false; return; }
    if (State.energy < skill.energyCost) { activeCombat.locked = false; return; }

    State.energy -= skill.energyCost;
    c.cooldowns[skill.name] = skill.cooldown || 0;

    if (skill.damage) {
      const { dmg, isCrit, statusApplied } = this._rollPlayerSkill(skill);
      c.enemy.hp -= dmg;
      if (window.Sound) Sound.combatHit(true);

      let mechMsg = `▶ ${skill.name} — ${dmg} dmg${isCrit ? ' [CRIT]' : ''}`;
      let aiCtx   = `Player uses ${skill.name}, dealing ${dmg} damage${isCrit ? ' with a critical hit' : ''}`;
      if (skill.statusEffect) {
        const label = statusApplied ? `[${skill.statusEffect.name} applied]` : `[${skill.statusEffect.name} resisted]`;
        mechMsg += ` ${label}`;
        aiCtx   += statusApplied ? `, inflicting ${skill.statusEffect.name}` : `, but the effect was resisted`;
      }

      await this._narrate(mechMsg, aiCtx + '.', isCrit ? 'cl-crit' : 'cl-player');
    } else {
      // pure status / utility skill
      if (skill.statusEffect) {
        const c2   = activeCombat;
        const roll = Math.floor(Math.random() * 20) + 1;
        const thr  = 10 + Math.floor((skill.statScaling ? State.stats[skill.statScaling] : State.stats.cha) * 0.5);
        if (roll >= thr) {
          const ex = c2.enemy.statusEffects.find(s => s.name === skill.statusEffect.name);
          if (ex) ex.duration = skill.statusEffect.duration;
          else    c2.enemy.statusEffects.push({ ...skill.statusEffect });
          await this._narrate(
            `▶ ${skill.name} — ${skill.statusEffect.name} applied (roll ${roll})`,
            `Player uses ${skill.name}, successfully inflicting ${skill.statusEffect.name} on the enemy.`,
            'cl-player'
          );
        } else {
          await this._narrate(
            `▶ ${skill.name} — resisted (roll ${roll}, needed ${thr}+)`,
            `Player uses ${skill.name} but the enemy resists.`,
            'cl-miss'
          );
        }
      } else {
        await this._narrate(
          `▶ ${skill.name} activated`,
          `Player activates ${skill.name}.`,
          'cl-player'
        );
      }
    }

    if (c.enemy.hp <= 0) {
      setTimeout(() => this.endCombat('win'), 600);
      return;
    }
    this.refresh();
    setTimeout(() => this.enemyTurn(), 700);
  },

  // ── enemy turn ────────────────────────────────────────────────────────────

  async enemyTurn() {
    if (!activeCombat) return;
    const c = activeCombat;

    const enemyStun = c.enemy.statusEffects.find(s => s.type === 'skip');
    if (enemyStun) {
      await this._narrate(
        `◀ ${c.enemy.name} — stunned, skips turn`,
        `${c.enemy.name} is stunned and cannot act this round.`,
        'cl-status'
      );
      enemyStun.duration--;
      if (enemyStun.duration <= 0)
        c.enemy.statusEffects.splice(c.enemy.statusEffects.indexOf(enemyStun), 1);
    } else {
      const { skill, dmg, dodged } = this._rollEnemyAction();

      if (!skill) {
        await this._narrate(
          `◀ ${c.enemy.name} — holds position`,
          `${c.enemy.name} has no available skills and holds back.`,
          'cl-system'
        );
      } else if (dodged) {
        await this._narrate(
          `◀ ${skill.name} — DODGE`,
          `Player dodges ${c.enemy.name}'s ${skill.name} at the last moment.`,
          'cl-miss'
        );
      } else {
        State.hp = Math.max(0, State.hp - dmg);
        if (window.Sound && dmg > 0) Sound.combatHit(false);

        if (State.hp <= 0) {
          checkDeath(`Killed by ${c.enemy.name} in round ${c.round}.`);
          this.endCombat('death');
          return;
        }

        await this._narrate(
          `◀ ${skill.name} — ${dmg} dmg to you (${State.hp}/${State.maxHp} HP)`,
          `${c.enemy.name} uses ${skill.name}, dealing ${dmg} damage to the player.`,
          'cl-enemy'
        );

        if (skill.statusEffect) {
          const ex = c.playerStatusEffects.find(s => s.name === skill.statusEffect.name);
          if (ex) ex.duration = skill.statusEffect.duration;
          else    c.playerStatusEffects.push({ ...skill.statusEffect });
          await this._narrate(
            `  ✦ ${skill.statusEffect.name} inflicted`,
            `${c.enemy.name} inflicts ${skill.statusEffect.name} on the player.`,
            'cl-status'
          );
        }
        if (skill.cooldown) skill.currentCooldown = skill.cooldown;
      }
    }

    this.tickStatuses();

    State.skills.forEach(sk => { if (c.cooldowns[sk.name] > 0) c.cooldowns[sk.name]--; });
    c.enemy.skills.forEach(sk => { if (sk.currentCooldown > 0) sk.currentCooldown--; });

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
      for (let i = effects.length - 1; i >= 0; i--) {
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
    tick(c.enemy.statusEffects, false);
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
        State.npcs.push({ name: enemyName, relationship: 'Dead', description: `Defeated in combat on Day ${State.gameDay}. ${c.enemy.description||''}`.trim() });
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
      Llm.send(`[COMBAT LOST] Player killed by ${enemyName}. Describe their final moments grimly.`).then(resp => {
        if (resp.narration) Ui.enqueue(resp.narration, 'narrator');
        const waitDeath = () => {
          if (Ui.isTyping||Ui.typeQueue.length) setTimeout(waitDeath, 200);
          else checkDeath(`Defeated by ${enemyName}.`);
        };
        waitDeath();
      });
      return;

    } else if (outcome === 'death') {
      return;

    } else {
      Ui.addInstant(`[ You fled from ${enemyName} ]`, 'system');
      Llm.send(`[COMBAT FLED] Player fled from ${enemyName}. Narrate the escape. Minor consequence.`)
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