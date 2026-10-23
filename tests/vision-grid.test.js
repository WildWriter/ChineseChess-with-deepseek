import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { validateGridCorners, gridProjection, warpGridPixels, buildCellSheets, mountGridEditor } from '../public/vision-grid.js';
import { parseBoardLocation, parseCellSheet, mergeCellRecognition, locatePositionImage, recognizePositionImage, parseMappedAnswer, mergeMappedCells, inferBoardOrientation } from '../src/position-vision.js';
import { mountImportLab } from '../public/import-lab.js';
import { parseFen } from '../public/vendor/xiangqi.js';
import { findPuzzle } from '../src/puzzles.js';
import { createApp } from '../server.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=';
const settings={source:'session',apiKey:'vision-fixture-not-real',model:'deepseek-flash'};
const corners=[{x:.1,y:.1},{x:.9,y:.08},{x:.86,y:.92},{x:.12,y:.9}];
const fen=findPuzzle('ending-ladder-two').fen, rows=parseFen(fen).board.map(r=>r.join(''));
const cells=(start,input=rows)=>Array.from({length:45},(_,n)=>({row:start+Math.floor(n/9),col:n%9,piece:input[start+Math.floor(n/9)][n%9]}));
const response=data=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});
const sheets=[{rowStart:0,image},{rowStart:5,image}];
const params={imageConsent:true,modelSettings:settings};

test('generic perspective grid maps all four outer intersections and rejects crossed/tiny/outside bounds',()=>{
  for(const quad of [corners,[{x:.02,y:.04},{x:.97,y:.04},{x:.97,y:.95},{x:.02,y:.95}]]){
    assert.equal(validateGridCorners(quad),quad);const p=gridProjection(quad);
    for(const [i,u,v] of [[0,0,0],[1,1,0],[2,1,1],[3,0,1]]){assert.ok(Math.abs(p(u,v).x-quad[i].x)<1e-9);assert.ok(Math.abs(p(u,v).y-quad[i].y)<1e-9);}
  }
  for(const bad of [[],corners.map(p=>({...p,x:p.x+2})),[corners[0],corners[2],corners[1],corners[3]],corners.map(p=>({x:p.x/20,y:p.y/20}))])assert.throws(()=>validateGridCorners(bad));
});
test('local warp centers the 90 intersections and preserves color channels without trimming edge pieces',()=>{
  const width=91,height=101,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([x,y,170,255],(y*width+x)*4);
  const quad=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
  const result=warpGridPixels({width,height,data},quad,90,100);
  for(const [x,y,sx,sy]of [[5,5,9,10],[85,95,81,90],[45,55,45,54]]){
    const actual=result.data.slice((y*90+x)*4,(y*90+x)*4+4);
    assert.ok(Math.abs(actual[0]-sx)<=1);assert.ok(Math.abs(actual[1]-sy)<=1);assert.equal(actual[2],170);assert.equal(actual[3],255);
  }
  assert.throws(()=>warpGridPixels({width,height,data},quad,4000,4000));
});
test('locator validates structured bounds and orientation, tolerates missing coarse rows without fabricating pieces',async()=>{
  const result=await locatePositionImage({...params,image},async(url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(options.body).messages[1].content[1].image_url.url,image);
    return response({found:true,corners,orientation:'black-bottom',rows});
  });
  assert.deepEqual(result.referenceRows,rows);assert.deepEqual(result.corners,corners);assert.equal(result.orientation,'black-bottom');
  assert.equal(parseBoardLocation({found:true,corners,orientation:'unknown'}).referenceRows,null);
  for(const data of [{found:false},{found:true,corners:[],orientation:'red-bottom'},{found:true,corners,orientation:'sideways'}])assert.throws(()=>parseBoardLocation(data),{status:502});
  await assert.rejects(()=>locatePositionImage({...params,imageConsent:false,image},()=>assert.fail()),{status:400});
  assert.ok(!JSON.stringify(result).includes('base64'));assert.ok(!JSON.stringify(result).includes(settings.apiKey));
});
test('cell parser rejects relabelled positions and duplicates; unknown or omitted cells remain reviewable',()=>{
  for(const bad of [{cells:[{row:5,col:0,piece:'.'}]},{cells:[{row:0,col:9,piece:'.'}]},{cells:[{row:0,col:0,piece:'将'}]},{cells:[{row:0,col:0,piece:'.'},{row:0,col:0,piece:'.'}]}])assert.throws(()=>parseCellSheet(bad,0),{status:502});
  const maps=[parseCellSheet({cells:cells(0)},0),parseCellSheet({cells:cells(5)},5)];
  maps[0].set(0,'R');maps[1].delete(89);
  const result=mergeCellRecognition(maps,rows,'black-bottom','b');
  assert.equal(result.reviewCells.length,2);
  assert.equal(result.reviewCells.find(c=>c.tile==='R').square,'i0');
  assert.equal(result.reviewCells.find(c=>c.tile==='?').square,'a9');
  assert.equal(parseFen(result.fen).board[9][8],'R');
  assert.equal(result.requiresConfirmation,true);
});
test('enhanced recognition uses two labelled crops, marks partial failures and never retries or leaks provider data',async()=>{
  let count=0;
  const result=await recognizePositionImage({...params,sheets,referenceRows:rows,recognitionMode:'enhanced'},async(url,options)=>{
    count++;const text=JSON.parse(options.body).messages[1].content[0].text;
    if(text.includes('第0至4行'))return response({cells:cells(0)});
    return {ok:false,status:401};
  });
  assert.equal(count,2);assert.equal(result.reviewCells.length,45);assert.match(result.warnings.join(' '),/部分/);
  assert.ok(!JSON.stringify(result).includes(settings.apiKey));
  let requested=0;
  await assert.rejects(()=>recognizePositionImage({...params,sheets:[sheets[0]],recognitionMode:'enhanced'},async()=>{requested++;}),{status:400});
  assert.equal(requested,0);
  await assert.rejects(()=>recognizePositionImage({...params,sheets,recognitionMode:'enhanced'},async()=>({ok:false,status:401})),/均未能识别/);
});
test('unknown tiles do not silently become verified empty squares; identical passes still require user confirmation',()=>{
  const result=mergeCellRecognition([new Map(),new Map()],null,'red-bottom','w');
  assert.equal(result.reviewCells.length,90);assert.ok(result.reviewCells.every(c=>c.tile==='?'&&c.whole==='?'));
  const known=mergeCellRecognition([parseCellSheet({cells:cells(0)},0),parseCellSheet({cells:cells(5)},5)],rows,'red-bottom','w');
  assert.equal(known.fen,fen);assert.equal(known.reviewCells.length,0);assert.equal(known.requiresConfirmation,true);assert.match(known.warnings[0],/一致不代表准确/);
});
async function page(t,{partialFailure=false}={}){
  const upstream=[],draws=[];
  const server=createApp({engineReady:()=>false,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body),content=body.messages[1].content;upstream.push(content);
    const ids=content.filter(c=>c.type==='text').flatMap(c=>[...c.text.matchAll(/唯一图片编号 (G\d{2})/g)].map(m=>m[1]));
    if(partialFailure&&ids[0]==='G00')return {ok:false,status:503};
    return response({cells:ids.map(id=>{const n=Number(id.slice(1));return {id,piece:rows[Math.floor(n/9)][n%9]};})});
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:base});
  const saved={document:globalThis.document,Option:globalThis.Option,createImageBitmap:globalThis.createImageBitmap};
  globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
  globalThis.createImageBitmap=async()=>({width:200,height:240,close(){}});
  dom.window.HTMLCanvasElement.prototype.getContext=function(){return {fillRect(){},drawImage(...args){draws.push(args);},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},fillText(){},getImageData:(x,y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}),createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){}};};
  dom.window.HTMLCanvasElement.prototype.toDataURL=()=>image;
  let busy=false;const $=id=>document.getElementById(id);
  const api=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;};
  mountImportLab({api,canUseModel:()=>true,modelSettings:()=>settings,modelBusy:()=>busy,setModelBusy:value=>{busy=value;},setModelStatus(){},openApiDialog(){assert.fail('unexpected settings prompt');},exampleFen:fen});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));dom.window.close();Object.assign(globalThis,saved);});
  await $('position-image-file').onchange({target:{files:[{type:'image/png',size:1000,name:'any-board.png'}],value:''}});
  const align=()=>{for(let i=0;i<4;i++){$('position-grid-corner').value=String(i);$('position-grid-corner').onchange({target:$('position-grid-corner')});$('position-grid-x').value=String(corners[i].x*100);$('position-grid-y').value=String(corners[i].y*100);$('position-grid-x').oninput();}};
  return {$,dom,upstream,draws,api,align};
}
test('manual crop reads fixed cells then independently reviews glyphs without per-cell approvals',async t=>{
  const {$,upstream,draws,align}=await page(t);
  assert.equal(upstream.length,0);assert.equal($('position-grid-panel').open,true);
  assert.equal($('position-recognize').disabled,true);
  assert.equal($('position-vision-mode'),null);assert.equal($('position-grid-confirm'),null);assert.equal($('position-review'),null);
  $('position-image-consent').checked=true;$('position-image-consent').onchange();
  assert.equal($('position-recognize').disabled,true);align();assert.equal($('position-recognize').disabled,false);
  await $('position-recognize').onclick();
  assert.equal(upstream.length,3);
  assert.deepEqual(upstream.slice(0,2).map(c=>c.filter(p=>p.type==='image_url').length),[45,45]);
  assert.ok(upstream[2].filter(p=>p.type==='image_url').length<=36);
  assert.equal(draws.filter(args=>args.length===9).length,180);
  assert.equal($('position-fen').value,fen);
  assert.equal($('position-confirm').disabled,false);
  $('position-confirm').checked=true;$('position-confirm').onchange();assert.equal($('position-solve').disabled,false);
});
test('partially failed recognition leaves an editable draft without mandatory per-cell confirmations',async t=>{
  const {$,upstream,align}=await page(t,{partialFailure:true});
  align();$('position-image-consent').checked=true;await $('position-recognize').onclick();
  assert.equal(upstream.length,2);assert.match($('position-status').textContent,/45 个位置识别不确定/);
  assert.equal($('position-confirm').disabled,false);assert.equal($('position-review'),null);
  document.querySelector('[data-import-piece="k"]').click();$('position-board').querySelector('[data-import-square="e9"]').onclick();
  assert.equal(parseFen($('position-fen').value).board[0][4],'k');
});
test('four-corner outline and grid redraw during pointer drags and coordinate input',()=>{
  const operations=[],ctx={drawImage(){},beginPath(){operations.push('path');},moveTo(x,y){operations.push(['move',x,y]);},lineTo(x,y){operations.push(['line',x,y]);},stroke(){operations.push(['stroke',this.strokeStyle,this.lineWidth]);},arc(){},fill(){},fillText(){}};
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:200,height:240}),setPointerCapture(){}};
  let updates=0,locked=false;
  const editor=mountGridEditor(canvas,()=>updates++,()=>locked);editor.load({width:200,height:240});
  const e=(x,y)=>({clientX:x,clientY:y,pointerId:1,button:0,preventDefault(){}});
  canvas.onpointerdown(e(20,20));canvas.onpointermove(e(25,25));
  assert.equal(editor.corners()[0].x,.125);assert.ok(updates>=3);
  assert.ok(operations.some(o=>Array.isArray(o)&&o[0]==='stroke'&&o[1]==='#fff'));
  assert.ok(operations.some(o=>Array.isArray(o)&&o[0]==='stroke'&&o[1]==='#008a77'));
  canvas.onpointerup(e(25,25));
  for(let i=0;i<4;i++){editor.select(i);editor.update(corners[i].x,corners[i].y);}
  assert.equal(editor.ready(),true);
  const snapshot=editor.corners();locked=true;editor.update(0,0);assert.deepEqual(editor.corners(),snapshot);
});
const mapped=()=>Array.from({length:90},(_,n)=>({id:'G'+String(n).padStart(2,'0'),image,inkSide:null,inkDensity:0}));
test('mapped IDs own board positions; model row hints and output order cannot rotate or shift them',async()=>{
  const inputs=mapped(),requests=[];
  const result=await recognizePositionImage({...params,cells:inputs,recognitionMode:'mapped',orientation:'red-bottom'},async(url,options)=>{
    const content=JSON.parse(options.body).messages[1].content;requests.push(content);
    const ids=content.filter(p=>p.type==='text').flatMap(p=>[...p.text.matchAll(/唯一图片编号 (G\d{2})/g)].map(m=>m[1]));
    return response({cells:ids.reverse().map(id=>{const n=Number(id.slice(1));return{id,piece:rows[Math.floor(n/9)][n%9],row:9-Math.floor(n/9),col:8-n%9};})});
  });
  assert.equal(result.fen,fen);assert.equal(requests.length,3);
  assert.ok(!JSON.stringify(result).includes(settings.apiKey));assert.ok(!JSON.stringify(result).includes('base64'));
  assert.throws(()=>parseMappedAnswer({cells:[{id:'G90',piece:'k'}]},['G00']),{status:502});
  assert.throws(()=>parseMappedAnswer({cells:[{id:'G00',piece:'k'},{id:'G00',piece:'k'}]},['G00','G01']),{status:502});
  const wrong=mapped();wrong[1].id='G00';
  await assert.rejects(()=>recognizePositionImage({...params,cells:wrong,recognitionMode:'mapped',orientation:'red-bottom'},()=>assert.fail()),{status:400});
});
test('direction follows explicit selection and only uses opposite palaces when automatic is requested',()=>{
  assert.equal(inferBoardOrientation(rows,'red-bottom').orientation,'red-bottom');
  assert.equal(inferBoardOrientation(rows,'auto').orientation,'red-bottom');
  assert.equal(inferBoardOrientation(rows.map(r=>[...r].reverse().join('')).reverse(),'auto').orientation,'black-bottom');
  assert.throws(()=>inferBoardOrientation(Array(10).fill('.........'),'auto'),{status:502});
});
