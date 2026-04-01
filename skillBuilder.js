// skillBuilder.js – new version with effect library integration

let isOpen = false;
let editingIndex = -1;
let attachedEffectIds = []; // store IDs of effects from library
let st = {
  name: '',
  description: '',
  scaling: '',
  energyCost: 10,
  dmgEnabled: false,
  dmgMin: 5,
  dmgMax: 15,
  cooldown: 0
};

function g(id) { return document.getElementById(id); }

function resetState() {
  st = {
    name: '', description: '', scaling: '', energyCost: 10,
    dmgEnabled: false, dmgMin: 5, dmgMax: 15, cooldown: 0
  };
  attachedEffectIds = [];
}

function populateFromSkill(skill) {
  const setVal = (id, val) => { const el = g(id); if (el) el.value = val; };
  const setChk = (id, val) => { const el = g(id); if (el) el.checked = val; };
  setVal('skbName', skill.name || '');
  setVal('skbDesc', skill.description || '');
  setVal('skbScaling', skill.statScaling || '');
  setVal('skbCostRange', skill.energyCost || 10);
  setChk('skbDmgToggle', !!skill.damage);
  if (skill.damage) { setVal('skbDmgMin', skill.damage[0] || 5); setVal('skbDmgMax', skill.damage[1] || 15); }
  setVal('skbCdRange', skill.cooldown || 0);
  attachedEffectIds = (skill.statusEffects || []).map(e => e.id).filter(id => id);
  renderAttachedList();
  onChange();
}

function open(skillToEdit) {
  if (isOpen) return;
  isOpen = true;
  editingIndex = skillToEdit ? State.skills.findIndex(s => s === skillToEdit) : -1;
  resetState();
  injectUI();
  if (skillToEdit) populateFromSkill(skillToEdit);
  setTimeout(() => { const ov = g('skbOverlay'); if (ov) ov.classList.add('open'); }, 10);
  bindEvents();
  onChange();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  const ov = g('skbOverlay');
  if (ov) ov.remove();
}

function renderAttachedList() {
  const container = g('skbAttachedList');
  const countBadge = g('skbEffectCount');
  if (!container) return;
  const library = State.statusEffectLibrary || [];
  const effects = attachedEffectIds.map(id => library.find(e => e.id === id)).filter(Boolean);
  if (countBadge) {
    countBadge.textContent = effects.length
      ? effects.length + ' EFFECT' + (effects.length !== 1 ? 'S' : '')
      : 'OPTIONAL';
  }
  if (!effects.length) {
    container.innerHTML = '<div class="skb-eff-ph">No effects attached. Pick from library or forge new.</div>';
    return;
  }
  container.innerHTML = effects.map(eff => `
    <div class="skb-eff-chip" data-id="${eff.id}">
      <span class="skb-eff-icon">${eff.icon || '⚡'}</span>
      <div class="skb-eff-info">
        <span class="skb-eff-name">${eff.name}</span>
        <span class="skb-eff-meta">${eff.duration}T · ${eff.effects ? 'ADVANCED' : (eff.type||'').toUpperCase()}</span>
      </div>
      <button class="skb-eff-remove" data-id="${eff.id}">✕</button>
    </div>`).join('');
  container.querySelectorAll('.skb-eff-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      attachedEffectIds = attachedEffectIds.filter(i => i !== id);
      renderAttachedList();
      onChange();
    });
  });
}

function refreshLibraryPicker() {
  const container = g('skbLibPickerList');
  if (!container) return;
  const lib = State.statusEffectLibrary || [];
  if (!lib.length) {
    container.innerHTML = '<div style="color:var(--text-lo);font-size:11px;text-align:center;padding:14px;">Library empty. Forge effects first.</div>';
    return;
  }
  container.innerHTML = lib.map(eff => {
    const attached = attachedEffectIds.includes(eff.id);
    return `<div class="skb-lib-pick ${attached?'picked':''}" data-id="${eff.id}">
      <span style="font-size:16px;">${eff.icon||'⚡'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:${attached?'var(--green)':'var(--text-dim)'};">${eff.name}</div>
        <div style="font-size:9px;color:var(--text-lo);">${eff.duration}T · ${eff.effects?'ADVANCED':(eff.type||'').toUpperCase()}</div>
      </div>
      <span style="font-size:10px;color:${attached?'var(--green)':'var(--text-lo)'};">${attached?'✓ ON':'+  '}</span>
    </div>`;
  }).join('');
  container.querySelectorAll('.skb-lib-pick').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (attachedEffectIds.includes(id)) {
        attachedEffectIds = attachedEffectIds.filter(i => i !== id);
      } else {
        attachedEffectIds.push(id);
      }
      refreshLibraryPicker();
      renderAttachedList();
      onChange();
    });
  });
}

function injectUI() {
  const existing = g('skbOverlay');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'skbOverlay';
  div.innerHTML = `
<div class="skb-panel">
  <div class="skb-hdr">
    <div class="skb-hdr-left"><span class="skb-corner-tag">NEURAL WEAVE STUDIO</span><span class="skb-title">// SKILL FORGE //</span></div>
    <button class="skb-close-btn" id="skbClose">✕ EXIT</button>
  </div>
  <div class="skb-body">
    <div class="skb-flow">
      <!-- Block 1: Identity -->
      <div class="skb-block"><div class="skb-bk-hdr"><span class="skb-bk-num">①</span><div class="skb-bk-meta"><span class="skb-bk-label">IDENTITY</span><span class="skb-bk-sub">name · description · scaling</span></div><span class="skb-badge-req">REQUIRED</span></div>
        <div class="skb-bk-body">
          <div class="skb-field"><label class="skb-lbl">SKILL NAME</label><input class="skb-input" id="skbName" placeholder="e.g. Neural Disruptor"></div>
          <div class="skb-field"><label class="skb-lbl">DESCRIPTION</label><textarea class="skb-input skb-ta" id="skbDesc" rows="2" placeholder="Combat description..."></textarea></div>
          <div class="skb-field"><label class="skb-lbl">STAT SCALING</label><select class="skb-select" id="skbScaling"><option value="">— NONE —</option><option value="str">STR</option><option value="agi">AGI</option><option value="int">INT</option><option value="cha">CHA</option><option value="tec">TEC</option><option value="end">END</option></select><div class="skb-field-hint">Stat bonus added to damage rolls.</div></div>
        </div>
      </div>
      <div class="skb-wire"><div class="skb-wire-inner"></div></div>
      <!-- Block 2: Energy Cost -->
      <div class="skb-block"><div class="skb-bk-hdr"><span class="skb-bk-num">②</span><div class="skb-bk-meta"><span class="skb-bk-label">ENERGY COST</span><span class="skb-bk-sub">consumed on activation</span></div><span class="skb-badge-req">REQUIRED</span></div>
        <div class="skb-bk-body"><div class="skb-slider-group"><div class="skb-slider-top"><label class="skb-lbl">COST</label><div class="skb-val-badge"><span id="skbCostDisplay">10</span><span class="skb-unit">E</span></div></div><input class="skb-range" type="range" id="skbCostRange" min="0" max="50" value="10"><div class="skb-range-ticks"><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span></div></div><div class="skb-hint-line" id="skbCostHint">Low cost — efficient to use.</div></div>
      </div>
      <div class="skb-wire"><div class="skb-wire-inner"></div></div>
      <!-- Block 3: Damage (optional) -->
      <div class="skb-block skb-optional" id="skbBlockDmg"><div class="skb-bk-hdr"><span class="skb-bk-num">③</span><div class="skb-bk-meta"><span class="skb-bk-label">DAMAGE</span><span class="skb-bk-sub">direct hit damage range</span></div><label class="skb-toggle" for="skbDmgToggle"><input type="checkbox" id="skbDmgToggle"><span class="skb-track"><span class="skb-thumb"></span></span><span class="skb-toggle-txt" id="skbDmgTxt">OFF</span></label></div>
        <div class="skb-collapse" id="skbDmgBody"><div class="skb-collapse-inner"><div class="skb-dmg-row"><div class="skb-field"><label class="skb-lbl">MIN DMG</label><input class="skb-input skb-num" type="number" id="skbDmgMin" min="1" max="999" value="5"></div><div class="skb-dmg-sep">—</div><div class="skb-field"><label class="skb-lbl">MAX DMG</label><input class="skb-input skb-num" type="number" id="skbDmgMax" min="1" max="999" value="15"></div></div><div class="skb-dmg-vis"><div class="skb-dmg-track"><div class="skb-dmg-fill" id="skbDmgFill"></div></div><div class="skb-dmg-label" id="skbDmgLabel">5 – 15 damage per hit</div></div></div></div>
      </div>
      <div class="skb-wire"><div class="skb-wire-inner"></div></div>
      <!-- Block 4: Status Effects (library based) -->
      <div class="skb-block skb-optional" id="skbBlockEffects"><div class="skb-bk-hdr"><span class="skb-bk-num">④</span><div class="skb-bk-meta"><span class="skb-bk-label">STATUS EFFECTS</span><span class="skb-bk-sub">attach from library</span></div><span class="skb-badge-req" id="skbEffectCount">OPTIONAL</span></div>
        <div class="skb-bk-body"><div id="skbAttachedList" class="skb-attached-list"></div><div style="display:flex;gap:8px;margin-top:8px;"><button type="button" id="skbPickEffBtn" class="skb-eff-action-btn" style="flex:1;">☰ PICK FROM LIBRARY</button><button type="button" id="skbForgeEffBtn" class="skb-eff-action-btn" style="flex:1;">⚙ FORGE NEW EFFECT</button></div><div id="skbLibPicker" style="display:none;" class="skb-lib-picker-panel"><div id="skbLibPickerList"></div></div></div>
      </div>
      <div class="skb-wire"><div class="skb-wire-inner"></div></div>
      <!-- Block 5: Cooldown -->
      <div class="skb-block"><div class="skb-bk-hdr"><span class="skb-bk-num">⑤</span><div class="skb-bk-meta"><span class="skb-bk-label">COOLDOWN</span><span class="skb-bk-sub">turns before reuse</span></div><span class="skb-badge-req">REQUIRED</span></div>
        <div class="skb-bk-body"><div class="skb-slider-group"><div class="skb-slider-top"><label class="skb-lbl">WAIT</label><div class="skb-val-badge"><span id="skbCdDisplay">0</span><span class="skb-unit">T</span></div></div><input class="skb-range" type="range" id="skbCdRange" min="0" max="5" value="0"><div class="skb-range-ticks"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div></div><div class="skb-hint-line" id="skbCdHint">No cooldown — usable every turn.</div></div>
      </div>
    </div>
    <div class="skb-sidebar"><div class="skb-section-lbl">// PREVIEW //</div><div id="skbPreview" class="skb-preview-area"><div class="skb-preview-ph">Configure blocks to see preview...</div></div><div class="skb-forge-area"><div class="skb-valid-line" id="skbValidLine"></div><button class="skb-forge-btn" id="skbForge" disabled><span class="skb-forge-glyph">⚙</span><span class="skb-forge-text">FORGE SKILL</span></button><div class="skb-err-line" id="skbErrLine"></div></div></div>
  </div>
</div>`;
  document.body.appendChild(div);
}

function readState() {
  const v = id => { const el = g(id); return el ? el.value : ''; };
  const chk = id => { const el = g(id); return el ? el.checked : false; };
  st.name = v('skbName');
  st.description = v('skbDesc');
  st.scaling = v('skbScaling');
  st.energyCost = Math.max(0, Math.min(50, parseInt(v('skbCostRange')) || 0));
  st.dmgEnabled = chk('skbDmgToggle');
  st.dmgMin = Math.max(1, Math.min(999, parseInt(v('skbDmgMin')) || 1));
  st.dmgMax = Math.max(1, Math.min(999, parseInt(v('skbDmgMax')) || 1));
  st.cooldown = Math.max(0, Math.min(5, parseInt(v('skbCdRange')) || 0));
}

function buildSkill() {
  readState();
  const mn = Math.min(st.dmgMin, st.dmgMax);
  const mx = Math.max(st.dmgMin, st.dmgMax);
  const library = State.statusEffectLibrary || [];
  const statusEffects = attachedEffectIds.map(id => library.find(e => e.id === id)).filter(Boolean);
  return {
    name: st.name.trim(),
    description: st.description.trim(),
    damage: st.dmgEnabled ? [mn, mx] : null,
    energyCost: st.energyCost,
    cooldown: st.cooldown,
    statScaling: st.scaling || null,
    statusEffects: statusEffects.length ? statusEffects.map(e => ({ ...e })) : null,
    currentCooldown: 0
  };
}

function validate(skill) {
  if (!skill.name) return { ok: false, msg: 'SKILL NAME REQUIRED' };
  if (skill.name.length < 2) return { ok: false, msg: 'NAME TOO SHORT' };
  if (editingIndex === -1 && State.skills.find(s => s.name.toLowerCase() === skill.name.toLowerCase())) {
    return { ok: false, msg: `"${skill.name.toUpperCase()}" ALREADY EXISTS` };
  }
  if (!skill.damage && (!skill.statusEffects || !skill.statusEffects.length)) {
    return { ok: false, msg: 'ENABLE DAMAGE AND/OR ATTACH AN EFFECT' };
  }
  if (skill.damage && skill.damage[0] < 1) return { ok: false, msg: 'MIN DAMAGE MUST BE ≥ 1' };
  return { ok: true, msg: '✓ VALID — READY TO FORGE' };
}

function updateDmgVis() {
  const fill = g('skbDmgFill');
  const label = g('skbDmgLabel');
  if (!fill) return;
  const mn = Math.min(st.dmgMin, st.dmgMax);
  const mx = Math.max(st.dmgMin, st.dmgMax);
  const left = Math.max(0, Math.min(75, (mn / 100) * 100));
  const width = Math.max(8, Math.min(100 - left, ((mx - mn + 5) / 100) * 100));
  fill.style.left = left + '%';
  fill.style.width = width + '%';
  if (label) label.textContent = `${mn} – ${mx} damage per hit`;
}

function renderPreview() {
  const prevEl = g('skbPreview');
  const validEl = g('skbValidLine');
  const forgeBtn = g('skbForge');
  const skill = buildSkill();
  const v = validate(skill);
  if (forgeBtn) forgeBtn.disabled = !v.ok;
  if (validEl) { validEl.textContent = v.msg; validEl.className = 'skb-valid-line ' + (v.ok ? 'ok' : 'err'); }
  if (!skill.name && !skill.damage && !skill.statusEffects?.length) {
    prevEl.innerHTML = '<div class="skb-preview-ph">Configure blocks to see preview...</div>';
    return;
  }
  const dmgStr = skill.damage ? `${skill.damage[0]}–${skill.damage[1]}` : '—';
  const scStr = skill.statScaling ? skill.statScaling.toUpperCase() : null;
  let effectsHtml = '';
  if (skill.statusEffects && skill.statusEffects.length) {
    effectsHtml = skill.statusEffects.map(eff => `
      <div class="skb-prev-fx"><span class="skb-prev-fx-icon">${eff.icon||'⚡'}</span><div class="skb-prev-fx-info"><span class="skb-prev-fx-name">${eff.name}</span><span class="skb-prev-fx-meta">${eff.duration}T · ${eff.effects ? 'ADVANCED' : (eff.type||'').toUpperCase()}</span></div></div>`).join('');
  }
  prevEl.innerHTML = `<div class="skb-prev-card"><div class="skb-prev-top"><span class="skb-prev-name">${skill.name||'[ UNNAMED ]'}</span>${scStr?`<span class="skb-prev-scale">${scStr}</span>`:''}</div><div class="skb-prev-desc">${skill.description||'<em style="opacity:.4">No description.</em>'}</div><div class="skb-prev-stats"><div class="skb-prev-stat"><span class="skb-ps-lbl">DMG</span><span class="skb-ps-val ${dmgStr!=='—'?'lit':''}">${dmgStr}</span></div><div class="skb-prev-stat"><span class="skb-ps-lbl">COST</span><span class="skb-ps-val lit">${skill.energyCost}E</span></div><div class="skb-prev-stat"><span class="skb-ps-lbl">CD</span><span class="skb-ps-val ${skill.cooldown>0?'lit':''}">${skill.cooldown}T</span></div><div class="skb-prev-stat"><span class="skb-ps-lbl">FX</span><span class="skb-ps-val ${skill.statusEffects?.length?'fx':''}">${skill.statusEffects?.length||'—'}</span></div></div>${effectsHtml}<div class="skb-prev-scanline"></div></div>`;
}

function onChange() {
  readState();
  const costD = g('skbCostDisplay'); if (costD) costD.textContent = st.energyCost;
  const costH = g('skbCostHint'); if (costH) costH.textContent = (() => {
    if (st.energyCost <= 5) return 'Minimal cost — nearly free.';
    if (st.energyCost <= 12) return 'Low cost — efficient to use.';
    if (st.energyCost <= 20) return 'Moderate — watch your energy.';
    if (st.energyCost <= 30) return 'High cost — use with intent.';
    return 'Extreme — drains nearly all energy.';
  })();
  const cdD = g('skbCdDisplay'); if (cdD) cdD.textContent = st.cooldown;
  const cdH = g('skbCdHint'); if (cdH) cdH.textContent = ['No cooldown — usable every turn.', '1-turn wait — nearly instant recharge.', '2-turn cooldown — short recovery.', '3 turns between uses.', '4-turn cooldown — use wisely.', 'Maximum — reserve for critical moments.'][st.cooldown] || '';
  const dmgBody = g('skbDmgBody');
  const dmgTxt = g('skbDmgTxt');
  const dmgBlock = g('skbBlockDmg');
  if (dmgBody) dmgBody.classList.toggle('open', st.dmgEnabled);
  if (dmgTxt) { dmgTxt.textContent = st.dmgEnabled ? 'ON' : 'OFF'; dmgTxt.style.color = st.dmgEnabled ? 'var(--green)' : 'var(--text-lo)'; }
  if (dmgBlock) dmgBlock.classList.toggle('active', st.dmgEnabled);
  updateDmgVis();
  const effBlock = g('skbBlockEffects');
  if (effBlock) effBlock.classList.toggle('active', attachedEffectIds.length > 0);
  renderPreview();
}

function forge() {
  const skill = buildSkill();
  const v = validate(skill);
  if (!v.ok) {
    const errEl = g('skbErrLine');
    if (errEl) { errEl.textContent = '⚠ ' + v.msg; errEl.classList.add('visible'); setTimeout(() => errEl.classList.remove('visible'), 3000); }
    return;
  }
  if (editingIndex !== -1) {
    State.skills[editingIndex] = skill;
    if (typeof Ui !== 'undefined') Ui.addInstant(`[ SKILL UPDATED: ${skill.name.toUpperCase()} ]`, 'system');
  } else {
    State.skills.push(skill);
    if (typeof Ui !== 'undefined') Ui.addInstant(`[ SKILL FORGED: ${skill.name.toUpperCase()} ]`, 'system');
  }
  if (typeof addKeyFact === 'function') addKeyFact(`Forged skill: ${skill.name}`);
  if (typeof Ui !== 'undefined') Ui.renderSidebar();
  const btn = g('skbForge');
  if (btn) { btn.innerHTML = `<span class="skb-forge-glyph">✓</span><span class="skb-forge-text">${editingIndex !== -1 ? 'UPDATED' : 'FORGED'}</span>`; btn.classList.add('success'); }
  setTimeout(close, 750);
}

function bindEvents() {
  g('skbClose')?.addEventListener('click', close);
  g('skbForge')?.addEventListener('click', forge);
  let pickerOpen = false;
  g('skbPickEffBtn')?.addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    const picker = g('skbLibPicker');
    if (picker) { picker.style.display = pickerOpen ? 'block' : 'none'; if (pickerOpen) refreshLibraryPicker(); }
    const btn = g('skbPickEffBtn');
    if (btn) btn.textContent = pickerOpen ? '✕ CLOSE PICKER' : '☰ PICK FROM LIBRARY';
  });
  g('skbForgeEffBtn')?.addEventListener('click', () => {
    StatusEffectBuilder.open(null, (newEffect) => {
      attachedEffectIds.push(newEffect.id);
      renderAttachedList();
      onChange();
      const picker = g('skbLibPicker');
      if (picker) picker.style.display = 'none';
      pickerOpen = false;
      const pickBtn = g('skbPickEffBtn');
      if (pickBtn) pickBtn.textContent = '☰ PICK FROM LIBRARY';
    });
  });
  const liveIds = ['skbName', 'skbDesc', 'skbScaling', 'skbCostRange', 'skbDmgToggle', 'skbDmgMin', 'skbDmgMax', 'skbCdRange'];
  liveIds.forEach(id => {
    const el = g(id);
    if (el) el.addEventListener('input', onChange);
  });
  document.addEventListener('keydown', e => { if (isOpen && e.key === 'Escape') close(); });
}

function init() {
  if (typeof Ui === 'undefined') return;
  const orig = Ui.renderSkills.bind(Ui);
  Ui.renderSkills = function() {
    orig();
    const panel = document.getElementById('tab-skills');
    if (!panel) return;
    const canForge = !window.Multiplayer?.enabled || window.Multiplayer?.isHost?.();
    if (!canForge) return;
    panel.querySelectorAll('.skb-open-btn').forEach(b => b.remove());
    const forgeBtn = document.createElement('button');
    forgeBtn.className = 'skb-open-btn';
    forgeBtn.innerHTML = '<span>⚙</span> FORGE NEW SKILL';
    forgeBtn.onclick = () => SkillBuilder.open();
    panel.appendChild(forgeBtn);
    const effectBtn = document.createElement('button');
    effectBtn.className = 'skb-open-btn';
    effectBtn.style.marginTop = '4px';
    effectBtn.innerHTML = '<span>✦</span> MANAGE EFFECT LIBRARY';
    effectBtn.onclick = () => StatusEffectBuilder.open();
    panel.appendChild(effectBtn);
  };
}

document.addEventListener('DOMContentLoaded', init);
window.SkillBuilder = { open, close, refreshLibraryPicker };