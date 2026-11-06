"""What grows in Vườn nhà: the plants, their tiers, their stages, and the shop's prices and the harvests' rewards.

Everything comes from data/garden_plants.json, so the numbers are changed on the backend, never in the app. The file is
checked when it is loaded (`validate`): a plant outside its tier's ranges, a seed sold at a loss or a stage list that
doesn't end at 1.0 stops the server rather than reaching users. Ids (plant ids and seed item ids) are stored in
inventories, plots and harvests: only ever add them.

A plant grows in real time from `planted_at` (the app being closed changes nothing). Its stage is the last one whose `at`
share of the growing time has passed; the last stage ("Sẵn sàng thu hoạch") is reached when the whole time has passed.
This module imports nothing of the app, so items_catalog can read the seeds from it.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

DATA = Path(__file__).with_name("data") / "garden_plants.json"


def validate(data: dict) -> list[str]:
    """What is wrong with a catalog (empty when nothing is)."""
    problems: list[str] = []
    stages = data.get("stages") or []
    ats = [s.get("at") for s in stages]
    if len(stages) < 2 or ats[0] != 0 or ats[-1] != 1 or any(b <= a for a, b in zip(ats, ats[1:])):
        problems.append("stages must start at 0, end at 1 and grow")
    if any(not s.get("label") for s in stages):
        problems.append("every stage needs a label")
    tiers = {t["id"]: t for t in data.get("tiers", [])}
    seen_ids, seen_items = set(), set()
    for p in data.get("plants", []):
        where = p.get("id", "?")
        for key in ("id", "seed_item", "name", "seed_name", "description", "tier", "art"):
            if not p.get(key):
                problems.append(f"{where}: missing {key}")
        if p.get("id") in seen_ids or p.get("seed_item") in seen_items:
            problems.append(f"{where}: id or seed_item used twice")
        seen_ids.add(p.get("id")); seen_items.add(p.get("seed_item"))
        tier = tiers.get(p.get("tier"))
        if tier is None:
            problems.append(f"{where}: unknown tier {p.get('tier')}")
            continue
        for key in ("grow_minutes", "harvest_exp", "harvest_coins"):
            if not isinstance(p.get(key), int) or p[key] <= 0:
                problems.append(f"{where}: {key} must be a positive whole number")
        if problems and problems[-1].startswith(f"{where}:"):
            continue
        r = tier["ranges"]
        for key, (low, high) in (("harvest_exp", r["exp"]), ("harvest_coins", r["coins"]), ("grow_minutes", r["minutes"])):
            if not low <= p[key] <= high:
                problems.append(f"{where}: {key} {p[key]} is outside {tier['id']}'s {low}-{high}")
        price = p.get("seed_price")
        if price is not None and (not isinstance(price, int) or price <= 0 or price >= p["harvest_coins"]):
            problems.append(f"{where}: a seed must cost something and less than its harvest gives")
    return problems


def load(path: Path = DATA) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    problems = validate(data)
    if problems:
        raise ValueError("garden_plants.json: " + "; ".join(problems))
    return data


_DATA = load()
STAGES: list[dict] = _DATA["stages"]
STAGE_LABELS = tuple(s["label"] for s in STAGES)
READY_STAGE = len(STAGES) - 1
TIERS: dict[str, dict] = {t["id"]: t for t in _DATA["tiers"]}
TIER_ORDER = tuple(TIERS)
PLANTS: dict[str, dict] = {p["id"]: {**p, "grow_seconds": p["grow_minutes"] * 60} for p in _DATA["plants"]}
BY_SEED: dict[str, dict] = {p["seed_item"]: p for p in PLANTS.values()}
# A seed in the ground whose plant left the catalog grows and gives as the seedling does.
FALLBACK = PLANTS["seedling"]


def plant_of(item_id: str) -> dict:
    return BY_SEED.get(item_id, FALLBACK)


def for_sale() -> list[dict]:
    """The shop's plants, by tier and then by price."""
    return sorted((p for p in PLANTS.values() if p.get("seed_price") is not None),
                  key=lambda p: (TIER_ORDER.index(p["tier"]), p["seed_price"], p["grow_minutes"]))


def unlock_level(plant: dict) -> int:
    return TIERS[plant["tier"]]["unlock_level"]


def stage_at(planted_at: datetime, grow_seconds: int, now: datetime) -> tuple[int, datetime | None]:
    """The stage at `now`, and when the next one starts (None once it is ready)."""
    elapsed = (now - planted_at).total_seconds()
    stage = max(i for i, s in enumerate(STAGES) if elapsed >= grow_seconds * s["at"])
    if stage == READY_STAGE:
        return stage, None
    return stage, planted_at + timedelta(seconds=grow_seconds * STAGES[stage + 1]["at"])


def plant_view(plant: dict) -> dict:
    """What the app shows of a plant: its name, tier, growing time and rewards, always from here."""
    price = plant.get("seed_price")
    return {"plant_id": plant["id"], "item_id": plant["seed_item"], "name": plant["name"], "seed_name": plant["seed_name"],
            "description": plant["description"], "tier": plant["tier"], "tier_label": TIERS[plant["tier"]]["label"],
            "art": plant["art"], "grow_seconds": plant["grow_seconds"], "harvest_exp": plant["harvest_exp"],
            "harvest_coins": plant["harvest_coins"], "seed_price": price,
            "profit": None if price is None else plant["harvest_coins"] - price, "unlock_level": unlock_level(plant)}
