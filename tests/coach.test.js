import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, validateCoachResponse, generateCoach } from '../src/coach.js';

const valid={move:'a1a7',observation:'红车与黑车同列。',reason:'路径为空，可以直接吃子。',practice:'先看阻挡，再看目标。',evidenceIds:['E1','E2']};
test('customized prompt includes curated knowledge while baseline uses same evidence',()=>{
  const base=JSON.parse(buildMessages('rook-line',null,'baseline')[1].content),custom=JSON.parse(buildMessages('rook-line',null,'customized')[1].content);
  assert.deepEqual(base.evidence,custom.evidence);assert.deepEqual(base.engine,custom.engine);assert.ok(!base.knowledge);assert.ok(custom.knowledge.length);
});
test('structured output validates move and citation identifiers',()=>{
  assert.deepEqual(validateCoachResponse(JSON.stringify(valid),'a1a7',['E1','E2']),valid);
  assert.throws(()=>validateCoachResponse(JSON.stringify({...valid,move:'a1a2'}),'a1a7',['E1','E2']));
  assert.throws(()=>validateCoachResponse(JSON.stringify({...valid,evidenceIds:['E999']}),'a1a7',['E1','E2']));
});
test('unprovided coordinate moves are rejected and code fences are handled',()=>{
  assert.throws(()=>validateCoachResponse(JSON.stringify({...valid,reason:'再走 b2b7。'}),'a1a7',['E1','E2']));
  assert.equal(validateCoachResponse('```json\n'+JSON.stringify(valid)+'\n```','a1a7',['E1','E2']).move,'a1a7');
});
test('mocked network exercises integration without making real or billable calls',async()=>{
    const settings={source:'session',apiKey:'test-only-not-a-real-key',model:'deepseek-flash'};
    let sent;
    const mock=async(url,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(valid)}}],usage:{total_tokens:10}})};};
    const result=await generateCoach('rook-line',null,'customized',null,mock,settings);
    assert.equal(result.source,'model');assert.equal(result.model,'deepseek-flash');assert.equal(sent.model,'deepseek-flash');assert.ok(!JSON.stringify(sent).includes('test-only-not-a-real-key'));
    assert.deepEqual(sent.thinking,{type:'disabled'});assert.deepEqual(sent.response_format,{type:'json_object'});assert.equal(sent.max_tokens,1024);
    const invalidFetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'bad'}}]})});
    const invalid=await generateCoach('rook-line',null,'customized',null,invalidFetch,settings);
    assert.equal(invalid.source,'lesson-fallback');assert.equal(invalid.validation,'rejected');
    const truncatedFetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(valid)}}]})});
    const truncated=await generateCoach('rook-line',null,'customized',null,truncatedFetch,settings);
    assert.equal(truncated.source,'lesson-fallback');assert.equal(truncated.validation,'truncated');assert.equal(truncated.finishReason,'length');
});

test('provided legal engine contrast is allowed but cannot replace the exercise answer',async()=>{
  const settings={source:'session',apiKey:'test-only-not-a-real-key',model:'deepseek-flash'};
  const sample={move:'c5d5',observation:'红炮借兵为炮架。',reason:'c5d5 形成绝杀；引擎给出的 d7c7 是困毙，目标不同。',practice:'将军且无合法应对才是绝杀。',evidenceIds:['E1','E3','E4']};
  const mock=data=>async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});
    const engine={bestMove:'d7c7',pv:['d7c7']};
    assert.equal((await generateCoach('cannon-mate',null,'customized',engine,mock(sample),settings)).source,'model');
    assert.equal((await generateCoach('cannon-mate',null,'customized',null,mock(sample),settings)).source,'lesson-fallback');
    assert.equal((await generateCoach('cannon-mate',null,'customized',engine,mock({...sample,move:'d7c7'}),settings)).source,'lesson-fallback');
    assert.equal((await generateCoach('cannon-mate',null,'customized',{bestMove:'a1a7',pv:['a1a7']},mock({...sample,reason:'可以比较 a1a7。'}),settings)).source,'lesson-fallback');
});
