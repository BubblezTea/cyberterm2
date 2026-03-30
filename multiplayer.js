// multiplayer.js - lightweight 1-4p relay multiplayer (host authoritative)

(() => {
  const MP = {
    enabled: false,
    role: 'solo', // 'host' | 'client' | 'solo'
    room: null,
    playerId: null,
    ws: null,
    lobby: {
      started: false,
    },
    players: [], // { id, name, stats, promptDraft, promptLocked, lockOrder }
    lockState: {
      lockedIds: [],
      lockOrder: [],
      prompts: {}, // id -> { text, ts, order }
    },

    isHost() { return this.enabled && this.role === 'host'; },
    isClient() { return this.enabled && this.role === 'client'; },

    _emitUiUpdate() {
      try { window.MultiplayerUI?.render?.(); } catch (_) {}
      try { this._applyAccessGates(); } catch (_) {}
      try { window.MultiplayerUI?.renderOverlay?.(); } catch (_) {}
    },

    _applyAccessGates() {
      // Host-only: dev console + skill forge/edit is handled in Ui/SkillBuilder; console button needs gating here.
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
      };
      this._send('player_snapshot', { snapshot });
    },

    _applyHostSync(sync) {
      if (!sync) return;
      if (sync.state) {
        try {
          // Replace State shallowly
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
            // stay in enabled mode so UI shows disconnected state
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

    _handle(msg) {
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

        case 'prompt_locked': {
          // Show in log for everyone, in the order it arrives
          const { playerId, name, text, order } = msg;
          const label = name || 'Player';
          Ui.addInstant(`[${label}] ${text}`, 'player');
          // Host: when everybody locked, trigger AI with ordered prompts
          if (this.isHost()) this._maybeRunHostTurn();
          this._emitUiUpdate();
          break;
        }

        case 'request_sync': {
          // Server asks host to sync to a joiner
          if (!this.isHost()) break;
          const targetId = msg.targetId;
          const logHtml = document.getElementById('narrativeLog')?.innerHTML || '';
          const state = JSON.parse(JSON.stringify(State));
          this._send('sync', { targetId, sync: { state, logHtml } });
          break;
        }

        case 'sync': {
          // Client receives authoritative state/log
          if (this.isClient()) this._applyHostSync(msg.sync);
          // Both roles should unlock after a sync broadcast (next turn ready)
          try { Ui.setInputLocked(false); } catch (_) {}
          this._emitUiUpdate();
          break;
        }

        case 'system': {
          Ui.addInstant(`[ MP ] ${msg.text || ''}`.trim(), 'system');
          break;
        }
      }
    },

    setDraft(text) {
      if (!this.enabled) return;
      const t = String(text || '').slice(0, 800);
      this._send('prompt_draft', { text: t });
    },

    lockIn(text) {
      if (!this.enabled) return false;
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
      // Throw everyone into the game flow (character creation first)
      try { Ui.showScreen('charCreateScreen'); } catch (_) {}
    },

    async _maybeRunHostTurn() {
      if (!this.isHost()) return;
      if (!this.lobby.started) return;
      // Need everyone connected to be locked to run a turn
      const players = this.players || [];
      if (!players.length) return;
      const locked = players.filter(p => p.promptLocked);
      if (locked.length !== players.length) return;

      // Build ordered prompt list
      const ordered = [...locked].sort((a, b) => (a.lockOrder ?? 999) - (b.lockOrder ?? 999));
      const combined = ordered.map((p, idx) => {
        const nm = p.name || `P${idx + 1}`;
        const tx = (p.promptText || '').trim();
        return `${nm}: ${tx}`;
      }).join('\n');

      if (!combined.trim()) return;

      // Run as a single "combined" player action through normal pipeline, but without echoing again.
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
        // After host updates, broadcast authoritative state + log
        this._send('sync_broadcast', { sync: { state, logHtml } });

        Ui.setInputLocked(false);
        Ui.updateHeader();
        Ui.renderSidebar();
      }
    },
  };

  // Minimal UI helper
  const MultiplayerUI = {
    open() { document.getElementById('mpOverlay')?.classList.add('open'); },
    close() { document.getElementById('mpOverlay')?.classList.remove('open'); },

    render() {
      // MP tab: players list
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
        return `
          <div class="inv-item" style="cursor:default">
            <div class="iname">${isYou ? '★ ' : ''}${p.name || 'Player'} <span class="iamt">${ready} · ${lock}</span></div>
            <div class="idesc">${stats}</div>
            <div class="idesc" style="margin-top:6px;opacity:.9">${prompt ? prompt : '[ no prompt ]'}</div>
          </div>
        `;
      }).join('');

      const youObj = (MP.players || []).find(p => p.id === you);
      const youReady = !!youObj?.ready;
      const started = !!MP.lobby.started;

      panel.innerHTML = `
        <div class="loc-badge">ROOM: <span>${room}</span> · ROLE: <span>${role}</span> · <span>${started ? 'STARTED' : 'LOBBY'}</span></div>
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button class="mp-btn ${youReady ? '' : 'mp-primary'}" id="mpReadyBtn" style="flex:1">${youReady ? 'UNREADY' : 'READY UP'}</button>
          ${MP.isHost() ? `<button class="mp-btn mp-primary" id="mpStartBtn" style="flex:1" ${started ? 'disabled' : ''}>START</button>` : ''}
        </div>
        ${rows || '<div class="panel-empty">[ NO PLAYERS ]</div>'}
      `;

      panel.querySelector('#mpReadyBtn')?.addEventListener('click', () => MP.readyUp(!youReady));
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
          ${MP.isHost() ? `<button class="mp-btn mp-primary" id="mpOverlayStartBtn" style="flex:1" ${(!allReady || started) ? 'disabled' : ''}>START</button>` : ''}
        </div>
        <div class="mp-status" style="margin-top:8px; min-height:auto">
          ${started ? 'MATCH STARTED.' : (allReady ? 'ALL READY — HOST CAN START.' : 'WAITING FOR READY…')}
        </div>
      `;

      box.querySelector('#mpOverlayReadyBtn')?.addEventListener('click', () => MP.readyUp(!youReady));
      box.querySelector('#mpOverlayStartBtn')?.addEventListener('click', () => MP.startMatch());
    }
  };

  window.Multiplayer = MP;
  window.MultiplayerUI = MultiplayerUI;

  document.addEventListener('DOMContentLoaded', () => {
    MP._applyAccessGates();
    // main menu button
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

