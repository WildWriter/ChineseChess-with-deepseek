import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichTeaching} from '../src/teaching-analysis.js';
import {buildWalkthrough,replayLine,validateDetailedResponse} from '../src/walkthrough.js';
import {trainingWalkthrough} from '../src/training-walkthrough.js';
import {parseFen,generateLegalMoves,moveToUci} from '../public/vendor/xiangqi.js';
import {generalSafety} from '../src/position-facts.js';
import {recognizePositionImage,parseMappedAnswer} from '../src/position-vision.js';
import {detailedAnswer} from './model-fixture.js';
import {analyzeCandidates,engineAvailable,validatePV} from '../src/engine.js';
import {buildImportedReport} from '../src/imported-position.js';
import {explainImportedPosition} from '../src/position-coach.js';

test('teaching comparisons replay each engine line, preserve score perspectives and do not mutate the cached rule walkthrough',async()=>{
  const original=trainingWalkthrough('ending-ladder-two'),saved=structuredClone(original),requests=[];
  const result=await enrichTeaching(original,async(fen,candidates)=>{
    requests.push({fen,candidates});const p=parseFen(fen),moves=candidates.length?candidates:generateLegalMoves(p.board,p.turn).map(moveToUci).slice(0,3);
    return {variations:moves.map((move,n)=>({move,pv:[move],depth:12,score:{type:'cp',value:300-n*80,bound:null,perspective:'side-to-move'}}))};
  });
  assert.deepEqual(original,saved);assert.equal(result.analysisCoverage.evaluated,result.steps.length);
  for(const step of result.steps){
    assert.equal(step.comparison.rootFen,step.beforeFen);assert.equal(step.comparison.perspective,step.turn);
    for(const branch of step.alternatives){if(!branch.assessment)continue;assert.deepEqual(replayLine(step.beforeFen,branch.line.map(p=>p.move)),branch.line);assert.ok(branch.assessment.deltaVsMain<=0);if(['correct','defence'].includes(branch.verdict))assert.deepEqual(branch.line,original.steps.find(s=>s.id===step.id).alternatives.find(b=>b.id===branch.id).line);}
    for(const reply of step.responses){assert.equal(reply.line[0].beforeFen,step.afterFen);if(reply.assessment)assert.notEqual(reply.assessment.perspective,step.turn);}
  }
  assert.ok(requests.length>=result.steps.length);
});
test('real engine compares the reported elephant retreat at a shared depth and its continuation survives the imported teaching contract', {skip:!engineAvailable()},async()=>{
  const fen='9/9/3aka3/9/6b2/9/6P2/8B/4A4/3AK2p1 b - - 0 1';
  const p=parseFen(fen),candidates=['g5i7',...generateLegalMoves(p.board,p.turn).map(moveToUci).filter(m=>m!=='g5i7')].slice(0,4);
  const analysis=await analyzeCandidates(fen,candidates,300);
  assert.equal(analysis.variations.length,4);assert.equal(new Set(analysis.variations.map(v=>v.depth)).size,1);
  for(const item of analysis.variations){assert.ok(candidates.includes(item.move));assert.deepEqual(validatePV(fen,item.pv),item.pv);}
  const report=buildImportedReport(fen,{status:'not-found',maxMoves:3,line:[]},{bestMove:'g5i7',pv:['g5i7'],score:{type:'cp',value:0},depth:12});
  let supplied;
  const result=await explainImportedPosition(report,{source:'session',apiKey:'mock-only',model:'deepseek-flash'},async(url,options)=>{
    supplied=JSON.parse(JSON.parse(options.body).messages[1].content);
    const answer=detailedAnswer(supplied),main=supplied.walkthrough.steps[0].comparison.mainContinuation;
    answer.steps[0].reason+=' 引擎提供的合法参考线路是 '+main.line.map(p=>p.move).join('、')+'，它只反映本次搜索。';
    return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})};
  },analyzeCandidates);
  assert.equal(supplied.walkthrough.analysisCoverage.evaluated,1);assert.equal(result.source,'model');assert.equal(result.walkthrough.teachingSource,'model');
  assert.equal(result.walkthrough.result.label,'胜负暂未确定');
});
test('malformed engine branches do not enter teaching evidence and unavailable comparisons stay unranked',async()=>{
  const result=await enrichTeaching(trainingWalkthrough('rook-line'),async()=>({variations:[{move:'a1a7',pv:['a1a7','a0a9'],score:{type:'cp',value:900}}]}));
  assert.equal(result.steps[0].comparison.source,'unavailable');
  assert.equal(result.steps[0].alternatives.some(b=>b.line.some(p=>p.move==='a0a9')),false);
});
test('actual quiet elephant retreat is never described as an obligatory check evasion and copied rule filler is rejected',()=>{
  const fen='9/9/3aka3/9/6b2/9/6P2/8B/4A4/3AK2p1 b - - 0 1';
  const walkthrough=buildWalkthrough({fen,moves:['g5i7'],attacker:'w',goal:'reference',task:'研究当前局面'}),step=walkthrough.steps[0];
  assert.equal(step.facts.before.inCheck,false);assert.match(step.goal,/当前没有被将军/);
  const context={candidateMove:step.move,evidence:walkthrough.evidence,walkthrough},data=detailedAnswer(context);
  data.steps[0].reason='黑方象从 g5 到 i7。相走田字，不能过河，对角线中点的象眼也必须为空。这一步已经通过走法和帅将安全检查。这一步没有将军，不能仅凭走子合法就断言对手只能按演示线路回应。';
  assert.throws(()=>validateDetailedResponse(data,walkthrough,['S1']),/规则占位/);
  const final=trainingWalkthrough('ending-ladder-two').steps.at(-1),p=parseFen(final.afterFen),safety=generalSafety(p.board,'b');
  assert.equal(safety.inCheck,true);assert.ok(safety.checkers.length);assert.ok(safety.neighbours.every(n=>!n.legal));
});

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=';
const cells=()=>Array.from({length:90},(_,n)=>({id:'G'+String(n).padStart(2,'0'),image,inkSide:null,inkDensity:0}));
const settings={source:'session',apiKey:'glyph-test-only',model:'deepseek-flash'};
const response=cells=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({cells})}}]})});
test('a missing red general triggers visual rereading and only a transcribed general glyph repairs the impossible elephant',async()=>{
  const parsed=parseFen('9/9/3aka3/9/6b2/9/6P2/9/4A4/3AB1Bp1 w - - 0 1');let calls=0;
  const result=await recognizePositionImage({cells:cells(),recognitionMode:'mapped',orientation:'red-bottom',turn:'w',imageConsent:true,modelSettings:settings},async(url,options)=>{
    calls++;const body=JSON.parse(options.body),ids=body.messages[1].content.filter(p=>p.type==='text').flatMap(p=>[...p.text.matchAll(/唯一图片编号 (G\d{2})/g)].map(m=>m[1]));
    return response(ids.map(id=>{const n=Number(id.slice(1)),piece=parsed.board[Math.floor(n/9)][n%9];return calls===3&&id==='G85'?{id,char:'帥',piece:'B'}:{id,piece};}));
  });
  assert.equal(calls,3);assert.equal(parseFen(result.fen).board[9][4],'K');assert.equal(result.validation.ok,true);
  assert.ok(result.reviewCells.some(c=>c.square==='e0'&&/转录不一致/.test(c.reason)));
  assert.ok(!JSON.stringify(result).includes(settings.apiKey));
  const answer=parseMappedAnswer({cells:[{id:'G85',char:'帥',piece:'B'}]},['G85']);assert.equal(answer.get('G85'),'K');
});
test('rereading does not invent a missing general when every visible transcription still says elephant',async()=>{
  const parsed=parseFen('9/9/3aka3/9/6b2/9/6P2/9/4A4/3AB1Bp1 w - - 0 1');
  const result=await recognizePositionImage({cells:cells(),recognitionMode:'mapped',orientation:'red-bottom',turn:'w',imageConsent:true,modelSettings:settings},async(url,options)=>{
    const ids=JSON.parse(options.body).messages[1].content.filter(p=>p.type==='text').flatMap(p=>[...p.text.matchAll(/唯一图片编号 (G\d{2})/g)].map(m=>m[1]));
    return response(ids.map(id=>{const n=Number(id.slice(1));return{id,piece:parsed.board[Math.floor(n/9)][n%9]};}));
  });
  assert.equal(parseFen(result.fen).board[9][4],'B');assert.equal(result.validation.ok,false);assert.match(result.validation.message,/未找到红帅/);
});
