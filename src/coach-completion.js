import { createHmac, randomBytes } from 'node:crypto';
import { buildAnalysisBody, requestCompletion } from './model-client.js';
import { parseCoachAnswer, invalidCoachAnswer, inspectCoachResponse, coachContentPolicy } from './coach-validation.js';
import { inspectDetailedResponse, walkthroughRejectedMoves } from './walkthrough.js';
import { COACH_PROMPT_VERSION } from './coach-prompt.js';

// Short-lived failed drafts only. No credentials, raw provider bodies, reasoning
// content, or disk storage. A keyed digest isolates users, models and positions.
const salt = randomBytes(32), drafts = new Map(), ttl = 10 * 60 * 1000;
const token = target => [target.stepId || '', target.field, target.id || ''].join('/');
const coverage = walk => walk.steps.map(s => ({ id:s.id, move:s.move, alternatives:s.alternatives.map(v=>v.id), responses:s.responses.map(r=>r.id) }));
function cacheKey(config, identity) {
  return createHmac('sha256', salt).update(JSON.stringify([config.apiKey, config.model, COACH_PROMPT_VERSION, identity])).digest('hex');
}
function trimCache() {
  for (const [key,value] of drafts) if (value.expires <= Date.now()) drafts.delete(key);
  while (drafts.size > 8) drafts.delete(drafts.keys().next().value);
}
function projectDraft(data) {
  const pick = (value, names) => Object.fromEntries(names.filter(k => Object.hasOwn(value || {},k)).map(k => [k,value[k]]));
  const result = pick(data,['move','observation','reason','practice','evidenceIds','summary']);
  if (Array.isArray(data.steps)) result.steps = data.steps.map(step => {
    const item = pick(step,['id','move','observation','reason','consequence','evidenceIds']);
    for (const field of ['alternatives','responses']) if (Array.isArray(step?.[field])) item[field] = step[field].map(branch=>pick(branch,['id','explanation']));
    return item;
  });
  return result;
}
function repairPlan(data, task, issues) {
  const steps = task.walkthrough.steps, given = data.steps;
  if (!Array.isArray(given) || given.length > steps.length) return [];
  const known = new Set(steps.map(s=>s.id)), seen = new Set(), targets = [];
  const add = target => { if (!targets.some(t=>token(t)===token(target))) targets.push(target); };
  for (const s of given) {
    if (!known.has(s?.id) || seen.has(s.id)) return [];
    seen.add(s.id);
  }
  for (const step of steps) {
    const item = given.find(s=>s.id===step.id);
    if (!item) { add({stepId:step.id,field:'steps'}); continue; }
    for (const field of ['alternatives','responses']) {
      const supplied = item[field] || [], expected = step[field];
      if (!Array.isArray(supplied) || supplied.length > expected.length) return [];
      const ids = new Set();
      for (const b of supplied) {
        if (!expected.some(e=>e.id===b?.id) || ids.has(b.id)) return [];
        ids.add(b.id);
      }
      for (const b of expected) if (!ids.has(b.id)) add({stepId:step.id,field,id:b.id});
    }
  }
  for (const issue of issues) {
    if (issue.stepId) {
      if (targets.some(t=>t.stepId===issue.stepId&&t.field==='steps')) continue;
      const step=steps.find(s=>s.id===issue.stepId);
      if (!step) return [];
      if (['alternatives','responses'].includes(issue.field)) {
        // Missing entries alone do not require rewriting existing entries.
        if (issue.kind!=='coverage') {
          for (const branch of step[issue.field]) {
            if (!issue.branchId||branch.id===issue.branchId) add({stepId:step.id,field:issue.field,id:branch.id});
          }
        }
      } else if (['move','observation','reason','consequence','evidenceIds'].includes(issue.field)) {
        add({stepId:step.id,field:issue.field});
      }
    } else if (issue.field==='overview') {
      for (const field of ['observation','reason','practice']) {
        if (!issue.targetField||field===issue.targetField) add({field});
      }
    } else if (['move','evidenceIds','summary'].includes(issue.field)) {
      add({field:issue.field});
    }
  }
  return targets;
}
function validate(data, task) {
  const top=inspectCoachResponse(data,task.expectedMove,task.evidenceIds,task.allowedMoves,walkthroughRejectedMoves(task.walkthrough));
  const detailed=inspectDetailedResponse(data,task.walkthrough,task.evidenceIds),issues=[...top.issues,...detailed.issues];
  const policy=coachContentPolicy(data,task.walkthrough,issues);
  if(policy.blocking.length){const first=policy.blocking[0];throw Object.assign(invalidCoachAnswer(first.kind,first.field,first),{validationIssues:policy.blocking});}
  return {...top.content,move:task.expectedMove,...(data.move!==task.expectedMove?{modelMove:data.move}:{}),
    validationMode:'advisory',validationWarnings:policy.validationWarnings,semanticReview:policy.semanticReview,
    walkthrough:{...detailed.walkthrough,validationMode:'advisory',validationWarnings:policy.validationWarnings}};
}
function repairMessages(system, pending) {
  const {task,targets,draft} = pending;
  const relevant = new Set(targets.map(t=>t.stepId).filter(Boolean));
  const context = {
    repair:true, candidateMove:task.expectedMove, evidenceIds:task.evidenceIds,
    requiredRepairs:targets, repairIssues:pending.issues, requiredCoverage:coverage(task.walkthrough),
    walkthrough:{...task.walkthrough,steps:task.walkthrough.steps.filter(s=>!relevant.size||relevant.has(s.id))},
    existing:projectDraft({...draft,steps:draft.steps.filter(s=>!relevant.size||relevant.has(s.id))})
  };
  return [
    {role:'system',content:system+'\n本次是局部补写模式，覆盖前面的整份输出格式要求：只返回 {"patches":[{"stepId":"给定时原样","field":"给定字段","id":"给定时原样","value":"补写内容"}]}。requiredRepairs 每项恰好一条，不要重复其他字段。分支 value 是至少40字的解释并点明对应应对；reason 至少60字；steps 的 value 是该编号完整的步骤对象；evidenceIds 的 value 是编号数组。其余详细程度、合法线路和胜负依据要求不变。保留已有内容，只修正或补写指定部分。'},
    {role:'user',content:JSON.stringify(context)}
  ];
}
function mergeRepair(pending, data) {
  if (!Array.isArray(data.patches) || data.patches.length!==pending.targets.length) throw invalidCoachAnswer('coverage','response',{expected:pending.targets.length,actual:data.patches?.length||0});
  const seen = new Set(), draft = structuredClone(pending.draft);
  for (const patch of data.patches) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw invalidCoachAnswer('format','response');
    const key = token(patch), target = pending.targets.find(t=>token(t)===key);
    if (!target || seen.has(key)) throw invalidCoachAnswer('identity','response');
    seen.add(key);
    if (target.field==='steps') {
      if (patch.value?.id!==target.stepId) throw invalidCoachAnswer('identity','steps',{stepId:target.stepId});
      draft.steps.push(patch.value);
    } else {
      const object = target.stepId ? draft.steps.find(s=>s.id===target.stepId) : draft;
      if (target.id) {
        const list = object[target.field] ||= [], existing = list.find(b=>b.id===target.id);
        if (existing) existing.explanation = patch.value;
        else list.push({id:target.id,explanation:patch.value});
      } else object[target.field] = patch.value;
    }
  }
  return projectDraft(draft);
}

// Exactly one provider call per user action. A later explicit retry fills only
// the missing/invalid section, using the original verified evidence and draft.
export async function requestDetailedCoach({config,identity,messages,task,fetchImpl=fetch}) {
  trimCache();
  const key = cacheKey(config,identity), pending = drafts.get(key);
  if (pending) task = pending.task;
  const requestMessages = pending ? repairMessages(messages[0].content,pending) : messages.map((m,index)=>index===1?{...m,content:JSON.stringify({...JSON.parse(m.content),requiredCoverage:coverage(task.walkthrough)})}:m);
  const payload = await requestCompletion(config,buildAnalysisBody(config,requestMessages,task.walkthrough.steps.length),fetchImpl,120000);
  let data;
  try {
    if (payload.choices?.[0]?.finish_reason==='length') throw invalidCoachAnswer('truncated','response');
    const raw = payload.choices?.[0]?.message?.content;
    if (typeof raw==='string' && raw.length>300000) throw invalidCoachAnswer('format','response');
    const parsed = parseCoachAnswer(raw);
    data = pending ? mergeRepair(pending,parsed) : projectDraft(parsed);
    const content = validate(data,task);
    drafts.delete(key);
    return {content,payload,task,repaired:Boolean(pending)};
  } catch (error) {
    // Cache only bounded structured drafts with a repairable, exact ID plan.
    // Bad patch envelopes never replace or corrupt an earlier useful draft.
    const targets = data && error.validationIssue ? repairPlan(data,task,error.validationIssues||[error.validationIssue]) : [];
    if (targets.length && JSON.stringify(data).length<=300000) {
      drafts.delete(key);
      drafts.set(key,{draft:data,task,targets,issues:error.validationIssues||[error.validationIssue],expires:Date.now()+ttl});
      trimCache();
    }
    const saved = drafts.get(key);
    if (saved) error.repairCount = saved.targets.length;
    error.coachPayload = {choices:[{finish_reason:payload.choices?.[0]?.finish_reason}]};
    throw error;
  }
}
