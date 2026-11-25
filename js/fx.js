/*
 * Визуальные эффекты способностей (частицы, кольца, вспышки, тряска)
 * и колесо фортуны. Всё на Web Animations API — без библиотек.
 */
(function (root) {
  'use strict';

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------- метаданные способностей (для интерфейса) ---------- */
  const ABIL_UI = {
    necro: {
      name: 'Некромант', color: '#7be0a1', short: 'Оживляет 3 пешки',
      desc: 'Воскрешает твою пешку на любую свободную клетку твоего 2-го ряда. Можно 3 раза за игру. Тратит ход.',
      hint: 'выбери клетку на 2-м ряду',
    },
    runner: {
      name: 'Бегун', color: '#6cc6ff', short: 'Прыжок пешки на 4 клетки',
      desc: 'Пешка перепрыгивает ровно на 4 клетки вперёд, назад или вбок — прямо через фигуры. Может съесть фигуру там, куда приземлится (кроме короля). 1 раз за игру.',
      hint: 'выбери пешку',
    },
    tsar: {
      name: 'Царь', color: '#f0c77e', short: 'Волна от короля · перезарядка 6',
      desc: 'Король испускает волну: все фигуры в радиусе 2 клеток (свои и чужие, кроме ферзей и королей) отлетают от него на 2 клетки. Без ограничений, но после применения перезарядка — 6 твоих ходов.',
      hint: 'нажми на короля',
    },
    kamikaze: {
      name: 'Камикадзе', color: '#ff7a45', short: 'Пешка-взрыв · 3 раза',
      desc: 'Пешка ходит как ферзь, но только на 1–2 клетки. Если ходит на вражескую фигуру (не короля) — взрывается вместе с ней. 3 раза за игру.',
      hint: 'выбери пешку',
    },
    lullaby: {
      name: 'Колыбельная', color: '#b39bff', short: 'Соперник пропускает ход',
      desc: 'Включи перед ходом: соперник уснёт и пропустит ход, а ты сходишь ещё раз. Если твой ход объявит шах — соперник проснётся, а способность не потратится. 1 раз за игру.',
      hint: 'сделай ход — соперник уснёт',
    },
    vampire: {
      name: 'Вампир', color: '#ff4d6d', short: 'Пешки обращают пешек · перезарядка 7',
      desc: 'Работает сам: когда твоя пешка съедает пешку, рядом появляется ещё одна твоя пешка. После этого вампир отдыхает 7 твоих ходов.',
      hint: '',
    },
    berserk: {
      name: 'Берсерк', color: '#ff3b3b', short: 'Ладья бьёт и ходит снова · 2 раза',
      desc: 'Включи и возьми фигуру ладьёй — эта же ладья сразу сходит ещё раз. Если взятие объявило шах, второго хода нет, а способность не тратится. 2 раза за игру.',
      hint: 'возьми фигуру ладьёй',
    },
    double: {
      name: 'Двойник', color: '#5ee6d0', short: 'Король меняется местами · 1 раз',
      desc: 'Король меняется местами с любой своей фигурой. Вставать под шах нельзя. Тратит ход. 1 раз за игру.',
      hint: 'выбери фигуру для обмена',
    },
    jester: {
      name: 'Шут', color: '#f272d6', short: 'Фигура врага — как пешка · перезарядка 7',
      desc: 'Выбери вражескую фигуру (не короля) и сделай свой ход. В следующий ход соперник сможет двигать её только на 1 клетку вперёд и без взятия. Ход не тратится. Перезарядка — 7 твоих ходов.',
      hint: 'выбери фигуру соперника', hint2: 'теперь сделай ход',
    },
    storm: {
      name: 'Буря', color: '#9fc2e8', short: 'Сдвигает целый ряд · 1 раз',
      desc: 'Выбери горизонталь и сторону: все фигуры на ней сдвинутся на 1 клетку по ветру, крайние упрутся в край. Тратит ход. 1 раз за игру.',
      hint: 'выбери горизонталь', hint2: 'нажми на край ряда',
    },
    blackhole: {
      name: 'Чёрная дыра', color: '#d9d2ff', short: 'Клетка-ловушка · 1 раз',
      desc: 'Выбери пустую клетку и сделай свой ход. 4 хода каждого игрока на её месте будет дыра: любая фигура, кроме короля, которая туда встанет или будет туда сдвинута, исчезнет. Королям туда нельзя. Ход не тратится. 1 раз за игру.',
      hint: 'выбери пустую клетку', hint2: 'теперь сделай ход',
    },
  };

  /* ---------- эффекты на доске ---------- */
  function makeFX({ fxEl, boardEl, frameEl, toDisplay }) {
    const S = () => boardEl.clientWidth / 8;

    function center(sq) {
      const { r, c } = toDisplay(sq), s = S();
      return { x: (c + 0.5) * s, y: (r + 0.5) * s };
    }

    function el(cls, x, y, w, h, style = {}) {
      const d = document.createElement('div');
      d.className = cls;
      d.style.left = x - w / 2 + 'px';
      d.style.top = y - h / 2 + 'px';
      d.style.width = w + 'px';
      d.style.height = h + 'px';
      Object.assign(d.style, style);
      fxEl.appendChild(d);
      return d;
    }

    function anim(node, frames, opts) {
      const a = node.animate(frames, Object.assign({ fill: 'forwards' }, opts));
      a.onfinish = () => node.remove();
      return a;
    }

    /** Частицы из клетки */
    function particles(sq, { colors = ['#fff'], n = 16, dist = 1, size = 0.12, dur = 750, rise = 0, gravity = 0, delay = 0, glow = true, from = null } = {}) {
      const s = S();
      const c = from || center(sq);
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const d = dist * s * rand(0.35, 1);
        const sz = size * s * rand(0.5, 1.2);
        const col = pick(colors);
        const p = el('fx-p', c.x, c.y, sz, sz, { background: col, boxShadow: glow ? `0 0 ${sz}px ${col}` : 'none', opacity: 0 });
        const dx = Math.cos(a) * d, dy = Math.sin(a) * d - rise * s * rand(0.5, 1);
        anim(p, [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(.9)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy + gravity * s}px) scale(.15)`, opacity: 0 },
        ], { duration: dur * rand(0.7, 1.3), delay: delay + rand(0, 80), easing: 'cubic-bezier(.15,.7,.3,1)' });
      }
    }

    /** Частицы, которые засасывает в клетку */
    function implode(sq, { colors = ['#fff'], n = 18, dist = 1.4, size = 0.1, dur = 800, delay = 0 } = {}) {
      const s = S(), c = center(sq);
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), d = dist * s * rand(0.6, 1);
        const sz = size * s * rand(0.6, 1.3), col = pick(colors);
        const p = el('fx-p', c.x, c.y, sz, sz, { background: col, boxShadow: `0 0 ${sz}px ${col}`, opacity: 0 });
        const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
        anim(p, [
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0 },
          { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) rotate(90deg) scale(1)`, opacity: 1, offset: 0.3 },
          { transform: 'translate(0,0) rotate(220deg) scale(.1)', opacity: 0.2 },
        ], { duration: dur * rand(0.7, 1.2), delay: delay + rand(0, 200), easing: 'cubic-bezier(.5,0,.8,.4)' });
      }
    }

    /** Расходящееся кольцо */
    function ring(sq, color, { scale = 3, dur = 650, width = 0.08, delay = 0, from = null } = {}) {
      const s = S(), c = from || center(sq);
      const r = el('fx-ring', c.x, c.y, s * 0.6, s * 0.6, { borderColor: color, borderWidth: Math.max(2, s * width) + 'px', boxShadow: `0 0 ${s * 0.3}px ${color}, inset 0 0 ${s * 0.2}px ${color}`, opacity: 0 });
      anim(r, [
        { transform: 'scale(.2)', opacity: 1 },
        { transform: `scale(${scale})`, opacity: 0 },
      ], { duration: dur, delay, easing: 'cubic-bezier(.2,.6,.3,1)' });
    }

    /** Вспышка */
    function flash(sq, color, { size = 1.8, dur = 450, delay = 0 } = {}) {
      const s = S(), c = center(sq);
      const f = el('fx-flash', c.x, c.y, s * size, s * size, { background: `radial-gradient(circle, #fff 0%, ${color} 30%, transparent 70%)`, opacity: 0 });
      anim(f, [
        { transform: 'scale(.3)', opacity: 1 },
        { transform: 'scale(1.3)', opacity: 0 },
      ], { duration: dur, delay, easing: 'ease-out' });
    }

    /** Летящий след между клетками */
    function trail(fromSq, toSq, color, { n = 12, dur = 600, arc = 0 } = {}) {
      const a = center(fromSq), b = center(toSq), s = S();
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * arc * s;
        const sz = s * rand(0.08, 0.16);
        const p = el('fx-p', x, y, sz, sz, { background: color, boxShadow: `0 0 ${sz * 1.5}px ${color}`, opacity: 0 });
        anim(p, [
          { opacity: 0, transform: 'scale(.4)' },
          { opacity: 0.9, transform: 'scale(1)', offset: 0.2 },
          { opacity: 0, transform: `translate(0, ${s * 0.15}px) scale(.2)` },
        ], { duration: 520, delay: t * dur, easing: 'ease-out' });
      }
    }

    /** Плавающие буквы «Z» над клеткой */
    function zzz(sq, color, { n = 4, delay = 0 } = {}) {
      const s = S(), c = center(sq);
      for (let i = 0; i < n; i++) {
        const sz = s * (0.32 + i * 0.1);
        const z = el('fx-z', c.x + s * 0.2, c.y - s * 0.2, sz, sz, { color, fontSize: sz + 'px', opacity: 0 });
        z.textContent = 'Z';
        anim(z, [
          { opacity: 0, transform: 'translate(0,0) rotate(-10deg) scale(.5)' },
          { opacity: 1, transform: `translate(${s * 0.25}px, ${-s * 0.5}px) rotate(8deg) scale(1)`, offset: 0.35 },
          { opacity: 0, transform: `translate(${s * 0.6}px, ${-s * 1.4}px) rotate(-6deg) scale(1.1)` },
        ], { duration: 1700, delay: delay + i * 320, easing: 'ease-out' });
      }
    }

    /** Большая иконка способности в центре клетки */
    function icon(sq, iconId, color, { dur = 900, size = 1.2 } = {}) {
      const s = S(), c = center(sq);
      const d = el('fx-icon', c.x, c.y, s * size, s * size, { color, opacity: 0 });
      d.innerHTML = `<svg><use href="#${iconId}"/></svg>`;
      anim(d, [
        { opacity: 0, transform: 'scale(.3) rotate(-20deg)' },
        { opacity: 1, transform: 'scale(1.1) rotate(5deg)', offset: 0.35 },
        { opacity: 0, transform: `translateY(${-s * 0.6}px) scale(1.3)` },
      ], { duration: dur, easing: 'ease-out' });
    }

    /** Ночное затемнение доски */
    function night(dur = 1700) {
      const d = document.createElement('div');
      d.className = 'fx-night';
      fxEl.appendChild(d);
      anim(d, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], { duration: dur, easing: 'ease-in-out' });
    }

    /** Тряска доски */
    function shake(power = 6, dur = 450) {
      const k = [];
      for (let i = 0; i <= 8; i++) {
        const f = 1 - i / 8;
        k.push({ transform: i === 8 ? 'translate(0,0)' : `translate(${rand(-power, power) * f}px, ${rand(-power, power) * f}px)` });
      }
      frameEl.animate(k, { duration: dur, easing: 'linear' });
    }

    return { center, particles, implode, ring, flash, trail, zzz, icon, night, shake, size: S };
  }

  /* ---------- колесо фортуны ---------- */
  const WHEEL_ORDER = ['necro', 'berserk', 'runner', 'jester', 'tsar', 'storm', 'kamikaze', 'double', 'lullaby', 'blackhole', 'vampire'];

  function wheelSvg() {
    const R = 150, n = WHEEL_ORDER.length, seg = 360 / n;
    const pt = (deg, r) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    let parts = '';
    WHEEL_ORDER.forEach((id, i) => {
      const a0 = i * seg - seg / 2, a1 = a0 + seg;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
      const col = ABIL_UI[id].color;
      parts += `<path d="M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="url(#wg-${id})" stroke="#14161b" stroke-width="2.5"/>`;
      const mid = i * seg;
      const [ix, iy] = pt(mid, R * 0.84);
      const [tx, ty] = pt(mid, R * 0.5);
      parts += `<g transform="translate(${ix.toFixed(2)} ${iy.toFixed(2)}) rotate(${mid})"><use href="#a-${id}" x="-12" y="-12" width="24" height="24" style="color:#14161b"/></g>`;
      // подпись вдоль радиуса — так длинные названия помещаются в сектор
      parts += `<text transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${mid - 90})" text-anchor="middle" dominant-baseline="central" font-family="Inter, sans-serif" font-weight="800" font-size="${ABIL_UI[id].name.length > 9 ? 9.5 : ABIL_UI[id].name.length > 6 ? 10.5 : 11.5}" fill="#14161b">${ABIL_UI[id].name}</text>`;
      void col;
    });
    const defs = WHEEL_ORDER.map((id) => {
      const c = ABIL_UI[id].color;
      return `<radialGradient id="wg-${id}" cx="0" cy="0" r="150" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c}" stop-opacity=".55"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".85"/></radialGradient>`;
    }).join('');
    let pegs = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i * seg - seg / 2, R - 7);
      pegs += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.2" fill="#ffe2a8" stroke="#14161b" stroke-width="1.3"/>`;
    }
    return `<svg viewBox="-160 -160 320 320"><defs>${defs}</defs>
      <circle r="158" fill="#14161b"/><circle r="156" fill="none" stroke="#d9a95b" stroke-width="4"/>
      ${parts}${pegs}</svg>`;
  }

  /**
   * Показать колесо: крутит для белых, затем для чёрных.
   * box — контейнер модалки; abil — {w, b}; sound(kind) — проигрыватель звуков.
   */
  function runWheel(box, abil, { sound, onDone, startText = 'В бой!' }) {
    box.className = 'modal wheel-modal';
    box.innerHTML = `
      <div class="wheel-title"><img src="pieces/wK.svg" alt=""><span>Способность белых</span></div>
      <div class="wheel-wrap">
        <div class="wheel-pointer"></div>
        <div class="wheel-disc">${wheelSvg()}</div>
        <div class="wheel-hub"><svg><use href="#i-spark"/></svg></div>
      </div>
      <div class="wheel-result"></div>`;
    const disc = box.querySelector('.wheel-disc');
    const pointer = box.querySelector('.wheel-pointer');
    const hub = box.querySelector('.wheel-hub');
    const title = box.querySelector('.wheel-title');
    const result = box.querySelector('.wheel-result');
    let angle = 0, cancelled = false;
    const seg = 360 / WHEEL_ORDER.length;

    function spin(id, done) {
      const idx = WHEEL_ORDER.indexOf(id);
      const jitter = rand(-seg * 0.32, seg * 0.32);
      const targetMod = (((-idx * seg + jitter) % 360) + 360) % 360;
      const curMod = ((angle % 360) + 360) % 360;
      const target = angle + 360 * 5 + ((targetMod - curMod + 360) % 360);
      const start = angle, dur = 3600, t0 = performance.now();
      let lastSeg = Math.floor((start + seg / 2) / seg);
      hub.classList.add('spin');
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      function frame(now) {
        if (cancelled) return;
        const t = Math.min(1, (now - t0) / dur);
        angle = start + (target - start) * ease(t);
        disc.style.transform = `rotate(${angle}deg)`;
        const sNow = Math.floor((angle + seg / 2) / seg);
        if (sNow !== lastSeg) {
          lastSeg = sNow;
          sound('tick');
          pointer.classList.remove('tick'); void pointer.offsetWidth; pointer.classList.add('tick');
        }
        if (t < 1) requestAnimationFrame(frame);
        else { hub.classList.remove('spin'); done(); }
      }
      requestAnimationFrame(frame);
    }

    function showResult(id) {
      const u = ABIL_UI[id];
      result.style.setProperty('--ac', u.color);
      result.innerHTML = `<div class="res-name"><svg><use href="#a-${id}"/></svg>${u.name}</div><p class="muted">${u.desc}</p>`;
      result.classList.remove('show'); void result.offsetWidth; result.classList.add('show');
      sound('reveal');
    }

    setTimeout(() => spin(abil.w, () => {
      showResult(abil.w);
      setTimeout(() => {
        if (cancelled) return;
        title.innerHTML = '<img src="pieces/bK.svg" alt=""><span>Способность чёрных</span>';
        result.innerHTML = '';
        spin(abil.b, () => {
          showResult(abil.b);
          setTimeout(() => {
            if (cancelled) return;
            const row = (c) => {
              const id = abil[c], u = ABIL_UI[id];
              return `<div class="sum-row" style="--ac:${u.color}"><img src="pieces/${c}K.svg" alt="">
                <div><b>${c === 'w' ? 'Белые' : 'Чёрные'} — ${u.name}</b><small>${u.short}</small></div>
                <svg class="ab-ico"><use href="#a-${id}"/></svg></div>`;
            };
            box.innerHTML = `<h3>Способности</h3><p>Нажми на значок способности у своего имени, чтобы применить её.</p>
              <div class="wheel-summary">${row('w')}${row('b')}</div>
              <button class="btn primary big" data-a="go">${startText}</button>`;
            sound('reveal');
            box.querySelector('[data-a=go]').onclick = () => onDone && onDone();
          }, 1900);
        });
      }, 2100);
    }), 350);

    return { cancel() { cancelled = true; } };
  }

  root.ABIL_UI = ABIL_UI;
  root.makeFX = makeFX;
  root.runWheel = runWheel;
  root.WHEEL_ORDER = WHEEL_ORDER;
})(window);
