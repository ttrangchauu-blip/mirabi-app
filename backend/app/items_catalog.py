"""The catalog of things a pet brings back from its walks, and where it finds them.

Every item has a stable id (stored in inventories, placed rooms, garden plots and walk rewards: only ever add), a
group, a rarity, a description and where it is used. Decorations (`room` use) are drawn in the rooms by the room
artwork (mobile/assets/room/room-art.json, under `art`, usually the item's own id); their colour or pattern variants
come from there. Other items keep their variants here. The app draws every other item from mobile/src/itemArt.ts.

The ids of the walk finds that existed before this catalog (companion.PET_FINDS and the seedling, small pot and moon
lantern) are kept, so inventories from before still read. `drop: False` items are no longer found on walks.
"""
from __future__ import annotations

RARITIES = ("common", "rare", "special", "legendary")
RARITY_LABELS = {"common": "Thường", "rare": "Hiếm", "special": "Đặc biệt", "legendary": "Huyền thoại"}
# The main gift's rarity on every walk, in percent.
MAIN_ODDS = {"common": 65, "rare": 25, "special": 9, "legendary": 1}

# group id -> (label, inventory tab, where it is used)
GROUPS = {
    "seed": ("Hạt giống", "seed", "garden"),
    "plant": ("Cây trang trí", "decor", "room"),
    "study": ("Đồ học tập", "decor", "room"),
    "toy": ("Đồ chơi pet", "decor", "room"),
    "furniture": ("Nội thất nhỏ", "decor", "room"),
    "decor": ("Đồ trang trí", "decor", "room"),
    "fabric": ("Đồ vải", "decor", "room"),
    "material": ("Nguyên liệu", "material", "craft"),
    "element": ("Đồ nguyên tố", "decor", "room"),
    "keepsake": ("Kỷ vật", "keepsake", "album"),
}
TABS = [("all", "Tất cả"), ("decor", "Trang trí"), ("seed", "Hạt giống"), ("material", "Nguyên liệu"), ("keepsake", "Kỷ vật")]
USES = {"room": "Phòng", "garden": "Vườn nhà", "album": "Album kỷ niệm", "craft": "Chế tạo"}
# Where a decoration can be placed (both rooms take every mount).
ROOM_KINDS = ("personal", "focus")


def _i(item_id: str, group: str, name: str, rarity: str, description: str, **extra) -> tuple[str, dict]:
    return item_id, {"id": item_id, "group": group, "name": name, "rarity": rarity, "description": description, **extra}


ITEMS: dict[str, dict] = dict([
    # Hạt giống: planted in the garden (a plot each), they grow by themselves.
    _i("seed_daisy", "seed", "Hạt hoa cúc", "common", "Hạt nhỏ xíu, nở thành những bông cúc trắng nhụy vàng."),
    _i("seed_sunflower", "seed", "Hạt hướng dương", "common", "Hạt sọc đen trắng, lớn lên luôn hướng về phía mặt trời."),
    _i("seed_tulip", "seed", "Củ tulip", "rare", "Một củ tulip tròn, mùa xuân nở cánh hồng thắm."),
    _i("seed_lavender", "seed", "Hạt lavender", "rare", "Hạt oải hương thơm dịu, nở thành bụi hoa tím."),
    _i("seed_succulent", "seed", "Mầm sen đá", "common", "Một nhánh sen đá nhỏ, mập mạp và dễ chăm."),
    _i("seed_strawberry", "seed", "Hạt cây dâu", "special", "Hạt dâu tây quý, lớn lên cho những quả dâu đỏ mọng."),
    # Cây trang trí
    _i("cactus_mini", "plant", "Xương rồng mini", "common", "Chậu xương rồng bé tí, đứng vừa trên mặt bàn."),
    _i("heart_leaf_pot", "plant", "Cây lá tim", "rare", "Cây trầu bà lá hình trái tim, xanh mướt quanh năm."),
    _i("flower_pot_mini", "plant", "Chậu hoa nhỏ", "common", "Chậu đất nung nhỏ với vài bông hoa rực rỡ."),
    _i("bonsai", "plant", "Bonsai cổ thụ", "legendary", "Cây bonsai dáng cổ, được pet tìm thấy trên một mỏm đá xa."),
    # Đồ học tập
    _i("story_book", "study", "Cuốn sách", "common", "Một cuốn sách bìa cứng đầy những câu chuyện hay."),
    _i("pocket_notebook", "study", "Sổ tay", "common", "Sổ tay nhỏ để ghi lại ý tưởng mỗi ngày."),
    _i("pencil_case", "study", "Hộp bút", "common", "Hộp bút xinh xắn đựng đủ bút chì, thước và tẩy."),
    _i("desk_globe", "study", "Quả địa cầu", "special", "Quả địa cầu xoay được, nhắc bạn về những chuyến đi xa."),
    _i("note_board", "study", "Bảng ghi chú", "rare", "Bảng ghim giấy nhớ treo tường, cho kế hoạch học tập."),
    # Đồ chơi pet
    _i("bouncy_ball", "toy", "Bóng nảy", "common", "Quả bóng nảy tưng tưng, pet nào cũng mê."),
    _i("teddy_bear", "toy", "Gấu bông", "rare", "Chú gấu bông mềm mại để pet ôm khi ngủ."),
    _i("ring_toy", "toy", "Vòng đồ chơi", "common", "Chồng vòng nhiều màu để pet xếp chơi."),
    _i("paper_box", "toy", "Hộp giấy", "common", "Một chiếc hộp giấy, chỗ trốn yêu thích của pet."),
    _i("play_tunnel", "toy", "Đường hầm nhỏ", "rare", "Đường hầm vải để pet chui ra chui vào."),
    # Nội thất nhỏ
    _i("wicker_stool", "furniture", "Ghế đôn", "common", "Ghế đôn tròn đan mây, nhỏ gọn cho góc phòng."),
    _i("tea_table", "furniture", "Bàn trà", "rare", "Bàn trà thấp, vừa đặt một tách trà hay một chậu cây."),
    _i("mini_bookshelf", "furniture", "Kệ sách nhỏ", "rare", "Kệ sách hai tầng nhỏ xinh, đặt thêm đồ lên trên được."),
    _i("seat_cushion", "furniture", "Đệm ngồi", "common", "Đệm ngồi bệt êm ái cho những buổi học trên sàn."),
    _i("woven_basket", "furniture", "Giỏ đan", "common", "Giỏ đan tay đựng đồ lặt vặt gọn gàng."),
    # Đồ trang trí
    _i("framed_painting", "decor", "Bức tranh", "rare", "Bức tranh phong cảnh nhỏ trong khung gỗ."),
    _i("cuckoo_clock", "decor", "Đồng hồ", "common", "Chiếc đồng hồ treo tường tích tắc vui tai."),
    _i("bud_vase", "decor", "Bình hoa", "common", "Bình hoa nhỏ cắm một cành hoa tươi."),
    _i("wind_chime", "decor", "Chuông gió", "rare", "Chuông gió leng keng mỗi khi có làn gió nhẹ."),
    _i("mini_statue", "decor", "Tượng mini", "legendary", "Bức tượng pet tí hon bằng đá, hiếm có khó tìm."),
    _i("fairy_lights", "decor", "Dây đèn", "rare", "Dây đèn nhỏ lấp lánh cho buổi tối ấm áp."),
    # Đồ vải
    _i("knit_rug_round", "fabric", "Thảm tròn", "common", "Thảm len tròn dệt tay, mềm dưới chân."),
    _i("leaf_rug", "fabric", "Thảm hình lá", "rare", "Thảm xanh hình chiếc lá, mang cả khu rừng vào phòng."),
    _i("star_pillow", "fabric", "Gối ngôi sao", "common", "Chiếc gối hình ngôi sao để tựa lưng."),
    _i("small_blanket", "fabric", "Chăn nhỏ", "common", "Chăn nhỏ gấp gọn, ấm áp những ngày se lạnh."),
    _i("lace_curtain", "fabric", "Rèm cửa", "rare", "Rèm vải mỏng treo tường, đón ánh sáng dịu."),
    # Nguyên liệu: kept for crafting later.
    _i("wood", "material", "Gỗ", "common", "Những thanh gỗ nhỏ nhặt được trong rừng."),
    _i("stone", "material", "Đá", "common", "Vài viên đá chắc chắn, phẳng và mịn."),
    _i("thread", "material", "Sợi vải", "common", "Cuộn sợi vải nhiều màu."),
    _i("soil", "material", "Đất trồng", "common", "Một túi đất tơi xốp, thơm mùi cỏ."),
    _i("crystal", "material", "Mảnh pha lê", "special", "Mảnh pha lê xanh lấp lánh dưới ánh nắng."),
    # Đồ nguyên tố
    _i("wave_jar", "element", "Bình sóng nước", "special", "Chiếc bình nhỏ bên trong có những con sóng không bao giờ ngừng."),
    _i("thunder_lamp", "element", "Đèn sét", "special", "Đèn chứa một tia sét tí hon, sáng lên khi có pet hệ Điện."),
    _i("flame_lamp", "element", "Đèn lửa", "special", "Ngọn lửa ấm áp không bao giờ tắt, an toàn tuyệt đối."),
    _i("leaf_wreath", "element", "Vòng lá", "rare", "Vòng lá xanh tươi treo tường, mang hơi thở của hệ Cỏ."),
    _i("snow_globe", "element", "Cầu tuyết", "special", "Quả cầu tuyết lắc lên là tuyết bay lả tả."),
    _i("mist_jar", "element", "Lọ sương", "legendary", "Lọ sương huyền ảo, chỉ xuất hiện vào những buổi sáng hiếm hoi."),
    # Kỷ vật: memories of a walk, shown in the album.
    _i("shell", "keepsake", "Vỏ sò", "common", "Vỏ sò hồng nhặt được bên bờ biển."),
    _i("heart_pebble", "keepsake", "Sỏi hình tim", "common", "Viên sỏi nhẵn có hình trái tim, như một lời chào."),
    _i("pressed_leaf", "keepsake", "Lá ép", "common", "Chiếc lá được ép khô, giữ lại màu của mùa."),
    _i("message_bottle", "keepsake", "Chai thư", "rare", "Một chai thủy tinh có cuộn thư bên trong."),
    _i("place_badge", "keepsake", "Huy hiệu địa điểm", "special", "Huy hiệu ghi dấu nơi pet đã đặt chân đến.",
       variants=["flower_hills", "seaside", "pine_forest", "little_town", "snowy_peak"]),
    # Finds of the walks before this catalog: still owned and shown, no longer found.
    _i("clover", "keepsake", "Cỏ bốn lá", "rare", "Cỏ bốn lá mang lại may mắn.", drop=False),
    _i("flower", "keepsake", "Bông hoa dại", "common", "Bông hoa dại pet hái bên đường.", drop=False),
    _i("acorn", "keepsake", "Quả sồi nhỏ", "common", "Quả sồi nhỏ tròn xoe.", drop=False),
    _i("feather", "keepsake", "Lông vũ cầu vồng", "rare", "Chiếc lông vũ óng ánh bảy màu.", drop=False),
    _i("pebble", "keepsake", "Viên sỏi tròn", "common", "Viên sỏi tròn trơn láng.", drop=False),
    _i("star", "keepsake", "Mảnh sao băng", "special", "Mảnh sao băng rơi xuống trong đêm.", drop=False),
    _i("seedling", "seed", "Mầm cây", "common", "Một mầm cây nhỏ đang chờ được trồng.", drop=False),
    _i("small_pot", "plant", "Chậu cây nhỏ", "rare", "Chậu cây nhỏ có mầm xanh.", drop=False),
    _i("moon_lantern", "decor", "Đèn lồng trăng", "special", "Kệ treo đèn lồng hình trăng.", art="lantern_shelf", drop=False),
])
for _item in ITEMS.values():
    _item.setdefault("drop", True)
    _item.setdefault("variants", None)  # None: the room artwork's variants (decorations) or just "default"
    if GROUPS[_item["group"]][2] == "room":
        _item.setdefault("art", _item["id"])
    else:
        _item.setdefault("art", None)
# The room artwork id -> its catalog item, for decorations placed in a room.
BY_ART = {item["art"]: item_id for item_id, item in ITEMS.items() if item["art"]}

# Where a walk goes, and what can be found there: the groups of its main gift, and its bonus (1 to 3 seeds or
# materials). Every rarity has at least one item in every place (tests check it).
LOCATIONS: dict[str, dict] = {
    "flower_hills": {"name": "Đồi hoa", "groups": ["seed", "plant", "fabric", "element", "keepsake", "material"],
                     "bonus": ["seed_daisy", "seed_sunflower", "seed_tulip", "seed_lavender", "soil"]},
    "seaside": {"name": "Bờ biển", "groups": ["keepsake", "toy", "decor", "element", "material"],
                "bonus": ["stone", "crystal", "thread", "seed_succulent"]},
    "pine_forest": {"name": "Rừng thông", "groups": ["material", "plant", "furniture", "seed", "element", "keepsake"],
                    "bonus": ["wood", "soil", "seed_strawberry", "seed_lavender"]},
    "little_town": {"name": "Thị trấn nhỏ", "groups": ["study", "furniture", "decor", "fabric", "toy"],
                    "bonus": ["thread", "wood", "seed_sunflower", "seed_tulip"]},
    "snowy_peak": {"name": "Núi tuyết", "groups": ["element", "material", "keepsake", "decor", "study"],
                   "bonus": ["stone", "crystal", "wood", "seed_succulent"]},
}
BONUS_CHANCE = 0.5
BONUS_QUANTITY = (1, 3)


def pool(location: str, rarity: str) -> list[str]:
    """The items the main gift of a walk to `location` can be, at `rarity`."""
    groups = LOCATIONS[location]["groups"]
    return [item_id for item_id, item in ITEMS.items() if item["drop"] and item["group"] in groups and item["rarity"] == rarity]


def tab_of(item_id: str) -> str:
    return GROUPS[ITEMS[item_id]["group"]][1]


def use_of(item_id: str) -> str:
    return GROUPS[ITEMS[item_id]["group"]][2]
