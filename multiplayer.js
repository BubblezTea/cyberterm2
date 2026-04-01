// multiplayer.js - lightweight 1-4p relay multiplayer (host authoritative)
(() => {
  const MP = {
    enabled: false,
    role: 'solo', // 'host' | 'client' | 'solo'
    room: null,
    playerId: null,
    ws: null,
    lobby: {
      started: false,   // host clicked START, players should go to char creation
    },
    players: [],
    lockState: {
      lockedIds: [],
      lockOrder: [],
      prompts: {},
    },
    // Combined start tracking
    playersReadyForGame: {},
    gameActive: false,
    combinedStartDone: false,
    // Save/load flags
    skipCharCreation: false,
    loadedSaveName: null,
    _lastSnapshotTime: 0,

    // Request tracking for AI calls from clients
    _requestId: 0,
    _pendingRequests: new Map(),

    isHost() { return this.enabled && this.role === 'host'; },
    isClient() { return this.enabled && this.role === 'client'; },

    requestFromHost(type, payload) {
      if (!this.enabled || this.isHost()) {
        return Promise.reject(new Error('Only clients can request from host'));
      }
      return this._sendRequest(type, payload);
    },

    _emitUiUpdate() {
      try { window.MultiplayerUI?.render?.(); } catch (_) {}
      try { this._applyAccessGates(); } catch (_) {}
      try { window.MultiplayerUI?.renderOverlay?.(); } catch (_) {}
      try { window.MultiplayerUI?.renderPartyTab?.(); } catch (_) {}
    },

    _applyAccessGates() {
      const consoleBtn = document.getElementById('consoleBtn');
      if (consoleBtn) {
        const allowed = !this.enabled || this.isHost();
        consoleBtn.style.display = allowed ? '' : 'none';
      }
    },

    _setStatus(text, cls) {
      const el = document.getElementById('mpStatus');
      if (!el) return;
      el.textContent = text || '';
      el.className = 'mp-status' + (cls ? ' ' + cls : '');
    },

    _safeName(name) {
      return String(name || '').trim().slice(0, 20) || 'Player';
    },

    _genRoomCode() {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let out = '';
      for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
      return out;
    },

    _send(type, payload = {}) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      this.ws.send(JSON.stringify({ type, ...payload }));
      return true;
    },

    // Request-response helpers
    _sendRequest(type, payload) {
      const id = this._requestId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${type}`));
        }, 30000);
        this._pendingRequests.set(id, { resolve, reject, timeout });
        this._send(type, { requestId: id, ...payload });
      });
    },

    _handleResponse(msg) {
      const { requestId, result, error } = msg;
      const pending = this._pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
        this._pendingRequests.delete(requestId);
      }
    },

    _broadcastSelfSnapshotThrottled() {
      const now = Date.now();
      if (now - this._lastSnapshotTime < 2000) return;
      this._lastSnapshotTime = now;
      this._broadcastSelfSnapshot();
    },

    _broadcastSelfSnapshot() {
      if (!this.enabled) return;
      const snapshot = {
        hp: State.hp,
        maxHp: State.maxHp,
        credits: State.credits,
        playerClass: State.playerClass,
        playerName: State.playerName,
        location: State.location,
        level: State.level,
        energy: State.energy,
        maxEnergy: State.maxEnergy,
        backstory: State.backstory,
        origin: State.origin,
        traits: State.traits,
        stats: State.stats,
        skills: State.skills,
        inventory: State.inventory,
        equipped: State.equipped,
      };
      this._send('player_snapshot', { snapshot });
    },

    _applyHostSync(sync) {
      if (!sync) return;
      if (sync.state) {
        try {
          Object.assign(State, JSON.parse(JSON.stringify(sync.state)));
        } catch (e) {
          console.warn('[MP] sync state failed', e);
        }
      }
      if (typeof sync.logHtml === 'string') {
        const log = document.getElementById('narrativeLog');
        if (log) {
          log.innerHTML = sync.logHtml;
          log.scrollTop = log.scrollHeight;
        }
      }
      if (sync.skipCharCreation !== undefined) this.skipCharCreation = sync.skipCharCreation;
      if (sync.loadedSaveName !== undefined) this.loadedSaveName = sync.loadedSaveName;
      Ui.updateHeader();
      Ui.renderSidebar();
    },

    async hostStart(room, name) {
      this.enabled = true;
      this.role = 'host';
      this.room = room;
      this.players = [];
      this.lockState = { lockedIds: [], lockOrder: [], prompts: {} };
      this.lobby = { started: false };
      this.playersReadyForGame = {};
      this.gameActive = false;
      this.combinedStartDone = false;
      this.skipCharCreation = false;
      this.loadedSaveName = null;

      const url = (window.MULTIPLAYER_WS_URL || 'ws://localhost:8787').trim();
      this._setStatus(`CONNECTING… (${url})`);
      await this._connect(url, {
        hello: { role: 'host', room, name: this._safeName(name) },
      });
      this._emitUiUpdate();
    },

    async join(room, name) {
      this.enabled = true;
      this.role = 'client';
      this.room = room;
      this.players = [];
      this.lockState = { lockedIds: [], lockOrder: [], prompts: {} };
      this.lobby = { started: false };
      this.playersReadyForGame = {};
      this.gameActive = false;
      this.combinedStartDone = false;
      this.skipCharCreation = false;
      this.loadedSaveName = null;

      const url = (window.MULTIPLAYER_WS_URL || 'ws://localhost:8787').trim();
      this._setStatus(`CONNECTING… (${url})`);
      await this._connect(url, {
        hello: { role: 'client', room, name: this._safeName(name) },
      });
      this._emitUiUpdate();
    },

    leave() {
      try { this._send('leave', {}); } catch (_) {}
      try { this.ws?.close(); } catch (_) {}
      this.ws = null;
      this.enabled = false;
      this.role = 'solo';
      this.room = null;
      this.playerId = null;
      this.players = [];
      this.lockState = { lockedIds: [], lockOrder: [], prompts: {} };
      this.lobby = { started: false };
      this.playersReadyForGame = {};
      this.gameActive = false;
      this.combinedStartDone = false;
      this.skipCharCreation = false;
      this.loadedSaveName = null;
      this._emitUiUpdate();
    },

    async _connect(url, { hello }) {
      return new Promise((resolve, reject) => {
        let opened = false;
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
          opened = true;
          this._send('hello', hello);
          resolve();
        };

        ws.onerror = (e) => {
          if (!opened) reject(e);
          this._setStatus('RELAY ERROR. Is the server running?', 'err');
        };

        ws.onclose = () => {
          if (this.enabled) {
            this._setStatus('DISCONNECTED FROM RELAY.', 'err');
          }
          this._emitUiUpdate();
        };

        ws.onmessage = (ev) => {
          let msg = null;
          try { msg = JSON.parse(ev.data); } catch (_) {}
          if (!msg || !msg.type) return;
          this._handle(msg);
        };
      });
    },

    async _handle(msg) {
      switch (msg.type) {
        case 'welcome': {
          this.playerId = msg.playerId;
          this._setStatus(`CONNECTED. ROOM ${this.room} · YOU ARE ${this.role.toUpperCase()}.`, 'ok');
          this._emitUiUpdate();
          this._broadcastSelfSnapshot();
          break;
        }

        case 'room_update': {
          this.players = msg.players || [];
          this.lockState = msg.lockState || this.lockState;
          this.lobby = msg.lobby || this.lobby;
          this._emitUiUpdate();
          if (this.lobby.started) this._enterGame();
          break;
        }

        case 'player_ready': {
          if (!this.isHost()) break;
          const pid = msg.playerId;
          this.playersReadyForGame[pid] = true;
          this._checkAllReady();
          break;
        }

        case 'prompt_locked': {
          const { playerId, name, text, order } = msg;
          const label = name || 'Player';
          Ui.addInstant(`[${label}] ${text}`, 'player');
          if (this.isHost() && this.gameActive) this._maybeRunHostTurn();
          this._emitUiUpdate();
          break;
        }

        case 'request_sync': {
          if (!this.isHost()) break;
          const targetId = msg.targetId;
          const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
          const state = JSON.parse(JSON.stringify(State));
          this._send('sync', { targetId, sync: { state, logHtml } });
          break;
        }

        case 'sync': {
          if (this.isClient()) this._applyHostSync(msg.sync);
          try { Ui.setInputLocked(false); } catch (_) {}
          this._emitUiUpdate();
          break;
        }

        case 'game_started': {
          if (this.isClient()) {
            this.gameActive = true;
            try { Ui.setInputLocked(false); } catch (_) {}
          }
          this._emitUiUpdate();
          break;
        }

        case 'system': {
          Ui.addInstant(`[ MP ] ${msg.text || ''}`.trim(), 'system');
          break;
        }

        case 'save_loaded': {
          if (this.isClient()) {
            this._applyHostSync(msg.sync);
            this.skipCharCreation = true;
            this.loadedSaveName = msg.sync.loadedSaveName;
            Ui.addInstant(`[ MP ] Host loaded save: ${this.loadedSaveName}`, 'system');
          }
          this._emitUiUpdate();
          break;
        }

        // --- AI request handling (host only) ---
        case 'req_locations': {
          if (!this.isHost()) return;
          const { requestId, playerName } = msg;
          try {
            const prompt = Prompts.getLocationPrompt(playerName);
            const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 300));
            let cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
            cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
            const locations = JSON.parse(cleaned);
            this._send('res_locations', { requestId, result: locations });
          } catch (err) {
            console.error('Host location fetch failed', err);
            this._send('res_locations', { requestId, error: err.message, result: ['Cinder Row', 'The Spire Gardens', 'Neon Bazaar', 'Floodgate District'] });
          }
          break;
        }

        case 'req_location_desc': {
          if (!this.isHost()) return;
          const { requestId, location, playerName } = msg;
          try {
            const descPrompt = Prompts.getLocationDescPrompt(location, playerName);
            const raw = await queueRequest(() => callProvider([{ role: 'user', content: descPrompt }], 100));
            const description = raw.trim().replace(/^["']|["']$/g, '');
            this._send('res_location_desc', { requestId, result: description });
          } catch (err) {
            console.error('Host location description failed', err);
            this._send('res_location_desc', { requestId, error: err.message, result: `The streets of ${location} where survival costs more than credits.` });
          }
          break;
        }

        case 'req_classes': {
          if (!this.isHost()) return;
          const { requestId } = msg;
          try {
            const classes = await Llm.getClasses();
            this._send('res_classes', { requestId, result: classes });
          } catch (err) {
            console.error('Host class generation failed', err);
            const isFantasy = localStorage.getItem('ct_theme') === 'fantasy';
            const fallback = isFantasy
              ? [
                  { name:'Knight', description:'A heavily armored warrior sworn to a fallen lord.', startHp:100, startCredits:80,
                    coreStats:{ str:16, agi:8, int:6, cha:10, tec:8, end:12 } },
                  { name:'Wizard', description:'A scholar of forbidden magic, wielding spells that can warp reality.', startHp:70, startCredits:120,
                    coreStats:{ str:4, agi:6, int:18, cha:12, tec:8, end:12 } },
                  { name:'Ranger', description:'A scout of the wilds, skilled with bow and survival.', startHp:85, startCredits:100,
                    coreStats:{ str:10, agi:14, int:8, cha:8, tec:8, end:12 } },
                  { name:'Cleric', description:'A priest of a forgotten deity, wielding divine magic to heal and smite.', startHp:90, startCredits:100,
                    coreStats:{ str:12, agi:6, int:10, cha:14, tec:6, end:12 } }
                ]
              : [
                  { name:'Chrome Surgeon', description:'A back-alley ripperdoc who learned to fight with scalpels and medical chrome.', startHp:85, startCredits:120,
                    coreStats:{ str:12, agi:8, int:12, cha:6, tec:14, end:10 } },
                  { name:'Data Ghoul', description:'A scavenger who hunts in abandoned server farms, consuming forgotten data.', startHp:75, startCredits:150,
                    coreStats:{ str:6, agi:12, int:16, cha:4, tec:14, end:8 } },
                  { name:'Glitch Dancer', description:'A street performer whose neural implants let them manipulate local systems with rhythm.', startHp:70, startCredits:100,
                    coreStats:{ str:6, agi:14, int:12, cha:12, tec:8, end:8 } },
                  { name:'Rust Prophet', description:'A cult leader who speaks to the machine spirits in derelict factories.', startHp:90, startCredits:80,
                    coreStats:{ str:14, agi:6, int:12, cha:12, tec:8, end:12 } }
                ];
            this._send('res_classes', { requestId, result: fallback });
          }
          break;
        }

        case 'req_backstory': {
          if (!this.isHost()) return;
          const { requestId, name, origin, locationDesc, playerClass } = msg;
          try {
            const prompt = Prompts.getBackstoryPrompt(name, origin, locationDesc, playerClass);
            const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 500));
            let cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/g, '').trim();
            cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
            const result = JSON.parse(cleaned);
            this._send('res_backstory', { requestId, result });
          } catch (err) {
            console.error('Host backstory generation failed', err);
            this._send('res_backstory', { requestId, error: err.message, result: { backstory: `You grew up hard in ${origin}. The streets didn't care about your name, only what you could do.`, npcs: [] } });
          }
          break;
        }

        case 'req_tragedy': {
          if (!this.isHost()) return;
          const { requestId, playerName, tragedy, origin, backstory, npcs } = msg;
          try {
            const prompt = Prompts.getTragedyPrompt(playerName, tragedy, origin, backstory, npcs);
            const raw = await queueRequest(() => callProvider([{ role: 'user', content: prompt }], 350));
            let cleaned = raw.replace(/^```json\s*\n?/i, '').replace(/\n?```$/g, '').trim();
            cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
            if (cleaned.includes('```')) cleaned = cleaned.replace(/```json\s*/i, '').replace(/```/g, '').trim();
            const result = JSON.parse(cleaned);
            this._send('res_tragedy', { requestId, result });
          } catch (err) {
            console.error('Host tragedy generation failed', err);
            this._send('res_tragedy', { requestId, error: err.message, result: { story: tragedy.desc, npcUpdates: [] } });
          }
          break;
        }

        case 'res_locations':
        case 'res_location_desc':
        case 'res_classes':
        case 'res_backstory':
        case 'res_tragedy': {
          if (this.isClient()) this._handleResponse(msg);
          break;
        }

        // Combat messages (already handled in combat.js)
        case 'combat_start':
        case 'combat_sync':
        case 'combat_action':
        case 'combat_end':
          CombatEngine.handleMultiplayerMessage(msg);
          break;
      }
    },

    // Called by clients after character creation is complete
    readyForGame() {
      if (!this.enabled || this.isHost()) return;
      this._send('player_ready', {});
    },

    // Host calls this after finishing its own character creation
    _markSelfReady() {
      if (!this.isHost()) return;
      this.playersReadyForGame[this.playerId] = true;
      this._checkAllReady();
    },

    _checkAllReady() {
      if (!this.isHost()) return;
      if (this.combinedStartDone) return;

      const allPlayers = this.players.map(p => p.id);
      const allReady = allPlayers.every(id => this.playersReadyForGame[id]);
      if (allReady && allPlayers.length > 0) {
        this._runCombinedStart();
      }
    },

    async _runCombinedStart() {
      if (!this.isHost()) return;
      if (this.combinedStartDone) return;
      this._broadcastSelfSnapshot();
      this._emitUiUpdate();
      this.combinedStartDone = true;
      this.gameActive = true;

      if (this.skipCharCreation && this.loadedSaveName) {
        const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
        const state = JSON.parse(JSON.stringify(State));
        this._send('sync_broadcast', { sync: { state, logHtml } });
        this._send('game_started', {});
        this._send('system', { text: `Game started with loaded save: ${this.loadedSaveName}` });
        return;
      }

      const isFantasy = localStorage.getItem('ct_theme') === 'fantasy';
      const setting = isFantasy ? 'fantasy realm' : 'cyberpunk city';

      const playersData = this.players.map(p => {
        const snap = p.snapshot || {};
        return {
          name: p.name,
          class: snap.playerClass || '???',
          backstory: snap.backstory || '',
          origin: snap.origin || 'Unknown',
          traits: (snap.traits || []).map(t => t.name || t).join(', ') || 'none',
          stats: snap.stats || {},
        };
      });

      const charLines = playersData.map(p =>
        `NAME: ${p.name} (${p.class})\nORIGIN: ${p.origin}\nBACKSTORY: ${p.backstory}\nTRAITS: ${p.traits}`
      ).join('\n\n---\n\n');

      const prompt = `MULTIPLAYER CAMPAIGN START — ${playersData.length} CHARACTERS CONVERGE

Setting: ${setting}

Characters:
${charLines}

You are a master storyteller. Write an opening scene (5-8 sentences) for this campaign.
Rules:
- Begin in separate moments — each character in their own world, feeling a pull, a rumor, a restlessness they cannot name
- Weave their individual voices and backgrounds into the prose without announcing who is who too bluntly
- Let their paths converge naturally toward a single shared location by the end
- The tone should feel like the first page of a novel — atmospheric, grounded, with a quiet sense of fate
- Do NOT say "your party gathers" or any game-like phrasing

Then return a shared opening location and a quest hook fitting all their backstories.

Return JSON only:
{
  "narration": "...",
  "newLocation": "...",
  "quests": [{"title": "...", "description": "...", "status": "active"}],
  "hpDelta": 0,
  "creditsDelta": 0,
  "addItems": []
}`;

      Ui.setInputLocked(true);
      try {
        const resp = await Llm.send(prompt, 'MULTIPLAYER_START=true');
        Engine.applyResponse(resp);

        if (resp.quests) {
          resp.quests.forEach(q => {
            if (!State.quests.find(ex => ex.title === q.title)) State.quests.push(q);
          });
        }
        if (resp.newLocation) State.location = resp.newLocation;

        Ui.updateHeader();
        Ui.renderSidebar();

        if (resp.narration) Ui.enqueue(resp.narration, 'narrator');

        const doSync = () => {
          const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
          const state = JSON.parse(JSON.stringify(State));
          this._send('sync_broadcast', { sync: { state, logHtml } });
          this._send('game_started', {});
          Ui.setInputLocked(false);
        };

        if (window.waitForTyping) {
          setTimeout(() => waitForTyping(doSync), 300);
        } else {
          setTimeout(doSync, 4000);
        }
      } catch (err) {
        console.error('Combined start failed', err);
        Ui.addInstant('[ MP ] Combined start failed. Starting normally.', 'system');
        const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
        const state = JSON.parse(JSON.stringify(State));
        this._send('sync_broadcast', { sync: { state, logHtml } });
        this._send('game_started', {});
        Ui.setInputLocked(false);
      }
    },

    // Host-only save/load methods
    saveGame(name) {
      if (!this.enabled) return false;
      if (!this.isHost()) {
        Ui.addInstant('[ MP ] Only host can save.', 'system');
        return false;
      }
      const ok = SaveLoad.save(name);
      if (ok) {
        this._send('system', { text: `Game saved as "${name}"` });
      } else {
        this._send('system', { text: `Failed to save "${name}"` });
      }
      return ok;
    },

    loadSave(name) {
      if (!this.isHost()) {
        Ui.addInstant('[ MP ] Only host can load saves.', 'system');
        return false;
      }
      const ok = SaveLoad.load(name);
      if (ok) {
        this.skipCharCreation = true;
        this.loadedSaveName = name;
        const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
        const state = JSON.parse(JSON.stringify(State));
        this._send('save_loaded', {
          sync: { state, logHtml, skipCharCreation: true, loadedSaveName: name }
        });
        this._send('system', { text: `Loaded save: ${name}` });
        if (window.Multiplayer && window.Multiplayer.enabled) {
          window.Multiplayer._emitUiUpdate();
        }
        return true;
      } else {
        this._send('system', { text: `Failed to load save: ${name}` });
        return false;
      }
    },

    startWithLoadedSave() {
      if (!this.isHost()) return;
      if (!this.skipCharCreation || !this.loadedSaveName) {
        Ui.addInstant('[ MP ] No loaded save found.', 'system');
        return;
      }
      this.combinedStartDone = true;
      this.gameActive = true;
      const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
      const state = JSON.parse(JSON.stringify(State));
      this._send('sync_broadcast', { sync: { state, logHtml } });
      this._send('game_started', {});
      this._send('system', { text: `Game started with loaded save: ${this.loadedSaveName}` });
    },

    setDraft(text) {
      if (!this.enabled) return;
      const t = String(text || '').slice(0, 800);
      this._send('prompt_draft', { text: t });
    },

    lockIn(text) {
      if (!this.enabled) return false;
      if (!this.gameActive) {
        Ui.addInstant('[ MP ] Wait for game to start...', 'system');
        return false;
      }
      const t = String(text || '').trim();
      if (!t) return false;
      this._send('lock_in', { text: t.slice(0, 1200) });
      return true;
    },

    readyUp(ready) {
      if (!this.enabled) return;
      this._send('ready', { ready: !!ready });
    },

    startMatch() {
      if (!this.enabled || !this.isHost()) return;
      this._send('start_game', {});
    },

    _enterGame() {
      if (this.__enteredGame) return;
      this.__enteredGame = true;
      try { window.MultiplayerUI?.close?.(); } catch (_) {}

      if (this.skipCharCreation && this.loadedSaveName) {
        Ui.showScreen('gameScreen');
        Ui.updateHeader();
        Ui.renderSidebar();
        Ui.setInputLocked(false);
        return;
      }
      Ui.showScreen('charCreateScreen');
    },

    async _maybeRunHostTurn() {
      if (!this.isHost()) return;
      if (!this.lobby.started) return;
      if (!this.gameActive) return;
      const players = this.players || [];
      if (!players.length) return;
      const locked = players.filter(p => p.promptLocked);
      if (locked.length !== players.length) return;

      const ordered = [...locked].sort((a, b) => (a.lockOrder ?? 999) - (b.lockOrder ?? 999));
      const combined = ordered.map((p, idx) => {
        const nm = p.name || `P${idx + 1}`;
        const tx = (p.promptText || '').trim();
        return `${nm}: ${tx}`;
      }).join('\n');

      if (!combined.trim()) return;

      Ui.setInputLocked(true);
      try {
        const resp = await Llm.send(`[MULTIPLAYER TURN]\n${combined}`);
        Engine.applyResponse(resp);
        advanceTime();
        if (resp?.narration) Ui.enqueue(resp.narration, 'narrator');
      } catch (e) {
        console.error('[MP] host turn error', e);
        Ui.addInstant('[ MP TURN FAILED ]', 'system');
      } finally {
        const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
        const state = JSON.parse(JSON.stringify(State));
        this._send('sync_broadcast', { sync: { state, logHtml } });
        Ui.setInputLocked(false);
        Ui.updateHeader();
        Ui.renderSidebar();
      }
    },
  };

  // UI helper (unchanged)
  const MultiplayerUI = {
    open() { document.getElementById('mpOverlay')?.classList.add('open'); },
    close() { document.getElementById('mpOverlay')?.classList.remove('open'); },

    renderPartyTab() {
      const panel = document.getElementById('tab-party');
      if (!panel) return;

      if (!MP.enabled) {
        panel.innerHTML = '<div class="panel-empty">[ NOT IN MULTIPLAYER ]</div>';
        return;
      }

      const you = MP.playerId;
      const others = (MP.players || []).filter(p => p.id !== you);

      if (!others.length) {
        panel.innerHTML = '<div class="panel-empty">[ WAITING FOR OTHERS ]</div>';
        return;
      }

      const relColor = { Friendly: 'var(--green)', Ally: 'var(--green)', Hostile: 'var(--red)', Suspicious: 'var(--yellow)', Neutral: 'var(--text-lo)', Dead: 'var(--text-lo)' };

      panel.innerHTML = others.map(p => {
        const snap = p.snapshot || {};
        const stats = snap.stats || {};
        const npcs = (snap.npcs || []).slice(0, 6);
        const skills = (snap.skills || []).slice(0, 6);
        const hp = snap.hp ?? '?';
        const maxHp = snap.maxHp ?? '?';
        const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
        const hpBarColor = hpPct > 60 ? 'var(--green)' : hpPct > 25 ? 'var(--yellow)' : 'var(--red)';
        const statKeys = ['str', 'agi', 'int', 'cha', 'tec', 'end'];

        return `
          <div class="inv-item" style="cursor:default;margin-bottom:12px;padding:10px 12px;">
            <div class="iname" style="font-size:13px;margin-bottom:6px;">
              ${p.name}
              <span class="iamt">${snap.playerClass || '???'} · LV ${snap.level || 1}</span>
            </div>

            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="color:var(--text-lo);font-size:9px;width:12px;">HP</span>
              <div style="flex:1;height:3px;background:var(--border);">
                <div style="width:${hpPct}%;height:100%;background:${hpBarColor};transition:width .3s;"></div>
              </div>
              <span style="color:var(--text-dim);font-size:9px;">${hp}/${maxHp}</span>
            </div>

            ${Object.keys(stats).length ? `
            <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;">
              ${statKeys.map(k => `<span style="font-size:9px;color:var(--text-lo);border:1px solid var(--border);padding:1px 5px;">${k.toUpperCase()} <span style="color:var(--text-dim);">${stats[k] ?? 0}</span></span>`).join('')}
            </div>` : ''}

            ${npcs.length ? `
            <div style="margin-bottom:5px;">
              <div style="font-size:9px;color:var(--text-lo);letter-spacing:1px;margin-bottom:3px;">CONTACTS</div>
              ${npcs.map(n => `<div style="font-size:10px;color:var(--text-dim);padding:1px 0;">▸ ${n.name} <span style="color:${relColor[n.relationship] || 'var(--text-lo)'}">[${n.relationship}]</span></div>`).join('')}
            </div>` : ''}

            ${skills.length ? `
            <div style="margin-bottom:5px;">
              <div style="font-size:9px;color:var(--text-lo);letter-spacing:1px;margin-bottom:3px;">SKILLS</div>
              <div style="display:flex;flex-wrap:wrap;gap:3px;">
                ${skills.map(s => `<span style="font-size:9px;color:var(--text-dim);border:1px solid var(--border);padding:1px 6px;">${s.name}</span>`).join('')}
              </div>
            </div>` : ''}

            <div style="font-size:9px;color:var(--text-lo);margin-top:4px;">
              CR: <span style="color:var(--text-dim);">${snap.credits ?? '?'}</span>
              &nbsp;·&nbsp; LOC: <span style="color:var(--text-dim);">${snap.location || '?'}</span>
            </div>
          </div>
        `;
      }).join('');
    },

    showLoadSaveModal() {
      if (!MP.isHost()) return;
      const slots = SaveLoad.slots();
      if (!slots.length) {
        MP._setStatus('No saves found.', 'err');
        return;
      }

      const modal = document.getElementById('modalOverlay');
      const modalTitle = document.getElementById('modalTitle');
      const modalSlots = document.getElementById('modalSlots');
      const modalInputArea = document.getElementById('saveInputArea');
      const modalMsg = document.getElementById('modalMsg');
      const modalClose = document.getElementById('modalClose');

      if (!modal) return;

      modalTitle.textContent = '// LOAD MULTIPLAYER SAVE //';
      if (modalInputArea) modalInputArea.style.display = 'none';
      if (modalMsg) modalMsg.textContent = '';

      modalSlots.innerHTML = slots.map(s => `
        <div class="save-slot">
          <div class="save-slot-info">
            <div class="save-slot-name">${s.name}</div>
            <div class="save-slot-meta">${s.gameTime} &nbsp;|&nbsp; ${new Date(s.savedAt).toLocaleDateString()}</div>
          </div>
          <button class="slot-btn" data-action="load" data-name="${s.name}">LOAD</button>
        </div>
      `).join('');

      modalSlots.querySelectorAll('.slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          const ok = MP.loadSave(name);
          if (ok) {
            modal.classList.remove('open');
            MP._emitUiUpdate();
          } else {
            if (modalMsg) { modalMsg.textContent = 'LOAD FAILED'; modalMsg.className = 'modal-msg err'; }
          }
        });
      });

      modal.classList.add('open');
      const closeHandler = () => modal.classList.remove('open');
      modalClose?.removeEventListener('click', closeHandler);
      modalClose?.addEventListener('click', closeHandler);
    },

    render() {
      const panel = document.getElementById('tab-mp');
      if (!panel) return;

      if (!MP.enabled) {
        panel.innerHTML = `
          <div class="panel-empty">[ MULTIPLAYER OFF ]</div>
          <button class="mp-btn mp-primary" id="mpOpenFromTab" style="width:100%">OPEN MULTI MENU</button>
        `;
        panel.querySelector('#mpOpenFromTab')?.addEventListener('click', () => MultiplayerUI.open());
        return;
      }

      const role = MP.role.toUpperCase();
      const room = MP.room || '—';
      const you = MP.playerId;

      const rows = (MP.players || []).map(p => {
        const isYou = p.id === you;
        const lock = p.promptLocked ? `LOCKED #${p.lockOrder + 1}` : '…';
        const prompt = p.promptText ? p.promptText : (p.promptDraft || '');
        const stats = p.snapshot ? `HP ${p.snapshot.hp}/${p.snapshot.maxHp} · CR ${p.snapshot.credits} · LV ${p.snapshot.level}` : '—';
        const ready = p.ready ? 'READY' : 'NOT READY';
        const readyForGame = MP.playersReadyForGame[p.id] ? '✓' : '⚙';
        return `
          <div class="inv-item" style="cursor:default">
            <div class="iname">${isYou ? '★ ' : ''}${p.name || 'Player'} <span class="iamt">${ready} · ${lock} · ${readyForGame}</span></div>
            <div class="idesc">${stats}</div>
            <div class="idesc" style="margin-top:6px;opacity:.9">${prompt ? prompt : '[ no prompt ]'}</div>
          </div>
        `;
      }).join('');

      const youObj = (MP.players || []).find(p => p.id === you);
      const youReady = !!youObj?.ready;
      const started = !!MP.lobby.started;
      const gameActive = MP.gameActive;
      const loadedSave = MP.loadedSaveName ? `Loaded: ${MP.loadedSaveName}` : 'No save loaded';

      panel.innerHTML = `
        <div class="loc-badge">ROOM: <span>${room}</span> · ROLE: <span>${role}</span> · ${started ? (gameActive ? 'GAME ACTIVE' : 'CHARACTER CREATION') : 'LOBBY'}</div>
        ${MP.isHost() && !started ? `<div class="loc-badge" style="background:var(--green-lo);">${loadedSave}</div>` : ''}
        <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
          <button class="mp-btn ${youReady ? '' : 'mp-primary'}" id="mpReadyBtn" style="flex:1" ${started ? 'disabled' : ''}>${youReady ? 'UNREADY' : 'READY UP'}</button>
          ${MP.isHost() && !started ? `<button class="mp-btn" id="mpLoadSaveBtn" style="flex:1">📂 LOAD SAVE</button>` : ''}
          ${MP.isHost() ? `<button class="mp-btn mp-primary" id="mpStartBtn" style="flex:1" ${started ? 'disabled' : ''}>START</button>` : ''}
        </div>
        ${rows || '<div class="panel-empty">[ NO PLAYERS ]</div>'}
      `;

      panel.querySelector('#mpReadyBtn')?.addEventListener('click', () => MP.readyUp(!youReady));
      panel.querySelector('#mpLoadSaveBtn')?.addEventListener('click', () => MultiplayerUI.showLoadSaveModal());
      panel.querySelector('#mpStartBtn')?.addEventListener('click', () => MP.startMatch());
    },

    renderOverlay() {
      const box = document.getElementById('mpLobbyControls');
      if (!box) return;
      if (!MP.enabled) { box.style.display = 'none'; box.innerHTML = ''; return; }

      const you = MP.playerId;
      const youObj = (MP.players || []).find(p => p.id === you);
      const youReady = !!youObj?.ready;
      const started = !!MP.lobby.started;
      const allReady = (MP.players || []).length > 0 && (MP.players || []).every(p => p.ready);

      box.style.display = '';
      box.innerHTML = `
        <div style="display:flex; gap:8px; margin-top:6px;">
          <button class="mp-btn ${youReady ? '' : 'mp-primary'}" id="mpOverlayReadyBtn" style="flex:1" ${started ? 'disabled' : ''}>${youReady ? 'UNREADY' : 'READY UP'}</button>
          ${MP.isHost() && !started ? `<button class="mp-btn" id="mpOverlayLoadSaveBtn" style="flex:1">LOAD SAVE</button>` : ''}
          ${MP.isHost() ? `<button class="mp-btn mp-primary" id="mpOverlayStartBtn" style="flex:1" ${(!allReady || started) ? 'disabled' : ''}>START</button>` : ''}
        </div>
        <div class="mp-status" style="margin-top:8px; min-height:auto">
          ${started ? 'GAME STARTING – ' + (MP.skipCharCreation ? 'LOADED SAVE' : 'CHARACTER CREATION') : (allReady ? 'ALL READY — HOST CAN START.' : 'WAITING FOR READY…')}
          ${MP.loadedSaveName ? ` (Loaded: ${MP.loadedSaveName})` : ''}
        </div>
      `;

      box.querySelector('#mpOverlayReadyBtn')?.addEventListener('click', () => MP.readyUp(!youReady));
      box.querySelector('#mpOverlayLoadSaveBtn')?.addEventListener('click', () => MultiplayerUI.showLoadSaveModal());
      box.querySelector('#mpOverlayStartBtn')?.addEventListener('click', () => MP.startMatch());
    }
  };

  window.Multiplayer = MP;
  window.MultiplayerUI = MultiplayerUI;

  document.addEventListener('DOMContentLoaded', () => {
    MP._applyAccessGates();
    document.getElementById('menuMultiplayerBtn')?.addEventListener('click', () => MultiplayerUI.open());
    document.getElementById('mpCloseBtn')?.addEventListener('click', () => MultiplayerUI.close());

    const leaveBtn = document.getElementById('mpLeaveBtn');
    leaveBtn?.addEventListener('click', () => {
      MP.leave();
      leaveBtn.style.display = 'none';
      MultiplayerUI.open();
      MP._setStatus('LEFT ROOM.', 'info');
    });

    const setRoomCode = (code) => {
      const el = document.getElementById('mpRoomCode');
      if (el) el.textContent = code || '—';
    };

    document.getElementById('mpHostBtn')?.addEventListener('click', async () => {
      const name = document.getElementById('mpName')?.value || '';
      const room = MP._genRoomCode();
      setRoomCode(room);
      try {
        MP.__enteredGame = false;
        await MP.hostStart(room, name);
        leaveBtn.style.display = '';
      } catch (e) {
        console.error(e);
        MP._setStatus('FAILED TO CONNECT. Start relay server first.', 'err');
      }
    });

    document.getElementById('mpJoinBtn')?.addEventListener('click', async () => {
      const name = document.getElementById('mpName')?.value || '';
      const room = (document.getElementById('mpJoinCode')?.value || '').trim().toUpperCase();
      if (!room) { MP._setStatus('ENTER A ROOM CODE.', 'err'); return; }
      setRoomCode('—');
      try {
        MP.__enteredGame = false;
        await MP.join(room, name);
        leaveBtn.style.display = '';
      } catch (e) {
        console.error(e);
        MP._setStatus('FAILED TO CONNECT. Is the relay server running?', 'err');
      }
    });
  });
})();