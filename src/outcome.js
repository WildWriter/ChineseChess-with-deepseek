import { parseFen, gameStatus } from '../public/vendor/xiangqi.js';

export function positionVerdict(fen,{proof,engine}={}) {
  const {board,turn}=parseFen(fen),status=gameStatus(board,turn);
  if(status.state!=='playing'){
    const winner=status.state==='red_win'?'w':'b';
    return {state:winner==='w'?'red_win':'black_win',label:winner==='w'?'红胜':'黑胜',certainty:'proven',basis:`当前局面已${status.reason}，无合法走法的一方判负。`};
  }
  if(proof?.status==='proven')return {state:turn==='w'?'red_win':'black_win',label:turn==='w'?'红胜':'黑胜',certainty:'proven',basis:'规则搜索覆盖全部合法防守，已证明当前行棋方可强制连续将杀。'};
  let assessment='当前没有足以确定完整胜和负的证据。';
  if(engine?.score){
    const {type,value}=engine.score,positive=value>0,side=(positive?turn:turn==='w'?'b':'w')==='w'?'红方':'黑方';
    assessment=type==='cp'?value===0?'引擎暂评接近平衡；零分不能单独证明和棋。':`引擎当前偏向${side}，分值 ${value}（原局面行棋方视角，深度 ${engine.depth||0}）；优势不等于已证明获胜。`:`引擎给出胜负距离 ${value}（原局面行棋方视角，深度 ${engine.depth||0}），属于有限搜索判断，可能包含困毙。`;
  }
  return {state:'unknown',label:'胜负暂未确定',certainty:'unproven',basis:assessment+' 未找到短将杀不等于和棋；演示一条胜线也不证明对方所有应对都输。'};
}
export const verdictText=result=>`胜负结论：${result.label}。${result.basis}`;
