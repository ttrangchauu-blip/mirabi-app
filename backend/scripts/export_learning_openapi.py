"""Write docs/learning-openapi.json: the learning part of the live OpenAPI document — the games and lessons
(/api/learning), the school grade, school years, Kho lưu trữ and Sổ tay kiến thức (/api/education) and their
administration (/api/admin/education) — and validate it (OpenAPI 3.1, unique operation ids, every $ref resolved).

Run from backend/:  .venv\\Scripts\\python scripts/export_learning_openapi.py [--check]
--check only compares the file with the live document (exit 1 when it is out of date). Like
export_study_together_openapi.py it only imports the app (in-memory database, nothing written elsewhere).
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("STUDY_ROOM_TICK_SECONDS", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from export_study_together_openapi import refs  # noqa: E402

PREFIXES = ("/api/learning", "/api/education", "/api/admin/education")
TARGET = Path(__file__).resolve().parents[2] / "docs" / "learning-openapi.json"


def build() -> dict:
    spec = app.openapi()
    paths = {p: v for p, v in spec["paths"].items() if p.startswith(PREFIXES)}
    schemas = spec.get("components", {}).get("schemas", {})
    used: set[str] = set()
    refs(paths, used)
    while True:
        before = len(used)
        for name in list(used):
            refs(schemas.get(name, {}), used)
        if len(used) == before:
            break
    return {"openapi": spec["openapi"],
            "info": {"title": "Mirabi API - Learning (games, lessons, school years, archive)", "version": spec["info"]["version"],
                     "description": "Subset of the live OpenAPI document (/docs). Rules: docs/LEARNING_GAMES.md and "
                                    "docs/LEARNING_ARCHIVE.md. Errors are {detail, code}; the codes are listed per response. "
                                    "Regenerate with backend/scripts/export_learning_openapi.py."},
            "paths": paths,
            "components": {"schemas": {k: v for k, v in schemas.items() if k in used},
                           "securitySchemes": spec.get("components", {}).get("securitySchemes", {})}}


def problems(doc: dict) -> list[str]:
    """Spec validation plus what the validator does not check: unique operation ids and resolvable $refs."""
    from openapi_spec_validator import validate
    found = []
    try:
        validate(doc)
    except Exception as exc:  # the validator's own error types
        found.append(f"invalid OpenAPI: {exc}")
    ids = Counter(op.get("operationId") for item in doc["paths"].values() for op in item.values() if isinstance(op, dict))
    found += [f"duplicate operationId {i}" for i, n in ids.items() if n > 1]
    used: set[str] = set()
    refs(doc, used)
    found += [f"unresolved $ref {name}" for name in sorted(used - set(doc["components"]["schemas"]))]
    return found


def main() -> None:
    doc = build()
    errors = problems(doc)
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            print(f"{TARGET} is out of date: run scripts/export_learning_openapi.py")
            sys.exit(1)
        print("up to date and valid")
        return
    TARGET.write_text(text, encoding="utf-8")
    print(f"{len(doc['paths'])} paths, {sum(len(v) for v in doc['paths'].values())} operations, valid -> {TARGET}")


if __name__ == "__main__":
    main()
