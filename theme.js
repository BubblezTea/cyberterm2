// theme.js

const Theme = (() => {
  let current = localStorage.getItem('ct_theme') || 'cyberpunk';

  const runeChars = ['ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ','ᛁ','ᛃ','ᛇ','ᛈ','ᛉ','ᛊ','ᛏ','ᛒ','ᛗ','ᛚ','ᛜ','ᛞ','ᛟ','✦','✧','⬡','◈','⟡','᛫'];

  function applyVars(theme) {
    const root = document.documentElement;
    if (theme === 'fantasy') {
      root.style.setProperty('--bg',         '#020100');
      root.style.setProperty('--bg2',        '#080601');
      root.style.setProperty('--bg3',        '#100d03');
      root.style.setProperty('--green',      '#d4a843');
      root.style.setProperty('--green-dim',  '#a87e2e');
      root.style.setProperty('--green-lo',   '#d4a84318');
      root.style.setProperty('--green-md',   '#d4a84335');
      root.style.setProperty('--green-glow', '#d4a84328');
      root.style.setProperty('--border',     '#d4a84320');
      root.style.setProperty('--border-hi',  '#d4a84360');
      root.style.setProperty('--text',       '#e8cc88');
      root.style.setProperty('--text-dim',   '#a88840');
      root.style.setProperty('--text-lo',    '#5a4418');
      root.style.setProperty('--red',        '#c04848');
      root.style.setProperty('--yellow',     '#f0dc60');
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