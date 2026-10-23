import { parseFen, generateLegalMoves, moveToUci, uciToMove, pieceSide, pieceName } from './vendor/xiangqi.js';
import { createModelSession, pageKeyAllowed } from './model-session.js';
import { filterCurriculum, recordAttempt } from './curriculum.js';
import { createLearningStore, sanitizeLearningRecords } from './learning-store.js';
import { mountImportLab } from './import-lab.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'qili-study-v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const state = { puzzles: [], knowledge: [], health: {}, current: null, board: null, selected: null, legal: [], flipped: false, hints: 0, assisted: false, solved: false, pending: false, generation: 0, lastMove: null, hintMove: null, token: '', records: {}, comparison: null, modelSession: null, modelBusy: false, history: [], course: 'all', theme: 'all' };
let toastTimer, learningStore = null, recordChannel = null, recordsReadVersion = 0, importLab = null;

function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function svg(tag, attrs = {}) { const node = document.createElementNS(SVG_NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function feedback(message, type = '') { $('feedback').textContent = message; $('feedback').className = `feedback ${type}`; }
function sanitizeRecords(raw) {
  return sanitizeLearningRecords(raw, state.puzzles.map(puzzle => puzzle.id));
}
async function refreshRecords() {
  if (!learningStore) return;
  const version = ++recordsReadVersion;
  const records = await learningStore.readAll();
  if (version !== recordsReadVersion) return;
  state.records = records; updateStats();
  if (!$('view-mistakes').hidden) renderMistakes();
}
function signalRecordsChanged() {
  try { recordChannel?.postMessage('records-changed'); } catch {}
  try { localStorage.setItem('qili-records-notice-v2', String(Date.now()) + Math.random()); } catch {}
}
async function loadRecords() {
  try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); state.records = sanitizeRecords(raw.records || {}); }
  catch { state.records = {}; toast('学习记录不可读取，当前使用空记录。'); }
  try {
    learningStore = createLearningStore({ ids: state.puzzles.map(puzzle => puzzle.id) });
    await learningStore.initialize(state.records); await refreshRecords();
    const refresh = () => { refreshRecords().catch(() => toast('学习记录同步失败，请导出备份后刷新。')); };
    try { recordChannel = new BroadcastChannel('qili-learning-records-v2'); recordChannel.onmessage = refresh; } catch {}
    window.addEventListener('storage', event => { if (event.key === 'qili-records-notice-v2') refresh(); });
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  } catch { learningStore = null; toast('浏览器无法持久保存记录，当前仅保留本页进度，请导出备份。'); }
  updateStats();
}
async function saveAttempt(id, report, assisted) {
  if (learningStore) {
    let committed = false;
    try { await learningStore.attempt(id, report, assisted); committed = true; }
    catch { learningStore = null; toast('本次进度暂未持久保存，仅保留在当前页，请导出备份。'); }
    if (committed) {
      signalRecordsChanged();
      try { await refreshRecords(); }
      catch { toast('进度已保存，但页面同步失败，请刷新后查看。'); }
      return;
    }
  }
  state.records[id] = recordAttempt(state.records[id], report, assisted);
  recordsReadVersion++;
  updateStats();
}
function updateStats() {
  const values = Object.values(state.records);
  const independent = values.filter(item => item.independent).length;
  $('complete-count').replaceChildren(document.createTextNode(String(independent)), el('span', ` / ${state.puzzles.length}`));
  $('progress-fill').style.width = `${state.puzzles.length ? independent / state.puzzles.length * 100 : 0}%`;
  $('mistake-badge').textContent = String(values.filter(item => item.mistakes > 0 && !item.resolved).length);
  if(state.current)renderPuzzleLibrary();
}
async function api(path, data) {
  const options = data ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }, body: JSON.stringify(data) } : {};
  let response;
  try { response = await fetch(path, { ...options, signal: AbortSignal.timeout(path === '/api/compare' ? 85000 : path === '/api/model/test' ? 16000 : 45000) }); }
  catch (error) { throw new Error(['AbortError','TimeoutError'].includes(error.name) ? '请求超时，请稍后重试。' : '无法连接本地服务，请确认程序已启动并重试。'); }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`服务返回无效响应（HTTP ${response.status}），请稍后重试。`); }
  if (!response.ok) throw Object.assign(new Error(payload.error || '请求失败，请重试。'), { code: payload.code, status: response.status });
  return payload;
}
function canUseModel() { return Boolean(state.modelSession?.canCall()); }
function modelSummaryText() {
  const config = state.modelSession.summary();
  return `页面会话密钥 · ${config.model}`;
}
function setModelStatus(kind, message, label) {
  for (const id of ['model-call-status','api-test-status']) { $(id).dataset.state = kind; $(id).textContent = message; }
  const labels = { idle: '未测试', pending: '调用中', success: '调用成功', error: '调用失败' };
  $('model-status').textContent = `${label || labels[kind] || '未测试'} · ${state.modelSession.summary().model}`;
  $('model-status').className = kind === 'success' ? 'ready' : 'offline';
  $('model-status').title = message;
}
function refreshModelControls() {
  importLab?.refresh();
  $('ai-button').disabled = state.pending || state.modelBusy || !canUseModel();
  $('compare-button').disabled = state.modelBusy || !canUseModel();
  for (const id of ['apply-api-button','test-api-button','clear-api-button','model-select','api-key-input']) $(id).disabled = state.modelBusy;
  $('api-key-input').placeholder = state.modelSession?.summary().hasSessionKey ? '当前会话已设置；留空保留，输入新值替换' : '在此粘贴 DeepSeek API Key';
  for (const id of ['puzzle-select','next-top','next-button','reset-button','theme-filter']) $(id).disabled = state.modelBusy || state.pending;
  for(const node of document.querySelectorAll('[data-course],[data-puzzle-id]'))node.disabled=state.modelBusy||state.pending;
}
function setModelBusy(value) { state.modelBusy = value; refreshModelControls(); }
function syncApiSummary() {
  const summary = state.modelSession.summary();
  $('api-active-summary').textContent = `当前：${modelSummaryText()}${canUseModel() ? '' : '（尚未填写密钥）'}`;
  $('api-key-input').placeholder = summary.hasSessionKey ? '当前会话已设置密钥；留空可保留，输入新值可替换' : '在此粘贴 DeepSeek API Key';
  refreshModelControls();
}
function openApiDialog() {
  const summary = state.modelSession.summary();
  $('model-select').value = summary.model;
  $('api-key-input').value = '';
  syncApiSummary();
  $('api-dialog').showModal();
}
function applyApiSettings() {
  try {
    if (!pageKeyAllowed(location)) throw new Error('页面密钥仅可在本机地址或 HTTPS 页面使用。');
    state.modelSession.apply({ model: $('model-select').value, apiKey: $('api-key-input').value });
    $('api-key-input').value = '';
    state.comparison = null; $('export-eval-button').disabled = true;
    importLab?.clearExplanation();
    if ($('report-title').textContent === 'AI 复盘讲解') $('report-panel').hidden = true;
    syncApiSummary();
    setModelStatus('idle', `已应用 ${modelSummaryText()}，尚未测试；点击“应用并测试连接”验证。`);
    $('ai-caption').textContent = `当前模型：${state.modelSession.summary().model}。点击才调用，可能产生 API 费用。`;
    return true;
  } catch (error) { setModelStatus('error', `设置失败：${error.message}`, '设置失败'); return false; }
}
async function testApiConnection() {
  if (state.modelBusy || !applyApiSettings()) return;
  const modelSettings = state.modelSession.requestSettings();
  setModelBusy(true); setModelStatus('pending', `正在测试 ${modelSettings.model}，通常需要几秒…`);
  try { const result = await api('/api/model/test', { modelSettings }); setModelStatus('success', `${result.message}（${(result.elapsedMs / 1000).toFixed(1)} 秒）`); }
  catch (error) { setModelStatus('error', `连接失败：${error.message}`); }
  finally { setModelBusy(false); }
}
function view(name) {
  for (const node of document.querySelectorAll('.view')) node.hidden = node.id !== `view-${name}`;
  for (const node of document.querySelectorAll('[data-view]')) node.classList.toggle('active', node.dataset.view === name);
  $('breadcrumb').textContent = { training: '战术练习', import: '图片残局', mistakes: '我的错题', knowledge: '规则小册', evaluation: '定制效果对比' }[name];
  if (name === 'mistakes') renderMistakes();
  history.replaceState(null, '', `#${name}`);
}
function visiblePuzzles(){return filterCurriculum(state.puzzles,state.course,state.theme);}
function renderPuzzleLibrary(){
  const puzzles=visiblePuzzles();
  $('library-summary').textContent=`展开题库 · 当前 ${puzzles.length} 题 · ${puzzles.filter(p=>state.records[p.id]?.completed).length} 题已完成`;
  $('puzzle-grid').replaceChildren(...puzzles.map(puzzle=>{
    const button=el('button',undefined,'puzzle-card');button.type='button';button.dataset.puzzleId=puzzle.id;button.disabled=state.pending||state.modelBusy;
    button.setAttribute('aria-pressed',String(state.current?.id===puzzle.id));
    button.append(el('span',`${puzzle.course==='basic'?'基础':'残局'} · ${puzzle.maxRedMoves?`红方 ${puzzle.maxRedMoves} 步内`:'一步目标'}`,'caption'),el('strong',puzzle.title),el('small',`${puzzle.theme} · ${state.records[puzzle.id]?.completed?'✓ 已完成':'待练习'}`));
    button.onclick=()=>selectPuzzle(puzzle.id);return button;
  }));
}
function renderCurriculum(){
  const themes=[...new Set(filterCurriculum(state.puzzles,state.course).map(p=>p.theme))];
  if(state.theme!=='all'&&!themes.includes(state.theme))state.theme='all';
  $('theme-filter').replaceChildren(new Option('全部主题','all'),...themes.map(theme=>new Option(theme,theme)));
  $('theme-filter').value=state.theme;
  for(const node of document.querySelectorAll('[data-course]')){
    node.setAttribute('aria-pressed',String(node.dataset.course===state.course));
    node.textContent=`${{all:'全部',basic:'基础入门',endgame:'残局专题'}[node.dataset.course]} ${filterCurriculum(state.puzzles,node.dataset.course).length}`;
  }
  const puzzles=visiblePuzzles();
  $('puzzle-select').replaceChildren(...puzzles.map(puzzle=>new Option(puzzle.title,puzzle.id)));
  $('puzzle-select').value=state.current?.id||puzzles[0]?.id;
  renderPuzzleLibrary();
}
function renderVariation(line=[]){
  const active=state.current.goal==='forced-mate';$('variation-panel').hidden=!active;
  $('endgame-progress').textContent=state.solved?'✓ 绝杀完成':`红方已走 ${state.history.length} / ${state.current.maxRedMoves} 步`;
  $('move-history').replaceChildren(...line.map(item=>el('li',`${item.side}：${item.notation}（${item.move}）`)));
}
function selectPuzzle(id) {
  const puzzle = state.puzzles.find(item => item.id === id) || state.puzzles[0];
  state.current = puzzle; state.board = parseFen(puzzle.fen).board;
  state.selected = null; state.hints = 0; state.assisted = false; state.solved = false; state.pending = false; state.lastMove = null; state.hintMove = null; state.history=[]; state.generation++;
  if(!visiblePuzzles().some(item=>item.id===puzzle.id)){state.course=puzzle.course;state.theme='all';}
  renderCurriculum();renderVariation();
  state.legal = generateLegalMoves(state.board, parseFen(puzzle.fen).turn);
  $('puzzle-select').value = puzzle.id; $('puzzle-title').textContent = puzzle.title; $('objective').textContent = puzzle.objective;
  $('level-label').textContent = puzzle.subtitle; $('difficulty').textContent = ['','入门 · Ⅰ','基础 · Ⅱ','进阶 · Ⅲ'][puzzle.difficulty];
  $('puzzle-tags').replaceChildren(el('span', puzzle.category), el('span', puzzle.theme), el('span', puzzle.maxRedMoves?`红方 ${puzzle.maxRedMoves} 步内`:'一步目标'));
  $('hint-list').replaceChildren(); $('hint-counter').textContent = '0 / 3'; $('hint-button').disabled = false;
  $('report-panel').hidden = true; $('engine-result').textContent = ''; $('turn-badge').textContent = '● 红方先行';
  $('board-caption').textContent = '点击红方棋子，再点击目标位置';
  feedback(puzzle.maxRedMoves?'先读目标。你执红，黑方自动应将；完成最后的绝杀才计为通关。':'先读右侧目标，试着独立完成。'); setPending(false); renderBoard();
}
function renderBoard() {
  const root = $('chessboard');
  const focusedSquare = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-square') : null;
  root.replaceChildren();
  const defs = svg('defs');
  const gradient = svg('radialGradient', { id: 'stone', cx: '.38', cy: '.28', r: '.8' });
  gradient.append(svg('stop', { offset: '0', 'stop-color': '#fffdf4' }), svg('stop', { offset: '1', 'stop-color': '#efe1c2' }));
  defs.append(gradient); root.append(defs);
  const step = 52, x0 = 62, y0 = 65;
  const display = (row, col) => state.flipped ? [9 - row, 8 - col] : [row, col];
  const coords = (row, col) => { const [r, c] = display(row, col); return [x0 + c * step, y0 + r * step]; };
  const line = (x1,y1,x2,y2, width = 1) => root.append(svg('line', { x1, y1, x2, y2, stroke: '#aa9370', 'stroke-width': width, 'pointer-events': 'none' }));
  root.append(svg('rect', { x: 44, y: 47, width: 452, height: 504, rx: 3, fill: 'none', stroke: '#b9a17a', 'stroke-width': 1.4, 'pointer-events': 'none' }));
  for (let r=0;r<10;r++) line(x0,y0+r*step,x0+8*step,y0+r*step,r===0||r===9?1.5:1);
  for (let c=0;c<9;c++) {
    if(c===0||c===8) line(x0+c*step,y0,x0+c*step,y0+9*step,1.5);
    else {line(x0+c*step,y0,x0+c*step,y0+4*step);line(x0+c*step,y0+5*step,x0+c*step,y0+9*step);}
  }
  for (const r of [0,7]) { line(x0+3*step,y0+r*step,x0+5*step,y0+(r+2)*step);line(x0+5*step,y0+r*step,x0+3*step,y0+(r+2)*step); }
  for (const [label, x] of [['楚 河', x0+2*step],['汉 界',x0+6*step]]) { const node = svg('text',{x,y:y0+4.5*step+1,'text-anchor':'middle','dominant-baseline':'central',fill:'#b39b75','font-size':21,'font-family':'SimSun,serif','letter-spacing':7});node.textContent=label;root.append(node); }
  for(let c=0;c<9;c++) {const node=svg('text',{x:x0+c*step,y:575,'text-anchor':'middle',class:'coord-label'});node.textContent='abcdefghi'[state.flipped?8-c:c];root.append(node);}
  for(let r=0;r<10;r++) {const node=svg('text',{x:25,y:y0+r*step+4,'text-anchor':'middle',class:'coord-label'});node.textContent=state.flipped?r:9-r;root.append(node);}
  const legalTargets = state.selected ? state.legal.filter(move => move.from[0]===state.selected[0] && move.from[1]===state.selected[1]).map(move=>move.to.join(',')) : [];
  const last = state.lastMove ? uciToMove(state.lastMove) : null;
  const hint = state.hintMove ? uciToMove(state.hintMove) : null;
  for (let row=0;row<10;row++) for(let col=0;col<9;col++) {
    const [x,y] = coords(row,col), piece=state.board[row][col], square=`${'abcdefghi'[col]}${9-row}`;
    const cell=svg('g',{class:'board-cell','role':'button','aria-label':piece==='.'?`空位 ${square}`:`${pieceSide(piece)==='w'?'红':'黑'}${pieceName(piece)} ${square}`,tabindex:row===9&&col===4?'0':'-1','data-square':square});
    cell.append(svg('rect',{x:x-25,y:y-25,width:50,height:50,fill:'transparent'}));
    if(last && [...last.from].join(',')===[row,col].join(',') || last && [...last.to].join(',')===[row,col].join(',')) cell.append(svg('circle',{cx:x,cy:y,r:24,class:'last-ring','pointer-events':'none'}));
    if(hint && (hint.from.join(',')===[row,col].join(',')||hint.to.join(',')===[row,col].join(','))) cell.append(svg('circle',{cx:x,cy:y,r:24,class:'target-mark','pointer-events':'none'}));
    if(piece!=='.') {
      cell.append(svg('circle',{cx:x,cy:y+2,r:22,fill:'#9c7c4f26','pointer-events':'none'}));
      cell.append(svg('circle',{cx:x,cy:y,r:21.5,fill:'url(#stone)',stroke:'#c2ab82','stroke-width':1,'pointer-events':'none'}));
      cell.append(svg('circle',{cx:x,cy:y,r:17.5,fill:'none',stroke:pieceSide(piece)==='w'?'#bb6e5955':'#7e786255','stroke-width':.9,'pointer-events':'none'}));
      const text=svg('text',{x,y:y+.5,class:'piece-text',fill:pieceSide(piece)==='w'?'#b44e3c':'#405047'});text.textContent=pieceName(piece);cell.append(text);
    }
    if(state.selected?.[0]===row&&state.selected?.[1]===col) cell.append(svg('circle',{cx:x,cy:y,r:25,class:'selected-ring','pointer-events':'none'}));
    if(legalTargets.includes(`${row},${col}`)) cell.append(svg('circle',{cx:x,cy:y,r:piece==='.'?5:24,class:piece==='.'?'legal-dot':'selected-ring','pointer-events':'none'}));
    cell.addEventListener('click',()=>clickSquare(row,col));
    cell.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();clickSquare(row,col);}
      const deltas={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
      if(deltas[event.key]) {event.preventDefault();const [dr,dc]=deltas[event.key].map(value=>state.flipped?-value:value);const nr=Math.max(0,Math.min(9,row+dr)),nc=Math.max(0,Math.min(8,col+dc));const next=root.querySelector(`[data-square="${'abcdefghi'[nc]}${9-nr}"]`);cell.setAttribute('tabindex','-1');next.setAttribute('tabindex','0');next.focus();}
    });
    root.append(cell);
  }
  if (focusedSquare) {
    const focused = root.querySelector(`[data-square="${focusedSquare}"]`);
    const oldTabStop = root.querySelector('[tabindex="0"]');
    if (oldTabStop) oldTabStop.setAttribute('tabindex', '-1');
    if (focused) { focused.setAttribute('tabindex', '0'); focused.focus({ preventScroll: true }); }
  }
}
function setPending(value) {
  state.pending=value;
  for(const id of ['lesson-button','hint-button','engine-button']) $(id).disabled=value || (id==='hint-button'&&(state.hints>=3||(state.solved&&state.current?.maxRedMoves))) || (id==='engine-button'&&!state.health.engine);
  refreshModelControls();
}
async function clickSquare(row,col) {
  if(state.pending||state.solved) return;
  const piece=state.board[row][col];
  if(pieceSide(piece)==='w') {state.selected=state.selected?.[0]===row&&state.selected?.[1]===col?null:[row,col];renderBoard();return;}
  if(!state.selected) {feedback('先选择一枚红方棋子。');return;}
  const move=moveToUci({from:state.selected,to:[row,col]}), id=state.current.id, gen=state.generation;
  setPending(true);
  try {
    const report=await api('/api/attempt',{id,move,history:state.history}); if(gen!==state.generation)return;
    await saveAttempt(id,report,state.assisted);if(gen!==state.generation)return;
    if(report.correct){
      state.solved=report.complete??true;state.history=report.history||[];state.board=parseFen(report.nextFen).board;state.lastMove=report.opponentMove||move;state.selected=null;state.hintMove=null;
      state.legal=state.solved?[]:generateLegalMoves(state.board,'w');
      feedback(`${report.message}${state.solved?(state.assisted?' 本次为提示后完成。':' 本次为独立完成。'):''}`,'success');
      $('board-caption').textContent=report.opponentMove?`红：${report.notation} · 黑：${report.opponentNotation}`:`已走：${report.notation}（${move}）`;
      $('turn-badge').textContent=state.solved?'✓ 目标完成':`● 红方第 ${state.history.length+1} 步`;
      if(!state.solved){state.hints=0;$('hint-list').replaceChildren();$('hint-counter').textContent='0 / 3';$('report-panel').hidden=true;}
      renderBoard();renderVariation(report.line);renderPuzzleLibrary();if(state.solved)showReport({...report,source:'lesson'});
    }
    else {feedback(report.message,'error');state.selected=null;renderBoard();}
  } catch(error){if(gen===state.generation)feedback(error.message,'error');}
  finally{if(gen===state.generation)setPending(false);}
}
function showReport(report) {
  const isModel=report.source==='model';
  $('report-panel').hidden=false;$('report-title').textContent=isModel?'AI 复盘讲解':'本题教案讲解';
  $('report-source').textContent=isModel?`模型 · ${report.model}`:'规则证据 + 自编教案';
  const content=$('report-content');content.replaceChildren();
  $('engine-result').textContent='';
  if(report.engineWarning)content.append(el('p',report.engineWarning,'caption'));
  if(report.message&&report.source==='lesson-fallback')content.append(el('p',report.message));
  const lesson=report.source==='lesson-fallback'?report.lesson:report;
  if(isModel){content.append(el('p',report.observation),el('p',report.reason),el('p',`再想一想：${report.practice}`),el('p',`引用：${report.evidenceIds.join('、')} · ${report.semanticReview}`,'caption'));}
  else {content.append(el('p',lesson.lesson),el('p',`记住这一点：${lesson.reflection}`));}
  $('evidence-list').replaceChildren(...(lesson.evidence||[]).map(item=>{const node=el('div',undefined,'evidence-item');node.append(el('b',item.id),document.createTextNode(item.text));return node;}));
}
function nextPuzzle(){const puzzles=visiblePuzzles(),index=puzzles.findIndex(item=>item.id===state.current.id);selectPuzzle(puzzles[(index+1)%puzzles.length].id);view('training');}
async function hint(){if(state.hints>=3||state.pending)return;const gen=state.generation,id=state.current.id;setPending(true);try{const result=await api('/api/hint',{id,level:state.hints+1,history:state.history});if(gen!==state.generation)return;state.hints=result.level;const item=el('li');item.append(el('small',`提示 ${result.level}`),document.createTextNode(result.text));$('hint-list').append(item);$('hint-counter').textContent=`${state.hints} / 3`;state.assisted=true;state.hintMove=result.move;renderBoard();}catch(error){toast(error.message);}finally{if(gen===state.generation)setPending(false);}}
async function lesson(){const gen=state.generation;setPending(true);try{const result=await api('/api/lesson',{id:state.current.id,move:state.solved?state.lastMove:null,history:state.history});if(gen!==state.generation)return;showReport(result);state.assisted=true;state.hintMove=state.solved?null:result.move;renderBoard();}catch(error){toast(error.message);}finally{if(gen===state.generation)setPending(false);}}
async function aiCoach() {
  if (state.modelBusy) return;
  if (!canUseModel()) { openApiDialog(); return; }
  const gen = state.generation, modelSettings = state.modelSession.requestSettings();
  setModelBusy(true); setPending(true);
  $('report-panel').hidden = true;
  $('ai-caption').textContent = `正在调用 ${modelSettings.model} 并校验输出…`;
  setModelStatus('pending', `讲解调用中：${modelSettings.model} · ${state.current.title}`);
  try {
    const report = await api('/api/coach', { id: state.current.id, move: state.solved ? state.lastMove : null, modelSettings, history:state.history });
    if (gen !== state.generation) return;
    showReport(report);
    state.assisted = true;
    if (report.source === 'model') {
      const message = `讲解调用成功：${report.model} · ${(report.elapsedMs / 1000).toFixed(1)} 秒。${report.engineWarning || ''}`;
      $('ai-caption').textContent = message; setModelStatus('success', message);
    } else {
      const message = `讲解调用失败：${report.message || '输出未通过校验，已展示教案。'}`;
      $('ai-caption').textContent = message; setModelStatus('error', message);
    }
  } catch (error) {
    if (gen === state.generation) { $('ai-caption').textContent = `讲解调用失败：${error.message}`; setModelStatus('error', `讲解调用失败：${error.message}`); }
  } finally { setModelBusy(false); if (gen === state.generation) setPending(false); }
}
async function engine(){const gen=state.generation;setPending(true);$('engine-result').textContent='正在分析当前训练局面…';try{const report=await api('/api/engine',{id:state.current.id,history:state.history});if(gen!==state.generation)return;const score=report.score?`${report.score.type==='mate'?'引擎胜负距离':'搜索评分'} ${report.score.value}`:'';const outcome=report.immediateOutcome?.reason?`；该推荐走后规则判定：${report.immediateOutcome.reason}`:'';$('engine-result').textContent=`推荐 ${report.bestMove} · 深度 ${report.depth||'—'} · ${score}（训练局面行棋方视角）${outcome}。不作为本题唯一判题标准；引擎胜负距离可能包含困毙。`;}catch(error){if(gen===state.generation)$('engine-result').textContent=error.message;}finally{if(gen===state.generation)setPending(false);}}
function renderMistakes(){const root=$('mistake-list');root.replaceChildren();const list=state.puzzles.filter(p=>state.records[p.id]?.mistakes>0);if(!list.length){const empty=el('div',undefined,'empty-state');empty.append(el('span','◉','empty-icon'),el('h2','这里还没有错题'),el('p','去做几道练习。做错的题会留在这里，方便回来再想一遍。'));const btn=el('button','开始练习 →','button primary');btn.onclick=()=>view('training');empty.append(btn);root.append(empty);return;}for(const puzzle of list){const record=state.records[puzzle.id];const card=el('article',undefined,'item-card');card.append(el('p',record.resolved?'✓ 已重新完成':'待重练','eyebrow'),el('h2',puzzle.title),el('p',puzzle.objective),el('p',`尝试 ${record.attempts} 次 · 未完成目标 ${record.mistakes} 次${record.independent?' · 曾独立完成':''}`,'caption'));const btn=el('button','再练一次 →','button secondary');btn.onclick=()=>{selectPuzzle(puzzle.id);view('training');};card.append(btn);root.append(card);}}
function renderKnowledge(){for(const item of state.knowledge){const card=el('article',undefined,'item-card');card.append(el('h2',item.title),el('p',item.text),el('p',item.scope,'caption'));const link=el('a','规则实现与出处 ↗','caption');link.href=item.source;link.target='_blank';link.rel='noreferrer';card.append(link);const p=state.puzzles.find(p=>p.knowledge.includes(item.id));if(p){const btn=el('button','用一道题练习 →','button secondary');btn.onclick=()=>{selectPuzzle(p.id);view('training');};card.append(el('br'),btn);}$('knowledge-list').append(card);}}
function download(data,filename){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function compareText(result){const warning=result.engineWarning?`\n\n${result.engineWarning}`:'';if(result.source!=='model')return(result.message||'本次未产生通过校验的模型结果。')+warning;return `${result.observation}\n\n${result.reason}\n\n再练：${result.practice}\n\n引用：${result.evidenceIds.join('、')}\n模型：${result.model}\n耗时：${(result.elapsedMs/1000).toFixed(1)} 秒\n结构与坐标已检查；语义待人工评阅。${warning}`;}
async function compare() {
  if (!canUseModel() || state.modelBusy) return;
  const id = $('eval-select').value, modelSettings = state.modelSession.requestSettings();
  setModelBusy(true); $('eval-select').disabled = true; $('export-eval-button').disabled = true; state.comparison = null;
  $('eval-status').textContent = '正在运行两次实际调用，请稍候；通常需 15–80 秒。';
  setModelStatus('pending', `对照调用中：${modelSettings.model}（2 次请求）`);
  for (const name of ['baseline','customized']) { $(`${name}-result`).className = 'empty-small'; $(`${name}-result`).textContent = '等待实际调用'; }
  try {
    const result = await api('/api/compare', { id, modelSettings }); state.comparison = result;
    for (const name of ['baseline','customized']) { $(`${name}-result`).className = 'compare-content'; $(`${name}-result`).textContent = compareText(result[name]); }
    const complete = result.baseline.source === 'model' && result.customized.source === 'model';
    $('eval-status').textContent = (complete ? `调用成功，已记录 ${new Date(result.createdAt).toLocaleString()} 的实际输出。请人工评阅，尚未生成质量得分。` : '部分调用失败：有输出未通过校验，已明确回退教案，可导出诊断记录。') + (result.engineWarning || '');
    setModelStatus(complete ? 'success' : 'error', (complete ? `对照调用成功：${modelSettings.model}，两份真实输出已返回。` : '对照调用失败：至少一份输出未通过校验。') + (result.engineWarning || ''));
    $('export-eval-button').disabled = false;
  } catch (error) { $('eval-status').textContent = `调用失败：${error.message}`; setModelStatus('error', `对照调用失败：${error.message}`); }
  finally { setModelBusy(false); $('eval-select').disabled = false; }
}
async function init(){try{
  const [health,puzzles,knowledge]=await Promise.all([api('/api/health'),api('/api/puzzles'),api('/api/knowledge')]);state.health=health;state.modelSession=createModelSession();state.puzzles=puzzles.puzzles;state.knowledge=knowledge.knowledge;await loadRecords();
  $('model-select').value='deepseek-flash';
  $('engine-status').textContent=health.engine?'● Pikafish 已就绪':'○ 引擎未配置';$('engine-status').className=health.engine?'ready':'offline';
  $('ai-caption').textContent='请点击右上角 API 设置输入密钥；教案与训练仍可使用。';
  syncApiSummary();setModelStatus('idle','默认模型 deepseek-flash · 请在 API 设置中输入密钥。');
  $('settings-status').textContent=`${health.engine?'引擎文件已就绪':'引擎文件未就绪'} · 模型密钥需在本页输入${health.needsToken?' · 接口需要访问口令':''}`;
  for(const puzzle of state.puzzles){const option=el('option',`${puzzle.course==='endgame'?'残局':'基础'} · ${puzzle.title}`);option.value=puzzle.id;$('eval-select').append(option);}
  for(const node of document.querySelectorAll('[data-course]'))node.onclick=()=>{state.course=node.dataset.course;state.theme='all';renderCurriculum();if(!visiblePuzzles().some(p=>p.id===state.current.id))selectPuzzle(visiblePuzzles()[0].id);refreshModelControls();};
  $('theme-filter').onchange=event=>{state.theme=event.target.value;renderCurriculum();if(!visiblePuzzles().some(p=>p.id===state.current.id))selectPuzzle(visiblePuzzles()[0].id);refreshModelControls();};
  selectPuzzle(state.puzzles[0].id);renderKnowledge();
  importLab=mountImportLab({api,canUseModel,modelSettings:()=>state.modelSession.requestSettings(),modelBusy:()=>state.modelBusy,setModelBusy,setModelStatus,openApiDialog,exampleFen:state.puzzles.find(p=>p.id==='ending-ladder-two').fen});
  for(const item of document.querySelectorAll('[data-view]'))item.onclick=()=>view(item.dataset.view);
  document.querySelector('.brand').onclick=event=>{event.preventDefault();view('training');};
  $('puzzle-select').onchange=event=>selectPuzzle(event.target.value);$('next-top').onclick=nextPuzzle;$('next-button').onclick=nextPuzzle;$('reset-button').onclick=()=>selectPuzzle(state.current.id);$('flip-button').onclick=()=>{state.flipped=!state.flipped;renderBoard();};$('hint-button').onclick=hint;$('lesson-button').onclick=lesson;$('ai-button').onclick=aiCoach;$('engine-button').onclick=engine;$('compare-button').onclick=compare;
  $('settings-button').onclick=()=>$('settings-dialog').showModal();$('save-token').onclick=()=>{state.token=$('access-token').value;$('access-token').value='';toast('访问口令已应用，仅保存在当前页面内存。');};
  $('api-settings-button').onclick=openApiDialog;
  $('open-api-from-settings').onclick=()=>{$('settings-dialog').close();openApiDialog();};
  $('apply-api-button').onclick=()=>{if(!state.modelBusy)applyApiSettings();};
  $('test-api-button').onclick=testApiConnection;
  $('clear-api-button').onclick=()=>{
    state.modelSession.clear();$('api-key-input').value='';syncApiSummary();
    state.comparison=null;$('export-eval-button').disabled=true;
    importLab?.clearExplanation();
    if($('report-title').textContent==='AI 复盘讲解')$('report-panel').hidden=true;
    setModelStatus('idle','页面密钥已清除，模型调用已停用；请重新输入 API Key。');
    $('ai-caption').textContent='模型调用已停用，请重新设置 API。';
  };
  for(const id of ['api-key-input','model-select'])$(id).addEventListener('input',()=>{$('api-test-status').dataset.state='idle';$('api-test-status').textContent='设置已修改，尚未应用或测试。';});
  $('api-dialog').addEventListener('close',()=>{$('api-key-input').value='';});
  // A mobile-accessible entry point: clicking either connection badge opens settings.
  $('engine-status').role='button';$('engine-status').tabIndex=0;$('model-status').role='button';$('model-status').tabIndex=0;
  for(const id of ['engine-status','model-status']){const open=id==='model-status'?openApiDialog:()=>$('settings-dialog').showModal();$(id).onclick=open;$(id).onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};}
  $('export-button').onclick=async()=>{try{await refreshRecords();download({app:'qili-study',version:1,exportedAt:new Date().toISOString(),records:state.records},'棋理学伴-学习记录.json');}catch{toast('记录读取失败，请刷新页面后重试导出。');}};
  $('export-eval-button').onclick=()=>{if(state.comparison)download(state.comparison,'棋理学伴-实际对照结果.json');};
  $('import-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>100000)throw new Error('记录文件不能超过 100 KB。');const data=JSON.parse(await file.text());if(data.app!=='qili-study'||data.version!==1)throw new Error('这不是受支持的棋理学伴记录。');const imported=sanitizeRecords(data.records);if(!confirm('将导入记录合并到本机；同一题以导入记录为准。是否继续？'))return;if(learningStore){await learningStore.importRecords(imported);await refreshRecords();signalRecordsChanged();$('data-status').textContent='记录已导入并保存。';}else{state.records={...state.records,...imported};updateStats();$('data-status').textContent='记录已导入当前页面，持久保存不可用，请保留导出备份。';}}catch(error){$('data-status').textContent=error.message;}finally{event.target.value='';}};
  const initial=location.hash.slice(1);view(['training','import','mistakes','knowledge','evaluation'].includes(initial)?initial:'training');
}catch(error){feedback(`初始化失败：${error.message}`,'error');toast('加载失败，请确认本地服务正在运行并刷新页面。');}}
init();
