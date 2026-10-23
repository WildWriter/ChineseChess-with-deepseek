import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createImportDraftStore } from '../public/import-draft.js';
import { mountImportLab } from '../public/import-lab.js';
import { createModelSession } from '../public/model-session.js';
import { findPuzzle } from '../src/puzzles.js';
import { searchImportedMate } from '../src/position-search.js';
import { buildImportedReport } from '../src/imported-position.js';
import { importedWalkthrough, explainImportedPosition } from '../src/position-coach.js';
import { detailedAnswer } from './model-fixture.js';

const fen = findPuzzle('ending-ladder-two').fen;
const settings = {apiKey:'draft-private-mock-only',model:'deepseek-flash'};
function memory() { const data=new Map(); return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}; }

test('tab drafts preserve work while omitting credentials at every object level', () => {
  const storage=memory(),store=createImportDraftStore(()=>storage);
  assert.equal(store.save({fen,inputFen:fen,playback:2,confirmed:true,modelSettings:settings,apiKey:settings.apiKey,report:{fen,modelSettings:settings,authorization:'private',line:[]}}),'full');
  const text=[...storage.data.values()][0]; assert.ok(!text.includes(settings.apiKey)); assert.ok(!text.includes('authorization'));
  const restored=store.load(); assert.equal(restored.fen,fen);assert.equal(restored.playback,2);assert.equal(restored.confirmed,true);
  assert.equal(restored.report.modelSettings,undefined); assert.equal(createImportDraftStore(()=>memory()).load(),null);
});

test('storage limits retain the board even when a picture and full analysis do not fit', () => {
  const storage=memory(),store=createImportDraftStore(()=>({...storage,setItem(key,value){if(value.includes('LARGE_PICTURE'))throw new Error('Quota');storage.setItem(key,value);}}));
  assert.equal(store.save({fen,image:'LARGE_PICTURE',report:{fen},explanation:{reason:'Large'}}),'position-only');
  const restored=store.load();assert.equal(restored.fen,fen);assert.equal(restored.image,null);assert.equal(restored.report,null);
  const blocked=createImportDraftStore(()=>{throw new Error('Storage disabled');});assert.equal(blocked.save({fen}),false);assert.equal(blocked.load(),null);
});

test('corrupt drafts cannot break page startup', () => {
  for(const raw of ['{',JSON.stringify({version:99,fen}),JSON.stringify({version:1,fen:'bad'})]) assert.equal(createImportDraftStore(()=>({getItem:()=>raw})).load(),null);
  const storage=memory(),store=createImportDraftStore(()=>storage);store.save({fen,image:'https://example.com/track.png'});assert.equal(store.load().image,null);
});

async function page(t, draft, api, hasKey = false) {
  const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'http://127.0.0.1:8791/#import'});
  const saved={document:globalThis.document,Option:globalThis.Option};globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
  if(draft)for(const [key,value] of draft)dom.window.sessionStorage.setItem(key,value);
  const session=createModelSession();if(hasKey)session.apply(settings);
  let busy=false;
  mountImportLab({api,canUseModel:()=>session.canCall(),modelSettings:()=>session.requestSettings(),modelBusy:()=>busy,setModelBusy:value=>{busy=value;},setModelStatus(){},openApiDialog(){assert.fail('Unexpected key prompt');},exampleFen:fen});
  t.after(()=>{dom.window.close();globalThis.document=saved.document;globalThis.Option=saved.Option;});
  return {dom,session,$:id=>dom.window.document.getElementById(id),save(){dom.window.dispatchEvent(new dom.window.Event('pagehide'));return Object.entries(dom.window.sessionStorage);},close(){dom.window.close();globalThis.document=saved.document;globalThis.Option=saved.Option;}};
}
function localReport() {const report=buildImportedReport(fen,searchImportedMate(fen,2));return {...report,walkthrough:importedWalkthrough(report)};}

test('reload restores reference playback and a completed DS explanation without calling the model or saving the key', async t => {
  const report=localReport();let calls=0;
  const first=await page(t,null,async(path)=>{
    if(path==='/api/import/solve')return report;
    assert.equal(path,'/api/import/explain');calls++;
    return explainImportedPosition(report,settings,async(url,options)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(detailedAnswer(JSON.parse(JSON.parse(options.body).messages[1].content)))}}]})}));
  },true);
  first.$('position-example').onclick();first.$('position-depth').value='2';first.$('position-confirm').checked=true;
  await first.$('position-solve').onclick();await first.$('position-explain').onclick();
  first.$('position-playback').value='2';first.$('position-playback').onchange({target:first.$('position-playback')});
  const draft=first.save();assert.ok(!JSON.stringify(draft).includes(settings.apiKey));first.close();
  const fresh=await page(t,draft,async()=>assert.fail('Reload must not call any API'));
  assert.equal(fresh.session.canCall(),false);assert.equal(fresh.$('position-fen').value,fen);
  assert.equal(fresh.$('position-report').hidden,false);assert.equal(fresh.$('position-playback').value,'2');
  assert.equal(fresh.$('position-ai-report').hidden,false);assert.match(fresh.$('position-walkthrough').querySelector('.teaching-source').textContent,/DS 逐步讲解/);
  assert.equal(fresh.$('position-explain').disabled,true);assert.equal(fresh.$('position-solve').getAttribute('aria-busy'),'false');assert.equal(calls,1);
});

test('reloading during analysis restores a usable board and reference line without a fake pending state or local teaching', async t => {
  const report=localReport();
  const first=await page(t,null,async path=>path==='/api/import/solve'?report:new Promise(()=>{}),true);
  first.$('position-example').onclick();first.$('position-confirm').checked=true;await first.$('position-solve').onclick();
  void first.$('position-explain').onclick();
  const draft=first.save();first.close();
  const fresh=await page(t,draft,async()=>assert.fail('No automatic retry after reload'));
  assert.equal(fresh.$('position-report').hidden,false);assert.equal(fresh.$('position-ai-report').hidden,true);
  assert.equal(fresh.$('position-walkthrough').textContent,'');assert.equal(fresh.$('position-solve').disabled,false);
  assert.equal(fresh.$('position-solve').getAttribute('aria-busy'),'false');assert.match(fresh.$('position-action-status').textContent,/已恢复/);
  fresh.$('position-clear').onclick(); const cleared=fresh.save();fresh.close();
  const empty=await page(t,cleared,async()=>assert.fail('No request on empty draft'));
  assert.equal(empty.$('position-fen').value,'9/9/9/9/9/9/9/9/9/9 w - - 0 1');assert.equal(empty.$('position-report').hidden,true);
});
