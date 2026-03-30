// theme.js

const Theme = (() => {
  let current = localStorage.getItem('ct_theme') || 'cyberpunk';

  const runeChars = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛗ','ᛚ','ᛜ','ᛞ','ᛟ','✦','✧','⬡','◈','⟡','᛫'];

  function applyVars(theme) {
    const root = document.documentElement;
    if (theme === 'fantasy') {
      root.style.setProperty('--bg',         '#030201');
      root.style.setProperty('--bg2',        '#070503');
      root.style.setProperty('--bg3',        '#0e0a05');
      root.style.setProperty('--green',      '#c8a84b');
      root.style.setProperty('--green-dim',  '#9a7830');
      root.style.setProperty('--green-lo',   '#c8a84b18');
      root.style.setProperty('--green-md',   '#c8a84b38');
      root.style.setProperty('--green-glow', '#c8a84b2a');
      root.style.setProperty('--border',     '#c8a84b22');
      root.style.setProperty('--border-hi',  '#c8a84b65');
      root.style.setProperty('--text',       '#c8b078');
      root.style.setProperty('--text-dim',   '#8a7040');
      root.style.setProperty('--text-lo',    '#4a3c18');
      root.style.setProperty('--red',        '#b84040');
      root.style.setProperty('--yellow',     '#e8d050');
    } else {
      root.style.setProperty('--bg',         '#020403');
      root.style.setProperty('--bg2',        '#050807');
      root.style.setProperty('--bg3',        '#0a100c');
      root.style.setProperty('--green',      '#00ff9c');
      root.style.setProperty('--green-dim',  '#00cc7a');
      root.style.setProperty('--green-lo',   '#00ff9c22');
      root.style.setProperty('--green-md',   '#00ff9c44');
      root.style.setProperty('--green-glow', '#00ff9c33');
      root.style.setProperty('--border',     '#00ff9c30');
      root.style.setProperty('--border-hi',  '#00ff9c80');
      root.style.setProperty('--text',       '#00ff9c');
      root.style.setProperty('--text-dim',   '#00aa68');
      root.style.setProperty('--text-lo',    '#006640');
      root.style.setProperty('--red',        '#ff3c4e');
      root.style.setProperty('--yellow',     '#ffe066');
    }
  }

  function updateTextLabels(theme) {
    // HUD currency label
    const crLabel = document.getElementById('hdrCrLabel');
    if (crLabel) crLabel.textContent = theme === 'fantasy' ? 'G' : 'CR';

    // menu subtitle
    const subs = document.querySelectorAll('.theme-sub-text');
    subs.forEach(el => {
      el.textContent = theme === 'fantasy' ? 'REALM ACCESS TERMINAL' : 'NEURAL NARRATIVE ENGINE';
    });

    // hdr title tooltip feel (optional, non-breaking)
    const hdrTitle = document.getElementById('hdrTitle');
    if (hdrTitle) hdrTitle.dataset.theme = theme;
  }

  function glitchTransition(cb) {
    const overlay = document.createElement('div');
    overlay.className = 'theme-glitch-overlay';
    document.body.appendChild(overlay);
    document.body.classList.add('theme-transitioning');

    // chromatic aberration layers
    const r = document.createElement('div');
    const b = document.createElement('div');
    r.className = 'ca-layer ca-red';
    b.className = 'ca-layer ca-blue';
    overlay.appendChild(r);
    overlay.appendChild(b);

    // apply new theme mid-flash so the transition feels like a hard cut
    setTimeout(() => {
      cb();
    }, 220);

    setTimeout(() => {
      document.body.classList.remove('theme-transitioning');
      overlay.remove();
    }, 500);
  }

  function apply(theme, animate) {
    current = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ct_theme', theme);

    if (animate) {
      glitchTransition(() => {
        applyVars(theme);
        updateTextLabels(theme);
      });
    } else {
      applyVars(theme);
      updateTextLabels(theme);
    }

    // sync the settings toggle buttons if they exist
    const cpBtn = document.getElementById('themeCyberpunk');
    const ftBtn = document.getElementById('themeFantasy');
    if (cpBtn) cpBtn.classList.toggle('active', theme === 'cyberpunk');
    if (ftBtn) ftBtn.classList.toggle('active', theme === 'fantasy');
  }

  function toggle() {
    apply(current === 'fantasy' ? 'cyberpunk' : 'fantasy', true);
  }

  function getRainChar() {
    if (current === 'fantasy') {
      return runeChars[Math.floor(Math.random() * runeChars.length)];
    }
    return Math.random() > 0.5 ? '1' : '0';
  }

  // init on load, no animation
  document.addEventListener('DOMContentLoaded', () => {
    apply(current, false);
  });

  return { apply, toggle, getRainChar, get current() { return current; } };
})();
