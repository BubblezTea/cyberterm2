// main.js

let isDead = false;
let __lastStateSnapshot = null;
let __lastLogSnapshot   = null;

const SKULL_BINARY = [
  "   00111111111111111100   ",
  "  0111111111111111111110  ",
  " 011111001111111100111110 ",
  " 011110001111111100011110 ",
  "01111000011111111000011110",
  "01111000011111111000011110",
  "01111000011111111000011110",
  " 011111001111111100111110 ",
  " 011111111111111111111110 ",
  " 001111111111111111111100 ",
  "  0011111111111111111100  ",
  "   00011111111111111000   ",
  "     0011111111111000     ",
  "       011111111110       ",
  "         01111110         ",
  "          011110          ",
  "           1111           ",
];

async function boot() {
  const status = document.getElementById('bootStatus');
  const steps  = ['LOADING KERNEL...', 'MOUNTING CITY GRID...', 'SYNCING NEURAL MESH...', 'READY.'];
  for (const s of steps) {
    status.textContent = s;
    await new Promise(r => setTimeout(r, 520));
  }
  await new Promise(r => setTimeout(r, 300));
  Ui.showScreen('mainMenuScreen');
}

function waitForTyping(then) {
  if (Ui.isTyping || Ui.typeQueue.length) {
    setTimeout(() => waitForTyping(then), 200);
  } else {
    then();
  }
}

async function startGame(chosenClass) {
  const cd = classData[chosenClass] || {};

  State.playerClass  = chosenClass;
  State.hp           = cd.startHp      || 100;
  State.maxHp        = State.hp;
  State.credits      = cd.startCredits || 0;
  State.traits       = [];
  State.skills       = [];
  State.statPoints   = 5;
  State.level        = 1;
  State.xp           = 0;
  State.xpToNext     = 100;
  State.energy       = 70;
  State.maxEnergy    = 70;
  State.location     = State.origin;

  if (ccBackstoryNpcs && ccBackstoryNpcs.length) {
    State.npcs = ccBackstoryNpcs.map(n => ({ ...n }));
  }

  if (Theme.current === 'fantasy') {
    State.npcs.push({
      name: 'Elara',
      relationship: 'Friendly',
      description: "A wandering mage who once saved you from a beast. She has a kind heart and a sharp mind, always seeking ancient lore."
    });
  } else {
    State.npcs.push({
      name: 'V',
      relationship: 'Neutral',
      description: "Your old buddy, but you're not close anymore. V runs a small fixer network from a cramped data den in the Glitch Sector. They specialize in information brokerage, not just package delivery."
    });
  }

  if (Theme.current === 'fantasy') {
    State.quests.push({
      title: "Defeat the Demon King",
      description: "Find the Demon King and end his reign of terror. The journey will be long, but you will not face it alone.",
      status: "active",
      reward: "Peace for the realm"
    });
  } else {
    State.quests.push({
      title:       "Find who ruined your life.",
      description: "Find whoever ruined your life, pursuit them and kill them.",
      status:      "Active",
      reward:      "Satisfaction"
    });
  }

  Ui.showScreen('gameScreen');
  Ui.updateHeader();
  Ui.renderSidebar();
  Ui.setInputLocked(true);

  const charScreen = document.getElementById('charCreateScreen');
  if (charScreen) charScreen.style.display = 'none';

  State.history.push({ role: 'assistant', content: JSON.stringify({ narration: "The game begins..." }) });

  const backstoryContext = State.backstory && State.tragedy && State.upbringing ? `
PLAYER IDENTITY:
- Name: ${State.playerName}
- Grew up in: ${State.origin}
- Backstory: ${State.backstory}
- Defining tragedy: ${State.tragedy.name} — ${State.tragedy.desc} | Mechanical effect: ${State.tragedy.effect}
- Upbringing: ${State.upbringing.name} (d20 roll: ${State.upbringingRoll}/20) — ${State.upbringing.result}
- Known contacts from past: ${ccBackstoryNpcs.map(n => `${n.name} (${n.relationship})`).join(', ') || 'none yet'}` : '';

  const traitPrompt = Prompts.getGameStartPrompt(chosenClass, backstoryContext);

  const resp = await Llm.send(traitPrompt, 'FIRST_TURN=true', 1600);
  Engine.applyResponse(resp);

  if (State.tragedy && State.tragedy.statBonus) {
    Object.entries(State.tragedy.statBonus).forEach(([k, v]) => {
      if (State.stats[k] !== undefined) State.stats[k] = Math.min(20, State.stats[k] + v);
    });
    State.maxHp     = StatSystem.calcMaxHp();
    State.hp        = Math.min(State.hp, State.maxHp);
    State.maxEnergy = StatSystem.calcMaxEnergy();
    State.energy    = Math.min(State.energy, State.maxEnergy);
  }

  if (State.tragedy && State.tragedy.startItem) {
    const alreadyHas = State.inventory.find(i => i.name === State.tragedy.startItem.name);
    if (!alreadyHas) State.inventory.push({ ...State.tragedy.startItem });
  }

  if (State.tragedy && State.tragedy.startItem) {
    const alreadyHas = State.inventory.find(i => i.name === State.tragedy.startItem.name);
    if (!alreadyHas) State.inventory.push({ ...State.tragedy.startItem });
  }

  // multiplayer: broadcast initialized state and wait for everyone
  if (window.Multiplayer && Multiplayer.enabled) {
    Multiplayer._broadcastSelfSnapshot();
    Ui.addInstant('[ WAITING FOR OTHER PLAYERS TO FINISH CHARACTER CREATION... ]', 'system');
    Ui.updateHeader();
    Ui.renderSidebar();
    if (Multiplayer.isHost()) Multiplayer._markSelfReady();
    else Multiplayer.readyForGame();
    return;
  }

  if (State.hp <= 0) checkDeath(resp.deathReason || 'Your actions led to your demise...');
  await new Promise(r => setTimeout(r, 100));
  if (resp.narration) Ui.enqueue(resp.narration, 'narrator');

  setTimeout(() => waitForTyping(() => {
    Ui.setInputLocked(false);
    Ui.updateHeader();
    Ui.renderSidebar();
  }), 500);
}

async function handlePlayerInput() {
  const input = document.getElementById('playerInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  Ui.addInstant(text, 'player');
  if (window.Sound) Sound.send();
  Ui.setInputLocked(true);

  const prevHp      = State.hp;
  const prevCredits = State.credits;
  const prevNpcs    = State.npcs.map(n => ({ ...n }));

  __lastStateSnapshot = JSON.parse(JSON.stringify(State));
  __lastLogSnapshot   = document.getElementById('narrativeLog').innerHTML;

  const socialKeywords = ['talk', 'ask', 'persuade', 'convince', 'lie', 'deceive', 'bargain', 'negotiate', 'intimidate', 'threaten', 'flirt', 'seduce', 'chat', 'greet', 'question', 'interrogate'];
  const isSocial       = socialKeywords.some(kw => text.toLowerCase().includes(kw));

  const preRoll        = Math.floor(Math.random() * 20) + 1;
  window.__pendingRoll = preRoll;

  const chaBonus  = isSocial ? Math.floor((State.stats.cha - 5) * 0.5) : 0;
  const finalRoll = isSocial ? Math.min(20, Math.max(1, preRoll + chaBonus)) : preRoll;

  const outcomeLabel = finalRoll === 1 ? 'CRITICAL FAILURE'
    : finalRoll <= 5  ? 'FAILURE'
    : finalRoll <= 12 ? 'MIXED'
    : finalRoll <= 19 ? 'SUCCESS'
    : 'CRITICAL SUCCESS';

  const msgWithRoll = `${text}

[ROLL: d20=${preRoll}${isSocial ? ` + CHA modifier (${chaBonus > 0 ? `+${chaBonus}` : chaBonus})` : ''} = ${finalRoll} — ${outcomeLabel}. This result is BINDING.]`;

  const resp = await Llm.send(msgWithRoll);
  Engine.applyResponse(resp);
  advanceTime();

  if (typeof resp.hpDelta === 'number' && resp.hpDelta < 0 && !resp.narration) {
    Ui.addInstant(`[ ${Math.abs(resp.hpDelta)} damage ]`, 'system');
  }

  if (State.hp <= 0 && !isDead) {
    checkDeath(resp.deathReason || 'Your wounds finally caught up with you.');
    return;
  }

  if (resp.narration) Ui.enqueue(resp.narration, 'narrator');

  const afterTyping = async () => {
    const tickerEl = buildTicker(resp, prevHp, prevCredits, prevNpcs);
    if (tickerEl) {
      document.getElementById('narrativeLog').appendChild(tickerEl);
      document.getElementById('narrativeLog').scrollTop = 999999;
    }

    Ui.updateHeader();
    Ui.renderSidebar();

    if (resp.qte && resp.qte.prompt) {
      const success = await Qte.trigger(resp.qte);
      const qteResp = success ? resp.qte.successNarration : resp.qte.failNarration;
      const hpDelta = success ? (resp.qte.successHpDelta || 0) : (resp.qte.failHpDelta || -15);

      if (hpDelta !== 0) {
        State.hp = Math.max(0, Math.min(State.maxHp, State.hp + hpDelta));
        Ui.updateHeader();
      }

      if (qteResp) {
        Ui.enqueue(qteResp, 'narrator');
        await new Promise(r => {
          const check = () => {
            if (Ui.isTyping || Ui.typeQueue.length) setTimeout(check, 200);
            else r();
          };
          check();
        });
      }

      const qteTicker = document.createElement('div');
      qteTicker.className = 'event-ticker';
      qteTicker.innerHTML = `<span class="tick-chip ${success ? 'pos' : 'neg'}">${success ? '✔ SUCCESS' : '✘ FAILED'}</span>`;
      document.getElementById('narrativeLog').appendChild(qteTicker);
      document.getElementById('narrativeLog').scrollTop = 999999;
      Ui.updateHeader();
      Ui.renderSidebar();
    }

    if (Engine.pendingCombat) {
      const pc = Engine.pendingCombat;
      Engine.pendingCombat = null;
      Ui.typeQueue = [];
      Ui.isTyping  = false;
      if (Ui.typingTimer) clearTimeout(Ui.typingTimer);
      setTimeout(() => {
        CombatEngine.start(pc.enemies ? pc : { enemies: [pc.enemy], allies: pc.allies || [] });
      }, 400);
      return;
    }

    if (Engine.pendingGui) {
      const pg = Engine.pendingGui;
      Engine.pendingGui = null;
      setTimeout(() => GuiEngine.show(pg), 300);
    }

    Ui.setInputLocked(false);
  };

  setTimeout(() => waitForTyping(afterTyping), 300);
}

async function refreshLastResponse() {
  if (!window.__lastUserMessage) {
    Ui.addInstant('No previous action to refresh.', 'system');
    return false;
  }

  if (__lastStateSnapshot) Object.assign(State, JSON.parse(JSON.stringify(__lastStateSnapshot)));
  if (__lastLogSnapshot) {
    const log     = document.getElementById('narrativeLog');
    log.innerHTML = __lastLogSnapshot;
    log.scrollTop = log.scrollHeight;
  }

  if (State.history.length > 0 && State.history[State.history.length - 1].role === 'assistant') {
    State.history.pop();
  }

  const lastTicker = document.querySelector('#narrativeLog .event-ticker:last-child');
  if (lastTicker) lastTicker.remove();

  Ui.addInstant('⟳ REFRESHING NEURAL OUTPUT...', 'system');

  const prevHp      = State.hp;
  const prevCredits = State.credits;
  const prevNpcs    = State.npcs.map(n => ({ ...n }));

  const reRoll         = Math.floor(Math.random() * 20) + 1;
  window.__pendingRoll = reRoll;
  const reLabel        = reRoll === 1 ? 'CRITICAL FAILURE' : reRoll <= 5 ? 'FAILURE' : reRoll <= 12 ? 'MIXED' : reRoll <= 19 ? 'SUCCESS' : 'CRITICAL SUCCESS';
  const msgWithReRoll  = `${window.__lastUserMessage}

[ROLL: d20=${reRoll} — ${reLabel}. This result is BINDING.] [REFRESH: regenerate differently]`;

  const resp = await Llm.send(msgWithReRoll);
  Engine.applyResponse(resp);

  if (resp.narration) Ui.enqueue(resp.narration, 'narrator');

  setTimeout(() => waitForTyping(() => {
    const tickerEl = buildTicker(resp, prevHp, prevCredits, prevNpcs);
    if (tickerEl) {
      document.getElementById('narrativeLog').appendChild(tickerEl);
      document.getElementById('narrativeLog').scrollTop = 999999;
    }
    Ui.updateHeader();
    Ui.renderSidebar();
  }), 100);

  return true;
}

function showDeathScreen(cause) {
  if (isDead) return;
  isDead = true;

  Ui.setInputLocked(true);
  if (Ui.typingTimer) clearTimeout(Ui.typingTimer);
  Ui.typeQueue = [];
  Ui.isTyping  = false;

  const deathMsgEl   = document.getElementById('deathMessage');
  const deathOverlay = document.getElementById('deathOverlay');
  const skullAscii   = document.getElementById('skullAscii');

  if (deathMsgEl)   deathMsgEl.textContent = cause;
  if (skullAscii)   skullAscii.textContent = SKULL_BINARY.join('\n');
  if (deathOverlay) deathOverlay.classList.add('open');
}

function checkDeath(reason) {
  if (State.hp <= 0 && !isDead) {
    showDeathScreen(reason);
    return true;
  }
  return false;
}