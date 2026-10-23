import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {buildWalkthrough,validateDetailedResponse,walkthroughMoves,walkthroughRejectedMoves,inspectDetailedResponse} from '../src/walkthrough.js';
import {validateCoachResponse} from '../src/coach-validation.js';
import {trainingWalkthrough} from '../src/training-walkthrough.js';
import {enrichTeaching} from '../src/teaching-analysis.js';
import {detailedAnswer} from './model-fixture.js';
import {createApp} from '../server.js';

const fen='9/9/3aka3/9/6b2/9/6P2/9/4A4/3AK1Bp1 w - - 0 1';
const contextOf=walkthrough=>({candidateMove:walkthrough.steps[0].move,evidence:walkthrough.evidence,walkthrough});
test('S10 e7f7 is permitted as a verified forbidden example but cannot be recommended as a continuation',()=>{
  const moves=['g0i2','g5i7','e0f0','e7e8','f0f1','i7g9','f1f2','h0i0','e1f0','e8e7','i2g4','i0h0'];
  const walk=buildWalkthrough({fen,moves,task:'理解当前局面'}),context=contextOf(walk),answer=detailedAnswer(context),step=walk.steps[9];
  const blocked=step.facts.after.generals.b.neighbours.find(n=>n.attempt==='e7f7');
  assert.equal(blocked.legal,false);assert.equal(blocked.blockedBy,'黑士');
  assert.equal(step.facts.after.generals.b.neighbours.find(n=>n.attempt==='e7e6').outsidePalace,true);
  assert.ok(walkthroughRejectedMoves({steps:[step]}).includes('e7f7'));
  const base=answer.steps[9].reason;
  for(const sentence of ['不能走 e7f7，因为 f7 有己方黑士挡住。','e7f7 不可走，f7 的黑士占据了落点。','不能走 e7e6，因为 e6 已在黑方九宫之外。']){
    answer.steps[9].reason=base+sentence;
    assert.equal(validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)).steps.length,12);
  }
  answer.steps[9].reason=base+' 接下来应该走 e7f7，黑将横移即可展开进攻。';
  assert.ok(inspectDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)).issues.some(i=>i.kind==='coordinate'&&i.stepId==='S10'&&i.move==='e7f7'));
  for(const sentence of ['不能只考虑 e7f7 的攻击效果。','e7f7 不能被对方阻挡，黑将即可展开进攻。']){
    answer.steps[9].reason=base+sentence;
    assert.throws(()=>validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)),e=>e.validationIssue.move==='e7f7');
  }
  answer.steps[9].reason=base+' 不能走 i0i9，这是没有提供核验依据的假设。';
  assert.throws(()=>validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)),e=>e.validationIssue.move==='i0i9');
  answer.reason+=' 不能走 e7f7，因为 f7 有黑士。';
  assert.equal(validateCoachResponse(JSON.stringify(answer),answer.move,walk.evidence.map(e=>e.id),walkthroughMoves(walk),walkthroughRejectedMoves(walk)).move,answer.move);
});
test('the reported position allows alternatives and defences to contrast the provided primary move',()=>{
  const walk=buildWalkthrough({fen,moves:['g0i2','g5i7'],task:'理解参考线路'}),context=contextOf(walk),answer=detailedAnswer(context);
  const first=walk.steps[0],branch=first.alternatives.findIndex(b=>!b.line.some(p=>p.move===first.move));
  assert.ok(branch>=0);
  answer.steps[0].alternatives[branch].explanation+=' 对比主着 '+first.move+'，应结合双方子力和给定后续判断调动作用，而不能仅凭走法合法判断好坏。';
  answer.steps[0].responses[0].explanation+=' 这是针对主着 '+first.move+' 后的应对，需要在对应局面继续计算。';
  assert.equal(validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)).steps.length,2);
  assert.ok(walk.steps[1].legalMoves.includes('h0g0'));
  answer.steps[1].reason+=' 黑方也可以 h0g0 横卒；这里只确认它在走前局面合法，没有该着的独立评分，不能据此断言优于象的调动。';
  assert.equal(validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)).steps.length,2);
  answer.steps[0].alternatives[branch].explanation+=' 未提供的 i0i9。';
  assert.throws(()=>validateDetailedResponse(answer,walk,walk.evidence.map(e=>e.id)),error=>error.validationIssue?.kind==='coordinate'&&error.validationIssue.field==='alternatives'&&error.validationIssue.stepId==='S1');
});
test('returned steps and branches are anchored by unique IDs and harmless summary punctuation is normalized',()=>{
  const walk=trainingWalkthrough('ending-ladder-two'),answer=detailedAnswer(contextOf(walk)),ids=walk.evidence.map(e=>e.id);
  answer.steps.reverse();for(const step of answer.steps){step.alternatives.reverse();step.responses.reverse();}
  answer.summary=answer.summary.replace('胜负结论：','胜负结论: ');
  const result=validateDetailedResponse(answer,walk,ids);
  assert.deepEqual(result.steps.map(s=>s.id),walk.steps.map(s=>s.id));assert.match(result.summary,/^胜负结论：红胜/);
  const duplicate=structuredClone(answer);duplicate.steps[0]=duplicate.steps[1];
  assert.throws(()=>validateDetailedResponse(duplicate,walk,ids),e=>e.validationIssue.kind==='identity');
  answer.summary='胜负结论：黑胜。'+answer.summary;
  assert.throws(()=>validateDetailedResponse(answer,walk,ids),e=>e.validationIssue.kind==='result');
});
test('all twelve verified PV moves and tool-provided endpoint facts remain valid teaching references',async()=>{
  const root='9/9/3aka3/9/6b2/9/6P2/8B/4A4/3AK2p1 b - - 0 1';
  const pv=['g5i7','i2g4','d7e8','e0f0','e8d9','g4i2','f7e8','i2g4','e8d7','g4i2','h0i0','i2g0'];
  let calls=0;
  const walk=await enrichTeaching(buildWalkthrough({fen:root,moves:[pv[0]],task:'理解参考线路'}),async()=>{
    calls++;return {variations:calls===1?[{move:pv[0],pv,depth:20,score:{type:'cp',value:0,bound:null}}]:[]};
  });
  assert.equal(walk.steps[0].comparison.mainContinuation.line.length,12);
  const answer=detailedAnswer(contextOf(walk));
  answer.steps[0].reason+=' 后续 '+pv.slice(8).join('、')+' 来自给定的引擎参考，不代表整盘胜负已经确定。';
  for(const move of pv)assert.ok(walkthroughMoves(walk).includes(move));
  assert.equal(validateDetailedResponse(answer,walk,['S1']).steps.length,1);
});
test('HTTP failure reports the exact stage without returning raw model text or credentials and never retries automatically',async t=>{
  let mode='coverage',calls=0;
  const marker='private-provider-body-not-for-output',key='test-only-page-key';
  const server=createApp({engineReady:()=>false,fetchImpl:async(url,options)=>{
    calls++;const context=JSON.parse(JSON.parse(options.body).messages[1].content),answer=detailedAnswer(context);
    if(mode==='coverage')answer.steps[0].responses.pop();
    if(mode==='coordinate')answer.steps[0].alternatives[0].explanation+=' i0i9';
    if(mode==='text')answer.steps[0].reason='';
    if(mode==='result')answer.summary='胜负结论：和棋。'+answer.summary;
    return {ok:true,json:async()=>({choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:mode==='format'?marker:JSON.stringify(answer)}}]})};
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port;
  const body={fen:trainingWalkthrough('ending-ladder-two').steps[0].beforeFen,maxMoves:2,modelSettings:{apiKey:key}};
  for(const kind of ['coverage','text','format','truncated']){
    body.modelSettings.apiKey=key+'-'+kind;
    mode=kind;const response=await fetch(base+'/api/import/explain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
    assert.equal(response.status,502);assert.equal(data.code,'MODEL_IMPORT_RESPONSE_INVALID');assert.equal(data.validationIssue.kind,kind);
    assert.ok(!JSON.stringify(data).includes(marker));assert.ok(!JSON.stringify(data).includes(key));
    if(kind==='coverage'){assert.equal(data.validationIssue.stepId,'S1');assert.equal(data.validationIssue.field,'responses');assert.match(data.error,/第 1 步.*收到 \d+ 项/);assert.equal(data.validationIssue.expected-data.validationIssue.actual,1);}
  }
  assert.equal(calls,4);
  const diagnostic=await(await fetch(base+'/api/coach/diagnostics')).json();
  assert.deepEqual(diagnostic.failures.map(f=>f.issue.kind),['coverage','text','format','truncated']);
  for(const value of [key,marker,body.fen])assert.ok(!JSON.stringify(diagnostic).includes(value));
  for(let n=0;n<4;n++){mode='format';await fetch(base+'/api/import/explain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
  assert.equal((await(await fetch(base+'/api/coach/diagnostics')).json()).failures.length,8);assert.equal(calls,8);
  const publicServer=createApp({publicMode:true,engineReady:()=>false});publicServer.listen(0,'127.0.0.1');await once(publicServer,'listening');
  t.after(async()=>{publicServer.closeAllConnections();await new Promise(resolve=>publicServer.close(resolve));});
  assert.equal((await fetch('http://127.0.0.1:'+publicServer.address().port+'/api/coach/diagnostics')).status,404);
});
