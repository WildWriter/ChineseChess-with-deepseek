import test from 'node:test';
import assert from 'node:assert/strict';
import {positionVerdict} from '../src/outcome.js';
import {trainingWalkthrough} from '../src/training-walkthrough.js';
import {buildMessages} from '../src/coach.js';
import {validateDetailedResponse,replayLine} from '../src/walkthrough.js';
import {findPuzzle} from '../src/puzzles.js';
import {parseFen,boardToFen} from '../public/vendor/xiangqi.js';
import {searchImportedMate} from '../src/position-search.js';
import {buildImportedReport} from '../src/imported-position.js';
import {detailedAnswer} from './model-fixture.js';

test('summary names proven red and black wins and does not confuse a capture lesson with winning the game',()=>{
  assert.equal(trainingWalkthrough('ending-ladder-two').result.label,'红胜');
  assert.match(trainingWalkthrough('ending-ladder-two').summary,/^胜负结论：红胜/);
  assert.equal(trainingWalkthrough('rook-line').result.state,'unknown');
  const p=parseFen(findPuzzle('ending-ladder-two').fen);
  const black=p.board.slice().reverse().map(row=>row.slice().reverse().map(c=>c==='.'?c:c===c.toUpperCase()?c.toLowerCase():c.toUpperCase()));
  const fen=boardToFen(black,'b'),proof=searchImportedMate(fen,2);
  assert.equal(proof.status,'proven');
  const report=buildImportedReport(fen,proof);
  assert.equal(report.result.label,'黑胜');assert.match(report.conclusion,/^胜负结论：黑胜/);
  assert.equal(positionVerdict(report.line.at(-1).afterFen).label,'黑胜');
});
test('no mate, resource limits, zero engine scores and a winning sample PV never become a draw or proof',()=>{
  const fen=findPuzzle('rook-line').fen;
  for(const status of ['not-found','limit']){
    const verdict=positionVerdict(fen,{proof:{status},engine:{depth:10,score:{type:'cp',value:0}}});
    assert.equal(verdict.state,'unknown');assert.match(verdict.basis,/不能.*和棋/);
  }
  const p=positionVerdict(fen,{engine:{depth:12,score:{type:'cp',value:-300}}});
  assert.equal(p.label,'胜负暂未确定');assert.match(p.basis,/偏向黑方/);
  assert.equal(positionVerdict(fen,{engine:{score:{type:'mate',value:2}}}).state,'unknown');
});
test('step facts describe actual material, cannon screens and every sampled opponent continuation is legal',()=>{
  const rook=trainingWalkthrough('rook-line').steps[0];
  assert.equal(rook.facts.before.material.b['车'],1);assert.equal(rook.facts.after.material.b['车'],undefined);
  const cannon=trainingWalkthrough('cannon-screen').steps[0];
  assert.deepEqual(cannon.facts.geometry.between,[{square:'b4',piece:'R',name:'红车'}]);
  for(const step of trainingWalkthrough('ending-ladder-two').steps){
    assert.equal(step.responses.length,Math.min(3,step.replyCount));
    for(const reply of step.responses){
      assert.equal(reply.line[0].beforeFen,step.afterFen);
      assert.deepEqual(replayLine(step.afterFen,reply.line.map(p=>p.move)).map(p=>p.afterFen),reply.line.map(p=>p.afterFen));
      assert.ok(reply.explanation.includes(reply.notation));
    }
  }
});
test('teaching contract rejects generic filler, omitted responses, moved anchors and invented summary results',()=>{
  const messages=buildMessages('ending-ladder-two'),context=JSON.parse(messages[1].content),good=detailedAnswer(context);
  assert.match(messages[0].content,/为什么现在这样走/);assert.match(messages[0].content,/合法性.*不是.*理由/);
  const evidence=context.evidence.map(i=>i.id);
  for(const change of [
    d=>d.steps[0].responses.pop(),
    d=>d.steps[0].responses[0].id='S2R1',
    d=>d.steps[0].responses[0].explanation='注意观察局面，加强配合，留意安全。'.repeat(6),
    d=>d.steps[0].reason='注意观察局面，加强配合，留意安全。'.repeat(8),
    d=>d.summary='胜负结论：和棋。'+d.summary,
    d=>d.summary='胜负结论：黑胜。'+d.summary
  ]){const data=structuredClone(good);change(data);assert.throws(()=>validateDetailedResponse(data,context.walkthrough,evidence));}
});
