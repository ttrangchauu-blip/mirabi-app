"""Write docs/learning-openapi.json: the learning-games part (/api/learning) of the live OpenAPI document.

Run from backend/:  .venv\\Scripts\\python scripts/export_learning_openapi.py
Like export_study_together_openapi.py it only imports the app (in-memory database, nothing written elsewhere).
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("STUDY_ROOM_TICK_SECONDS", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402
from export_study_together_openapi import refs  # noqa: E402


def main() -> None:
    spec = app.openapi()
    paths = {p: v for p, v in spec["paths"].items() if p.startswith("/api/learning")}
    schemas = spec.get("components", {}).get("schemas", {})
    used: set[str] = set()
    refs(paths, used)
    while True:
        before = len(used)
        for name in list(used):
            refs(schemas.get(name, {}), used)
        if len(used) == before:
            break
    out = {"openapi": spec["openapi"],
           "info": {"title": "Mirabi API - Learning games (English & Math)", "version": spec["info"]["version"],
                    "description": "Subset of the live OpenAPI document (/docs). Rules: docs/LEARNING_GAMES.md. "
                                   "Regenerate with backend/scripts/export_learning_openapi.py."},
           "paths": paths,
           "components": {"schemas": {k: v for k, v in schemas.items() if k in used},
                          "securitySchemes": spec.get("components", {}).get("securitySchemes", {})}}
    target = Path(__file__).resolve().parents[2] / "docs" / "learning-openapi.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(paths)} paths, {sum(len(v) for v in paths.values())} operations -> {target}")


if __name__ == "__main__":
    main()
