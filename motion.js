/* Laural's Haven motion kit: springs, FLIP layout glides, particle bursts and haptics. Identical in the storefront and the admin console. */
(() => {
  'use strict';
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const coarse = matchMedia('(pointer: coarse)');
  const M = { get reduce() { return mq.matches; } };

  /* ---------- Springs, rendered as CSS linear() easings ---------- */
  const canLinear = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
  function springCurve(k, c) {
    const w = Math.sqrt(k), z = c / (2 * w);
    const settle = Math.min(2.2, -Math.log(0.0015) / (z * w));
    const x = z < 1
      ? (t) => { const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); }
      : (t) => 1 - Math.exp(-w * t) * (1 + w * t);
    const pts = [];
    for (let i = 0; i <= 48; i++) pts.push(+x((i / 48) * settle).toFixed(4));
    pts[48] = 1;
    return { easing: canLinear ? `linear(${pts.join(',')})` : 'cubic-bezier(.3,1.35,.5,1)', duration: Math.round(settle * 1000) };
  }
  M.springs = { snap: springCurve(420, 30), bounce: springCurve(300, 17), soft: springCurve(170, 26), glide: springCurve(260, 30) };
  const root = document.documentElement.style;
  root.setProperty('--spring', M.springs.bounce.easing);
  root.setProperty('--spring-snap', M.springs.snap.easing);
  root.setProperty('--spring-soft', M.springs.soft.easing);
  M.EXPO = 'cubic-bezier(.16,1,.3,1)';

  // Element.animate with house defaults; does nothing (returns null) for reduced motion or detached nodes.
  M.play = (el, frames, opts = {}) => {
    if (M.reduce || !el || !el.isConnected || !el.animate) return null;
    const s = M.springs[opts.spring || 'bounce'];
    return el.animate(frames, { duration: s.duration, easing: s.easing, fill: 'backwards', ...opts, spring: undefined });
  };
  M.stagger = (els, frames, opts = {}) => [...els].slice(0, opts.max || 24).map((el, i) => M.play(el, frames, { ...opts, delay: (opts.delay || 0) + i * (opts.gap || 45) }));
  M.pop = (el, amt = 1.22) => M.play(el, [{ transform: 'scale(1)' }, { transform: `scale(${amt})`, offset: 0.25 }, { transform: 'scale(1)' }], { spring: 'snap', duration: 520, easing: 'ease-out' });
  M.rise = (el) => M.play(el, [{ transform: 'translateY(.55em)', opacity: 0, filter: 'blur(3px)' }, { transform: 'none', opacity: 1, filter: 'blur(0)' }], { spring: 'snap' });

  /* ---------- FLIP: things glide to where a re-render puts them ---------- */
  // keyOf(el) names an element across renders; mutate() changes the DOM. New elements fly in, kept ones glide.
  M.flip = (rootEl, selector, keyOf, mutate, opts = {}) => {
    if (M.reduce || !rootEl || !rootEl.getClientRects().length) { mutate(); return { entered: [], moved: [] }; }
    const vh = innerHeight + 200;
    const seen = (r) => r.width && r.bottom > -200 && r.top < vh;
    const before = new Map();
    rootEl.querySelectorAll(selector).forEach((el) => { const k = keyOf(el); if (k && el.getClientRects().length) before.set(k, el.getBoundingClientRect()); });
    mutate();
    const entered = [], moved = [];
    let n = 0;
    rootEl.querySelectorAll(selector).forEach((el) => {
      const k = keyOf(el);
      if (!k) return;
      const b = el.getBoundingClientRect();
      const a = before.get(k);
      if (!a) {
        if (opts.enter !== false && before.size && seen(b)) { entered.push(el); M.play(el, opts.enterFrames || [{ transform: 'translateY(.9rem) scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { delay: Math.min(n++, 10) * 35 }); }
        return;
      }
      el.classList.add('held');
      const dx = a.left - b.left, dy = a.top - b.top;
      if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || !(seen(a) || seen(b))) return;
      moved.push(el);
      M.play(el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { spring: opts.spring || 'glide', composite: 'add' });
    });
    return { entered, moved };
  };

  /* ---------- Particles: one shared canvas, one animation loop, nothing left running ---------- */
  let cv = null, cx = null, parts = [], looping = false;
  const GOLD = ['#efd9a3', '#d6b26e', '#b08d4f', '#f4ece0', '#e9c77f'];
  function canvas() {
    if (cv) return cx;
    cv = document.createElement('canvas');
    cv.className = 'lhm-fx';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    cx = cv.getContext('2d');
    return cx;
  }
  function frame() {
    const d = devicePixelRatio || 1;
    if (cv.width !== innerWidth * d || cv.height !== innerHeight * d) { cv.width = innerWidth * d; cv.height = innerHeight * d; }
    cx.setTransform(d, 0, 0, d, 0, 0);
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => --p.life > 0);
    parts.forEach((p) => {
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.globalAlpha = Math.min(1, p.life / 18);
      cx.fillStyle = p.c;
      if (p.kind === 'spark') { cx.beginPath(); cx.arc(p.x, p.y, p.s * (p.life / p.max), 0, 6.283); cx.fill(); }
      else { cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.cos(p.r * 2)); cx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); cx.restore(); }
    });
    cx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(frame);
    else { looping = false; cx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  // kind 'spark' = soft glowing dots; 'confetti' = tumbling gold leaf.
  M.burst = (x, y, o = {}) => {
    if (M.reduce || document.visibilityState !== 'visible') return;
    canvas();
    const n = Math.min(o.count || 18, 160 - parts.length);
    const colors = o.colors || GOLD;
    for (let i = 0; i < n; i++) {
      const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const v = (o.speed || 6) * (0.45 + Math.random() * 0.75);
      const max = (o.life || 46) + ((Math.random() * 20) | 0);
      parts.push({ kind: o.kind || 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity ?? 0.18, drag: o.drag || 0.95, s: (o.size || 3) * (0.6 + Math.random() * 0.8), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, c: colors[(Math.random() * colors.length) | 0], life: max, max });
    }
    if (!looping) { looping = true; requestAnimationFrame(frame); }
  };
  M.burstAt = (el, o) => { if (!el) return; const r = el.getBoundingClientRect(); M.burst(r.left + r.width / 2, r.top + r.height / 2, o); };
  M.confetti = (x = innerWidth / 2, y = innerHeight * 0.38) => {
    M.burst(x, y, { kind: 'confetti', count: 90, speed: 15, spread: Math.PI * 1.1, gravity: 0.32, drag: 0.965, size: 9, life: 120 });
    M.burst(x, y, { count: 30, speed: 9, gravity: 0.05, size: 3.2, life: 50 });
  };

  /* ---------- Haptics (phones only) ---------- */
  M.haptic = (p = 10) => { try { if (coarse.matches && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } };

  /* ---------- Toasts leave with a flourish and the stack closes up smoothly ---------- */
  M.dismiss = (el, ms = 300) => {
    if (!el || !el.isConnected) return;
    const box = el.parentElement;
    const gone = () => {
      if (!box || M.reduce) { el.remove(); return; }
      M.flip(box, ':scope > *', (x) => x, () => el.remove(), { enter: false, spring: 'snap' });
    };
    const a = M.play(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateX(2.5rem) scale(.92)', opacity: 0 }], { duration: ms, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    if (a) a.finished.then(gone, gone); else el.remove();
  };

  /* ---------- Touch feedback: an ink ripple from the pointer and a magnetic pull on primary buttons ---------- */
  const PRESS = '.btn,.add,.act,.chip,.cart-btn,.icon-btn,.seg button,.diet button,#nav button,.cp-item,.step button,.cart-bar button,.pay-btn';
  document.addEventListener('pointerdown', (e) => {
    if (M.reduce || e.button > 0) return;
    const t = e.target.closest && e.target.closest(PRESS);
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect();
    if (getComputedStyle(t).position === 'static') t.style.position = 'relative';
    const ink = document.createElement('span');
    ink.className = 'lhm-ink';
    ink.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('i');
    const size = Math.hypot(r.width, r.height) * 2;
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    ink.appendChild(dot);
    t.appendChild(ink);
    const a = dot.animate([{ transform: 'scale(0)', opacity: 0.38 }, { transform: 'scale(1)', opacity: 0 }], { duration: 650, easing: M.EXPO });
    a.finished.then(() => ink.remove(), () => ink.remove());
  }, { passive: true });
  const MAG = '.btn.primary,.cart-btn,.cart-bar button';
  document.addEventListener('pointermove', (e) => {
    if (M.reduce || !fine.matches) return;
    const t = e.target.closest && e.target.closest(MAG);
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * 8}px ${((e.clientY - r.top) / r.height - 0.5) * 6}px`;
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest && e.target.closest(MAG);
    if (t && !t.contains(e.relatedTarget)) t.style.translate = '';
  }, { passive: true });

  window.LHM = M;
})();
