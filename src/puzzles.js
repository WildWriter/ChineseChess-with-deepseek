import { createEmptyBoard, boardToFen } from '../public/vendor/xiangqi.js';

function fen(pieces, turn = 'w') {
  const board = createEmptyBoard();
  for (const [square, piece] of Object.entries(pieces)) {
    board[9 - Number(square[1])]['abcdefghi'.indexOf(square[0])] = piece;
  }
  return boardToFen(board, turn);
}

// These are newly composed teaching positions, not copied tournament games.
// The target is a stated exercise objective, not an assertion of engine optimality.
const BASIC_PUZZLES = [
  {
    id: 'rook-line', title: '沿线看远处', category: '基础吃子', difficulty: 1,
    subtitle: '车的直线运动', objective: '一步吃掉 a7 的黑车。', goal: 'capture', target: 'a7',
    fen: fen({ e9: 'k', e0: 'K', e4: 'P', a1: 'R', a7: 'r' }),
    canonical: 'a1a7', knowledge: ['rook'],
    hints: ['先找与黑车处于同一直线的红子。', '观察 a1 到 a7 之间有没有棋子阻挡。', '选择 a1 的红车，再点击 a7 的黑车。'],
    lesson: '车沿横线或竖线运动，途中不能越子。本题 a1 到 a7 之间没有其他棋子，所以红车可以直接吃掉黑车。',
    reflection: '先看路径，再看目标；车走得远不代表可以穿过棋子。'
  },
  {
    id: 'cannon-screen', title: '隔一子，才是炮', category: '基础吃子', difficulty: 1,
    subtitle: '炮架与吃子', objective: '用红炮一步吃掉 b7 的黑车。', goal: 'capture', target: 'b7', requiredPiece: 'C',
    fen: fen({ e9: 'k', e0: 'K', e4: 'P', b2: 'C', b4: 'R', b7: 'r' }),
    canonical: 'b2b7', knowledge: ['cannon'],
    hints: ['炮吃子时，起点与目标之间需要炮架。', 'b4 的红车恰好是唯一的炮架。', '从 b2 走到 b7，隔过 b4 的红车吃子。'],
    lesson: '炮吃子时必须隔着且只隔着一个棋子，炮架可以属于任意一方。这里 b4 的红车是炮架；炮不能把隔子后的空点当作普通落点。',
    reflection: '把“不吃子直走”和“隔一子吃子”分开判断。'
  },
  {
    id: 'horse-leg', title: '马腿在什么位置', category: '走子规则', difficulty: 2,
    subtitle: '日字与蹩马腿', objective: '用红马一步吃掉 d2 的黑车。', goal: 'capture', target: 'd2', requiredPiece: 'N',
    fen: fen({ e9: 'k', e0: 'K', e4: 'P', b1: 'N', b2: 'C', d2: 'r' }),
    canonical: 'b1d2', knowledge: ['horse'],
    hints: ['马走“日”字，但不同方向对应不同的马腿。', '向 d2 运动，先横向经过的马腿是 c1，而不是 b2。', 'b1 → d2 的 c1 马腿为空，可以吃车。'],
    lesson: '马先沿较长方向直走一格，再斜走一格。b1 到 d2 的长方向是横向，因此马腿在 c1。b2 的红炮会挡住部分向上的走法，却不会挡住这一步。',
    reflection: '不要因为马旁边有棋子，就认为它所有方向都不能走。'
  },
  {
    id: 'elephant-eye', title: '看清象眼', category: '走子规则', difficulty: 1,
    subtitle: '田字与象眼', objective: '用红相一步吃掉 e2 的黑车。', goal: 'capture', target: 'e2', requiredPiece: 'B',
    fen: fen({ e9: 'k', d0: 'K', c0: 'B', e2: 'r' }),
    canonical: 'c0e2', knowledge: ['elephant'],
    hints: ['相走“田”字，检查对角线中点。', 'c0 到 e2 的象眼是 d1，且落点仍在红方半场。', '选择 c0 的红相，走到 e2 吃车。'],
    lesson: '相沿对角线走两格，象眼不能有子，且不能过河。本题 d1 为空，因此 c0 到 e2 是合法走法。',
    reflection: '走法形状正确之后，还要检查象眼和河界。'
  },
  {
    id: 'pawn-sideways', title: '过河以后，多一个方向', category: '走子规则', difficulty: 1,
    subtitle: '过河兵的横走', objective: '用 d8 的红兵一步吃掉 e8 的黑车。', goal: 'capture', target: 'e8', requiredPiece: 'P',
    fen: fen({ f9: 'k', e0: 'K', e4: 'P', d8: 'P', e8: 'r' }),
    canonical: 'd8e8', knowledge: ['pawn'],
    hints: ['先判断 d8 的红兵是否已经过河。', '过河兵可以向前或向左右一步，但不能后退。', '将 d8 的红兵向右平移到 e8。'],
    lesson: '红兵向编号增大的方向前进；过河后也可以横走一步。d8 的兵已经过河，向 e8 横走吃子合法，但不能从 d8 退到 d7。',
    reflection: '过河只增加左右方向，不增加后退能力。'
  },
  {
    id: 'answer-check', title: '先解决自己的将军', category: '应将', difficulty: 2,
    subtitle: '走帅、挡线或吃子', objective: '红帅正在被将军。走一步合法应将，解除当前将军。', goal: 'escape',
    fen: fen({ d9: 'k', e0: 'K', a1: 'R', e2: 'r' }),
    canonical: 'a1e1', knowledge: ['check', 'rook'],
    hints: ['被将军时，不能只顾进攻。', '可以考虑移动帅，或让红车挡在攻击线上。', '一个可行答案是 a1 → e1 挡住黑车；其他合法应将也算完成。'],
    lesson: '应将题接受所有能解除当前将军的合法走法，不只接受教案示例。完成本题只表示当前将军被解除，并不表示后续局面一定占优。',
    reflection: '每一步都要先检查自己的帅是否安全。'
  },
  {
    id: 'pawn-mate', title: '三子配合，一步成杀', category: '一步将杀', difficulty: 3,
    subtitle: '兵、马、车的协同', objective: '红方走一步，形成绝杀。任何满足目标的合法走法都可通过。', goal: 'mate',
    fen: fen({ d9: 'k', e0: 'K', d7: 'P', g8: 'N', b7: 'N', d6: 'R' }),
    canonical: 'd7d8', knowledge: ['mate', 'pawn', 'horse'],
    hints: ['观察黑将可以走到哪些九宫格。', '两匹红马分别限制侧向退路，红车保护兵的前进点。', '可以尝试 d7 → d8；程序会检查黑方是否还有合法应对。'],
    lesson: '这类题需要同时证明“正在将军”和“对方没有合法应对”。教案示例是兵进到 d8；是否成杀由规则枚举验证，而不是根据文字描述判断。',
    reflection: '将军不等于将杀；需要逐一排除对方的合法应对。'
  },
  {
    id: 'cannon-mate', title: '把炮送上将线', category: '一步将杀', difficulty: 3,
    subtitle: '炮架与封锁退路', objective: '红方走一步，形成绝杀。允许不同的正确杀法。', goal: 'mate',
    fen: fen({ d9: 'k', f0: 'K', c5: 'C', d7: 'P', e8: 'R' }),
    canonical: 'c5d5', knowledge: ['mate', 'cannon', 'rook'],
    hints: ['注意 d 线上的红兵和 e8 红车控制的格子。', '炮可以先平移，让红兵成为炮架。也可以寻找其他成杀走法。', '教案示例：c5 → d5；任何被验证为一步将杀的合法走法都可通过。'],
    lesson: '炮移到 d 线后，可以借红兵为炮架形成将军；车控制关键退路。本题可能存在不止一种杀法，程序将枚举并接受所有一步绝杀。',
    reflection: '目标是完成将杀，不是机械复现某一条教案答案。'
  }
];

const ENDGAMES = [
  {
    id: 'ending-rook-king', title: '帅车合力封宫', theme: '车类配合', difficulty: 2,
    pieces: { d9:'k', e0:'K', e7:'R' }, canonical: 'e7d7', knowledge: ['rook','check','mate'],
    hints: ['不要只看车，也观察红帅控制的直线。','车将军后，黑将的横向退路是否会造成将帅照面？','把 e7 红车平移到 d7。'],
    lesson: '本题利用车的直线将军和红帅的纵线控制配合封宫。将帅照面限制同样适用于黑方逃将，不能只数看似空着的九宫格。',
    reflection: '帅将虽然不能随意走出九宫，其纵线牵制仍可参与封锁。'
  },
  {
    id: 'ending-rook-horse', title: '车马分工封退路', theme: '马类配合', difficulty: 2,
    pieces: {e9:'k',f0:'K',f6:'N',d8:'R'}, canonical: 'f6g8', knowledge: ['horse','rook','mate'],
    hints: ['找出红马能够将军的落点。','马离开原来的直线后，红帅也可能增加对黑将退路的限制。','尝试 f6 → g8，检查黑将的全部应对。'],
    lesson: '车、马和帅各自限制不同的退路。红马起跳还可能打开帅的纵线牵制。落点必须同时满足马腿畅通、将军成立和对方无合法应对。',
    reflection: '一枚棋子的离开，也可能打开另一枚棋子的控制线。'
  },
  {
    id: 'ending-cannon-screen', title: '借马为架，车来护架', theme: '炮类配合', difficulty: 2,
    pieces: {e9:'k',d0:'K',e8:'N',f8:'R',a6:'C'}, canonical: 'a6e6', knowledge: ['cannon','rook','mate'],
    hints: ['炮架不一定是兵，也可以是马。','既要让炮能将军，也要防止黑将吃掉炮架解围。','将 a6 红炮平移到 e6。'],
    lesson: '马提供炮架，车保护关键落点，帅限制另一条纵线。炮将军不是单独完成的：炮架被吃、黑将逃离或垫入第二枚棋子，都必须逐项排查。',
    reflection: '先确认唯一炮架，再确认炮架本身是否安全。'
  },
  {
    id: 'ending-double-rook', title: '双车分守两条横线', theme: '车类配合', difficulty: 2,
    pieces: {e9:'k',e0:'K',e4:'P',a8:'R',b7:'R'}, canonical: 'b7b9', knowledge: ['rook','mate'],
    hints: ['两辆车不必挤在同一条线上。','一辆负责将军，另一辆负责封住下一条横线。','把 b7 的车升到 b9，保留 a8 车的封锁。'],
    lesson: '两车分别控制相邻横线，可以同时覆盖黑将当前横线与纵向退路。要避免将军车贴到对方帅将旁边却无人保护。',
    reflection: '将军子与封路子分工，往往比同时追将更有效。'
  },
  {
    id: 'ending-ladder-two', title: '双车接力：两步收网', theme: '车类配合', difficulty: 3, maxRedMoves: 2,
    pieces: {e8:'k',e0:'K',e4:'P',a6:'R',b7:'R',f9:'a'}, canonical: 'a6a8', knowledge: ['rook','check','mate'],
    hints: ['先用一车将军，另一车负责封线。','黑方会选择能坚持更久的合法应将；保留两车的接力空间。','从 a6 → a8 开始连续将军。'],
    lesson: '双车交替将军，逐步压缩黑将可用横线。第一步将军后还没有结束，必须根据实际应将完成下一步；同样能在规定步数内将杀的其他首着也接受。',
    reflection: '每轮都重新检查对方的退路，而不是盲走固定棋谱。'
  },
  {
    id: 'ending-ladder-three', title: '双车接力：三步封宫', theme: '车类配合', difficulty: 3, maxRedMoves: 3,
    pieces: {e9:'k',e0:'K',e4:'P',c7:'R',b7:'R',g9:'b'}, canonical: 'b7b9', knowledge: ['rook','check','mate'],
    hints: ['两车现在在同一横线，先安排将军与封路的分工。','第一步不能立刻绝杀，要预判黑将转移到下一横线。','教案首着 b7 → b9；之后根据黑方应将继续。'],
    lesson: '双车接力需要保留彼此可活动的线。黑方自动选择规则搜索中能坚持最久的应将，只有连续完成最后的绝杀才计为通关。',
    reflection: '在脑中多看一轮应将，再决定哪辆车先出动。'
  },
  {
    id: 'ending-horse-two', title: '马先到位，车再收网', theme: '马类配合', difficulty: 3, maxRedMoves: 2,
    pieces: {e9:'k',d0:'K',c7:'R',i7:'N',d9:'a'}, canonical: 'i7g8', knowledge: ['horse','rook','mate'],
    hints: ['红马在边线，先找能带将军的转移。','马的控制点与车的封线需要互相补位。','首着 i7 → g8，将军后观察黑将应对。'],
    lesson: '马通过带将军的跳跃进入有效区域，车随后配合封路。先手的价值在于迫使黑方应将，不能把“马已到位”直接当成完成绝杀。',
    reflection: '先用将军赢得调子节奏，再计算收网。'
  },
  {
    id: 'ending-horse-three', title: '车引将，边马转中', theme: '马类配合', difficulty: 3, maxRedMoves: 3,
    pieces: {e9:'k',d0:'K',c7:'R',i8:'N',f9:'a'}, canonical: 'c7c9', knowledge: ['horse','rook','check','mate'],
    hints: ['边马暂时离关键控制点较远，考虑车先将军。','黑将转位后再看马的跳跃，不能把上一题的首着照搬过来。','首着 c7 → c9，随后逐轮检查应将。'],
    lesson: '先用车将军改变黑将的位置，再利用边马的转移配合封锁。棋子相同并不代表答案相同，马位与九宫退路会改变连续将军的顺序。',
    reflection: '比较相近残局时，重点看关键子的位置差异。'
  },
  {
    id: 'ending-cannon-three', title: '车开路，炮兵合围', theme: '炮类配合', difficulty: 3, maxRedMoves: 3,
    pieces: {e9:'k',d0:'K',d5:'R',a6:'C',c8:'P',d9:'a'}, canonical: 'd5d9', knowledge: ['rook','cannon','pawn','mate'],
    hints: ['先找车的带将军着法，再考虑炮架。','车、炮、兵各有职责，不要让炮在没有炮架时直接叫将。','首着 d5 → d9。'],
    lesson: '车先制造强制应将，再与炮、过河兵配合收网。每步都必须保持将军；炮架数量和兵的横向控制需要在黑将转位后重新检查。',
    reflection: '复杂配合也可以拆成“当前将军—合法应将—下一步封路”。'
  },
  {
    id: 'ending-cannon-two', title: '炮先牵制，车后封锁', theme: '炮类配合', difficulty: 3, maxRedMoves: 2,
    pieces: {e9:'k',d0:'K',h7:'R',c5:'C',e6:'P',f9:'a'}, canonical: 'c5e5', knowledge: ['cannon','rook','pawn','mate'],
    hints: ['观察 e 线红兵能否成为炮架。','炮将军之后，车还需要针对实际退路配合。','首着 c5 → e5。'],
    lesson: '红兵提供炮架，炮先将军迫使黑将转位，车再封住退路。程序会验证所有合法应将，而不只验证教案展示的一条变化。',
    reflection: '有炮架不等于有杀，仍要覆盖黑将的所有退路。'
  },
  {
    id: 'ending-pawn-two', title: '兵进一格，车兵协同', theme: '兵类配合', difficulty: 3, maxRedMoves: 2,
    pieces: {e9:'k',d0:'K',e6:'R',e7:'P',e8:'a'}, canonical: 'e7e8', knowledge: ['pawn','rook','mate'],
    hints: ['过河兵也能作为带将军的先手。','检查兵前进后由谁保护，并预判黑将横向转移。','先走 e7 → e8，再按黑方应将收网。'],
    lesson: '兵推进形成将军，车在后保护兵，同时帅的纵线牵制限制黑将的选择。不要只看兵的攻击范围，也要看推进后改变的车线。',
    reflection: '兵的价值常来自保护、控制与先手，而不只是吃子。'
  },
  {
    id: 'ending-double-cannon-two', title: '叠炮成线，双炮接力', theme: '炮类配合', difficulty: 3, maxRedMoves: 2,
    pieces: {e9:'k',d0:'K',e6:'C',c5:'C',i6:'N',i5:'R',d9:'a'}, canonical: 'c5e5', knowledge: ['cannon','rook','mate'],
    hints: ['观察一门炮能否成为另一门炮的炮架。','重炮也要配合其他棋子限制退路，且必须保持恰好一个炮架。','首着 c5 → e5，之后根据应将继续。'],
    lesson: '两炮可通过同线叠放建立将军关系，再结合车、马与帅的控制完成封锁。每步移动后都要重新数炮架，不能仅凭“两炮同线”判断绝杀。',
    reflection: '炮的作用会随炮架变化，连续作战时尤其要重新检查。'
  }
].map(({pieces,maxRedMoves,...item}) => ({
  ...item, course: 'endgame', goal: maxRedMoves ? 'forced-mate' : 'mate', maxRedMoves,
  category: maxRedMoves ? '连续将杀' : '一步残局', subtitle: `${item.theme} · ${maxRedMoves ? `红方 ${maxRedMoves} 步内` : '一步绝杀'}`,
  objective: maxRedMoves ? `红方在 ${maxRedMoves} 步内连续将军并绝杀。黑方自动应将；走对首步不等于通关。` : '红方走一步形成绝杀；所有满足目标的合法走法均可通过。',
  fen: fen(pieces)
}));

export const PUZZLES = [...BASIC_PUZZLES.map(puzzle => ({...puzzle, course:'basic', theme:'基础规则'})), ...ENDGAMES];

export function publicPuzzle(puzzle) {
  const { canonical, hints, lesson, reflection, target, requiredPiece, ...rest } = puzzle;
  return rest;
}
export function findPuzzle(id) {
  const puzzle = PUZZLES.find(item => item.id === id);
  if (!puzzle) throw Object.assign(new Error('题目不存在。'), { status: 404 });
  return puzzle;
}
