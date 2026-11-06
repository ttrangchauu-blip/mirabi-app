"""The garden's economy (data/garden_plants.json), checked on its numbers: profit = harvest coins - seed price, and
profit per hour, not the harvest alone. What it must hold:

- no seed is sold at a loss, and every number lies in its tier's range;
- the profit of one harvest grows strictly with the tier (each tier's worst beats the tier below's best);
- commons are never the best way to earn coins, whether one plays without a break or comes back every few hours;
- a short plant never pays like a long one.
"""
import copy

from app import garden_catalog as gc
from app import items_catalog as cat

NAMES = {
    "common": {"Cà rốt", "Cà chua", "Khoai tây", "Rau xà lách", "Hoa cúc", "Hoa hướng dương"},
    "uncommon": {"Dâu tây", "Bí ngô", "Hoa tulip", "Hoa oải hương", "Nho", "Việt quất"},
    "rare": {"Hoa anh đào", "Hoa hồng xanh", "Cây pha lê", "Hoa ánh trăng", "Cây táo vàng"},
    "epic": {"Cây ánh sao", "Hoa cầu vồng", "Cây băng tuyết", "Cây lửa", "Cây sương mù"},
    "legendary": {"Cây thần thoại", "Cây ngân hà", "Cây thời gian", "Cây ánh sáng", "Cây cổ thụ phép thuật"},
}
SOLD = gc.for_sale()


def profit(p):
    return p["harvest_coins"] - p["seed_price"]


def per_hour(p):
    return profit(p) / (p["grow_minutes"] / 60)


def per_day(p, gap_hours):
    """Coins a plot earns a day for someone who comes back every `gap_hours` (harvests and plants again each time)."""
    cycle = max(gap_hours, p["grow_minutes"] / 60)
    if p["grow_minutes"] / 60 > gap_hours:  # ready between two visits: picked at the next one
        cycle = gap_hours * -(-p["grow_minutes"] / 60 // gap_hours)
    return profit(p) * 24 / cycle


def test_the_catalog_is_valid_and_has_every_plant_asked_for():
    assert gc.validate(gc._DATA) == []
    for tier, names in NAMES.items():
        assert names <= {p["name"] for p in SOLD if p["tier"] == tier}, tier
    assert len({p["art"] for p in gc.PLANTS.values()}) == len(gc.PLANTS)  # no two plants share a picture
    for p in gc.PLANTS.values():
        assert cat.ITEMS[p["seed_item"]]["group"] == "seed" and cat.ITEMS[p["seed_item"]]["rarity"] == p["tier"]


def test_no_seed_is_sold_at_a_loss_and_the_profit_of_a_harvest_grows_with_the_tier():
    assert all(profit(p) > 0 for p in SOLD)
    by_tier = [[profit(p) for p in SOLD if p["tier"] == t] for t in gc.TIER_ORDER]
    for lower, higher in zip(by_tier, by_tier[1:]):
        assert min(higher) > max(lower)
    prices = [[p["seed_price"] for p in SOLD if p["tier"] == t] for t in gc.TIER_ORDER]
    for lower, higher in zip(prices, prices[1:]):
        assert min(higher) > max(lower)  # a rarer seed costs more


def test_commons_are_never_the_best_way_to_earn_coins():
    common = [p for p in SOLD if p["tier"] == "common"]
    others = [p for p in SOLD if p["tier"] != "common"]
    # Playing without a break: the best common earns less an hour than the best of other tiers.
    assert max(map(per_hour, common)) < max(map(per_hour, others))
    # Coming back now and then: commons are the worst tier at every rhythm.
    for gap in (0.25, 1, 2, 4, 8, 12, 24):
        best = max(SOLD, key=lambda p: per_day(p, gap))
        assert best["tier"] != "common", gap
        assert max(per_day(p, gap) for p in common) < min(max(per_day(p, gap) for p in SOLD if p["tier"] == t)
                                                          for t in gc.TIER_ORDER if t != "common"), gap


def test_a_short_plant_never_pays_like_a_long_one():
    # What a plot earns an hour stays small for every plant (at most 8 coins net), so a short one can't pay like a long one.
    assert max(per_hour(p) for p in SOLD) <= 8.0
    shortest = min(SOLD, key=lambda p: p["grow_minutes"])
    longest = max(SOLD, key=lambda p: p["grow_minutes"])
    assert profit(longest) > 20 * profit(shortest)


def test_the_validator_stops_a_broken_catalog():
    broken = copy.deepcopy(gc._DATA)
    broken["plants"][0]["seed_price"] = broken["plants"][0]["harvest_coins"]  # sold at no profit
    broken["plants"][1]["harvest_exp"] = 40  # outside its tier
    broken["stages"][-1]["at"] = 0.9
    problems = gc.validate(broken)
    assert len(problems) == 3 and any("less than its harvest" in x for x in problems)
