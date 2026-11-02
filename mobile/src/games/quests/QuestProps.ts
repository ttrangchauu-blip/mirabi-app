/** What every world's scene is given: the stage's progress (right answers `done` of `total`, from the session), a key
 * bumped on each wrong answer, the pet, and whether it may move. `hold`: the answered question waits for "Câu tiếp
 * theo", so the world shows what the answer did but brings no next challenge in yet. */
export type QuestProps = {
  done: number; total: number; wrongKey: number; petId: string; petLevel: number; reduceMotion: boolean; running: boolean;
  hold?: boolean;
};
