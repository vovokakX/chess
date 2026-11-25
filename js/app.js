/*
 * Интерфейс и логика партий: бот, игра на одном устройстве, игра по сети.
 */
(() => {
  'use strict';

  const { Game, START_FEN, opp } = Chess;
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
    function knock(t0, freq, gain, dur) {
      const c = ac();
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(c.destination);
      src.start(c.currentTime + t0);
    }
    function tone(t0, freq, dur, gain = 0.1, type = 'triangle') {
      const c = ac();
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = c.createGain(); const t = c.currentTime + t0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    }
    const kinds = {
      move: () => knock(0, 950, 1.6, 0.08),
      capture: () => { knock(0, 650, 2, 0.11); knock(0.04, 1500, 0.9, 0.07); },
      castle: () => { knock(0, 950, 1.4, 0.07); knock(0.1, 820, 1.4, 0.07); },
      check: () => { knock(0, 950, 1.4, 0.08); tone(0.03, 880, 0.3, 0.07); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(i * 0.11, f, 0.55)),
      lose: () => [392, 330, 262].forEach((f, i) => tone(i * 0.17, f, 0.6)),
      draw: () => [494, 494].forEach((f, i) => tone(i * 0.2, f, 0.4, 0.08)),
      notify: () => { tone(0, 660, 0.18, 0.08); tone(0.12, 990, 0.28, 0.08); },
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

  function modal(html, cls = '') {
    const box = $('#modal-box');
    box.className = 'modal ' + cls;
    box.innerHTML = html;
    $('#modal').classList.remove('hidden');
    return box;
  }
  function closeModal() { $('#modal').classList.add('hidden'); }

  function ask({ title, text = '', ok = 'Да', cancel = 'Отмена', onOk, onCancel, img }) {
    const box = modal(`
      ${img ? `<img class="result-ico" src="${img}" alt="">` : ''}
      <h3>${title}</h3>${text ? `<p>${text}</p>` : '<p></p>'}
      <div class="row"><button class="btn" data-a="no">${cancel}</button><button class="btn primary" data-a="yes">${ok}</button></div>`);
    box.querySelector('[data-a=yes]').onclick = () => { closeModal(); onOk && onOk(); };
    box.querySelector('[data-a=no]').onclick = () => { closeModal(); onCancel && onCancel(); };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    if (!$('#modal').classList.contains('hidden')) { closeModal(); history.pushState({ s: current }, ''); return; }
    if (current === 'game') { history.pushState({ s: 'game' }, ''); leaveGame(); return; }
    if (current === 'online') { cancelOnlineWait(); }
    show('menu', false);
  });

  // Не даём экрану гаснуть во время партии
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
  }
  function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch (_) {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current === 'game') requestWakeLock(); });

  /* ================= Состояние партии ================= */
  const S = {
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
    targets: new Map(),  // клетка -> ходы
    pieceEls: {},
    // сеть
    net: null,
    role: null,
    gameId: null,
    oppName: '',
    connected: false,
    hostColor: 'w',
  };

  /* ================= Доска ================= */
  const boardEl = $('#board');
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
  const posTransform = (sq) => { const { r, c } = toDisplay(sq); return `translate(${c * 100}%, ${r * 100}%)`; };
  const pieceUrl = (p) => `pieces/${p}.svg`;

  function renderSquares() {
    const g = S.game;
    const last = g.history[g.history.length - 1];
    const checkSq = g.inCheck() ? g.kings[g.turn] : -1;
    let html = '';
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const sq = fromDisplay(dr, dc);
        const r = sq >> 3, c = sq & 7;
        const cls = ['sq'];
        if ((r + c) & 1) cls.push('d');
        if (last && (sq === last.from || sq === last.to)) cls.push('last');
        if (sq === S.selected) cls.push('sel');
        if (sq === checkSq) cls.push('check');
        const t = S.targets.get(sq);
        if (t) { cls.push('hint'); if (t[0].cap) cls.push('cap'); }
        let coords = '';
        if (dc === 0) coords += `<span class="coord rank">${8 - r}</span>`;
        if (dr === 7) coords += `<span class="coord file">${'abcdefgh'[c]}</span>`;
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${coords}</div>`;
      }
    }
    squaresEl.innerHTML = html;
  }

  /** anim — последний ход, который нужно анимировать (или null) */
  function renderPieces(anim) {
    const b = S.game.board;
    piecesEl.innerHTML = '';
    S.pieceEls = {};
    const moving = [];
    if (anim) {
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
        el.style.transform = posTransform(mv[1]);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.classList.remove('no-anim');
          el.style.transform = posTransform(sq);
        }));
      } else {
        el.style.transform = posTransform(sq);
      }
      piecesEl.appendChild(el);
      S.pieceEls[sq] = el;
    }
    // взятая фигура плавно исчезает
    if (anim && anim.cap) {
      const capSq = anim.flag === 'e' ? anim.to + (anim.p[0] === 'w' ? 8 : -8) : anim.to;
      const ghost = document.createElement('div');
      ghost.className = 'piece fade';
      ghost.style.backgroundImage = `url(${pieceUrl(anim.cap)})`;
      ghost.style.transform = posTransform(capSq);
      ghost.style.setProperty('--t', posTransform(capSq));
      ghost.style.zIndex = 0;
      piecesEl.prepend(ghost);
      setTimeout(() => ghost.remove(), 260);
    }
  }

  function render(anim = null) {
    renderSquares();
    renderPieces(anim);
    renderPanels();
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

  function renderPanels() {
    const g = S.game;
    const bottom = S.orientation, top = opp(bottom);
    for (const [id, color] of [['#player-top', top], ['#player-bottom', bottom]]) {
      const el = $(id);
      el.querySelector('.avatar').style.backgroundImage = `url(${pieceUrl(color + 'K')})`;
      el.querySelector('.pname').textContent = S.names[color] || (color === 'w' ? 'Белые' : 'Чёрные');
      el.querySelector('.captured').innerHTML = capturedHtml(color);
      el.classList.toggle('to-move', !S.result && g.turn === color);
    }

    // статус
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
    } else {
      const check = g.inCheck();
      if (check) st.classList.add('check');
      let s;
      if (S.mode === 'local') s = `Ход ${COLOR_NAME[g.turn]}`;
      else s = g.turn === S.myColor ? 'Ваш ход' : 'Ход соперника';
      txt.textContent = check ? s + ' · Шах!' : s;
    }

    // сетевой индикатор
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
    let html = '';
    for (let i = 0; i < h.length; i += 2) {
      html += `<span class="num">${i / 2 + 1}.</span>`;
      html += `<span class="mv${i === h.length - 1 ? ' cur' : ''}">${h[i].san}</span>`;
      html += h[i + 1] ? `<span class="mv${i + 1 === h.length - 1 ? ' cur' : ''}">${h[i + 1].san}</span>` : '<span></span>';
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
    undo.disabled = h === 0 || (S.mode === 'bot' && S.myColor === 'b' && h <= 1 && !over);
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

  /* ================= Выбор и перетаскивание фигур ================= */
  function canInteract() {
    if (S.result || current !== 'game') return false;
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
    // вернуть фигуру на место
    d.el.classList.remove('dragging');
    if (d.moved) {
      d.el.style.transform = posTransform(d.sq);
    } else if (d.wasSelected) {
      deselect();
    }
  }
  boardEl.addEventListener('pointerup', (e) => endDrag(e, false));
  boardEl.addEventListener('pointercancel', (e) => endDrag(e, true));
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  function tryMove(from, to, dropped) {
    const cands = S.targets.get(to);
    if (!cands) return;
    if (cands.length > 1 && cands[0].promo) {
      promotionPicker(cands[0].p[0], (promo) => {
        if (!promo) { render(); return; }
        applyMove({ from, to, promo }, 'me', true);
      });
      return;
    }
    applyMove({ from, to, promo: cands[0].promo }, 'me', dropped);
  }

  function promotionPicker(color, cb) {
    const box = modal(`
      <h3>Превращение</h3><p>Выбери фигуру</p>
      <div class="promo-grid">
        ${['Q', 'R', 'B', 'N'].map((t) => `<button data-p="${t}"><img src="${pieceUrl(color + t)}" alt=""></button>`).join('')}
      </div>`);
    box.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { closeModal(); $('#modal').onclick = null; cb(b.dataset.p); }; });
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') { closeModal(); $('#modal').onclick = null; cb(null); } };
  }

  /* ================= Ходы ================= */
  function applyMove(input, source, noAnim) {
    const mv = S.game.move(input);
    if (!mv) return null;
    S.selected = -1;
    S.targets = new Map();
    render(noAnim ? null : mv);

    if (mv.san.endsWith('+') || mv.san.endsWith('#')) Sound.play('check');
    else if (mv.flag === 'k' || mv.flag === 'q') Sound.play('castle');
    else if (mv.cap) Sound.play('capture');
    else Sound.play('move');
    if (navigator.vibrate && source === 'opp') navigator.vibrate(15);

    if (S.mode === 'online' && source === 'me') {
      S.net.send({ type: 'move', uci: mv.uci, ply: S.game.history.length });
    }

    const st = S.game.status();
    if (st) finish({ winner: st.winner, reason: st.type });
    else if (S.mode === 'bot' && S.game.turn !== S.myColor) botMove();
    saveLocalGame();
    return mv;
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
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  function finish(result, silent) {
    S.result = result;
    S.thinking = false;
    S.aiReq++;
    renderPanels();
    saveLocalGame();
    if (silent) return;
    const t = resultTitle(result);
    Sound.play(t.kind === 'win' ? 'win' : t.kind === 'lose' ? 'lose' : 'draw');
    setTimeout(() => showResult(), 650);
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
      worker.onmessage = (e) => onBotResult(e.data.id, e.data.uci);
      worker.onerror = () => {
        workerBroken = true; worker = null;
        if (S.thinking) runBotMainThread(S.aiReq);
      };
    } catch (_) { workerBroken = true; worker = null; }
    return worker;
  }

  let botStarted = 0;
  function botMove() {
    S.thinking = true;
    const id = ++S.aiReq;
    botStarted = Date.now();
    renderPanels();
    const w = getWorker();
    const payload = { id, fen: START_FEN, moves: S.game.history.map((m) => m.uci), level: S.level };
    if (w) w.postMessage(payload);
    else runBotMainThread(id);
  }

  function runBotMainThread(id) {
    setTimeout(() => {
      if (id !== S.aiReq) return;
      const g = new Game();
      for (const m of S.game.history) g.moveUci(m.uci);
      const m = ChessAI.bestMove(g, S.level);
      onBotResult(id, m ? Game.uci(m) : null);
    }, 60);
  }

  function onBotResult(id, uci) {
    if (id !== S.aiReq || S.mode !== 'bot' || S.result || !uci) return;
    const wait = Math.max(0, 450 - (Date.now() - botStarted));
    setTimeout(() => {
      if (id !== S.aiReq) return;
      S.thinking = false;
      applyMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promo: uci[4] && uci[4].toUpperCase() }, 'bot');
    }, wait);
  }

  /* ================= Запуск партий ================= */
  function startGame({ mode, myColor = 'w', names, moves = [], result = null, level }) {
    S.aiReq++;
    S.mode = mode;
    S.game = new Game();
    for (const u of moves) S.game.moveUci(u);
    S.myColor = myColor;
    S.orientation = mode === 'local' ? 'w' : myColor;
    if (level) S.level = level;
    S.names = names;
    S.result = result;
    S.thinking = false;
    S.selected = -1;
    S.targets = new Map();
    closeModal();
    if (current !== 'game') show('game');
    render();
    saveLocalGame();
    if (!result && mode === 'bot' && S.game.turn !== S.myColor) setTimeout(botMove, 400);
  }

  function startBot() {
    let color = settings.botColor;
    if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
    const lvl = Number(settings.botLevel);
    const me = settings.name || 'Вы';
    const bot = `Бот · ${ChessAI.LEVELS[lvl].name}`;
    startGame({ mode: 'bot', myColor: color, level: lvl, names: color === 'w' ? { w: me, b: bot } : { w: bot, b: me } });
  }

  function startLocal() {
    startGame({ mode: 'local', names: { w: 'Белые', b: 'Чёрные' } });
  }

  /* ---------- сохранение партии с ботом / локальной ---------- */
  function saveLocalGame() {
    if (S.mode !== 'bot' && S.mode !== 'local') return;
    if (S.result || !S.game.history.length) { store.del('saved'); return; }
    store.set('saved', { mode: S.mode, myColor: S.myColor, level: S.level, names: S.names, moves: S.game.history.map((m) => m.uci) });
  }

  function renderResume() {
    const saved = store.get('saved', null);
    let el = $('#resume-card');
    if (!saved) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('button');
      el.id = 'resume-card';
      el.className = 'mode-card accent';
      $('.mode-list').prepend(el);
      el.onclick = () => {
        const s = store.get('saved', null);
        if (s) startGame({ mode: s.mode, myColor: s.myColor, names: s.names, moves: s.moves, level: s.level });
      };
    }
    const n = Math.ceil(saved.moves.length / 2);
    const what = saved.mode === 'bot' ? `с ботом (${ChessAI.LEVELS[saved.level].name.toLowerCase()})` : 'на одном устройстве';
    el.innerHTML = `<span class="mode-ico"><svg><use href="#i-undo"/></svg></span>
      <span class="mode-text"><b>Продолжить партию</b><small>Игра ${what}, ход ${n}</small></span>`;
  }

  /* ================= Кнопки партии ================= */
  function leaveGame(force) {
    const go = () => {
      if (S.mode === 'online') { S.net && S.net.send({ type: 'bye' }); stopNet(); }
      S.aiReq++;
      S.thinking = false;
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
    if (S.mode === 'bot') {
      g.undo();
      if (g.turn !== S.myColor && g.history.length) g.undo();
    } else {
      g.undo();
    }
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
      // бот соглашается, только если его позиция не лучше
      const g = new Game();
      for (const m of S.game.history) g.moveUci(m.uci);
      const botColor = opp(S.myColor);
      let score = 0;
      for (const p of g.board) if (p) score += (p[0] === botColor ? 1 : -1) * VAL[p[1]];
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
      type: 'start', gameId: S.gameId, guestColor: opp(S.hostColor), name: myName(),
      moves: S.game.history.map((m) => m.uci), result: S.result,
    });
  }

  function hostNewGame(swap) {
    if (swap) S.hostColor = opp(S.hostColor);
    S.gameId = Math.random().toString(36).slice(2, 10);
    startGame({ mode: 'online', myColor: S.hostColor, names: onlineNames(S.hostColor) });
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
        const sameGame = S.gameId === msg.gameId && S.mode === 'online';
        const same = sameGame && S.game.history.map((m) => m.uci).join() === msg.moves.join() && JSON.stringify(S.result) === JSON.stringify(msg.result);
        S.gameId = msg.gameId;
        if (same) { S.names = onlineNames(S.myColor); renderPanels(); break; }
        if (!sameGame) Sound.play('notify');
        startGame({ mode: 'online', myColor: msg.guestColor, names: onlineNames(msg.guestColor), moves: msg.moves, result: msg.result });
        if (!sameGame) toast(`Вы играете за ${COLOR_NAME[msg.guestColor]}`);
        break;
      }

      case 'move': {
        if (S.mode !== 'online' || S.result) break;
        const ply = S.game.history.length;
        if (msg.ply === ply + 1 && S.game.turn !== S.myColor) {
          const u = msg.uci;
          if (!applyMove({ from: u.slice(0, 2), to: u.slice(2, 4), promo: u[4] && u[4].toUpperCase() }, 'opp')) requestSync();
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
          title: 'Реванш?', text: `${esc(S.oppName || 'Соперник')} предлагает сыграть ещё. Цвета поменяются.`, ok: 'Играть', cancel: 'Нет',
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

  $$('[data-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === 'local') startLocal();
      else if (go === 'menu') { show('menu', false); }
      else show(go);
    };
  });
  $('#bot-start').onclick = startBot;
  $('#host-btn').onclick = hostGame;
  $('#join-btn').onclick = () => joinGame($('#join-code').value);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(e.target.value); });
  $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#my-name').value = settings.name;
  $('#online-back').onclick = () => {
    if (!$('#online-wait').classList.contains('hidden')) { cancelOnlineWait(); return; }
    show('menu', false);
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
    const data = { title: 'Шахматы+', text: `Сыграем в шахматы? Код игры: ${S.net.code}`, url: inviteLink() };
    if (navigator.share) { try { await navigator.share(data); return; } catch (_) { return; } }
    toast((await copyText(inviteLink())) ? 'Ссылка скопирована' : 'Отправь код сопернику');
  };

  /* ================= Старт ================= */
  history.replaceState({ s: 'menu' }, '');
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
})();
