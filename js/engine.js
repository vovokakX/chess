/*
 * Шахматный движок: правила, генерация ходов, шах/мат, ничьи + способности.
 * Доска — массив из 64 клеток, индекс 0 = a8, 63 = h1.
 * Фигура — строка из двух символов: цвет (w/b) + тип (K Q R B N P), напр. "wN".
 *
 * Способности (у каждого игрока одна, см. ABILITIES):
 *   necro     — Некромант: ставит свою пешку на свой 2-й ряд (3 раза)
 *   runner    — Бегун: пешка прыгает ровно на 4 клетки по прямой (1 раз)
 *   tsar      — Царь: король отбрасывает фигуры в радиусе 2 (без ограничений, перезарядка 6)
 *   kamikaze  — Камикадзе: пешка ходит как ферзь на 1–2 клетки, при атаке взрывается вместе с целью (3 раза)
 *   lullaby   — Колыбельная: соперник пропускает ход (1 раз)
 *   vampire   — Вампир: пешка съела пешку → рядом появляется своя пешка (пассивно, перезарядка 7)
 *   berserk   — Берсерк: ладья после взятия ходит ещё раз (2 раза)
 *   double    — Двойник: король меняется местами со своей фигурой (1 раз)
 *   jester    — Шут: вражеская фигура в следующий ход может только шагнуть вперёд (перезарядка 7)
 *   storm     — Буря: все фигуры горизонтали сдвигаются на 1 клетку (1 раз)
 *   blackhole — Чёрная дыра: клетка 8 полуходов поглощает вставшие на неё фигуры (1 раз)
 *
 * Перезарядка (cd) — сколько своих ходов осталось ждать до следующего применения.
 *
 * Любое действие описывается компактным «дескриптором» {k, f, t, p, l, b, j, h}:
 *   k — вид ('m' — обычный ход или id способности), f/t — откуда/куда, p — превращение,
 *   l — Колыбельная, b — Берсерк, j — клетка цели Шута, h — клетка Чёрной дыры.
 * Так ходы передаются по сети и боту.
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const ABILITIES = {
    necro: { uses: 3 },
    runner: { uses: 1 },
    tsar: { uses: Infinity, cooldown: 6 },
    kamikaze: { uses: 3 },
    lullaby: { uses: 1, prep: true },
    vampire: { uses: 0, passive: true, cooldown: 7 },
    berserk: { uses: 2, prep: true },
    double: { uses: 1 },
    jester: { uses: Infinity, cooldown: 7, prep: true },
    storm: { uses: 1 },
    blackhole: { uses: 1, prep: true },
  };
  const ABILITY_IDS = Object.keys(ABILITIES);
  const HOLE_TTL = 8; // полуходов: 4 хода каждого игрока

  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
  const opp = (c) => (c === 'w' ? 'b' : 'w');
  const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

  class Game {
    /** abil — null (обычные шахматы) или {w: 'necro', b: 'tsar'} */
    constructor(fen = START_FEN, abil = null) {
      this.abil = abil ? { w: abil.w, b: abil.b } : null;
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
      this.uses = {
        w: this.abil ? ABILITIES[this.abil.w].uses : 0,
        b: this.abil ? ABILITIES[this.abil.b].uses : 0,
      };
      this.cd = { w: 0, b: 0 };
      this.lock = -1;        // Берсерк: ходить можно только этой фигурой
      this.jest = -1;        // Шут: клетка заколдованной фигуры
      this.jestColor = null; // цвет заколдованной фигуры
      this.holes = [];       // Чёрные дыры: [{sq, ttl}]
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
      let k = s + this.turn + this._castStr() + this.ep + '|' + this.uses.w + this.uses.b + '|' + this.cd.w + this.cd.b;
      if (this.lock >= 0 || this.jest >= 0 || this.holes.length) k += '|' + this.lock + ',' + this.jest + ',' + this.holes.map((h) => h.sq + ':' + h.ttl).join(';');
      return k;
    }

    _bumpRep(d) {
      const k = this._key();
      const n = (this.rep.get(k) || 0) + d;
      if (n <= 0) this.rep.delete(k); else this.rep.set(k, n);
    }

    isHole(sq) {
      for (const h of this.holes) if (h.sq === sq) return true;
      return false;
    }

    /* ---------- атаки ---------- */

    attacked(sq, by) {
      const b = this.board;
      const r = sq >> 3, c = sq & 7;
      const pr = by === 'w' ? r + 1 : r - 1;
      const pawn = by + 'P';
      if (pr >= 0 && pr < 8) {
        if (c > 0 && b[pr * 8 + c - 1] === pawn) return true;
        if (c < 7 && b[pr * 8 + c + 1] === pawn) return true;
      }
      const kn = by + 'N';
      for (const [dr, dc] of KNIGHT) {
        const rr = r + dr, cc = c + dc;
        if (onBoard(rr, cc) && b[rr * 8 + cc] === kn) return true;
      }
      const kg = by + 'K';
      for (const [dr, dc] of KING) {
        const rr = r + dr, cc = c + dc;
        if (onBoard(rr, cc) && b[rr * 8 + cc] === kg) return true;
      }
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

    /* ---------- обычные ходы ---------- */

    pseudoMoves(color = this.turn, capturesOnly = false) {
      const b = this.board, out = [];
      const enemy = opp(color);
      const vampire = this.abil && this.abil[color] === 'vampire' && this.cd[color] === 0;
      const lock = color === this.turn ? this.lock : -1;
      const jest = color === this.jestColor ? this.jest : -1;
      const holes = this.holes.length > 0;
      const add = (from, to, p, flag = '', cap = b[to]) => {
        if (capturesOnly && !cap) return;
        out.push({ from, to, p, cap: cap || null, promo: null, flag });
      };

      for (let sq = 0; sq < 64; sq++) {
        const p = b[sq];
        if (!p || p[0] !== color) continue;
        if (lock >= 0 && sq !== lock) continue;
        const t = p[1], r = sq >> 3, c = sq & 7;

        // Шут: заколдованная фигура может только шагнуть на клетку вперёд, без взятия
        if (sq === jest) {
          if (capturesOnly) continue;
          const rr = r + (color === 'w' ? -1 : 1);
          if (rr < 0 || rr > 7) continue;
          const to = rr * 8 + c;
          if (b[to] || (t === 'K' && holes && this.isHole(to))) continue;
          if (t === 'P' && (rr === 0 || rr === 7)) {
            for (const pr of ['Q', 'R', 'B', 'N']) out.push({ from: sq, to, p, cap: null, promo: pr, flag: '' });
          } else out.push({ from: sq, to, p, cap: null, promo: null, flag: '' });
          continue;
        }

        if (t === 'P') {
          const dir = color === 'w' ? -1 : 1;
          const startRow = color === 'w' ? 6 : 1;
          const promoRow = color === 'w' ? 0 : 7;
          const r1 = r + dir;
          const pushPawn = (to, cap) => {
            if ((to >> 3) === promoRow) {
              for (const pr of ['Q', 'R', 'B', 'N']) out.push({ from: sq, to, p, cap: cap || null, promo: pr, flag: '' });
            } else if (!capturesOnly || cap) {
              const m = { from: sq, to, p, cap: cap || null, promo: null, flag: '' };
              if (vampire && cap && cap[1] === 'P') m.vamp = this._vampSpawn(sq, to, to, color);
              out.push(m);
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
              else if (to === this.ep && b[to - dir * 8] === enemy + 'P') {
                const m = { from: sq, to, p, cap: enemy + 'P', promo: null, flag: 'e' };
                if (vampire) m.vamp = this._vampSpawn(sq, to, to - dir * 8, color);
                out.push(m);
              }
            }
          }
          continue;
        }

        if (t === 'N' || t === 'K') {
          for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
            const rr = r + dr, cc = c + dc;
            if (!onBoard(rr, cc)) continue;
            const to = rr * 8 + cc;
            if (t === 'K' && holes && this.isHole(to)) continue; // королю в дыру нельзя
            if (!b[to] || b[to][0] === enemy) add(sq, to, p);
          }
          if (t === 'K' && !capturesOnly && lock < 0) this._castleMoves(color, sq, out);
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

    /** Вампир: куда поставить новую пешку рядом с убитой (или -1) */
    _vampSpawn(from, to, capSq, color) {
      const b = this.board;
      const back = color === 'w' ? 1 : -1;
      const r = capSq >> 3, c = capSq & 7;
      const order = [[0, -1], [0, 1], [back, 0], [back, -1], [back, 1], [-back, -1], [-back, 1], [-back, 0]];
      for (const [dr, dc] of order) {
        const rr = r + dr, cc = c + dc;
        if (!onBoard(rr, cc) || rr === 0 || rr === 7) continue;
        const s = rr * 8 + cc;
        if (s === to || this.isHole(s)) continue;
        if (!b[s] || s === from || s === capSq) return s;
      }
      return -1;
    }

    _castleMoves(color, sq, out) {
      const b = this.board, cr = this.castling, e = opp(color);
      const hole = (...s) => this.holes.length && s.some((x) => this.isHole(x));
      if (color === 'w' && sq === 60) {
        if (cr.K && !b[61] && !b[62] && b[63] === 'wR' && !hole(61, 62) && !this.attacked(60, e) && !this.attacked(61, e) && !this.attacked(62, e))
          out.push({ from: 60, to: 62, p: 'wK', cap: null, promo: null, flag: 'k' });
        if (cr.Q && !b[59] && !b[58] && !b[57] && b[56] === 'wR' && !hole(59, 58) && !this.attacked(60, e) && !this.attacked(59, e) && !this.attacked(58, e))
          out.push({ from: 60, to: 58, p: 'wK', cap: null, promo: null, flag: 'q' });
      } else if (color === 'b' && sq === 4) {
        if (cr.k && !b[5] && !b[6] && b[7] === 'bR' && !hole(5, 6) && !this.attacked(4, e) && !this.attacked(5, e) && !this.attacked(6, e))
          out.push({ from: 4, to: 6, p: 'bK', cap: null, promo: null, flag: 'k' });
        if (cr.q && !b[3] && !b[2] && !b[1] && b[0] === 'bR' && !hole(3, 2) && !this.attacked(4, e) && !this.attacked(3, e) && !this.attacked(2, e))
          out.push({ from: 4, to: 2, p: 'bK', cap: null, promo: null, flag: 'q' });
      }
    }

    _legalFilter(list, color) {
      const res = [];
      for (const m of list) {
        this.make(m);
        if (!this.attacked(this.kings[color], opp(color))) res.push(m);
        this.unmake(m);
      }
      return res;
    }

    legalMoves(color = this.turn, capturesOnly = false) {
      return this._legalFilter(this.pseudoMoves(color, capturesOnly), color);
    }

    movesFrom(sq) {
      return this.legalMoves().filter((m) => m.from === sq);
    }

    /* ---------- способности ---------- */

    abilityOf(color) { return this.abil ? this.abil[color] : null; }

    /** Готова ли способность id у стороны color (есть заряды, нет перезарядки) */
    ready(color, id) {
      return this.abilityOf(color) === id && this.uses[color] > 0 && this.cd[color] === 0 && this.lock < 0;
    }

    canLull(color = this.turn) { return this.ready(color, 'lullaby'); }

    /** Активные способности, которые сами являются ходом: список легальных действий */
    abilityMoves(color = this.turn) {
      const id = this.abilityOf(color);
      if (!id || ABILITIES[id].passive || ABILITIES[id].prep || !this.ready(color, id)) return [];
      const b = this.board, enemy = opp(color), P = color + 'P';
      const backRow = color === 'w' ? 7 : 0, promoRow = color === 'w' ? 0 : 7;
      const land = (to) => ((to >> 3) === promoRow ? color + 'Q' : P);
      const raw = [];

      if (id === 'necro') {
        let pawns = 0;
        for (const p of b) if (p === P) pawns++;
        if (pawns < 8) {
          const row = color === 'w' ? 6 : 1;
          for (let c = 0; c < 8; c++) {
            const s = row * 8 + c;
            if (!b[s] && !this.isHole(s)) raw.push({ kind: 'necro', p: P, from: -1, to: s, cap: null, diff: [[s, null, P]] });
          }
        }
      } else if (id === 'runner' || id === 'kamikaze') {
        for (let sq = 0; sq < 64; sq++) {
          if (b[sq] !== P) continue;
          const r = sq >> 3, c = sq & 7;
          if (id === 'runner') {
            for (const [dr, dc] of ORTHO) {
              const rr = r + 4 * dr, cc = c + 4 * dc;
              if (!onBoard(rr, cc) || rr === backRow) continue;
              const to = rr * 8 + cc, t = b[to];
              if (t && (t[0] === color || t[1] === 'K')) continue;
              raw.push({ kind: 'runner', p: P, from: sq, to, cap: t || null, diff: [[sq, P, null], [to, t, land(to)]] });
            }
          } else {
            for (const [dr, dc] of KING) {
              for (let step = 1; step <= 2; step++) {
                const rr = r + dr * step, cc = c + dc * step;
                if (!onBoard(rr, cc)) break;
                const to = rr * 8 + cc, t = b[to];
                if (!t) {
                  if (rr !== backRow) raw.push({ kind: 'kamikaze', p: P, from: sq, to, cap: null, diff: [[sq, P, null], [to, null, land(to)]] });
                  continue;
                }
                if (t[0] === enemy && t[1] !== 'K') raw.push({ kind: 'kamikaze', p: P, from: sq, to, cap: t, diff: [[sq, P, null], [to, t, null]] });
                break;
              }
            }
          }
        }
      } else if (id === 'tsar') {
        const m = this._tsarMove(color);
        if (m) raw.push(m);
      } else if (id === 'double') {
        const k = this.kings[color], K = color + 'K';
        const kRow = k >> 3;
        for (let sq = 0; sq < 64; sq++) {
          const p = b[sq];
          if (!p || p[0] !== color || p[1] === 'K') continue;
          if (p[1] === 'P' && (kRow === 0 || kRow === 7)) continue; // пешку на крайний ряд нельзя
          raw.push({ kind: 'double', p: K, from: k, to: sq, cap: null, diff: [[k, K, p], [sq, p, K]] });
        }
      } else if (id === 'storm') {
        for (let row = 0; row < 8; row++) {
          for (const dir of [-1, 1]) {
            const m = this._stormMove(color, row, dir);
            if (m) raw.push(m);
          }
        }
      }
      return this._legalFilter(raw, color);
    }

    _tsarMove(color) {
      const k = this.kings[color], kr = k >> 3, kc = k & 7;
      const nb = this.board.slice();
      const list = [];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (!dr && !dc) continue;
          const r = kr + dr, c = kc + dc;
          if (!onBoard(r, c)) continue;
          const p = nb[r * 8 + c];
          if (p && p[1] !== 'K' && p[1] !== 'Q') list.push({ s: r * 8 + c, d: Math.max(Math.abs(dr), Math.abs(dc)), dr, dc });
        }
      }
      list.sort((a, b) => b.d - a.d); // дальние первыми — освобождают место ближним
      const pushes = [];
      for (const it of list) {
        const sr = sign(it.dr), sc = sign(it.dc), p = nb[it.s];
        let cur = it.s;
        for (let step = 0; step < 2; step++) {
          const nr = (cur >> 3) + sr, nc = (cur & 7) + sc;
          if (!onBoard(nr, nc)) break;
          const ns = nr * 8 + nc;
          if (nb[ns]) break;
          if (p[1] === 'P' && (nr === 0 || nr === 7)) break;
          cur = ns;
        }
        if (cur !== it.s) { nb[cur] = p; nb[it.s] = null; pushes.push({ from: it.s, to: cur, p }); }
      }
      if (!pushes.length) return null;
      return { kind: 'tsar', p: color + 'K', from: k, to: -1, cap: null, pushes, diff: this._diff(nb) };
    }

    /** Буря: сдвиг всей горизонтали row на 1 клетку в сторону dir (-1 — к вертикали a, 1 — к h) */
    _stormMove(color, row, dir) {
      const nb = this.board.slice();
      const pushes = [];
      for (let i = 0; i < 8; i++) {
        const c = dir > 0 ? 7 - i : i;
        const s = row * 8 + c, p = nb[s];
        if (!p) continue;
        const nc = c + dir;
        if (nc < 0 || nc > 7) continue;
        const ns = row * 8 + nc;
        if (nb[ns]) continue;
        if (p[1] === 'K' && this.isHole(ns)) continue;
        nb[ns] = p; nb[s] = null;
        pushes.push({ from: s, to: ns, p });
      }
      if (!pushes.length) return null;
      return { kind: 'storm', p: color + 'K', from: row, to: dir, cap: null, pushes, diff: this._diff(nb) };
    }

    _diff(nb) {
      const diff = [];
      for (let i = 0; i < 64; i++) if (this.board[i] !== nb[i]) diff.push([i, this.board[i], nb[i]]);
      return diff;
    }

    /* ---------- сделать / отменить ход (низкий уровень) ---------- */

    make(m) {
      const b = this.board, color = m.p[0], foe = opp(color);
      this._stack.push({
        K: this.castling.K, Q: this.castling.Q, k: this.castling.k, q: this.castling.q,
        ep: this.ep, half: this.half, full: this.full, uw: this.uses.w, ub: this.uses.b, turn: this.turn,
        cw: this.cd.w, cb: this.cd.b, lock: this.lock, jest: this.jest, jestColor: this.jestColor, holes: this.holes,
      });

      // перезарядка тикает с каждым своим ходом
      if (this.cd[color] > 0) this.cd[color]--;
      const abilId = this.abil ? this.abil[color] : null;
      const cdAfterUse = abilId ? ABILITIES[abilId].cooldown || 0 : 0;
      const spend = () => { this.uses[color]--; if (cdAfterUse) this.cd[color] = cdAfterUse; };
      this.lock = -1;
      this.jest = -1;
      this.jestColor = null;

      if (m.kind) {
        for (const d of m.diff) {
          b[d[0]] = d[2];
          if (d[2] && d[2][1] === 'K') this.kings[d[2][0]] = d[0];
        }
        spend();
        this.ep = -1;
        this.half = 0;
      } else {
        b[m.to] = m.promo ? color + m.promo : m.p;
        b[m.from] = null;
        if (m.flag === 'e') b[m.to + (color === 'w' ? 8 : -8)] = null;
        else if (m.flag === 'k') { const rf = color === 'w' ? 63 : 7; b[rf - 2] = b[rf]; b[rf] = null; }
        else if (m.flag === 'q') { const rf = color === 'w' ? 56 : 0; b[rf + 3] = b[rf]; b[rf] = null; }
        if (m.vamp >= 0) { b[m.vamp] = color + 'P'; if (cdAfterUse) this.cd[color] = cdAfterUse; }
        if (m.p[1] === 'K') this.kings[color] = m.to;
        this.ep = m.flag === 'd' ? (m.from + m.to) >> 1 : -1;
        this.half = m.p[1] === 'P' || m.cap ? 0 : this.half + 1;
      }

      // Чёрные дыры: поглощают всё, кроме королей, и постепенно схлопываются
      if (this.holes.length) {
        for (const h of this.holes) {
          const p = b[h.sq];
          if (p && p[1] !== 'K') b[h.sq] = null;
        }
        this.holes = this.holes.map((h) => ({ sq: h.sq, ttl: h.ttl - 1 })).filter((h) => h.ttl > 0);
      }
      if (m.hole >= 0) {
        this.holes = this.holes.concat([{ sq: m.hole, ttl: HOLE_TTL }]);
        spend();
      }

      // права на рокировку пропадают, если король или ладья ушли со своих мест
      const cr = this.castling;
      if (b[60] !== 'wK') cr.K = cr.Q = false;
      if (b[63] !== 'wR') cr.K = false;
      if (b[56] !== 'wR') cr.Q = false;
      if (b[4] !== 'bK') cr.k = cr.q = false;
      if (b[7] !== 'bR') cr.k = false;
      if (b[0] !== 'bR') cr.q = false;

      if (color === 'b') this.full++;
      this.turn = foe;

      // Шут: фигура соперника заколдована на его следующий ход
      if (m.jest >= 0) {
        this.jest = m.jest;
        this.jestColor = foe;
        spend();
      }

      // Колыбельная: соперник спит, если только он не под шахом
      if (m.lull && !this.attacked(this.kings[foe], color)) {
        this.turn = color;
        spend();
        this.ep = -1;
      }

      // Берсерк: ладья после взятия ходит ещё раз (если не объявлен шах и есть куда ходить)
      if (m.berserk && b[m.to] && !this.attacked(this.kings[foe], color)) {
        this.turn = color;
        this.lock = m.to;
        if (this.legalMoves(color).length) { spend(); this.ep = -1; }
        else { this.turn = foe; this.lock = -1; }
      }
    }

    unmake(m) {
      const b = this.board, color = m.p[0];
      const st = this._stack.pop();
      this.castling = { K: st.K, Q: st.Q, k: st.k, q: st.q };
      this.ep = st.ep; this.half = st.half; this.full = st.full;
      this.uses.w = st.uw; this.uses.b = st.ub;
      this.cd.w = st.cw; this.cd.b = st.cb;
      this.turn = st.turn;
      this.lock = st.lock; this.jest = st.jest; this.jestColor = st.jestColor; this.holes = st.holes;

      if (m.kind) {
        for (let i = m.diff.length - 1; i >= 0; i--) {
          const d = m.diff[i];
          b[d[0]] = d[1];
          if (d[1] && d[1][1] === 'K') this.kings[d[1][0]] = d[0];
        }
        return;
      }
      if (m.vamp >= 0) b[m.vamp] = null;
      b[m.from] = m.p;
      if (m.flag === 'e') { b[m.to] = null; b[m.to + (color === 'w' ? 8 : -8)] = m.cap; }
      else b[m.to] = m.cap;
      if (m.flag === 'k') { const rf = color === 'w' ? 63 : 7; b[rf] = b[rf - 2]; b[rf - 2] = null; }
      else if (m.flag === 'q') { const rf = color === 'w' ? 56 : 0; b[rf] = b[rf + 3]; b[rf + 3] = null; }
      if (m.p[1] === 'K') this.kings[color] = m.from;
    }

    /* ---------- публичные действия ---------- */

    /** Добавить к обычному ходу флаги «подготовленных» способностей. null — нельзя. */
    withPrep(m, d) {
      const color = m.p[0];
      if (!d.l && !d.b && !(d.j >= 0) && !(d.h >= 0)) return m;
      const x = Object.assign({}, m);
      if (d.l) { if (!this.ready(color, 'lullaby')) return null; x.lull = true; }
      if (d.b) {
        if (!this.ready(color, 'berserk') || m.p[1] !== 'R' || !m.cap) return null;
        x.berserk = true;
      }
      if (d.j >= 0) {
        const t = this.board[d.j];
        if (!this.ready(color, 'jester') || !t || t[0] === color || t[1] === 'K' || d.j === m.to) return null;
        x.jest = d.j;
      }
      if (d.h >= 0) {
        if (!this.ready(color, 'blackhole') || this.board[d.h] || this.isHole(d.h) || d.h === m.to || d.h === m.from) return null;
        x.hole = d.h;
      }
      return x;
    }

    /** Выполнить действие по дескриптору. Возвращает ход с san или null. */
    act(d) {
      const mover = this.turn;
      let m, san;
      if (!d.k || d.k === 'm') {
        const legal = this.legalMoves();
        const cands = legal.filter((x) => x.from === d.f && x.to === d.t);
        if (!cands.length) return null;
        m = cands.find((x) => x.promo === (d.p || 'Q')) || cands[0];
        san = this._san(m, legal);
        m = this.withPrep(m, d);
        if (!m) return null;
      } else {
        m = this.abilityMoves().find((x) => x.kind === d.k && x.from === d.f && x.to === d.t);
        if (!m) return null;
        san = this._abilSan(m);
      }
      // что провалится в чёрные дыры
      const swallow = [];
      if (this.holes.length) {
        if (m.kind) {
          for (const dd of m.diff) if (dd[2] && dd[2][1] !== 'K' && this.isHole(dd[0])) swallow.push({ sq: dd[0], p: dd[2] });
        } else if (this.isHole(m.to)) {
          swallow.push({ sq: m.to, p: m.promo ? mover + m.promo : m.p });
        }
      }
      this.make(m);
      const mv = Object.assign({}, m, { san, d: Game.desc(m), color: mover, swallow });
      mv.slept = !!m.lull && this.turn === mover && this.lock < 0;
      mv.rage = !!m.berserk && this.lock === m.to;
      const foe = opp(mover);
      if (this.attacked(this.kings[foe], mover)) {
        const mate = this.turn === foe && !this.legalMoves().length && !this.abilityMoves().length;
        mv.san += mate ? '#' : '+';
      }
      if (swallow.length) mv.san += ' ●';
      if (mv.slept) mv.san += ' ☾';
      if (mv.rage) mv.san += ' ⚔';
      if (m.jest >= 0) mv.san += ' ☻';
      if (m.hole >= 0) mv.san += ' ◉';
      if (mv.vamp >= 0) mv.san += ' ♥';
      this.history.push(mv);
      this._bumpRep(1);
      return mv;
    }

    /** Совместимость: move({from, to, promo}) */
    move(input) {
      const f = typeof input.from === 'string' ? sqIndex(input.from) : input.from;
      const t = typeof input.to === 'string' ? sqIndex(input.to) : input.to;
      return this.act({ k: 'm', f, t, p: input.promo });
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

    _abilSan(m) {
      switch (m.kind) {
        case 'necro': return '✦' + sqName(m.to);
        case 'runner': return '✦' + sqName(m.from) + (m.cap ? '×' : '»') + sqName(m.to);
        case 'kamikaze': return '✦' + sqName(m.from) + (m.cap ? '✕' : '→') + sqName(m.to);
        case 'tsar': return '✦K⟳';
        case 'double': return '✦K⇄' + sqName(m.to);
        case 'storm': return '✦≋' + (8 - m.from) + (m.to > 0 ? '→' : '←');
        default: return '✦';
      }
    }

    /* ---------- статус партии ---------- */

    insufficientMaterial() {
      if (this.abil) return false; // способности могут вернуть материал
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
      if (this.legalMoves().length === 0 && this.abilityMoves().length === 0) {
        return this.inCheck() ? { type: 'checkmate', winner: opp(this.turn) } : { type: 'stalemate', winner: null };
      }
      if (this.insufficientMaterial()) return { type: 'insufficient', winner: null };
      if (this.half >= 100) return { type: 'fifty', winner: null };
      if ((this.rep.get(this._key()) || 0) >= 3) return { type: 'repetition', winner: null };
      return null;
    }

    static desc(m) {
      const d = { k: m.kind || 'm', f: m.from, t: m.to };
      if (m.promo) d.p = m.promo;
      if (m.lull) d.l = 1;
      if (m.berserk) d.b = 1;
      if (m.jest >= 0) d.j = m.jest;
      if (m.hole >= 0) d.h = m.hole;
      return d;
    }

    static uci(m) {
      return sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : '');
    }
  }

  root.Chess = { Game, START_FEN, ABILITIES, ABILITY_IDS, HOLE_TTL, sqName, sqIndex, opp };
})(typeof self !== 'undefined' ? self : this);
