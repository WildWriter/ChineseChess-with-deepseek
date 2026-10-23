import { parseFen, boardToFen, generateLegalMoves, generatePseudoMoves, applyMove, opposite, gameStatus, isGeneralInCheck, moveToUci, uciToMove, pieceName, pieceSide } from '../public/vendor/xiangqi.js';
import { formatMoveNotation } from '../public/vendor/xiangqi-notation.js';

import { positionFacts, moveGeometry, moveImpact } from './position-facts.js';
import { positionVerdict, verdictText } from './outcome.js';
import { invalidCoachAnswer, unverifiedCoachMove } from './coach-validation.js';

const sideName = side => side === 'w' ? '红方' : '黑方';
const rules = {
  R: '车沿横线或竖线移动，沿途不能越过棋子。',
  C: '炮不吃子时沿直线走且不能越子；吃子时必须隔着恰好一个炮架，炮架可以是任意一方的棋子。',
  N: '马走日字；先沿较长方向走一格的位置是马腿，马腿被占就不能往该方向走。',
  B: '相走田字，不能过河，对角线中点的象眼也必须为空。',
  A: '士沿九宫内的斜线走一格，不能走出九宫。',
  K: '帅将通常只能在九宫内横走或直走一格，且不能进入被攻击的位置，也不能让双方将帅直接照面。',
  P: '兵卒每次走一格，只能向前；过河后增加左右横走的选择，始终不能后退。'
};

export function replayLine(fen, moves) {
  let { board, turn } = parseFen(fen);
  return moves.map((token, index) => {
    if (gameStatus(board, turn).state !== 'playing' || !generateLegalMoves(board, turn).some(move => moveToUci(move) === token)) throw new Error('讲解线路包含非法或结束后的着法。');
    const move = uciToMove(token), piece = board[move.from[0]][move.from[1]], captured = board[move.to[0]][move.to[1]];
    const beforeFen = boardToFen(board, turn), notation = formatMoveNotation(board, move);
    board = applyMove(board, move); const nextTurn = opposite(turn);
    const item = { id: `S${index + 1}`, move: token, side: sideName(turn), turn, notation, beforeFen, afterFen: boardToFen(board, nextTurn), piece, captured, checking: isGeneralInCheck(board, nextTurn), replyCount: generateLegalMoves(board, nextTurn).length, outcome: gameStatus(board, nextTurn) };
    turn = nextTurn; return item;
  });
}

// A bounded AND/OR proof, shared across the sample branches of one explanation.
// A failed search only refutes the specified checking-mate exercise, never a
// general win. Exhaustion propagates as unknown and is not cached as failure.
function branchSearch(attacker, { maxNodes = 18000, timeBudgetMs = 600 } = {}) {
  let nodes = 0; const started = Date.now(), cache = new Map();
  function visit(board, turn, plies) {
    if (++nodes > maxNodes || Date.now() - started > timeBudgetMs) return { status: 'unknown', line: [] };
    const key = `${boardToFen(board, turn)}|${plies}`;
    if (cache.has(key)) return cache.get(key);
    const legal = generateLegalMoves(board, turn);
    if (!legal.length) return { status: turn !== attacker && isGeneralInCheck(board, turn) ? 'win' : 'fail', line: [] };
    if (plies <= 0) return { status: 'fail', line: [] };
    let chosen = null, unknown = false;
    for (const move of legal) {
      const next = applyMove(board, move);
      if (turn === attacker && !isGeneralInCheck(next, opposite(turn))) continue;
      const child = visit(next, opposite(turn), plies - 1);
      if (child.status === 'unknown') { unknown = true; continue; }
      const result = { status: child.status, line: [moveToUci(move), ...child.line] };
      if (turn === attacker && child.status === 'win' || turn !== attacker && child.status === 'fail') { cache.set(key, result); return result; }
      if (!chosen || result.line.length > chosen.line.length) chosen = result;
    }
    const result = unknown ? { status: 'unknown', line: [] } : chosen || { status: 'fail', line: [] };
    cache.set(key, result); return result;
  }
  return (fen, plies) => { const p = parseFen(fen); return visit(p.board, p.turn, plies); };
}

function moveFacts(step) {
  const { move, side, piece, captured, checking, replyCount, outcome } = step;
  const action = `${side}把${pieceName(piece)}从 ${move.slice(0, 2)} 走到 ${move.slice(2)}，${captured === '.' ? '落点原为空位，这步没有吃子' : `吃掉${pieceSide(captured) === 'w' ? '红' : '黑'}${pieceName(captured)}`}。`;
  return {
    observation: `${action}${checking?'它直接攻击对方帅将，对方下一步必须应将。':'当前不是将军着，应结合后续判断它的调动、兑子或防守作用。'}`,
    reason: `${side}${pieceName(piece)}从 ${move.slice(0,2)} 到 ${move.slice(2)}。${captured!=='.'?`直接效果是消除${pieceSide(captured)==='w'?'红':'黑'}${pieceName(captured)}，后续是否可被回吃要继续比较。`:checking?'直接效果是改变攻击线、向对方帅将施压；具体退路由下方局面事实列出。':'这是一手非将军走法。规则说明尚未评价它为何比其他调动更合适，请生成 DS 讲解查看结合实际变化的解释。'}${rules[piece.toUpperCase()]}`,
    consequence: outcome.state !== 'playing' ? `走后局面为${outcome.reason}。${outcome.reason === '绝杀' ? '对方被将军且没有合法应对，两个条件同时成立。' : '对方没有合法走法但没有被将军，所以属于困毙，不能算作将杀题的绝杀。'}` : `走后${checking ? '形成将军' : '没有形成将军'}，对方还有 ${replyCount} 个合法应对。${checking ? '本步若不是最后一步，还需要继续处理这些应将，不能提前宣称完成绝杀。' : '演示只选择其中一条应对，并不代表其他走法不合法。'}`
  };
}

function responseBranches(step,nextSteps,prove,goal,maxMoves,index) {
  const {board,turn}=parseFen(step.afterFen),legal=generateLegalMoves(board,turn);
  const primary=nextSteps[0]?.move,ranked=[...legal].sort((a,b)=>{
    const rank=m=>(moveToUci(m)===primary?100:0)+(board[m.to[0]][m.to[1]]!=='.'?20:0)+(board[m.from[0]][m.from[1]].toUpperCase()==='K'?5:0);
    return rank(b)-rank(a)||moveToUci(a).localeCompare(moveToUci(b));
  });
  const selected=[];
  for(const predicate of [m=>moveToUci(m)===primary,m=>board[m.to[0]][m.to[1]]!=='.',m=>board[m.from[0]][m.from[1]].toUpperCase()==='K']){
    const found=ranked.find(m=>predicate(m)&&!selected.includes(m));if(found)selected.push(found);
  }
  for(const move of ranked)if(selected.length<3&&!selected.includes(move))selected.push(move);
  return selected.slice(0,3).map((reply,n)=>{
    const token=moveToUci(reply),initial=replayLine(step.afterFen,[token])[0];
    let tokens=[token],source='legal-example',proofStatus='unproven';
    if(token===primary){tokens=nextSteps.slice(0,3).map(p=>p.move);source='provided-line';}
    else if(goal==='checking-mate'&&initial.outcome.state==='playing'){
      const proof=prove(initial.afterFen,Math.max(0,maxMoves*2-3-index));proofStatus=proof.status;
      if(proof.line.length){tokens.push(...proof.line.slice(0,3));source='bounded-search';}
    }
    if(tokens.length===1&&initial.outcome.state==='playing'){
      const position=parseFen(initial.afterFen),replies=generateLegalMoves(position.board,position.turn);
      const follow=replies.find(m=>position.board[m.to[0]][m.to[1]]!=='.')||replies[0];
      if(follow)tokens.push(moveToUci(follow));
    }
    const line=replayLine(step.afterFen,tokens),after=positionFacts(initial.afterFen),end=line.at(-1),action=moveFacts(initial).observation;
    const captures=after.captures.slice(0,3).map(m=>`${m.piece}可走${m.notation}（${m.move}）吃${m.square}的${m.target}`).join('；');
    const explanation=`若对方走${initial.notation}（${token}），${action}${initial.checking?'这步还会反将，轮到我方先应将。':'这步没有反将。'}${initial.captured==='.'?'双方子力数量没有因这步改变。':`${pieceName(initial.captured)} 已从棋盘上被吃掉，子力数量发生变化。`}${captures?captures+'；这仅说明可以吃，未计算交换后的得失。':''}${line[1]?`下方可摆出我方${line[1].notation}（${line[1].move}）的后续。`:''}${end.outcome.state!=='playing'?`本变化末尾为${end.outcome.state==='red_win'?'红胜':'黑胜'}（${end.outcome.reason}），这只描述本变化。`:'变化还未结束，不能凭这条示例确定整盘胜负。'}${proofStatus==='win'?'此分支已通过限定步数内连续将杀搜索。':'未给出独立棋力比较，不能把示例后续当作唯一或最佳应对。'}`;
    return {id:`${step.id}R${n+1}`,move:token,notation:initial.notation,side:initial.side,line,facts:after,source,proofStatus,explanation};
  });
}

export function buildWalkthrough({ fen, moves, attacker = parseFen(fen).turn, maxMoves = 1, goal = 'reference', goalTest, task, focusIndex = 0, summary, searchBudget, result }) {
  const steps = replayLine(fen, moves), prove = branchSearch(attacker, searchBudget);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index], { board, turn } = parseFen(step.beforeFen);
    Object.assign(step, moveFacts(step));
    step.facts={before:positionFacts(step.beforeFen),after:positionFacts(step.afterFen),geometry:moveGeometry(board,uciToMove(step.move),step.piece),impact:moveImpact(step.beforeFen,step.move)};
    const captures=step.facts.after.captures.slice(0,3);
    step.consequence+=captures.length?' 当前对方可立即选择：'+captures.map(c=>`${c.notation}（${c.move}）吃${c.square}的${c.target}`).join('；')+'。这些是合法吃子机会，吃后是否安全还需继续计算。':' 当前对方没有一步即可合法吃子的着法。';
    const generalMoves=step.facts.after.generalMoves;
    step.consequence+=generalMoves.length?' 对方帅将当前可合法移动的着法：'+generalMoves.join('、')+'。':' 对方帅将当前不能直接移动；仍须检查其他棋子的应对。';
    step.goal = turn === attacker ? task : step.facts.before.inCheck ? `当前正在被将军，先说明本步怎样解除将军，再看攻方能否继续进攻。` : `当前没有被将军。说明${step.side}${step.notation}的调动或防守作用，并比较走后双方的具体计划。`;
    step.evidenceIds = [step.id];
    const legal = generateLegalMoves(board, turn), main = uciToMove(step.move);
    // All immediate legal choices are facts, even when the engine comparison
    // samples only three alternatives. They carry no independent evaluation.
    step.legalMoves = legal.map(moveToUci);
    const after = parseFen(step.afterFen);
    step.replyLegalMoves = generateLegalMoves(after.board, after.turn).map(moveToUci);
    // Compare a different piece too, rather than presenting only near-identical
    // moves. All samples retain their actual board and bounded proof status.
    const candidates = legal.filter(move => moveToUci(move) !== step.move).sort((a, b) => {
      const score = move => (move.from.join() === main.from.join() ? 4 : 0) + (board[move.to[0]][move.to[1]] !== '.' ? 2 : 0) + (isGeneralInCheck(applyMove(board, move), opposite(turn)) ? 3 : 0);
      return score(b) - score(a) || moveToUci(a).localeCompare(moveToUci(b));
    });
    const samples = [];
    for (const move of candidates) {
      const token = moveToUci(move), next = applyMove(board, move), nextFen = boardToFen(next, opposite(turn));
      const checking = isGeneralInCheck(next, opposite(turn)), outcome = gameStatus(next, opposite(turn));
      let verdict = 'reference', continuation = [], explanation;
      if (turn === attacker && goalTest) {
        verdict = goalTest(board, turn, move) ? 'correct' : 'misses-goal';
        explanation = verdict === 'correct' ? '这步也满足题目的明确目标，是另一种正确解，不能因为不同于示例就判错。' : `这步走法合法，但没有完成“${task}”。合法只说明可以这样走，不等于已经达到题目要求。`;
      } else if (goal === 'checking-mate') {
        if (turn === attacker && !checking) {
          verdict = 'misses-goal'; explanation = `这步${outcome.reason === '困毙' ? '造成困毙，虽然象棋规则下取胜，但不算本题要求的绝杀' : '没有形成将军，中断了本题要求的连续将军'}。这只说明没有完成限定目标，不能据此说实战必输。`;
        } else {
          const proof = prove(nextFen, Math.max(0, maxMoves * 2 - 2 - index));
          continuation = proof.line;
          verdict = proof.status === 'win' ? (turn === attacker ? 'correct' : 'defence') : proof.status === 'fail' ? 'misses-goal' : 'unproven';
          explanation = proof.status === 'win' ? (turn === attacker ? '这也是经规则搜索核验的正确解：在本题剩余步数内，能应对所有合法防守并连续将军直到绝杀。下方演示其中一条防守线路。' : '这是另一种合法防守。规则搜索确认进攻方仍能在限定步数内完成连续将杀；下方摆出相应的后续，不能直接套用原主线。') : proof.status === 'fail' ? `规则搜索未发现这步之后能在本题剩余步数内完成的强制连续将杀。${continuation.length ? '下方给出一条示例应对供检查。' : '可对照走后局面检查将军和可用应对。'}结论只针对限定步数与每步将军的目标，不代表完整胜负。` : '变化核验达到本次资源上限，尚未证明正确或错误。可以摆出来观察，但不能当作已证实的反例。';
        }
      } else explanation = '这是另一种合法走法；当前只有引擎参考主线，没有这条变化的棋力评估，不能断言它更差、失败或必胜。';
      if (!continuation.length && outcome.state === 'playing' && verdict !== 'correct') {
        const replies = generateLegalMoves(next, opposite(turn));
        const capture = replies.find(reply => reply.to.join() === move.to.join());
        if (capture || replies[0]) continuation = [moveToUci(capture || replies[0])];
      }
      const line = replayLine(step.beforeFen, [token, ...continuation].slice(0, 12));
      const facts = moveFacts(line[0]);
      explanation += ` ${facts.consequence}${line[1] ? `示例中对方走${line[1].notation}（${line[1].move}），这是一条合法应对。${line.at(-1).outcome.reason ? `本变化的最后局面为${line.at(-1).outcome.reason}。` : '演示线路不表示对手只能如此应对。'}` : ''}`;
      samples.push({ move: token, notation: formatMoveNotation(board, move), verdict, explanation, checking, outcome, line });
    }
    // Preserve one sample of each conclusion before filling the three slots.
    const chosen = [];
    for (const verdict of ['correct', 'misses-goal', 'defence', 'reference', 'unproven']) {
      const matching = samples.filter(sample => sample.verdict === verdict);
      const item = matching.find(sample => sample.outcome.reason === '困毙') || matching.find(sample => sample.checking) || matching[0];
      if (item && chosen.length < 3) chosen.push(item);
    }
    for (const item of samples) if (!chosen.includes(item) && chosen.length < 3) chosen.push(item);
    const illegal = generatePseudoMoves(board, turn).find(move => !legal.some(item => moveToUci(item) === moveToUci(move)));
    if (illegal && chosen.length < 3) chosen.push({ move: moveToUci(illegal), notation: formatMoveNotation(board, illegal), verdict: 'illegal', explanation: '这步虽然符合该棋子的基本移动形状，但走后己方帅将仍受攻击或双方将帅照面，不能作为合法应将。棋盘只标出尝试的起点和终点，不执行非法走法。', line: [] });
    step.responses=responseBranches(step,steps.slice(index+1),prove,goal,maxMoves,index);
    step.responsesNote=`对方共有 ${step.replyCount} 个合法应对，下方展示 ${step.responses.length} 条具体变化，包含主线应对；除已有强制证明外，不代表穷举或优劣排名。`;
    step.alternatives = chosen.map((item, n) => ({ id: `${step.id}V${n + 1}`, ...item }));
    step.alternativesNote = `本步共有 ${legal.length} 个合法走法，展示 ${chosen.length} 个代表性对比，并非穷举所有变化。${chosen.length ? '' : '没有其他可比较的走法。'}${turn !== attacker && goal === 'checking-mate' ? '主线证明覆盖全部合法防守；变化列表仅作抽样演示。' : ''}`;
  }
  const evidence = steps.map(step => ({ id: step.id, text: `${step.side}${step.notation}（${step.move}）：${step.consequence}` }));
  const verdict=result||positionVerdict(fen);
  const explanation=summary||`先明确目标“${task}”，逐步检查具体吃子、攻击线路与对方的不同应对。题目目标完成与整盘胜负需要分别判断；对方若改变防守，必须从对应局面重新计算。比较其他正确解和未达目标的走法，指出实际改变的棋子和后续条件，不能仅用“合法”说明好坏。复习时自己摆出每条变化，说明每步目的和最终结果。`;
  return { steps, evidence, result:verdict, focusIndex: Math.min(focusIndex, Math.max(0, steps.length - 1)), summary: explanation.startsWith(verdictText(verdict))?explanation:verdictText(verdict)+explanation };
}

export function walkthroughMoves(walkthrough) {
  const moves=new Set();
  // Only tool-owned structured move fields count as evidence; never scrape
  // arbitrary prose or the model answer to expand this allowlist.
  function collect(value,key){
    if(typeof value==='string'){
      if(['move','pv','generalMoves','legalMoves','replyLegalMoves'].includes(key)&&/^[a-i][0-9][a-i][0-9]$/.test(value))moves.add(value);
    }else if(Array.isArray(value))for(const item of value)collect(item,key);
    else if(value&&typeof value==='object'){
      if(value.legal===true&&/^[a-i][0-9][a-i][0-9]$/.test(value.attempt||''))moves.add(value.attempt);
      for(const [name,item]of Object.entries(value))if(!(name==='move'&&value.verdict==='illegal'))collect(item,name);
    }
  }
  collect(walkthrough.steps,'steps');return [...moves];
}

export function walkthroughRejectedMoves(walkthrough) {
  const moves=new Set();
  function collect(value){
    if(!value||typeof value!=='object')return;
    const move=value.legal===false?value.attempt:value.verdict==='illegal'?value.move:null;
    if(/^[a-i][0-9][a-i][0-9]$/.test(move||''))moves.add(move);
    for(const item of Object.values(value))if(item&&typeof item==='object')collect(item);
  }
  collect(walkthrough.steps);return [...moves];
}

export const DETAILED_SCHEMA = `必须返回完整 JSON：move、observation、reason、practice、evidenceIds、steps 和 summary。steps 每项为 {id,move,observation,reason,consequence,evidenceIds,alternatives:[{id,explanation}],responses:[{id,explanation}]}。所有步骤按给定顺序逐一覆盖，id/move 原样保留；alternatives 和 responses 分别按给定 id 全部覆盖，不得漏项或互换；程序按编号定位，不依赖返回数组顺序。其他走法与对方应对的解释可以对照当前步骤给定的主着和变化，不能引用工具未给出的着法。
每步 reason 用100–250字（至少60字）说明具体棋子、起终点、目的和成立条件，至少点明该步坐标或完整记谱；observation 与 consequence 各至少20字。responses 每条至少40字，点名对方实际应对，并说明这步化解了什么或改变了什么、给定后续导致的局面。每条 alternative 至少40字，说明具体差别和工具提供的后续；没有独立评估不能判败着。
summary 至少80字，以“胜负结论：”加 walkthrough.result.label 开头，交代 result.basis 和取胜或未定的原因。不能把演示胜线当成强制结果，不能把未搜到将杀写成和棋。
只引用工具给定棋谱、事实和分值。JSON 示例结构：{"move":"给定candidateMove","observation":"具体局面","reason":"具体走法的目的与条件","practice":"下一步建议","evidenceIds":["给定编号"],"steps":[{"id":"S1","move":"原样","observation":"具体问题","reason":"因果解释","consequence":"具体变化","evidenceIds":["S1"],"alternatives":[{"id":"给定变化id","explanation":"比较"}],"responses":[{"id":"给定应对id","explanation":"若对方如此应对，则局面怎样改变"}]}],"summary":"胜负结论：给定label。依据与思路"}。`;

export function inspectDetailedResponse(data, walkthrough, allowedEvidence) {
  const issues=[];
  const reject=(kind,field,details={})=>issues.push(invalidCoachAnswer(kind,field,details).validationIssue);
  const text=(value,field,stepId,max=2400,min=1,branchId)=>{
    if(typeof value!=='string'||value.trim().length<min||value.length>max){
      reject('text',field,{stepId,branchId});return typeof value==='string'?value.trim():'';
    }
    return value.trim();
  };
  const checkMoves=(value,moves,rejected,field,stepId,branchId)=>{
    const move=unverifiedCoachMove(value,moves,rejected);
    if(move)reject('coordinate',field,{stepId,branchId,move});
    return value;
  };
  const ordered=(items,expected,field,stepId)=>{
    if(items==null&&expected.length===0)return [];
    if(!Array.isArray(items)||items.length!==expected.length)reject('coverage',field,{stepId,expected:expected.length,actual:Array.isArray(items)?items.length:0});
    const byId=new Map(),ids=new Set(expected.map(item=>item.id));
    for(const item of Array.isArray(items)?items:[]){
      if(!item||!ids.has(item.id)||byId.has(item.id)){reject('identity',field,{stepId});continue;}
      byId.set(item.id,item);
    }
    return expected.map(item=>byId.get(item.id));
  };
  const supplied=ordered(data?.steps,walkthrough.steps,'steps');
  const steps=walkthrough.steps.map((step,index)=>{
    const item=supplied[index],stepId=step.id;
    if(!item)return step;
    if(item.move!==step.move)reject('move','move',{stepId});
    const current={steps:[step]},allowed=[...walkthroughMoves(current),...walkthrough.steps.slice(index+1).map(p=>p.move)],rejected=walkthroughRejectedMoves(current);
    const evidenceIds=item.evidenceIds;
    if(!Array.isArray(evidenceIds)||!evidenceIds.includes(stepId)||evidenceIds.some(id=>!allowedEvidence.includes(id)))reject('evidence','evidenceIds',{stepId});
    const read=(value,field,min,branchId)=>checkMoves(text(value,field,stepId,2400,min,branchId),allowed,rejected,field,stepId,branchId);
    const reason=read(item.reason,'reason',60);
    if(['这一步已经通过走法和帅将安全检查','先在棋盘上找到起点和终点','规则说明尚未评价'].some(phrase=>reason.includes(phrase)))reject('filler','reason',{stepId});
    if(![step.notation,step.move.slice(0,2),step.move.slice(2)].some(anchor=>reason.includes(anchor)))reject('anchor','reason',{stepId});
    const givenAlternatives=ordered(item.alternatives,step.alternatives,'alternatives',stepId);
    const alternatives=step.alternatives.map((branch,n)=>givenAlternatives[n]?{
      ...branch,explanation:read(givenAlternatives[n].explanation,'alternatives',40,branch.id)
    }:branch);
    const givenResponses=ordered(item.responses,step.responses,'responses',stepId);
    const responses=step.responses.map((reply,n)=>{
      if(!givenResponses[n])return reply;
      const explanation=read(givenResponses[n].explanation,'responses',40,reply.id);
      if(![reply.move,reply.notation,reply.move.slice(0,2),reply.move.slice(2)].some(anchor=>explanation.includes(anchor)))reject('anchor','responses',{stepId,branchId:reply.id});
      return {...reply,explanation};
    });
    return {...step,responses,observation:read(item.observation,'observation',20),reason,consequence:read(item.consequence,'consequence',20),evidenceIds:Array.isArray(evidenceIds)?[...new Set(evidenceIds)]:[],alternatives};
  });
  const summary=checkMoves(text(data.summary,'summary',undefined,4000,80),walkthroughMoves(walkthrough),walkthroughRejectedMoves(walkthrough),'summary').replace(/^胜负结论\s*[:：]\s*/,'胜负结论：');
  if(!summary.startsWith('胜负结论：'+walkthrough.result.label))reject('result','summary');
  return {issues,walkthrough:{...walkthrough,teachingSource:'model',steps,summary}};
}

export function validateDetailedResponse(data, walkthrough, allowedEvidence) {
  const result=inspectDetailedResponse(data,walkthrough,allowedEvidence);
  if(result.issues.length){const issue=result.issues[0];throw invalidCoachAnswer(issue.kind,issue.field,issue);}
  return result.walkthrough;
}
