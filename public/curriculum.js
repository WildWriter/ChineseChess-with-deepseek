export function filterCurriculum(puzzles,course='all',theme='all') {
  return puzzles.filter(puzzle=>(course==='all'||puzzle.course===course)&&(theme==='all'||puzzle.theme===theme));
}

export function recordAttempt(previous,report,assisted,now=new Date().toISOString()) {
  const record={attempts:0,mistakes:0,completed:false,independent:false,resolved:false,...previous};
  record.attempts++;record.lastSeen=now;
  if(!report.correct){record.mistakes++;record.resolved=false;}
  else if(report.complete ?? report.correct){record.completed=true;record.independent=record.independent||!assisted;record.resolved=true;}
  return record;
}
