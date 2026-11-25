/*
 * Сетевая игра через PeerJS (WebRTC, телефоны соединяются напрямую).
 * Хост создаёт игру с коротким кодом, гость подключается по коду.
 * Есть пинг, автопереподключение гостя и пересоздание связи с сервером PeerJS.
 */
(function (root) {
  'use strict';

  const PREFIX = 'shakhmaty-sposob-v1-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randomCode(len = 5) {
    let s = '';
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    for (const n of arr) s += ALPHABET[n % ALPHABET.length];
    return s;
  }

  class Net {
    constructor(handlers) {
      this.h = handlers; // { onCode, onOpen, onClose, onMessage, onError, onStatus }
      this.peer = null;
      this.conn = null;
      this.role = null;
      this.code = null;
      this.lastSeen = 0;
      this.alive = false;
      this._timers = [];
      this._destroyed = false;
      this._onVisible = () => {
        if (document.visibilityState !== 'visible' || this._destroyed) return;
        if (this.peer && this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
        if (this.role === 'guest' && !this.isOpen()) this._connectToHost();
      };
      document.addEventListener('visibilitychange', this._onVisible);
    }

    isOpen() { return !!(this.conn && this.conn.open); }

    /* ---------- хост ---------- */

    host() {
      this.role = 'host';
      this.code = randomCode();
      const peer = new Peer(PREFIX + this.code, { debug: 0 });
      this.peer = peer;
      peer.on('open', () => this.h.onCode && this.h.onCode(this.code));
      peer.on('connection', (c) => {
        if (this.isOpen() && this.alive) {
          c.on('open', () => { c.send({ type: 'busy' }); setTimeout(() => c.close(), 400); });
          return;
        }
        if (this.conn) try { this.conn.close(); } catch (_) {}
        this._attach(c);
      });
      peer.on('disconnected', () => { if (!this._destroyed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') { peer.destroy(); this.host(); return; }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          this.h.onStatus && this.h.onStatus('Нет связи с сервером, пробую снова…');
          return;
        }
        this.h.onError && this.h.onError(this._errText(err));
      });
      this._startHeartbeat();
    }

    /* ---------- гость ---------- */

    join(code) {
      this.role = 'guest';
      this.code = code.trim().toUpperCase();
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => this._connectToHost());
      peer.on('disconnected', () => { if (!this._destroyed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          if (this._everConnected) { this.h.onStatus && this.h.onStatus('Соперник не в сети, жду…'); return; }
          this.h.onError && this.h.onError('Игра с таким кодом не найдена. Проверь код.');
          return;
        }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          this.h.onStatus && this.h.onStatus('Нет связи с сервером, пробую снова…');
          return;
        }
        this.h.onError && this.h.onError(this._errText(err));
      });
      this._startHeartbeat();
    }

    _connectToHost() {
      if (!this.peer || this.peer.destroyed || this.peer.disconnected || this._connecting) return;
      this._connecting = true;
      const c = this.peer.connect(PREFIX + this.code, { reliable: true });
      this._attach(c);
      setTimeout(() => { this._connecting = false; }, 4000);
    }

    /* ---------- соединение ---------- */

    _attach(c) {
      c.on('open', () => {
        this.conn = c;
        this._connecting = false;
        this._everConnected = true;
        this.alive = true;
        this.lastSeen = Date.now();
        this.h.onOpen && this.h.onOpen();
      });
      c.on('data', (d) => {
        this.lastSeen = Date.now();
        if (!this.alive) { this.alive = true; this.h.onOpen && this.h.onOpen(); }
        if (!d || typeof d !== 'object') return;
        if (d.type === 'ping') { this._raw({ type: 'pong' }); return; }
        if (d.type === 'pong') return;
        if (d.type === 'busy') { this.h.onError && this.h.onError('В этой игре уже два игрока.'); return; }
        this.h.onMessage && this.h.onMessage(d);
      });
      c.on('close', () => {
        if (this.conn !== c) return;
        this.conn = null;
        this._lost();
      });
      c.on('error', () => {});
    }

    _lost() {
      if (!this.alive) return;
      this.alive = false;
      this.h.onClose && this.h.onClose();
    }

    _startHeartbeat() {
      this._timers.push(setInterval(() => {
        if (this.isOpen()) this._raw({ type: 'ping' });
        if (this.alive && Date.now() - this.lastSeen > 9000) this._lost();
        // гость сам пытается переподключиться
        if (this.role === 'guest' && this._everConnected && !this.alive) {
          if (this.conn) { try { this.conn.close(); } catch (_) {} this.conn = null; }
          this._connectToHost();
        }
      }, 3000));
    }

    _raw(msg) {
      if (!this.isOpen()) return false;
      try { this.conn.send(msg); return true; } catch (_) { return false; }
    }

    send(msg) { return this._raw(msg); }

    _errText(err) {
      const map = {
        'browser-incompatible': 'Браузер не поддерживает WebRTC.',
        'peer-unavailable': 'Соперник недоступен.',
        'network': 'Проблема с сетью.',
        'server-error': 'Сервер PeerJS недоступен.',
        'webrtc': 'Ошибка WebRTC-соединения.',
      };
      return map[err.type] || ('Ошибка сети: ' + (err.type || err.message || err));
    }

    destroy() {
      this._destroyed = true;
      this._timers.forEach(clearInterval);
      document.removeEventListener('visibilitychange', this._onVisible);
      try { if (this.conn) this.conn.close(); } catch (_) {}
      try { if (this.peer) this.peer.destroy(); } catch (_) {}
      this.conn = null; this.peer = null;
    }
  }

  root.Net = Net;
})(window);
