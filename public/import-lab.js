import { createEmptyBoard, boardToFen, parseFen, pieceName, pieceSide } from './vendor/xiangqi.js';

const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function svg(tag, attrs) { const node = document.createElementNS(NS, tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value); return node; }

export function mountImportLab({ api, canUseModel, modelSettings, modelBusy, setModelBusy, setModelStatus, openApiDialog, exampleFen }) {
  let board = createEmptyBoard(), turn = 'w', brush = 'R', image = null, pending = false, report = null, explanation = null, playback = 0;
  const currentFen = () => boardToFen(board, turn);
  const status = (message, kind = 'idle') => { $('position-status').textContent = message; $('position-status').dataset.state = kind; };
  function clearExplanation() { explanation = null; $('position-ai-report').hidden = true; }
  function resetResult() { report = null; playback = 0; clearExplanation(); $('position-report').hidden = true; $('position-confirm').checked = false; }
  function changed(message = '局面已修改，请重新核对棋盘并确认。') { resetResult(); $('position-fen').value = currentFen(); status(message); renderBoard(); refresh(); }
  function refresh() {
    const locked = pending || modelBusy();
    for (const id of ['position-image-file','position-orientation','position-turn','position-image-consent','position-confirm','position-depth','position-load-fen','position-example','position-clear','position-rotate','position-fen','position-origin','position-playback']) $(id).disabled = locked;
    for (const node of document.querySelectorAll('[data-import-piece]')) node.disabled = locked;
    $('position-recognize').disabled = locked || !image || !$('position-image-consent').checked;
    $('position-solve').disabled = locked || !$('position-confirm').checked;
    $('position-explain').disabled = locked || !report?.recommendation || !canUseModel();
    $('position-export').disabled = locked || !report;
  }
  function renderBoard() {
    const root = $('position-board'), focused = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-import-square') : null;
    let shown = board, shownTurn = turn;
    if (report && playback > 0) { const position = parseFen(report.line[playback-1].afterFen); shown = position.board; shownTurn = position.turn; }
    const ended=report&&playback>0&&report.line[playback-1].outcome.state!=='playing';
    $('position-board-turn').textContent = ended ? `局面结束 · ${report.line[playback-1].outcome.reason}` : `${shownTurn === 'w' ? '红方' : '黑方'}行棋${playback ? ` · 线路第 ${playback} 步` : ' · 原局面'}`;
    root.replaceChildren();
    const line = (x1,y1,x2,y2) => root.append(svg('line',{x1,y1,x2,y2,stroke:'#aa9370','pointer-events':'none'}));
    const x0=62,y0=65,s=52;
    for(let r=0;r<10;r++)line(x0,y0+r*s,x0+8*s,y0+r*s);
    for(let c=0;c<9;c++){line(x0+c*s,y0,x0+c*s,y0+4*s);line(x0+c*s,y0+5*s,x0+c*s,y0+9*s);}
    line(x0,y0+4*s,x0,y0+5*s);line(x0+8*s,y0+4*s,x0+8*s,y0+5*s);
    for(const r of [0,7]){line(x0+3*s,y0+r*s,x0+5*s,y0+(r+2)*s);line(x0+5*s,y0+r*s,x0+3*s,y0+(r+2)*s);}
    for(let c=0;c<9;c++){const t=svg('text',{x:x0+c*s,y:575,'text-anchor':'middle',class:'coord-label'});t.textContent='abcdefghi'[c];root.append(t);}
    for(let r=0;r<10;r++){const t=svg('text',{x:25,y:y0+r*s+4,'text-anchor':'middle',class:'coord-label'});t.textContent=9-r;root.append(t);}
    for(const [text,x]of [['楚 河',170],['汉 界',370]]){const t=svg('text',{x,y:304,'text-anchor':'middle',fill:'#b39b75','font-size':20});t.textContent=text;root.append(t);}
    for(let r=0;r<10;r++)for(let c=0;c<9;c++){
      const piece=shown[r][c],square=`${'abcdefghi'[c]}${9-r}`,x=x0+c*s,y=y0+r*s;
      const node=svg('g',{role:'button',class:'board-cell',tabindex:focused===square||(!focused&&square==='e0')?'0':'-1','data-import-square':square,'aria-label':`${piece==='.'?'空位':(pieceSide(piece)==='w'?'红':'黑')+pieceName(piece)} ${square}`});
      node.append(svg('rect',{x:x-25,y:y-25,width:50,height:50,fill:'transparent'}));
      if(piece!=='.'){node.append(svg('circle',{cx:x,cy:y,r:22,fill:'#fff8e6',stroke:'#bba079'}));const t=svg('text',{x,y:y+.5,class:'piece-text',fill:pieceSide(piece)==='w'?'#b44e3c':'#405047'});t.textContent=pieceName(piece);node.append(t);}
      const place=()=>{if(pending||modelBusy())return;if(playback){status('当前正在演示解法，请先点击“返回原局面”再校正棋子。');return;}board[r][c]=brush;changed();};
      node.onclick=place;
      node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();place();}const d={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];if(d){event.preventDefault();const nr=Math.max(0,Math.min(9,r+d[0])),nc=Math.max(0,Math.min(8,c+d[1]));node.setAttribute('tabindex','-1');const next=root.querySelector(`[data-import-square="${'abcdefghi'[nc]}${9-nr}"]`);next.setAttribute('tabindex','0');next.focus();}};
      root.append(node);
    }
    if(focused)root.querySelector(`[data-import-square="${focused}"]`)?.focus({preventScroll:true});
  }
  function renderReport() {
    $('position-report').hidden = false;
    $('position-proof-label').textContent = {proven:'已核验短连续将杀', 'not-found':'未找到指定范围内的连续将杀',limit:'搜索达到资源上限',terminal:'局面已经结束'}[report.proof.status];
    $('position-conclusion').textContent = report.conclusion;
    const engine=report.engine;
    $('position-engine-detail').textContent = `${report.engineWarning || ''}${engine ? `Pikafish 推荐 ${engine.bestMove}，深度 ${engine.depth}；${engine.score ? `${engine.score.type==='mate'?'引擎胜负距离（可能包含困毙）':'搜索分值'} ${engine.score.value}，原局面行棋方视角。` : ''}` : ''} 搜索节点 ${report.proof.nodes ?? '—'}；范围为行棋方 ${report.proof.maxMoves} 步内。`;
    $('position-playback').replaceChildren(new Option('原局面（可校正）','0'), ...report.line.map((item,index)=>new Option(`${index+1}. ${item.side}：${item.notation}（${item.move}）`,String(index+1))));
    $('position-line').replaceChildren(...report.line.map(item=>el('li',`${item.side}：${item.notation}（${item.move}）${item.outcome.reason ? ` · ${item.outcome.reason}` : ''}`)));
    $('position-evidence').replaceChildren(...report.evidence.map(item=>el('p',`${item.id} · ${item.text}`,'caption')));
    refresh();
  }
  for(const piece of ['K','A','B','N','R','C','P','k','a','b','n','r','c','p','.']){
    const button=el('button',piece==='.'?'擦除':`${pieceSide(piece)==='w'?'红':'黑'}${pieceName(piece)}`);
    button.type='button';button.dataset.importPiece=piece;button.setAttribute('aria-pressed',String(piece===brush));
    button.onclick=()=>{brush=piece;for(const b of $('position-palette').children)b.setAttribute('aria-pressed',String(b===button));};$('position-palette').append(button);
  }
  $('position-image-file').onchange = async event => {
    const file=event.target.files[0];if(!file)return;
    $('position-image-consent').checked=false;
    pending=true;refresh();status('正在本机读取并压缩图片…','pending');
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('请选择不超过 10 MB 的 PNG、JPEG 或 WebP 图片。');
      const bitmap=await createImageBitmap(file);
      if(bitmap.width*bitmap.height>40000000||bitmap.width<90||bitmap.height<100){bitmap.close();throw new Error('图片尺寸不适合识别，请使用清晰棋盘截图。');}
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const prepared=canvas.toDataURL('image/jpeg',.88);if(prepared.length>2000000)throw new Error('压缩后图片仍过大，请先裁剪为棋盘区域。');
      image=prepared;$('position-image-preview').src=image;$('position-image-preview').hidden=false;$('position-image-empty').hidden=true;
      $('position-image-name').textContent=`${file.name} · 发送尺寸 ${canvas.width}×${canvas.height}`;$('position-image-consent').checked=false;
      board=createEmptyBoard();changed('图片已在本机载入，尚未发送。确认方向、行棋方及发送授权后，可点击 AI 识别。');
    }catch(error){status(error.message,'error');}finally{pending=false;event.target.value='';refresh();}
  };
  $('position-file-button').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!pending&&!modelBusy())$('position-image-file').click();}};
  $('position-recognize').onclick=async()=>{
    if(pending||modelBusy()||!image||!$('position-image-consent').checked)return;
    if(!canUseModel()){openApiDialog();return;}
    const settings=modelSettings();if(settings.model!=='deepseek-flash'){status('图片识别需要 deepseek-flash，请在 API 设置切换模型。','error');openApiDialog();return;}
    pending=true;resetResult();setModelBusy(true);refresh();status('图片识别中，请等待；完成后必须核对棋盘。','pending');setModelStatus('pending','正在识别棋盘图片：deepseek-flash');
    try{const result=await api('/api/import/recognize',{image,orientation:$('position-orientation').value,turn,imageConsent:true,modelSettings:settings});board=parseFen(result.fen).board;$('position-fen').value=currentFen();renderBoard();status(`识别成功（${(result.elapsedMs/1000).toFixed(1)} 秒）。${result.validation.message} 可选择棋子后点棋盘校正。`,result.validation.ok?'success':'error');setModelStatus('success','图片识别调用成功：deepseek-flash；请人工核对棋盘。');}
    catch(error){status(`识别失败：${error.message} 可手动摆棋后继续求解。`,'error');setModelStatus('error',`图片识别失败：${error.message}`);}
    finally{pending=false;setModelBusy(false);refresh();}
  };
  $('position-example').onclick=()=>{const p=parseFen(exampleFen);board=p.board;turn=p.turn;image=null;$('position-image-preview').hidden=true;$('position-image-preview').removeAttribute('src');$('position-image-empty').hidden=false;$('position-image-empty').textContent='当前为示例残局，没有原图。';$('position-image-name').textContent='内置两步将杀示例（非图片识别结果）';$('position-image-consent').checked=false;$('position-turn').value=turn;changed('已载入两步将杀示例。请核对并勾选确认，然后点击求解；此操作不调用模型。');};
  $('position-clear').onclick=()=>{board=createEmptyBoard();changed('已清空当前摆棋。请从棋子选择区摆放完整残局。');};
  $('position-rotate').onclick=()=>{board=board.slice().reverse().map(row=>row.slice().reverse());changed();};
  $('position-turn').onchange=event=>{turn=event.target.value;changed('行棋方已修改，请重新确认局面。');};
  $('position-orientation').onchange=()=>{resetResult();status('原图方向已修改。请重新识别，或自行旋转并校正已有棋子。');renderBoard();refresh();};
  $('position-image-consent').onchange=refresh;$('position-confirm').onchange=refresh;
  $('position-depth').onchange=()=>{report=null;clearExplanation();playback=0;$('position-report').hidden=true;renderBoard();refresh();status('搜索范围已调整，可重新求解。');};
  $('position-origin').onclick=()=>{playback=0;$('position-playback').value='0';renderBoard();};
  $('position-playback').onchange=event=>{playback=Number(event.target.value);renderBoard();};
  $('position-load-fen').onclick=async()=>{if(pending||modelBusy())return;pending=true;refresh();try{const p=await api('/api/import/validate',{fen:$('position-fen').value.trim()});board=parseFen(p.fen).board;turn=p.turn;$('position-turn').value=turn;changed('FEN 已导入，请核对棋盘和行棋方后确认。');}catch(error){status(`FEN 导入失败：${error.message}`,'error');}finally{pending=false;refresh();}};
  $('position-fen').oninput=()=>{resetResult();renderBoard();refresh();status('FEN 文本已修改。请先点击“导入 FEN”，再核对棋盘。');};
  $('position-solve').onclick=async()=>{
    if(pending||modelBusy()||!$('position-confirm').checked)return;
    if($('position-fen').value.trim()!==currentFen()){status('FEN 文本尚未应用，请先点击“导入 FEN”。','error');return;}
    pending=true;report=null;playback=0;clearExplanation();$('position-report').hidden=true;refresh();status('正在核验局面、搜索短将杀并调用本地引擎…','pending');
    try{report=await api('/api/import/solve',{fen:currentFen(),maxMoves:Number($('position-depth').value)});renderReport();renderBoard();status(report.conclusion,report.proof.status==='proven'?'success':'idle');}
    catch(error){status(`求解失败：${error.message}`,'error');}
    finally{pending=false;refresh();}
  };
  $('position-explain').onclick=async()=>{
    if(pending||modelBusy()||!report?.recommendation)return;if(!canUseModel()){openApiDialog();return;}
    pending=true;clearExplanation();setModelBusy(true);refresh();status('正在根据已核验线路生成 AI 讲解…','pending');setModelStatus('pending','残局解法讲解调用中');
    try{explanation=await api('/api/import/explain',{fen:report.fen,maxMoves:report.proof.maxMoves,modelSettings:modelSettings()});$('position-ai-content').replaceChildren(el('p',explanation.observation),el('p',explanation.reason),el('p',`再想一想：${explanation.practice}`),el('p',`${explanation.model} · 引用 ${explanation.evidenceIds.join('、')} · ${explanation.semanticReview}`,'caption'));$('position-ai-report').hidden=false;status('AI 讲解成功，原始解法与证据仍保留。','success');setModelStatus('success',`残局讲解成功：${explanation.model} · ${(explanation.elapsedMs/1000).toFixed(1)} 秒`);}
    catch(error){status(`AI 讲解失败：${error.message}`,'error');setModelStatus('error',`残局讲解失败：${error.message}`);}
    finally{pending=false;setModelBusy(false);refresh();}
  };
  $('position-export').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify({app:'qili-import-analysis',version:1,report,explanation},null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='棋理学伴-导入残局分析.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('position-fen').value=currentFen();renderBoard();refresh();
  return { refresh, clearExplanation };
}
