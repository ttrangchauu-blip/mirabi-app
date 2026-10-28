"""Write docs/study-together-openapi.json: the Study Together part of the live OpenAPI document.

Run from backend/:  .venv\\Scripts\\python scripts/export_study_together_openapi.py
It only imports the app (no server, no database writes beyond an in-memory engine).
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("STUDY_ROOM_TICK_SECONDS", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

PREFIXES = ("/api/friends", "/api/friend-requests", "/api/users/", "/api/blocks", "/api/social", "/api/study-rooms",
            "/api/room-invitations", "/api/group-sessions", "/api/team-quests", "/api/notifications", "/api/realtime",
            "/api/study-together", "/api/admin/social", "/api/personal-room/visit")


def refs(node, found: set[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref":
                found.add(value.rsplit("/", 1)[-1])
            refs(value, found)
    elif isinstance(node, list):
        for value in node:
            refs(value, found)


def main() -> None:
    spec = app.openapi()
    paths = {p: v for p, v in spec["paths"].items() if p.startswith(PREFIXES)}
    schemas = spec.get("components", {}).get("schemas", {})
    used: set[str] = set()
    refs(paths, used)
    while True:  # schemas referenced by schemas
        before = len(used)
        for name in list(used):
            refs(schemas.get(name, {}), used)
        if len(used) == before:
            break
    out = {"openapi": spec["openapi"],
           "info": {"title": "Mirabi API - Study Together", "version": spec["info"]["version"],
                    "description": "Subset of the live OpenAPI document (/docs). Regenerate with "
                                   "backend/scripts/export_study_together_openapi.py."},
           "paths": paths,
           "components": {"schemas": {k: v for k, v in schemas.items() if k in used},
                          "securitySchemes": spec.get("components", {}).get("securitySchemes", {})}}
    target = Path(__file__).resolve().parents[2] / "docs" / "study-together-openapi.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(paths)} paths, {sum(len(v) for v in paths.values())} operations -> {target}")


if __name__ == "__main__":
    main()
