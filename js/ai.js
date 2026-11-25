/*
 * Бот: альфа-бета поиск с итеративным углублением, тихим поиском
 * и позиционными таблицами. Работает и в Web Worker, и в основном потоке.
 */
(function (root) {
  'use strict';

  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  // Таблицы с точки зрения белых, индекс 0 = a8.
  const PST = {
    P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };

  const MATE = 100000;
  // «Цена» траты способности: бот применяет её, только если она даёт заметную выгоду
  const ABILITY_COST = 60;

  // Уровни сложности.
  // noise — случайный разброс оценки ходов (в сотых пешки),
  // blunder — шанс сделать почти случайный ход вместо продуманного.
  const LEVELS = {
    1: { depth: 1, time: 250, noise: 260, blunder: 0.3, name: 'Новичок' },
    2: { depth: 2, time: 500, noise: 110, blunder: 0.12, name: 'Любитель' },
    3: { depth: 3, time: 900, noise: 45, blunder: 0.05, name: 'Опытный' },
    4: { depth: 5, time: 1800, noise: 15, blunder: 0.015, name: 'Мастер' },
  };

  function evaluate(g) {
    const b = g.board;
    let mat = 0, score = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p && p[1] !== 'P' && p[1] !== 'K') mat += VAL[p[1]];
    }
    const endgame = mat <= 2600;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const t = p[1], white = p[0] === 'w';
      const idx = white ? i : i ^ 56;
      const table = t === 'K' && endgame ? PST.KE : PST[t];
      const v = VAL[t] + table[idx];
      score += white ? v : -v;
    }
    // пара слонов
    let wb = 0, bb = 0;
    for (let i = 0; i < 64; i++) { if (b[i] === 'wB') wb++; else if (b[i] === 'bB') bb++; }
    if (wb >= 2) score += 30;
    if (bb >= 2) score -= 30;
    return g.turn === 'w' ? score : -score;
  }

  function orderScore(m, best) {
    if (best && m.from === best.from && m.to === best.to && m.promo === best.promo) return 1e6;
    let s = 0;
    if (m.cap) s += 10 * VAL[m.cap[1]] - VAL[m.p[1]] + 1000;
    if (m.promo) s += VAL[m.promo] + 800;
    return s;
  }

  class Search {
    constructor(g, timeMs) {
      this.g = g;
      this.deadline = Date.now() + timeMs;
      this.nodes = 0;
      this.stopped = false;
    }

    checkTime() {
      if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    }

    quiesce(alpha, beta, qd) {
      this.checkTime();
      if (this.stopped) return 0;
      const stand = evaluate(this.g);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (qd > 6) return alpha;
      const moves = this.g.legalMoves(this.g.turn, true);
      moves.sort((a, b) => orderScore(b) - orderScore(a));
      for (const m of moves) {
        this.g.make(m);
        const v = -this.quiesce(-beta, -alpha, qd + 1);
        this.g.unmake(m);
        if (this.stopped) return 0;
        if (v >= beta) return beta;
        if (v > alpha) alpha = v;
      }
      return alpha;
    }

    negamax(depth, alpha, beta, ply) {
      this.checkTime();
      if (this.stopped) return 0;
      const g = this.g;
      const inCheck = g.inCheck();
      if (inCheck) depth++; // продление при шахе
      if (depth <= 0) return this.quiesce(alpha, beta, 0);
      const moves = g.legalMoves();
      if (!moves.length) return inCheck ? -MATE + ply : 0;
      if (g.half >= 100) return 0;
      moves.sort((a, b) => orderScore(b) - orderScore(a));
      for (const m of moves) {
        g.make(m);
        const v = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
        g.unmake(m);
        if (this.stopped) return 0;
        if (v >= beta) return beta;
        if (v > alpha) alpha = v;
      }
      return alpha;
    }

    root(depth, prevBest, noise, moves) {
      const g = this.g, me = g.turn;
      moves.sort((a, b) => orderScore(b, prevBest) - orderScore(a, prevBest));
      let best = null, bestV = -Infinity, alpha = -Infinity;
      const scored = [];
      for (const m of moves) {
        const special = !!(m.kind || m.lull || m.berserk || m.jest >= 0 || m.hole >= 0);
        g.make(m);
        let v;
        // после Колыбельной снова ходим мы — оценка без смены знака
        if (g.turn === me) v = this.negamax(depth - 1, special || noise ? -Infinity : alpha, Infinity, 1);
        else v = -this.negamax(depth - 1, -Infinity, special || noise ? Infinity : -alpha, 1);
        g.unmake(m);
        if (this.stopped) break;
        if (special) v -= ABILITY_COST;
        scored.push({ m, v });
        if (v > bestV) { bestV = v; best = m; }
        if (!noise && v > alpha) alpha = v;
      }
      return { best, bestV, scored, complete: !this.stopped };
    }
  }

  /** Все кандидаты на корне: обычные ходы, способности и ходы с «подготовленными» способностями */
  function rootMoves(g) {
    const me = g.turn, foe = me === 'w' ? 'b' : 'w';
    const moves = g.legalMoves();
    const extra = g.abilityMoves();
    if (g.ready(me, 'lullaby')) for (const m of moves) extra.push(Object.assign({}, m, { lull: true }));
    if (g.ready(me, 'berserk')) for (const m of moves) if (m.p[1] === 'R' && m.cap) extra.push(Object.assign({}, m, { berserk: true }));
    if (g.ready(me, 'jester')) {
      // заколдовываем самую ценную фигуру соперника
      let best = -1, bv = 0;
      g.board.forEach((p, sq) => { if (p && p[0] === foe && p[1] !== 'K' && VAL[p[1]] > bv) { bv = VAL[p[1]]; best = sq; } });
      if (best >= 0) for (const m of moves) if (m.to !== best) extra.push(Object.assign({}, m, { jest: best }));
    }
    if (g.ready(me, 'blackhole')) {
      // дыра на пустых клетках, куда соперник хотел бы пойти ценными фигурами
      const want = new Map();
      for (const m of g.pseudoMoves(foe)) {
        if (g.board[m.to] || m.p[1] === 'K' || m.p[1] === 'P') continue;
        want.set(m.to, Math.max(want.get(m.to) || 0, VAL[m.p[1]]));
      }
      const spots = [...want.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
      const top = moves.slice().sort((a, b) => orderScore(b) - orderScore(a)).slice(0, 8);
      for (const h of spots) for (const m of top) if (m.to !== h && m.from !== h) extra.push(Object.assign({}, m, { hole: h }));
    }
    return moves.concat(extra);
  }

  /** Возвращает лучший ход (или действие способности) для текущей позиции. */
  function bestMove(g, level = 3) {
    const cfg = LEVELS[level] || LEVELS[3];
    const all = rootMoves(g);
    if (!all.length) return null;
    if (all.length === 1) return all[0];

    const s = new Search(g, cfg.time);
    let best = null, scored = null;
    for (let d = 1; d <= cfg.depth; d++) {
      const r = s.root(d, best, cfg.noise, all.slice());
      if (r.best && (r.complete || !best)) { best = r.best; scored = r.scored; }
      if (!r.complete) break;
      if (Math.abs(r.bestV) > MATE - 100) break; // нашли мат
    }

    // Иногда бот «зевает»: берёт случайный ход из не самых плохих
    if (cfg.blunder && scored && scored.length > 2 && Math.random() < cfg.blunder) {
      const sorted = scored.slice().sort((a, b) => b.v - a.v);
      const bestV = sorted[0].v;
      // не отдаём мат и не зеваем больше ферзя — иначе играть совсем неинтересно
      const pool = sorted.filter((x) => x.v > bestV - 900 && x.v > -MATE + 100);
      if (pool.length > 1) return pool[1 + ((Math.random() * (pool.length - 1)) | 0)].m;
    }

    // На всех уровнях бот иногда выбирает не самый сильный ход
    if (cfg.noise && scored && scored.length) {
      let pick = null, pv = -Infinity;
      for (const { m, v } of scored) {
        const nv = v + (Math.random() * 2 - 1) * cfg.noise;
        if (nv > pv) { pv = nv; pick = m; }
      }
      best = pick;
    }
    return best || all[0];
  }

  root.ChessAI = { bestMove, LEVELS };
})(typeof self !== 'undefined' ? self : this);
