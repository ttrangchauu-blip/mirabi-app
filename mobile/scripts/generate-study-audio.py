"""Regenerate the original, loopable Study Space ambience WAVs with stdlib only."""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22_050
SECONDS = 12
COUNT = RATE * SECONDS
OUTPUT = Path(__file__).parents[1] / "assets" / "audio"


def sample(kind: str, rng: random.Random, t: float, previous: float) -> tuple[float, float]:
    noise = rng.uniform(-1, 1)
    if kind == "white-noise":
        return noise * 0.17, previous
    if kind == "rain":
        previous = 0.985 * previous + 0.015 * noise
        drop = rng.uniform(-1, 1) * 0.35 if rng.random() < 0.0017 else 0
        return (noise - previous) * 0.5 + drop, previous
    if kind == "forest":
        previous = 0.985 * previous + 0.015 * noise
        bird = 0.012 * math.sin(2 * math.pi * (880 + 70 * math.sin(t * 0.21)) * t) if math.sin(t * 4.2) > 0.88 else 0
        return (noise - previous) * 0.045 + bird, previous
    if kind == "stream":
        previous = 0.94 * previous + 0.06 * noise
        return (noise - previous) * 0.29 + 0.045 * math.sin(2 * math.pi * 3.2 * t) * noise, previous
    if kind == "cafe":
        previous = 0.93 * previous + 0.07 * noise
        murmur = 0.012 * math.sin(2 * math.pi * (170 + 25 * math.sin(t * 0.7)) * t)
        return previous * 0.095 + murmur * (1 if math.sin(t * 1.7) > 0.75 else 0.12), previous
    previous = 0.985 * previous + 0.015 * noise
    lofi = 0.035 * math.sin(2 * math.pi * 110 * t) + 0.022 * math.sin(2 * math.pi * 164.81 * t)
    return previous * 0.13 + lofi, previous


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for kind in ("rain", "forest", "stream", "cafe", "lofi", "white-noise"):
        rng = random.Random(kind)
        previous = 0.0
        with wave.open(str(OUTPUT / f"{kind}.wav"), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(RATE)
            frames = bytearray()
            for i in range(COUNT):
                value, previous = sample(kind, rng, i / RATE, previous)
                fade = min(1, i / (RATE * 0.12), (COUNT - 1 - i) / (RATE * 0.12))
                frames.extend(struct.pack("<h", round(max(-1, min(1, value * max(0, fade))) * 32767)))
            audio.writeframes(frames)


if __name__ == "__main__":
    main()
