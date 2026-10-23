import { findPuzzle } from './puzzles.js';
import { getLesson } from './training.js';
import { validatePV } from './engine.js';
import { resolveModelConfig, buildCompletionBody, requestCompletion } from './model-client.js';

export function buildMessages(id, move, mode = 'customized', engine = null, history=[]) {
  const puzzle = findPuzzle(id);
  const lesson = getLesson(id, move, history);
  const common = { fen: lesson.fen || puzzle.fen, task: lesson.task || puzzle.objective, candidateMove: lesson.move, notation: lesson.notation, evidence: lesson.evidence, exerciseCompleteAfterCandidate: lesson.complete ?? lesson.correct, engine };
  const schema = '只返回 JSON：{"move":"给定候选着法","observation":"一句局面观察","reason":"最多150字解释","practice":"一句练习建议","evidenceIds":["E1"]}。不要编造其他着法、坐标或棋子；不能把引擎评分说成胜率；只讨论给定证据能支持的结论。engine 为 null 时不得声称使用了引擎分析或给出引擎评分。连续将杀的正确中间着法不等于已经绝杀；exerciseCompleteAfterCandidate 为 false 时不得声称已经通关或黑方无路可走。';
  const system = mode === 'customized'
    ? `你是面向象棋初学者的战术学习助手。先核对规则证据，再引用相关知识，解释指定训练目标。教案是参考，若选择了其他正确着法，必须解释实际候选着法而不能照抄教案。引用证据编号，区分将军、绝杀与困毙，承认多个正确应将。引擎的推荐着法可能与题目候选着法不同，不能将原局面的引擎评分移用于候选着法；引擎 mate 分值也不单独证明正在将军。${schema}`
    : `你是中国象棋助手，请分析给定局面、候选着法和相同的规则/引擎信息。${schema}`;
  const context = mode === 'customized' ? { ...common, knowledge: lesson.knowledge, teachingExample: puzzle.lesson, learningGoal: puzzle.reflection } : common;
  return [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(context) }];
}

export function validateCoachResponse(raw, expectedMove, evidenceIds, allowedMoves = [expectedMove]) {
  const clean = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(clean);
  if (data.move !== expectedMove) throw new Error('候选着法不一致');
  for (const key of ['observation', 'reason', 'practice']) {
    if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > 700) throw new Error('输出字段无效');
  }
  if (!Array.isArray(data.evidenceIds) || !data.evidenceIds.length || data.evidenceIds.some(id => !evidenceIds.includes(id))) throw new Error('证据编号无效');
  const text = `${data.observation} ${data.reason} ${data.practice}`;
  for (const token of text.match(/[a-i][0-9][a-i][0-9]/g) || []) if (!allowedMoves.includes(token)) throw new Error('出现未提供的坐标着法');
  return { move: data.move, observation: data.observation.trim(), reason: data.reason.trim(), practice: data.practice.trim(), evidenceIds: [...new Set(data.evidenceIds)] };
}

export async function generateCoach(id, move, mode = 'customized', engine = null, fetchImpl = fetch, settings, history=[]) {
  const config = resolveModelConfig(settings);
  const lesson = getLesson(id, move, history);
  const requestBody = buildCompletionBody(config, buildMessages(id, lesson.move, mode, engine, history));
  const started = Date.now();
  const payload = await requestCompletion(config, requestBody, fetchImpl);
  const finishReason = payload.choices?.[0]?.finish_reason ?? null;
  const usage = payload.usage ?? null;
  if (finishReason === 'length') return { source: 'lesson-fallback', validation: 'truncated', message: '模型输出达到长度上限，已切换为完整教案。', lesson, elapsedMs: Date.now() - started, finishReason, usage };
  let content;
  const positionFen=lesson.fen || findPuzzle(id).fen;
  const engineMoves = engine ? validatePV(positionFen, Array.isArray(engine.pv) ? engine.pv : []) : [];
  const engineBest = engine?.bestMove ? validatePV(positionFen, [engine.bestMove]) : [];
  // A response may contrast the lesson move with a DIFFERENT provided engine
  // recommendation. Permit only those tool-supplied, legally verified moves;
  // the structured answer must still equal the exercise candidate.
  const allowedMoves = [...new Set([lesson.move, ...engineMoves, ...engineBest])];
  try { content = validateCoachResponse(payload.choices?.[0]?.message?.content, lesson.move, lesson.evidence.map(item => item.id), allowedMoves); }
  catch { return { source: 'lesson-fallback', validation: 'rejected', message: '模型结果未通过结构、坐标或引用校验，已切换为教案。', lesson, elapsedMs: Date.now() - started, finishReason, usage }; }
  return { source: 'model', validation: 'schema-uci-and-citation-ids-checked', semanticReview: '已检查结构、UCI 着法与引用编号；自然语言的战术解释仍需结合证据审阅。', mode, model: config.model, ...content, evidence: lesson.evidence, knowledge: mode === 'customized' ? lesson.knowledge : [], usage, finishReason, elapsedMs: Date.now() - started };
}
