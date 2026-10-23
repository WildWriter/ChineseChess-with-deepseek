const labels={
  format:'返回的 JSON 格式无效',empty:'没有返回讲解正文',truncated:'输出达到长度上限，被截断',
  move:'讲解着法与指定着法不一致',text:'讲解字段缺失、过短或过长',evidence:'证据编号不匹配',
  coverage:'步骤或变化没有完整覆盖',identity:'步骤或变化编号重复、缺失或不匹配',
  coordinate:'引用了工具未提供的着法',anchor:'没有点明当前着法',filler:'原因仅复述了规则占位说明',
  result:'总结的胜负结论与核验结果不符'
};
const fields={response:'模型回复',move:'总览着法',overview:'总览',evidenceIds:'证据',steps:'步骤',observation:'观察',reason:'原因',consequence:'走后结果',alternatives:'其他走法',responses:'对方应对',summary:'总结'};
const advisoryKinds=new Set(['move','evidence','coordinate','anchor','filler','result']);

// Prose inconsistencies are advisory. Structural problems must still be
// rejected because the UI needs complete text and stable step/branch IDs.
export function coachContentPolicy(data,walkthrough,issues){
  const malformedEvidence=value=>!Array.isArray(value)||value.some(id=>typeof id!=='string'||id.length>100);
  const malformedMove=value=>typeof value!=='string'||!/^[a-i][0-9][a-i][0-9]$/i.test(value);
  const blocking=[],warnings=[];
  for(const issue of issues){
    const item=issue.stepId?(Array.isArray(data.steps)?data.steps.find(step=>step?.id===issue.stepId):undefined):data;
    const unsafeShape=issue.kind==='evidence'&&malformedEvidence(item?.evidenceIds)||issue.kind==='move'&&malformedMove(item?.move);
    const branch=issue.branchId&&item?.[issue.field]?.find?.(value=>value?.id===issue.branchId);
    const value=branch?branch.explanation:issue.field==='overview'?data[issue.targetField]:item?.[issue.field];
    const readableShortText=issue.kind==='text'&&typeof value==='string'&&value.trim().length>0&&value.length<=(issue.stepId?2400:4000);
    ((advisoryKinds.has(issue.kind)&&!unsafeShape)||readableShortText?warnings:blocking).push(issue);
  }
  const validationWarnings=warnings.map(issue=>({
    ...invalidCoachAnswer(issue.kind,issue.field,issue).validationIssue,
    message:(issue.stepId?'第 '+Number(issue.stepId.slice(1))+' 步 · ':'')+fields[issue.field]+'：'+(issue.kind==='text'?'文字比提示词要求简短，按原文显示':labels[issue.kind])+(issue.move?'（'+issue.move+'）':'')
  }));
  return {blocking,validationWarnings,semanticReview:validationWarnings.length
    ?'讲解按模型原文显示；有 '+validationWarnings.length+' 项内容一致性提醒，未作为拦截条件。棋盘和可回放线路仍使用本地核验数据。'
    :'已检查可展示结构；内容一致性采用提醒模式，AI 文字仍需结合棋盘判断。'};
}
export function invalidCoachAnswer(kind,field,details={}){
  const issue={kind:Object.hasOwn(labels,kind)?kind:'format',field:Object.hasOwn(fields,field)?field:'response'};
  if(/^S\d{1,2}$/.test(details.stepId||''))issue.stepId=details.stepId;
  for(const key of ['expected','actual'])if(Number.isInteger(details[key])&&details[key]>=0&&details[key]<=1000)issue[key]=details[key];
  if(/^[a-i][0-9][a-i][0-9]$/.test(details.move||''))issue.move=details.move;
  if(/^S\d{1,2}[RV]\d{1,2}$/.test(details.branchId||''))issue.branchId=details.branchId;
  if(['observation','reason','practice'].includes(details.targetField))issue.targetField=details.targetField;
  return Object.assign(new Error(labels[issue.kind]),{validationIssue:issue});
}
export function coachAnswerFailure(error,payload,code,prefix='DS 讲解未通过校验'){
  const known=error?.validationIssue;
  const issue=payload?.choices?.[0]?.finish_reason==='length'?invalidCoachAnswer('truncated','response').validationIssue:
    known&&Object.hasOwn(labels,known.kind)?invalidCoachAnswer(known.kind,known.field,known).validationIssue:
    invalidCoachAnswer('format','response').validationIssue;
  const location=(issue.stepId?'第 '+Number(issue.stepId.slice(1))+' 步（'+issue.stepId+'）· ':'')+fields[issue.field];
  const count=issue.expected!==undefined?'（应有 '+issue.expected+' 项'+(issue.actual!==undefined?'，收到 '+issue.actual+' 项':'')+'）':'';
  const token=issue.move?'（'+issue.move+'）':'';
  const issues=(error?.validationIssues||[issue]).slice(0,200).map(value=>invalidCoachAnswer(value.kind,value.field,value).validationIssue);
  const additional=issues.length>1?'本次共发现 '+issues.length+' 处校验问题，已一并检查。':'';
  const repair=Number.isInteger(error?.repairCount)&&error.repairCount>0&&error.repairCount<=200?'已暂存本次讲解草稿；10 分钟内再次点击仅补写 '+error.repairCount+' 个缺失或有误的部分（1 次调用），通过完整校验后显示。':'';
  return Object.assign(new Error(prefix+'：'+location+'，'+labels[issue.kind]+count+token+'。'+additional+'当前棋盘和本地分析仍保留。'+repair),{status:502,code,validationIssue:issue,validationIssues:issues});
}
export function parseCoachAnswer(raw){
  if(typeof raw!=='string'||!raw.trim())throw invalidCoachAnswer('empty','response');
  let data;
  try{data=JSON.parse(raw.trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,''));}
  catch{throw invalidCoachAnswer('format','response');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw invalidCoachAnswer('format','response');
  return data;
}

export function validateCoachResponse(raw, expectedMove, evidenceIds, allowedMoves = [expectedMove], rejectedMoves=[]) {
  const result=inspectCoachResponse(parseCoachAnswer(raw),expectedMove,evidenceIds,allowedMoves,rejectedMoves);
  if(result.issues.length){const issue=result.issues[0];throw invalidCoachAnswer(issue.kind,issue.field,issue);}
  return result.content;
}

// A verified forbidden attempt is useful teaching evidence, not an executable
// move. It is accepted in prose only when locally framed as a negative example.
export function unverifiedCoachMove(value, allowedMoves, rejectedMoves = []) {
  for (const match of value.matchAll(/[a-i][0-9][a-i][0-9]/gi)) {
    const move=match[0].toLowerCase();if(allowedMoves.includes(move))continue;
    if(rejectedMoves.includes(move)){
      const before=value.slice(Math.max(0,match.index-35),match.index);
      const after=value.slice(match.index+4,match.index+65);
      const negatedBefore=/(?:不能|不可|不可以|无法|不允许|不应|禁止|不要)(?:(?:直接|再|继续|尝试|选择|走|走出|走到|采用|推荐|执行)|[\s：:（(“"‘])*$|不合法的?\s*$/.test(before);
      const negatedAfter=/^[\s）)】”"’]*[，,:：]?\s*(?:(?:这|此)(?:一|种|个)?(?:步|着|走法)|在当前局面|当前|并|也|是|属于|则|会)?\s*(?:不能(?:走|执行|成立|通过|作为|用于|这么走|这样走)|不可(?:走|执行|行|作为)|不可以(?:走|执行)|无法(?:走|执行|通过)|不合法|不允许(?:走|执行)|走不了|走不通|非法|走不成|不成立|受阻|被.{0,12}(?:挡住|占据))/.test(after);
      if(negatedBefore||negatedAfter)continue;
    }
    return move;
  }
  return null;
}

export function inspectCoachResponse(data, expectedMove, evidenceIds, allowedMoves, rejectedMoves=[]) {
  const issues=[],reject=(kind,field,details={})=>issues.push(invalidCoachAnswer(kind,field,details).validationIssue);
  if(data.move!==expectedMove)reject('move','move');
  for(const field of ['observation','reason','practice']){
    const value=data[field];
    if(typeof value!=='string'||!value.trim()||value.length>4000)reject('text','overview',{targetField:field});
    else {const move=unverifiedCoachMove(value,allowedMoves,rejectedMoves);if(move)reject('coordinate','overview',{targetField:field,move});}
  }
  if(!Array.isArray(data.evidenceIds)||!data.evidenceIds.length||data.evidenceIds.some(id=>!evidenceIds.includes(id)))reject('evidence','evidenceIds');
  return {issues,content:{move:data.move,observation:data.observation?.trim?.(),reason:data.reason?.trim?.(),practice:data.practice?.trim?.(),evidenceIds:Array.isArray(data.evidenceIds)?[...new Set(data.evidenceIds)]:[]}};
}
