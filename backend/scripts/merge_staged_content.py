"""Move drafted content from app/data/staging into the bundled banks, as drafts.

    python scripts/merge_staged_content.py [--source mirabi-ai-2026-10] [--dry-run]

Vocabulary: staging/vocabulary/<topic>.p<N>.tsv rows are appended to app/data/vocabulary/<topic>.tsv. A key already used
elsewhere gets the topic as its sense suffix when the meaning differs (bank -> bank.environment), and is dropped when it
is the same word with the same meaning (a duplicate written by two writers).
Grammar: staging/grammar/<point>.p<N>.<game>.tsv rows go to app/data/grammar/<point>.<game>.tsv.

Every merged row is stamped with `source` and `status = draft`: nothing merged here is served before
`python -m app.learning_vocab qa/publish` and `python -m app.learning_grammar_bank qa/publish` let it through.
Running the merge again skips keys that are already in the bank, so it never creates duplicates.
"""
from __future__ import annotations

import csv
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.learning_engine import normalize_text  # noqa: E402
from app.learning_grammar_bank import CHOICE_COLUMNS, ORDER_COLUMNS, POINT  # noqa: E402
from app.learning_vocab import COLUMNS as VOCAB_COLUMNS, TOPIC_CODES  # noqa: E402

DATA = ROOT / "app" / "data"
STAGING = DATA / "staging"
VOCAB_HEADER = VOCAB_COLUMNS[:13]  # key .. status (cefr and audio stay empty: no CEFR claimed, no recordings)


def read_tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        rows = [r for r in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)]
    header = [h.strip() for h in rows[0]] if rows else []
    return header, [r for r in rows[1:] if any(c.strip() for c in r) and not r[0].startswith("#")]


def write_tsv(path: Path, header: list[str], rows: list[list[str]], append: bool) -> None:
    exists = append and path.exists()
    with open(path, "a" if exists else "w", encoding="utf-8", newline="") as handle:
        if not exists:
            handle.write("\t".join(header) + "\n")
        for r in rows:
            handle.write("\t".join(c.replace("\t", " ").replace("\n", " ").strip() for c in r) + "\n")


def merge_vocabulary(source: str, dry_run: bool) -> Counter:
    counts = Counter()
    keys: dict[str, tuple[str, str, str]] = {}  # key -> (word, meaning, topic) of the bank so far
    senses: set[tuple[str, str]] = set()
    for path in sorted((DATA / "vocabulary").glob("*.tsv")):
        header, rows = read_tsv(path)
        for r in rows:
            c = dict(zip(header, r))
            keys[c["key"]] = (c["word"], c["meaning_vi"], c["topic"])
            senses.add((normalize_text(c["word"]), normalize_text(c["meaning_vi"])))
    staged: dict[str, list[list[str]]] = defaultdict(list)
    for path in sorted((STAGING / "vocabulary").glob("*.tsv")):
        topic = path.name.split(".")[0]
        header, rows = read_tsv(path)
        if topic not in TOPIC_CODES or tuple(header[:9]) != VOCAB_COLUMNS[:9]:
            print(f"skipped {path.name}: unknown topic or header")
            counts["skipped_files"] += 1
            continue
        for r in rows:
            c = dict(zip(header, [x.strip() for x in r]))
            c.setdefault("accepted", "")
            c.setdefault("phonetic", "")
            word, meaning, key = c.get("word", ""), c.get("meaning_vi", ""), c.get("key", "")
            sense = (normalize_text(word), normalize_text(meaning))
            if sense in senses:
                counts["duplicate_sense_dropped"] += 1
                continue
            if key in keys:
                if normalize_text(keys[key][0]) == normalize_text(word) and normalize_text(keys[key][1]) == normalize_text(meaning):
                    counts["duplicate_key_dropped"] += 1
                    continue
                base, _, sense_tag = key.partition(".")
                new_key = f"{base}.{sense_tag}_{topic}" if sense_tag else f"{base}.{topic}"
                if new_key in keys or len(new_key) > 50:
                    counts["key_collision_dropped"] += 1
                    continue
                key = new_key
                counts["key_renamed"] += 1
            keys[key] = (word, meaning, topic)
            senses.add(sense)
            c["key"], c["source"], c["status"], c["topic"] = key, source, "draft", c.get("topic") or topic
            staged[topic].append([c.get(col, "") for col in VOCAB_HEADER])
            counts["merged"] += 1
    if not dry_run:
        for topic, rows in staged.items():
            path = DATA / "vocabulary" / f"{topic}.tsv"
            if path.exists():
                header, _ = read_tsv(path)
                if tuple(header) != VOCAB_HEADER:
                    raise SystemExit(f"{path.name} has another header; convert it first")
            write_tsv(path, list(VOCAB_HEADER), rows, append=True)
    return counts


def merge_grammar(source: str, dry_run: bool) -> Counter:
    counts = Counter()
    (DATA / "grammar").mkdir(exist_ok=True)
    existing = set()
    for path in (DATA / "grammar").glob("*.tsv"):
        existing |= {r[0].strip() for r in read_tsv(path)[1]}
    staged: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for path in sorted((STAGING / "grammar").glob("*.tsv")):
        match = re.match(r"^([a-z0-9_]+)(?:\.p\d+)?\.(choice|order)\.tsv$", path.name)
        if not match or match.group(1) not in POINT:
            print(f"skipped {path.name}: unknown point or name")
            counts["skipped_files"] += 1
            continue
        point, game = match.groups()
        columns = CHOICE_COLUMNS if game == "choice" else ORDER_COLUMNS
        header, rows = read_tsv(path)
        if tuple(header) not in (columns, columns[:-2]):
            print(f"skipped {path.name}: header")
            counts["skipped_files"] += 1
            continue
        for r in rows:
            c = dict(zip(header, [x.strip() for x in r]))
            if c.get("key") in existing:
                counts["already_merged"] += 1
                continue
            existing.add(c.get("key"))
            c["source"], c["status"] = source, "draft"
            staged[(point, game)].append([c.get(col, "") for col in columns])
            counts[f"merged_{game}"] += 1
    if not dry_run:
        for (point, game), rows in staged.items():
            columns = CHOICE_COLUMNS if game == "choice" else ORDER_COLUMNS
            write_tsv(DATA / "grammar" / f"{point}.{game}.tsv", list(columns), rows, append=True)
    return counts


if __name__ == "__main__":
    args = sys.argv[1:]
    source = args[args.index("--source") + 1] if "--source" in args else "mirabi-ai-2026-10"
    dry = "--dry-run" in args
    print("vocabulary:", dict(merge_vocabulary(source, dry)))
    print("grammar:", dict(merge_grammar(source, dry)))
