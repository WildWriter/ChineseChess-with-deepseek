import { checkedPosition } from './training.js';
import { boardToFen, generateLegalMoves, applyMove, opposite, gameStatus, isGeneralInCheck, moveToUci, uciToMove } from '../public/vendor/xiangqi.js';
import { formatMoveNotation } from '../public/vendor/xiangqi-notation.js';

const fail = message => Object.assign(new Error(message), { status: 400 });
export function validateImportedPosition(fen) {
  let position;
  try { position = checkedPosition(fen); }
  catch (error) { throw fail(error.message); }
  const { board, turn } = position, counts = {};
  const maxima = { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 };
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const piece = board[row][col]; if (piece === '.') continue;
    counts[piece] = (counts[piece] || 0) + 1;
    if (counts[piece] > maxima[piece.toUpperCase()]) throw fail('棋子数量超过标准象棋上限，请检查识别结果。');
    const r = piece === piece.toUpperCase() ? row : 9 - row;
    const type = piece.toUpperCase();
    if (type === 'K' && (r < 7 || col < 3 || col > 5)) throw fail('帅将必须在己方九宫内，请检查方向和位置。');
    if (type === 'A' && !['9,3','9,5','8,4','7,3','7,5'].includes(`${r},${col}`)) throw fail('士仕位置不合法，请检查识别结果。');
    if (type === 'B' && !['9,2','9,6','7,0','7,4','7,8','5,2','5,6'].includes(`${r},${col}`)) throw fail('象相位置不合法，请检查识别结果。');
    if (type === 'P' && (r > 6 || (r >= 5 && col % 2 !== 0))) throw fail('兵卒位置不合法，请检查识别结果。');
  }
  return { board, turn, fen: boardToFen(board, turn), pieceCount: Object.values(counts).reduce((a,b) => a+b, 0), status: gameStatus(board, turn) };
}

export function validatedLine(fen, tokens = []) {
  let { board, turn } = validateImportedPosition(fen);
  const line = [];
  for (const token of tokens.slice(0, 12)) {
    if (!generateLegalMoves(board, turn).some(move => moveToUci(move) === token)) break;
    const move = uciToMove(token), notation = formatMoveNotation(board, move), beforeFen = boardToFen(board, turn);
    board = applyMove(board, move); const nextTurn = opposite(turn);
    line.push({ move: token, side: turn === 'w' ? '红' : '黑', notation, beforeFen, afterFen: boardToFen(board, nextTurn), checking: isGeneralInCheck(board, nextTurn), replyCount: generateLegalMoves(board, nextTurn).length, outcome: gameStatus(board, nextTurn) });
    turn = nextTurn;
  }
  return line;
}

export function buildImportedReport(fen, proof, engine = null, engineWarning = null) {
  const position = validateImportedPosition(fen);
  let tokens = proof.status === 'proven' ? proof.line : [];
  if (!tokens.length && engine?.bestMove) tokens = engine.pv?.[0] === engine.bestMove ? engine.pv : [engine.bestMove];
  const line = validatedLine(position.fen, tokens);
  if (proof.status === 'proven' && (!line.length || line.length !== proof.line.length || line.at(-1).outcome.reason !== '绝杀')) throw new Error('Proof line failed independent rule validation.');
  // Never pass an unvalidated engine continuation into model evidence.
  const engineLine = engine ? validatedLine(position.fen, engine.pv?.[0] === engine.bestMove ? engine.pv : [engine.bestMove]) : [];
  const safeEngine = engine && engineLine.length ? { source: 'Pikafish', bestMove: engineLine[0].move, pv: engineLine.map(item => item.move), depth: engine.depth || 0, score: engine.score || null } : null;
  const side = position.turn === 'w' ? '红方' : '黑方';
  const terminal = position.status.state !== 'playing';
  const conclusion = terminal ? `局面已经结束：${side}${position.status.reason === '绝杀' ? '被绝杀' : '被困毙'}。`
    : proof.status === 'proven' ? `已核验：${side}可在 ${Math.ceil(proof.plies / 2)} 步内连续将军并绝杀；搜索覆盖对方全部合法应对。下方演示其中一条最长防守线路。`
    : `尚未证明指定步数内的连续将杀。${safeEngine ? '下方为引擎在有限搜索时间内给出的参考线路，不是必胜证明。' : '当前没有可用的引擎参考，请检查引擎或调整局面。'}`;
  const evidence = [
    { id: 'I1', text: `已通过静态局面检查；${side}行棋，共 ${position.pieceCount} 枚棋子。` },
    { id: 'I2', text: conclusion },
    { id: 'I3', text: line.length ? `逐步合法性已核验：${line.map(item => `${item.side}${item.notation}（${item.move}）`).join('；')}。` : '没有可供演示的合法推荐线路。' },
    { id: 'I4', text: '搜索只证明每步将军的短将杀，不覆盖全部缓着、长将长捉或完整残局胜和负；有限深度无解不等于和棋。' }
  ];
  return { fen: position.fen, turn: position.turn, status: position.status, proof, engine: safeEngine, engineWarning, recommendation: line[0]?.move || null, line, conclusion, evidence, createdAt: new Date().toISOString() };
}
