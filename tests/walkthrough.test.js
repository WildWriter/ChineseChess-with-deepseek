import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PUZZLES, findPuzzle } from '../src/puzzles.js';
import { trainingWalkthrough } from '../src/training-walkthrough.js';
import { buildWalkthrough, replayLine, validateDetailedResponse } from '../src/walkthrough.js';
import { studyPosition } from '../src/study-coach.js';
import { buildMessages, generateCoach } from '../src/coach.js';
import { attempt } from '../src/training.js';
import { parseFen, boardToFen, gameStatus, generateLegalMoves, moveToUci } from '../public/vendor/xiangqi.js';
import { createApp } from '../server.js';
import { detailedAnswer } from './model-fixture.js';

test('all exercises have replayable step evidence, representative variations and a final summary', () => {
  for (const puzzle of PUZZLES) {
    const walk = trainingWalkthrough(puzzle.id);
    assert.ok(walk.steps.length && walk.summary.length > 50, puzzle.id);
    assert.equal(walk.steps[0].beforeFen, puzzle.fen);
    for (const [index, step] of walk.steps.entries()) {
      assert.equal(replayLine(step.beforeFen, [step.move])[0].afterFen, step.afterFen);
      assert.equal(step.id, `S${index + 1}`);
      if (index) assert.equal(walk.steps[index - 1].afterFen, step.beforeFen);
      assert.ok(step.reason.length > 30 && step.consequence.length > 15);
      for (const branch of step.alternatives) {
        if (branch.verdict === 'illegal') { assert.equal(branch.line.length, 0); assert.ok(!generateLegalMoves(parseFen(step.beforeFen).board, step.turn).map(moveToUci).includes(branch.move)); }
        else assert.deepEqual(replayLine(step.beforeFen, branch.line.map(ply => ply.move)).map(ply => ply.afterFen), branch.line.map(ply => ply.afterFen));
      }
    }
    if (puzzle.goal === 'forced-mate') assert.equal(walk.steps.at(-1).outcome.reason, '绝杀');
  }
});

test('other winning moves are not classified as mistakes and stalemate is explained separately', () => {
  assert.ok(trainingWalkthrough('ending-ladder-two').steps[0].alternatives.some(branch => branch.verdict === 'correct'));
  const cannon = trainingWalkthrough('cannon-mate').steps[0];
  assert.ok(cannon.alternatives.some(branch => branch.verdict === 'correct'));
  const stale = cannon.alternatives.find(branch => branch.outcome?.reason === '困毙');
  assert.equal(stale.verdict, 'misses-goal'); assert.match(stale.explanation, /困毙/);
});

test('completed and in-progress training retain the actual full line and focus the current step', () => {
  const id = 'ending-ladder-two', first = attempt(id, 'b7b8');
  const current = trainingWalkthrough(id, null, first.history);
  assert.equal(current.steps[0].move, 'b7b8');
  assert.equal(current.steps[current.focusIndex].beforeFen, first.nextFen);
  const last = current.steps.at(-1).move, complete = attempt(id, last, first.history);
  assert.equal(complete.complete, true);
  const final = trainingWalkthrough(id, null, complete.history);
  assert.equal(final.steps.at(-1).move, last); assert.equal(final.focusIndex, final.steps.length - 1);
});

test('exhausted variation search stays unproven and engine references never assert inferior alternatives', () => {
  const puzzle = findPuzzle('ending-ladder-two'), moves = trainingWalkthrough(puzzle.id).steps.map(step => step.move);
  const limited = buildWalkthrough({ fen: puzzle.fen, moves, goal: 'checking-mate', task: puzzle.objective, maxMoves: 2, searchBudget: { maxNodes: 0 } });
  assert.ok(limited.steps[0].alternatives.some(branch => branch.verdict === 'unproven'));
  const reference = buildWalkthrough({ fen: puzzle.fen, moves, task: '参考线路' });
  assert.ok(reference.steps[0].alternatives.every(branch => branch.verdict === 'reference' || branch.verdict === 'illegal'));
});

test('detailed validation rejects missing steps, mismatched anchors, unsupported moves and invented citations', () => {
  const context = JSON.parse(buildMessages('ending-ladder-two')[1].content), valid = detailedAnswer(context);
  assert.equal(validateDetailedResponse(valid, context.walkthrough, context.evidence.map(item => item.id)).steps.length, 3);
  for (const change of [
    data => data.steps.pop(),
    data => data.steps[0].id = 'S2',
    data => data.steps[0].move = 'a1a7',
    data => data.steps[0].evidenceIds = ['S2'],
    data => data.steps[0].reason = '走 i0i9',
    data => data.steps[0].reason = '这步很好，继续。',
    data => data.steps[0].alternatives.pop(),
    data => data.steps[0].alternatives[0].id = 'invented',
    data => data.steps[0].alternatives[0].explanation = '不能这样走。',
    data => data.summary = '注意配合。',
    data => data.summary = ''
  ]) { const data = structuredClone(valid); change(data); assert.throws(() => validateDetailedResponse(data, context.walkthrough, context.evidence.map(item => item.id))); }
});

test('old short model responses cannot silently pass as complete explanations', async () => {
  const report = await generateCoach('rook-line', null, 'customized', null, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ move: 'a1a7', observation: '观察', reason: '简短旧输出', practice: '重练', evidenceIds: ['E1'] }) } }] }) }), { apiKey: 'mock-only' });
  assert.equal(report.source, 'lesson-fallback'); assert.ok(report.lesson.walkthrough.steps.length);
});

test('sandbox replays both sides, permits legal moves outside the exercise goal and rejects forged moves', () => {
  const base = findPuzzle('rook-line').fen;
  const position = studyPosition(base, ['a1a2', 'a7a6']);
  assert.equal(position.moves.length, 2); assert.equal(parseFen(position.fen).turn, 'w');
  assert.equal(position.playedLine.at(-1).afterFen, position.fen);
  for (const moves of [['a1b2'], ['a1a2', 'e0d0'], null, Array(81).fill('a1a2')]) assert.throws(() => studyPosition(base, moves), error => error.status === 400);
  const mate = trainingWalkthrough('pawn-mate').steps.at(-1).afterFen;
  assert.equal(gameStatus(parseFen(mate).board, parseFen(mate).turn).reason, '绝杀');
  assert.throws(() => studyPosition(mate, ['e9d9']), error => error.status === 400);
});

test('black-to-move walkthrough and sandbox keep the real side to move', () => {
  const original = parseFen(findPuzzle('rook-line').fen), fen = boardToFen(original.board, 'b');
  const token = moveToUci(generateLegalMoves(original.board, 'b')[0]);
  const line = buildWalkthrough({ fen, moves: [token], task: '黑方研究' });
  assert.equal(line.steps[0].side, '黑方'); assert.equal(parseFen(studyPosition(fen, [token]).fen).turn, 'w');
});

const post = (base, data) => fetch(base + '/api/study/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
test('sandbox HTTP analysis reconstructs the latest position, protects credentials and explains actual moves', async () => {
  const contexts = [];
  const server = createApp({ engineReady: () => false, fetchImpl: async (url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content); contexts.push(context);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(detailedAnswer(context)) } }] }) };
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = { baseFen: findPuzzle('rook-line').fen, moves: ['a1a2', 'a7a6'], modelSettings: { apiKey: 'mock-private-only' } };
    const response = await post(base, { ...request, fen: 'forged', engine: { score: 9999 } }); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.source, 'model'); assert.equal(result.positionFen, studyPosition(request.baseFen, request.moves).fen);
    assert.equal(result.walkthrough.steps[0].move, 'a7a6'); assert.equal(contexts[0].lastPlayed.move, 'a7a6');
    assert.equal(contexts[0].engine, null); assert.ok(!JSON.stringify(result).includes('mock-private-only'));
    assert.equal((await post(base, { ...request, moves: ['a1b2'] })).status, 400);
    assert.equal((await post(base, { ...request, modelSettings: undefined })).status, 400);
    assert.equal(contexts.length, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
