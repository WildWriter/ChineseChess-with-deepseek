import { Worker } from 'node:worker_threads';
import { validateImportedPosition, buildImportedReport } from './imported-position.js';

export function runImportedSearch(fen, maxMoves) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./position-worker.js', import.meta.url), { workerData: { fen, maxMoves }, execArgv: [] });
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate().catch(() => {}); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(null, { status: 'limit', attacker: fen.split(' ')[1], maxMoves, line: [], nodes: null, elapsedMs: 2200 }), 2200);
    worker.once('message', result => finish(null, result));
    worker.once('error', () => finish(Object.assign(new Error('残局搜索暂时失败，请重试。'), { status: 503 })));
    worker.once('exit', () => { if (!settled) finish(Object.assign(new Error('残局搜索意外结束，请重试。'), { status: 503 })); });
  });
}

export function createImportedAnalyzer({ engineAnalyze, engineReady, search = runImportedSearch }) {
  const cache = new Map(); let busy = false;
  return async function analyzeImported(fen, maxMoves = 3) {
    const position = validateImportedPosition(fen);
    if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 3) throw Object.assign(new Error('短将杀搜索支持 1–3 个行棋方回合。'), { status: 400 });
    const key = position.fen + '|' + maxMoves, cached = cache.get(key);
    if (cached && Date.now() - cached.time < 120000) return cached.report;
    if (busy) throw Object.assign(new Error('正在分析其他导入局面，请稍后重试。'), { status: 429 });
    busy = true;
    try {
      let proof = { status: 'terminal', line: [], maxMoves }, engine = null, engineWarning = null;
      if (position.status.state === 'playing') {
        proof = await search(position.fen, maxMoves);
        if (engineReady()) { try { engine = await engineAnalyze(position.fen, 1200); } catch { engineWarning = '引擎暂不可用，仍可查看短将杀搜索结果。'; } }
        else engineWarning = '引擎尚未就绪，仍可查看短将杀搜索结果。';
      }
      const report = buildImportedReport(position.fen, proof, engine, engineWarning);
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(key, { time: Date.now(), report }); return report;
    } finally { busy = false; }
  };
}
