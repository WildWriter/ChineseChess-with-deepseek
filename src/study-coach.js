import { COACH_ANALYSIS_PROMPT, COACH_PROMPT_VERSION } from './coach-prompt.js';
import { validateImportedPosition } from './imported-position.js';
import { replayLine, buildWalkthrough, DETAILED_SCHEMA, walkthroughMoves } from './walkthrough.js';
import { parseFen, generateLegalMoves, moveToUci } from '../public/vendor/xiangqi.js';
import { resolveModelConfig } from './model-client.js';
import { requestDetailedCoach } from './coach-completion.js';
import { enrichTeaching } from './teaching-analysis.js';
import { coachAnswerFailure } from './coach-validation.js';

export function studyPosition(baseFen, moves = []) {
  const base = validateImportedPosition(baseFen);
  if (!Array.isArray(moves) || moves.length > 80 || moves.some(move => typeof move !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(move))) throw Object.assign(new Error('摆谱记录无效，最多保留 80 步。'), { status: 400 });
  let line;
  try { line = replayLine(base.fen, moves); }
  catch { throw Object.assign(new Error('摆谱包含非法走法或局面结束后的步骤，请悔棋后重试。'), { status: 400 }); }
  return { baseFen: base.fen, moves: [...moves], playedLine: line, fen: line.at(-1)?.afterFen || base.fen };
}

export async function explainStudy(position, report, settings, fetchImpl = fetch, compare=null) {
  const config = resolveModelConfig(settings), started = Date.now();
  const last = position.playedLine.at(-1), current = parseFen(position.fen);
  const sample = !report.recommendation && !last ? generateLegalMoves(current.board, current.turn)[0] : null;
  const tokens = [...(last ? [last.move] : []), ...report.line.slice(0, 4).map(item => item.move), ...(sample ? [moveToUci(sample)] : [])];
  const walkthrough = await enrichTeaching(buildWalkthrough({ fen: last?.beforeFen || position.fen, moves: tokens, result:report.result, goal: 'reference', task: '自由摆谱：解释实际走法和当前应对，不受原题步数或连续将军要求限制', summary: `${last ? `先复盘刚才实际走出的${last.notation}，再观察当前行棋方如何应对。` : '先观察当前局面的帅将安全，再比较可行走法。'}${report.conclusion}${sample ? '演示着法只是合法示例，不是引擎推荐。' : ''}自由摆谱不计入题目通关；变化没有独立棋力评估时，不能据此判断优劣。` }),compare);
  if (!walkthrough.steps.length) return { source: 'rules', message: report.conclusion, walkthrough, analysis: report, positionFen: position.fen, moves: position.moves };
  const evidence = [...report.evidence, ...walkthrough.evidence];
  const messages = [
    { role: 'system', content: `你是中国象棋初学者的摆谱陪练。用户点击分析时发来当前真实局面。先解释 lastPlayed 的意图、是否将军、对手当前选择，再解释工具提供的参考应对。原训练题的限制不适用于自由摆谱。engine 评分只属于 currentFen 行棋方视角，不能拿来计算刚走一步的损失。没有走前走后独立评分时，不得断言刚走的是败着或最优。参考变化不代表必胜；proven 仅限当前报告的短将杀。sampleOnly 为 true 时，主线仅是合法示例。JSON move 等于 candidateMove，填写 observation、reason、practice、evidenceIds。${COACH_ANALYSIS_PROMPT}${DETAILED_SCHEMA}` },
    { role: 'user', content: JSON.stringify({ currentFen: position.fen, lastPlayed: last || null, candidateMove: walkthrough.steps[0].move, engine: report.engine, proof: report.proof, conclusion: report.conclusion, sampleOnly: Boolean(sample), evidence, walkthrough }) }
  ];
  try {
    const {content} = await requestDetailedCoach({
      config,identity:['study',position.baseFen,position.moves],messages,fetchImpl,
      task:{expectedMove:walkthrough.steps[0].move,evidenceIds:evidence.map(item=>item.id),allowedMoves:walkthroughMoves(walkthrough),walkthrough}
    });
    return {source:'model',promptVersion:COACH_PROMPT_VERSION,model:config.model,...content,positionFen:position.fen,moves:position.moves,analysis:report,elapsedMs:Date.now()-started};
  } catch (error) {
    if (!error.validationIssue) throw error;
    throw coachAnswerFailure(error,error.coachPayload,'MODEL_STUDY_RESPONSE_INVALID','DS 摆谱讲解未通过校验');
  }
}
