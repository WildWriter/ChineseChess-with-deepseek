import { replayLine } from './walkthrough.js';
import { positionFacts } from './position-facts.js';

const sideName=turn=>turn==='w'?'红方':'黑方';
function evaluationText(entry,turn){
  if(!entry?.score)return '本次搜索没有独立分值。';
  const {type,value,bound}=entry.score;
  return `Pikafish 深度 ${entry.depth}，${sideName(turn)}视角${type==='cp'?'分值':'胜负距离'} ${value}${bound?'（区间界限，不能直接相减）':''}；有限搜索参考，零分不是和棋证明。`;
}
function lineFacts(fen,tokens){
  const line=replayLine(fen,tokens.slice(0,12)),end=line.at(-1);
  return {line,end:end?positionFacts(end.afterFen):positionFacts(fen),captures:line.filter(p=>p.captured!=='.').map(p=>({side:p.side,piece:p.captured,square:p.move.slice(2),move:p.move})),outcome:end?.outcome||null};
}

// This is evidence collection, not language generation. Every returned PV is
// replayed against the rules; scores compared below share the same root/side.
export async function enrichTeaching(walkthrough,compare){
  const result=structuredClone(walkthrough); result.teachingSource='rules';
  if(!compare||!result.steps.length)return result;
  let successful=0;
  for(const step of result.steps){
    try{
      const candidates=[step.move,...step.alternatives.filter(v=>v.verdict!=='illegal').map(v=>v.move)].slice(0,4);
      const analysis=await compare(step.beforeFen,candidates,220),entries=analysis.variations||[];
      const main=entries.find(v=>v.move===step.move);
      step.comparison={source:'Pikafish',rootFen:step.beforeFen,perspective:step.turn,main:main||null,scope:'同一走前局面的代表性候选比较，未穷举其他走法；只比较同类型且非界限分值。'};
      if(main)step.comparison.mainContinuation=lineFacts(step.beforeFen,main.pv);
      for(const branch of step.alternatives){
        const entry=entries.find(v=>v.move===branch.move);if(!entry||branch.verdict==='illegal')continue;
        const keepProof=['correct','defence'].includes(branch.verdict),facts=lineFacts(step.beforeFen,keepProof?branch.line.map(p=>p.move):entry.pv);
        const {pv,...scoreInfo}=entry;
        branch.line=facts.line;branch.assessment={...scoreInfo,perspective:step.turn,deltaVsMain:main?.score?.type==='cp'&&entry.score?.type==='cp'&&!main.score.bound&&!entry.score.bound&&main.depth===entry.depth?entry.score.value-main.score.value:null,end:facts.end,captures:facts.captures,outcome:facts.outcome};
        const goalNote=keepProof?branch.explanation:branch.verdict==='misses-goal'?'这步合法，但未完成限定题目目标；这项判定不代表实战必输。':branch.verdict==='unproven'?'限定目标尚未证实；以下另给出有限引擎搜索的参考。':'这是另一种合法走法，以下比较只针对本次有限搜索。';
        branch.explanation=`${goalNote} ${evaluationText(entry,step.turn)}${branch.assessment.deltaVsMain!==null?'同一根局面下比主着'+(branch.assessment.deltaVsMain>=0?'高':'低')+Math.abs(branch.assessment.deltaVsMain)+' 分；这不是完整胜负裁定。':''} 后续按实际对手应对展开：${facts.line.map(p=>p.side+p.notation+'（'+p.move+'）').join('，')}。`;
      }
      if(step.replyCount){
        const replies=await compare(step.afterFen,[],220),opponent=step.turn==='w'?'b':'w';
        const available=(replies.variations||[]).filter(v=>v.pv?.length),old=step.responses;
        const selected=[];
        if(old[0])selected.push(old[0]);
        for(const entry of available){
          const known=selected.find(r=>r.move===entry.move),facts=lineFacts(step.afterFen,entry.pv),first=facts.line[0];
          const reply=known||{move:entry.move,notation:first.notation,side:first.side,proofStatus:'unproven'};
          if(reply.proofStatus==='win'){
            const {pv,...scoreInfo}=entry;reply.assessment={...scoreInfo,perspective:opponent};
          }else Object.assign(reply,{line:facts.line,facts:positionFacts(first.afterFen),source:'engine-reference',assessment:{...entry,perspective:opponent,end:facts.end,captures:facts.captures,outcome:facts.outcome},explanation:`若对方${first.notation}（${first.move}），${first.captured==='.'?'这步不吃子。':'吃掉落点的棋子。'}${evaluationText(entry,opponent)}实际参考变化为：${facts.line.map(p=>p.side+p.notation+'（'+p.move+'）').join('，')}。${facts.outcome?.state!=='playing'?'本条变化末尾为'+facts.outcome?.reason+'。':'参考线路末尾仍可继续行棋，须解释双方实际子力和进攻点的变化，不能凭此断言整盘结果。'}`});
          if(!known&&selected.length<3)selected.push(reply);
        }
        for(const oldReply of old)if(selected.length<3&&!selected.some(r=>r.move===oldReply.move))selected.push(oldReply);
        step.responses=selected.map((r,n)=>({...r,id:step.id+'R'+(n+1)}));
        step.responsesNote=`对方有 ${step.replyCount} 个合法应对；这里结合原主线与引擎候选展示 ${step.responses.length} 条变化。每条分值属于对方行棋视角，不能与上一步分值直接相减。`;
      }
      successful++;
    }catch{step.comparison={source:'unavailable',scope:'本步变化比较暂不可用，不据此评判优劣。'};}
  }
  result.analysisCoverage={evaluated:successful,total:result.steps.length};
  return result;
}
