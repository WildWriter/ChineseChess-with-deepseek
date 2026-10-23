export function cellInkColor(pixels,row,col) {
  const {width,height,data}=pixels,cx=(col+.5)*width/9,cy=(row+.5)*height/10,radius=Math.min(width/9,height/10)*.28;
  const samples=[];
  for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(height,cy+radius);y++)for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(width,cx+radius);x++){
    if((x-cx)**2+(y-cy)**2>radius**2)continue;const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];samples.push({r,g,b,l:r*.299+g*.587+b*.114});
  }
  const sorted=samples.map(s=>s.l).sort((a,b)=>a-b),background=sorted[Math.floor(sorted.length*.85)];
  let red=0,neutral=0;
  for(const {r,g,b,l}of samples){
    if(l>background-40)continue;
    if(r-g>30&&r>b*1.25&&r>g*1.35)red++;
    else if(Math.max(r,g,b)-Math.min(r,g,b)<Math.max(48,Math.max(r,g,b)*.4))neutral++;
  }
  const min=samples.length*.035;
  return {side:red>min&&red>neutral*1.4?'w':neutral>min&&neutral>red*2?'b':null,red,neutral,density:(red+neutral)/samples.length};
}

// A second view of the SAME glyph, without the disk/frame. Never infer a type
// from this mask; the full colour crop is kept alongside it for transcription.
export function cellGlyphPixels(pixels,row,col){
  const size=68,cx=(col+.5)*pixels.width/9,cy=(row+.5)*pixels.height/10,scale=Math.min(pixels.width/9,pixels.height/10)*.68/size;
  const samples=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=Math.max(0,Math.min(pixels.width-1,Math.round(cx+(x-size/2)*scale))),sy=Math.max(0,Math.min(pixels.height-1,Math.round(cy+(y-size/2)*scale))),i=(sy*pixels.width+sx)*4;
    const r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2];samples.push(r*.299+g*.587+b*.114);
  }
  const sorted=samples.slice().sort((a,b)=>a-b),threshold=sorted[Math.floor(sorted.length*.85)]-38,data=new Uint8ClampedArray(size*size*4);
  for(let i=0;i<samples.length;i++){const x=i%size-size/2,y=Math.floor(i/size)-size/2,value=x*x+y*y>(size*.49)**2||samples[i]>threshold?255:0;data.set([value,value,value,255],i*4);}
  return {width:size,height:size,data};
}
