// statusEffectBuilder.js
const StatusEffectBuilder = (() => {
  let isOpen = false;
  let editingId = null;
  let onSaveCallback = null;
  let currentEffect = {
    name: '',
    description: '',
    icon: '✨',
    duration: 2,
    mode: 'simple',
    type: 'dot',
    value: 5,
    damageType: 'physical',
    effects: []
  };

  const icons = ['✨','🔥','❄','⚡','🌿','💀','🛡','🔮','⚔','🌀','🩸','🌟','🌑','⚙','🍃','🌊'];

  const typeInfo = {
    dot: { label: 'DAMAGE OVER TIME', hint: 'Deals X damage per turn.' },
    skip: { label: 'STUN', hint: 'Target cannot act for duration.' },
    expose: { label: 'EXPOSE', hint: 'Target takes X% extra damage.' },
    debuff: { label: 'DEBUFF AGI', hint: 'Reduces target AGI by X.' },
    buff: { label: 'RESTORE ENERGY', hint: 'Restores X energy to self.' },
    buff_hp: { label: 'HEAL HP', hint: 'Restores X HP to self.' }
  };

  const actionTypes = [
    { v: 'damage', l: 'DAMAGE' },
    { v: 'heal', l: 'HEAL' },
    { v: 'skip_turn', l: 'STUN' },
    { v: 'stat_mod', l: 'STAT MOD' },
    { v: 'change_team', l: 'CHANGE TEAM' },
    { v: 'extra_turn', l: 'EXTRA TURN' },
    { v: 'reflect_damage', l: 'REFLECT' },
    { v: 'immune', l: 'IMMUNE' },
    { v: 'wait', l: 'WAIT' }
  ];

  function open(effectId, callback) {
    console.log('[StatusEffectBuilder] open called');
    if (isOpen) return;
    isOpen = true;
    onSaveCallback = callback || null;
    editingId = effectId || null;
    if (editingId && State.statusEffectLibrary) {
      const found = State.statusEffectLibrary.find(e => e.id === editingId);
      if (found) loadEffect(found);
    } else {
      resetEffect();
    }
    injectUI();
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKey);
    const ov = document.getElementById('sebOverlay');
    if (ov) ov.remove();
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function resetEffect() {
    currentEffect = {
      name: '',
      description: '',
      icon: '✨',
      duration: 2,
      mode: 'simple',
      type: 'dot',
      value: 5,
      damageType: 'physical',
      effects: []
    };
  }

  function loadEffect(eff) {
    currentEffect = {
      name: eff.name,
      description: eff.description || '',
      icon: eff.icon || '✨',
      duration: eff.duration,
      mode: eff.effects ? 'advanced' : 'simple',
      type: eff.type || 'dot',
      value: eff.value || 5,
      damageType: eff.damageType || 'physical',
      effects: eff.effects ? [...eff.effects] : []
    };
  }

  function buildEffect() {
    const id = editingId || ('seb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8));
    const base = {
      id,
      name: currentEffect.name.trim(),
      description: currentEffect.description.trim(),
      icon: currentEffect.icon,
      duration: currentEffect.duration
    };
    if (currentEffect.mode === 'advanced') {
      return { ...base, effects: currentEffect.effects };
    } else {
      const obj = { ...base, type: currentEffect.type, value: currentEffect.value };
      if (currentEffect.type === 'dot') obj.damageType = currentEffect.damageType;
      return obj;
    }
  }

  function save() {
    const name = currentEffect.name.trim();
    if (!name) { showError('NAME REQUIRED'); return; }
    if (name.length < 2) { showError('NAME TOO SHORT'); return; }
    if (currentEffect.mode === 'advanced' && currentEffect.effects.length === 0) {
      showError('ADD AT LEAST ONE ACTION');
      return;
    }

    const effect = buildEffect();
    if (!State.statusEffectLibrary) State.statusEffectLibrary = [];
    const idx = State.statusEffectLibrary.findIndex(e => e.id === effect.id);
    if (idx !== -1) State.statusEffectLibrary[idx] = effect;
    else State.statusEffectLibrary.push(effect);

    if (onSaveCallback) onSaveCallback(effect);
    close();
  }

  function showError(msg) {
    const el = document.getElementById('sebValid');
    if (el) { el.textContent = '⚠ ' + msg; el.className = 'seb-valid-line err'; }
    setTimeout(() => { if (el) el.textContent = ''; }, 2000);
  }

  function renderLibrary() {
    const container = document.getElementById('sebLibrary');
    if (!container) return;
    const lib = State.statusEffectLibrary || [];
    if (!lib.length) {
      container.innerHTML = '<div class="seb-lib-empty">[ LIBRARY EMPTY ]</div>';
      return;
    }
    container.innerHTML = lib.map(e => `
      <div class="seb-lib-item" data-id="${e.id}">
        <span class="seb-lib-icon">${e.icon}</span>
        <div class="seb-lib-info">
          <div class="seb-lib-name">${e.name}</div>
          <div class="seb-lib-meta">${e.duration}T · ${e.effects ? 'ADVANCED' : (e.type||'').toUpperCase()}</div>
        </div>
        <div class="seb-lib-btns">
          <button class="seb-lib-edit">EDIT</button>
          <button class="seb-lib-del">✕</button>
        </div>
      </div>`).join('');
    container.querySelectorAll('.seb-lib-item').forEach(item => {
      const id = item.dataset.id;
      item.querySelector('.seb-lib-edit')?.addEventListener('click', () => {
        close();
        setTimeout(() => open(id, onSaveCallback), 100);
      });
      item.querySelector('.seb-lib-del')?.addEventListener('click', () => {
        State.statusEffectLibrary = State.statusEffectLibrary.filter(e => e.id !== id);
        renderLibrary();
        if (typeof SkillBuilder !== 'undefined') SkillBuilder.refreshLibraryPicker?.();
      });
    });
  }

  function renderActions() {
    const container = document.getElementById('sebActList');
    if (!container) return;
    if (!currentEffect.effects.length) {
      container.innerHTML = '<div class="seb-act-empty">No actions. Click + ADD ACTION</div>';
      return;
    }
    container.innerHTML = currentEffect.effects.map((act, idx) => `
      <div class="seb-act-block" data-idx="${idx}">
        <div class="seb-act-header">
          <select class="seb-act-type">
            ${actionTypes.map(at => `<option value="${at.v}" ${act.type===at.v?'selected':''}>${at.l}</option>`).join('')}
          </select>
          <input type="number" class="seb-act-delay" value="${act.delay||0}" placeholder="delay">
          <select class="seb-act-target">
            <option value="enemy" ${act.target==='enemy'?'selected':''}>Enemy</option>
            <option value="self" ${act.target==='self'?'selected':''}>Self</option>
            <option value="ally" ${act.target==='ally'?'selected':''}>Ally</option>
          </select>
          <button class="seb-act-del">✕</button>
        </div>
        ${renderActionParams(act, idx)}
      </div>`).join('');
    wireActions();
  }

  function renderActionParams(act, idx) {
    switch (act.type) {
      case 'damage':
      case 'heal':
        return `<div class="seb-act-params"><label>Value</label><input class="seb-act-param param-value" type="number" value="${act.value||0}"></div>`;
      case 'skip_turn':
        return `<div class="seb-act-params"><label>Duration</label><input class="seb-act-param param-duration" type="number" value="${act.duration||1}"></div>`;
      case 'stat_mod':
        return `<div class="seb-act-params">
          <label>Stat</label><select class="seb-act-param param-stat">${['str','agi','int','cha','tec','end'].map(s=>`<option value="${s}" ${act.stat===s?'selected':''}>${s.toUpperCase()}</option>`).join('')}</select>
          <label>Δ</label><input class="seb-act-param param-delta" type="number" value="${act.delta||0}">
          <label>Duration</label><input class="seb-act-param param-duration" type="number" value="${act.duration||1}">
        </div>`;
      case 'change_team':
        return `<div class="seb-act-params"><label>New team</label><select class="seb-act-param param-team"><option value="ally" ${act.newTeam==='ally'?'selected':''}>Ally</option><option value="enemy" ${act.newTeam==='enemy'?'selected':''}>Enemy</option></select></div>`;
      case 'extra_turn':
        return `<div class="seb-act-params"><em>Grants extra turn to target</em></div>`;
      case 'reflect_damage':
        return `<div class="seb-act-params"><label>Reflect %</label><input class="seb-act-param param-percent" type="number" value="${act.percent||20}"><label>Duration</label><input class="seb-act-param param-duration" type="number" value="${act.duration||1}"></div>`;
      case 'immune':
        return `<div class="seb-act-params"><label>Damage type</label><input class="seb-act-param param-dtype" value="${act.damageType||'physical'}"><label>Duration</label><input class="seb-act-param param-duration" type="number" value="${act.duration||1}"></div>`;
      case 'wait':
        return `<div class="seb-act-params"><em>Waits for specified delay</em></div>`;
      default:
        return '';
    }
  }

  function wireActions() {
    const c = document.getElementById('sebActList');
    if (!c) return;
    // Type change
    c.querySelectorAll('.seb-act-type').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.closest('.seb-act-block').dataset.idx);
        const newType = sel.value;
        const old = currentEffect.effects[idx];
        currentEffect.effects[idx] = { type: newType, delay: old.delay || 0, target: old.target || 'enemy' };
        renderActions();
        updatePreview();
      });
    });
    // Delete
    c.querySelectorAll('.seb-act-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.closest('.seb-act-block').dataset.idx);
        currentEffect.effects.splice(idx, 1);
        renderActions();
        updatePreview();
      });
    });
    // Delay and target
    c.querySelectorAll('.seb-act-delay, .seb-act-target').forEach(el => {
      el.addEventListener('change', () => {
        const idx = parseInt(el.closest('.seb-act-block').dataset.idx);
        const block = currentEffect.effects[idx];
        if (el.classList.contains('seb-act-delay')) block.delay = parseInt(el.value) || 0;
        if (el.classList.contains('seb-act-target')) block.target = el.value;
        updatePreview();
      });
    });
    // Param inputs (value, stat, delta, duration, percent, newTeam, damageType)
    const paramMap = {
      'param-value': 'value',
      'param-stat': 'stat',
      'param-delta': 'delta',
      'param-duration': 'duration',
      'param-percent': 'percent',
      'param-team': 'newTeam',
      'param-dtype': 'damageType'
    };
    c.querySelectorAll('.seb-act-param').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.closest('.seb-act-block').dataset.idx);
        const block = currentEffect.effects[idx];
        const cls = Array.from(input.classList).find(c => paramMap[c]);
        if (cls && paramMap[cls]) {
          const prop = paramMap[cls];
          let val = input.value;
          if (prop === 'value' || prop === 'delta' || prop === 'duration' || prop === 'percent') val = parseInt(val) || 0;
          block[prop] = val;
          updatePreview();
        }
      });
    });
  }

  function updatePreview() {
    const el = document.getElementById('sebPreview');
    if (!el) return;
    if (!currentEffect.name) {
      el.innerHTML = '<div class="seb-preview-ph">Configure effect to preview...</div>';
      return;
    }
    const meta = currentEffect.mode === 'advanced'
      ? `${currentEffect.effects.length} action(s) · ${currentEffect.duration}T`
      : `${typeInfo[currentEffect.type]?.label || currentEffect.type} · ${currentEffect.duration}T${currentEffect.type!=='skip'?' · '+currentEffect.value:''}`;
    el.innerHTML = `
      <div class="seb-prev-card">
        <div><span style="font-size:28px;">${currentEffect.icon}</span> <span class="seb-prev-name">${currentEffect.name}</span></div>
        <div class="seb-prev-meta">${meta}</div>
        <div class="seb-prev-desc">${currentEffect.description || '<em>No description</em>'}</div>
      </div>`;
  }

  function injectUI() {
    const existing = document.getElementById('sebOverlay');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.id = 'sebOverlay';
    div.className = 'seb-overlay';
    div.innerHTML = `
      <div class="seb-panel">
        <div class="seb-header">
          <span class="seb-title">// EFFECT FORGE //</span>
          <button id="sebClose">✕ CLOSE</button>
        </div>
        <div class="seb-body">
          <div class="seb-left">
            <div class="seb-field">
              <label>NAME</label>
              <input id="sebName" placeholder="e.g., Poison, Stun" value="${escapeHtml(currentEffect.name)}">
            </div>
            <div class="seb-field">
              <label>ICON</label>
              <div class="seb-icon-grid">${icons.map(ic => `<button class="seb-icon-btn" data-icon="${ic}">${ic}</button>`).join('')}</div>
              <input id="sebIcon" value="${escapeHtml(currentEffect.icon)}" maxlength="4" style="width:60px; text-align:center;">
            </div>
            <div class="seb-field">
              <label>DESCRIPTION</label>
              <textarea id="sebDesc" rows="2">${escapeHtml(currentEffect.description)}</textarea>
            </div>
            <div class="seb-field">
              <label>DURATION (turns)</label>
              <input id="sebDuration" type="number" min="1" max="10" value="${currentEffect.duration}">
            </div>
            <div class="seb-mode-row">
              <button id="sebModeSimple" class="${currentEffect.mode==='simple'?'active':''}">SIMPLE</button>
              <button id="sebModeAdv" class="${currentEffect.mode==='advanced'?'active':''}">ADVANCED</button>
            </div>
            <div id="sebSimplePanel" style="display:${currentEffect.mode==='simple'?'block':'none'}">
              <div class="seb-field">
                <label>TYPE</label>
                <select id="sebType">
                  ${Object.entries(typeInfo).map(([k,v]) => `<option value="${k}" ${currentEffect.type===k?'selected':''}>${v.label}</option>`).join('')}
                </select>
              </div>
              <div class="seb-field" id="sebValueField">
                <label id="sebValueLabel">VALUE</label>
                <input id="sebValue" type="number" value="${currentEffect.value}">
              </div>
              <div class="seb-field" id="sebDamageTypeField" style="display:${currentEffect.type==='dot'?'block':'none'}">
                <label>DAMAGE TYPE</label>
                <select id="sebDamageType">
                  ${['physical','fire','cold','lightning','poison','psychic','arcane'].map(dt => `<option value="${dt}" ${currentEffect.damageType===dt?'selected':''}>${dt.toUpperCase()}</option>`).join('')}
                </select>
              </div>
            </div>
            <div id="sebAdvPanel" style="display:${currentEffect.mode==='advanced'?'block':'none'}">
              <button id="sebAddAction" class="seb-add-action">+ ADD ACTION</button>
              <div id="sebActList"></div>
            </div>
          </div>
          <div class="seb-right">
            <div class="seb-preview-header">PREVIEW</div>
            <div id="sebPreview"></div>
            <div class="seb-valid-line" id="sebValid"></div>
            <button id="sebSave" class="seb-save-btn">${editingId ? 'UPDATE' : 'SAVE TO LIBRARY'}</button>
            <div class="seb-library-header">LIBRARY</div>
            <div id="sebLibrary"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    // bind UI events
    document.getElementById('sebClose')?.addEventListener('click', close);
    document.getElementById('sebSave')?.addEventListener('click', save);
    document.getElementById('sebName')?.addEventListener('input', () => {
      currentEffect.name = document.getElementById('sebName').value;
      updatePreview();
    });
    document.getElementById('sebIcon')?.addEventListener('input', () => {
      currentEffect.icon = document.getElementById('sebIcon').value;
      updatePreview();
    });
    document.getElementById('sebDesc')?.addEventListener('input', () => {
      currentEffect.description = document.getElementById('sebDesc').value;
      updatePreview();
    });
    document.getElementById('sebDuration')?.addEventListener('input', () => {
      currentEffect.duration = Math.max(1, parseInt(document.getElementById('sebDuration').value) || 1);
      updatePreview();
    });
    document.getElementById('sebType')?.addEventListener('change', () => {
      currentEffect.type = document.getElementById('sebType').value;
      const dtField = document.getElementById('sebDamageTypeField');
      if (dtField) dtField.style.display = currentEffect.type === 'dot' ? 'block' : 'none';
      const valLbl = document.getElementById('sebValueLabel');
      if (valLbl) valLbl.textContent = currentEffect.type === 'skip' ? 'N/A' : 'VALUE';
      updatePreview();
    });
    document.getElementById('sebValue')?.addEventListener('input', () => {
      currentEffect.value = parseInt(document.getElementById('sebValue').value) || 0;
      updatePreview();
    });
    document.getElementById('sebDamageType')?.addEventListener('change', () => {
      currentEffect.damageType = document.getElementById('sebDamageType').value;
      updatePreview();
    });
    document.getElementById('sebModeSimple')?.addEventListener('click', () => {
      currentEffect.mode = 'simple';
      document.getElementById('sebSimplePanel').style.display = 'block';
      document.getElementById('sebAdvPanel').style.display = 'none';
      document.getElementById('sebModeSimple').classList.add('active');
      document.getElementById('sebModeAdv').classList.remove('active');
      updatePreview();
    });
    document.getElementById('sebModeAdv')?.addEventListener('click', () => {
      currentEffect.mode = 'advanced';
      document.getElementById('sebSimplePanel').style.display = 'none';
      document.getElementById('sebAdvPanel').style.display = 'block';
      document.getElementById('sebModeAdv').classList.add('active');
      document.getElementById('sebModeSimple').classList.remove('active');
      renderActions();
      updatePreview();
    });
    document.getElementById('sebAddAction')?.addEventListener('click', () => {
      currentEffect.effects.push({ type: 'damage', delay: 0, target: 'enemy', value: 5 });
      renderActions();
      updatePreview();
    });
    // icon grid
    document.querySelectorAll('.seb-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentEffect.icon = btn.dataset.icon;
        document.getElementById('sebIcon').value = btn.dataset.icon;
        updatePreview();
      });
    });
    renderLibrary();
    renderActions();
    updatePreview();
    // Ensure overlay becomes visible
    setTimeout(() => div.classList.add('open'), 10);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }

  return { open, close };
})();