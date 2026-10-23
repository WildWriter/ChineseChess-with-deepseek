import { parseFen, generateLegalMoves, generatePseudoMoves, applyMove, opposite, moveToUci, uciToMove, findGeneral, pieceName, pieceSide, isGeneralInCheck } from '../public/vendor/xiangqi.js';
import { formatMoveNotation } from '../public/vendor/xiangqi-notation.js';

export const squareName=([r,c])=>`${'abcdefghi'[c]}${9-r}`;
const name=p=>(pieceSide(p)==='w'?'红':'黑')+pieceName(p);

function attackers(board,target,side){
  const copy=board.map(r=>r.slice()),defender=opposite(side);
  copy[target[0]][target[1]]=defender==='w'?'P':'p';
  const result=generatePseudoMoves(copy,side).filter(m=>m.to[0]===target[0]&&m.to[1]===target[1]).map(m=>({square:squareName(m.from),piece:board[m.from[0]][m.from[1]],name:name(board[m.from[0]][m.from[1]]),geometry:moveGeometry(board,m,board[m.from[0]][m.from[1]])}));
  const general=findGeneral(board,side);
  if(general&&general[1]===target[1]){
    const low=Math.min(general[0],target[0]),high=Math.max(general[0],target[0]);let clear=true;
    for(let r=low+1;r<high;r++)if(board[r][target[1]]!=='.')clear=false;
    if(clear&&!result.some(p=>p.square===squareName(general)))result.push({square:squareName(general),piece:side==='w'?'K':'k',name:side==='w'?'红帅':'黑将',geometry:{kind:'将帅照面'}});
  }
  return result;
}
export function generalSafety(board,side){
  const from=findGeneral(board,side);if(!from)return null;
  const legal=generateLegalMoves(board,side).filter(m=>m.from[0]===from[0]&&m.from[1]===from[1]).map(moveToUci),squares=[];
  for(const [dr,dc]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const to=[from[0]+dr,from[1]+dc],r=to[0],c=to[1];if(r<0||r>9||c<0||c>8)continue;
    const outsidePalace=c<3||c>5||(side==='w'?(r<7||r>9):(r<0||r>2));
    const piece=board[r][c],move={from,to},blocked=piece!=='.'&&pieceSide(piece)===side;
    const next=blocked||outsidePalace?null:applyMove(board,move);
    squares.push({square:squareName(to),attempt:moveToUci(move),legal:legal.includes(moveToUci(move)),outsidePalace,blockedBy:blocked?name(piece):null,attackers:next?attackers(next,to,opposite(side)):[]});
  }
  return {square:squareName(from),inCheck:isGeneralInCheck(board,side),checkers:attackers(board,from,opposite(side)),neighbours:squares};
}
export function moveImpact(fen,token){
  const {board,turn}=parseFen(fen),move=uciToMove(token),next=applyMove(board,move),piece=board[move.from[0]][move.from[1]];
  const attacks=(b,from)=>generatePseudoMoves(b,turn,from).filter(m=>b[m.to[0]][m.to[1]]!=='.').map(m=>({square:squareName(m.to),target:name(b[m.to[0]][m.to[1]])}));
  return {mover:name(piece),from:squareName(move.from),to:squareName(move.to),captured:board[move.to[0]][move.to[1]]==='.'?null:name(board[move.to[0]][move.to[1]]),ownWasInCheck:isGeneralInCheck(board,turn),ownInCheck:isGeneralInCheck(next,turn),opponentBefore:generalSafety(board,opposite(turn)),opponentAfter:generalSafety(next,opposite(turn)),pieceAttacksBefore:attacks(board,move.from),pieceAttacksAfter:attacks(next,move.to),scope:'攻击目标描述几何关系，不等于无偿得子；帅将邻格根据走后棋盘核验，包含将帅照面。'};
}

// Facts describe legal one-ply opportunities, never static-exchange values or
// forced wins. Keeping this distinction in the payload prevents false tactics.
export function positionFacts(fen) {
  const {board,turn}=parseFen(fen),material={w:{},b:{}},pieces=[];
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){
    const p=board[r][c];if(p==='.')continue;const side=pieceSide(p);
    material[side][pieceName(p)]=(material[side][pieceName(p)]||0)+1;
    pieces.push({square:squareName([r,c]),piece:p,name:name(p)});
  }
  const legal=generateLegalMoves(board,turn);
  return {turn,material,pieces,inCheck:isGeneralInCheck(board,turn),legalMoveCount:legal.length,
    generals:{w:generalSafety(board,'w'),b:generalSafety(board,'b')},
    generalMoves:legal.filter(m=>board[m.from[0]][m.from[1]].toUpperCase()==='K').map(moveToUci),
    captures:legal.filter(m=>board[m.to[0]][m.to[1]]!=='.').map(m=>({move:moveToUci(m),notation:formatMoveNotation(board,m),piece:name(board[m.from[0]][m.from[1]]),target:name(board[m.to[0]][m.to[1]]),square:squareName(m.to)})),
    scope:'captures 是当前行棋方可立即合法吃子的机会，不代表吃后安全、赚子或强制得子；generalMoves 只包含当前合法帅将走法，不等于全部受控格。'};
}
export function moveGeometry(board,move,piece) {
  const between=[];
  const [r,c]=move.from,[tr,tc]=move.to,dr=Math.sign(tr-r),dc=Math.sign(tc-c),type=piece.toUpperCase();
  if(['R','C'].includes(type)){
    for(let y=r+dr,x=c+dc;y!==tr||x!==tc;y+=dr,x+=dc)if(board[y][x]!=='.')between.push({square:squareName([y,x]),piece:board[y][x],name:name(board[y][x])});
    return {kind:type==='C'?'炮架与直线路径':'车的直线路径',between};
  }
  if(type==='N'){const leg=[Math.abs(tr-r)===2?r+(tr-r)/2:r,Math.abs(tc-c)===2?c+(tc-c)/2:c];return {kind:'马腿',square:squareName(leg),piece:board[leg[0]][leg[1]]};}
  if(type==='B'){const eye=[(r+tr)/2,(c+tc)/2];return {kind:'象眼',square:squareName(eye),piece:board[eye[0]][eye[1]]};}
  return {kind:type==='P'?'兵卒方向与过河':'九宫内移动',from:squareName(move.from),to:squareName(move.to)};
}
