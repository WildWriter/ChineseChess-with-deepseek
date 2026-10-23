import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelConfig, buildCompletionBody, requestCompletion, testModelConnection } from '../src/model-client.js';
import { createModelSession, pageKeyAllowed } from '../public/model-session.js';

const session = (apiKey='test-only-page-key',model='deepseek-flash') => ({source:'session',apiKey,model});
const payload = {choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]};
const ok = data => ({ok:true,json:async()=>data});

test('page keys require HTTPS except for explicit loopback addresses',()=>{
  assert.equal(pageKeyAllowed({protocol:'http:',hostname:'127.0.0.1'}),true);
  assert.equal(pageKeyAllowed({protocol:'https:',hostname:'example.com'}),true);
  assert.equal(pageKeyAllowed({protocol:'http:',hostname:'192.168.1.10'}),false);
  assert.equal(pageKeyAllowed({protocol:'http:',hostname:'example.com'}),false);
});

test('page credentials are required even with legacy environment settings; default model is flash',()=>{
  const original={key:process.env.LLM_API_KEY,model:process.env.LLM_MODEL,base:process.env.LLM_BASE_URL};
  process.env.LLM_API_KEY='server-test-key';process.env.LLM_MODEL='legacy-test-model';process.env.LLM_BASE_URL='https://example.com';
  try{
    assert.throws(()=>resolveModelConfig(),e=>e.status===400&&e.code==='MODEL_KEY_REQUIRED');
    assert.throws(()=>resolveModelConfig({source:'server'}),e=>e.code==='MODEL_SOURCE_INVALID');
    assert.equal(resolveModelConfig({apiKey:'page-test-key'}).model,'deepseek-flash');
    const own=resolveModelConfig(session(' page-test-key ','deepseek-v4-pro'));
    assert.equal(own.apiKey,'page-test-key');assert.equal(own.model,'deepseek-v4-pro');assert.equal(own.base.origin,'https://api.deepseek.com');
    assert.equal(process.env.LLM_API_KEY,'server-test-key');assert.equal(process.env.LLM_MODEL,'legacy-test-model');
    assert.throws(()=>resolveModelConfig(session('')),e=>e.status===400&&e.code==='MODEL_KEY_REQUIRED');
  }finally{for(const[name,value]of [['LLM_API_KEY',original.key],['LLM_MODEL',original.model],['LLM_BASE_URL',original.base]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
test('invalid settings and credential destinations are rejected without echoing secrets',()=>{
  for(const value of [null,[],{source:'unknown'},session('line\nbreak'),session('has space'),session('x'.repeat(513)),{...session(),baseUrl:'https://example.com'},session('page-key','invalid model')])assert.throws(()=>resolveModelConfig(value));
});
test('real probe protocol uses selected model and returns no credentials',async()=>{
  let sent;
  const response=await testModelConnection(session('page-key-secret','deepseek-v4-pro'),async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return ok(payload);});
  assert.equal(sent.url,'https://api.deepseek.com/chat/completions');assert.equal(sent.options.redirect,'error');
  assert.equal(sent.options.headers.Authorization,'Bearer page-key-secret');assert.equal(sent.body.model,'deepseek-v4-pro');assert.equal(sent.body.max_tokens,64);assert.deepEqual(sent.body.thinking,{type:'disabled'});assert.deepEqual(sent.body.response_format,{type:'text'});
  assert.equal(response.ok,true);assert.equal(response.model,'deepseek-v4-pro');assert.ok(!JSON.stringify(response).includes('page-key-secret'));
});
test('provider failures are explicit and provider error bodies are never echoed',async()=>{
  const config=resolveModelConfig(session('never-echo-this-key'));
  for(const status of [400,401,402,403,404,408,429,500]){
    await assert.rejects(()=>requestCompletion(config,{},async()=>({ok:false,status,json:async()=>{throw new Error('Provider body must not be read');}})),error=>error.code===`MODEL_HTTP_${status}`&&!error.message.includes('never-echo-this-key')&&error.upstreamStatus===status);
  }
});
test('network errors, timeouts and invalid response data have safe diagnoses',async()=>{
  const config=resolveModelConfig(session());
  await assert.rejects(()=>requestCompletion(config,{},async()=>{throw Object.assign(new Error('private network detail'),{name:'TimeoutError'});}),error=>error.code==='MODEL_TIMEOUT');
  await assert.rejects(()=>requestCompletion(config,{},async()=>{throw new Error('private network detail');}),error=>error.code==='MODEL_NETWORK'&&!error.message.includes('private network detail'));
  await assert.rejects(()=>testModelConnection(session(),async()=>ok({choices:[{message:{content:''}}]})),error=>error.code==='MODEL_RESPONSE_INVALID');
  await assert.rejects(()=>testModelConnection(session(),async()=>ok({...payload,choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]})),error=>error.code==='MODEL_RESPONSE_INVALID');
});
test('parallel request credentials and selected models stay independent',async()=>{
  const seen=[];
  const fetcher=async(url,options)=>{seen.push({authorization:options.headers.Authorization,model:JSON.parse(options.body).model});return ok(payload);};
  const results=await Promise.all([testModelConnection(session('user-a-key','deepseek-flash'),fetcher),testModelConnection(session('user-b-key','deepseek-v4-pro'),fetcher)]);
  assert.deepEqual(seen,[{authorization:'Bearer user-a-key',model:'deepseek-flash'},{authorization:'Bearer user-b-key',model:'deepseek-v4-pro'}]);assert.equal(results[0].model,'deepseek-flash');assert.equal(results[1].model,'deepseek-v4-pro');
});
test('browser model session supports input, model switching and explicit clearing',()=>{
  const a=createModelSession(),b=createModelSession();
  assert.equal(a.summary().model,'deepseek-flash');assert.equal(a.canCall(),false);
  assert.throws(()=>a.apply({source:'session'}));assert.throws(()=>a.apply({source:'server'}));
  a.apply(session('browser-test-key'));assert.equal(a.canCall(),true);assert.ok(!JSON.stringify(a.summary()).includes('browser-test-key'));
  a.apply({source:'session',model:'deepseek-v4-pro'});assert.equal(a.requestSettings().apiKey,'browser-test-key');assert.equal(a.requestSettings().model,'deepseek-v4-pro');
  assert.equal(b.canCall(),false);a.clear();assert.equal(a.canCall(),false);assert.equal(a.requestSettings().apiKey,'');
});
test('fresh pages always require a new key and server mode cannot be restored',()=>{
  const a=createModelSession();a.apply(session('temporary-page-key'));
  assert.throws(()=>a.apply({source:'server',model:'deepseek-flash'}));
  assert.equal(a.canCall(),true);
  const fresh=createModelSession();
  assert.equal(fresh.summary().hasSessionKey,false);assert.equal(fresh.canCall(),false);
  assert.deepEqual(fresh.requestSettings(),{source:'session',model:'deepseek-flash',apiKey:''});
  a.clear();assert.equal(a.canCall(),false);assert.equal(a.summary().source,'session');
});
