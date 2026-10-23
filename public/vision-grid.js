const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

export function validateGridCorners(points) {
  if (!Array.isArray(points) || points.length !== 4 || !points.every(finitePoint)) throw new Error('请将四个角点放在原图范围内。');
  const cross = (a, b, c) => (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
  if (points.some((p, i) => cross(p, points[(i+1)%4], points[(i+2)%4]) < .002)) throw new Error('四角必须按左上、右上、右下、左下顺序形成完整棋盘，不能交叉或挤在一起。');
  const area = Math.abs(points.reduce((sum,p,i) => sum + p.x*points[(i+1)%4].y-p.y*points[(i+1)%4].x, 0))/2;
  if (area < .05) throw new Error('定位的棋盘区域太小，请重新对齐最外侧交叉点。');
  return points;
}

// Project the unit square onto a convex quadrilateral. Corners refer to the
// outermost INTERSECTIONS, not the edge of the board frame or piece disks.
export function gridProjection(points) {
  validateGridCorners(points);
  const [a,b,c,d] = points, dx1=b.x-c.x, dx2=d.x-c.x, dx3=a.x-b.x+c.x-d.x;
  const dy1=b.y-c.y, dy2=d.y-c.y, dy3=a.y-b.y+c.y-d.y;
  const denominator=dx1*dy2-dx2*dy1;
  const g = Math.abs(dx3)+Math.abs(dy3)<1e-10 ? 0 : (dx3*dy2-dx2*dy3)/denominator;
  const h = Math.abs(dx3)+Math.abs(dy3)<1e-10 ? 0 : (dx1*dy3-dx3*dy1)/denominator;
  const ax=b.x-a.x+g*b.x, bx=d.x-a.x+h*d.x, ay=b.y-a.y+g*b.y, by=d.y-a.y+h*d.y;
  return (u,v) => { const w=g*u+h*v+1; return { x:(ax*u+bx*v+a.x)/w, y:(ay*u+by*v+a.y)/w }; };
}

export function warpGridPixels(source, corners, width=900, height=1000) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 2 || source.height < 2 || source.data?.length !== source.width*source.height*4 || !Number.isInteger(width) || !Number.isInteger(height) || width < 9 || height < 10 || width*height>1500000) throw new Error('棋盘图像尺寸无效。');
  const project=gridProjection(corners), data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=project((x/(width/9)-.5)/8,(y/(height/10)-.5)/9), sx=p.x*(source.width-1), sy=p.y*(source.height-1), index=(y*width+x)*4;
    if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<0||sx>source.width-1||sy<0||sy>source.height-1){data.set([255,255,255,255],index);continue;}
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,source.width-1),y1=Math.min(y0+1,source.height-1),fx=sx-x0,fy=sy-y0;
    for(let channel=0;channel<3;channel++)data[index+channel]=source.data[(y0*source.width+x0)*4+channel]*(1-fx)*(1-fy)+source.data[(y0*source.width+x1)*4+channel]*fx*(1-fy)+source.data[(y1*source.width+x0)*4+channel]*(1-fx)*fy+source.data[(y1*source.width+x1)*4+channel]*fx*fy;
    data[index+3]=255;
  }
  return {data,width,height};
}

export function buildCellSheets(sourceCanvas, corners, createCanvas=()=>document.createElement('canvas')) {
  const context=sourceCanvas.getContext('2d',{willReadFrequently:true}), source=context.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  const pixels=warpGridPixels(source,corners), normalized=createCanvas();normalized.width=pixels.width;normalized.height=pixels.height;
  const normalizedContext=normalized.getContext('2d'), imageData=normalizedContext.createImageData(pixels.width,pixels.height);imageData.data.set(pixels.data);normalizedContext.putImageData(imageData,0,0);
  return [0,5].map(rowStart=>{
    const canvas=createCanvas();canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,900,600);
    for(let row=rowStart;row<rowStart+5;row++)for(let col=0;col<9;col++){
      const x=col*100,y=(row-rowStart)*120;
      ctx.drawImage(normalized,col*100,row*100,100,100,x,y,100,100);
      ctx.fillStyle='#fff';ctx.fillRect(x,y+100,100,20);ctx.fillStyle='#111';ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.fillText(`r${row}c${col}`,x+50,y+116);
    }
    return {rowStart,image:canvas.toDataURL('image/jpeg',.94)};
  });
}

export function mountGridEditor(canvas, onChange, locked = () => false) {
  const defaults=()=>[{x:.08,y:.06},{x:.92,y:.06},{x:.92,y:.94},{x:.08,y:.94}];
  let source=null, points=defaults(), active=0, touched=new Set(), dragging=null;
  function notify(){onChange(points.map(p=>({...p})),active,touched.size);}
  function draw(){
    if(!source)return;const ctx=canvas.getContext('2d');
    canvas.width=source.width;canvas.height=source.height;ctx.drawImage(source,0,0);
    const trace=()=>{ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x*canvas.width,p.y*canvas.height));ctx.lineTo(points[0].x*canvas.width,points[0].y*canvas.height);};
    // Keep the outline visible even while the user temporarily crosses corners.
    trace();ctx.lineWidth=Math.max(5,canvas.width/140);ctx.strokeStyle='#fff';ctx.stroke();
    trace();ctx.lineWidth=Math.max(2,canvas.width/300);ctx.strokeStyle='#008a77';ctx.stroke();
    try{
      const p=gridProjection(points);ctx.lineWidth=Math.max(1,canvas.width/650);ctx.strokeStyle='#008a77bb';
      for(let row=1;row<9;row++){const a=p(0,row/9),b=p(1,row/9);ctx.beginPath();ctx.moveTo(a.x*canvas.width,a.y*canvas.height);ctx.lineTo(b.x*canvas.width,b.y*canvas.height);ctx.stroke();}
      for(let col=1;col<8;col++){const a=p(col/8,0),b=p(col/8,1);ctx.beginPath();ctx.moveTo(a.x*canvas.width,a.y*canvas.height);ctx.lineTo(b.x*canvas.width,b.y*canvas.height);ctx.stroke();}
    }catch{}
    points.forEach((p,index)=>{ctx.beginPath();ctx.fillStyle=index===active?'#b2493d':'#008a77';ctx.arc(p.x*canvas.width,p.y*canvas.height,Math.max(10,canvas.width/55),0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.font=`bold ${Math.max(14,canvas.width/55)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(index+1),p.x*canvas.width,p.y*canvas.height);});
  }
  function point(event){const r=canvas.getBoundingClientRect();return r.width&&r.height?{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))}:null;}
  canvas.onpointerdown=event=>{
    if(!source||locked()||event.button>0)return;
    const p=point(event);if(!p)return;event.preventDefault();
    const rect=canvas.getBoundingClientRect(),nearest=points.findIndex(v=>Math.hypot((p.x-v.x)*rect.width,(p.y-v.y)*rect.height)<24);
    dragging={id:event.pointerId,advance:nearest<0};if(nearest>=0)active=nearest;
    points[active]=p;touched.add(active);canvas.setPointerCapture?.(event.pointerId);draw();notify();
  };
  canvas.onpointermove=event=>{if(!dragging||dragging.id!==event.pointerId||locked())return;const p=point(event);if(p){points[active]=p;draw();notify();}};
  const finish=event=>{if(!dragging||dragging.id!==event.pointerId)return;if(dragging.advance)active=(active+1)%4;dragging=null;draw();notify();};
  canvas.onpointerup=finish;canvas.onpointercancel=finish;
  return {
    load(value,corners){source=value;active=0;touched=new Set(corners?[0,1,2,3]:[]);points=corners?validateGridCorners(corners).map(p=>({...p})):defaults();draw();notify();},
    select(index){if(locked())return;active=Math.max(0,Math.min(3,index));draw();notify();},
    update(x,y){if(locked()||!Number.isFinite(x)||!Number.isFinite(y))return;points[active]={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};touched.add(active);draw();notify();},
    ready(){try{return touched.size===4&&Boolean(validateGridCorners(points));}catch{return false;}},
    corners(){return points.map(p=>({...p}));},source(){return source;}
  };
}
