import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK,
  RED,
  START_FEN,
  applyMove,
  boardToFen,
  createEmptyBoard,
  gameStatus,
  generateLegalMoves,
  generatePseudoMoves,
  isGeneralInCheck,
  moveToUci,
  parseFen,
  opposite,
  uciToMove,
} from "../src/xiangqi.js";

function perft(board, side, depth) {
  const moves = generateLegalMoves(board, side);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    nodes += perft(applyMove(board, move), opposite(side), depth - 1);
  }
  return nodes;
}

test("standard FEN round-trips", () => {
  const parsed = parseFen(START_FEN);
  assert.equal(parsed.turn, RED);
  assert.equal(parsed.board.flat().filter((piece) => piece !== ".").length, 32);
  assert.equal(boardToFen(parsed.board, parsed.turn), START_FEN);
});

test("the central cannon opening is legal", () => {
  const parsed = parseFen(START_FEN);
  const move = uciToMove("b2e2");
  const legal = generateLegalMoves(parsed.board, RED);
  assert.ok(
    legal.some(
      (candidate) =>
        candidate.from[0] === move.from[0] &&
        candidate.from[1] === move.from[1] &&
        candidate.to[0] === move.to[0] &&
        candidate.to[1] === move.to[1],
    ),
  );
});

test("a blocked horse leg prevents the move", () => {
  const board = createEmptyBoard();
  board[9][4] = "K";
  board[0][4] = "k";
  board[5][4] = "N";
  board[4][4] = "P";
  const blocked = generatePseudoMoves(board, RED, [5, 4]);
  assert.ok(!blocked.some((move) => move.to[0] === 3 && move.to[1] === 3));

  board[4][4] = ".";
  const open = generatePseudoMoves(board, RED, [5, 4]);
  assert.ok(open.some((move) => move.to[0] === 3 && move.to[1] === 3));
});

test("a cannon needs exactly one screen to capture", () => {
  const board = createEmptyBoard();
  board[9][4] = "C";
  board[7][4] = "P";
  board[5][4] = "r";
  const moves = generatePseudoMoves(board, RED, [9, 4]);
  assert.ok(moves.some((move) => move.to[0] === 5 && move.to[1] === 4));
  assert.ok(!moves.some((move) => move.to[0] === 6 && move.to[1] === 4));
});

test("flying generals put both generals in check", () => {
  const board = createEmptyBoard();
  board[9][4] = "K";
  board[0][4] = "k";
  assert.equal(isGeneralInCheck(board, RED), true);
  assert.equal(isGeneralInCheck(board, BLACK), true);
});

test("pawn attacks are detected from the correct forward direction", () => {
  let board = createEmptyBoard();
  board[0][3] = "k";
  board[1][3] = "P";
  board[9][4] = "K";
  assert.equal(isGeneralInCheck(board, BLACK), true);

  board = createEmptyBoard();
  board[0][3] = "k";
  board[8][4] = "p";
  board[9][4] = "K";
  assert.equal(isGeneralInCheck(board, RED), true);
});

test("a horse can put the opposing general in check", () => {
  const board = createEmptyBoard();
  board[9][4] = "K";
  board[0][3] = "k";
  board[7][5] = "n";
  assert.equal(isGeneralInCheck(board, RED), true);

  board[8][5] = "P";
  assert.equal(isGeneralInCheck(board, RED), false);
});

test("a crossed black pawn can check the red general sideways", () => {
  const board = createEmptyBoard();
  board[9][4] = "K";
  board[0][3] = "k";
  board[9][3] = "p";
  assert.equal(isGeneralInCheck(board, RED), true);
});

test("the red general cannot move into a horse attack", () => {
  const board = createEmptyBoard();
  board[9][4] = "K";
  board[0][5] = "k";
  board[6][3] = "n";
  const moves = generateLegalMoves(board, RED);
  assert.ok(!moves.some((move) => move.to[0] === 8 && move.to[1] === 4));
});

test("a mating position is reported as checkmate", () => {
  const parsed = parseFen("3k5/3P2N2/1N1R5/9/9/9/9/9/9/4K4 b - - 0 1");
  assert.deepEqual(gameStatus(parsed.board, BLACK), {
    state: "red_win",
    reason: "绝杀",
  });
});

test("pawns may only move sideways after crossing the river", () => {
  const board = createEmptyBoard();
  const beforeRiver = generatePseudoMoves(
    board.map((row) => row.slice()),
    RED,
  );
  assert.equal(beforeRiver.length, 0);

  board[6][4] = "P";
  const ownSideMoves = generatePseudoMoves(board, RED, [6, 4]);
  assert.equal(ownSideMoves.length, 1);
  assert.deepEqual(ownSideMoves[0].to, [5, 4]);

  board[6][4] = ".";
  board[4][4] = "P";
  const crossedMoves = generatePseudoMoves(board, RED, [4, 4]);
  assert.equal(crossedMoves.length, 3);
});

test("UCI coordinates map to board coordinates", () => {
  const move = uciToMove("h2e2");
  assert.deepEqual(move, { from: [7, 7], to: [7, 4] });
  assert.equal(moveToUci(move), "h2e2");
});

test("applying a move updates only the moved piece", () => {
  const parsed = parseFen(START_FEN);
  const move = uciToMove("b2e2");
  const next = applyMove(parsed.board, move);
  assert.equal(next[7][1], ".");
  assert.equal(next[7][4], "C");
  assert.equal(parsed.board[7][1], "C");
});

test("legal move generation matches Pikafish perft", () => {
  const parsed = parseFen(START_FEN);
  assert.equal(perft(parsed.board, parsed.turn, 1), 44);
  assert.equal(perft(parsed.board, parsed.turn, 2), 1920);
  assert.equal(perft(parsed.board, parsed.turn, 3), 79666);
});
