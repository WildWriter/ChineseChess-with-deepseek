import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { engineAvailable } from '../src/engine.js';

// Unit tests never inherit real model credentials or make billable requests.
delete process.env.LLM_API_KEY;
delete process.env.LLM_MODEL;
delete process.env.APP_ACCESS_TOKEN;

async function withServer(run,options={}) {const server=createApp(options);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;try{await run(base);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
const post=(base,path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
test('health, assets, curriculum, and legal attempt work over HTTP',()=>withServer(async base=>{
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/app.js')).status,200);assert.equal((await fetch(base+'/api/health')).status,200);
  const curriculum=await(await fetch(base+'/api/puzzles')).json();assert.equal(curriculum.puzzles.length,20);assert.equal(curriculum.puzzles[0].canonical,undefined);
  const response=await post(base,'/api/attempt',{id:'rook-line',move:'a1a7'});assert.equal(response.status,200);assert.equal((await response.json()).correct,true);
}));
test('invalid data, paths, methods and cross-origin requests fail safely',()=>withServer(async base=>{
  assert.equal((await post(base,'/api/attempt',{id:'not-found',move:'a1a7'})).status,404);
  assert.equal((await post(base,'/api/attempt',{id:'rook-line',move:'bad'})).status,400);
  assert.equal((await post(base,'/api/hint',{id:'rook-line',level:1},{Origin:'https://example.com'})).status,403);
  assert.equal((await fetch(base+'/.env')).status,403);assert.equal((await fetch(base+'/server.js')).status,404);
  assert.equal((await fetch(base+'/api/quit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"id":"rook-line"}'})).status,404);
  assert.equal((await fetch(base+'/',{method:'DELETE'})).status,405);
  assert.equal((await post(base,'/api/attempt',{id:'rook-line',huge:'x'.repeat(20000)})).status,413);
}));
test('configured access token is required and never echoed',async()=>{
  const old=process.env.APP_ACCESS_TOKEN;process.env.APP_ACCESS_TOKEN='test-access';
  try{await withServer(async base=>{
    assert.equal((await post(base,'/api/hint',{id:'rook-line',level:1})).status,401);
    assert.equal((await post(base,'/api/hint',{id:'rook-line',level:1},{Authorization:'Bearer test-access'})).status,200);
    const health=await(await fetch(base+'/api/health')).text();assert.ok(!health.includes('test-access'));
  });}finally{if(old===undefined)delete process.env.APP_ACCESS_TOKEN;else process.env.APP_ACCESS_TOKEN=old;}
});
test('missing page key returns an explicit required-key response, not a fake answer',()=>withServer(async base=>{
  const result=await post(base,'/api/coach',{id:'rook-line'});assert.equal(result.status,400);assert.match((await result.json()).error,/页面输入 API Key/);
}));

test('legacy env credentials cannot authorize any model route or appear in health',async()=>{
  const saved={key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL};
  process.env.LLM_API_KEY='legacy-key-not-for-use';process.env.LLM_MODEL='legacy-model-not-for-use';
  try{await withServer(async base=>{
    for(const route of ['/api/model/test','/api/coach','/api/compare']){
      for(const modelSettings of [undefined,{source:'server'},{source:'session',apiKey:''}]){
        const response=await post(base,route,{id:'rook-line',modelSettings});assert.equal(response.status,400);
        const data=await response.json();assert.match(data.code,/MODEL_(KEY_REQUIRED|SOURCE_INVALID)/);
      }
    }
    const text=await(await fetch(base+'/api/health')).text();assert.ok(!text.includes('legacy-'));
    assert.equal(JSON.parse(text).modelCredentialMode,'session');
  },{fetchImpl:async()=>{assert.fail('No model call without a page key');}});
  }finally{for(const[name,value]of [['LLM_API_KEY',saved.key],['LLM_MODEL',saved.model]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});

test('page API settings work without server credentials and never leak into responses',()=>withServer(async base=>{
  const modelSettings={source:'session',apiKey:'private-test-key',model:'deepseek-v4-pro'};
  const response=await post(base,'/api/model/test',{modelSettings});assert.equal(response.status,200);
  const text=await response.text();assert.ok(text.includes('连接成功'));assert.ok(text.includes('deepseek-v4-pro'));assert.ok(!text.includes('private-test-key'));
  const result=await post(base,'/api/coach',{id:'rook-line',modelSettings});assert.equal(result.status,200);const data=await result.json();assert.equal(data.source,'model');assert.equal(data.model,'deepseek-v4-pro');
  const health=await(await fetch(base+'/api/health')).text();assert.ok(!health.includes('private-test-key'));assert.equal(JSON.parse(health).defaultModel,'deepseek-flash');assert.equal(process.env.LLM_API_KEY,undefined);
},{engineAnalyze:async()=>null,fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body),probe=request.max_tokens===64;
  return{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(probe?{ok:true}:{move:'a1a7',observation:'红车同列。',reason:'路径畅通。',practice:'检查阻挡。',evidenceIds:['E1']})}}]})};
}}));
test('probe failures have explicit safe status and reject cross-origin input',()=>withServer(async base=>{
  const request={modelSettings:{source:'session',apiKey:'bad-private-key',model:'deepseek-flash'}};
  const result=await post(base,'/api/model/test',request);assert.equal(result.status,502);
  const text=await result.text();assert.ok(text.includes('API Key 无效'));assert.ok(text.includes('MODEL_HTTP_401'));assert.ok(!text.includes('bad-private-key'));
  assert.equal((await post(base,'/api/model/test',request,{Origin:'https://example.com'})).status,403);
  assert.equal((await post(base,'/api/model/test',{modelSettings:{source:'session',apiKey:'',model:'deepseek-flash'}})).status,400);
},{fetchImpl:async()=>({ok:false,status:401})}));

test('HTTP endgame progression, hints and model context use reconstructed current boards',async()=>{
  let engineFen;
  await withServer(async base=>{
    const first=await(await post(base,'/api/attempt',{id:'ending-ladder-two',move:'a6a8'})).json();
    assert.equal(first.correct,true);assert.equal(first.complete,false);assert.equal(first.opponentMove,'e8e9');
    const data={id:'ending-ladder-two',history:first.history};
    const hint=await(await post(base,'/api/hint',{...data,level:3})).json();assert.equal(hint.move,'b7b9');
    const lesson=await(await post(base,'/api/lesson',data)).json();assert.equal(lesson.fen,first.nextFen);
    const coach=await(await post(base,'/api/coach',{...data,modelSettings:{source:'session',apiKey:'test-only',model:'deepseek-flash'}})).json();assert.equal(coach.source,'model');assert.equal(coach.move,hint.move);
    if(engineAvailable())assert.equal(engineFen,first.nextFen);
    const complete=await(await post(base,'/api/attempt',{...data,move:hint.move})).json();assert.equal(complete.complete,true);
    assert.equal((await post(base,'/api/attempt',{...data,move:hint.move,history:['a6b8']})).status,400);
    assert.equal((await post(base,'/api/lesson',{...data,history:null})).status,400);
  },{engineAnalyze:async fen=>{engineFen=fen;return null;},fetchImpl:async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content);
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({move:context.candidateMove,observation:'当前局面已更新。',reason:'这一着形成绝杀。',practice:'比较上一轮应将。',evidenceIds:['E1','E4']})}}]})};
  }});
});

test('engine failure degrades coach and both comparison arms to identical rule-only evidence',async()=>{
  const contexts=[];let engineCalls=0;
  await withServer(async base=>{
    const request={id:'rook-line',modelSettings:{source:'session',apiKey:'test-only-not-real',model:'deepseek-flash'}};
    const response=await post(base,'/api/coach',request);assert.equal(response.status,200);
    const coach=await response.json();assert.equal(coach.source,'model');assert.match(coach.engineWarning,/仅使用规则证据/);assert.ok(!JSON.stringify(coach).includes('private-engine-error'));
    const comparison=await(await post(base,'/api/compare',request)).json();
    assert.equal(comparison.engine,null);assert.equal(comparison.baseline.source,'model');assert.equal(comparison.customized.source,'model');
    assert.equal(comparison.baseline.engineWarning,comparison.customized.engineWarning);
    assert.equal(engineCalls,2);assert.equal(contexts.length,3);for(const context of contexts)assert.equal(context.engine,null);
    assert.deepEqual(contexts[1].evidence,contexts[2].evidence);
  },{engineReady:()=>true,engineAnalyze:async()=>{engineCalls++;throw new Error('private-engine-error');},fetchImpl:async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content);contexts.push(context);
    return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({move:context.candidateMove,observation:'仅按规则分析。',reason:'直线路径没有阻挡。',practice:'检查车的路线。',evidenceIds:['E1']})}}]})};
  }});
});
test('missing engine still allows coaching while an actual provider failure stays a failure',()=>withServer(async base=>{
  const response=await post(base,'/api/coach',{id:'rook-line',modelSettings:{source:'session',apiKey:'test-key',model:'deepseek-flash'}});
  assert.equal(response.status,502);assert.equal((await response.json()).code,'MODEL_HTTP_401');
},{engineReady:()=>false,engineAnalyze:async()=>assert.fail('Missing engine must not run'),fetchImpl:async()=>({ok:false,status:401})}));
test('bad endgame history is not swallowed by engine degradation or sent to the model',()=>withServer(async base=>{
  const response=await post(base,'/api/coach',{id:'ending-ladder-two',history:['a6b8'],modelSettings:{source:'session',apiKey:'test-key',model:'deepseek-flash'}});
  assert.equal(response.status,400);
},{engineReady:()=>true,engineAnalyze:async()=>assert.fail('Invalid history must not invoke engine'),fetchImpl:async()=>assert.fail('Invalid history must not invoke model')}));
