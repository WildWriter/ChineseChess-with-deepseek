import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLES, findPuzzle, publicPuzzle } from '../src/puzzles.js';
import { checkingWins } from '../src/endgame-search.js';
import { replayEndgame } from '../src/endgame-training.js';
import { attempt, getHint, getLesson, analysisFen } from '../src/training.js';
import { buildMessages, generateCoach } from '../src/coach.js';
import { parseFen, boardToFen, generateLegalMoves, applyMove, moveToUci, uciToMove, isGeneralInCheck, gameStatus } from '../public/vendor/xiangqi.js';
import { filterCurriculum, recordAttempt } from '../public/curriculum.js';

const multi=PUZZLES.filter(p=>p.goal==='forced-mate');
// Independent small minimax oracle, deliberately not using the search cache.
function oracle(board,turn,plies){
  const moves=generateLegalMoves(board,turn);
  if(!moves.length)return turn==='b'&&isGeneralInCheck(board,'b');
  if(plies===0)return false;
  if(turn==='b')return moves.every(move=>oracle(applyMove(board,move),'w',plies-1));
  return moves.some(move=>{const next=applyMove(board,move);return isGeneralInCheck(next,'b')&&oracle(next,'b',plies-1);});
}

test('curriculum has eight preserved basics and twelve thematic endgames without duplicate boards',()=>{
  assert.equal(filterCurriculum(PUZZLES,'basic').length,8);assert.equal(filterCurriculum(PUZZLES,'endgame').length,12);
  assert.equal(multi.length,8);assert.equal(new Set(PUZZLES.map(p=>p.fen)).size,20);
  for(const theme of ['车类配合','马类配合','炮类配合','兵类配合'])assert.ok(filterCurriculum(PUZZLES,'endgame',theme).length);
  for(const puzzle of PUZZLES)assert.equal(publicPuzzle(puzzle).canonical,undefined);
});
test('every multi-move canonical beats all legal defences and is not already a one-move mate',()=>{
  for(const puzzle of multi){
    assert.deepEqual(checkingWins(puzzle.fen,1),[],puzzle.id);
    const {board}=parseFen(puzzle.fen),next=applyMove(board,uciToMove(puzzle.canonical));
    assert.equal(oracle(next,'b',puzzle.maxRedMoves*2-2),true,puzzle.id);
    for(const move of generateLegalMoves(board,'w')){
      const after=applyMove(board,move),expected=isGeneralInCheck(after,'b')&&oracle(after,'b',puzzle.maxRedMoves*2-2);
      assert.equal(checkingWins(puzzle.fen,puzzle.maxRedMoves).some(w=>w.move===moveToUci(move)),expected,`${puzzle.id}:${moveToUci(move)}`);
    }
  }
});
test('all multi-move exercises play through legal automatic defences to actual checkmate',()=>{
  for(const puzzle of multi){
    let history=[],report;
    while(!report?.complete){
      const hint=getHint(puzzle.id,3,history);report=attempt(puzzle.id,hint.move,history);
      assert.equal(report.correct,true);assert.equal(report.legal,true);
      history=report.history;
      assert.ok(history.length<=puzzle.maxRedMoves);
      const context=replayEndgame(puzzle,history);assert.equal(context.fen,report.nextFen);
      if(!report.complete){assert.ok(report.opponentMove);assert.equal(parseFen(report.nextFen).turn,'w');assert.equal(isGeneralInCheck(parseFen(report.nextFen).board,'w'),false);}
    }
    assert.equal(gameStatus(parseFen(report.nextFen).board,'b').reason,'绝杀',puzzle.id);
    assert.equal(report.line.length,history.length*2-1);
    assert.equal(getLesson(puzzle.id,null,history).move,history.at(-1));
    assert.throws(()=>attempt(puzzle.id,puzzle.canonical,history),e=>e.status===400);
  }
});
test('different winning openings are accepted and legal nonforcing moves preserve the current board',()=>{
  const puzzle=findPuzzle('ending-ladder-two'),wins=checkingWins(puzzle.fen,2);
  assert.ok(wins.length>1);for(const win of wins)assert.equal(attempt(puzzle.id,win.move).correct,true);
  const {board}=parseFen(puzzle.fen),wrong=generateLegalMoves(board,'w').map(moveToUci).find(move=>!wins.some(w=>w.move===move));
  const response=attempt(puzzle.id,wrong);assert.equal(response.legal,true);assert.equal(response.correct,false);assert.equal(response.nextFen,undefined);
  assert.equal(attempt(puzzle.id,'a6b8').legal,false);
});
test('server reconstructs history and rejects forged, excessive or post-completion moves',()=>{
  for(const history of ['wrong',Array(4).fill('a6a8'),['a6b8'],[null]])assert.throws(()=>attempt('ending-ladder-two','a6a8',history),e=>e.status===400);
  assert.throws(()=>checkingWins(findPuzzle('ending-ladder-two').fen,10));
  const puzzle=findPuzzle('cannon-mate');assert.ok(!checkingWins(puzzle.fen,1).some(w=>w.move==='d7c7'),'stalemate is not a checking mate');
});
test('hints, lessons and model prompts advance to the actual current position',async()=>{
  const puzzle=findPuzzle('ending-ladder-three'),first=attempt(puzzle.id,puzzle.canonical);
  const hint=getHint(puzzle.id,3,first.history),lesson=getLesson(puzzle.id,null,first.history);
  assert.equal(lesson.fen,first.nextFen);assert.equal(analysisFen(puzzle.id,first.history),first.nextFen);
  assert.ok(checkingWins(first.nextFen,2).some(w=>w.move===hint.move));
  const context=JSON.parse(buildMessages(puzzle.id,null,'customized',null,first.history)[1].content);
  assert.equal(context.fen,first.nextFen);assert.equal(context.candidateMove,lesson.move);
  const response={move:lesson.move,observation:'黑将已应将。',reason:'继续带将军封锁退路。',practice:'检查全部应将。',evidenceIds:['E1','E4']};
  const report=await generateCoach(puzzle.id,null,'customized',null,async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})}),{source:'session',apiKey:'test-only',model:'deepseek-flash'},first.history);
  assert.equal(report.source,'model');assert.equal(report.move,lesson.move);
});
test('partial correct steps never count as completion and assisted status lasts the whole exercise',()=>{
  const partial=recordAttempt(undefined,{correct:true,complete:false},false);assert.equal(partial.completed,false);assert.equal(partial.independent,false);assert.equal(partial.mistakes,0);
  const wrong=recordAttempt(partial,{correct:false},true);assert.equal(wrong.mistakes,1);
  const assisted=recordAttempt(wrong,{correct:true,complete:true},true);assert.equal(assisted.completed,true);assert.equal(assisted.independent,false);assert.equal(assisted.resolved,true);
  assert.equal(recordAttempt(assisted,{correct:true,complete:true},false).independent,true);
  assert.equal(recordAttempt(undefined,{correct:true},false).completed,true,'one-step basics remain compatible');
});
