import { RED, pieceSide } from "./xiangqi.js";

const RED_NUMERALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const PIECE_NAMES = {
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

function formatNumber(side, value) {
  return side === RED ? RED_NUMERALS[value] : String(value);
}

function fileNumber(side, col) {
  return side === RED ? 9 - col : col + 1;
}

function pieceLabel(piece) {
  const name = PIECE_NAMES[piece];
  if (!name) throw new Error(`无法识别棋子：${piece}`);
  return name;
}

function positionsOnFile(board, side, type, col) {
  const positions = [];
  for (let row = 0; row < 10; row += 1) {
    const piece = board[row][col];
    if (
      piece !== "." &&
      pieceSide(piece) === side &&
      piece.toUpperCase() === type
    ) {
      positions.push([row, col]);
    }
  }
  return positions.sort((left, right) =>
    side === RED ? left[0] - right[0] : right[0] - left[0],
  );
}

function subjectWithPrefix(board, side, piece, move) {
  const type = piece.toUpperCase();
  const positions = positionsOnFile(board, side, type, move.from[1]);
  if (positions.length <= 1) {
    return `${pieceLabel(piece)}${formatNumber(side, fileNumber(side, move.from[1]))}`;
  }

  const index = positions.findIndex(
    ([row, col]) => row === move.from[0] && col === move.from[1],
  );
  let prefix;
  if (positions.length === 2) {
    prefix = index === 0 ? "前" : "后";
  } else if (positions.length === 3) {
    prefix = ["前", "中", "后"][index];
  } else if (index === 0) {
    prefix = "前";
  } else if (index === positions.length - 1) {
    prefix = "后";
  } else {
    prefix = formatNumber(side, index + 1);
  }
  return `${prefix}${pieceLabel(piece)}`;
}

function movementText(side, piece, move) {
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const type = piece.toUpperCase();

  if (fromRow === toRow) {
    return `平${formatNumber(side, fileNumber(side, toCol))}`;
  }

  const forward = side === RED ? toRow < fromRow : toRow > fromRow;
  const direction = forward ? "进" : "退";
  if (type === "N" || type === "B" || type === "A") {
    return `${direction}${formatNumber(side, fileNumber(side, toCol))}`;
  }
  return `${direction}${formatNumber(side, Math.abs(toRow - fromRow))}`;
}

export function formatMoveNotation(board, move) {
  const [fromRow, fromCol] = move.from;
  const piece = board[fromRow]?.[fromCol];
  if (!piece || piece === ".") {
    throw new Error("记谱失败：起始位置没有棋子。");
  }
  const side = pieceSide(piece);
  const subject = subjectWithPrefix(board, side, piece, move);
  return `${subject}${movementText(side, piece, move)}`;
}
