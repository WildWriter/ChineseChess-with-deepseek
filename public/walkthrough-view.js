import { parseFen, boardToFen, generateLegalMoves, applyMove, moveToUci, pieceSide, gameStatus, opposite } from './vendor/xiangqi.js';
import { formatMoveNotation } from './vendor/xiangqi-notation.js';
import { drawStudyBoard } from './study-board.js';

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, action) => { const node = el('button', text, 'button secondary'); node.type = 'button'; node.onclick = action; return node; };
const verdicts = { correct: '其他正确解', 'misses-goal': '未达到限定目标', defence: '其他合法防守', reference: '合法参考 · 优劣未评估', unproven: '尚未证实', illegal: '非法尝试' };

function mountReferenceLine(root, walkthrough, options) {
  const steps = walkthrough.steps;
  let index = Math.max(0, Math.min(steps.length - 1, walkthrough.focusIndex || 0)), phase = 'before', study = null, disposed = false;
  const select = el('select'); select.setAttribute('aria-label', '定位本地解法步骤');
  const prev = button('上一步', () => selectStep(index - 1)), next = button('下一步', () => selectStep(index + 1));
  const nav = el('div', undefined, 'walkthrough-nav'); nav.append(prev, select, next);
  select.append(...walkthrough.steps.map((step, n) => new Option(`${n + 1}. ${step.side} ${step.notation}（${step.move}）`, n)));
  select.onchange = () => selectStep(Number(select.value), 'after');
  const note = el('p', '本地解法回放：只展示经过规则核验的线路，不代表唯一或最优解。下方回放不改变上方练习棋盘或训练成绩；详细讲解请点击 AI 复盘讲解。', 'caption');
  const panel = el('section', undefined, 'study-board-panel reference-board-panel'), title = el('strong');
  title.setAttribute('aria-live', 'polite');
  const board = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  board.setAttribute('viewBox', '0 0 464 516'); board.setAttribute('role', 'img'); board.setAttribute('aria-label', '本地解法回放棋盘'); board.classList.add('study-board');
  const controls = el('div', undefined, 'study-controls');
  const before = button('看走前', () => selectStep(index, 'before')), after = button('看走后', () => selectStep(index, 'after'));
  controls.append(before, after); panel.append(title, board, controls);
  const line = el('ol', undefined, 'position-line');
  line.append(...steps.map((step, n) => { const item = el('li'); item.append(button(`${step.side} ${step.notation}（${step.move}）`, () => selectStep(n, 'after'))); return item; }));
  const start = button('从此处开始摆谱', () => {
    if (disposed || !steps.length) return;
    study = mountWalkthrough(root, walkthrough, { ...options, studyOnly: true, focusIndex: index, initialPhase: phase, onExitStudy() { study.dispose(); study = null; render(); } });
  });
  function selectStep(value, nextPhase = 'before') {
    if (disposed || study || !Number.isInteger(value) || value < 0 || value >= steps.length) return;
    index = value; phase = nextPhase === 'after' ? 'after' : 'before'; render();
  }
  function render() {
    if (disposed) return;
    root.classList.remove('is-studying'); root.classList.add('walkthrough');
    if (root.firstChild !== note) root.replaceChildren(note, nav, panel, line, start);
    select.value = String(index);
    prev.disabled = index === 0 || !steps.length; next.disabled = index >= steps.length - 1; select.disabled = start.disabled = !steps.length;
    panel.hidden = !steps.length;
    if (!steps.length) { note.textContent = '当前没有可回放的本地解法。'; return; }
    const step = steps[index], fen = phase === 'before' ? step.beforeFen : step.afterFen, position = parseFen(fen), outcome = gameStatus(position.board, position.turn);
    title.textContent = `本地解法 · 第 ${index + 1} / ${steps.length} 步 · ${phase === 'before' ? '走前' : '走后'} · ${outcome.state === 'playing' ? (position.turn === 'w' ? '红方行棋' : '黑方行棋') : outcome.reason}`;
    board.setAttribute('aria-label', `${title.textContent} · ${step.side} ${step.notation}（${step.move}）`);
    drawStudyBoard(board, fen, { move: step.move });
    options.onBoardPosition?.(fen, title.textContent);
    before.setAttribute('aria-pressed', String(phase === 'before')); after.setAttribute('aria-pressed', String(phase === 'after'));
    [...line.children].forEach((item, n) => { if (n === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    options.onPosition?.(index, phase);
  }
  render();
  return { dispose() { disposed = true; study?.dispose(); }, select(value, nextPhase = 'before') { if (disposed) return; if (study) return study.select(value, nextPhase); selectStep(value, nextPhase); } };
}

export function mountWalkthrough(root, walkthrough, options = {}) {
  const isModel = walkthrough.teachingSource === 'model';
  if (!isModel && !options.studyOnly) return mountReferenceLine(root, walkthrough, options);
  let index = options.focusIndex ?? walkthrough.focusIndex ?? 0, phase = options.initialPhase || 'before', branch = null, ply = 0, sandbox = null, selected = null;
  let revision = 0, inFlight = false, disposed = false, queuedManual = false;
  const focusHost=root.closest('#position-report, #report-content');
  root.replaceChildren(); root.classList.add('walkthrough');
  if (!walkthrough.steps.length) { if (isModel) root.append(el('p', walkthrough.summary)); return { dispose() {}, select() {} }; }
  const intro = el('p', '选中一步，先看走前局面，再看走后变化。你也可以从任意局面开始摆谱，试走双方的棋。', 'small muted');
  const warnings=Array.isArray(walkthrough.validationWarnings)?walkthrough.validationWarnings:[];
  const sourceNote=el('p',isModel?(warnings.length?'DS 逐步讲解 · 已显示模型原文，有 '+warnings.length+' 项一致性提醒。棋盘回放仍按本地核验线路。':'DS 逐步讲解 · 依据原提示词生成，内容一致性采用提醒模式。'):'','teaching-source import-status');
  sourceNote.dataset.state=isModel?(warnings.length?'warning':'success'):'idle';
  const warningDetails=el('details',undefined,'coach-validation-notes');warningDetails.hidden=!warnings.length;
  warningDetails.append(el('summary','查看 '+warnings.length+' 项一致性提醒（不拦截讲解）'));
  const warningList=el('ul');for(const warning of warnings)warningList.append(el('li',warning.message||'模型内容与工具信息不完全一致，请结合棋盘判断。'));
  warningDetails.append(warningList);
  const nav = el('div', undefined, 'walkthrough-nav');
  const stepSelect = el('select'); stepSelect.setAttribute('aria-label', '定位讲解步骤');
  stepSelect.append(...walkthrough.steps.map((step, n) => new Option(`${n + 1}. ${step.side} ${step.notation}（${step.move}）`, n)));
  const prev = button('上一步', () => select(index - 1)), next = button('下一步', () => select(index + 1));
  nav.append(prev, stepSelect, next); stepSelect.onchange = () => select(Number(stepSelect.value));
  const layout = el('div', undefined, 'walkthrough-layout'), boardPanel = el('section', undefined, 'study-board-panel');
  const boardTitle = el('strong'), boardSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  boardSvg.setAttribute('viewBox', '0 0 464 516'); boardSvg.setAttribute('role', 'group'); boardSvg.setAttribute('aria-label', '逐步讲解与自由摆谱棋盘'); boardSvg.classList.add('study-board');
  const boardControls = el('div', undefined, 'study-controls');
  const before = button('看走前', () => { phase = 'before'; branch = null; render(); }), after = button('看走后', () => { phase = 'after'; branch = null; render(); });
  const start = button('从此处开始摆谱', startStudy);
  boardControls.append(before, after, start);
  const sandboxControls = el('div', undefined, 'study-sandbox-controls'); sandboxControls.hidden = true;
  const undo = button('悔棋', () => { if (!sandbox.moves.length) return; sandbox.moves.pop(); sandbox.fens.pop(); sandbox.notations.pop(); studyChanged('已悔棋，等待分析当前局面。'); });
  const reset = button('重摆本分支', () => { sandbox.moves = []; sandbox.fens = [sandbox.baseFen]; sandbox.notations = []; studyChanged('已回到本分支起点。'); });
  const exit = button(options.studyOnly ? '返回参考线路' : '返回主线讲解', () => { if (options.studyOnly) { options.onExitStudy?.(); return; } sandbox = null; queuedManual=false; invalidate(); analysis.replaceChildren(); render(); });
  const manual = button('AI 分析当前局面', () => { invalidate(); queuedManual = true; requestAnalysis(); });
  manual.className='button primary';
  sandboxControls.append(manual, undo, reset, exit);
  const status = el('p', '', 'study-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const history = el('p', '', 'caption study-history'), analysis = el('div', undefined, 'study-analysis');
  boardPanel.append(boardTitle, boardSvg, boardControls, sandboxControls, history, status);
  const article = el('section', undefined, 'step-explanation'); layout.append(boardPanel, article);
  const summary = el('section', undefined, 'walkthrough-summary'); if (isModel) summary.append(el('h3', '整体总结'),el('strong',walkthrough.result?.label||'胜负暂未确定','study-result'), el('p', walkthrough.summary));
  analysis.hidden=true;root.append(sourceNote,warningDetails,intro, nav, layout, analysis, summary);

  function invalidate() { revision++; selected = null; }
  function setStatus(text, kind = 'idle') { status.textContent = text; status.dataset.state = kind; }
  function currentFen() {
    if (sandbox) return sandbox.fens.at(-1);
    const step = walkthrough.steps[index];
    if (branch) return ply === 0 ? (branch.originFen||step.beforeFen) : branch.line[ply - 1].afterFen;
    return phase === 'before' ? step.beforeFen : step.afterFen;
  }
  function renderBoard() {
    const step = walkthrough.steps[index], fen = currentFen(), position = parseFen(fen), outcome = gameStatus(position.board, position.turn);
    const lastMove = sandbox ? sandbox.moves.at(-1) : branch ? (ply ? branch.line[ply - 1].move : branch.move) : step.move;
    boardTitle.textContent = `${sandbox ? `自由摆谱 · 分支第 ${sandbox.moves.length} 步` : branch ? `${branch.kind==='response'?'对方应对':verdicts[branch.verdict]} · ${ply}/${branch.line.length}` : `第 ${index + 1} 步 · ${phase === 'before' ? '走前' : '走后'}`} · ${outcome.state === 'playing' ? (position.turn === 'w' ? '红方行棋' : '黑方行棋') : outcome.reason}`;
    drawStudyBoard(boardSvg, fen, { move: lastMove, selected, onSquare: sandbox ? play : null });
    options.onBoardPosition?.(fen, boardTitle.textContent);
    history.textContent = sandbox ? sandbox.notations.map((text, n) => `${n + 1}. ${text}`).join('　') || '分支起点：双方可按规则自由走棋，不计入训练进度。' : '起点与落点用圆圈标出；下方始终是红方底线。';
    undo.disabled = !sandbox?.moves.length; reset.disabled = !sandbox?.moves.length;
  }
  function render() {
    const step = walkthrough.steps[index], studying=Boolean(sandbox);
    root.classList.toggle('is-studying',studying);focusHost?.classList.toggle('has-active-study',studying);
    sourceNote.hidden=intro.hidden=nav.hidden=article.hidden=summary.hidden=studying || !isModel;warningDetails.hidden=studying||!isModel||!warnings.length;analysis.hidden=!studying;
    options.onStudyMode?.(studying);
    stepSelect.value = String(index); prev.disabled = index === 0 || Boolean(sandbox); next.disabled = index === walkthrough.steps.length - 1 || Boolean(sandbox); stepSelect.disabled = Boolean(sandbox);
    before.hidden = after.hidden = start.hidden = Boolean(sandbox); sandboxControls.hidden = !sandbox;
    before.setAttribute('aria-pressed', String(!branch && phase === 'before')); after.setAttribute('aria-pressed', String(!branch && phase === 'after'));
    article.replaceChildren();
    if (!isModel) { renderBoard(); return; }
    article.append(el('p', `${index + 1} / ${walkthrough.steps.length} · ${step.side} ${step.notation}（${step.move}）`, 'eyebrow'), el('h3', '这一步要解决什么'), el('p', step.observation), el('h3', '为什么这样走'), el('p', step.reason), el('h3', '走后发生什么'), el('p', step.consequence));
    if(step.responses?.length)article.append(el('h3','对方这样应对，局面会怎样'));
    for(const reply of step.responses||[]){
      const details=el('details',undefined,'variation-detail response-detail');
      const response={...reply,kind:'response',originFen:step.afterFen};
      const show=button('摆出对方应对',()=>{branch=response;ply=0;renderBoard();});
      const forward=button('走一步',()=>{ply=branch===response?Math.min(reply.line.length,ply+1):1;branch=response;renderBoard();});
      const back=button('退一步',()=>{ply=branch===response?Math.max(0,ply-1):0;branch=response;renderBoard();});
      const line=el('ol',undefined,'branch-line');
      reply.line.forEach((item,n)=>{const li=el('li');li.append(button(`${item.side} ${item.notation}`,()=>{branch=response;ply=n+1;renderBoard();}));line.append(li);});
      details.append(el('summary',`若对方 ${reply.notation}（${reply.move}）`),el('p',reply.explanation),show,back,forward,line);article.append(details);
    }
    article.append(el('h3','换一种走法会怎样'));
    for (const alternative of step.alternatives) {
      const details = el('details', undefined, 'variation-detail'), heading = el('summary', `${alternative.notation}（${alternative.move}） · ${alternative.verdict==='reference'&&alternative.assessment?.score?'引擎对比 · 本次搜索参考':verdicts[alternative.verdict]}`);
      const controls = el('div', undefined, 'study-controls');
      const show = button(alternative.line.length ? '摆出这条变化' : '标出非法尝试', () => { branch = alternative; ply = 0; renderBoard(); });
      const backward = button('退一步', () => { branch = alternative; ply = Math.max(0, ply - 1); renderBoard(); });
      const forward = button('走一步', () => { ply = branch === alternative ? Math.min(alternative.line.length, ply + 1) : Math.min(1, alternative.line.length); branch = alternative; renderBoard(); });
      forward.disabled = backward.disabled = !alternative.line.length;
      controls.append(show, backward, forward);
      const line = el('ol', undefined, 'branch-line');
      alternative.line.forEach((item, n) => { const li = el('li'); li.append(button(`${item.side} ${item.notation}`, () => { branch = alternative; ply = n + 1; renderBoard(); })); line.append(li); });
      details.append(heading, el('p', alternative.explanation), controls, line);
      details.querySelectorAll('button').forEach(node => node.disabled ||= Boolean(sandbox));
      article.append(details);
    }
    renderBoard();
    if (!sandbox && !branch) options.onPosition?.(index, phase);
  }
  function select(value) { if (sandbox || value < 0 || value >= walkthrough.steps.length) return; invalidate(); index = value; phase = 'before'; branch = null; ply = 0; analysis.replaceChildren(); setStatus(''); render(); }
  function startStudy() {
    const fen = currentFen(); invalidate(); sandbox = { baseFen: fen, fens: [fen], moves: [], notations: [] }; analysis.replaceChildren();
    setStatus('摆谱已开启。选择棋子再点落点；需要讲解时点击“AI 分析当前局面”，结果显示在棋盘下方。'); render();
  }
  function play(row, col) {
    const { board, turn } = parseFen(currentFen());
    if (gameStatus(board, turn).state !== 'playing') { setStatus('本局面已经结束，可悔棋或返回主线。'); return; }
    if (pieceSide(board[row][col]) === turn) { selected = selected?.join() === `${row},${col}` ? null : [row, col]; renderBoard(); return; }
    if (!selected) { setStatus('先选择当前行棋方的一枚棋子。'); return; }
    const move = generateLegalMoves(board, turn).find(item => item.from.join() === selected.join() && item.to.join() === `${row},${col}`);
    if (!move) { selected = null; renderBoard(); setStatus('这步不合法，请检查路径、棋子走法和己方帅将安全。'); return; }
    if (sandbox.moves.length >= 80) { setStatus('本分支已达 80 步，请重摆或返回主线。'); return; }
    sandbox.notations.push(`${turn === 'w' ? '红' : '黑'} ${formatMoveNotation(board, move)}`);
    sandbox.moves.push(moveToUci(move)); sandbox.fens.push(boardToFen(applyMove(board, move), opposite(turn)));
    studyChanged('已落子。可继续摆谱，或点击“AI 分析当前局面”了解走法与应对。');
  }
  function studyChanged(message) { invalidate(); queuedManual=false; analysis.replaceChildren(); setStatus(message); renderBoard(); }
  async function requestAnalysis() {
    if (!sandbox || disposed) return;
    if (inFlight) { setStatus('正在完成上一份分析，随后分析最新局面…', 'pending'); return; }
    if (!options.canUseModel?.()) { setStatus('当前未配置 API Key。摆谱可继续；请在 API 设置中应用密钥后点击“AI 分析当前局面”。', 'error'); return; }
    if (options.modelBusy?.()) { setStatus('另一个模型请求正在进行，完成后可点击“AI 分析当前局面”。'); return; }
    queuedManual = false;
    const stamp = revision, targetFen = currentFen(), request = { baseFen: sandbox.baseFen, moves: [...sandbox.moves], modelSettings: options.modelSettings() };
    inFlight = true; options.setModelBusy?.(true); setStatus(`DS 正在分析分支第 ${request.moves.length} 步；你可以继续走棋。`, 'pending');
    options.setModelStatus?.('pending', `摆谱分析调用中：${request.modelSettings.model || '当前模型'} · 分支第 ${request.moves.length} 步。`);
    try {
      const result = await options.api('/api/study/analyze', request);
      if (result.source !== 'model' && (result.source !== 'rules' || result.walkthrough?.steps.length !== 0)) throw new Error(result.message || 'DS 未返回有效讲解。');
      if (disposed || stamp !== revision || !sandbox || result.positionFen !== targetFen) {
        const kind = result.source === 'model' ? (result.validationWarnings?.length ? 'warning' : 'success') : 'idle';
        const message = result.source === 'model' ? `摆谱分析已返回${result.validationWarnings?.length?'，有 '+result.validationWarnings.length+' 项一致性提醒':''}；局面已改变或已退出，未显示旧结果。` : '旧局面的本地分析已结束，未显示旧结果；本次未调用模型。';
        options.setModelStatus?.(kind,message,result.source === 'model' ? undefined : '本地分析完成');
        return;
      }
      if (result.source !== 'model') {
        if (result.source !== 'rules' || result.walkthrough.steps.length) throw new Error(result.message || 'DS 未返回有效讲解。');
        analysis.replaceChildren(el('strong', result.walkthrough.result?.label || result.analysis.conclusion, 'study-result'));
        setStatus('当前局面已经结束。', 'success');
        options.setModelStatus?.('idle','当前局面已经结束，已显示本地判定；本次未调用模型。','本地分析完成'); return;
      }
      analysis.replaceChildren(el('h2', `当前局面分析 · 分支第 ${request.moves.length} 步`),el('strong',result.walkthrough.result?.label||'胜负暂未确定','study-result'),el('h3','本步结论'),el('p',result.observation),el('h3','下一步建议'),el('p',result.practice));
      if(result.validationWarnings?.length){const note=el('p',result.semanticReview,'import-status');note.dataset.state='warning';analysis.append(note);}
      const detail = el('details', undefined, 'study-analysis-detail');
      detail.append(el('summary', '展开走法原因、对方应对与后续变化'), el('p', result.reason || ''));
      for (const step of result.walkthrough.steps) {
        const card=el('section',undefined,'study-explanation-card');
        card.append(el('h3',`${step.side} ${step.notation}（${step.move}）`),el('h4','当前要解决的问题'),el('p',step.observation),el('h4','为什么走这步'),el('p',step.reason),el('h4','走后局面变化'),el('p',step.consequence));
        for(const reply of step.responses||[]){
          const response=el('details',undefined,'variation-detail');
          response.append(el('summary',`对方若走 ${reply.notation}（${reply.move}）`),el('p',reply.explanation));
          const show=button('摆出这条应对',()=>{const fen=reply.line.at(-1)?.afterFen;if(!fen)return;sandbox={baseFen:fen,fens:[fen],moves:[],notations:[]};studyChanged('已摆出所选应对的末尾局面，可继续研究或分析。');});
          response.append(show);card.append(response);
        }
        if(step.alternatives?.length)card.append(el('h4','其他走法对比'));
        for (const variation of step.alternatives || []) {
          const alternate=el('details',undefined,'variation-detail');
          alternate.append(el('summary',`${variation.notation} · ${verdicts[variation.verdict]}`),el('p',variation.explanation));card.append(alternate);
        }
        detail.append(card);
      }
      detail.append(el('h3', '本次总结'), el('p', result.walkthrough.summary));
      analysis.append(detail, el('p', `${result.model} · ${((result.elapsedMs || 0) / 1000).toFixed(1)} 秒 · 对应上方当前棋盘`, 'caption'));
      setStatus(result.validationWarnings?.length?'DS 分析已显示，有 '+result.validationWarnings.length+' 项一致性提醒；可继续摆谱。':'当前局面的 DS 分析已更新。继续走棋可以研究下一步。', result.validationWarnings?.length?'warning':'success');
      options.setModelStatus?.(result.validationWarnings?.length?'warning':'success', `摆谱分析已显示：${result.model} · ${((result.elapsedMs || 0) / 1000).toFixed(1)} 秒。${result.validationWarnings?.length?'有 '+result.validationWarnings.length+' 项一致性提醒。':''}`);
    } catch (error) {
      options.setModelStatus?.('error',`摆谱分析失败：${error.message}${disposed || stamp !== revision?' 这是旧局面的请求，不改变当前棋盘。':''}`);
      if (!disposed && stamp === revision) setStatus(`DS 分析失败：${error.message} 棋盘已保留，可手动重试。`, 'error');
    }
    finally { inFlight = false; options.setModelBusy?.(false); if (!disposed && stamp !== revision && sandbox && queuedManual) requestAnalysis(); }
  }
  if (options.studyOnly) startStudy(); else render();
  return { dispose() { disposed = true; queuedManual=false; invalidate(); focusHost?.classList.remove('has-active-study'); options.onStudyMode?.(false); }, select(value, nextPhase = 'before') { select(value); if (!sandbox) { phase = nextPhase; render(); } } };
}
