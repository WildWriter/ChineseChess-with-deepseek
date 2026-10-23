import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLearningRecords, createLearningStore } from '../public/learning-store.js';

test('learning migration accepts legacy fields without including API keys or unknown exercises',()=>{
  const safe=sanitizeLearningRecords({a:{attempts:4,mistakes:2,completed:true,independent:true,resolved:false,lastSeen:'2026-10-22T00:00:00.000Z',apiKey:'must-not-copy',history:['a1a7']},other:{completed:true}},['a']);
  assert.deepEqual(Object.keys(safe),['a']);assert.equal(safe.a.attempts,4);assert.equal(safe.a.independent,true);
  assert.ok(!JSON.stringify(safe).includes('must-not-copy'));assert.equal(safe.a.history,undefined);
});
test('learning data sanitization bounds malformed counts and rejects invalid records',()=>{
  for(const value of [null,[],false])assert.throws(()=>sanitizeLearningRecords(value,['a']));
  const safe=sanitizeLearningRecords({a:{attempts:-1,mistakes:Infinity,completed:'true',independent:1,resolved:null,lastSeen:'invalid'}},['a']);
  assert.deepEqual(safe.a,{attempts:0,mistakes:0,completed:false,independent:false,resolved:false,lastSeen:null});
  assert.equal(sanitizeLearningRecords({a:{attempts:200000}},['a']).a.attempts,100000);
});
test('unavailable transactional storage is explicit instead of silently using unsafe tab snapshots',()=>{
  assert.throws(()=>createLearningStore({ids:['a'],factory:null}),/事务存储/);
});

// Transaction adapter test double. Real cross-tab IndexedDB serialization is
// additionally checked through the browser UI; this fake tests our callbacks,
// one-time migration, atomic per-record updates and rejected transaction paths.
function memoryFactory(){
  const stores=new Map();let tail=Promise.resolve(),created=false,failWrite=false;
  const database={
    createObjectStore(name){stores.set(name,new Map());},close(){},
    transaction(names,mode){
      let start,aborted=false;const gate=new Promise(resolve=>{start=resolve;});
      const previous=tail;tail=previous.then(()=>gate);
      const queue=[],tx={error:null,abort(){aborted=true;tx.error=new Error('aborted');}};
      const access=(name,operation,key,value)=>{
        const request={};queue.push(()=>{
          const store=stores.get(name);
          if(operation==='get')request.result=structuredClone(store.get(key));
          if(operation==='getAll')request.result=[...store.values()].map(v=>structuredClone(v));
          if(operation==='put'){if(failWrite){failWrite=false;throw new Error('test-write-failed');}store.set(key,structuredClone(value));}
          request.onsuccess?.();
        });return request;
      };
      tx.objectStore=name=>({get:key=>access(name,'get',key),getAll:()=>access(name,'getAll'),put:value=>access(name,'put',value.id??value.key,value)});
      previous.then(()=>{
        const backup=new Map([...stores].map(([name,records])=>[name,new Map(records)]));
        try{while(queue.length&&!aborted)queue.shift()();}catch(error){aborted=true;tx.error=error;}
        if(aborted){for(const[name,records]of backup)stores.set(name,records);tx.onabort?.();}else tx.oncomplete?.();
        start();
      });
      return tx;
    }
  };
  return{failNextWrite(){failWrite=true;},open(){const request={};queueMicrotask(()=>{request.result=database;if(!created){created=true;request.onupgradeneeded?.();}request.onsuccess?.();});return request;}};
}
test('aborted writes reject without claiming completion or changing persisted counters',async()=>{
  const factory=memoryFactory(),store=createLearningStore({ids:['a'],factory});await store.initialize();
  await store.attempt('a',{correct:false},false);factory.failNextWrite();
  await assert.rejects(()=>store.attempt('a',{correct:true},false),/test-write-failed/);
  const record=(await store.readAll()).a;assert.equal(record.attempts,1);assert.equal(record.completed,false);
  await store.attempt('a',{correct:true},false);assert.equal((await store.readAll()).a.attempts,2);
});
test('legacy migration happens once and never overwrites newer records on the next tab',async()=>{
  const factory=memoryFactory(),a=createLearningStore({ids:['a','b'],factory}),b=createLearningStore({ids:['a','b'],factory});
  assert.equal(await a.initialize({a:{attempts:3,completed:true,independent:true}}),true);
  await a.attempt('b',{correct:true},false);
  assert.equal(await b.initialize({a:{attempts:0},b:{completed:false}}),false);
  const records=await b.readAll();assert.equal(records.a.attempts,3);assert.equal(records.b.independent,true);
});
test('two tabs update different exercises and the same exercise without losing completion or increments',async()=>{
  const factory=memoryFactory(),a=createLearningStore({ids:['a','b'],factory}),b=createLearningStore({ids:['a','b'],factory});
  await Promise.all([a.initialize(),b.initialize()]);
  await Promise.all([a.attempt('a',{correct:true},false),b.attempt('b',{correct:true},false)]);
  let records=await a.readAll();assert.equal(records.a.independent,true);assert.equal(records.b.independent,true);
  await Promise.all([a.attempt('a',{correct:false},false),b.attempt('a',{correct:false},false)]);
  records=await b.readAll();assert.equal(records.a.attempts,3);assert.equal(records.a.mistakes,2);assert.equal(records.a.independent,true);
});
test('import replaces only explicitly imported exercises and writes remain credential-free',async()=>{
  const factory=memoryFactory(),store=createLearningStore({ids:['a','b'],factory});await store.initialize();
  await store.attempt('b',{correct:true,apiKey:'not-a-record-field'},false);
  await store.importRecords({a:{attempts:6,mistakes:1,completed:true,independent:false,apiKey:'must-not-persist'}});
  const records=await store.readAll();assert.equal(records.a.attempts,6);assert.equal(records.b.completed,true);assert.ok(!JSON.stringify(records).includes('persist'));
  await assert.rejects(()=>store.attempt('not-found',{correct:true},false),/题目不存在/);
});
