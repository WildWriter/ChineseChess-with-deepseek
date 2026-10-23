import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createApp } from '../server.js';
import { createModelRequestGate } from '../src/model-request.js';

const settings = {apiKey:'lifecycle-mock-only', model:'deepseek-flash'};
const payload = () => ({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'OK'}}]})});
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const post = (base, path, data, signal) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,modelSettings:settings}),signal});
const diagnostics = async base => (await fetch(base+'/api/coach/diagnostics')).json();
async function until(check) { for(let n=0;n<200;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Request lifecycle did not settle'); }
async function start(t, options) {
  const server=createApp(options); server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('refresh aborts the upstream request, frees the slot and permits a manual retry', async t => {
  const entered=deferred(); let calls=0, upstreamSignal;
  const base=await start(t,{engineReady:()=>false,fetchImpl:async(url,options)=>{
    if(++calls!==1)return payload(); upstreamSignal=options.signal; entered.resolve();
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  const controller=new AbortController();
  const old=post(base,'/api/model/test',{},controller.signal).then(()=>assert.fail('Disconnected request must not succeed'),error=>error);
  await entered.promise; assert.equal((await diagnostics(base)).busy,true);
  const parallel=await post(base,'/api/model/test',{}); assert.equal(parallel.status,429); assert.equal((await parallel.json()).code,'MODEL_BUSY');
  controller.abort(); await old;
  await until(async()=>upstreamSignal.aborted && !(await diagnostics(base)).busy);
  const retry=await post(base,'/api/model/test',{}); assert.equal(retry.status,200);
  assert.equal(calls,2); assert.equal((await diagnostics(base)).busy,false);
});

test('disconnecting during engine preparation prevents a later paid call and cannot unlock a newer request', async t => {
  const engineEntered=deferred(),engineResult=deferred(),newEntered=deferred(),newResult=deferred(); let calls=0;
  const base=await start(t,{engineReady:()=>true,engineAnalyze:async()=>{engineEntered.resolve();return engineResult.promise;},fetchImpl:async()=>{calls++;newEntered.resolve();return newResult.promise;}});
  const controller=new AbortController(),old=post(base,'/api/coach',{id:'rook-line'},controller.signal).catch(error=>error);
  await engineEntered.promise; controller.abort(); await old; await until(async()=>!(await diagnostics(base)).busy);
  const next=post(base,'/api/model/test',{}); await newEntered.promise;
  engineResult.resolve(null); await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(calls,1); assert.equal((await diagnostics(base)).busy,true);
  assert.equal((await post(base,'/api/model/test',{})).status,429);
  newResult.resolve(payload()); assert.equal((await next).status,200); assert.equal((await diagnostics(base)).busy,false);
});

test('operation deadline releases even stalled work and does not leave response listeners behind', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const gate=createModelRequestGate(async()=>assert.fail('No upstream call expected'));
  const req=new EventEmitter(),res=new EventEmitter(),work=deferred();
  const run=gate.run(req,res,'/api/model/test',()=>work.promise);
  const rejected=assert.rejects(run,error=>error.code==='MODEL_REQUEST_TIMEOUT');
  assert.equal(gate.busy(),true); t.mock.timers.tick(15000); await rejected;
  assert.equal(gate.busy(),false); assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('close'),0);
  assert.equal(await gate.run(req,res,'/api/model/test',async()=>42),42);
  work.resolve('too late'); assert.equal(gate.busy(),false);
});

test('a page that already disconnected cannot start work or leave an unhandled cancellation', async () => {
  const gate=createModelRequestGate(async()=>assert.fail('No upstream call expected'));
  const req=new EventEmitter(),res=new EventEmitter(); res.destroyed=true;
  await assert.rejects(gate.run(req,res,'/api/model/test',async()=>assert.fail('No work after disconnect')),error=>error.name==='AbortError');
  assert.equal(gate.busy(),false); assert.equal(res.listenerCount('close'),0);
});
