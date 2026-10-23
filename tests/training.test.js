import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, publicPuzzle } from '../src/puzzles.js';
import { checkedPosition, solutionsFor, attempt, getHint, getLesson, makeEvidence } from '../src/training.js';
import { parseFen, applyMove, uciToMove, gameStatus } from '../public/vendor/xiangqi.js';
import { validatePV, analyze, engineAvailable } from '../src/engine.js';

test('all twenty teaching positions are valid and canonical answers satisfy targets', () => {
  assert.equal(PUZZLES.length, 20);
  assert.equal(new Set(PUZZLES.map(p => p.id)).size, PUZZLES.length);
  for (const p of PUZZLES) {
    checkedPosition(p.fen);
    assert.ok(solutionsFor(p).includes(p.canonical), p.id);
    assert.equal(attempt(p.id, p.canonical).correct, true);
  }
});
test('public curriculum does not send lesson, hints or canonical solution', () => {
  const p = publicPuzzle(PUZZLES[0]);
  for (const key of ['canonical','hints','lesson','reflection']) assert.ok(!(key in p));
});
test('a legal move not achieving the target is distinct from an illegal move', () => {
  const legal = attempt('rook-line','a1a2'); assert.equal(legal.legal,true); assert.equal(legal.correct,false);
  const illegal = attempt('rook-line','a1b2'); assert.equal(illegal.legal,false); assert.equal(illegal.correct,false);
});
test('cannon must use a screen and specified attacking piece', () => {
  assert.equal(attempt('cannon-screen','b2b7').correct,true);
  assert.equal(attempt('cannon-screen','b2b6').legal,false);
  assert.equal(attempt('cannon-screen','b4b7').correct,false);
});
test('horse leg differs for different destinations', () => {
  assert.equal(attempt('horse-leg','b1a3').legal,false);
  assert.equal(attempt('horse-leg','b1d2').correct,true);
});
test('crossed pawn can move sideways but not backward', () => {
  assert.equal(attempt('pawn-sideways','d8e8').correct,true);
  assert.equal(attempt('pawn-sideways','d8d7').legal,false);
});
test('every valid evasion is accepted, not just the sample answer', () => {
  const p=PUZZLES.find(p=>p.id==='answer-check');
  assert.deepEqual(solutionsFor(p).sort(),['a1e1','e0f0']);
  assert.equal(attempt(p.id,'e0f0').correct,true);
});
test('mate puzzles accept all actual mates including noncanonical solutions', () => {
  assert.deepEqual(solutionsFor(PUZZLES.find(p=>p.id==='pawn-mate')).sort(),['d7c7','d7d8','d7e7']);
  assert.deepEqual(solutionsFor(PUZZLES.find(p=>p.id==='cannon-mate')).sort(),['c5d5','d7d8']);
  assert.equal(attempt('pawn-mate','d7c7').correct,true);
});
test('stalemate is not accepted as checkmate even though it wins in xiangqi', () => {
  const p=PUZZLES.find(p=>p.id==='cannon-mate');
  const board=applyMove(parseFen(p.fen).board,uciToMove('d7c7'));
  assert.equal(gameStatus(board,'b').reason,'困毙');
  const result=attempt(p.id,'d7c7');assert.equal(result.legal,true);assert.equal(result.correct,false);
});
test('hint levels are bounded and only final hint provides a coordinate move', () => {
  assert.equal(getHint('rook-line',1).move,null); assert.equal(getHint('rook-line',3).move,'a1a7');
  assert.throws(()=>getHint('rook-line',4));assert.throws(()=>getHint('rook-line','1'));
});
test('actual alternative solution has its own move evidence', () => {
  const result=getLesson('pawn-mate','d7c7');assert.equal(result.move,'d7c7');assert.equal(result.checking,true);assert.equal(result.replyCount,0);
});
test('strict FEN validation rejects invalid turns, duplicate kings and malformed boards', () => {
  for(const fen of ['bad','9/9/9/9/9/9/9/9/9/9 w','4k4/9/9/9/4P4/9/9/9/9/3KK4 w','4k4/9/9/9/4P4/9/9/9/9/4K4 x'])assert.throws(()=>checkedPosition(fen));
});
test('PV validation stops at first illegal continuation', () => {
  const fen=PUZZLES[0].fen;assert.deepEqual(validatePV(fen,['a1a7','e9e8','z9z9']),['a1a7','e9e8']);
});
test('evidence states facts rather than asserting engine optimality', () => {
  const report=makeEvidence(PUZZLES[0]);assert.equal(report.correct,true);assert.ok(report.evidence[1].text.includes('黑车'));assert.ok(!JSON.stringify(report).includes('最优'));
});
test('real engine returns legal moves and identifies immediate stalemate separately', {skip:!engineAvailable()}, async () => {
  const result=await analyze(PUZZLES.find(p=>p.id==='cannon-mate').fen,300);
  assert.equal(validatePV(PUZZLES.find(p=>p.id==='cannon-mate').fen,[result.bestMove]).length,1);
  if(result.bestMove==='d7c7')assert.equal(result.immediateOutcome.reason,'困毙');
});
