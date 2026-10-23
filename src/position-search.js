import { parseFen, boardToFen, generateLegalMoves, applyMove, opposite, isGeneralInCheck, moveToUci } from '../public/vendor/xiangqi.js';

// Bounded AND/OR search. Attacker checks every move; ALL legal defences count.
// A private per-request cache and worker deadline prevent imported full boards
// from blocking the web server or growing the teaching-exercise global cache.
export function searchImportedMate(fen, maxMoves = 3, { maxNodes = 16000, timeBudgetMs = 1200 } = {}) {
  const { board, turn: attacker } = parseFen(fen), started = Date.now();
  let nodes = 0; const cache = new Map();
  const limit = Symbol('search-limit');
  function visit(board, turn, plies) {
    if (++nodes > maxNodes || Date.now() - started >= timeBudgetMs) throw limit;
    const key = boardToFen(board, turn) + '|' + plies;
    if (cache.has(key)) return cache.get(key);
    const moves = generateLegalMoves(board, turn);
    if (!moves.length) return turn !== attacker && isGeneralInCheck(board, turn) ? { plies: 0, line: [] } : null;
    if (plies === 0) return null;
    let result = null;
    if (turn === attacker) {
      for (const move of moves) {
        const next = applyMove(board, move);
        if (!isGeneralInCheck(next, opposite(turn))) continue;
        const child = visit(next, opposite(turn), plies - 1);
        if (child && (!result || child.plies + 1 < result.plies)) result = { plies: child.plies + 1, line: [moveToUci(move), ...child.line] };
      }
    } else {
      for (const move of moves) {
        const child = visit(applyMove(board, move), opposite(turn), plies - 1);
        if (!child) { cache.set(key, null); return null; }
        if (!result || child.plies + 1 > result.plies) result = { plies: child.plies + 1, line: [moveToUci(move), ...child.line] };
      }
    }
    cache.set(key, result); return result;
  }
  try {
    for (let moves = 1; moves <= maxMoves; moves++) {
      const result = visit(board, attacker, moves * 2 - 1);
      if (result) return { status: 'proven', attacker, maxMoves, nodes, elapsedMs: Date.now() - started, ...result };
    }
    return { status: 'not-found', attacker, maxMoves, nodes, elapsedMs: Date.now() - started, line: [] };
  } catch (error) {
    if (error !== limit) throw error;
    return { status: 'limit', attacker, maxMoves, nodes, elapsedMs: Date.now() - started, line: [] };
  }
}
