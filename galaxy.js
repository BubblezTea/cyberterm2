// galaxy.js

const Galaxy = (() => {
  const states = new Map();
  let zoomAnim = null;

  const WORLDS = [
    {
      id: 'cyberpunk',
      label: 'THE SPRAWL',
      sub: 'CHROME · NEON · CHAOS',
      color: '#00ccff',
      glow: [0, 200, 255],
      rx: 0.28, ry: 0.44,
      baseR: 14,
      rings: 2,
    },
    {
      id: 'fantasy',
      label: 'AETHORIA',
      sub: 'SWORDS · MAGIC · FATE',
      color: '#d4a843',
      glow: [212, 168, 67],
      rx: 0.68, ry: 0.54,
      baseR: 19,
      rings: 3,
    },
  ];

  function makeStars(w, h, n) {
    return Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.08,
      a: Math.random() * 0.55 + 0.1,
      ts: 0.2 + Math.random() * 0.9,
      to: Math.random() * Math.PI * 2,
    }));
  }

  function drawNebula(ctx, w, h, t) {
    const blobs = [
      { x: 0.14, y: 0.27, r: 0.38, c: [28, 0, 72],  a: 0.055 },
      { x: 0.82, y: 0.70, r: 0.30, c: [0, 28, 82],   a: 0.045 },
      { x: 0.47, y: 0.11, r: 0.26, c: [52, 8, 60],   a: 0.040 },
      { x: 0.40, y: 0.80, r: 0.20, c: [8, 18, 62],   a: 0.032 },
      { x: 0.60, y: 0.30, r: 0.18, c: [20, 0, 55],   a: 0.025 },
    ];
    for (const b of blobs) {
      const p = 1 + 0.04 * Math.sin(t * 0.17 + b.x * 7);
      const R = b.r * w * p;
      const grd = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, R);
      grd.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawBgStars(ctx, stars, t) {
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.ts + s.to);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(195, 215, 255, ${s.a * (0.35 + 0.65 * tw)})`;
      ctx.fill();
    }
  }

  function drawWorldStar(ctx, world, w, h, t, hovered) {
    const cx = world.rx * w;
    const cy = world.ry * h;
    const pulse = 1 + 0.08 * Math.sin(t * 1.4 + world.rx * 4);
    const r = world.baseR * pulse * (hovered ? 1.28 : 1);
    const [gr, gg, gb] = world.glow;

    // corona layers
    for (let i = 4; i >= 1; i--) {
      const rr = r * (2.8 + i * 1.9);
      const grd = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, rr);
      const alpha = (hovered ? 0.13 : 0.065) / i;
      grd.addColorStop(0, `rgba(${gr},${gg},${gb},${alpha})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // star body
    const body = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.32, r * 0.04, cx, cy, r);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.22, world.color);
    body.addColorStop(0.75, `rgba(${gr},${gg},${gb},0.65)`);
    body.addColorStop(1, `rgba(${gr},${gg},${gb},0.2)`);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // orbits + planets (hover only)
    if (hovered) {
      for (let i = 1; i <= world.rings; i++) {
        const or = r * (3.2 + i * 2.5);
        ctx.beginPath();
        ctx.arc(cx, cy, or, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${gr},${gg},${gb},0.16)`;
        ctx.lineWidth = 0.7;
        ctx.stroke();

        const angle = t * (0.45 / i) + world.rx * 12 + i * 1.1;
        const px = cx + Math.cos(angle) * or;
        const py = cy + Math.sin(angle) * or;
        const pr = Math.max(1.5, r * (0.18 - i * 0.03 + 0.06));
        const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
        pg.addColorStop(0, `rgba(${gr},${gg},${gb},0.75)`);
        pg.addColorStop(1, `rgba(${gr},${gg},${gb},0.08)`);
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();
      }
    }

    // label
    ctx.textAlign = 'center';
    ctx.font = `${Math.floor(r * (hovered ? 1.38 : 0.95))}px 'VT323', monospace`;
    ctx.shadowColor = world.color;
    ctx.shadowBlur = hovered ? 18 : 5;
    ctx.fillStyle = hovered ? world.color : `rgba(${gr},${gg},${gb},0.52)`;
    ctx.fillText(world.label, cx, cy - r * (hovered ? 4.7 : 3.4));
    ctx.shadowBlur = 0;

    if (hovered) {
      ctx.font = `${Math.floor(r * 0.62)}px 'Share Tech Mono', monospace`;
      ctx.fillStyle = 'rgba(175, 205, 255, 0.68)';
      ctx.fillText(world.sub, cx, cy - r * 3.45);

      const ha = 0.45 + 0.4 * Math.sin(t * 3.2);
      ctx.font = `${Math.floor(r * 0.52)}px 'Share Tech Mono', monospace`;
      ctx.fillStyle = `rgba(175, 205, 255, ${ha})`;
      ctx.fillText('[ ENTER WORLD ]', cx, cy - r * 2.55);
    }
  }

  function getWorldAt(x, y, w, h) {
    for (const world of WORLDS) {
      const cx = world.rx * w;
      const cy = world.ry * h;
      const hr = world.baseR * 4;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < hr * hr) return world;
    }
    return null;
  }

  function triggerZoom(state, world) {
    if (zoomAnim) return;
    state.hoveredWorld = null;
    state.canvas.style.cursor = 'default';
    zoomAnim = {
      world,
      cx: world.rx * state.canvas.width,
      cy: world.ry * state.canvas.height,
      progress: 0,
      done: false,
    };
  }

  function drawZoomFrame(state) {
    if (!zoomAnim || zoomAnim.done) return false;
    const { canvas, ctx } = state;
    const { width: w, height: h } = canvas;
    const za = zoomAnim;

    za.progress = Math.min(1, za.progress + 0.022);
    const eased = 1 - Math.pow(1 - za.progress, 3);

    const [gr, gg, gb] = za.world.glow;
    const maxR = Math.sqrt(w * w + h * h) * 1.15;
    const r = maxR * eased;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(0,0,8)';
    ctx.fillRect(0, 0, w, h);

    const grd = ctx.createRadialGradient(za.cx, za.cy, 0, za.cx, za.cy, r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.05, za.world.color);
    grd.addColorStop(0.22, `rgba(${gr},${gg},${gb},0.9)`);
    grd.addColorStop(0.52, `rgba(${gr},${gg},${gb},0.45)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(za.cx, za.cy, r, 0, Math.PI * 2);
    ctx.fill();

    if (eased > 0.8) {
      const fa = (eased - 0.8) / 0.2;
      ctx.fillStyle = `rgba(0,0,8,${fa})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (za.progress >= 1) {
      za.done = true;
      zoomAnim = null;
      Theme.apply(za.world.id, false);
      Ui.showScreen('charCreateScreen');
      initCharCreate();
    }

    return true;
  }

  function resize(state) {
    state.canvas.width  = state.canvas.offsetWidth  || window.innerWidth;
    state.canvas.height = state.canvas.offsetHeight || window.innerHeight;
  }

  function start(state) {
    if (state.active) return;
    state.active = true;
    resize(state);
    state.stars = makeStars(state.canvas.width, state.canvas.height, state.isMainMenu ? 300 : 160);
    let t0 = null;

    function frame(ts) {
      if (!state.active) return;
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;
      const { canvas, ctx } = state;
      const { width: w, height: h } = canvas;

      if (drawZoomFrame(state)) {
        state.animId = requestAnimationFrame(frame);
        return;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgb(0,0,8)';
      ctx.fillRect(0, 0, w, h);

      drawNebula(ctx, w, h, t);
      drawBgStars(ctx, state.stars, t);

      if (state.isMainMenu) {
        for (const world of WORLDS) {
          drawWorldStar(ctx, world, w, h, t, state.hoveredWorld === world.id);
        }

        const pa = 0.22 + 0.16 * Math.sin(t * 1.1);
        ctx.textAlign = 'center';
        ctx.font = "11px 'Share Tech Mono', monospace";
        ctx.fillStyle = `rgba(120, 158, 215, ${pa})`;
        ctx.fillText('— CHOOSE YOUR WORLD —', w / 2, h - 26);
      }

      state.animId = requestAnimationFrame(frame);
    }

    state.animId = requestAnimationFrame(frame);
  }

  function stop(state) {
    state.active = false;
    if (state.animId) cancelAnimationFrame(state.animId);
    state.animId = null;
    if (state.ctx && state.canvas) {
      state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    }
  }

  function mountMainMenu() {
    const screenEl = document.getElementById('mainMenuScreen');
    if (!screenEl) return;

    let canvas = document.getElementById('starfieldCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'starfieldCanvas';
      screenEl.insertBefore(canvas, screenEl.firstChild);
    }
    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: auto;
    `;
    const state = {
      canvas,
      ctx: canvas.getContext('2d'),
      stars: [],
      animId: null,
      active: false,
      isMainMenu: true,
      hoveredWorld: null,
    };
    states.set('mainMenuScreen', state);

    canvas.addEventListener('mousemove', (e) => {
      if (zoomAnim) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const world = getWorldAt(
        (e.clientX - rect.left) * sx,
        (e.clientY - rect.top) * sy,
        canvas.width, canvas.height
      );
      state.hoveredWorld = world ? world.id : null;
      canvas.style.cursor = world ? 'pointer' : 'default';
    });

    canvas.addEventListener('click', (e) => {
      if (zoomAnim) return;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const world = getWorldAt(
        (e.clientX - rect.left) * sx,
        (e.clientY - rect.top) * sy,
        canvas.width, canvas.height
      );
      if (world) triggerZoom(state, world);
    });

    canvas.addEventListener('touchend', (e) => {
      if (zoomAnim) return;
      e.preventDefault();
      const touch = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const world = getWorldAt(
        (touch.clientX - rect.left) * sx,
        (touch.clientY - rect.top) * sy,
        canvas.width, canvas.height
      );
      if (world) triggerZoom(state, world);
    }, { passive: false });

    const obs = new MutationObserver(() => {
      if (screenEl.classList.contains('active')) {
        zoomAnim = null;
        start(state);
      } else stop(state);
    });
    obs.observe(screenEl, { attributes: true, attributeFilter: ['class'] });

    if (screenEl.classList.contains('active')) start(state);
  }

  function mountSimple(screenId) {
    const screenEl = document.getElementById(screenId);
    if (!screenEl) return;

    let canvas = screenEl.querySelector('.galaxy-cv');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'galaxy-cv';
      canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
      screenEl.insertBefore(canvas, screenEl.firstChild);
    }

    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: -1;
      pointer-events: none;
    `;

    const state = {
      canvas,
      ctx: canvas.getContext('2d'),
      stars: [],
      animId: null,
      active: false,
      isMainMenu: false,
      hoveredWorld: null,
    };
    states.set(screenId, state);

    const obs = new MutationObserver(() => {
      if (screenEl.classList.contains('active')) {
        resize(state);
        state.stars = makeStars(state.canvas.width, state.canvas.height, 160);
        start(state);
      } else stop(state);
    });
    obs.observe(screenEl, { attributes: true, attributeFilter: ['class'] });

    if (screenEl.classList.contains('active')) {
      resize(state);
      state.stars = makeStars(state.canvas.width, state.canvas.height, 160);
      start(state);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    mountMainMenu();
    mountSimple('charCreateScreen');

    window.addEventListener('resize', () => {
      for (const [, s] of states) {
        if (!s.active) continue;
        resize(s);
        s.stars = makeStars(s.canvas.width, s.canvas.height, s.isMainMenu ? 300 : 160);
      }
    });
  });

  return { start, stop };
})();