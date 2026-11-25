/*
 * Шахматный движок: правила, генерация ходов, шах/мат, ничьи.
 * Доска — массив из 64 клеток, индекс 0 = a8, 63 = h1.
 * Фигура — строка из двух символов: цвет (w/b) + тип (K Q R B N P), напр. "wN".
 * Написан с нуля, чтобы потом было удобно добавлять способности.
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
  const opp = (c) => (c === 'w' ? 'b' : 'w');
  const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  class Game {
    constructor(fen = START_FEN) {
      this.load(fen);
    }

    load(fen) {
      const [pos, turn = 'w', cast = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
      this.board = new Array(64).fill(null);
      this.kings = { w: -1, b: -1 };
      let i = 0;
      for (const ch of pos) {
        if (ch === '/') continue;
        if (/\d/.test(ch)) { i += Number(ch); continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const type = ch.toUpperCase();
        this.board[i] = color + type;
        if (type === 'K') this.kings[color] = i;
        i++;
      }
      this.turn = turn;
      this.castling = { K: cast.includes('K'), Q: cast.includes('Q'), k: cast.includes('k'), q: cast.includes('q') };
      this.ep = ep !== '-' ? sqIndex(ep) : -1;
      this.half = Number(half) || 0;
      this.full = Number(full) || 1;
      this.history = [];
      this._stack = [];
      this.rep = new Map();
      this._bumpRep(1);
    }

    /* ---------- FEN / ключ позиции ---------- */

    fen() {
      let s = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let c = 0; c < 8; c++) {
          const p = this.board[r * 8 + c];
          if (!p) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          s += p[0] === 'w' ? p[1] : p[1].toLowerCase();
        }
        if (empty) s += empty;
        if (r < 7) s += '/';
      }
      return `${s} ${this.turn} ${this._castStr()} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    _castStr() {
      const c = this.castling;
      return (c.K ? 'K' : '') + (c.Q ? 'Q' : '') + (c.k ? 'k' : '') + (c.q ? 'q' : '') || '-';
    }

    _key() {
      let s = '';
      for (let i = 0; i < 64; i++) s += this.board[i] || '..';
      return s + this.turn + this._castStr() + this.ep;
    }

    _bumpRep(d) {
      const k = this._key();
      const n = (this.rep.get(k) || 0) + d;
      if (n <= 0) this.rep.delete(k); else this.rep.set(k, n);
    }

    /* ---------- атаки ---------- */

    attacked(sq, by) {
      const b = this.board;
      const r = sq >> 3, c = sq & 7;
      // пешки
      const pr = by === 'w' ? r + 1 : r - 1;
      const pawn = by + 'P';
      if (pr >= 0 && pr < 8) {
        if (c > 0 && b[pr * 8 + c - 1] === pawn) return true;
        if (c < 7 && b[pr * 8 + c + 1] === pawn) return true;
      }
      // конь
      const kn = by + 'N';
      for (const [dr, dc] of KNIGHT) {
        const rr = r + dr, cc = c + dc;
        if (onBoard(rr, cc) && b[rr * 8 + cc] === kn) return true;
      }
      // король
      const kg = by + 'K';
      for (const [dr, dc] of KING) {
        const rr = r + dr, cc = c + dc;
        if (onBoard(rr, cc) && b[rr * 8 + cc] === kg) return true;
      }
      // дальнобойные
      const q = by + 'Q', rk = by + 'R', bs = by + 'B';
      for (const [dr, dc] of ORTHO) {
        let rr = r + dr, cc = c + dc;
        while (onBoard(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p) { if (p === rk || p === q) return true; break; }
          rr += dr; cc += dc;
        }
      }
      for (const [dr, dc] of DIAG) {
        let rr = r + dr, cc = c + dc;
        while (onBoard(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p) { if (p === bs || p === q) return true; break; }
          rr += dr; cc += dc;
        }
      }
      return false;
    }

    inCheck(color = this.turn) {
      return this.attacked(this.kings[color], opp(color));
    }

    /* ---------- генерация ходов ---------- */

    pseudoMoves(color = this.turn, capturesOnly = false) {
      const b = this.board, out = [];
      const enemy = opp(color);
      const add = (from, to, p, flag = '', cap = b[to]) => {
        if (capturesOnly && !cap) return;
        out.push({ from, to, p, cap: cap || null, promo: null, flag });
      };

      for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (!p || p[0] !== color) continue;
        const t = p[1], r = sq >> 3, c = sq & 7;

        if (t === 'P') {
          const dir = color === 'w' ? -1 : 1;
          const startRow = color === 'w' ? 6 : 1;
          const promoRow = color === 'w' ? 0 : 7;
          const r1 = r + dir;
          const pushPawn = (to, cap, flag = '') => {
            if ((to >> 3) === promoRow) {
              for (const pr of ['Q', 'R', 'B', 'N']) out.push({ from: sq, to, p, cap: cap || null, promo: pr, flag });
            } else if (!capturesOnly || cap) {
              out.push({ from: sq, to, p, cap: cap || null, promo: null, flag });
            }
          };
          if (r1 >= 0 && r1 < 8) {
            const one = r1 * 8 + c;
            if (!b[one]) {
              pushPawn(one, null);
              if (!capturesOnly && r === startRow) {
                const two = (r + 2 * dir) * 8 + c;
                if (!b[two]) out.push({ from: sq, to: two, p, cap: null, promo: null, flag: 'd' });
              }
            }
            for (const dc of [-1, 1]) {
              const cc = c + dc;
              if (cc < 0 || cc > 7) continue;
              const to = r1 * 8 + cc;
              if (b[to] && b[to][0] === enemy) pushPawn(to, b[to]);
              else if (to === this.ep) out.push({ from: sq, to, p, cap: enemy + 'P', promo: null, flag: 'e' });
            }
          }
          continue;
        }

        if (t === 'N' || t === 'K') {
          for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
            const rr = r + dr, cc = c + dc;
            if (!onBoard(rr, cc)) continue;
            const to = rr * 8 + cc;
            if (!b[to] || b[to][0] === enemy) add(sq, to, p);
          }
          if (t === 'K' && !capturesOnly) this._castleMoves(color, sq, out);
          continue;
        }

        const dirs = t === 'B' ? DIAG : t === 'R' ? ORTHO : DIAG.concat(ORTHO);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (onBoard(rr, cc)) {
            const to = rr * 8 + cc;
            if (b[to]) { if (b[to][0] === enemy) add(sq, to, p); break; }
            add(sq, to, p);
            rr += dr; cc += dc;
          }
        }
      }
      return out;
    }

    _castleMoves(color, sq, out) {
      const b = this.board, cr = this.castling, e = opp(color);
      if (color === 'w' && sq === 60) {
        if (cr.K && !b[61] && !b[62] && b[63] === 'wR' && !this.attacked(60, e) && !this.attacked(61, e) && !this.attacked(62, e))
          out.push({ from: 60, to: 62, p: 'wK', cap: null, promo: null, flag: 'k' });
        if (cr.Q && !b[59] && !b[58] && !b[57] && b[56] === 'wR' && !this.attacked(60, e) && !this.attacked(59, e) && !this.attacked(58, e))
          out.push({ from: 60, to: 58, p: 'wK', cap: null, promo: null, flag: 'q' });
      } else if (color === 'b' && sq === 4) {
        if (cr.k && !b[5] && !b[6] && b[7] === 'bR' && !this.attacked(4, e) && !this.attacked(5, e) && !this.attacked(6, e))
          out.push({ from: 4, to: 6, p: 'bK', cap: null, promo: null, flag: 'k' });
        if (cr.q && !b[3] && !b[2] && !b[1] && b[0] === 'bR' && !this.attacked(4, e) && !this.attacked(3, e) && !this.attacked(2, e))
          out.push({ from: 4, to: 2, p: 'bK', cap: null, promo: null, flag: 'q' });
      }
    }

    legalMoves(color = this.turn, capturesOnly = false) {
      const res = [];
      for (const m of this.pseudoMoves(color, capturesOnly)) {
        this.make(m);
        if (!this.attacked(this.kings[color], opp(color))) res.push(m);
        this.unmake(m);
      }
      return res;
    }

    movesFrom(sq) {
      return this.legalMoves().filter((m) => m.from === sq);
    }

    /* ---------- сделать / отменить ход (низкий уровень) ---------- */

    make(m) {
      const b = this.board, color = m.p[0];
      this._stack.push({ K: this.castling.K, Q: this.castling.Q, k: this.castling.k, q: this.castling.q, ep: this.ep, half: this.half, full: this.full });

      b[m.to] = m.promo ? color + m.promo : m.p;
      b[m.from] = null;
      if (m.flag === 'e') b[m.to + (color === 'w' ? 8 : -8)] = null;
      else if (m.flag === 'k') { const rf = color === 'w' ? 63 : 7; b[rf - 2] = b[rf]; b[rf] = null; }
      else if (m.flag === 'q') { const rf = color === 'w' ? 56 : 0; b[rf + 3] = b[rf]; b[rf] = null; }

      if (m.p[1] === 'K') {
        this.kings[color] = m.to;
        if (color === 'w') this.castling.K = this.castling.Q = false;
        else this.castling.k = this.castling.q = false;
      }
      for (const s of [m.from, m.to]) {
        if (s === 63) this.castling.K = false;
        else if (s === 56) this.castling.Q = false;
        else if (s === 7) this.castling.k = false;
        else if (s === 0) this.castling.q = false;
      }

      this.ep = m.flag === 'd' ? (m.from + m.to) >> 1 : -1;
      this.half = m.p[1] === 'P' || m.cap ? 0 : this.half + 1;
      if (color === 'b') this.full++;
      this.turn = opp(color);
    }

    unmake(m) {
      const b = this.board, color = m.p[0];
      const st = this._stack.pop();
      this.castling = { K: st.K, Q: st.Q, k: st.k, q: st.q };
      this.ep = st.ep; this.half = st.half; this.full = st.full;
      this.turn = color;

      b[m.from] = m.p;
      if (m.flag === 'e') { b[m.to] = null; b[m.to + (color === 'w' ? 8 : -8)] = m.cap; }
      else b[m.to] = m.cap;
      if (m.flag === 'k') { const rf = color === 'w' ? 63 : 7; b[rf] = b[rf - 2]; b[rf - 2] = null; }
      else if (m.flag === 'q') { const rf = color === 'w' ? 56 : 0; b[rf] = b[rf + 3]; b[rf + 3] = null; }
      if (m.p[1] === 'K') this.kings[color] = m.from;
    }

    /* ---------- публичный ход ---------- */

    /** move({from, to, promo}) — from/to: индекс или "e2". Возвращает ход с SAN или null. */
    move(input) {
      const from = typeof input.from === 'string' ? sqIndex(input.from) : input.from;
      const to = typeof input.to === 'string' ? sqIndex(input.to) : input.to;
      const legal = this.legalMoves();
      const cands = legal.filter((m) => m.from === from && m.to === to);
      if (!cands.length) return null;
      const m = cands.find((x) => x.promo === (input.promo || 'Q')) || cands[0];
      const san = this._san(m, legal);
      this.make(m);
      const mv = Object.assign({}, m, { san, uci: Game.uci(m) });
      if (this.legalMoves().length === 0 && this.inCheck()) mv.san += '#';
      else if (this.inCheck()) mv.san += '+';
      this.history.push(mv);
      this._bumpRep(1);
      return mv;
    }

    moveUci(uci) {
      return this.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promo: uci[4] ? uci[4].toUpperCase() : undefined });
    }

    undo() {
      const m = this.history.pop();
      if (!m) return null;
      this._bumpRep(-1);
      this.unmake(m);
      return m;
    }

    _san(m, legal) {
      if (m.flag === 'k') return 'O-O';
      if (m.flag === 'q') return 'O-O-O';
      const t = m.p[1];
      let s = '';
      if (t === 'P') {
        if (m.cap) s += FILES[m.from & 7] + 'x';
        s += sqName(m.to);
        if (m.promo) s += '=' + m.promo;
        return s;
      }
      s = t;
      const others = legal.filter((x) => x.p === m.p && x.to === m.to && x.from !== m.from);
      if (others.length) {
        const sameFile = others.some((x) => (x.from & 7) === (m.from & 7));
        const sameRank = others.some((x) => (x.from >> 3) === (m.from >> 3));
        if (!sameFile) s += FILES[m.from & 7];
        else if (!sameRank) s += 8 - (m.from >> 3);
        else s += sqName(m.from);
      }
      if (m.cap) s += 'x';
      return s + sqName(m.to);
    }

    /* ---------- статус партии ---------- */

    insufficientMaterial() {
      const minors = [];
      for (let i = 0; i < 64; i++) {
        const p = this.board[i];
        if (!p || p[1] === 'K') continue;
        if (p[1] === 'B' || p[1] === 'N') minors.push({ t: p[1], sq: i });
        else return false;
      }
      if (minors.length <= 1) return true;
      if (minors.every((m) => m.t === 'B')) {
        const shade = (s) => ((s >> 3) + (s & 7)) & 1;
        return minors.every((m) => shade(m.sq) === shade(minors[0].sq));
      }
      return false;
    }

    /** null — игра продолжается, иначе {type, winner} */
    status() {
      if (this.legalMoves().length === 0) {
        return this.inCheck() ? { type: 'checkmate', winner: opp(this.turn) } : { type: 'stalemate', winner: null };
      }
      if (this.insufficientMaterial()) return { type: 'insufficient', winner: null };
      if (this.half >= 100) return { type: 'fifty', winner: null };
      if ((this.rep.get(this._key()) || 0) >= 3) return { type: 'repetition', winner: null };
      return null;
    }

    static uci(m) {
      return sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : '');
    }
  }

  root.Chess = { Game, START_FEN, sqName, sqIndex, opp };
})(typeof self !== 'undefined' ? self : this);
