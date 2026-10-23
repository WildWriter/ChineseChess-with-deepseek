// Deterministic mock only: copy tool facts into the complete model contract.
// No credentials or live provider requests are used by these tests.
export function detailedAnswer(context, overrides = {}) {
  return {
    move: context.candidateMove || context.recommendation,
    observation: '先观察双方帅将和参与进攻的棋子。',
    reason: '先核对实际走法，再按给定规则事实与应对逐步判断目标。',
    practice: '遮住讲解，逐步摆棋并说明每一步的目的。',
    evidenceIds: [context.evidence[0].id],
    steps: context.walkthrough.steps.map(step => ({ id: step.id, move: step.move, observation: step.observation, reason: `${step.side}${step.notation}从${step.move.slice(0,2)}到${step.move.slice(2)}，${step.captured!=='.'?'这步消除了落点的对方棋子，子力数量发生改变；后续得失仍需对照给定应对。':step.checking?'这步直接形成将军，对方必须先应将；接下来的线路要根据实际防守变化。':'这步并未将军，当前不要求对方唯一应对；解释应对时需要按每条给定变化核对。'}下面的分支分别给出了合法的对手应对和后续位置，可以逐步摆出并比较具体结果。`, consequence: step.consequence, evidenceIds: [step.id], responses: step.responses.map(reply=>({id:reply.id,explanation:reply.explanation})), alternatives: step.alternatives.map(branch => ({ id: branch.id, explanation: branch.explanation })) })),
    summary: context.walkthrough.summary,
    ...overrides
  };
}
