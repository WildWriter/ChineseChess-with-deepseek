import { positionVerdict } from './outcome.js';
import { findPuzzle } from './puzzles.js';
import { getLesson, meetsGoal } from './training.js';
import { replayEndgame } from './endgame-training.js';
import { checkingWins } from './endgame-search.js';
import { buildWalkthrough } from './walkthrough.js';

export function trainingWalkthrough(id, move, history = []) {
  const puzzle = findPuzzle(id), lesson = getLesson(id, move, history);
  let moves = [lesson.move], focusIndex = 0;
  if (puzzle.goal === 'forced-mate') {
    let position = replayEndgame(puzzle, history), red = [...history];
    focusIndex = position.line.length;
    while (!position.complete) {
      const selected = red.length === history.length ? lesson.move : checkingWins(position.fen, position.remaining)[0].move;
      red.push(selected); position = replayEndgame(puzzle, red);
    }
    moves = position.line.map(item => item.move);
    if (focusIndex >= moves.length) focusIndex = moves.length - 1;
  }
  const result=positionVerdict(puzzle.fen,{proof:['forced-mate','mate'].includes(puzzle.goal)?{status:'proven'}:null});
  return buildWalkthrough({ result, fen: puzzle.fen, moves, task: puzzle.objective, goal: ['forced-mate', 'mate'].includes(puzzle.goal) ? 'checking-mate' : puzzle.goal, maxMoves: puzzle.maxRedMoves || 1, focusIndex, goalTest: puzzle.goal === 'forced-mate' ? undefined : (board, turn, candidate) => meetsGoal(puzzle, board, turn, candidate) });
}
