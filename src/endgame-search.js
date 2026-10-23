import { parseFen, boardToFen, generateLegalMoves, applyMove, opposite, isGeneralInCheck, moveToUci } from '../public/vendor/xiangqi.js';

// Bounded checking-mate exercises, NOT a general endgame/win-draw-loss oracle.
// Red must check on every move; every legal black defence is quantified.
const cache = new Map();
function distance(board, turn, plies) {
  const key = `${boardToFen(board, turn)}|${plies}`;
  if (cache.has(key)) return cache.get(key);
  const moves = generateLegalMoves(board, turn);
  let result = null;
  if (!moves.length) result = turn === 'b' && isGeneralInCheck(board, 'b') ? 0 : null;
  else if (plies > 0) {
    if (turn === 'w') {
      for (const move of moves) {
        const next = applyMove(board, move);
        if (!isGeneralInCheck(next, 'b')) continue;
        const child = distance(next, 'b', plies - 1);
        if (child !== null && (result === null || child + 1 < result)) result = child + 1;
      }
    } else if (isGeneralInCheck(board, 'b')) {
      result = 0;
      for (const move of moves) {
        const child = distance(applyMove(board, move), 'w', plies - 1);
        if (child === null) { result = null; break; }
        result = Math.max(result, child + 1);
      }
    }
  }
  if (cache.size > 30000) cache.clear();
  cache.set(key, result);
  return result;
}

export function checkingWins(fen, redMoves) {
  if (!Number.isInteger(redMoves) || redMoves < 1 || redMoves > 3) throw new Error('连续将杀题只支持红方 1–3 步。');
  const { board, turn } = parseFen(fen);
  if (turn !== 'w') throw new Error('连续将杀练习须轮到红方。');
  return generateLegalMoves(board, turn).flatMap(move => {
    const next = applyMove(board, move);
    if (!isGeneralInCheck(next, 'b')) return [];
    const child = distance(next, 'b', redMoves * 2 - 2);
    return child === null ? [] : [{ move: moveToUci(move), plies: child + 1 }];
  }).sort((a, b) => a.plies - b.plies || a.move.localeCompare(b.move));
}

export function hardestDefence(fen, remainingRedMoves) {
  const { board, turn } = parseFen(fen);
  if (turn !== 'b' || !isGeneralInCheck(board, 'b')) throw new Error('只有黑方被将军后才能自动应将。');
  const options = generateLegalMoves(board, turn).map(move => ({ move: moveToUci(move), plies: distance(applyMove(board, move), opposite(turn), remainingRedMoves * 2 - 1) }));
  if (!options.length) return null;
  if (options.some(option => option.plies === null)) throw new Error('此着法不能保证在指定步数内将杀。');
  return options.sort((a, b) => b.plies - a.plies || a.move.localeCompare(b.move))[0].move;
}
