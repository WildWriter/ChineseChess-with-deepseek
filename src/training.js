import { parseFen, validatePosition, generateLegalMoves, applyMove, opposite, gameStatus, isGeneralInCheck, moveToUci, uciToMove, pieceName, pieceSide, boardToFen } from '../public/vendor/xiangqi.js';
import { formatMoveNotation } from '../public/vendor/xiangqi-notation.js';
import { findPuzzle } from './puzzles.js';
import { retrieveKnowledge } from './knowledge.js';
import { checkingWins } from './endgame-search.js';
import { attemptEndgame, replayEndgame, endgameLesson, endgameHint } from './endgame-training.js';

export function checkedPosition(fen) {
  if (typeof fen !== 'string' || fen.length > 220 || !/^[rnbakcpheRNBAKCPHE1-9/]+ [wb](?: - - \d+ \d+)?$/.test(fen.trim())) {
    throw Object.assign(new Error('FEN 格式不正确。'), { status: 400 });
  }
  const position = parseFen(fen);
  for (const side of ['K', 'k']) {
    if (position.board.flat().filter(piece => piece === side).length !== 1) {
      throw Object.assign(new Error('棋盘必须各有且只有一个帅和将。'), { status: 400 });
    }
  }
  const verdict = validatePosition(position.board, position.turn);
  if (!verdict.ok) throw Object.assign(new Error(verdict.message), { status: 400 });
  return position;
}

export function meetsGoal(puzzle, board, turn, move) {
  const next = applyMove(board, move);
  if (puzzle.goal === 'mate') return gameStatus(next, opposite(turn)).reason === '绝杀';
  if (puzzle.goal === 'escape') return !isGeneralInCheck(next, turn);
  if (puzzle.goal === 'capture') {
    const square = moveToUci(move).slice(2);
    const target = board[move.to[0]][move.to[1]];
    const own = board[move.from[0]][move.from[1]];
    return square === puzzle.target && target !== '.' && pieceSide(target) !== turn && (!puzzle.requiredPiece || own === puzzle.requiredPiece);
  }
  return false;
}

export function solutionsFor(puzzle) {
  if(puzzle.goal==='forced-mate')return checkingWins(puzzle.fen,puzzle.maxRedMoves).map(item=>item.move);
  const { board, turn } = checkedPosition(puzzle.fen);
  return generateLegalMoves(board, turn).filter(move => meetsGoal(puzzle, board, turn, move)).map(moveToUci);
}

export function makeEvidence(puzzle, moveUci = puzzle.canonical) {
  if(puzzle.goal==='forced-mate')return endgameLesson(puzzle,[],moveUci);
  const { board, turn } = checkedPosition(puzzle.fen);
  const move = uciToMove(moveUci);
  const legal = generateLegalMoves(board, turn).some(item => moveToUci(item) === moveUci);
  if (!legal) throw Object.assign(new Error('这一步不符合走子规则，或会使己方帅将受攻击。'), { status: 400 });
  const next = applyMove(board, move);
  const enemy = opposite(turn);
  const replies = generateLegalMoves(next, enemy);
  const captured = board[move.to[0]][move.to[1]];
  const checking = isGeneralInCheck(next, enemy);
  const notation = formatMoveNotation(board, move);
  const evidence = [
    { id: 'E1', text: `${notation}（${moveUci}）通过本项目基础规则检查。` },
    { id: 'E2', text: captured === '.' ? '目标位置原为空点，没有吃子。' : `这一步吃掉了${pieceSide(captured) === 'w' ? '红' : '黑'}${pieceName(captured)}。` },
    { id: 'E3', text: `走后${checking ? '形成将军' : '没有形成将军'}，对方有 ${replies.length} 个合法应对。` },
    { id: 'E4', text: meetsGoal(puzzle, board, turn, move) ? '这一步达到题目明确要求的训练目标。' : '这一步合法，但没有达到本题指定目标。' }
  ];
  return { move: moveUci, notation, nextFen: boardToFen(next, enemy), evidence, checking, replyCount: replies.length, correct: meetsGoal(puzzle, board, turn, move), knowledge: retrieveKnowledge(puzzle.knowledge) };
}

export function attempt(id, moveUci, history=[]) {
  const puzzle = findPuzzle(id);
  if(puzzle.goal==='forced-mate')return attemptEndgame(puzzle,moveUci,history);
  if (typeof moveUci !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(moveUci)) {
    throw Object.assign(new Error('请选择起点和终点。'), { status: 400 });
  }
  const { board, turn } = checkedPosition(puzzle.fen);
  const legal = generateLegalMoves(board, turn).some(move => moveToUci(move) === moveUci);
  if (!legal) return { legal: false, correct: false, message: '这一步不合法：请检查走子规则、路径阻挡，以及己方帅将安全。' };
  const report = makeEvidence(puzzle, moveUci);
  return { legal: true, ...report, message: report.correct ? '完成本题目标！' : '走法合法，但还没有完成本题目标。请回到原局面再试。', lesson: report.correct ? puzzle.lesson : null, reflection: report.correct ? puzzle.reflection : null };
}

export function getHint(id, level, history=[]) {
  const puzzle = findPuzzle(id);
  if (!Number.isInteger(level) || level < 1 || level > 3) throw Object.assign(new Error('提示等级应为 1 到 3。'), { status: 400 });
  if(puzzle.goal==='forced-mate')return endgameHint(puzzle,level,history);
  return { level, text: puzzle.hints[level - 1], move: level === 3 ? puzzle.canonical : null };
}

export function getLesson(id, move, history=[]) {
  const puzzle = findPuzzle(id);
  if(puzzle.goal==='forced-mate')return endgameLesson(puzzle,history,move);
  const selected = solutionsFor(puzzle).includes(move) ? move : puzzle.canonical;
  return { source: 'lesson', title: '教案讲解', lesson: puzzle.lesson, reflection: puzzle.reflection, ...makeEvidence(puzzle, selected) };
}

export function analysisFen(id,history=[]) {
  const puzzle=findPuzzle(id);
  if(puzzle.goal!=='forced-mate')return puzzle.fen;
  const context=replayEndgame(puzzle,history);
  return context.complete?context.last.fen:context.fen;
}
