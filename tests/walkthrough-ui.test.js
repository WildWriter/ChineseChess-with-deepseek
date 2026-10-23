import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { mountWalkthrough } from '../public/walkthrough-view.js';
import { trainingWalkthrough } from '../src/training-walkthrough.js';
import { studyPosition } from '../src/study-coach.js';
import { parseFen, pieceName } from '../public/vendor/xiangqi.js';

function mount(t, id = 'rook-line', overrides = {}) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'http://127.0.0.1/' });
  const saved = { document: globalThis.document, Option: globalThis.Option };
  globalThis.document = dom.window.document; globalThis.Option = dom.window.Option;
  const root = document.getElementById('root'), walk = trainingWalkthrough(id);
  if (!overrides.localReference) walk.teachingSource = 'model';
  if (overrides.validationWarnings) walk.validationWarnings=overrides.validationWarnings;
  const options = { canUseModel: () => false, modelSettings: () => ({ apiKey: 'mock-only' }), modelBusy: () => false, api: async () => assert.fail('No API call without a key'), ...overrides };
  const view = mountWalkthrough(root, walk, options);
  t.after(() => { view.dispose(); dom.window.close(); globalThis.document = saved.document; globalThis.Option = saved.Option; });
  const click = label => { const node = [...root.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(node, label); assert.ok(!node.disabled, label); node.click(); };
  const square = token => root.querySelector(`.study-board [data-square="${token}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const move = (from, to) => { square(from); square(to); };
  return { dom, root, walk, view, click, move };
}
function resultFor(request, text) {
  return { source: 'model', model: 'mock-only', positionFen: studyPosition(request.baseFen, request.moves).fen, observation: text, reason: '最新局面的详细原因。', analysis: { conclusion: '当前没有短将杀证明。' }, walkthrough: { steps: [], summary: '核对当前行棋方与帅将安全。' }, elapsedMs: 50 };
}

function assertBoard(root, fen) {
  const {board}=parseFen(fen);
  for(let row=0;row<10;row++)for(let col=0;col<9;col++){
    const square=`${'abcdefghi'[col]}${9-row}`, piece=board[row][col];
    assert.equal(root.querySelector(`.study-board [data-square="${square}"] text`)?.textContent || '',piece==='.'?'':pieceName(piece),square);
  }
}

test('local solution playback visibly follows every navigation without invoking AI or changing source data',t=>{
  const positions=[],{root,walk,click,view,dom}=mount(t,'ending-pawn-two',{localReference:true,onPosition:(index,phase)=>positions.push({index,phase})});
  const snapshot=JSON.stringify(walk);
  assertBoard(root,walk.steps[0].beforeFen);
  assert.equal(root.querySelector('.walkthrough-nav button').disabled,true);
  click('看走后');assertBoard(root,walk.steps[0].afterFen);
  click('下一步');assertBoard(root,walk.steps[1].beforeFen);
  assert.deepEqual(positions.at(-1),{index:1,phase:'before'});
  const select=root.querySelector('select');select.value='2';select.dispatchEvent(new dom.window.Event('change'));
  assertBoard(root,walk.steps[2].afterFen);assert.match(root.querySelector('.reference-board-panel>strong').textContent,/第 3 \/ 3 步.*走后.*绝杀/);
  assert.equal([...root.querySelectorAll('.walkthrough-nav button')].at(-1).disabled,true);
  root.querySelector('.position-line li button').click();assertBoard(root,walk.steps[0].afterFen);
  assert.equal(root.querySelector('.position-line li').getAttribute('aria-current'),'step');
  view.select(1,'before');assertBoard(root,walk.steps[1].beforeFen);
  click('从此处开始摆谱');assertBoard(root,walk.steps[1].beforeFen);
  click('返回参考线路');assertBoard(root,walk.steps[1].beforeFen);
  assert.equal(root.querySelector('.step-explanation'),null);
  assert.equal(root.querySelector('.walkthrough-summary'),null);
  view.select(-1);view.select(99);assertBoard(root,walk.steps[1].beforeFen);
  assert.equal(JSON.stringify(walk),snapshot);
  view.dispose();view.select(2,'after');assertBoard(root,walk.steps[1].beforeFen);
});

test('step navigation keeps board, step anchor, explanation and final summary aligned', t => {
  const positions = [], { root, click, view, walk } = mount(t, 'ending-ladder-two', { onPosition: (index, phase) => positions.push({ index, phase }) });
  assert.match(root.querySelector('.step-explanation .eyebrow').textContent, /1 \/ 3/);
  click('下一步'); assert.match(root.querySelector('.step-explanation .eyebrow').textContent, /2 \/ 3/);
  click('看走后'); assert.deepEqual(positions.at(-1), { index: 1, phase: 'after' });
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /走后/);
  view.select(2, 'after'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /绝杀/);
  assert.equal(root.querySelector('.walkthrough-summary p').textContent, walk.summary);
});

test('advisory warnings remain visible while model prose and safe board playback still work',t=>{
  const {root,click,walk}=mount(t,'ending-ladder-two',{validationWarnings:[{kind:'coordinate',message:'第 1 步 · 观察：引用了工具未提供的着法（d9c9）'}]});
  assert.equal(root.querySelector('.teaching-source').dataset.state,'warning');
  assert.equal(root.querySelector('.coach-validation-notes').hidden,false);
  assert.match(root.querySelector('.coach-validation-notes').textContent,/d9c9/);
  assert.equal(root.querySelector('.step-explanation p:not(.eyebrow)').textContent,walk.steps[0].observation);
  click('下一步');assert.match(root.querySelector('.step-explanation .eyebrow').textContent,/2 \/ 3/);
  click('从此处开始摆谱');assert.equal(root.querySelector('.coach-validation-notes').hidden,true);
  click('返回主线讲解');assert.equal(root.querySelector('.coach-validation-notes').hidden,false);
});

test('local references expose moves only and never insert rule teaching during sandbox entry or exit', t => {
  const {root, walk, click, dom} = mount(t, 'ending-ladder-two', {localReference:true});
  assert.equal(root.querySelectorAll('.position-line li').length, walk.steps.length);
  assert.equal(root.querySelector('.step-explanation'), null);
  assert.equal(root.querySelector('.walkthrough-summary'), null);
  assert.ok(!root.textContent.includes(walk.steps[0].reason));
  const select = root.querySelector('select'); select.value = '1'; select.dispatchEvent(new dom.window.Event('change'));
  click('从此处开始摆谱');
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /自由摆谱/);
  assert.equal(root.querySelector('.step-explanation').textContent, '');
  assert.equal(root.querySelector('.walkthrough-summary').textContent, '');
  click('返回参考线路');
  assert.equal(root.querySelector('select').value, '1');
  assert.equal(root.querySelector('.step-explanation'), null);
  assert.equal(root.querySelector('.walkthrough-summary'), null);
});

test('variations can be played, rewound and used as a sandbox starting point', t => {
  const { root, click } = mount(t, 'ending-ladder-two');
  const variation = root.querySelector('.variation-detail:not(.response-detail)'); variation.open = true;
  const controls = [...variation.querySelectorAll('button')];
  controls.find(node => node.textContent === '摆出这条变化').click();
  controls.find(node => node.textContent === '走一步').click();
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /其他正确解 · 1\//);
  controls.find(node => node.textContent === '退一步').click();
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /0\//);
  controls.find(node => node.textContent === '走一步').click(); click('从此处开始摆谱');
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /黑方行棋/);
  click('返回主线讲解'); assert.equal(root.querySelector('.study-sandbox-controls').hidden, true);
});

test('sandbox allows both sides, rejects illegal moves, undoes and resets without changing the lesson', async t => {
  const { root, walk, click, move } = mount(t), snapshot = JSON.stringify(walk);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click('从此处开始摆谱'); move('a1', 'b2');
  assert.match(root.querySelector('.study-status').textContent, /不合法/);
  move('a1', 'a2'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 1 步 · 黑方行棋/);
  move('a7', 'a6'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 2 步 · 红方行棋/);
  click('悔棋'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 1 步 · 黑方行棋/);
  click('重摆本分支'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 0 步 · 红方行棋/);
  t.mock.timers.tick(1000); await flush();
  click('AI 分析当前局面');await flush();
  assert.match(root.querySelector('.study-status').textContent, /API Key/);
  assert.equal(JSON.stringify(walk), snapshot);
});

test('analysis runs only when clicked and late results never overwrite the latest board', async t => {
  const calls = []; let finishOld;
  const { root, click, move } = mount(t, 'rook-line', { canUseModel: () => true, api: async (path, request) => {
    calls.push(request);
    if (calls.length === 1) return new Promise(resolve => { finishOld = () => resolve(resultFor(request, 'OLD_RESULT')); });
    return resultFor(request, 'LATEST_RESULT');
  } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click('从此处开始摆谱'); move('a1', 'a2'); t.mock.timers.tick(1000); await flush();assert.equal(calls.length,0);click('AI 分析当前局面'); await flush(); assert.equal(calls.length, 1);
  move('a7', 'a6'); t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, 1);
  click('AI 分析当前局面');finishOld(); await flush(); assert.ok(!root.textContent.includes('OLD_RESULT'));
  t.mock.timers.tick(1000); await flush(); assert.equal(calls.length, 2); assert.deepEqual(calls[1].moves, ['a1a2', 'a7a6']);
  assert.ok(root.textContent.includes('LATEST_RESULT')); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 2 步 · 红方行棋/);
});

test('analysis failures preserve playable state and manual retries analyze the current position', async t => {
  let count = 0;
  const { root, click, move } = mount(t, 'rook-line', { canUseModel: () => true, api: async (path, request) => { if (++count === 1) throw new Error('模拟网络失败'); return resultFor(request, 'RECOVERED_RESULT'); } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click('从此处开始摆谱'); move('a1', 'a2');click('AI 分析当前局面'); await flush();
  assert.match(root.querySelector('.study-status').textContent, /失败.*棋盘已保留/);
  assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 1 步 · 黑方行棋/);
  click('AI 分析当前局面'); await flush(); assert.ok(root.textContent.includes('RECOVERED_RESULT'));
  click('悔棋'); assert.ok(!root.textContent.includes('RECOVERED_RESULT')); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 0 步/);
});

test('a non-model sandbox response never becomes a DS explanation', async t => {
  const {root, click, move} = mount(t, 'rook-line', {canUseModel:()=>true, api:async(path,request)=>({...resultFor(request,'LOCAL_TEMPLATE'), source:'lesson-fallback'})});
  click('从此处开始摆谱'); move('a1','a2'); click('AI 分析当前局面'); await flush();
  assert.match(root.querySelector('.study-status').textContent, /DS 分析失败/);
  assert.equal(root.querySelector('.study-analysis').textContent, '');
  assert.ok(!root.textContent.includes('LOCAL_TEMPLATE'));
  move('a7','a6'); assert.match(root.querySelector('.study-board-panel>strong').textContent, /第 2 步/);
});

test('moves never send automatic requests and disposed viewers ignore pending results', async t => {
  let calls = 0, finish;
  const { root, click, move, view, dom } = mount(t, 'rook-line', { canUseModel: () => true, api: async (path, request) => { calls++; return new Promise(resolve => { finish = () => resolve(resultFor(request, 'DISPOSED_RESULT')); }); } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  click('从此处开始摆谱'); assert.equal(root.querySelector('.study-sandbox-controls input'),null);
  move('a1', 'a2'); t.mock.timers.tick(1000); await flush(); assert.equal(calls, 0);
  click('AI 分析当前局面'); await flush(); assert.equal(calls, 1); view.dispose(); finish(); await flush();
  assert.ok(!root.textContent.includes('DISPOSED_RESULT'));
});

test('study mode hides original teaching and shows the analysis below the whole board layout',async t=>{
  const {root,click,move}=mount(t,'rook-line',{canUseModel:()=>true,api:async(path,request)=>resultFor(request,'CURRENT_ONLY')});
  click('从此处开始摆谱');
  assert.ok(root.classList.contains('is-studying'));
  for(const selector of ['.walkthrough-nav','.step-explanation','.walkthrough-summary'])assert.equal(root.querySelector(selector).hidden,true);
  move('a1','a2');click('AI 分析当前局面');await flush();
  const analysis=root.querySelector('.study-analysis');
  assert.equal(analysis.parentNode,root);assert.ok(root.querySelector('.walkthrough-layout').compareDocumentPosition(analysis)&4);
  assert.ok(analysis.textContent.includes('CURRENT_ONLY'));
  click('返回主线讲解');assert.ok(!root.classList.contains('is-studying'));
  for(const selector of ['.walkthrough-nav','.step-explanation','.walkthrough-summary'])assert.equal(root.querySelector(selector).hidden,false);
  assert.equal(analysis.hidden,true);
});

test('opponent replies start after the main move and their continuation can be played',t=>{
  const {root,walk}=mount(t,'ending-ladder-two');
  const reply=walk.steps[0].responses[0],details=root.querySelector('.response-detail');
  assert.ok(details);details.querySelectorAll('button')[0].click();
  assert.match(root.querySelector('.study-board-panel>strong').textContent,/对方应对 · 0/);
  [...details.querySelectorAll('button')].find(b=>b.textContent==='走一步').click();
  assert.match(root.querySelector('.study-board-panel>strong').textContent,/对方应对 · 1/);
  assert.ok(reply.line.length);
});

test('board position notifications include main lines, branches and sandbox positions',t=>{
  const shown=[],{root,walk,click,move}=mount(t,'rook-line',{onBoardPosition:(fen,label)=>shown.push({fen,label})});
  assert.equal(shown.at(-1).fen,walk.steps[0].beforeFen);
  click('看走后');assert.equal(shown.at(-1).fen,walk.steps[0].afterFen);
  const response=root.querySelector('.response-detail');
  [...response.querySelectorAll('button')].find(node=>node.textContent==='走一步').click();
  assert.equal(shown.at(-1).fen,walk.steps[0].responses[0].line[0].afterFen);
  click('看走前');click('从此处开始摆谱');move('a1','a2');
  assert.equal(shown.at(-1).fen,studyPosition(walk.steps[0].beforeFen,['a1a2']).fen);
  click('返回主线讲解');assert.equal(shown.at(-1).fen,walk.steps[0].beforeFen);
});

test('late sandbox replies finish the global status without displaying stale analysis',async t=>{
  const updates=[];let finish;
  const {root,click,move,view}=mount(t,'rook-line',{canUseModel:()=>true,setModelStatus:(kind,message)=>updates.push({kind,message}),api:async(path,request)=>new Promise(resolve=>{finish=()=>resolve(resultFor(request,'OLD_RESULT'));})});
  click('从此处开始摆谱');click('AI 分析当前局面');assert.equal(updates.at(-1).kind,'pending');
  move('a1','a2');finish();await flush();assert.equal(updates.at(-1).kind,'success');assert.match(updates.at(-1).message,/未显示旧结果/);
  assert.ok(!root.textContent.includes('OLD_RESULT'));
  click('AI 分析当前局面');view.dispose();finish();await flush();
  assert.equal(updates.at(-1).kind,'success');assert.match(updates.at(-1).message,/已退出/);assert.ok(!root.textContent.includes('OLD_RESULT'));
});

test('terminal local verdicts do not masquerade as successful model calls',async t=>{
  const updates=[],{click,root}=mount(t,'rook-line',{canUseModel:()=>true,setModelStatus:(kind,message,label)=>updates.push({kind,message,label}),api:async(path,request)=>({source:'rules',positionFen:request.baseFen,walkthrough:{steps:[],result:{label:'红胜'}},analysis:{conclusion:'局面已经结束'}})});
  click('从此处开始摆谱');click('AI 分析当前局面');await flush();
  assert.equal(updates.at(-1).kind,'idle');assert.equal(updates.at(-1).label,'本地分析完成');assert.match(updates.at(-1).message,/未调用模型/);
  assert.equal(root.querySelector('.study-analysis').textContent,'红胜');
});
