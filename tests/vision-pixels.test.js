import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {warpGridPixels} from '../public/vision-grid.js';
import {cellInkColor,cellGlyphPixels} from '../public/vision-pixels.js';
import {buildMappedCells} from '../public/vision-cells.js';
import {mergeMappedCells} from '../src/position-vision.js';
import {parseFen,createEmptyBoard,boardToFen} from '../public/vendor/xiangqi.js';

const fixture=JSON.parse(await readFile(new URL('./fixtures/vision-board.json',import.meta.url),'utf8'));
const source=PNG.sync.read(Buffer.from(fixture.parts.join(''),'base64'));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=';
const corners=[{x:31/457,y:34/509},{x:431/457,y:34/509},{x:431/457,y:485/509},{x:31/457,y:485/509}];
const expected=createEmptyBoard();
for(const [square,piece]of Object.entries(fixture.expectedPieces))expected[9-Number(square[1])]['abcdefghi'.indexOf(square[0])]=piece;
const createCanvas=()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){},fillText(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}),toDataURL:()=>image});

test('actual screenshot pixels preserve all ten piece colors at fixed intersections and repair reversed model colors',()=>{
  const canvas={width:source.width,height:source.height,getContext:()=>({getImageData:()=>source})};
  const cells=buildMappedCells(canvas,corners,createCanvas);
  const answers=new Map(cells.map((cell,n)=>[cell.id,expected[Math.floor(n/9)][n%9]]));
  for(const [square,piece]of Object.entries(fixture.expectedPieces)){
    const row=9-Number(square[1]),col='abcdefghi'.indexOf(square[0]),id='G'+String(row*9+col).padStart(2,'0'),cell=cells[row*9+col];
    assert.equal(cell.id,id);assert.equal(cell.inkSide,piece===piece.toUpperCase()?'w':'b',square);
    answers.set(id,piece===piece.toUpperCase()?piece.toLowerCase():piece.toUpperCase());
  }
  const result=mergeMappedCells(cells,answers,null,'red-bottom','w');
  assert.equal(result.fen,boardToFen(expected));assert.equal(result.reviewCells.length,10);
  assert.equal(parseFen(result.fen).board[2][4],'k');assert.equal(parseFen(result.fen).board[9][4],'K');
});
test('padding around a screenshot does not change manual-grid mapping or piece colors',()=>{
  const left=57,top=83,width=source.width+134,height=source.height+160,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<source.height;y++)data.set(source.data.subarray(y*source.width*4,(y+1)*source.width*4),((y+top)*width+left)*4);
  const padded=corners.map(p=>({x:(p.x*(source.width-1)+left)/(width-1),y:(p.y*(source.height-1)+top)/(height-1)}));
  const pixels=warpGridPixels({width,height,data},padded);
  for(const [square,piece]of Object.entries(fixture.expectedPieces))assert.equal(cellInkColor(pixels,9-Number(square[1]),'abcdefghi'.indexOf(square[0])).side,piece===piece.toUpperCase()?'w':'b',square);
});
test('explicit black-bottom rotation maps IDs exactly once and leaves unknown cells editable',()=>{
  const cells=Array.from({length:90},(_,n)=>({id:'G'+String(n).padStart(2,'0'),inkSide:null,inkDensity:0}));
  const picture=expected.slice().reverse().map(r=>r.slice().reverse());
  const answers=new Map(cells.map((c,n)=>[c.id,picture[Math.floor(n/9)][n%9]]));
  const result=mergeMappedCells(cells,answers,null,'black-bottom','b');
  assert.equal(result.fen,boardToFen(expected,'b'));
  answers.delete('G00');const partial=mergeMappedCells(cells,answers,null,'black-bottom','b');
  assert.equal(partial.reviewCells[0].square,'i0');assert.equal(partial.reviewCells[0].selected,'.');
});
test('glyph contrast view retains different actual king and elephant letter shapes without colouring them as new pieces',()=>{
  const pixels=warpGridPixels(source,corners),king=cellGlyphPixels(pixels,9,4),elephant=cellGlyphPixels(pixels,9,6);
  assert.equal(king.width,68);assert.equal(king.height,68);
  for(const glyph of [king,elephant]){
    let dark=0;for(let i=0;i<glyph.data.length;i+=4){assert.ok(glyph.data[i]===0||glyph.data[i]===255);if(!glyph.data[i])dark++;assert.equal(glyph.data[i],glyph.data[i+1]);}
    assert.ok(dark>80&&dark<68*68/2);
  }
  assert.notDeepEqual(king.data,elephant.data);
});
