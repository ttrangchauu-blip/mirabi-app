import React, { useState } from 'react';
import { MathBattle } from '../../screens/learning/games/MathBattle';
import type { QuestProps } from './QuestProps';

// Math Kingdom (Toán lessons played as Sắp xếp, Ghép cặp, Chọn đáp án): Math Battle's arena above the lesson's own
// game. Each right answer is the pet's spell: the bolt flies, the monster loses a point, monsters fall one after
// another through the magic forest, the crystal cave and the castle to the Crystal King; a wrong answer is the
// monster's strike. No hearts and no problem card here: the lesson's game below is the question.

export function KingdomQuest({ done, total, wrongKey, petId, petLevel, reduceMotion, running, hold = false }: QuestProps) {
  // The hit comes in the same render as the new count (as in the duel), so the monster is defeated before the next
  // one steps in: state derived while rendering, not in an effect.
  const [seen, setSeen] = useState(done);
  const [flash, setFlash] = useState<{ turnId: string; kind: 'hit' } | null>(null);
  if (done !== seen) {
    setSeen(done);
    if (done > seen) setFlash({ turnId: `quest-${done}`, kind: 'hit' });
  }
  return (
    <MathBattle problem={null} required={total} resolved={done} hearts={0} heartsMax={0} flash={flash} wrongKey={wrongKey} petId={petId}
      petLevel={petLevel} reduceMotion={reduceMotion} running={running} hold={hold} bare />
  );
}
