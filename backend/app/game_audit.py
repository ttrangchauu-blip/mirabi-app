"""Game audit: for every lesson of the catalog, the activity it teaches, the games it publishes, whether they are the
right kind of game for it, and what is still missing. Pure (reads the catalog, no database).

    python -m app.game_audit             a summary per subject, and the problems found
    python -m app.game_audit --markdown  docs/GAME_AUDIT.md (the full mapping môn → bài → gameplay)
    python -m app.game_audit --strict    exit 1 when a ready lesson publishes the wrong kind of game, the same gameplay
                                         twice, a question also used by another lesson, or a game outside its grades

Status of a ready lesson:
- `ok` (Phù hợp): it publishes a ready gameplay made for its activity;
- `fix` (Cần sửa): a gameplay made for its activity is built, the lesson does not use it yet;
- `waiting` (Chờ game): the gameplay made for it is still planned; its games fit the activity meanwhile;
- `wrong` (Sai dạng): none of its games serves the activity.
A planned lesson is `planned` (Chưa có nội dung). The game is never chosen from the subject alone.
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict

from . import game_registry as gr, lesson_catalog as lc, lesson_games as lg

STATUS_LABEL = {"ok": "Phù hợp", "fix": "Cần sửa", "waiting": "Chờ game chuyên biệt", "wrong": "Sai dạng game", "planned": "Chưa có nội dung"}
# Words in a game's title that promise a gameplay: a title saying "Dòng thời gian" over a plain ordering game is the
# "khác tên nhưng giống gameplay" case.
PROMISES = {"timeline": ("dong thoi gian", "timeline"), "lab": ("thi nghiem", "lap mach"), "geometry": ("do goc", "xuong hinh"),
            "balance": ("can bang phuong trinh",), "map_explorer": ("ban do",)}


def _signatures(spec: dict, grade: int) -> list[tuple]:
    """The questions of a game, as the catalog compares them (two equal signatures are the same question)."""
    game = spec["game"]
    out = []
    for t in spec.get("tasks", []):
        if game in lg.GAMES:
            sig = lg.validate_task(game, t, lc.limits(grade), "", [])
        elif game == "order":
            sig = ("order", tuple(t["items"]))
        elif game == "match":
            sig = ("match", tuple(sorted(map(tuple, t["pairs"]))))
        elif game == "choice":
            sig = ("choice", t.get("passage"), t.get("question"))
        else:
            sig = (game, t.get("key"), t.get("goal"))
        if sig:
            out.append(sig)
    if game == "sorting":
        groups = tuple(sorted(g["label"] for g in spec["set"]["groups"]))
        out += [("sorting", groups, c["text"]) for c in spec["set"]["cards"]]
    return out


def lesson_rows() -> list[dict]:
    rows = []
    for key, entry in lc.catalog()["lessons"].items():
        lesson = entry["lesson"]
        activity, declared = gr.activity_of(entry)
        games = [g["game"] for g in lesson.get("games", [])]
        fits = {g: gr.fit(activity, g) for g in games}
        recommended = gr.recommend(activity, entry["grade"])
        ready_best = [r["game"] for r in recommended if r["status"] == gr.READY and r["grade_ok"]]
        if lesson["status"] != "ready":
            status = "planned"
        elif any(f == "best" for f in fits.values()):
            status = "ok"
        elif ready_best:
            status = "fix"
        elif any(f == "fits" for f in fits.values()):
            status = "waiting"
        else:
            status = "wrong"
        rows.append({"key": key, "subject": entry["subject"], "grade": entry["grade"], "chapter": entry["chapter"]["title"],
                     "title": lesson["title"], "lesson_status": lesson["status"], "activity": activity, "declared": declared,
                     "games": games, "fits": fits, "titles": {g["game"]: g["title"] for g in lesson.get("games", [])},
                     "recommended": recommended, "status": status})
    return sorted(rows, key=lambda r: (r["subject"], r["grade"], r["key"]))


def problems() -> dict[str, list[str]]:
    """The checks of the audit, by kind (each a list of lines)."""
    found: dict[str, list[str]] = defaultdict(list)
    seen_questions: dict[tuple, str] = {}
    for key, entry in sorted(lc.catalog()["lessons"].items()):
        lesson = entry["lesson"]
        if lesson["status"] != "ready":
            continue
        families = Counter(gr.GAMEPLAYS[g["game"]]["family"] for g in lesson["games"])
        for family, n in families.items():
            if n > 1 and family != "falling_typing":  # Anh → Việt and Việt → Anh are two directions by design
                found["same_gameplay"].append(f"{key}: {n} games of one gameplay ({family})")
        for spec in lesson["games"]:
            game = spec["game"]
            gp = gr.GAMEPLAYS[game]
            if not gp["grades"][0] <= entry["grade"] <= gp["grades"][1]:
                found["grade"].append(f"{key}: {game} is made for grades {gp['grades'][0]}–{gp['grades'][1]}, used in grade {entry['grade']}")
            title = gr._fold(spec["title"])
            for promised, words in PROMISES.items():
                if promised != game and any(w in title for w in words) and not (promised == "timeline" and game == "order"
                                                                                 and spec.get("tasks") and _is_reconstruction(spec)):
                    found["misnamed"].append(f"{key}: “{spec['title']}” is played as {gp['name']} ({game}), not {gr.GAMEPLAYS[promised]['name']}")
            if game in lc.CONTENT_GAMES and game != "code_path":
                for sig in _signatures(spec, entry["grade"]):
                    where = f"{key}/{game}"
                    other = seen_questions.setdefault((entry["subject"], sig), where)
                    if other != where:
                        found["duplicate_question"].append(f"{where}: the same question as {other}")
    return found


def _is_reconstruction(spec: dict) -> bool:
    """An ordering game whose title says timeline but whose tasks are the steps of one event (diễn biến): fine."""
    return all("dien bien" in gr._fold(t.get("prompt", "")) for t in spec.get("tasks", []))


def subject_summary(rows: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for r in rows:
        s = out.setdefault(r["subject"], {"subject": r["subject"], "lessons": 0, "ready": 0, **{k: 0 for k in STATUS_LABEL},
                                          "gameplays": Counter()})
        s["lessons"] += 1
        s[r["status"]] += 1
        if r["lesson_status"] == "ready":
            s["ready"] += 1
            s["gameplays"].update(r["games"])
    return list(out.values())


def _names(games: list[str]) -> str:
    return ", ".join(lc.GAME_SHORT.get(g, g) for g in games) or "—"


def markdown() -> str:
    rows = lesson_rows()
    found = problems()
    ready = [r for r in rows if r["lesson_status"] == "ready"]
    slots = Counter(g for r in ready for g in r["games"])
    generic = sum(n for g, n in slots.items() if g in ("order", "match", "choice", "sorting"))
    out = ["# Game audit: môn học → bài học → gameplay", "",
           "Generated by `python -m app.game_audit --markdown` from the lesson catalog (`backend/app/data/catalog/`) and the game",
           "registry (`backend/app/game_registry.py`). Do not edit by hand: change a lesson's games or its `activity`, then",
           "generate again.", "",
           "## How a lesson's game is chosen", "",
           "1. **Activity** (hoạt động học tập): what the lesson teaches — a chronology, a grammar structure, an electric",
           "   circuit… A lesson declares it (`\"activity\"` in its JSON); otherwise it is inferred from its subject, title,",
           "   chapter and objectives (marked *suy luận*). Never from the subject alone.",
           "2. **Gameplays made for it** (`best`) and gameplays that can carry it honestly meanwhile (`fits`):",
           "   `game_registry.ACTIVITIES`. A ready gameplay made for the activity is the one to publish.",
           "3. **Status**: " + "; ".join(f"`{k}` {v}" for k, v in STATUS_LABEL.items()) + ". A lesson waiting for a planned",
           "   gameplay is listed with it; the generic quiz is never added to hide the gap.", "",
           "## Summary", "",
           f"- {len(rows)} lessons in the catalog, {len(ready)} ready; {sum(slots.values())} games published by ready lessons, "
           f"{generic} of them one of the four generic gameplays (Sắp xếp, Ghép cặp, Chọn đáp án, Phân loại).",
           f"- Ready lessons: " + ", ".join(f"{STATUS_LABEL[k]} {sum(1 for r in ready if r['status'] == k)}"
                                            for k in ("ok", "fix", "waiting", "wrong")) + ".",
           f"- Gameplays: {sum(1 for g in gr.GAMEPLAYS.values() if g['status'] == gr.READY)} built, "
           f"{sum(1 for g in gr.GAMEPLAYS.values() if g['status'] == gr.PLANNED)} planned.", "",
           "| Gameplay | Family | Status | Lessons using it |", "|---|---|---|---|"]
    for code, gp in gr.GAMEPLAYS.items():
        out.append(f"| {gp['name']} (`{code}`) | {gp['family']} | {'Đã có' if gp['status'] == gr.READY else 'Cần xây dựng'} | {slots.get(code, 0)} |")
    out += ["", "### Per subject", "", "| Môn | Bài (sẵn sàng / tổng) | Phù hợp | Cần sửa | Chờ game | Sai dạng | Gameplay đang dùng |",
            "|---|---|---|---|---|---|---|"]
    for s in subject_summary(rows):
        uses = ", ".join(f"{lc.GAME_SHORT.get(g, g)} ×{n}" for g, n in s["gameplays"].most_common())
        out.append(f"| {lc.subject_name(s['subject'], None)} | {s['ready']} / {s['lessons']} | {s['ok']} | {s['fix']} | {s['waiting']} | "
                   f"{s['wrong']} | {uses or '—'} |")
    waiting = Counter(r["recommended"][0]["game"] for r in ready if r["status"] == "waiting" and r["recommended"])
    out += ["", "### Gameplays to build next (ready lessons waiting for them)", "", "| Gameplay | Lessons waiting |", "|---|---|"]
    for code, n in waiting.most_common():
        out.append(f"| {gr.GAMEPLAYS[code]['name']} (`{code}`) | {n} |")
    out += ["", "## Problems found", ""]
    labels = {"same_gameplay": "Hai game cùng gameplay trong một bài", "misnamed": "Tên game hứa một gameplay khác",
              "duplicate_question": "Câu hỏi trùng giữa các bài", "grade": "Gameplay ngoài khối lớp phù hợp"}
    for kind, label in labels.items():
        items = found.get(kind, [])
        out.append(f"- **{label}**: {len(items)}")
        out += [f"  - {line}" for line in items[:40]]
        if len(items) > 40:
            out.append(f"  - … and {len(items) - 40} more")
    out += ["- Checked when a lesson file is loaded (an invalid file stops the server): a ready lesson without a game, a game",
            "  without enough questions, a question without an answer or an explanation, the same option twice, content",
            "  longer than the grade allows, a timeline without two different times, an equation that does not balance or",
            "  balances in several unrelated ways, a geometry target no shape on the grid can meet.", ""]
    out += ["## Ready lessons", "", "| Môn | Lớp | Bài học | Hoạt động | Game hiện tại | Gameplay phù hợp | Trạng thái |", "|---|---|---|---|---|---|---|"]
    for r in ready:
        activity = gr.ACTIVITIES.get(r["activity"], gr.ACTIVITIES["concepts"])["label"] + ("" if r["declared"] else " (suy luận)")
        rec = ", ".join(f"{x['name']}{'' if x['status'] == gr.READY else ' (cần xây dựng)'}" for x in r["recommended"]) or "—"
        out.append(f"| {lc.subject_name(r['subject'], r['grade'])} | {r['grade']} | {r['title']} (`{r['key']}`) | {activity} | "
                   f"{_names(r['games'])} | {rec} | {STATUS_LABEL[r['status']]} |")
    planned = [r for r in rows if r["lesson_status"] != "ready"]
    by_need = Counter((r["recommended"][0]["game"] if r["recommended"] else "—") for r in planned)
    out += ["", "## Planned lessons (no content yet)", "",
            f"{len(planned)} lessons are listed but not written. The gameplay each will need, by its inferred activity:", "",
            "| Gameplay made for them | Lessons |", "|---|---|"]
    for code, n in by_need.most_common():
        out.append(f"| {gr.GAMEPLAYS[code]['name'] + ' (`' + code + '`)' if code in gr.GAMEPLAYS else 'Chưa xác định (khái niệm)'} | {n} |")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    if argv[:1] == ["--markdown"]:
        print(markdown(), end="")
        return 0
    rows = lesson_rows()
    for s in subject_summary(rows):
        print(f"{s['subject']:<18} ready {s['ready']:>3}/{s['lessons']:<4} ok {s['ok']:>3}  fix {s['fix']:>3}  waiting {s['waiting']:>3}  "
              f"wrong {s['wrong']:>3}")
    found = problems()
    for kind, items in found.items():
        print(f"\n{kind}: {len(items)}")
        for line in items[:15]:
            print("  " + line)
    strict = sum(len(found.get(k, [])) for k in ("same_gameplay", "duplicate_question", "grade")) + sum(
        1 for r in rows if r["status"] == "wrong")
    return 1 if "--strict" in argv and strict else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv[1:]))
