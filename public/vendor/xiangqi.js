export const RED = "w";
export const BLACK = "b";

export const START_FEN =
  "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

export const PIECE_NAMES = {
  K: "帅",
  A: "仕",
  B: "相",
  N: "马",
  R: "车",
  C: "炮",
  P: "兵",
  k: "将",
  a: "士",
  b: "象",
  n: "马",
  r: "车",
  c: "炮",
  p: "卒",
};

const FILES = "abcdefghi";
const PIECES = new Set(Object.keys(PIECE_NAMES));
const PIECE_ALIASES = {
  H: "N",
  h: "n",
  E: "B",
  e: "b",
};

export function opposite(side) {
  return side === RED ? BLACK : RED;
}

export function isRedPiece(piece) {
  return typeof piece === "string" && piece >= "A" && piece <= "Z";
}

export function isBlackPiece(piece) {
  return typeof piece === "string" && piece >= "a" && piece <= "z";
}

export function pieceSide(piece) {
  if (!piece || piece === ".") return null;
  return isRedPiece(piece) ? RED : BLACK;
}

export function pieceName(piece) {
  return PIECE_NAMES[piece] ?? "";
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function createEmptyBoard() {
  return Array.from({ length: 10 }, () => Array(9).fill("."));
}

export function parseFen(fen) {
  if (typeof fen !== "string") throw new Error("残局格式不是文本。");
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2) throw new Error("残局需要包含棋盘和行棋方。");

  const rows = fields[0].split("/");
  if (rows.length !== 10) throw new Error("棋盘必须有 10 行。");

  const board = createEmptyBoard();
  for (let r = 0; r < 10; r += 1) {
    let c = 0;
    for (const rawToken of rows[r]) {
      if (/[1-9]/.test(rawToken)) {
        c += Number(rawToken);
        continue;
      }
      const token = PIECE_ALIASES[rawToken] ?? rawToken;
      if (!PIECES.has(token)) {
        throw new Error(`棋盘中有无法识别的棋子：${rawToken}`);
      }
      if (c > 8) throw new Error("棋盘列数超过 9 列。");
      board[r][c] = token;
      c += 1;
    }
    if (c !== 9) throw new Error("棋盘每一行必须正好有 9 列。");
  }

  const turn = fields[1] === BLACK ? BLACK : RED;
  return {
    board,
    turn,
    fen: boardToFen(board, turn),
  };
}

export function boardToFen(board, turn = RED) {
  const ranks = [];
  for (let r = 0; r < 10; r += 1) {
    let rank = "";
    let empty = 0;
    for (let c = 0; c < 9; c += 1) {
      const piece = board[r][c] || ".";
      if (piece === ".") {
        empty += 1;
      } else {
        if (empty) {
          rank += String(empty);
          empty = 0;
        }
        rank += piece;
      }
    }
    if (empty) rank += String(empty);
    ranks.push(rank);
  }
  return `${ranks.join("/")} ${turn === BLACK ? "b" : "w"} - - 0 1`;
}

function inside(row, col) {
  return row >= 0 && row < 10 && col >= 0 && col < 9;
}

function inPalace(row, col, side) {
  if (col < 3 || col > 5) return false;
  return side === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function isEnemy(piece, side) {
  return piece !== "." && pieceSide(piece) !== side;
}

function addPseudoMove(moves, board, fromRow, fromCol, toRow, toCol, side) {
  if (!inside(toRow, toCol)) return false;
  const target = board[toRow][toCol];
  if (target !== "." && pieceSide(target) === side) return false;
  if (target !== "." && target.toLowerCase() === "k") return false;
  moves.push({
    from: [fromRow, fromCol],
    to: [toRow, toCol],
  });
  return target === ".";
}

function generateRookMoves(board, row, col, side, moves) {
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c)) {
      const target = board[r][c];
      if (target === ".") {
        moves.push({ from: [row, col], to: [r, c] });
      } else {
        if (isEnemy(target, side) && target.toLowerCase() !== "k") {
          moves.push({ from: [row, col], to: [r, c] });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

function generateCannonMoves(board, row, col, side, moves) {
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c) && board[r][c] === ".") {
      moves.push({ from: [row, col], to: [r, c] });
      r += dr;
      c += dc;
    }

    if (!inside(r, c)) continue;
    r += dr;
    c += dc;
    while (inside(r, c) && board[r][c] === ".") {
      r += dr;
      c += dc;
    }

    if (inside(r, c)) {
      const target = board[r][c];
      if (isEnemy(target, side) && target.toLowerCase() !== "k") {
        moves.push({ from: [row, col], to: [r, c] });
      }
    }
  }
}

function generateHorseMoves(board, row, col, side, moves) {
  const patterns = [
    { dr: -2, dc: -1, leg: [-1, 0] },
    { dr: -2, dc: 1, leg: [-1, 0] },
    { dr: -1, dc: -2, leg: [0, -1] },
    { dr: -1, dc: 2, leg: [0, 1] },
    { dr: 1, dc: -2, leg: [0, -1] },
    { dr: 1, dc: 2, leg: [0, 1] },
    { dr: 2, dc: -1, leg: [1, 0] },
    { dr: 2, dc: 1, leg: [1, 0] },
  ];

  for (const pattern of patterns) {
    const legRow = row + pattern.leg[0];
    const legCol = col + pattern.leg[1];
    if (!inside(legRow, legCol) || board[legRow][legCol] !== ".") continue;
    addPseudoMove(
      moves,
      board,
      row,
      col,
      row + pattern.dr,
      col + pattern.dc,
      side,
    );
  }
}

function generateElephantMoves(board, row, col, side, moves) {
  for (const [dr, dc] of [
    [-2, -2],
    [-2, 2],
    [2, -2],
    [2, 2],
  ]) {
    const toRow = row + dr;
    const toCol = col + dc;
    if (!inside(toRow, toCol)) continue;
    if (side === RED && toRow < 5) continue;
    if (side === BLACK && toRow > 4) continue;
    const eyeRow = row + dr / 2;
    const eyeCol = col + dc / 2;
    if (board[eyeRow][eyeCol] !== ".") continue;
    addPseudoMove(moves, board, row, col, toRow, toCol, side);
  }
}

function generateAdvisorMoves(board, row, col, side, moves) {
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const toRow = row + dr;
    const toCol = col + dc;
    if (!inPalace(toRow, toCol, side)) continue;
    addPseudoMove(moves, board, row, col, toRow, toCol, side);
  }
}

function generateGeneralMoves(board, row, col, side, moves) {
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const toRow = row + dr;
    const toCol = col + dc;
    if (!inPalace(toRow, toCol, side)) continue;
    addPseudoMove(moves, board, row, col, toRow, toCol, side);
  }
}

function generatePawnMoves(board, row, col, side, moves) {
  const forward = side === RED ? -1 : 1;
  addPseudoMove(moves, board, row, col, row + forward, col, side);

  const crossedRiver = side === RED ? row <= 4 : row >= 5;
  if (crossedRiver) {
    addPseudoMove(moves, board, row, col, row, col - 1, side);
    addPseudoMove(moves, board, row, col, row, col + 1, side);
  }
}

export function generatePseudoMoves(board, side, from = null) {
  const moves = [];
  const startRows = from ? [from[0]] : Array.from({ length: 10 }, (_, i) => i);
  for (const row of startRows) {
    const startCols = from ? [from[1]] : Array.from({ length: 9 }, (_, i) => i);
    for (const col of startCols) {
      const piece = board[row]?.[col];
      if (!piece || piece === "." || pieceSide(piece) !== side) continue;
      const type = piece.toUpperCase();
      if (type === "R") generateRookMoves(board, row, col, side, moves);
      if (type === "C") generateCannonMoves(board, row, col, side, moves);
      if (type === "N") generateHorseMoves(board, row, col, side, moves);
      if (type === "B") generateElephantMoves(board, row, col, side, moves);
      if (type === "A") generateAdvisorMoves(board, row, col, side, moves);
      if (type === "K") generateGeneralMoves(board, row, col, side, moves);
      if (type === "P") generatePawnMoves(board, row, col, side, moves);
    }
  }
  return moves;
}

export function findGeneral(board, side) {
  const target = side === RED ? "K" : "k";
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      if (board[r][c] === target) return [r, c];
    }
  }
  return null;
}

function rayHasAttack(board, row, col, dr, dc, side) {
  let r = row + dr;
  let c = col + dc;
  while (inside(r, c) && board[r][c] === ".") {
    r += dr;
    c += dc;
  }
  if (!inside(r, c)) return false;

  const piece = board[r][c];
  if (pieceSide(piece) === side) return false;
  if (piece.toLowerCase() === "r") return true;
  if (piece.toLowerCase() === "k") {
    const distance = Math.abs(r - row) + Math.abs(c - col);
    return distance === 1 || (dc === 0 && c === col);
  }
  return false;
}

function cannonAttacks(board, row, col, side) {
  for (const [dr, dc] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c) && board[r][c] === ".") {
      r += dr;
      c += dc;
    }
    if (!inside(r, c)) continue;

    r += dr;
    c += dc;
    while (inside(r, c) && board[r][c] === ".") {
      r += dr;
      c += dc;
    }
    if (!inside(r, c)) continue;
    const target = board[r][c];
    if (pieceSide(target) !== side && target.toLowerCase() === "c") return true;
  }
  return false;
}

function horseAttacks(board, row, col, side) {
  const patterns = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  // Red is attacked by a black horse ("n"); black is attacked by a red horse ("N").
  // parseFen normalizes H/h aliases to N/n before positions reach this function.
  const target = side === RED ? "n" : "N";
  for (const [dr, dc] of patterns) {
    const horseRow = row + dr;
    const horseCol = col + dc;
    if (!inside(horseRow, horseCol)) continue;
    if (board[horseRow][horseCol] !== target) continue;
    const legRow =
      Math.abs(dr) === 2 ? horseRow + (row - horseRow) / 2 : horseRow;
    const legCol =
      Math.abs(dc) === 2 ? horseCol + (col - horseCol) / 2 : horseCol;
    if (board[legRow][legCol] === ".") return true;
  }
  return false;
}

function pawnAttacks(board, row, col, side) {
  if (side === RED) {
    if (inside(row - 1, col) && board[row - 1][col] === "p") return true;
    if (row >= 5) {
      if (inside(row, col - 1) && board[row][col - 1] === "p") return true;
      if (inside(row, col + 1) && board[row][col + 1] === "p") return true;
    }
  } else {
    if (inside(row + 1, col) && board[row + 1][col] === "P") return true;
    if (row <= 4) {
      if (inside(row, col - 1) && board[row][col - 1] === "P") return true;
      if (inside(row, col + 1) && board[row][col + 1] === "P") return true;
    }
  }
  return false;
}

export function isGeneralInCheck(board, side) {
  const general = findGeneral(board, side);
  if (!general) return true;
  const [row, col] = general;

  if (
    rayHasAttack(board, row, col, -1, 0, side) ||
    rayHasAttack(board, row, col, 1, 0, side) ||
    rayHasAttack(board, row, col, 0, -1, side) ||
    rayHasAttack(board, row, col, 0, 1, side)
  ) {
    return true;
  }

  if (cannonAttacks(board, row, col, side)) return true;
  if (horseAttacks(board, row, col, side)) return true;
  if (pawnAttacks(board, row, col, side)) return true;
  return false;
}

export function applyMove(board, move) {
  const next = cloneBoard(board);
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const piece = next[fromRow][fromCol];
  next[fromRow][fromCol] = ".";
  next[toRow][toCol] = piece;
  return next;
}

export function generateLegalMoves(board, side) {
  return generatePseudoMoves(board, side).filter((move) => {
    const next = applyMove(board, move);
    return !isGeneralInCheck(next, side);
  });
}

export function isLegalMove(board, side, move) {
  return generateLegalMoves(board, side).some(
    (candidate) =>
      candidate.from[0] === move.from[0] &&
      candidate.from[1] === move.from[1] &&
      candidate.to[0] === move.to[0] &&
      candidate.to[1] === move.to[1],
  );
}

export function gameStatus(board, side) {
  const ownGeneral = findGeneral(board, side);
  const enemyGeneral = findGeneral(board, opposite(side));
  if (!ownGeneral) {
    return { state: side === RED ? "black_win" : "red_win", reason: "缺帅" };
  }
  if (!enemyGeneral) {
    return { state: side === RED ? "red_win" : "black_win", reason: "缺将" };
  }

  const legalMoves = generateLegalMoves(board, side);
  if (legalMoves.length === 0) {
    const winState = side === RED ? "black_win" : "red_win";
    return {
      state: winState,
      reason: isGeneralInCheck(board, side) ? "绝杀" : "困毙",
    };
  }

  return {
    state: "playing",
    reason: isGeneralInCheck(board, side) ? "将军" : "",
  };
}

export function moveToUci(move) {
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  return `${FILES[fromCol]}${9 - fromRow}${FILES[toCol]}${9 - toRow}`;
}

export function uciToMove(uci) {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) {
    throw new Error(`不是有效的象棋坐标：${uci}`);
  }
  return {
    from: [9 - Number(uci[1]), FILES.indexOf(uci[0])],
    to: [9 - Number(uci[3]), FILES.indexOf(uci[2])],
  };
}

export function validatePosition(board, turn) {
  const ownGeneral = findGeneral(board, turn);
  const enemyGeneral = findGeneral(board, opposite(turn));
  if (!ownGeneral || !enemyGeneral) {
    return { ok: false, message: "棋盘上必须同时有帅和将。" };
  }
  if (isGeneralInCheck(board, opposite(turn))) {
    return { ok: false, message: "对方帅将正被将军，这不是轮到对方行棋的合法局面。" };
  }
  return { ok: true, message: "局面有效" };
}

export function moveDescription(board, move) {
  const piece = board[move.from[0]][move.from[1]];
  const name = pieceName(piece);
  const uci = moveToUci(move);
  return `${name} ${uci.slice(0, 2)}-${uci.slice(2)}`;
}

export function countPieces(board) {
  let count = 0;
  for (const row of board) {
    for (const piece of row) {
      if (piece !== ".") count += 1;
    }
  }
  return count;
}
