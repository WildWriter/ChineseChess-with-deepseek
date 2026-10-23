import { warpGridPixels } from './vision-grid.js';
import { cellInkColor, cellGlyphPixels } from './vision-pixels.js';

// Position belongs to the program. Each image has ONE fixed opaque ID; the
// vision model cannot return row/column coordinates or rotate the board.
export function buildMappedCells(sourceCanvas,corners,createCanvas=()=>document.createElement('canvas')) {
  const ctx=sourceCanvas.getContext('2d',{willReadFrequently:true});
  const source=ctx.getImageData(0,0,sourceCanvas.width,sourceCanvas.height),pixels=warpGridPixels(source,corners);
  const normalized=createCanvas();normalized.width=pixels.width;normalized.height=pixels.height;
  const nctx=normalized.getContext('2d'),data=nctx.createImageData(pixels.width,pixels.height);data.data.set(pixels.data);nctx.putImageData(data,0,0);
  return Array.from({length:90},(_,index)=>{
    const row=Math.floor(index/9),col=index%9,canvas=createCanvas();canvas.width=384;canvas.height=216;
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,384,216);
    context.drawImage(normalized,col*100+3,row*100+3,94,94,0,0,192,192);
    const glyph=cellGlyphPixels(pixels,row,col),glyphCanvas=createCanvas();glyphCanvas.width=glyph.width;glyphCanvas.height=glyph.height;
    const gctx=glyphCanvas.getContext('2d'),gdata=gctx.createImageData(glyph.width,glyph.height);gdata.data.set(glyph.data);gctx.putImageData(gdata,0,0);
    context.imageSmoothingEnabled=false;context.drawImage(glyphCanvas,0,0,glyph.width,glyph.height,192,0,192,192);
    context.fillStyle='#222';context.font='14px sans-serif';context.textAlign='center';context.fillText('COLOR',96,208);context.fillText('GLYPH',288,208);
    const ink=cellInkColor(pixels,row,col);
    return {id:'G'+String(index).padStart(2,'0'),image:canvas.toDataURL('image/jpeg',.96),inkSide:ink.side,inkDensity:Number(ink.density.toFixed(3))};
  });
}
