/* Бот в отдельном потоке, чтобы интерфейс не подвисал. */
importScripts('engine.js', 'ai.js');

self.onmessage = (e) => {
  const { id, fen, moves, level } = e.data;
  const g = new self.Chess.Game(fen);
  for (const u of moves) g.moveUci(u);
  const m = self.ChessAI.bestMove(g, level);
  self.postMessage({ id, uci: m ? self.Chess.Game.uci(m) : null });
};
