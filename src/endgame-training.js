import { parseFen, boardToFen, generateLegalMoves, moveToUci, uciToMove, applyMove, isGeneralInCheck, gameStatus, pieceName } from '../public/vendor/xiangqi.js';
import { formatMoveNotation } from '../public/vendor/xiangqi-notation.js';
import { checkingWins, hardestDefence } from './endgame-search.js';
import { retrieveKnowledge } from './knowledge.js';

const invalid = message => Object.assign(new Error(message), {status:400});

function step(puzzle, fen, move, remaining) {
  if (typeof move !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(move)) throw invalid('请选择起点和终点。');
  const {board,turn}=parseFen(fen);
  if(turn!=='w')throw invalid('当前不轮到红方。');
  if(!generateLegalMoves(board,'w').some(item=>moveToUci(item)===move))return{legal:false,correct:false,complete:false,message:'这一步不合法：请检查走子规则与红帅安全。'};
  const winning=checkingWins(fen,remaining).find(item=>item.move===move);
  if(!winning)return{legal:true,correct:false,complete:false,message:`走法合法，但不能保证在剩余 ${remaining} 个红方回合内连续将军并绝杀。棋盘保持当前局面，请换一步。`};
  const parsed=uciToMove(move), captured=board[parsed.to[0]][parsed.to[1]], next=applyMove(board,parsed);
  const replies=generateLegalMoves(next,'b'), complete=gameStatus(next,'b').reason==='绝杀';
  const enemyFen=boardToFen(next,'b');
  const opponentMove=complete?null:hardestDefence(enemyFen,remaining-1);
  const opponentNotation=opponentMove?formatMoveNotation(next,uciToMove(opponentMove)):null;
  const nextFen=opponentMove?boardToFen(applyMove(next,uciToMove(opponentMove)),'w'):enemyFen;
  const notation=formatMoveNotation(board,parsed);
  const evidence=[
    {id:'E1',text:`${notation}（${move}）通过本项目基础规则检查。`},
    {id:'E2',text:captured==='.'?'落点原为空点，没有吃子。':`这一步吃掉黑${pieceName(captured)}。`},
    {id:'E3',text:`走后形成将军，黑方有 ${replies.length} 个合法应对。`},
    {id:'E4',text:complete?'黑方正在被将军且没有合法应对，已完成绝杀。':`规则搜索覆盖黑方全部合法应对：此着可保证在剩余 ${remaining} 个红方回合内连续将军并绝杀；本题尚未完成。`}
  ];
  return{legal:true,correct:true,complete,fen,task:`当前剩余 ${remaining} 个红方回合，须连续将军并绝杀。`,move,notation,nextFen,opponentMove,opponentNotation,evidence,checking:isGeneralInCheck(next,'b'),replyCount:replies.length,knowledge:retrieveKnowledge(puzzle.knowledge),lesson:puzzle.lesson,reflection:puzzle.reflection,message:complete?'连续将军完成，黑方已被绝杀！':`这一步正确。黑方应将：${opponentNotation}（${opponentMove}）。请继续，剩余 ${remaining-1} 个红方回合。`};
}

// Only red moves are supplied. All black replies and board positions are
// independently reconstructed on the server; never trust a client FEN/result.
export function replayEndgame(puzzle, history=[]) {
  if(!Array.isArray(history)||history.length>puzzle.maxRedMoves)throw invalid('残局步骤记录无效。');
  let fen=puzzle.fen,last=null;
  const line=[];
  for(let index=0;index<history.length;index++){
    if(last?.complete)throw invalid('本题已经结束，不能追加步骤。');
    last=step(puzzle,fen,history[index],puzzle.maxRedMoves-index);
    if(!last.correct)throw invalid('残局历史包含非法或未达目标的步骤，请重试本题。');
    line.push({side:'红',move:last.move,notation:last.notation});
    if(last.opponentMove)line.push({side:'黑',move:last.opponentMove,notation:last.opponentNotation});
    fen=last.nextFen;
  }
  return{fen,last,line,complete:Boolean(last?.complete),remaining:puzzle.maxRedMoves-history.length};
}

export function attemptEndgame(puzzle,move,history=[]) {
  const position=replayEndgame(puzzle,history);
  if(position.complete)throw invalid('本题已经完成，请重试本题或选择下一题。');
  const report=step(puzzle,position.fen,move,position.remaining);
  if(!report.correct)return report;
  const line=[...position.line,{side:'红',move,notation:report.notation}];
  if(report.opponentMove)line.push({side:'黑',move:report.opponentMove,notation:report.opponentNotation});
  return{...report,history:[...history,move],line,redMovesUsed:history.length+1};
}

export function endgameLesson(puzzle,history=[],move) {
  const position=replayEndgame(puzzle,history);
  const wins=position.complete?[]:checkingWins(position.fen,position.remaining);
  const selected=wins.find(item=>item.move===move)?.move || (!history.length&&wins.find(item=>item.move===puzzle.canonical)?.move) || wins[0]?.move;
  const report=position.complete?position.last:step(puzzle,position.fen,selected,position.remaining);
  return{...report,source:'lesson',title:'残局教案讲解',line:position.line};
}

export function endgameHint(puzzle,level,history=[]) {
  const position=replayEndgame(puzzle,history);
  if(position.complete)throw invalid('本题已经完成，可查看讲解或进入下一题。');
  const wins=checkingWins(position.fen,position.remaining);
  const selected=(!history.length&&wins.find(item=>item.move===puzzle.canonical))||wins[0];
  const move=selected.move, notation=formatMoveNotation(parseFen(position.fen).board,uciToMove(move));
  const hints=history.length?[`这是红方第 ${history.length+1} 步，先检查黑方刚才应将后改变的退路。`,`剩余 ${position.remaining} 个红方回合。选择能保持将军、并覆盖全部合法防守的走法。`]:puzzle.hints;
  return{level,text:level===3?`当前局面的一个可行着法：${notation}（${move}）。${position.remaining>1?'走后还要根据黑方应将继续。':'走后必须同时满足将军与无合法应对。'}`:hints[level-1],move:level===3?move:null};
}
