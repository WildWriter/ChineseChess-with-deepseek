import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedPosition } from './training.js';
import { generateLegalMoves, moveToUci, uciToMove, applyMove, opposite, gameStatus } from '../public/vendor/xiangqi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_PATH = process.env.PIKAFISH_PATH || path.join(ROOT, 'engine', process.platform === 'win32' ? 'Pikafish-Windows-x86-64-universal.exe' : 'pikafish');
const NETWORK_PATH = path.join(ROOT, 'engine', 'pikafish.nnue');
let running = 0;
const waiting = [];

export function engineAvailable() { return existsSync(ENGINE_PATH) && existsSync(NETWORK_PATH); }

export function validatePV(fen, tokens) {
  let { board, turn } = checkedPosition(fen);
  const moves = [];
  for (const token of tokens.slice(0, 12)) {
    if (!generateLegalMoves(board, turn).some(move => moveToUci(move) === token)) break;
    moves.push(token);
    board = applyMove(board, uciToMove(token));
    turn = opposite(turn);
  }
  return moves;
}

async function acquire() {
  if (running < 1) { running++; return; }
  if (waiting.length >= 3) throw Object.assign(new Error('引擎忙，请稍后再试。'), { status: 429 });
  await new Promise(resolve => waiting.push(resolve));
}
function release() { if (waiting.length) waiting.shift()(); else running--; }

export async function analyze(fen, moveTime = 600) {
  checkedPosition(fen);
  if (!engineAvailable()) throw Object.assign(new Error('棋力引擎尚未就绪，请运行准备脚本。'), { status: 503 });
  await acquire();
  try { return await runEngine(fen, Math.max(100, Math.min(1200, moveTime))); }
  finally { release(); }
}

function runEngine(fen, moveTime) {
  return new Promise((resolve, reject) => {
    // Each analysis gets its own process: no cross-user board or broadcast state.
    const child = spawn(ENGINE_PATH, [], { cwd: path.dirname(ENGINE_PATH), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    let result = {}, settled = false, stderr = '';
    const timer = setTimeout(() => finish(new Error('引擎分析超时。')), 12000);
    const send = command => { if (!child.stdin.destroyed) child.stdin.write(`${command}\n`); };
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); lines.close(); child.kill();
      if (error) reject(Object.assign(error, { status: 503 })); else resolve(value);
    }
    child.on('error', () => finish(new Error('无法启动棋力引擎，请检查安装与平台。')));
    child.stdin.on('error', () => {});
    child.stderr.on('data', buffer => { stderr = (stderr + buffer.toString()).slice(-2000); });
    child.on('exit', () => { if (!settled) finish(new Error(`引擎提前结束${stderr ? '，请检查权重文件和运行环境' : ''}。`)); });
    lines.on('line', line => {
      if (line === 'uciok') {
        send('setoption name Threads value 1'); send('setoption name Hash value 64');
        send(`setoption name EvalFile value ${NETWORK_PATH}`); send('isready');
      } else if (line === 'readyok') {
        send(`position fen ${fen}`); send(`go movetime ${moveTime}`);
      } else if (line.startsWith('info ') && line.includes(' pv ')) {
        const score = line.match(/ score (cp|mate) (-?\d+)/);
        result = { depth: Number(line.match(/ depth (\d+)/)?.[1] || 0), score: score ? { type: score[1], value: Number(score[2]), perspective: 'side-to-move' } : null, pv: validatePV(fen, line.split(' pv ')[1].trim().split(/\s+/)) };
      } else if (line.startsWith('bestmove ')) {
        const bestMove = line.split(/\s+/)[1];
        if (!validatePV(fen, [bestMove]).length) return finish(new Error('引擎没有返回可验证的合法走法。'));
        const { board, turn } = checkedPosition(fen);
        const immediateOutcome = gameStatus(applyMove(board, uciToMove(bestMove)), opposite(turn));
        finish(null, { ...result, bestMove, immediateOutcome, source: 'Pikafish', moveTime, label: '当前搜索条件下的推荐；不是唯一正确答案的证明。引擎 mate 分值也可能包含困毙，绝杀须另外核验将军状态。' });
      }
    });
    send('uci');
  });
}
