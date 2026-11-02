import { answerText, DEFAULT_MAX_MS, FeedbackLoop, GRACE_MS, Timers } from '../src/games/engine/feedback';

/** Timers stepped by hand. */
function manualTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    clear: (id) => { pending.delete(id as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      pending.delete(due[0]);
      due[1].fn();
    }
  };
  return { timers, advance, count: () => pending.size };
}

describe('the visual feedback loop', () => {
  it('a right answer: validating, the success animation, the world updated, then the next challenge', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    loop.touch();
    expect(loop.current).toBe('INTERACTING');
    expect(loop.submit('t1', '12')).toBe('ok');
    expect(loop.current).toBe('VALIDATING');
    expect(loop.judge('e1', true)).toBe(true);
    expect(loop.current).toBe('SUCCESS_ANIMATION');
    const end = loop.begin('battle:strike');
    loop.present('t2'); // the backend's next turn came with the verdict: it waits for the strike
    expect(loop.blocking).toBe(true);
    expect(loop.current).toBe('SUCCESS_ANIMATION');
    end();
    expect(loop.blocking).toBe(false);
    expect(loop.current).toBe('IDLE');
    expect(loop.trail.slice(-5)).toEqual(['VALIDATING', 'SUCCESS_ANIMATION', 'WORLD_UPDATED', 'NEXT_CHALLENGE', 'IDLE']);
  });

  it('a wrong answer: the failure animation, then the same challenge goes on', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    loop.submit('t1', '11');
    loop.judge('e1', false);
    expect(loop.current).toBe('FAILURE_ANIMATION');
    loop.begin('battle:counter')();
    expect(loop.current).toBe('INTERACTING');
    expect(loop.trail.slice(-3)).toEqual(['FAILURE_ANIMATION', 'WORLD_UPDATED', 'INTERACTING']);
  });

  it('no double submit: one answer at a time, and none while the world reacts', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    expect(loop.submit('t1', '12')).toBe('ok');
    expect(loop.submit('t1', '12')).toBe('busy');
    expect(loop.submit('t1', '13')).toBe('busy');
    loop.judge('e1', true);
    const end = loop.begin('strike');
    expect(loop.submit('t1', '14')).toBe('busy');
    end();
    loop.present('t2');
    expect(loop.submit('t2', '5')).toBe('ok');
  });

  it('the exact answer already judged wrong is not sent again; another one is', () => {
    const { timers, advance } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    loop.submit('t1', answerText(' 11 '));
    loop.judge('e1', false);
    advance(GRACE_MS);
    expect(loop.submit('t1', answerText('11'))).toBe('repeat');
    expect(loop.submit('t1', answerText('12'))).toBe('ok');
  });

  it('a wrong answer with no reaction of its own never holds the learner: the fix can be sent at once', () => {
    const { timers, advance } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    loop.submit('t1', 'omè');
    loop.judge('e1', false);
    expect(loop.blocking).toBe(false);
    expect(loop.submit('t1', 'mèo')).toBe('ok');
    advance(GRACE_MS);
    expect(loop.current).toBe('VALIDATING');
  });

  it('a wrong answer whose scene reacts (the monster strikes back) holds new answers until the reaction ends', () => {
    const loop = new FeedbackLoop(manualTimers().timers);
    loop.present('t1');
    loop.submit('t1', '11');
    loop.judge('e1', false);
    const end = loop.begin('battle:counter');
    expect(loop.submit('t1', '12')).toBe('busy');
    end();
    expect(loop.current).toBe('INTERACTING');
    expect(loop.submit('t1', '12')).toBe('ok');
  });

  it('a verdict is applied once: a retried request answered again is not shown again', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.submit('t1', 'a');
    expect(loop.judge('event-1', true)).toBe(true);
    loop.begin('x')();
    expect(loop.judge('event-1', true)).toBe(false);
    expect(loop.current).toBe('WORLD_UPDATED');
  });

  it('a failed request lets the learner go on', () => {
    const loop = new FeedbackLoop(manualTimers().timers);
    loop.submit('t1', 'a');
    loop.cancel();
    expect(loop.current).toBe('INTERACTING');
    expect(loop.submit('t1', 'a')).toBe('ok'); // never judged: not a repeat
  });

  it('a scene with nothing to show holds the world only for the grace', () => {
    const { timers, advance } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.present('t1');
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    loop.present('t2');
    expect(loop.blocking).toBe(true);
    advance(GRACE_MS - 1);
    expect(loop.blocking).toBe(true);
    advance(1);
    expect(loop.blocking).toBe(false);
    expect(loop.current).toBe('IDLE');
  });

  it('a reaction begun inside the grace takes over: the world does not settle in between', () => {
    const { timers, advance } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    const end = loop.begin('door');
    advance(GRACE_MS * 4);
    expect(loop.current).toBe('SUCCESS_ANIMATION');
    expect(loop.playing).toEqual(['door']);
    end();
    expect(loop.current).toBe('WORLD_UPDATED');
  });

  it('an animation that never reports back cannot jam the game: the watchdog finishes it', () => {
    const { timers, advance } = manualTimers();
    const loop = new FeedbackLoop(timers);
    const finish = jest.fn();
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    loop.begin('stuck', { finish });
    loop.present('t2');
    advance(DEFAULT_MAX_MS - 1);
    expect(loop.blocking).toBe(true);
    advance(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(loop.blocking).toBe(false);
    expect(loop.current).toBe('IDLE');
  });

  it('a scene whose end state throws still never jams the game', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    loop.begin('broken', { finish: () => { throw new Error('boom'); } });
    expect(loop.skip()).toBe(1);
    expect(loop.blocking).toBe(false);
  });

  it('skip jumps the skippable reactions to their end, once; the others play on', () => {
    const { timers } = manualTimers();
    const loop = new FeedbackLoop(timers);
    const fast = jest.fn();
    const keep = jest.fn();
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    const endFast = loop.begin('crossing', { finish: fast });
    const endKeep = loop.begin('must-see', { finish: keep, skippable: false });
    expect(loop.skippable).toBe(true);
    expect(loop.skip()).toBe(1);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(keep).not.toHaveBeenCalled();
    expect(loop.blocking).toBe(true);
    endFast(); // the animation's own end after a skip does nothing more
    expect(fast).toHaveBeenCalledTimes(1);
    endKeep();
    expect(loop.blocking).toBe(false);
  });

  it('independent effects never block', () => {
    const loop = new FeedbackLoop(manualTimers().timers);
    loop.begin('bubbles', { critical: false });
    expect(loop.blocking).toBe(false);
    expect(loop.submit('t1', 'a')).toBe('ok');
  });

  it('a step of a two-step challenge goes back to interacting', () => {
    const loop = new FeedbackLoop(manualTimers().timers);
    loop.present('t1');
    loop.submit('t1', 'w3');
    loop.judge('e1', true, false);
    loop.begin('found')();
    expect(loop.current).toBe('INTERACTING');
  });

  it('subscribers hear phase and blocking changes only; dispose leaves no timer', () => {
    const { timers, count } = manualTimers();
    const loop = new FeedbackLoop(timers);
    const heard = jest.fn();
    loop.subscribe(heard);
    const before = loop.getSnapshot();
    loop.touch(); // IDLE → INTERACTING
    expect(heard).toHaveBeenCalledTimes(1);
    expect(loop.getSnapshot()).not.toBe(before);
    const snap = loop.getSnapshot();
    loop.touch(); // nothing changes
    expect(loop.getSnapshot()).toBe(snap);
    loop.submit('t1', 'a');
    loop.judge('e1', true);
    loop.begin('x');
    expect(count()).toBeGreaterThan(0);
    loop.dispose();
    expect(count()).toBe(0);
    expect(loop.submit('t1', 'b')).toBe('busy');
  });
});
