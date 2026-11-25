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

  // Уровни сложности
  const LEVELS = {
    1: { depth: 1, time: 300, noise: 120, name: 'Новичок' },
    2: { depth: 2, time: 600, noise: 35, name: 'Любитель' },
    3: { depth: 4, time: 1200, noise: 0, name: 'Опытный' },
    4: { depth: 7, time: 2600, noise: 0, name: 'Мастер' },
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

    root(depth, prevBest, noise) {
      const g = this.g;
      const moves = g.legalMoves();
      moves.sort((a, b) => orderScore(b, prevBest) - orderScore(a, prevBest));
      let best = null, bestV = -Infinity, alpha = -Infinity;
      const scored = [];
      for (const m of moves) {
        g.make(m);
        const v = -this.negamax(depth - 1, -Infinity, noise ? Infinity : -alpha, 1);
        g.unmake(m);
        if (this.stopped) break;
        scored.push({ m, v });
        if (v > bestV) { bestV = v; best = m; }
        if (!noise && v > alpha) alpha = v;
      }
      return { best, bestV, scored, complete: !this.stopped };
    }
  }

  /** Возвращает лучший ход для текущей позиции. */
  function bestMove(g, level = 3) {
    const cfg = LEVELS[level] || LEVELS[3];
    const moves = g.legalMoves();
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    const s = new Search(g, cfg.time);
    let best = null, scored = null;
    for (let d = 1; d <= cfg.depth; d++) {
      const r = s.root(d, best, cfg.noise);
      if (r.best && (r.complete || !best)) { best = r.best; scored = r.scored; }
      if (!r.complete) break;
      if (Math.abs(r.bestV) > MATE - 100) break; // нашли мат
    }

    // На лёгких уровнях бот иногда выбирает не самый сильный ход
    if (cfg.noise && scored && scored.length) {
      let pick = null, pv = -Infinity;
      for (const { m, v } of scored) {
        const nv = v + (Math.random() * 2 - 1) * cfg.noise;
        if (nv > pv) { pv = nv; pick = m; }
      }
      best = pick;
    }
    return best || moves[0];
  }

  root.ChessAI = { bestMove, LEVELS };
})(typeof self !== 'undefined' ? self : this);
