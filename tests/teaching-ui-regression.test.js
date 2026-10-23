import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {JSDOM} from 'jsdom';
import {createApp} from '../server.js';
import {detailedAnswer} from './model-fixture.js';

let pageNumber=0;
async function page(t, provider) {
  const server=createApp({engineReady:()=>false,fetchImpl:provider});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:base});
  const keys=['window','document','Option','location','localStorage','history','fetch','setTimeout','BroadcastChannel'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),timers=new Set();
  for(const key of keys.slice(0,6))globalThis[key]=dom.window[key];
  globalThis.BroadcastChannel=undefined;
  globalThis.fetch=(url,options)=>saved.fetch(new URL(url,base),options);
  globalThis.setTimeout=(callback,delay,...args)=>{const timer=saved.setTimeout(callback,delay,...args);timers.add(timer);return timer;};
  t.after(async()=>{
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    for(const timer of timers)clearTimeout(timer);dom.window.close();
    for(const key of keys)globalThis[key]=saved[key];
  });
  const $=id=>dom.window.document.getElementById(id);
  async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>saved.setTimeout(resolve,20));}assert.fail('Page operation timed out');}
  await import(`../public/app.js?teaching-regression=${++pageNumber}`);
  await until(()=>Boolean($('position-example').onclick));
  return {dom,$,until,apply(){ $('api-key-input').value=`mock-ui-only-${pageNumber}`;$('apply-api-button').onclick(); },
    select(id){$('puzzle-select').value=id;$('puzzle-select').onchange({target:$('puzzle-select')});},
    move(from,to){for(const square of [from,to])$('chessboard').querySelector(`[data-square="${square}"]`).dispatchEvent(new dom.window.MouseEvent('click'));}};
}
const response=answer=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})});

test('training and comparison show advisory success consistently and retain the warning details',async t=>{
  let mode='warning';
  const {$,apply}=await page(t,async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content),answer=detailedAnswer(context);
    if(mode!=='clean')answer.steps[0].observation+=' 模拟模型引用未经工具提供的 i0i9。';
    if(mode==='partial'&&!context.knowledge)answer.steps.pop();
    return response(answer);
  });
  apply();await $('ai-button').onclick();
  for(const id of ['model-status','model-call-status','api-test-status'])assert.equal($(id).dataset.state,'warning');
  assert.match($('model-status').textContent,/调用成功（有提醒）/);
  assert.equal($('model-status').className,'warning');
  assert.equal($('report-panel').hidden,false);assert.match($('report-content').textContent,/i0i9/);
  await $('compare-button').onclick();
  assert.equal($('eval-status').dataset.state,'warning');assert.match($('eval-status').textContent,/共 2 项一致性提醒/);
  for(const id of ['baseline-result','customized-result']){
    assert.match($(id).textContent,/一致性提醒（1 项/);assert.match($(id).textContent,/i0i9/);
    assert.ok(!$(id).textContent.includes('结构与坐标已检查；语义待人工评阅。'));
  }
  assert.equal($('model-status').dataset.state,'warning');assert.equal($('export-eval-button').disabled,false);
  mode='clean';await $('compare-button').onclick();
  assert.equal($('eval-status').dataset.state,'success');assert.equal($('model-status').className,'ready');
  assert.ok(!$('baseline-result').textContent.includes('i0i9'));
  mode='partial';await $('compare-button').onclick();
  assert.equal($('eval-status').dataset.state,'error');assert.equal($('model-status').dataset.state,'error');
  assert.match($('eval-status').textContent,/部分调用失败.*共 1 项一致性提醒/);
  assert.match($('customized-result').textContent,/一致性提醒（1 项/);
});

test('a structurally failed AI request reveals no answer and does not remove independent completion',async t=>{
  const {$,apply,move,until}=await page(t,async(url,options)=>{
    const answer=detailedAnswer(JSON.parse(JSON.parse(options.body).messages[1].content));answer.steps.pop();return response(answer);
  });
  assert.equal($('lesson-button').textContent,'查看本地解法');
  assert.match($('ai-caption').textContent,/本地提示、解法回放与训练无需 Key/);
  const board=$('chessboard').innerHTML;apply();await $('ai-button').onclick();
  assert.equal($('report-panel').hidden,true);assert.equal($('report-content').textContent,'');assert.equal($('evidence-list').textContent,'');
  assert.equal($('chessboard').innerHTML,board);assert.match($('ai-caption').textContent,/未自动展示答案/);
  assert.equal($('model-status').dataset.state,'error');
  move('a1','a7');await until(()=>$('feedback').textContent.includes('本次为'));
  assert.match($('feedback').textContent,/本次为独立完成/);assert.match($('complete-count').textContent,/1 \/ 20/);
});

test('local replay never changes the exercise board and previously viewed answers remain assisted after an AI failure',async t=>{
  const {$,dom,apply,select,move,until}=await page(t,async()=>{throw new Error('Simulated network failure');});
  select('ending-pawn-two');
  await $('lesson-button').onclick();assert.equal($('report-title').textContent,'本地解法回放');
  const board=$('chessboard').innerHTML;
  const replay=$('report-content').querySelector('.study-board'), before=replay.innerHTML;
  const nav=$('report-content').querySelector('select');nav.value='1';nav.dispatchEvent(new dom.window.Event('change'));
  assert.notEqual(replay.innerHTML,before);assert.equal($('chessboard').innerHTML,board);
  select('rook-line');await $('lesson-button').onclick();apply();await $('ai-button').onclick();
  assert.equal($('report-panel').hidden,true);assert.equal($('report-content').textContent,'');
  assert.match($('ai-caption').textContent,/本地提示、解法回放与训练仍可使用/);assert.ok(!$('ai-caption').textContent.includes('教案'));
  move('a1','a7');await until(()=>$('feedback').textContent.includes('本次为'));
  assert.match($('feedback').textContent,/本次为提示后完成/);assert.match($('complete-count').textContent,/0 \/ 20/);
});

test('sandbox calls synchronize pending, failure, advisory success and success in training and imports',async t=>{
  let mode='failure',release;
  const {$,apply,until}=await page(t,async(url,options)=>{
    const context=JSON.parse(JSON.parse(options.body).messages[1].content);
    await new Promise(resolve=>{release=resolve;});
    if(mode==='failure')throw new Error('Simulated provider outage');
    const answer=detailedAnswer(context);
    if(mode==='warning')answer.steps[0].observation+=' 模拟模型另外提及 i0i9。';
    return response(answer);
  });
  const checkGlobal=kind=>{for(const id of ['model-status','model-call-status','api-test-status'])assert.equal($(id).dataset.state,kind,id);};
  const click=(root,label)=>{const node=[...root.querySelectorAll('button')].find(node=>node.textContent===label);assert.ok(node,label);node.click();};
  apply();await $('lesson-button').onclick();
  const root=$('report-content').querySelector('.walkthrough');click(root,'从此处开始摆谱');
  for(const [testMode,expected] of [['failure','error'],['warning','warning'],['clean','success']]){
    mode=testMode;release=null;click(root,'AI 分析当前局面');await until(()=>Boolean(release));
    checkGlobal('pending');assert.match($('model-status').textContent,/调用中/);
    release();await until(()=>root.querySelector('.study-status').dataset.state===expected);
    checkGlobal(expected);assert.match($('model-call-status').textContent,/摆谱分析/);
  }
  document.querySelector('[data-view="import"]').onclick();$('position-example').onclick();
  $('position-confirm').checked=true;$('position-confirm').onchange();await $('position-solve').onclick();$('position-study').click();
  const imported=$('position-walkthrough');mode='failure';release=null;click(imported,'AI 分析当前局面');
  await until(()=>Boolean(release));checkGlobal('pending');release();
  await until(()=>imported.querySelector('.study-status').dataset.state==='error');checkGlobal('error');
  assert.match($('position-fen').value,/ w /);
});

test('changing or resetting exercises and advancing a partial solution clears old AI captions',async t=>{
  let fails=false;
  const {$,apply,select,move,until}=await page(t,async(url,options)=>{
    if(fails)throw new Error('Simulated network outage');
    return response(detailedAnswer(JSON.parse(JSON.parse(options.body).messages[1].content)));
  });
  apply();await $('ai-button').onclick();assert.match($('ai-caption').textContent,/讲解已显示/);
  select('ending-pawn-two');assert.match($('ai-caption').textContent,/当前局面尚未生成/);
  assert.equal($('report-panel').hidden,true);assert.equal($('report-content').textContent,'');assert.equal($('evidence-list').textContent,'');
  await $('ai-button').onclick();move('e7','e8');await until(()=>$('endgame-progress').textContent.includes('1 / 2'));
  assert.match($('ai-caption').textContent,/当前局面尚未生成/);assert.equal($('report-content').textContent,'');
  fails=true;await $('ai-button').onclick();assert.match($('ai-caption').textContent,/失败/);
  $('reset-button').onclick();assert.match($('ai-caption').textContent,/当前局面尚未生成/);
  $('clear-api-button').onclick();select('rook-line');assert.match($('ai-caption').textContent,/本地提示、解法回放与训练无需 Key/);
});

test('replay verification follows the actual displayed FEN while original citations stay separately labelled',async t=>{
  const {$,dom,select}=await page(t,async()=>assert.fail('Local playback must not call a model'));
  select('ending-pawn-two');await $('lesson-button').onclick();
  const board=$('chessboard').innerHTML,root=$('report-content').querySelector('.walkthrough'),nav=root.querySelector('select');
  nav.value='2';nav.dispatchEvent(new dom.window.Event('change'));
  assert.match($('evidence-list').textContent,/第 3 \/ 3 步.*走后/);
  assert.match($('evidence-list').textContent,/黑方有 0 个合法走法/);assert.match($('evidence-list').textContent,/红胜：绝杀/);
  assert.ok(!$('evidence-list').textContent.includes('本题尚未完成'));
  const original=$('report-content').querySelector('.original-evidence');assert.equal(original.open,false);
  assert.match(original.querySelector('summary').textContent,/原始核验资料.*不随回放切换/);assert.match(original.textContent,/E3.*1 个合法应对/);
  root.querySelector('.position-line button').click();assert.match($('evidence-list').textContent,/第 1 \/ 3 步.*走后/);
  assert.match($('evidence-list').textContent,/黑方有 1 个合法走法/);assert.ok(!$('evidence-list').textContent.includes('红胜'));
  [...root.querySelectorAll('button')].find(node=>node.textContent==='看走前').click();
  assert.match($('evidence-list').textContent,/第 1 \/ 3 步.*走前/);assert.match($('evidence-list').textContent,/当前行棋方红方/);
  assert.equal($('chessboard').innerHTML,board);assert.match($('complete-count').textContent,/0 \/ 20/);
});
