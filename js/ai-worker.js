/* Бот в отдельном потоке, чтобы интерфейс не подвисал. */
importScripts('engine.js', 'ai.js');

self.onmessage = (e) => {
  const { id, abil, acts, level } = e.data;
  const g = new self.Chess.Game(undefined, abil);
  for (const d of acts) g.act(d);
  const m = self.ChessAI.bestMove(g, level);
  self.postMessage({ id, d: m ? self.Chess.Game.desc(m) : null });
};
