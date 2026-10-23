import { pieceName, pieceSide } from './vendor/xiangqi.js';
const label=piece=>piece==='?'?'无法确定':piece==='.'?'空位':(pieceSide(piece)==='w'?'红':'黑')+pieceName(piece);
export function mountVisionReview({root,title,list,locked,onApply,onFocus,onChange}) {
  let cells=[];
  const unresolved=()=>cells.filter(c=>!c.reviewed).length;
  function render(){
    root.hidden=!cells.length;title.textContent='识别校对：'+unresolved()+' 个位置待确认 / 共 '+cells.length+' 个提示';
    list.replaceChildren(...cells.map(cell=>{
      const item=document.createElement('div');item.className='vision-review-cell';item.dataset.reviewSquare=cell.square;
      const text=document.createElement('p');text.textContent=cell.square+' · '+cell.reason+' · 整图：'+label(cell.whole)+'；分格：'+label(cell.tile)+(cell.reviewed?' · 已核对':'');
      item.append(text);
      const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.className='button secondary';b.textContent=text;b.disabled=locked();b.onclick=()=>{if(!locked())action();};item.append(b);};
      button('定位到 '+cell.square,()=>onFocus(cell));
      if(!cell.reviewed){
        for(const [value,name] of [[cell.whole,'整图'],[cell.tile,'分格']])if(value!=='?')button('采用'+name+'：'+label(value),()=>{cell.reviewed=true;onApply(cell,value);render();onChange();});
        button('确认棋盘当前位置',()=>{cell.reviewed=true;render();onChange();});
      }
      return item;
    }));
  }
  return {
    set(value){cells=value.map(c=>({...c,reviewed:false}));render();},
    clear(){cells=[];render();},unresolved,
    has(row,col){return cells.some(c=>c.row===row&&c.col===col&&!c.reviewed);},
    mark(row,col){const cell=cells.find(c=>c.row===row&&c.col===col);if(cell){cell.reviewed=true;render();}},
    rotate(){cells=cells.map(c=>({...c,row:9-c.row,col:8-c.col,square:'abcdefghi'[8-c.col]+c.row}));render();},
    refresh(){for(const b of list.querySelectorAll('button'))b.disabled=locked();}
  };
}
