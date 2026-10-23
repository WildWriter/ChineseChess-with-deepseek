import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server.js';
import { findPuzzle } from '../src/puzzles.js';
import { validateImportedPosition, validatedLine, buildImportedReport } from '../src/imported-position.js';
import { searchImportedMate } from '../src/position-search.js';
import { createImportedAnalyzer } from '../src/import-analysis.js';
import { parseRecognizedBoard, recognizePositionImage, validateImageData } from '../src/position-vision.js';
import { explainImportedPosition } from '../src/position-coach.js';
import { START_FEN, createEmptyBoard, boardToFen, parseFen, gameStatus, generateLegalMoves, applyMove, opposite, isGeneralInCheck } from '../public/vendor/xiangqi.js';

delete process.env.APP_ACCESS_TOKEN;
const settings = { source: 'session', apiKey: 'import-test-key-not-real', model: 'deepseek-flash' };
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=';
const puzzle = findPuzzle('ending-ladder-two');
const rows = parseFen(puzzle.fen).board.map(row => row.join(''));
const payload = content => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) });
function fenOf(pieces, turn='w') { const b=createEmptyBoard();for(const [square,piece]of Object.entries(pieces))b[9-Number(square[1])]['abcdefghi'.indexOf(square[0])]=piece;return boardToFen(b,turn); }
function reverseSides(fen) { const {board,turn}=parseFen(fen);return boardToFen(board.reverse().map(row=>row.reverse().map(p=>p==='.'?'.':p===p.toUpperCase()?p.toLowerCase():p.toUpperCase())),opposite(turn)); }

test('import accepts normalized standard and composed positions with either side to move',()=>{
  assert.equal(validateImportedPosition(START_FEN).pieceCount,32);
  assert.equal(validateImportedPosition(puzzle.fen).turn,'w');
  assert.equal(validateImportedPosition(reverseSides(puzzle.fen)).turn,'b');
});
test('import rejects malformed boards, duplicate kings, wrong palace and impossible counts',()=>{
  for(const value of [null,'bad','9/9 w','9/'.repeat(300)])assert.throws(()=>validateImportedPosition(value),{status:400});
  assert.throws(()=>validateImportedPosition(fenOf({e0:'K',e9:'k',e4:'P',a0:'K'})),/只有一个/);
  assert.throws(()=>validateImportedPosition(fenOf({a0:'K',e9:'k',e4:'P'})),/九宫/);
  assert.throws(()=>validateImportedPosition(fenOf({e0:'K',e9:'k',e4:'P',a0:'R',b0:'R',c0:'R'})),/数量/);
});
test('import detects advisor, elephant and uncrossed-pawn recognition errors',()=>{
  for(const [square,piece]of [['a1','A'],['b0','B'],['b3','P'],['a0','P']])assert.throws(()=>validateImportedPosition(fenOf({e0:'K',e9:'k',e4:'P',[square]:piece})),/位置/);
  assert.throws(()=>validateImportedPosition(fenOf({e0:'K',e9:'k'})),/将军/);
});
test('vision parser rotates only when explicitly requested and always requires confirmation',()=>{
  const normal=parseRecognizedBoard(JSON.stringify({rows}),'red-bottom','w');assert.equal(normal.fen,puzzle.fen);assert.equal(normal.validation.ok,true);assert.equal(normal.requiresConfirmation,true);
  const reversed=rows.slice().reverse().map(row=>[...row].reverse().join(''));
  assert.equal(parseRecognizedBoard(JSON.stringify({rows:reversed}),'black-bottom','w').fen,puzzle.fen);
});
test('vision parser preserves invalid drafts for correction but rejects unstructured answers',()=>{
  const draft=parseRecognizedBoard(JSON.stringify({rows:Array(10).fill('.........')}),'red-bottom','w');assert.equal(draft.validation.ok,false);assert.match(draft.validation.message,/帅/);
  for(const raw of ['bad',JSON.stringify({rows:['.........']}),JSON.stringify({rows:Array(10).fill('.........<script>')})])assert.throws(()=>parseRecognizedBoard(raw,'red-bottom','w'),{status:502});
});
test('image input is bounded, signature-checked and never accepts external URLs or SVG',()=>{
  assert.equal(validateImageData(image),image);
  for(const value of ['https://example.com/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,AAAAAAAAAAAAAAAA'])assert.throws(()=>validateImageData(value),{status:400});
  assert.throws(()=>validateImageData('x'.repeat(2100001)),{status:413});
});
test('vision requires consent, a page key and an image-capable selected model before any request',async()=>{
  const run=data=>recognizePositionImage({image,orientation:'red-bottom',turn:'w',modelSettings:settings,...data},async()=>assert.fail('must not call provider'));
  await assert.rejects(()=>run({}),/确认/);
  await assert.rejects(()=>run({imageConsent:true,modelSettings:{...settings,apiKey:''}}),/API Key/);
  await assert.rejects(()=>run({imageConsent:true,modelSettings:{...settings,model:'deepseek-v4-pro'}}),/不支持图片/);
  await assert.rejects(()=>run({imageConsent:true,orientation:'guess'}),/方向/);
});
test('vision uses the fixed provider with image content and returns neither image nor credentials',async()=>{
  const result=await recognizePositionImage({image,orientation:'red-bottom',turn:'w',modelSettings:settings,imageConsent:true},async(url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.messages[1].content[1].image_url.url,image);assert.equal(body.thinking.type,'disabled');
    return payload({rows});
  });
  assert.equal(result.source,'model-vision');assert.ok(!JSON.stringify(result).includes(settings.apiKey));assert.ok(!JSON.stringify(result).includes('base64'));
});
test('vision provider and truncation failures remain explicit failures',async()=>{
  const data={image,imageConsent:true,modelSettings:settings};
  await assert.rejects(()=>recognizePositionImage(data,async()=>({ok:false,status:401})),error=>error.code==='MODEL_HTTP_401');
  await assert.rejects(()=>recognizePositionImage(data,async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length'}]})})),/截断/);
});

// Small independent AND/OR oracle verifies all defences, not just the PV.
function oracle(board,turn,attacker,plies){const moves=generateLegalMoves(board,turn);if(!moves.length)return turn!==attacker&&isGeneralInCheck(board,turn);if(!plies)return false;return turn===attacker?moves.some(move=>{const next=applyMove(board,move);return isGeneralInCheck(next,opposite(turn))&&oracle(next,opposite(turn),attacker,plies-1);}):moves.every(move=>oracle(applyMove(board,move),opposite(turn),attacker,plies-1));}
test('general imported search proves two- and three-move mates against all defences',()=>{
  for(const id of ['ending-rook-king','ending-ladder-two','ending-horse-three']){
    const p=findPuzzle(id),max=p.maxRedMoves||1,proof=searchImportedMate(p.fen,max);
    assert.equal(proof.status,'proven',id);assert.equal(proof.plies,proof.line.length);
    const position=parseFen(p.fen);assert.equal(oracle(position.board,position.turn,position.turn,proof.plies),true);
    assert.equal(validatedLine(p.fen,proof.line).at(-1).outcome.reason,'绝杀');
  }
});
test('black-to-move imports use black as attacker rather than silently solving for red',()=>{
  const fen=reverseSides(puzzle.fen),proof=searchImportedMate(fen,2);
  assert.equal(proof.status,'proven');assert.equal(proof.attacker,'b');
  const report=buildImportedReport(fen,proof);assert.match(report.conclusion,/黑方/);assert.equal(report.line[0].side,'黑');
});
test('search limits and no-short-mate are unknown, not draw or forced-win claims',()=>{
  assert.equal(searchImportedMate(START_FEN,3,{maxNodes:1}).status,'limit');
  const proof=searchImportedMate(puzzle.fen,1);assert.equal(proof.status,'not-found');
  const report=buildImportedReport(puzzle.fen,proof);assert.match(report.conclusion,/尚未证明/);assert.equal(report.recommendation,null);
});
test('worker works when the parent was launched with stdin/eval-only runtime flags',async()=>{
  const moduleUrl=new URL('../src/import-analysis.js',import.meta.url).href;
  const script=`import {runImportedSearch} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await runImportedSearch(${JSON.stringify(puzzle.fen)},2)));`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','--eval',script],{timeout:5000,windowsHide:true});
  assert.equal(JSON.parse(stdout).status,'proven');
});
test('reference PV is truncated at illegal moves and unproven engine mate is not a proof',()=>{
  const report=buildImportedReport(puzzle.fen,{status:'not-found',line:[],maxMoves:1},{bestMove:'a6a8',pv:['a6a8','e8e9','a1a9'],score:{type:'mate',value:2},depth:10});
  assert.equal(report.line.length,2);assert.deepEqual(report.engine.pv,['a6a8','e8e9']);assert.match(report.conclusion,/不是必胜证明/);
  assert.throws(()=>buildImportedReport(puzzle.fen,{status:'proven',line:['a6a8'],maxMoves:1}),/Proof line/);
});
test('terminal stalemate is distinguished from checkmate without launching search or engine',async()=>{
  // Use an actual terminal board reached legally from a known teaching puzzle.
  const p=findPuzzle('cannon-mate'),position=parseFen(p.fen);
  const {uciToMove}=await import('../public/vendor/xiangqi.js');
  const terminal=boardToFen(applyMove(position.board,uciToMove('d7c7')),'b');
  assert.equal(gameStatus(parseFen(terminal).board,'b').reason,'困毙');
  const analyze=createImportedAnalyzer({engineReady:()=>true,engineAnalyze:async()=>assert.fail('terminal'),search:async()=>assert.fail('terminal')});
  const report=await analyze(terminal);assert.equal(report.proof.status,'terminal');assert.match(report.conclusion,/困毙/);assert.equal(report.recommendation,null);
});
test('import analyzer caches authoritative results, validates before cache and handles engine failures',async()=>{
  let calls=0;
  const analyze=createImportedAnalyzer({engineReady:()=>true,engineAnalyze:async()=>{throw new Error('private-path');},search:async(fen,max)=>{calls++;return searchImportedMate(fen,max);}});
  const report=await analyze(puzzle.fen,2);assert.equal(report.proof.status,'proven');assert.match(report.engineWarning,/不可用/);assert.ok(!JSON.stringify(report).includes('private-path'));
  assert.deepEqual(await analyze(puzzle.fen,2),report);assert.equal(calls,1);
  await assert.rejects(()=>analyze('bad',2),{status:400});await assert.rejects(()=>analyze(puzzle.fen,9),{status:400});
});
test('import explanation checks supplied moves and citations and never accepts arbitrary model solutions',async()=>{
  const report=buildImportedReport(puzzle.fen,searchImportedMate(puzzle.fen,2));
  const response={move:report.recommendation,observation:'双车分工。',reason:'根据 I2 和 I3 核验的线路继续将军。',practice:'逐步核对防守。',evidenceIds:['I2','I3']};
  const answer=await explainImportedPosition(report,settings,async()=>payload(response));assert.equal(answer.source,'model');
  for(const bad of [{...response,move:'a1a7'},{...response,evidenceIds:['Z1']},{...response,reason:'走 a1a7'}])await assert.rejects(()=>explainImportedPosition(report,settings,async()=>payload(bad)),error=>error.code==='MODEL_IMPORT_RESPONSE_INVALID');
});

async function withServer(run,options={}){const server=createApp({engineReady:()=>false,...options});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;try{await run(base);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
const post=(base,route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
test('HTTP imports need no built-in puzzle id, reject invalid positions and preserve original curriculum',()=>withServer(async base=>{
  assert.equal((await post(base,'/api/import/validate',{fen:puzzle.fen})).status,200);
  assert.equal((await post(base,'/api/import/validate',{fen:'bad'})).status,400);
  const solved=await post(base,'/api/import/solve',{fen:puzzle.fen,maxMoves:2,proof:{status:'proven',line:['a1a7']}});assert.equal(solved.status,200);const report=await solved.json();assert.equal(report.proof.status,'proven');assert.notEqual(report.recommendation,'a1a7');
  assert.equal((await(await fetch(base+'/api/puzzles')).json()).puzzles.length,20);
  assert.equal((await post(base,'/api/import/solve',{fen:puzzle.fen},{Origin:'https://elsewhere.test'})).status,403);
}));
test('HTTP vision enforces consent and extended body limits only on the image route',()=>withServer(async base=>{
  const data={image,imageConsent:true,modelSettings:settings};
  const response=await post(base,'/api/import/recognize',data);assert.equal(response.status,200);assert.equal((await response.json()).requiresConfirmation,true);
  assert.equal((await post(base,'/api/import/recognize',{...data,imageConsent:false})).status,400);
  assert.equal((await post(base,'/api/import/recognize',{...data,padding:'x'.repeat(2250000)})).status,413);
  assert.equal((await post(base,'/api/import/solve',{fen:puzzle.fen,padding:'x'.repeat(20000)})).status,413);
},{fetchImpl:async()=>payload({rows})}));
test('HTTP explain computes its own evidence and safely rejects missing keys or invalid output',()=>withServer(async base=>{
  assert.equal((await post(base,'/api/import/explain',{fen:puzzle.fen,maxMoves:2})).status,400);
  const result=await post(base,'/api/import/explain',{fen:puzzle.fen,maxMoves:2,modelSettings:settings,evidence:['fake']});assert.equal(result.status,502);assert.equal((await result.json()).code,'MODEL_IMPORT_RESPONSE_INVALID');
},{fetchImpl:async()=>payload({move:'fake'})}));
