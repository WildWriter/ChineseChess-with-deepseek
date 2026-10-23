import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createApp } from '../server.js';
import { requestDetailedCoach } from '../src/coach-completion.js';
import { buildWalkthrough, walkthroughMoves } from '../src/walkthrough.js';
import { trainingWalkthrough } from '../src/training-walkthrough.js';
import { resolveModelConfig } from '../src/model-client.js';
import { detailedAnswer } from './model-fixture.js';

const fen='9/9/3aka3/9/6b2/9/6P2/9/4A4/3AK1Bp1 w - - 0 1';
function setup(key,providedWalkthrough){
  const walkthrough=providedWalkthrough||buildWalkthrough({fen,moves:['g0i2','g5i7','e0f0','e7e8'],task:'核对逐步讲解'});
  const context={candidateMove:walkthrough.steps[0].move,evidence:walkthrough.evidence,walkthrough};
  return {context,config:resolveModelConfig({apiKey:key}),identity:['advisory',key],
    messages:[{role:'system',content:'保持原先提示词，不为一致性提醒添加补写请求。'},{role:'user',content:JSON.stringify(context)}],
    task:{expectedMove:context.candidateMove,evidenceIds:walkthrough.evidence.map(e=>e.id),allowedMoves:walkthroughMoves(walkthrough),walkthrough}};
}
const response=data=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});

test('the four reported coordinate warnings display the original prose and never rewrite playable lines',async()=>{
  const args=setup('advisory-four'),answer=detailedAnswer(args.context),before=structuredClone(args.task.walkthrough);
  answer.steps[0].observation+=' 本次保留模型提到的 d9c9，提示而不拦截。';
  answer.steps[1].alternatives[0].explanation+=' 模型另外讨论 e7c5。';
  answer.steps[2].alternatives[0].explanation+=' 模型另外讨论 e1e5。';
  answer.steps[3].alternatives[0].explanation+=' 模型另外讨论 e7g9。';
  let calls=0;
  const run=()=>requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);
    assert.equal(body.messages[0].content,args.messages[0].content);
    assert.equal(JSON.parse(body.messages[1].content).repair,undefined);
    return response(answer);
  }});
  const result=await run();
  assert.equal(calls,1);assert.equal(result.content.validationMode,'advisory');
  for(const move of ['d9c9','e7c5','e1e5','e7g9'])assert.ok(result.content.validationWarnings.some(w=>w.move===move),move);
  assert.equal(result.content.walkthrough.steps[0].observation,answer.steps[0].observation);
  for(let i=0;i<before.steps.length;i++){
    assert.equal(result.content.walkthrough.steps[i].move,before.steps[i].move);
    assert.deepEqual(result.content.walkthrough.steps[i].alternatives.map(b=>b.line),before.steps[i].alternatives.map(b=>b.line));
  }
  await run();assert.equal(calls,2); // accepted prose is not kept as a failed repair draft
});

test('move, citations and result disagreements warn without replacing authoritative board facts',async()=>{
  const args=setup('advisory-fields'),answer=detailedAnswer(args.context);
  answer.move='i0i9';answer.evidenceIds=['UNKNOWN'];answer.steps[0].move='i0i9';answer.steps[0].evidenceIds=['UNKNOWN'];
  answer.summary='胜负结论：和棋。'+answer.summary;
  const {content}=await requestDetailedCoach({...args,fetchImpl:async()=>response(answer)});
  for(const kind of ['move','evidence','result'])assert.ok(content.validationWarnings.some(w=>w.kind===kind));
  assert.equal(content.move,args.task.expectedMove);assert.equal(content.modelMove,'i0i9');
  assert.equal(content.walkthrough.steps[0].move,args.task.walkthrough.steps[0].move);
  assert.equal(content.walkthrough.result.label,args.task.walkthrough.result.label);
  assert.equal(content.walkthrough.summary,answer.summary);assert.deepEqual(content.evidenceIds,['UNKNOWN']);
});

test('the actual reported ten-piece board also displays all four simulated model inconsistencies',async()=>{
  const actualFen='3k5/4PP3/4bN3/9/9/9/9/3n5/4r1p2/2R2K3 w - - 0 1';
  const moves=['e8d8','d9d8','f8e8','d8d9','c0c9','e7c9','e8d8'];
  const walk=buildWalkthrough({fen:actualFen,moves,task:'解释真实用户报告的参考线路'});
  const args=setup('advisory-actual-board',walk),answer=detailedAnswer(args.context);
  for(const [index,move]of ['d9c9','e7c5','e1e5','e7g9'].entries()){
    if(index===0)answer.steps[index].observation+=' 模拟模型提到 '+move+'，这是回归测试文字。';
    else answer.steps[index].alternatives[0].explanation+=' 模拟模型提到 '+move+'，这是回归测试文字。';
  }
  const {content}=await requestDetailedCoach({...args,fetchImpl:async()=>response(answer)});
  for(const move of ['d9c9','e7c5','e1e5','e7g9'])assert.ok(content.validationWarnings.some(w=>w.move===move),move);
  assert.equal(content.walkthrough.steps.length,7);assert.equal(content.walkthrough.steps[0].beforeFen,actualFen);
  assert.deepEqual(content.walkthrough.steps.map(step=>step.move),moves);
});

test('advisory mode still rejects broken JSON, malformed IDs, missing structure and unsafe field types',async()=>{
  for(const [name,change]of [
    ['missing-step',a=>a.steps.pop()],['duplicate-id',a=>a.steps[1]=a.steps[0]],
    ['object-evidence',a=>a.evidenceIds=[{apiKey:'do-not-render'}]],['object-move',a=>a.move={}],
    ['missing-text',a=>delete a.steps[0].reason]
  ]){
    const args=setup('advisory-shape-'+name),answer=detailedAnswer(args.context);change(answer);
    await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(answer)}));
  }
  const args=setup('advisory-json');
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})}),e=>e.validationIssue.kind==='format');
});

test('readable short prose is advisory rather than another length-based retry barrier',async()=>{
  const args=setup('advisory-short'),answer=detailedAnswer(args.context);
  answer.steps[0].observation='先看帅将。';answer.steps[0].reason='这里应结合当前局面判断。';
  answer.steps[0].alternatives[0].explanation='可以比较这步。';answer.summary='胜负暂未确定。';
  const {content}=await requestDetailedCoach({...args,fetchImpl:async()=>response(answer)});
  assert.equal(content.walkthrough.steps[0].reason,answer.steps[0].reason);
  assert.equal(content.walkthrough.summary,answer.summary);
  assert.ok(content.validationWarnings.some(w=>w.kind==='text'&&w.field==='reason'));
});

test('training, import and sandbox HTTP endpoints return advisory model output with one call each',async t=>{
  let calls=0;
  const server=createApp({engineReady:()=>false,fetchImpl:async(url,options)=>{
    calls++;const context=JSON.parse(JSON.parse(options.body).messages[1].content),answer=detailedAnswer(context);
    answer.steps[0].observation+=' 模型提到未经核验的 i0i9，保留原文供查看。';
    return response(answer);
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port,baseFen=trainingWalkthrough('ending-ladder-two').steps[0].beforeFen;
  for(const [route,body]of [['/api/coach',{id:'ending-ladder-two'}],['/api/import/explain',{fen:baseFen,maxMoves:2}],['/api/study/analyze',{baseFen,moves:[]}]]){
    const key='mock-advisory-'+route,before=calls;
    const res=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,modelSettings:{apiKey:key}})});
    const result=await res.json();assert.equal(res.status,200);assert.equal(result.source,'model');assert.equal(calls,before+1);
    assert.ok(result.validationWarnings.some(w=>w.move==='i0i9'));assert.ok(result.walkthrough.steps[0].observation.includes('i0i9'));
    assert.ok(!JSON.stringify(result).includes(key));assert.ok(!result.semanticReview.includes('已核验步骤对应、变化线路合法性、坐标'));
  }
  const diagnostics=await(await fetch(base+'/api/coach/diagnostics')).json();assert.deepEqual(diagnostics.failures,[]);
});

test('the existing domain prompt file is unchanged from the submitted archive',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../SOURCE-MANIFEST.json',import.meta.url),'utf8'));
  const expected=manifest.files.find(file=>file.path==='src/coach-prompt.js').sha256;
  const actual=createHash('sha256').update(await readFile(new URL('../src/coach-prompt.js',import.meta.url))).digest('hex');
  assert.equal(actual,expected);
});
