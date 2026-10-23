import { parseFen, pieceSide, pieceName, uciToMove, moveToUci, generateLegalMoves } from './vendor/xiangqi.js';

const NS = 'http://www.w3.org/2000/svg';
export function drawStudyBoard(root, fen, { move, selected, onSquare } = {}) {
  const { board, turn } = parseFen(fen), focused = root.querySelector(':focus')?.dataset.square;
  const svg = (tag, attrs, text) => { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); if (text) node.textContent = text; return node; };
  root.replaceChildren();
  const x = col => 40 + col * 48, y = row => 36 + row * 48;
  const line = (x1, y1, x2, y2) => root.append(svg('line', { x1, y1, x2, y2, stroke: '#aa9370', 'pointer-events': 'none' }));
  for (let row = 0; row < 10; row++) line(x(0), y(row), x(8), y(row));
  for (let col = 0; col < 9; col++) { line(x(col), y(0), x(col), y(4)); line(x(col), y(5), x(col), y(9)); }
  for (const row of [0, 7]) { line(x(3), y(row), x(5), y(row + 2)); line(x(5), y(row), x(3), y(row + 2)); }
  root.append(svg('text', { x: 232, y: 258, 'text-anchor': 'middle', fill: '#776544', 'font-size': 18 }, '楚 河        汉 界'));
  const marked = move ? uciToMove(move) : null;
  const legal = onSquare && selected ? generateLegalMoves(board, turn).filter(item => item.from.join() === selected.join()).map(item => item.to.join()) : [];
  for (let col = 0; col < 9; col++) root.append(svg('text', { x: x(col), y: 500, 'text-anchor': 'middle', class: 'study-coordinate' }, 'abcdefghi'[col]));
  for (let row = 0; row < 10; row++) root.append(svg('text', { x: 12, y: y(row) + 5, 'text-anchor': 'middle', class: 'study-coordinate' }, String(9 - row)));
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const piece = board[row][col], square = `${'abcdefghi'[col]}${9 - row}`, key = `${row},${col}`;
    const cell = svg('g', { 'data-square': square, ...(onSquare ? { role: 'button', tabindex: focused === square || (!focused && square === 'e0') ? 0 : -1, 'aria-label': `${piece === '.' ? '空位' : (pieceSide(piece) === 'w' ? '红' : '黑') + pieceName(piece)} ${square}` } : {}) });
    cell.append(svg('rect', { x: x(col) - 23, y: y(row) - 23, width: 46, height: 46, fill: 'transparent' }));
    if (marked && [marked.from.join(), marked.to.join()].includes(key)) cell.append(svg('circle', { cx: x(col), cy: y(row), r: 23, fill: '#b394572e', stroke: '#9b7131', 'stroke-width': 2 }));
    if (piece !== '.') { cell.append(svg('circle', { cx: x(col), cy: y(row), r: 20, fill: '#fff8e6', stroke: '#b79b71' }), svg('text', { x: x(col), y: y(row) + 8, 'text-anchor': 'middle', 'font-size': 25, 'font-family': 'SimSun,serif', 'font-weight': 700, fill: pieceSide(piece) === 'w' ? '#a23f32' : '#304b3f' }, pieceName(piece))); }
    if (selected?.join() === key) cell.append(svg('circle', { cx: x(col), cy: y(row), r: 23, fill: 'none', stroke: '#285747', 'stroke-width': 3 }));
    if (legal.includes(key)) cell.append(svg('circle', { cx: x(col), cy: y(row), r: piece === '.' ? 5 : 23, fill: piece === '.' ? '#285747' : 'none', stroke: '#285747', 'stroke-width': 2 }));
    if (onSquare) {
      cell.onclick = () => onSquare(row, col);
      cell.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSquare(row, col); }
        const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
        if (delta) { event.preventDefault(); const r = Math.max(0, Math.min(9, row + delta[0])), c = Math.max(0, Math.min(8, col + delta[1])); const next = root.querySelector(`[data-square="${'abcdefghi'[c]}${9 - r}"]`); root.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1'); next.setAttribute('tabindex', '0'); next.focus(); }
      };
    }
    root.append(cell);
  }
  if (focused) root.querySelector(`[data-square="${focused}"]`)?.focus({ preventScroll: true });
}
