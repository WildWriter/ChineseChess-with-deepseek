import assert from 'node:assert/strict';
import { PUZZLES } from '../src/puzzles.js';
import { checkedPosition, solutionsFor, makeEvidence, attempt, getHint } from '../src/training.js';
for (const puzzle of PUZZLES) {
  checkedPosition(puzzle.fen);
  const solutions = solutionsFor(puzzle);
  assert.ok(solutions.length, `${puzzle.id} has no solution`);
  assert.ok(solutions.includes(puzzle.canonical), `${puzzle.id} canonical fails its goal`);
  console.log(`${puzzle.id}: ${solutions.length} solution(s), example ${makeEvidence(puzzle).notation}`);
  if(puzzle.maxRedMoves){
    let history=[],report;
    do{report=attempt(puzzle.id,history.length?getHint(puzzle.id,3,history).move:puzzle.canonical,history);assert.equal(report.correct,true);history=report.history;}while(!report.complete);
    assert.ok(history.length<=puzzle.maxRedMoves);
    console.log(`  Completed in ${history.length} red moves: ${report.line.map(item=>item.move).join(' ')}.`);
  }
}
console.log(`Verified ${PUZZLES.length} authored teaching positions.`);
