const rulesSource = 'https://github.com/WildWriter/ChineseChess-with-deepseek/blob/96ec030c4f502bcf96b3234f918b3405fbd73199/src/xiangqi.js';
export const KNOWLEDGE = [
  { id: 'rook', title: '车：直线与阻挡', text: '沿横线或竖线运动，不能越过棋子。可以吃路径上首先遇到的敌子，但不能吃己方棋子。' },
  { id: 'cannon', title: '炮：炮架', text: '不吃子时沿空直线移动；吃子时与目标之间必须恰好有一个棋子作为炮架。' },
  { id: 'horse', title: '马：日字与马腿', text: '先沿较长方向直走一格，再斜走一格；直走的第一格有子时，该方向不能走。' },
  { id: 'elephant', title: '相：田字与象眼', text: '沿对角线走两格，中点不能有子，且不能过河。' },
  { id: 'pawn', title: '兵：过河与方向', text: '每次前进一步；过河后可向左右各走一步；任何时候都不能后退。' },
  { id: 'check', title: '应将：先保证帅将安全', text: '合法走法不能让己方帅将处于被攻击状态，也不能造成将帅照面。应将可能有多个可行答案。' },
  { id: 'mate', title: '将军不等于绝杀', text: '绝杀需要同时满足：对方帅将受攻击，且对方没有合法走法。困毙与绝杀不是同一个判定，本项目将杀题要求确实在将军。' }
].map(item => ({ ...item, source: rulesSource, sourceLabel: '规则实现（MIT）与本项目自编教案', scope: '基础走子与短局面；不覆盖长将长捉等比赛裁定。' }));

export function retrieveKnowledge(ids) {
  return KNOWLEDGE.filter(item => ids.includes(item.id));
}
