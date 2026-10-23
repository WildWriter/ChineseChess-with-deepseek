import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDetailedCoach} from '../src/coach-completion.js';
import {resolveModelConfig} from '../src/model-client.js';
import {buildWalkthrough,walkthroughMoves} from '../src/walkthrough.js';
import {detailedAnswer} from './model-fixture.js';
import {coachAnswerFailure} from '../src/coach-validation.js';
import {createApp} from '../server.js';
import {once} from 'node:events';
import {trainingWalkthrough} from '../src/training-walkthrough.js';

const fen='9/9/3aka3/9/6b2/9/6P2/9/4A4/3AK1Bp1 w - - 0 1';
function setup(key) {
  const walkthrough=buildWalkthrough({fen,moves:['g0i2','g5i7'],task:'理解当前线路'});
  const context={candidateMove:'g0i2',evidence:walkthrough.evidence,walkthrough};
  return {config:resolveModelConfig({apiKey:key}),identity:['test',fen],messages:[{role:'system',content:'棋局教学要求'},{role:'user',content:JSON.stringify(context)}],task:{expectedMove:'g0i2',evidenceIds:walkthrough.evidence.map(e=>e.id),allowedMoves:walkthroughMoves(walkthrough),walkthrough},context};
}
const response = data => ({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});
function repairAnswer(context, full) {
  return {patches:context.requiredRepairs.map(t=>{
    const step=full.steps.find(s=>s.id===t.stepId);
    const value=t.field==='steps'?step:t.id?step[t.field].find(b=>b.id===t.id).explanation:(step||full)[t.field];
    return {...t,value};
  })};
}

test('explicit retry fills all omitted replies while preserving existing prose and original tool evidence',async()=>{
  const args=setup('repair-keeps-draft'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps[0].responses=[];draft.steps[1].responses=[];
  let calls=0, repairContext;
  const fetchImpl=async(url,options)=>{
    calls++;const context=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.ok(!JSON.stringify(context).includes(args.config.apiKey));
    if(calls===1){assert.equal(context.requiredCoverage.length,2);return response(draft);}
    repairContext=context;return response(repairAnswer(context,full));
  };
  let firstError;
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl}),error=>{firstError=error;return error.validationIssue.kind==='coverage';});
  assert.equal(calls,1);
  const error=coachAnswerFailure(firstError,firstError.coachPayload,'MODEL_IMPORT_RESPONSE_INVALID');
  assert.match(error.message,/再次点击仅补写/);
  const changed=structuredClone(args.task);changed.walkthrough.steps[0].comparison={source:'fresh-different-analysis'};
  const result=await requestDetailedCoach({...args,task:changed,fetchImpl});
  assert.equal(calls,2);assert.equal(result.repaired,true);
  assert.equal(repairContext.requiredRepairs.length,full.steps.reduce((n,s)=>n+s.responses.length,0));
  for(let i=0;i<2;i++){
    assert.equal(result.content.walkthrough.steps[i].reason,full.steps[i].reason);
    assert.deepEqual(result.content.walkthrough.steps[i].responses.map(r=>r.explanation),full.steps[i].responses.map(r=>r.explanation));
  }
  assert.equal(result.content.walkthrough.steps[0].comparison,undefined);
  assert.equal(result.content.walkthrough.teachingSource,'model');
  // A successful result consumes the pending draft; a later request is fresh.
  await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).repair,undefined);return response(full);
  }});
});

test('malformed repair IDs do not overwrite the saved draft and the next retry can succeed',async()=>{
  const args=setup('repair-exact-ids'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps[1].responses=[];
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(draft)}));
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content),patches=repairAnswer(context,full);
    patches.patches[0].id='S99R99';return response(patches);
  }}),e=>e.validationIssue.kind==='identity');
  const fixed=await requestDetailedCoach({...args,fetchImpl:async(url,options)=>response(repairAnswer(JSON.parse(JSON.parse(options.body).messages[1].content),full))});
  assert.equal(fixed.content.walkthrough.steps[1].reason,full.steps[1].reason);
});

test('one inspection finds problems across all fields and one repair fixes them without rewriting good branches',async()=>{
  const args=setup('repair-all-problems-at-once'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps[0].reason='';
  draft.steps[0].alternatives[0].explanation='';
  draft.steps[1].responses=[];
  draft.summary='';
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(draft)}),e=>{
    assert.ok(e.validationIssues.some(i=>i.stepId==='S1'&&i.field==='reason'));
    assert.ok(e.validationIssues.some(i=>i.branchId===full.steps[0].alternatives[0].id));
    assert.ok(e.validationIssues.some(i=>i.stepId==='S2'&&i.field==='responses'));
    assert.ok(e.validationIssues.some(i=>i.field==='summary'));return true;
  });
  let context;
  const result=await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    context=JSON.parse(JSON.parse(options.body).messages[1].content);
    return response(repairAnswer(context,full));
  }});
  const targets=context.requiredRepairs;
  assert.equal(targets.length,3+full.steps[1].responses.length,JSON.stringify(targets));
  assert.equal(targets.filter(t=>t.field==='alternatives').length,1);
  assert.ok(context.repairIssues.length>=4);
  assert.equal(result.content.walkthrough.steps[0].reason,full.steps[0].reason);
  assert.deepEqual(result.content.walkthrough.steps[0].responses.map(r=>r.explanation),full.steps[0].responses.map(r=>r.explanation));
});

test('repair completion displays coordinate inconsistencies as warnings without another repair call',async()=>{
  const args=setup('repair-validates-content'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps[1].responses=[];
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(draft)}));
  const result=await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    const patches=repairAnswer(JSON.parse(JSON.parse(options.body).messages[1].content),full);
    patches.patches[0].value+=' 虚构 i0i9。';return response(patches);
  }});
  assert.ok(result.content.validationWarnings.some(e=>e.kind==='coordinate'&&e.stepId==='S2'));
  assert.ok(result.content.walkthrough.steps[1].responses.some(r=>r.explanation.includes('i0i9')));
});

test('draft repair is isolated by page key, model, task identity and expires after ten minutes',async()=>{
  const args=setup('repair-scope'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps[1].responses=[];
  const started=Date.now();
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(draft)}));
  for(const change of [{config:resolveModelConfig({apiKey:'different-page-key'})},{config:resolveModelConfig({apiKey:'repair-scope',model:'deepseek-v4-pro'})},{identity:['another-position']}]){
    await requestDetailedCoach({...args,...change,fetchImpl:async(url,options)=>{
      assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).repair,undefined);return response(full);
    }});
  }
  const now=Date.now;Date.now=()=>started+11*60*1000;
  try{
    await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
      assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).repair,undefined);return response(full);
    }});
  }finally{Date.now=now;}
});

test('omitted whole steps can be repaired, and duplicate step IDs are never cached as partial success',async()=>{
  const args=setup('repair-whole-step'),full=detailedAnswer(args.context),draft=structuredClone(full);
  draft.steps.pop();
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(draft)}));
  const result=await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.deepEqual(context.requiredRepairs,[{stepId:'S2',field:'steps'}]);return response(repairAnswer(context,full));
  }});
  assert.equal(result.content.walkthrough.steps.length,2);
  const duplicate=structuredClone(full);duplicate.steps[1]=duplicate.steps[0];
  await assert.rejects(()=>requestDetailedCoach({...args,fetchImpl:async()=>response(duplicate)}),e=>e.validationIssue.kind==='identity');
  await requestDetailedCoach({...args,fetchImpl:async(url,options)=>{
    assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).repair,undefined);return response(full);
  }});
});

test('training, import and sandbox HTTP retries repair missing replies with exactly one call per request',async t=>{
  let calls=0,full;
  const server=createApp({engineReady:()=>false,fetchImpl:async(url,options)=>{
    calls++;const context=JSON.parse(JSON.parse(options.body).messages[1].content);
    if(context.repair)return response(repairAnswer(context,full));
    full=detailedAnswer(context);const draft=structuredClone(full);
    const step=draft.steps.find(s=>s.responses.length);assert.ok(step);step.responses=[];
    return response(draft);
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base='http://127.0.0.1:'+server.address().port,baseFen=trainingWalkthrough('ending-ladder-two').steps[0].beforeFen;
  for(const [path,body]of [['/api/coach',{id:'ending-ladder-two'}],['/api/import/explain',{fen:baseFen,maxMoves:2}],['/api/study/analyze',{baseFen,moves:[]}]]){
    const key='http-repair-'+path.split('/')[2],post=()=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,modelSettings:{apiKey:key}})});
    const before=calls,first=await post(),failed=await first.json();
    assert.equal(calls,before+1);assert.equal(failed.validationIssue.kind,'coverage');
    assert.match(failed.error||failed.message,/再次点击仅补写/);
    const second=await post(),fixed=await second.json();
    assert.equal(calls,before+2);assert.equal(second.status,200);assert.equal(fixed.source,'model');
    assert.equal(fixed.walkthrough.teachingSource,'model');
    assert.ok(!JSON.stringify(fixed).includes(key));
  }
});
