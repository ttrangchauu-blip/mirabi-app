"""Regenerate the short sound effects of the visual learning games (assets/audio/sfx-*.wav) with stdlib only.

Each cue is a few tones and filtered noise with a soft attack and decay: short (under 0.7 s), quiet, mono 22.05 kHz,
so several can play close together without clipping. The shooters keep their own game-shot.wav / game-break.wav.
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22_050
OUTPUT = Path(__file__).parents[1] / "assets" / "audio"


def env(t: float, length: float, attack: float = 0.008) -> float:
    """A quick rise, then an exponential fall to silence at `length`."""
    if t < attack:
        return t / attack
    left = max(0.0, 1 - (t - attack) / (length - attack))
    return left * left


def tone(freq: float, t: float) -> float:
    return math.sin(2 * math.pi * freq * t)


def cue(name: str):
    """The sample at t (seconds) of a cue, and its length."""
    rng = random.Random(name)
    state = {"lp": 0.0}

    def noise(alpha: float) -> float:
        state["lp"] += alpha * (rng.uniform(-1, 1) - state["lp"])
        return state["lp"]

    if name == "cast":  # a rising magic shimmer
        length = 0.42
        return length, lambda t: env(t, length, 0.02) * (
            0.32 * tone(520 + 900 * t / length, t) + 0.16 * tone(1040 + 1800 * t / length, t) * (0.5 + 0.5 * tone(28, t)))
    if name == "hit":  # a soft thump with a little crunch
        length = 0.28
        return length, lambda t: env(t, length) * (0.55 * tone(150 - 90 * t / length, t) + 0.35 * noise(0.35))
    if name == "pickup":  # two quick bright notes
        length = 0.3
        return length, lambda t: env(t, length) * 0.3 * (tone(988, t) if t < 0.09 else tone(1319, t))
    if name == "unlock":  # a click, then an opening chord
        length = 0.62
        return length, lambda t: (env(t, 0.05) * 0.5 * noise(0.6) if t < 0.05 else 0) + (
            env(t - 0.06, length - 0.06, 0.03) * 0.18 * (tone(523, t) + tone(659, t) + tone(784, t)) if t >= 0.06 else 0)
    if name == "complete":  # a little rising fanfare
        length = 0.7
        notes = (523, 659, 784, 1047)

        def complete(t: float) -> float:
            i = min(3, int(t / 0.12))
            local = t - i * 0.12
            return env(local, length - i * 0.12, 0.01) * 0.26 * (tone(notes[i], t) + 0.4 * tone(notes[i] * 2, t))
        return length, complete
    if name == "wrong":  # a gentle low wobble (never harsh)
        length = 0.36
        return length, lambda t: env(t, length, 0.02) * 0.28 * tone(220 - 60 * t / length + 8 * tone(14, t), t)
    if name == "whoosh":  # air moving past: a portal, a scene change
        length = 0.5
        return length, lambda t: math.sin(math.pi * t / length) ** 2 * 0.45 * noise(0.04 + 0.25 * t / length)
    raise ValueError(name)


CUES = ("cast", "hit", "pickup", "unlock", "complete", "wrong", "whoosh")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in CUES:
        length, fn = cue(name)
        count = int(RATE * length)
        frames = bytearray()
        for i in range(count):
            value = fn(i / RATE)
            frames.extend(struct.pack("<h", round(max(-1, min(1, value)) * 32767)))
        with wave.open(str(OUTPUT / f"sfx-{name}.wav"), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(RATE)
            audio.writeframes(frames)


if __name__ == "__main__":
    main()
