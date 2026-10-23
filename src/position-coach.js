import { resolveModelConfig, buildCompletionBody, requestCompletion } from './model-client.js';
import { validateCoachResponse } from './coach.js';
import { KNOWLEDGE } from './knowledge.js';

export async function explainImportedPosition(report, settings, fetchImpl = fetch) {
  if (!report.recommendation) throw Object.assign(new Error('当前没有可验证的推荐线路，暂不能生成解法讲解。'), { status: 400 });
  const config = resolveModelConfig(settings), started = Date.now();
  const messages = [
    { role: 'system', content: '你是象棋残局教学助手。只解释工具提供的局面与线路，不能自由编造解法。proven 才能称为已证明的短连续将杀；其他结果只能称引擎参考，不能称必胜或和棋。engine 为 null 不得声称使用了引擎；mate 评分可能包含困毙，必须根据实际 outcome 区分。返回 JSON：{"move":"recommendation字段原值","observation":"一句观察","reason":"最多180字解释","practice":"一句建议","evidenceIds":["I1"]}。只引用给定证据编号和坐标着法。结构校验不代表完整语义正确。' },
    { role: 'user', content: JSON.stringify({ fen: report.fen, recommendation: report.recommendation, proof: { status: report.proof.status, maxMoves: report.proof.maxMoves }, engine: report.engine, line: report.line, evidence: report.evidence, knowledge: KNOWLEDGE.map(({id,title,text}) => ({id,title,text})) }) }
  ];
  const payload = await requestCompletion(config, buildCompletionBody(config, messages, 1400), fetchImpl);
  let content;
  try {
    if (payload.choices?.[0]?.finish_reason === 'length') throw new Error();
    content = validateCoachResponse(payload.choices?.[0]?.message?.content, report.recommendation, report.evidence.map(item => item.id), [...new Set([...report.line.map(item => item.move), ...(report.engine?.pv || [])])]);
  } catch { throw Object.assign(new Error('AI 讲解未通过输出校验，请重试；已核验的解法和线路仍保留。'), { status: 502, code: 'MODEL_IMPORT_RESPONSE_INVALID' }); }
  return { source: 'model', model: config.model, ...content, elapsedMs: Date.now() - started, semanticReview: '已检查结构、坐标与证据编号；自然语言解释仍需结合棋盘审阅。' };
}
