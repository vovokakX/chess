/*
 * Интерфейс и логика партий: бот, игра на одном устройстве, игра по сети.
 * Режимы: обычные шахматы (classic) и шахматы со способностями (abil).
 */
(() => {
  'use strict';

  const { Game, ABILITY_IDS, opp } = Chess;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const COLOR_NAME = { w: 'белых', b: 'чёрных' };
  const COLOR_WIN = { w: 'Победа белых', b: 'Победа чёрных' };
  const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  const START_COUNT = { Q: 1, R: 2, B: 2, N: 2, P: 8 };

  /* ================= Хранилище ================= */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('chessplus:' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('chessplus:' + k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem('chessplus:' + k); } catch (_) {} },
  };

  const settings = {
    theme: store.get('theme', 'brown'),
    sound: store.get('sound', true),
    name: store.get('name', ''),
    botColor: store.get('botColor', 'w'),
    botLevel: store.get('botLevel', 2),
    hostColor: store.get('hostColor', 'w'),
  };

  /* ================= Звук (синтез, без файлов) ================= */
  const Sound = (() => {
    let ctx = null;
    const ac = () => {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    function noise(t0, dur, { type = 'bandpass', f0 = 1000, f1 = f0, Q = 1.2, gain = 1, decay = 5 } = {}) {
      const c = ac();
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type; f.Q.value = Q;
      const t = c.currentTime + t0;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(c.destination);
      src.start(t);
    }
    function tone(t0, freq, dur, gain = 0.1, type = 'triangle', freqEnd) {
      const c = ac();
      const o = c.createOscillator(); o.type = type;
      const t = c.currentTime + t0;
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    }
    const knock = (t0, f, g, d) => noise(t0, d, { f0: f, Q: 1.4, gain: g });
    const kinds = {
      move: () => knock(0, 950, 1.6, 0.08),
      capture: () => { knock(0, 650, 2, 0.11); knock(0.04, 1500, 0.9, 0.07); },
      castle: () => { knock(0, 950, 1.4, 0.07); knock(0.1, 820, 1.4, 0.07); },
      check: () => { knock(0, 950, 1.4, 0.08); tone(0.03, 880, 0.3, 0.07); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(i * 0.11, f, 0.55)),
      lose: () => [392, 330, 262].forEach((f, i) => tone(i * 0.17, f, 0.6)),
      draw: () => [494, 494].forEach((f, i) => tone(i * 0.2, f, 0.4, 0.08)),
      notify: () => { tone(0, 660, 0.18, 0.08); tone(0.12, 990, 0.28, 0.08); },
      tick: () => knock(0, 2600, 0.7, 0.025),
      reveal: () => [784, 988, 1319].forEach((f, i) => tone(i * 0.07, f, 0.5, 0.06, 'sine')),
      arm: () => { tone(0, 523, 0.2, 0.06, 'sine'); tone(0.06, 784, 0.25, 0.06, 'sine'); },
      necro: () => { [262, 330, 392, 523, 659].forEach((f, i) => tone(i * 0.08, f, 0.7, 0.06, 'sine')); noise(0, 0.9, { type: 'lowpass', f0: 300, f1: 3000, gain: 0.5, decay: 1.5 }); },
      runner: () => { noise(0, 0.45, { f0: 300, f1: 3000, Q: 2, gain: 1.6, decay: 1.2 }); knock(0.5, 800, 1.8, 0.09); },
      tsar: () => { tone(0, 110, 0.9, 0.35, 'sine', 35); noise(0, 0.8, { type: 'lowpass', f0: 900, f1: 120, gain: 1.4, decay: 2 }); tone(0.05, 523, 0.6, 0.05, 'triangle'); },
      kamikaze: () => { noise(0.18, 1.1, { type: 'lowpass', f0: 2400, f1: 80, Q: 0.7, gain: 2.6, decay: 2.2 }); tone(0.18, 80, 0.8, 0.4, 'sine', 30); },
      kamikazeDash: () => noise(0, 0.25, { f0: 600, f1: 2500, Q: 2, gain: 1.2, decay: 1.5 }),
      lullaby: () => [659, 587, 523, 494, 440].forEach((f, i) => tone(0.1 + i * 0.22, f, 0.5, 0.06, 'sine')),
      vampire: () => { tone(0, 220, 0.6, 0.06, 'sawtooth'); tone(0, 233, 0.6, 0.05, 'sawtooth'); tone(0.1, 1760, 0.25, 0.03, 'sine', 880); },
    };
    return { play(k) { if (!settings.sound) return; try { kinds[k] && kinds[k](); } catch (_) {} } };
  })();

  /* ================= Общие UI-помощники ================= */
  let toastTimer = 0;
  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  let wheelCtl = null;
  function modal(html, cls = '') {
    const box = $('#modal-box');
    if (wheelCtl) { wheelCtl.cancel(); wheelCtl = null; }
    box.className = 'modal ' + cls;
    box.removeAttribute('style');
    box.innerHTML = html;
    $('#modal').classList.remove('hidden');
    $('#modal').onclick = null;
    return box;
  }
  function closeModal() {
    if (wheelCtl) { wheelCtl.cancel(); wheelCtl = null; }
    $('#modal').classList.add('hidden');
    $('#modal').onclick = null;
  }
  const modalOpen = () => !$('#modal').classList.contains('hidden');

  function ask({ title, text = '', ok = 'Да', cancel = 'Отмена', onOk, onCancel, img }) {
    const box = modal(`
      ${img ? `<img class="result-ico" src="${img}" alt="">` : ''}
      <h3>${title}</h3>${text ? `<p>${text}</p>` : '<p></p>'}
      <div class="row"><button class="btn" data-a="no">${cancel}</button><button class="btn primary" data-a="yes">${ok}</button></div>`);
    box.querySelector('[data-a=yes]').onclick = () => { closeModal(); onOk && onOk(); };
    box.querySelector('[data-a=no]').onclick = () => { closeModal(); onCancel && onCancel(); };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  function abilityInfo(id, color) {
    const u = ABIL_UI[id];
    const box = modal(`
      <svg class="ab-big"><use href="#a-${id}"/></svg>
      <h3>${u.name}</h3>
      ${color ? `<p class="owner">Способность ${COLOR_NAME[color]}</p>` : ''}
      <p>${u.desc}</p>
      <button class="btn primary big" data-a="ok">Понятно</button>`, 'ability-info');
    box.style.setProperty('--ac', u.color);
    box.querySelector('[data-a=ok]').onclick = closeModal;
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  }

  /* ================= Экраны и кнопка «назад» ================= */
  let current = 'menu';
  function show(id, push = true) {
    current = id;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
    if (id === 'menu') renderResume();
    if (push && id !== 'menu') history.pushState({ s: id }, '');
    if (id === 'game') requestWakeLock(); else releaseWakeLock();
  }

  window.addEventListener('popstate', () => {
    if (modalOpen()) {
      // во время колеса фортуны «назад» не закрывает окно
      if (wheelCtl) { history.pushState({ s: current }, ''); return; }
      closeModal(); history.pushState({ s: current }, ''); return;
    }
    if (current === 'game') { history.pushState({ s: 'game' }, ''); leaveGame(); return; }
    if (current === 'online') { cancelOnlineWait(); }
    show('menu', false);
  });

  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
  }
  function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (_) {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current === 'game') requestWakeLock(); });

  /* ================= Состояние партии ================= */
  const S = {
    variant: 'classic',  // 'classic' | 'abil' — выбор в меню
    mode: null,          // 'bot' | 'local' | 'online'
    game: new Game(),
    myColor: 'w',
    orientation: 'w',
    level: 2,
    result: null,        // { winner: 'w'|'b'|null, reason }
    names: { w: '', b: '' },
    thinking: false,
    aiReq: 0,
    selected: -1,
    targets: new Map(),
    pieceEls: {},
    // способности
    armed: null,         // id способности, которую сейчас применяем
    abilFrom: -1,        // выбранная пешка для Бегуна / Камикадзе
    abilActs: [],
    sleepNote: false,
    wheelOpen: false,
    // сеть
    net: null,
    role: null,
    gameId: null,
    oppName: '',
    connected: false,
    hostColor: 'w',
    netVariant: 'classic',
  };

  /* ================= Доска ================= */
  const boardEl = $('#board');
  const frameEl = $('.board-frame');
  const squaresEl = $('#squares');
  const piecesEl = $('#pieces');

  function toDisplay(sq) {
    let r = sq >> 3, c = sq & 7;
    if (S.orientation === 'b') { r = 7 - r; c = 7 - c; }
    return { r, c };
  }
  function fromDisplay(r, c) {
    if (S.orientation === 'b') { r = 7 - r; c = 7 - c; }
    return r * 8 + c;
  }
  function squareAt(x, y) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    if (r < 0 || r > 7 || c < 0 || c > 7) return -1;
    return fromDisplay(r, c);
  }
  const T = (sq) => { const { r, c } = toDisplay(sq); return `translate(${c * 100}%, ${r * 100}%)`; };
  const pieceUrl = (p) => `pieces/${p}.svg`;

  const FX = makeFX({ fxEl: $('#fx'), boardEl, frameEl, toDisplay });

  /** Подсветка клеток для выбранной способности */
  function abilityMarks() {
    const marks = new Map();
    if (!S.armed || S.armed === 'lullaby') return marks;
    const acts = S.abilActs;
    if (S.armed === 'necro') acts.forEach((m) => marks.set(m.to, 'abil-target'));
    else if (S.armed === 'tsar') {
      if (acts[0]) {
        marks.set(acts[0].from, 'abil-src');
        acts[0].pushes.forEach((p) => marks.set(p.from, 'abil-push'));
      }
    } else if (S.abilFrom < 0) {
      acts.forEach((m) => marks.set(m.from, 'abil-src'));
    } else {
      marks.set(S.abilFrom, 'abil-picked');
      acts.filter((m) => m.from === S.abilFrom).forEach((m) => marks.set(m.to, m.cap ? 'abil-kill' : 'abil-target'));
    }
    return marks;
  }

  function renderSquares() {
    const g = S.game;
    const last = g.history[g.history.length - 1];
    const lastSq = new Set();
    if (last) {
      if (last.kind === 'tsar') lastSq.add(last.from);
      else { if (last.from >= 0) lastSq.add(last.from); if (last.to >= 0) lastSq.add(last.to); }
    }
    const checkSq = g.inCheck() ? g.kings[g.turn] : -1;
    const marks = abilityMarks();
    let html = '';
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const sq = fromDisplay(dr, dc);
        const r = sq >> 3, c = sq & 7;
        const cls = ['sq'];
        if ((r + c) & 1) cls.push('d');
        if (lastSq.has(sq)) cls.push('last');
        if (sq === S.selected) cls.push('sel');
        if (sq === checkSq) cls.push('check');
        const t = S.targets.get(sq);
        if (t) { cls.push('hint'); if (t[0].cap) cls.push('cap'); }
        const mk = marks.get(sq);
        if (mk) cls.push(mk);
        let coords = '';
        if (dc === 0) coords += `<span class="coord rank">${8 - r}</span>`;
        if (dr === 7) coords += `<span class="coord file">${'abcdefgh'[c]}</span>`;
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coords}</div>`;
      }
    }
    squaresEl.innerHTML = html;
    // рамка доски светится цветом активной способности
    const armedColor = S.armed ? ABIL_UI[S.armed].color : null;
    frameEl.classList.toggle('armed', !!armedColor);
    if (armedColor) { boardEl.style.setProperty('--ac', armedColor); frameEl.style.setProperty('--ac', armedColor); }
  }

  /** anim — обычный ход для анимации (или null) */
  function renderPieces(anim) {
    const b = S.game.board;
    piecesEl.innerHTML = '';
    S.pieceEls = {};
    const moving = [];
    if (anim && !anim.kind) {
      moving.push([anim.to, anim.from]);
      const w = anim.p[0] === 'w';
      if (anim.flag === 'k') moving.push([w ? 61 : 5, w ? 63 : 7]);
      if (anim.flag === 'q') moving.push([w ? 59 : 3, w ? 56 : 0]);
    }
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const el = document.createElement('div');
      el.className = 'piece';
      el.style.backgroundImage = `url(${pieceUrl(p)})`;
      const mv = moving.find((m) => m[0] === sq);
      if (mv) {
        el.classList.add('no-anim');
        el.style.transform = T(mv[1]);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.classList.remove('no-anim');
          el.style.transform = T(sq);
        }));
      } else {
        el.style.transform = T(sq);
      }
      piecesEl.appendChild(el);
      S.pieceEls[sq] = el;
    }
    if (anim && !anim.kind && anim.cap) {
      const capSq = anim.flag === 'e' ? anim.to + (anim.p[0] === 'w' ? 8 : -8) : anim.to;
      const g = ghost(anim.cap, capSq);
      g.style.zIndex = 0;
      g.style.setProperty('--t', T(capSq));
      g.classList.add('fade');
      setTimeout(() => g.remove(), 260);
    }
  }

  function ghost(p, sq) {
    const el = document.createElement('div');
    el.className = 'piece ghost no-anim';
    el.style.backgroundImage = `url(${pieceUrl(p)})`;
    el.style.transform = T(sq);
    piecesEl.appendChild(el);
    return el;
  }

  function render(anim = null) {
    renderSquares();
    renderPieces(anim);
    renderPanels();
  }

  /* ================= Эффекты способностей ================= */
  function abilityFx(mv) {
    const u = ABIL_UI[mv.kind];
    const col = u.color;
    const EASE = 'cubic-bezier(.25,.8,.35,1)';

    if (mv.kind === 'necro') {
      const el = S.pieceEls[mv.to];
      if (el) el.animate([
        { opacity: 0, transform: `${T(mv.to)} translateY(40%) scale(.2)`, filter: `brightness(3) drop-shadow(0 0 12px ${col})` },
        { opacity: 1, transform: `${T(mv.to)} translateY(-12%) scale(1.15)`, filter: `brightness(1.8) drop-shadow(0 0 14px ${col})`, offset: 0.6 },
        { opacity: 1, transform: T(mv.to), filter: 'brightness(1) drop-shadow(0 0 0 transparent)' },
      ], { duration: 1000, easing: 'ease-out' });
      FX.ring(mv.to, col, { scale: 2.6 });
      FX.ring(mv.to, col, { scale: 1.8, delay: 180 });
      FX.particles(mv.to, { colors: [col, '#c8ffd9', '#3fbf74'], n: 22, dist: 0.6, rise: 1.4, size: 0.1, dur: 1100 });
      FX.icon(mv.to, 'a-necro', col);
      return;
    }

    if (mv.kind === 'runner') {
      const el = S.pieceEls[mv.to];
      const a = toDisplay(mv.from), b = toDisplay(mv.to);
      const mid = `translate(${((a.c + b.c) / 2) * 100}%, ${((a.r + b.r) / 2) * 100 - 70}%) scale(1.45)`;
      if (mv.cap) {
        const gh = ghost(mv.cap, mv.to);
        setTimeout(() => {
          gh.animate([{ opacity: 1, transform: T(mv.to) }, { opacity: 0, transform: `${T(mv.to)} scale(.3) rotate(25deg)` }], { duration: 300, fill: 'forwards' }).onfinish = () => gh.remove();
        }, 560);
      }
      if (el) el.animate([
        { transform: T(mv.from), filter: `drop-shadow(0 0 0 ${col})` },
        { transform: mid, filter: `drop-shadow(0 14px 10px rgba(0,0,0,.45)) drop-shadow(0 0 12px ${col})`, offset: 0.5 },
        { transform: `${T(mv.to)} scale(1.08, .9)`, offset: 0.88 },
        { transform: T(mv.to), filter: `drop-shadow(0 0 0 ${col})` },
      ], { duration: 680, easing: 'cubic-bezier(.3,.6,.4,1)' });
      FX.trail(mv.from, mv.to, col, { n: 14, dur: 560, arc: 0.7 });
      setTimeout(() => {
        FX.ring(mv.to, col, { scale: 2.4 });
        FX.particles(mv.to, { colors: [col, '#e8f7ff'], n: mv.cap ? 24 : 14, dist: 0.9, size: 0.1 });
        if (mv.cap) FX.shake(4);
      }, 580);
      return;
    }

    if (mv.kind === 'kamikaze') {
      if (mv.cap) {
        const target = ghost(mv.cap, mv.to);
        const pawn = ghost(mv.p, mv.from);
        pawn.animate([{ transform: T(mv.from) }, { transform: `${T(mv.to)} scale(1.15)` }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
        FX.trail(mv.from, mv.to, col, { n: 8, dur: 200 });
        setTimeout(() => {
          pawn.remove();
          target.animate([
            { opacity: 1, transform: T(mv.to), filter: 'brightness(4)' },
            { opacity: 0, transform: `${T(mv.to)} scale(1.6) rotate(-30deg)`, filter: 'brightness(4) blur(4px)' },
          ], { duration: 380, fill: 'forwards', easing: 'ease-out' }).onfinish = () => target.remove();
          FX.flash(mv.to, '#ffb347', { size: 3.2, dur: 550 });
          FX.ring(mv.to, '#ff7a45', { scale: 4.2, width: 0.12, dur: 700 });
          FX.ring(mv.to, '#ffe08a', { scale: 2.6, dur: 500, delay: 60 });
          FX.particles(mv.to, { colors: ['#ff7a45', '#ffb347', '#ffe08a', '#ff3b2f'], n: 36, dist: 1.8, size: 0.13, dur: 900 });
          FX.particles(mv.to, { colors: ['#5a5550', '#3c3936', '#7b746c'], n: 14, dist: 0.9, size: 0.3, dur: 1500, rise: 0.8, glow: false, delay: 120 });
          FX.shake(11, 600);
          if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
        }, 220);
      } else {
        const el = S.pieceEls[mv.to];
        if (el) el.animate([{ transform: T(mv.from) }, { transform: `${T(mv.to)} scale(1.1)`, offset: 0.8 }, { transform: T(mv.to) }], { duration: 320, easing: EASE });
        FX.trail(mv.from, mv.to, col, { n: 10, dur: 260 });
        setTimeout(() => FX.particles(mv.to, { colors: [col, '#ffe08a'], n: 12, dist: 0.6, size: 0.08 }), 280);
      }
      return;
    }

    if (mv.kind === 'tsar') {
      const king = S.pieceEls[mv.from];
      if (king) king.animate([
        { transform: T(mv.from), filter: 'none' },
        { transform: `${T(mv.from)} scale(1.35)`, filter: `drop-shadow(0 0 16px ${col}) brightness(1.3)`, offset: 0.3 },
        { transform: T(mv.from), filter: 'none' },
      ], { duration: 700, easing: 'ease-out' });
      FX.flash(mv.from, col, { size: 2.6 });
      FX.ring(mv.from, col, { scale: 5.5, width: 0.1, dur: 750, delay: 120 });
      FX.ring(mv.from, '#fff3d6', { scale: 4, dur: 650, delay: 220 });
      FX.icon(mv.from, 'a-tsar', col, { size: 1 });
      for (const p of mv.pushes) {
        const el = S.pieceEls[p.to];
        if (!el) continue;
        el.animate([
          { transform: T(p.from) },
          { transform: T(p.from), offset: 0.22 },
          { transform: `${T(p.to)} rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`, offset: 0.75 },
          { transform: T(p.to) },
        ], { duration: 820, easing: 'cubic-bezier(.2,1.3,.4,1)' });
        setTimeout(() => FX.particles(p.to, { colors: ['#d8c8a8', '#a89878', col], n: 8, dist: 0.45, size: 0.09, glow: false, dur: 600 }), 520);
      }
      setTimeout(() => FX.shake(8, 500), 150);
      return;
    }
  }

  function vampireFx(mv) {
    const col = ABIL_UI.vampire.color;
    const capSq = mv.flag === 'e' ? mv.to + (mv.p[0] === 'w' ? 8 : -8) : mv.to;
    const el = S.pieceEls[mv.vamp];
    if (el) el.animate([
      { opacity: 0, transform: `${T(capSq)} scale(.3)`, filter: `brightness(2) drop-shadow(0 0 14px ${col}) hue-rotate(-30deg)` },
      { opacity: 0.9, transform: `${T(capSq)} scale(.6)`, offset: 0.3, filter: `brightness(2) drop-shadow(0 0 14px ${col})` },
      { opacity: 1, transform: T(mv.vamp), filter: 'none' },
    ], { duration: 900, easing: 'cubic-bezier(.3,1.3,.4,1)', delay: 150, fill: 'backwards' });
    FX.particles(capSq, { colors: [col, '#8b0020', '#ff98aa'], n: 22, dist: 0.8, size: 0.1, gravity: 0.4, delay: 120 });
    FX.trail(capSq, mv.vamp, col, { n: 6, dur: 350 });
    setTimeout(() => FX.ring(mv.vamp, col, { scale: 2 }), 700);
    setTimeout(() => FX.icon(mv.vamp, 'a-vampire', col, { size: 0.9 }), 250);
  }

  function lullabyFx(mv) {
    const col = ABIL_UI.lullaby.color;
    const foe = opp(mv.color);
    const kingSq = S.game.kings[foe];
    setTimeout(() => {
      FX.night(1900);
      FX.zzz(kingSq, col, { n: 4 });
      FX.icon(kingSq, 'a-lullaby', col, { size: 1.1, dur: 1300 });
      const k = S.pieceEls[kingSq];
      if (k) k.animate([
        { transform: T(kingSq) },
        { transform: `${T(kingSq)} rotate(-12deg)`, offset: 0.25 },
        { transform: `${T(kingSq)} rotate(10deg)`, offset: 0.5 },
        { transform: `${T(kingSq)} rotate(-6deg)`, offset: 0.75 },
        { transform: T(kingSq) },
      ], { duration: 1800, easing: 'ease-in-out' });
    }, 220);
  }

  /* ================= Панели игроков, статус, ходы ================= */
  function capturedHtml(color) {
    const g = S.game, enemy = opp(color);
    const cnt = { Q: 0, R: 0, B: 0, N: 0, P: 0 };
    let myMat = 0, enMat = 0;
    for (const p of g.board) {
      if (!p || p[1] === 'K') continue;
      if (p[0] === enemy) cnt[p[1]]++;
      if (p[0] === color) myMat += VAL[p[1]]; else enMat += VAL[p[1]];
    }
    let html = '';
    for (const t of ['P', 'N', 'B', 'R', 'Q']) {
      const n = Math.max(0, START_COUNT[t] - cnt[t]);
      for (let i = 0; i < n; i++) html += `<img src="${pieceUrl(enemy + t)}" alt=""${i === 0 && html ? ' class="gap"' : ''}>`;
    }
    if (myMat > enMat) html += `<span class="adv">+${myMat - enMat}</span>`;
    return html;
  }

  /** Может ли этот игрок (на этом устройстве) применять способность цвета color */
  function controlsColor(color) {
    if (S.mode === 'local') return true;
    return color === S.myColor;
  }

  function renderChip(chip, color) {
    const g = S.game;
    const id = g.abilityOf(color);
    chip.classList.toggle('hidden', !id);
    if (!id) return;
    const u = ABIL_UI[id];
    const passive = Chess.ABILITIES[id].passive;
    const total = Chess.ABILITIES[id].uses;
    const left = g.uses[color];
    let uses = '';
    if (passive) uses = '<span class="inf">∞</span>';
    else for (let i = 0; i < total; i++) uses += `<i class="${i < left ? '' : 'off'}"></i>`;
    chip.innerHTML = `<svg><use href="#a-${id}"/></svg><span>${u.name}</span><span class="uses">${uses}</span>`;
    chip.style.setProperty('--ac', u.color);
    chip.dataset.color = color;
    const myTurn = !S.result && g.turn === color && controlsColor(color) && canInteract();
    chip.classList.toggle('spent', !passive && left <= 0);
    chip.classList.toggle('armed', S.armed === id && g.turn === color);
    chip.classList.toggle('usable', myTurn && !passive && left > 0 && S.armed !== id);
  }

  function renderPanels() {
    const g = S.game;
    const bottom = S.orientation, top = opp(bottom);
    for (const [id, color] of [['#player-top', top], ['#player-bottom', bottom]]) {
      const el = $(id);
      el.querySelector('.avatar').style.backgroundImage = `url(${pieceUrl(color + 'K')})`;
      el.querySelector('.pname').textContent = S.names[color] || (color === 'w' ? 'Белые' : 'Чёрные');
      el.querySelector('.captured').innerHTML = capturedHtml(color);
      el.classList.toggle('to-move', !S.result && g.turn === color);
      renderChip(el.querySelector('.abil-chip'), color);
    }

    const st = $('#status');
    const txt = $('#status-text');
    st.className = 'status';
    if (g.turn === 'b') st.classList.add('black');
    if (S.result) {
      st.classList.add('over');
      txt.textContent = resultTitle(S.result).short;
    } else if (S.mode === 'online' && !S.connected) {
      txt.textContent = 'Соперник не в сети';
    } else if (S.thinking) {
      st.classList.add('thinking');
      txt.textContent = 'Бот думает';
    } else if (S.armed) {
      const u = ABIL_UI[S.armed];
      let hint = u.hint;
      if ((S.armed === 'runner' || S.armed === 'kamikaze') && S.abilFrom >= 0) hint = 'куда?';
      txt.textContent = `${u.name}: ${hint}`;
    } else {
      const check = g.inCheck();
      if (check) st.classList.add('check');
      let s;
      if (S.mode === 'local') s = `Ход ${COLOR_NAME[g.turn]}`;
      else s = g.turn === S.myColor ? 'Ваш ход' : 'Ход соперника';
      if (S.sleepNote) {
        if (S.mode === 'local') s = `${g.turn === 'w' ? 'Чёрные спят' : 'Белые спят'} · ходят ${COLOR_NAME[g.turn]}`.replace('ходят белых', 'ходят белые').replace('ходят чёрных', 'ходят чёрные');
        else s = g.turn === S.myColor ? 'Соперник спит · ходи ещё' : 'Вы уснули…';
      }
      txt.textContent = check ? s + ' · Шах!' : s;
    }

    const pill = $('#net-pill');
    pill.classList.toggle('hidden', S.mode !== 'online');
    pill.classList.toggle('off', !S.connected);
    pill.querySelector('b').textContent = S.connected ? 'Онлайн' : 'Офлайн';

    renderMoves();
    renderActions();
  }

  function renderMoves() {
    const h = S.game.history;
    const el = $('#moves');
    if (!h.length) { el.innerHTML = '<span class="empty">Ходов пока нет</span>'; return; }
    // ход «Колыбельной» и следующий за ним ход того же игрока объединяем в одну клетку
    const cells = [];
    for (let i = 0; i < h.length; i++) {
      const prev = h[i - 1];
      if (prev && prev.slept && prev.color === h[i].color) cells[cells.length - 1].san += ' ' + h[i].san;
      else cells.push({ san: h[i].san, color: h[i].color });
    }
    let html = '', n = 1;
    for (let i = 0; i < cells.length; i++) {
      const isLast = i === cells.length - 1;
      if (cells[i].color === 'w' || i === 0) {
        html += `<span class="num">${n++}.</span>`;
        if (cells[i].color === 'b') html += '<span class="mv">…</span>';
      }
      html += `<span class="mv${isLast ? ' cur' : ''}">${esc(cells[i].san)}</span>`;
      if (cells[i].color === 'w' && (!cells[i + 1] || cells[i + 1].color === 'w')) html += '<span></span>';
    }
    el.innerHTML = html;
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  }

  function renderActions() {
    const over = !!S.result;
    const h = S.game.history.length;
    const undo = $('#undo-btn'), draw = $('#draw-btn'), resign = $('#resign-btn'), nw = $('#new-btn');
    undo.classList.toggle('hidden', S.mode === 'online');
    undo.disabled = h === 0;
    draw.disabled = over || h < 2;
    resign.disabled = over;
    if (S.mode === 'online') {
      nw.querySelector('span').textContent = 'Реванш';
      nw.disabled = !over || !S.connected;
    } else {
      nw.querySelector('span').textContent = 'Заново';
      nw.disabled = false;
    }
  }

  /* ================= Способности: включение ================= */
  function disarm() {
    if (!S.armed) return;
    S.armed = null;
    S.abilFrom = -1;
    S.abilActs = [];
    renderSquares();
    renderPanels();
  }

  function onChipClick(chip) {
    const color = chip.dataset.color;
    const g = S.game;
    const id = g.abilityOf(color);
    if (!id) return;
    const canUse = !S.result && g.turn === color && controlsColor(color) && canInteract();
    if (!canUse || Chess.ABILITIES[id].passive || g.uses[color] <= 0) { abilityInfo(id, color); return; }
    if (S.armed === id) { disarm(); return; }
    if (id === 'lullaby') {
      S.armed = 'lullaby';
      S.selected = -1; S.targets = new Map();
      Sound.play('arm');
      toast('Колыбельная: сделай ход — соперник пропустит свой');
      renderSquares(); renderPanels();
      return;
    }
    const acts = g.abilityMoves();
    if (!acts.length) {
      const why = { necro: 'Нечего воскрешать: все пешки на месте или 2-й ряд занят.', runner: 'Ни одна пешка не может прыгнуть сейчас.', kamikaze: 'Ни одна пешка не может так сходить.', tsar: 'Рядом с королём некого отбрасывать (или это подставит короля).' };
      toast(why[id] || 'Сейчас нельзя применить', 3000);
      return;
    }
    S.armed = id;
    S.abilActs = acts;
    S.abilFrom = -1;
    S.selected = -1; S.targets = new Map();
    Sound.play('arm');
    renderSquares(); renderPanels();
  }
  $$('.abil-chip').forEach((c) => { c.onclick = () => onChipClick(c); });

  /** Нажатие на доску во время применения способности. true — нажатие обработано */
  function abilityTap(sq) {
    const id = S.armed;
    if (!id || id === 'lullaby') return false;
    const acts = S.abilActs;
    let act = null;
    if (id === 'necro') act = acts.find((m) => m.to === sq);
    else if (id === 'tsar') act = sq === acts[0].from ? acts[0] : null;
    else if (S.abilFrom >= 0) {
      act = acts.find((m) => m.from === S.abilFrom && m.to === sq);
      if (!act && acts.some((m) => m.from === sq)) { S.abilFrom = sq; renderSquares(); renderPanels(); return true; }
    } else if (acts.some((m) => m.from === sq)) {
      S.abilFrom = sq; renderSquares(); renderPanels(); return true;
    }
    if (act) { applyAct(Game.desc(act), 'me'); return true; }
    disarm();
    return true;
  }

  /* ================= Выбор и перетаскивание фигур ================= */
  function canInteract() {
    if (S.result || current !== 'game' || S.wheelOpen) return false;
    if (S.mode === 'bot') return !S.thinking && S.game.turn === S.myColor;
    if (S.mode === 'online') return S.connected && S.game.turn === S.myColor;
    return true;
  }
  function canMove(p) { return p && canInteract() && p[0] === S.game.turn; }

  function select(sq) {
    S.selected = sq;
    S.targets = new Map();
    for (const m of S.game.movesFrom(sq)) {
      if (!S.targets.has(m.to)) S.targets.set(m.to, []);
      S.targets.get(m.to).push(m);
    }
    renderSquares();
  }
  function deselect() {
    if (S.selected < 0) return;
    S.selected = -1;
    S.targets = new Map();
    renderSquares();
  }

  let drag = null;
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq < 0) return;
    if (S.armed && S.armed !== 'lullaby') { if (canInteract()) abilityTap(sq); else disarm(); return; }
    const p = S.game.board[sq];

    if (S.selected >= 0 && S.targets.has(sq)) { tryMove(S.selected, sq, false); return; }
    if (canMove(p)) {
      const wasSelected = S.selected === sq;
      select(sq);
      const el = S.pieceEls[sq];
      drag = { sq, el, x0: e.clientX, y0: e.clientY, moved: false, wasSelected, hover: -1 };
      try { boardEl.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
      return;
    }
    deselect();
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const rect = boardEl.getBoundingClientRect();
    const size = rect.width / 8;
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translate(${e.clientX - rect.left - size / 2}px, ${e.clientY - rect.top - size / 2}px) scale(1.12)`;
    const over = squareAt(e.clientX, e.clientY);
    if (over !== drag.hover) {
      const prev = squaresEl.querySelector('.hover');
      if (prev) prev.classList.remove('hover');
      drag.hover = over;
      if (over >= 0 && S.targets.has(over)) {
        const el = squaresEl.querySelector(`[data-sq="${over}"]`);
        if (el) el.classList.add('hover');
      }
    }
  });

  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const prev = squaresEl.querySelector('.hover');
    if (prev) prev.classList.remove('hover');
    const target = cancelled ? -1 : squareAt(e.clientX, e.clientY);
    if (d.moved && target >= 0 && target !== d.sq && S.targets.has(target)) {
      tryMove(d.sq, target, true);
      return;
    }
    d.el.classList.remove('dragging');
    if (d.moved) d.el.style.transform = T(d.sq);
    else if (d.wasSelected) deselect();
  }
  boardEl.addEventListener('pointerup', (e) => endDrag(e, false));
  boardEl.addEventListener('pointercancel', (e) => endDrag(e, true));
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  function tryMove(from, to, dropped) {
    const cands = S.targets.get(to);
    if (!cands) return;
    const lull = S.armed === 'lullaby' ? 1 : undefined;
    if (cands.length > 1 && cands[0].promo) {
      promotionPicker(cands[0].p[0], (promo) => {
        if (!promo) { render(); return; }
        applyAct({ k: 'm', f: from, t: to, p: promo, l: lull }, 'me', true);
      });
      return;
    }
    applyAct({ k: 'm', f: from, t: to, p: cands[0].promo || undefined, l: lull }, 'me', dropped);
  }

  function promotionPicker(color, cb) {
    const box = modal(`
      <h3>Превращение</h3><p>Выбери фигуру</p>
      <div class="promo-grid">
        ${['Q', 'R', 'B', 'N'].map((t) => `<button data-p="${t}"><img src="${pieceUrl(color + t)}" alt=""></button>`).join('')}
      </div>`);
    box.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { closeModal(); cb(b.dataset.p); }; });
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') { closeModal(); cb(null); } };
  }

  /* ================= Ходы и действия ================= */
  function cleanDesc(d) {
    const o = { k: d.k || 'm', f: d.f, t: d.t };
    if (d.p) o.p = d.p;
    if (d.l) o.l = 1;
    return o;
  }

  function applyAct(desc, source, noAnim) {
    const d = cleanDesc(desc);
    const mv = S.game.act(d);
    if (!mv) return null;
    const wasLullArmed = S.armed === 'lullaby';
    S.selected = -1;
    S.targets = new Map();
    S.armed = null; S.abilFrom = -1; S.abilActs = [];
    S.sleepNote = !!mv.slept;
    render(mv.kind || noAnim ? null : mv);

    // эффекты и звук
    if (mv.kind) {
      abilityFx(mv);
      Sound.play(mv.kind);
      flashChip(mv.color);
      if (mv.kind === 'kamikaze' && mv.cap) Sound.play('kamikazeDash');
    } else {
      if (mv.san.includes('+') || mv.san.includes('#')) Sound.play('check');
      else if (mv.flag === 'k' || mv.flag === 'q') Sound.play('castle');
      else if (mv.cap) Sound.play('capture');
      else Sound.play('move');
      if (mv.vamp >= 0) { vampireFx(mv); setTimeout(() => Sound.play('vampire'), 120); }
      if (mv.slept) { lullabyFx(mv); Sound.play('lullaby'); flashChip(mv.color); }
      else if (wasLullArmed && d.l && source === 'me') toast('Шах разбудил соперника — Колыбельная не потрачена', 3000);
    }
    if (navigator.vibrate && source === 'opp') navigator.vibrate(15);

    if (S.mode === 'online' && source === 'me') S.net.send({ type: 'act', a: d, ply: S.game.history.length });

    const st = S.game.status();
    if (st) finish({ winner: st.winner, reason: st.type }, false, mv.kind ? 1100 : 650);
    else if (S.mode === 'bot' && S.game.turn !== S.myColor) botMove(mv.kind || mv.slept ? 900 : 0);
    saveLocalGame();
    return mv;
  }

  function flashChip(color) {
    const chip = $$('.abil-chip').find((c) => c.dataset.color === color);
    if (!chip) return;
    chip.classList.remove('flash'); void chip.offsetWidth; chip.classList.add('flash');
  }

  /* ================= Конец партии ================= */
  const REASONS = {
    checkmate: 'Мат', stalemate: 'Пат', insufficient: 'Недостаточно фигур для мата',
    fifty: 'Правило 50 ходов', repetition: 'Троекратное повторение', agreement: 'По согласию',
    resign: 'Сдача', left: 'Соперник покинул игру',
  };

  function resultTitle(r) {
    const reason = REASONS[r.reason] || '';
    if (!r.winner) return { title: 'Ничья', short: `Ничья · ${reason}`, kind: 'draw', text: reason };
    if (S.mode === 'local') {
      const loser = opp(r.winner);
      const text = r.reason === 'resign' ? `${cap(COLOR_NAME[loser])} сдались` : reason;
      return { title: COLOR_WIN[r.winner], short: `${reason} · ${COLOR_WIN[r.winner].toLowerCase()}`, kind: 'win', text };
    }
    const won = r.winner === S.myColor;
    let text = reason;
    if (r.reason === 'resign') text = won ? 'Соперник сдался' : 'Вы сдались';
    if (r.reason === 'checkmate') text = won ? 'Мат! Отличная партия.' : 'Вам поставили мат.';
    return { title: won ? 'Победа!' : 'Поражение', short: won ? `Победа · ${reason}` : `Поражение · ${reason}`, kind: won ? 'win' : 'lose', text };
  }

  function finish(result, silent, delay = 650) {
    S.result = result;
    S.thinking = false;
    S.armed = null; S.abilFrom = -1;
    S.aiReq++;
    renderSquares();
    renderPanels();
    saveLocalGame();
    if (silent) return;
    const t = resultTitle(result);
    setTimeout(() => Sound.play(t.kind === 'win' ? 'win' : t.kind === 'lose' ? 'lose' : 'draw'), delay - 300);
    setTimeout(() => showResult(), delay);
  }

  function showResult() {
    if (!S.result || current !== 'game') return;
    const t = resultTitle(S.result);
    const img = S.result.winner ? pieceUrl(S.result.winner + 'K') : 'pieces/wN.svg';
    const again = S.mode === 'online' ? 'Реванш' : 'Ещё раз';
    const box = modal(`
      <img class="result-ico" src="${img}" alt="">
      <h3>${t.title}</h3><p>${esc(t.text)}</p>
      <div class="row">
        <button class="btn" data-a="view">Доска</button>
        <button class="btn primary" data-a="again" ${S.mode === 'online' && !S.connected ? 'disabled' : ''}>${again}</button>
      </div>
      <button class="btn" data-a="menu" style="width:100%;margin-top:8px">В меню</button>`, t.kind === 'win' ? 'win' : '');
    box.querySelector('[data-a=view]').onclick = closeModal;
    box.querySelector('[data-a=again]').onclick = () => { closeModal(); newGameAction(true); };
    box.querySelector('[data-a=menu]').onclick = () => { closeModal(); leaveGame(true); };
  }

  /* ================= Бот ================= */
  let worker = null, workerBroken = false;
  function getWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      worker = new Worker('js/ai-worker.js');
      worker.onmessage = (e) => onBotResult(e.data.id, e.data.d);
      worker.onerror = () => {
        workerBroken = true; worker = null;
        if (S.thinking) runBotMainThread(S.aiReq);
      };
    } catch (_) { workerBroken = true; worker = null; }
    return worker;
  }

  let botStarted = 0, botMinDelay = 450;
  function botMove(extraDelay = 0) {
    S.thinking = true;
    const id = ++S.aiReq;
    botStarted = Date.now();
    botMinDelay = 450 + extraDelay;
    renderPanels();
    const w = getWorker();
    const payload = { id, abil: S.game.abil, acts: S.game.history.map((m) => m.d), level: S.level };
    if (w) w.postMessage(payload);
    else runBotMainThread(id);
  }

  function runBotMainThread(id) {
    setTimeout(() => {
      if (id !== S.aiReq) return;
      const g = new Game(undefined, S.game.abil);
      for (const m of S.game.history) g.act(m.d);
      const m = ChessAI.bestMove(g, S.level);
      onBotResult(id, m ? Game.desc(m) : null);
    }, 60);
  }

  function onBotResult(id, d) {
    if (id !== S.aiReq || S.mode !== 'bot' || S.result || !d) return;
    const wait = Math.max(0, botMinDelay - (Date.now() - botStarted));
    setTimeout(() => {
      if (id !== S.aiReq) return;
      S.thinking = false;
      if (!applyAct(d, 'bot')) renderPanels();
    }, wait);
  }

  /* ================= Запуск партий ================= */
  function randomAbilities() {
    const pickOne = () => ABILITY_IDS[(Math.random() * ABILITY_IDS.length) | 0];
    return { w: pickOne(), b: pickOne() };
  }

  /**
   * Запустить партию. spin — показать колесо фортуны перед началом.
   */
  function startGame({ mode, myColor = 'w', names, acts = [], result = null, level, abil = null, spin = false }) {
    S.aiReq++;
    S.mode = mode;
    S.game = new Game(undefined, abil);
    for (const d of acts) S.game.act(d);
    S.myColor = myColor;
    S.orientation = mode === 'local' ? 'w' : myColor;
    if (level) S.level = level;
    S.names = names;
    S.result = result;
    S.thinking = false;
    S.selected = -1;
    S.targets = new Map();
    S.armed = null; S.abilFrom = -1; S.abilActs = [];
    const last = S.game.history[S.game.history.length - 1];
    S.sleepNote = !!(last && last.slept);
    closeModal();
    if (current !== 'game') show('game');
    render();
    saveLocalGame();
    const kickBot = () => { if (!S.result && mode === 'bot' && S.game.turn !== S.myColor) setTimeout(() => botMove(), 300); };
    if (spin && abil) {
      S.wheelOpen = true;
      renderPanels();
      const box = modal('');
      wheelCtl = runWheel(box, abil, {
        sound: (k) => Sound.play(k),
        startText: 'В бой!',
        onDone: () => { wheelCtl = null; S.wheelOpen = false; closeModal(); render(); kickBot(); },
      });
    } else {
      S.wheelOpen = false;
      kickBot();
    }
  }

  function startBot() {
    let color = settings.botColor;
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    const lvl = Number(settings.botLevel);
    const me = settings.name || 'Вы';
    const bot = `Бот · ${ChessAI.LEVELS[lvl].name}`;
    const abil = S.variant === 'abil' ? randomAbilities() : null;
    startGame({ mode: 'bot', myColor: color, level: lvl, abil, spin: !!abil, names: color === 'w' ? { w: me, b: bot } : { w: bot, b: me } });
  }

  function startLocal() {
    const abil = S.variant === 'abil' ? randomAbilities() : null;
    startGame({ mode: 'local', abil, spin: !!abil, names: { w: 'Белые', b: 'Чёрные' } });
  }

  /* ---------- сохранение партии с ботом / локальной ---------- */
  function saveLocalGame() {
    if (S.mode !== 'bot' && S.mode !== 'local') return;
    if (S.result || !S.game.history.length) { store.del('saved2'); return; }
    store.set('saved2', { mode: S.mode, myColor: S.myColor, level: S.level, names: S.names, abil: S.game.abil, acts: S.game.history.map((m) => m.d) });
  }

  function renderResume() {
    const saved = store.get('saved2', null);
    let el = $('#resume-card');
    if (!saved) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = 'resume-card';
      el.className = 'mode-card accent';
      $('#screen-menu .mode-list').prepend(el);
      el.onclick = () => {
        const s = store.get('saved2', null);
        if (s) startGame({ mode: s.mode, myColor: s.myColor, names: s.names, acts: s.acts, level: s.level, abil: s.abil });
      };
    }
    const n = Math.ceil(saved.acts.length / 2);
    let what = saved.mode === 'bot' ? `с ботом (${ChessAI.LEVELS[saved.level].name.toLowerCase()})` : 'на одном устройстве';
    if (saved.abil) what += ', со способностями';
    el.innerHTML = `<span class="mode-ico"><svg><use href="#i-undo"/></svg></span>
      <span class="mode-text"><b>Продолжить партию</b><small>Игра ${what}, ход ${n}</small></span>`;
  }

  /* ================= Кнопки партии ================= */
  function leaveGame(force) {
    const go = () => {
      if (S.mode === 'online') { S.net && S.net.send({ type: 'bye' }); stopNet(); }
      S.aiReq++;
      S.thinking = false;
      S.wheelOpen = false;
      closeModal();
      show('menu', false);
    };
    if (force || S.result || S.mode !== 'online') { go(); return; }
    ask({ title: 'Выйти из игры?', text: 'Соединение с соперником будет разорвано.', ok: 'Выйти', onOk: go });
  }

  $('#game-menu').onclick = () => leaveGame();
  $('#flip-btn').onclick = () => { S.orientation = opp(S.orientation); render(); };

  $('#undo-btn').onclick = () => {
    const g = S.game;
    if (!g.history.length) return;
    S.aiReq++;
    S.thinking = false;
    S.result = null;
    S.armed = null; S.abilFrom = -1;
    g.undo();
    if (S.mode === 'bot') {
      while (g.history.length && g.turn !== S.myColor) g.undo();
    }
    const last = g.history[g.history.length - 1];
    S.sleepNote = !!(last && last.slept);
    S.selected = -1; S.targets = new Map();
    render();
    saveLocalGame();
    if (S.mode === 'bot' && g.turn !== S.myColor) botMove();
  };

  $('#resign-btn').onclick = () => {
    if (S.result) return;
    const loser = S.mode === 'local' ? S.game.turn : S.myColor;
    ask({
      title: 'Сдаться?', text: S.mode === 'local' ? `Сдаются ${COLOR_NAME[loser]}.` : 'Партия будет засчитана как поражение.',
      ok: 'Сдаться', img: pieceUrl(loser + 'K'),
      onOk: () => {
        if (S.mode === 'online') S.net.send({ type: 'resign' });
        finish({ winner: opp(loser), reason: 'resign' });
      },
    });
  };

  $('#draw-btn').onclick = () => {
    if (S.result) return;
    if (S.mode === 'local') {
      ask({ title: 'Ничья?', text: 'Оба игрока согласны на ничью?', ok: 'Ничья', onOk: () => finish({ winner: null, reason: 'agreement' }) });
    } else if (S.mode === 'bot') {
      const botColor = opp(S.myColor);
      let score = 0;
      for (const p of S.game.board) if (p) score += (p[0] === botColor ? 1 : -1) * VAL[p[1]];
      if (score <= 0 && S.game.history.length >= 20) { toast('Бот согласился на ничью'); finish({ winner: null, reason: 'agreement' }); }
      else toast('Бот отказался от ничьей');
    } else {
      S.net.send({ type: 'draw-offer' });
      toast('Предложение ничьей отправлено');
    }
  };

  $('#new-btn').onclick = () => newGameAction(false);

  function newGameAction(fromResult) {
    if (S.mode === 'online') {
      if (!S.result) return;
      S.net.send({ type: 'rematch-offer' });
      toast('Предложение реванша отправлено');
      return;
    }
    S.variant = S.game.abil ? 'abil' : 'classic';
    const restart = () => (S.mode === 'bot' ? startBot() : startLocal());
    if (fromResult || S.result || !S.game.history.length) restart();
    else ask({ title: 'Начать заново?', text: 'Текущая партия будет потеряна.', ok: 'Заново', onOk: restart });
  }

  /* ================= Игра по сети ================= */
  function stopNet() {
    if (S.net) S.net.destroy();
    S.net = null;
    S.connected = false;
    S.role = null;
    S.gameId = null;
  }

  function myName() { return (settings.name || '').trim() || 'Игрок'; }
  function saveName() {
    settings.name = $('#my-name').value.trim().slice(0, 16);
    store.set('name', settings.name);
  }

  function showWait(code, isHost) {
    $('#online-setup').classList.add('hidden');
    $('#online-wait').classList.remove('hidden');
    $('#big-code').textContent = code || '·····';
    $('.wait-actions').classList.toggle('hidden', !isHost || !code);
    $('.hint-text').classList.toggle('hidden', !isHost);
  }
  function cancelOnlineWait() {
    stopNet();
    $('#online-setup').classList.remove('hidden');
    $('#online-wait').classList.add('hidden');
  }

  function inviteLink() {
    return location.origin + location.pathname + '?join=' + S.net.code;
  }

  function netHandlers() {
    return {
      onCode(code) {
        showWait(code, true);
        $('#wait-text').textContent = 'Ждём соперника…';
      },
      onOpen() {
        S.connected = true;
        S.net.send({ type: 'hello', name: myName() });
        if (S.mode === 'online' && current === 'game') { toast('Соперник на связи'); renderPanels(); }
        if (S.role === 'guest' && current !== 'game') $('#wait-text').textContent = 'Подключено, загружаю партию…';
      },
      onClose() {
        S.connected = false;
        if (S.mode === 'online' && current === 'game') {
          toast(S.role === 'guest' ? 'Связь потеряна, переподключаюсь…' : 'Соперник отключился. Ждём…', 3000);
          renderPanels();
        }
      },
      onStatus(msg) { if (current === 'online') $('#wait-text').textContent = msg; },
      onError(msg) {
        toast(msg, 3500);
        if (current === 'online') cancelOnlineWait();
      },
      onMessage: onNetMessage,
    };
  }

  function hostGame() {
    saveName();
    stopNet();
    S.role = 'host';
    S.mode = null;
    S.netVariant = S.variant;
    S.hostColor = settings.hostColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.hostColor;
    showWait(null, true);
    $('#wait-text').textContent = 'Подключаюсь к серверу…';
    S.net = new Net(netHandlers());
    S.net.host();
  }

  function joinGame(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length < 4) { toast('Введи код игры'); return; }
    saveName();
    stopNet();
    S.role = 'guest';
    S.mode = null;
    showWait(code, false);
    $('#wait-text').textContent = 'Подключаюсь к игре…';
    S.net = new Net(netHandlers());
    S.net.join(code);
  }

  function onlineNames(myColor) {
    const me = myName() + ' (вы)', other = S.oppName || 'Соперник';
    return myColor === 'w' ? { w: me, b: other } : { w: other, b: me };
  }

  /** Хост отправляет гостю полное состояние партии */
  function sendStart() {
    S.net.send({
      type: 'start', v: 2, gameId: S.gameId, guestColor: opp(S.hostColor), name: myName(),
      abil: S.game.abil, acts: S.game.history.map((m) => m.d), result: S.result,
    });
  }

  function hostNewGame(swap) {
    if (swap) S.hostColor = opp(S.hostColor);
    S.gameId = Math.random().toString(36).slice(2, 10);
    const abil = S.netVariant === 'abil' ? randomAbilities() : null;
    startGame({ mode: 'online', myColor: S.hostColor, names: onlineNames(S.hostColor), abil, spin: !!abil });
    sendStart();
    Sound.play('notify');
  }

  function onNetMessage(msg) {
    switch (msg.type) {
      case 'hello':
        S.oppName = String(msg.name || 'Соперник').slice(0, 16);
        if (S.role === 'host') {
          if (!S.gameId) hostNewGame(false);
          else { S.names = onlineNames(S.myColor); renderPanels(); sendStart(); }
        }
        break;

      case 'start': {
        if (S.role !== 'guest') break;
        if (msg.name) S.oppName = String(msg.name).slice(0, 16);
        const acts = Array.isArray(msg.acts) ? msg.acts : [];
        const sameGame = S.gameId === msg.gameId && S.mode === 'online';
        const same = sameGame && JSON.stringify(S.game.abil) === JSON.stringify(msg.abil || null) && JSON.stringify(S.game.history.map((m) => m.d)) === JSON.stringify(acts.map(cleanDesc)) && JSON.stringify(S.result) === JSON.stringify(msg.result);
        S.gameId = msg.gameId;
        if (same) { S.names = onlineNames(S.myColor); renderPanels(); break; }
        if (!sameGame) Sound.play('notify');
        const spin = !sameGame && !!msg.abil && acts.length === 0;
        startGame({ mode: 'online', myColor: msg.guestColor, names: onlineNames(msg.guestColor), acts: acts.map(cleanDesc), result: msg.result, abil: msg.abil || null, spin });
        if (!sameGame && !spin) toast(`Вы играете за ${COLOR_NAME[msg.guestColor]}`);
        break;
      }

      case 'act': {
        if (S.mode !== 'online' || S.result) break;
        const ply = S.game.history.length;
        if (msg.ply === ply + 1 && S.game.turn !== S.myColor) {
          if (!applyAct(msg.a, 'opp')) requestSync();
        } else if (msg.ply > ply) {
          requestSync();
        }
        break;
      }

      case 'sync':
        if (S.role === 'host') sendStart();
        break;

      case 'resign':
        if (!S.result) finish({ winner: S.myColor, reason: 'resign' });
        break;

      case 'draw-offer':
        if (S.result) break;
        Sound.play('notify');
        ask({
          title: 'Ничья?', text: `${esc(S.oppName || 'Соперник')} предлагает ничью.`, ok: 'Согласиться', cancel: 'Отказать',
          onOk: () => { S.net.send({ type: 'draw-accept' }); finish({ winner: null, reason: 'agreement' }); },
          onCancel: () => S.net.send({ type: 'draw-decline' }),
        });
        break;
      case 'draw-accept':
        if (!S.result) finish({ winner: null, reason: 'agreement' });
        break;
      case 'draw-decline':
        toast('Соперник отказался от ничьей');
        break;

      case 'rematch-offer':
        Sound.play('notify');
        ask({
          title: 'Реванш?', text: `${esc(S.oppName || 'Соперник')} предлагает сыграть ещё. Цвета поменяются${S.game.abil ? ', способности выпадут заново' : ''}.`, ok: 'Играть', cancel: 'Нет',
          onOk: () => { if (S.role === 'host') hostNewGame(true); else S.net.send({ type: 'rematch-accept' }); },
          onCancel: () => S.net.send({ type: 'rematch-decline' }),
        });
        break;
      case 'rematch-accept':
        if (S.role === 'host') hostNewGame(true);
        break;
      case 'rematch-decline':
        toast('Соперник отказался от реванша');
        break;

      case 'bye':
        toast('Соперник вышел из игры', 3500);
        S.connected = false;
        if (S.mode === 'online' && !S.result) finish({ winner: S.myColor, reason: 'left' });
        else renderPanels();
        break;
    }
  }

  let syncTimer = 0;
  function requestSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (S.role === 'guest') S.net.send({ type: 'sync' });
      else sendStart();
    }, 150);
  }

  /* ================= Меню и настройки ================= */
  const THEMES = [
    ['brown', '#f0d9b5', '#b58863', 'Орех'],
    ['green', '#eeeed2', '#769656', 'Турнир'],
    ['blue', '#dee3e6', '#8ca2ad', 'Лёд'],
    ['marble', '#e9e6e1', '#9a948c', 'Мрамор'],
    ['night', '#b7b1c9', '#6e6590', 'Ночь'],
  ];
  function applyTheme() {
    document.body.dataset.theme = settings.theme;
    $$('.theme-chip').forEach((c) => c.classList.toggle('on', c.dataset.t === settings.theme));
  }
  $('#theme-picker').innerHTML = THEMES.map(([id, l, d, name]) =>
    `<button class="theme-chip" data-t="${id}" title="${name}" style="--l:${l};--d:${d}"><i></i><i></i><i></i><i></i></button>`).join('');
  $$('.theme-chip').forEach((c) => { c.onclick = () => { settings.theme = c.dataset.t; store.set('theme', settings.theme); applyTheme(); }; });
  applyTheme();

  function applySound() { $('#sound-btn use').setAttribute('href', settings.sound ? '#i-sound' : '#i-mute'); }
  $('#sound-btn').onclick = () => { settings.sound = !settings.sound; store.set('sound', settings.sound); applySound(); if (settings.sound) Sound.play('move'); };
  applySound();

  function segment(sel, value, onChange) {
    const root = $(sel);
    root.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === String(value));
      b.onclick = () => {
        root.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        onChange(b.dataset.v);
      };
    });
  }
  segment('#bot-color', settings.botColor, (v) => { settings.botColor = v; store.set('botColor', v); });
  segment('#bot-level', settings.botLevel, (v) => { settings.botLevel = Number(v); store.set('botLevel', Number(v)); });
  segment('#host-color', settings.hostColor, (v) => { settings.hostColor = v; store.set('hostColor', v); });

  // Галерея способностей
  $('#abil-gallery').innerHTML = WHEEL_ORDER.map((id) => {
    const u = ABIL_UI[id];
    return `<button class="abil-tile" data-ab="${id}" style="--ac:${u.color}"><span class="ab-ico-box"><svg><use href="#a-${id}"/></svg></span><span><b>${u.name}</b><small>${u.short}</small></span></button>`;
  }).join('');
  $$('.abil-tile').forEach((t) => { t.onclick = () => abilityInfo(t.dataset.ab); });

  function setVariant(v) {
    S.variant = v;
    const ab = v === 'abil';
    $('#bot-title').textContent = ab ? 'Бот · способности' : 'Игра с ботом';
    $('#online-title').textContent = ab ? 'Сеть · способности' : 'Игра по сети';
  }

  $$('[data-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === 'menu') { show('menu', false); return; }
      if (go === 'abil') { show('abil'); return; }
      setVariant('classic');
      if (go === 'local') startLocal();
      else show(go);
    };
  });
  $$('[data-abil-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.abilGo;
      setVariant('abil');
      if (go === 'local') startLocal();
      else show(go);
    };
  });
  $('#bot-back').onclick = () => show(S.variant === 'abil' ? 'abil' : 'menu', false);
  $('#bot-start').onclick = startBot;
  $('#host-btn').onclick = hostGame;
  $('#join-btn').onclick = () => joinGame($('#join-code').value);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(e.target.value); });
  $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#my-name').value = settings.name;
  $('#online-back').onclick = () => {
    if (!$('#online-wait').classList.contains('hidden')) { cancelOnlineWait(); return; }
    show(S.variant === 'abil' ? 'abil' : 'menu', false);
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
  $('#copy-link').onclick = async () => {
    if (!S.net || !S.net.code) return;
    toast((await copyText(inviteLink())) ? 'Ссылка скопирована' : 'Не удалось скопировать — отправь код');
  };
  $('#share-link').onclick = async () => {
    if (!S.net || !S.net.code) return;
    const what = S.netVariant === 'abil' ? 'в шахматы со способностями' : 'в шахматы';
    const data = { title: 'Шахматы+', text: `Сыграем ${what}? Код игры: ${S.net.code}`, url: inviteLink() };
    if (navigator.share) { try { await navigator.share(data); return; } catch (_) { return; } }
    toast((await copyText(inviteLink())) ? 'Ссылка скопирована' : 'Отправь код сопернику');
  };

  /* ================= Старт ================= */
  history.replaceState({ s: 'menu' }, '');
  store.del('saved'); // старый формат сохранения
  renderResume();

  const params = new URLSearchParams(location.search);
  const joinCode = params.get('join');
  if (joinCode) {
    history.replaceState({ s: 'menu' }, '', location.pathname);
    show('online');
    $('#join-code').value = joinCode.toUpperCase();
    if (settings.name) joinGame(joinCode);
    else { $('#my-name').focus(); toast('Введи имя и нажми «Войти»'); }
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // для отладки и тестов
  window.__chess = { S, applyAct, Game, startGame };
})();
