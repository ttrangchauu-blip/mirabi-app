"""What each gameplay is, and which gameplay a lesson's learning activity calls for.

`GAMEPLAYS` is the game definition table: for every gameplay, what the learner does (`interaction`), its `family` (two
gameplays of one family play the same way, whatever their names), the grades it suits, the visual world it is drawn
in and whether it is built (`ready`) or still to build (`planned`). The game a lesson publishes (lesson_catalog.GAMES)
is one of the ready ones; the planned ones are named so a lesson can say what it is waiting for.

`ACTIVITIES` maps a learning activity (the kind of knowledge a lesson teaches: a chronology, a grammar structure, an
electric circuit…) to the gameplays that serve it: `best` are made for it, `fits` can carry it honestly (an ordering
game for a process), anything else is the wrong kind of game for it. A lesson declares its activity (`"activity"` in
its JSON); without one it is inferred from its subject, title, chapter and objectives, and marked as inferred. The
game is never chosen from the subject alone. Rules: docs/GAME_AUDIT.md.
"""
from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------------------------------------------------------
# Game definitions
# ---------------------------------------------------------------------------------------------------------------

READY, PLANNED = "ready", "planned"


def _g(name: str, family: str, interaction: str, grades: tuple[int, int] = (1, 12), status: str = READY, world: str | None = None,
       kind: str | None = None, engine: int = 1) -> dict:
    return {"name": name, "family": family, "interaction": interaction, "grades": grades, "status": status, "world": world,
            "kind": kind, "engine_version": engine}


GAMEPLAYS: dict[str, dict] = {
    # Built: the lesson catalog's games (lesson_catalog.GAMES).
    "defense": _g("Math Battle – Bảo vệ căn cứ", "arena_typing", "Giải phép tính trên bàn phím số để pet tấn công quái vật", (1, 12),
                  world="kingdom", kind="math_input"),
    "math_bridge": _g("Xây cầu toán học", "bridge_number", "Điền số còn thiếu / dấu so sánh, mỗi câu đúng lát một nhịp cầu", (1, 12),
                      kind="missing_number"),
    "meteor": _g("Bắn thiên thạch (Việt → Anh)", "falling_typing", "Gõ từ tiếng Anh cho nghĩa trên thiên thạch đang rơi", (1, 12),
                 world="space", kind="vocab_typing"),
    "word_shooter": _g("Bắn từ tiếng Anh (Anh → Việt)", "falling_typing", "Gõ nghĩa tiếng Việt của từ đang rơi", (1, 12),
                       world="space", kind="word_spelling"),
    "word_builder": _g("Ghép chữ", "tile_word", "Kéo chữ/tiếng vào ổ khoá để mở cổng rừng", (1, 2), world="forest", kind="word_build"),
    "spelling_detective": _g("Thám tử chính tả", "find_fix", "Chạm tiếng viết sai rồi chọn cách viết đúng", (2, 9), kind="spell_fix"),
    "sorting": _g("Phân loại cùng pet", "sort_groups", "Kéo từng thẻ vào nhóm của nó", (1, 12), kind="sort_card"),
    "code_path": _g("Lập trình đường đi – Robot Adventure", "program_blocks", "Xếp khối lệnh, chạy robot qua bản đồ", (3, 12),
                    kind="code_path"),
    "order": _g("Sắp xếp thứ tự", "sequence_cards", "Chạm thẻ theo đúng thứ tự (quy trình, vòng đời, diễn biến)", (1, 12),
                kind="order_steps"),
    "match": _g("Ghép cặp", "pair_cards", "Ghép thẻ trái với thẻ phải", (1, 12), kind="match_pairs"),
    "choice": _g("Chọn đáp án có giải thích", "choice", "Chọn một lựa chọn, mỗi lựa chọn tự giải thích", (1, 12), kind="choice_explain"),
    "lab": _g("Magic Lab – Phòng thí nghiệm", "lab_assemble", "Lắp dụng cụ vào thiết bị rồi chạy thí nghiệm mô phỏng", (3, 9),
              world="lab", kind="lab_experiment"),
    "timeline": _g("Hành trình dòng thời gian", "timeline_place", "Đặt sự kiện lên đúng mốc của dòng thời gian", (4, 12),
                   world="time", kind="timeline_place"),
    "sentence": _g("Xây câu", "sentence_line", "Kéo thẻ từ lên dòng câu, bỏ thẻ thừa", (3, 12), kind="sentence_build"),
    "geometry": _g("Xưởng hình học", "geometry_build", "Xoay cạnh góc trên thước đo góc, kéo góc hình chữ nhật trên lưới", (3, 9),
                   kind="geometry_build"),
    "balance": _g("Cân bằng phương trình", "equation_balance", "Đặt hệ số, đếm nguyên tử hai vế cho cân", (8, 12),
                  kind="equation_balance"),
    "number_line": _g("Cầu trục số", "number_line", "Kéo số, phân số, số thập phân, số làm tròn vào đúng vạch trên trục số", (1, 9),
                      kind="number_line_place"),
    "step_solver": _g("Giải toán từng bước", "step_solve", "Ghép phép tính cho từng bước từ các số của đề; bước đúng mới mở bước sau",
                      (1, 12), kind="step_solve"),
    "story_detective": _g("Thám tử đọc hiểu", "evidence_pick", "Chạm câu làm bằng chứng trong bài đọc, rồi mới trả lời", (1, 12),
                          kind="story_evidence"),
    "sentence_xray": _g("Soi câu", "tag_parts", "Tô màu từng từ theo vai trò (sự vật, hoạt động, đặc điểm; Ai – làm gì; so sánh)",
                        (2, 12), kind="sentence_paint"),
    # Planned: named by the lessons that wait for them (docs/GAME_AUDIT.md), never shown in the app.
    "graph_explorer": _g("Graph Explorer – Khám phá đồ thị", "graph_drag", "Kéo điểm trên hệ toạ độ, chỉnh đồ thị", (7, 12), PLANNED),
    "shape_builder": _g("Geometry Builder – Dựng hình", "geometry_points", "Kéo đỉnh, cạnh để dựng hình; đo cạnh, góc, diện tích", (1, 12), PLANNED),
    "data_detective": _g("Data Detective – Thám tử dữ liệu", "data_table", "Đọc, lọc, sắp xếp bảng/biểu đồ để trả lời", (3, 12), PLANNED),
    "grammar_repair": _g("Grammar Repair – Sửa câu", "find_fix", "Chạm chỗ sai trong câu, thay bằng cấu trúc đúng", (3, 12), PLANNED),
    "listening": _g("Listening Adventure", "listen_pick", "Nghe đoạn ghi âm, chọn/sắp xếp thông tin", (3, 12), PLANNED),
    "conversation": _g("Conversation Quest", "dialogue", "Chọn câu đáp lời nhân vật theo tình huống", (3, 12), PLANNED),
    "poetry_explorer": _g("Poetry Explorer", "text_annotate", "Chạm dòng thơ, gắn biện pháp tu từ, hình ảnh, nhịp", (4, 12), PLANNED),
    "writing_workshop": _g("Writing Workshop", "outline_build", "Sắp ý thành dàn ý, hoàn thiện đoạn văn theo tiêu chí", (3, 12), PLANNED),
    "history_detective": _g("History Detective", "evidence_pick", "Đối chiếu tư liệu, hiện vật để trả lời bằng chứng cứ", (4, 12), PLANNED),
    "map_explorer": _g("World Explorer – Bản đồ", "map_tap", "Chạm đúng vùng, địa danh, tuyến đường trên bản đồ", (4, 12), PLANNED),
    "climate_sim": _g("Climate Simulator", "sim_sliders", "Chỉnh yếu tố khí hậu, quan sát tác động", (6, 12), PLANNED),
    "terrain_builder": _g("Terrain Builder", "terrain_build", "Dựng núi, đồng bằng, cao nguyên, thung lũng", (4, 9), PLANNED),
    "force_sim": _g("Force Simulator", "sim_vectors", "Chỉnh hướng, độ lớn của lực, quan sát chuyển động", (6, 12), PLANNED),
    "motion_challenge": _g("Motion Challenge", "sim_sliders", "Chỉnh vận tốc, thời gian để vật tới đích; xem đồ thị", (5, 12), PLANNED),
    "light_lab": _g("Light Lab", "sim_rays", "Xoay gương, thấu kính, quan sát tia sáng", (6, 12), PLANNED),
    "molecule_builder": _g("Molecule Builder", "atom_link", "Nối nguyên tử thành phân tử", (7, 12), PLANNED),
    "element_explorer": _g("Element Explorer", "table_explore", "Khám phá bảng tuần hoàn theo nhiệm vụ", (7, 12), PLANNED),
    "chem_lab": _g("Magic Lab – Hoá học", "lab_mix", "Chọn hoá chất mô phỏng, quan sát hiện tượng, giải thích", (8, 12), PLANNED),
    "cell_builder": _g("Cell Builder", "place_parts", "Kéo bào quan vào đúng vị trí trong tế bào", (6, 12), PLANNED),
    "body_explorer": _g("Body Explorer", "map_tap", "Chạm cơ quan trên mô hình cơ thể", (2, 12), PLANNED),
    "ecosystem_builder": _g("Ecosystem Builder", "web_link", "Nối sinh vật thành chuỗi, lưới thức ăn", (3, 12), PLANNED),
    "code_lab": _g("Coding Puzzle – Điều kiện, biến, đọc mã", "program_blocks", "Xếp khối có điều kiện, biến; chạy và sửa mã", (6, 12), PLANNED),
    "computer_builder": _g("Computer Builder", "place_parts", "Lắp bộ phận vào máy tính", (3, 9), PLANNED),
    "rhythm_tap": _g("Rhythm & Pitch", "tap_rhythm", "Gõ theo tiết tấu, nhận biết cao độ, nhạc cụ", (1, 9), PLANNED),
    "color_studio": _g("Color Studio", "canvas_compose", "Phối màu, sắp bố cục", (1, 9), PLANNED),
    "expression_lab": _g("Xưởng biến đổi biểu thức", "expression_rewrite",
                         "Kéo thẻ quy tắc (hằng đẳng thức, nhân tử, lũy thừa, căn, đạo hàm) để biến đổi biểu thức từng dòng", (6, 12), PLANNED),
    "venn_lab": _g("Sơ đồ Ven – Mệnh đề", "venn_place", "Kéo phần tử vào vùng của sơ đồ Ven; lật giá trị đúng/sai của mệnh đề", (6, 12), PLANNED),
    "number_sieve": _g("Sàng số", "grid_mark", "Đánh dấu bội, ước, số chia hết trên bảng số; tìm ƯC, BC chung", (4, 9), PLANNED),
}

FAMILIES: dict[str, list[str]] = {}
for _code, _gp in GAMEPLAYS.items():
    FAMILIES.setdefault(_gp["family"], []).append(_code)


def ready(code: str) -> bool:
    return GAMEPLAYS.get(code, {}).get("status") == READY


# ---------------------------------------------------------------------------------------------------------------
# Learning activities
# ---------------------------------------------------------------------------------------------------------------

def _a(label: str, best: tuple[str, ...], fits: tuple[str, ...] = ()) -> dict:
    return {"label": label, "best": best, "fits": fits}


ACTIVITIES: dict[str, dict] = {
    "vocabulary": _a("Từ vựng tiếng Anh", ("word_shooter", "meteor"), ("match",)),
    "grammar": _a("Cấu trúc câu, ngữ pháp", ("sentence", "grammar_repair"), ("sentence_xray", "choice")),
    "communication": _a("Hội thoại, giao tiếp", ("conversation", "listening"), ("match", "choice", "order")),
    "reading": _a("Đọc hiểu văn bản", ("story_detective",), ("choice",)),
    "arithmetic": _a("Tính toán, số học", ("defense", "math_bridge"), ("order", "match", "choice")),
    "numbers": _a("Số, so sánh, cấu tạo số", ("number_line",), ("math_bridge", "order", "match", "choice")),
    "word_problem": _a("Giải bài toán có lời văn", ("step_solver",), ("choice", "order", "match")),
    "geometry": _a("Góc, chu vi, diện tích hình chữ nhật", ("geometry",), ("choice", "match", "sorting")),
    "shapes": _a("Hình phẳng, hình khối, hệ thức trong hình", ("shape_builder",), ("geometry", "choice", "match", "sorting")),
    "measurement": _a("Đại lượng và đo lường", ("data_detective",), ("match", "order", "choice")),
    "algebra": _a("Biểu thức, phương trình, giải toán", ("step_solver",), ("choice", "match", "order")),
    "functions": _a("Hàm số, đồ thị, toạ độ", ("graph_explorer",), ("choice", "match")),
    "data": _a("Thống kê, xác suất, dữ liệu", ("data_detective",), ("choice", "sorting", "match")),
    "chronology": _a("Sự kiện theo thời gian", ("timeline",), ("order", "match")),
    "event_sequence": _a("Diễn biến một sự kiện", ("order",), ("timeline",)),
    "history_sources": _a("Tư liệu, thành tựu, nhân vật lịch sử", ("history_detective",), ("choice", "match", "sorting")),
    "map": _a("Vị trí, bản đồ, lãnh thổ, địa hình", ("map_explorer", "terrain_builder"), ("sorting", "match", "choice")),
    "climate": _a("Khí hậu, thời tiết", ("climate_sim",), ("sorting", "match", "choice")),
    "human_geography": _a("Dân cư, kinh tế, vùng", ("data_detective",), ("choice", "match", "sorting")),
    "electricity": _a("Điện, mạch điện", ("lab",), ("choice", "order", "match", "sorting")),
    "optics": _a("Ánh sáng", ("lab", "light_lab"), ("choice", "sorting")),
    "forces_motion": _a("Lực, chuyển động, dao động", ("force_sim", "motion_challenge"), ("choice", "match", "order", "sorting")),
    "matter": _a("Chất và sự biến đổi của chất", ("lab",), ("sorting", "choice", "match", "order")),
    "magnetism": _a("Nam châm, từ trường", ("lab",), ("choice", "sorting")),
    "equations": _a("Phương trình hoá học", ("balance",), ("choice",)),
    "atoms": _a("Nguyên tử, phân tử, bảng tuần hoàn", ("molecule_builder", "element_explorer"), ("match", "sorting", "choice")),
    "chemistry": _a("Phản ứng, tính chất hoá học", ("chem_lab",), ("choice", "sorting", "order", "match")),
    "cell": _a("Tế bào", ("cell_builder",), ("sorting", "match", "choice", "order")),
    "body": _a("Cơ thể người, sức khoẻ", ("body_explorer",), ("match", "sorting", "order", "choice")),
    "life_cycle": _a("Vòng đời, sinh trưởng, quá trình sống", ("order",), ("lab", "match", "choice")),
    "ecosystem": _a("Sinh vật và môi trường", ("ecosystem_builder",), ("sorting", "match", "choice", "order")),
    "classification": _a("Phân loại", ("sorting",), ("match", "choice")),
    "programming": _a("Thuật toán: tuần tự, lặp", ("code_path",), ("order", "choice")),
    "coding": _a("Ngôn ngữ lập trình, điều kiện, biến", ("code_lab",), ("code_path", "choice", "order", "match")),
    "computer": _a("Máy tính, thiết bị, mạng", ("computer_builder",), ("sorting", "match", "choice", "order")),
    "information": _a("Thông tin, dữ liệu, ứng dụng", ("data_detective",), ("choice", "sorting", "match", "order")),
    "situation": _a("Tình huống, lựa chọn và hệ quả", ("choice", "sorting"), ("order", "match")),
    "spelling": _a("Chính tả", ("spelling_detective",), ("choice",)),
    "word_building": _a("Ghép chữ, ghép vần", ("word_builder",), ("match",)),
    "vietnamese_language": _a("Từ và câu tiếng Việt", ("sentence_xray", "grammar_repair"), ("match", "choice", "sorting", "order")),
    "literature": _a("Đọc hiểu truyện, thơ, văn bản", ("story_detective", "poetry_explorer"), ("choice", "order", "match")),
    "writing": _a("Viết, nói và nghe", ("writing_workshop",), ("order", "choice")),
    "music": _a("Âm nhạc: tiết tấu, cao độ, nhạc cụ", ("rhythm_tap",), ("match", "sorting", "order", "choice")),
    "art": _a("Mĩ thuật: màu, bố cục, tạo hình", ("color_studio",), ("sorting", "match", "order", "choice")),
    "movement": _a("Kĩ thuật vận động", ("order",), ("choice", "sorting", "match")),
    "process": _a("Quy trình, thiết kế, lắp ráp", ("order",), ("sorting", "match", "choice")),
    "symbolic": _a("Biến đổi biểu thức: lũy thừa, căn, đa thức, lôgarit, đạo hàm, tích phân", ("expression_lab",), ("match", "choice")),
    "logic_sets": _a("Mệnh đề, tập hợp", ("venn_lab",), ("sorting", "choice", "match")),
    "divisibility": _a("Chia hết, ước và bội", ("number_sieve",), ("sorting", "choice", "match")),
    "figurative": _a("Biện pháp tu từ theo hiệu quả diễn đạt", ("poetry_explorer",), ("choice", "match")),
    "concepts": _a("Khái niệm (chưa xác định dạng hoạt động)", (), ("choice", "match", "sorting", "order")),
}


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower()).replace("đ", "d")
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


# Per subject: (activity, keywords) tried in order on the lesson's title, chapter and objectives (accents folded, so
# "chu vi" matches "Chu vi"). The first match wins; a subject's catch-all comes last.
_RULES: dict[str, list[tuple[str, str]]] = {
    "math": [
        ("measurement", r"don vi|do dai|khoi luong|dung tich|ngay|tuan|gio|yen|ta tan|xang-ti-met|lit"),
        ("geometry", r"\bgoc\b|chu vi|dien tich hinh chu nhat|dien tich hinh vuong|^dien tich"),
        ("shapes", r"hinh|the tich|tam giac|tu giac|duong tron|pythagore|song song|vuong goc|vecto|khoi|luong giac"),
        ("functions", r"ham so|do thi|toa do|mat phang toa do"),
        ("word_problem", r"bai toan|tinh huong|tong va hieu|tong hieu|ti so|tong \(hieu\)|chuyen dong"),
        ("data", r"thong ke|bieu do|kha nang|xac suat|bang so lieu|nhieu it|trung binh cong"),
        ("algebra", r"tinh chat|phuong trinh|he phuong trinh|da thuc|hang dang thuc|nhan tu|bat phuong|bieu thuc|can|luy thua|logarit|dao ham|"
                    r"nguyen ham|tich phan|cap so|menh de|tap hop|hoan vi|to hop|vi-et|vi et|cuc tri|don dieu|gtln|ti le|"
                    r"tim thanh phan|giai"),
        ("numbers", r"so sanh|thu tu|chuc|tram|hang|lop|la ma|lam tron|phan so|so thap phan|stp|so nguyen|chia het|ucln|bcnn|phan tram|"
                    r"doc viet|rut gon|so tu nhien|gia tri"),
        ("arithmetic", r"cong|tru|nhan|chia|bang|phep tinh|tinh nham|tinh"),
    ],
    "english": [
        ("vocabulary", r"tu vung|vocabulary"),
        ("reading", r"doc|reading"),
        ("communication", r"hoi\W+dap|hoi thoai|giao tiep|phong van|loi khuyen|nghe|noi|hoi nghe"),
        ("grammar", r"ngu phap|cau|thi |hien tai|qua khu|bi dong|menh de|tuong thuat|so sanh|dieu kien|there is|to be|dong tu|"
                    r"cum dong tu|gio va ngay"),
    ],
    "history": [
        ("history_sources", r"su lieu|tu lieu|van minh|thanh tuu|di san|nhan vat|van mieu|den hung|lien hop quoc|cai cach|"
                            r"phat kien|tu san|doi moi"),
        ("chronology", r"dong thoi gian|thoi gian|trieu dai|khang chien|khoi nghia|phong trao|chang duong|moc|dung nuoc|giu nuoc|"
                       r"bac thuoc|tay son|thang long|cach mang|duong cuu nuoc|dai viet|lich su"),
    ],
    "geography": [
        ("climate", r"khi hau|khi ap|gio|thoi tiet|mua|nhiet do"),
        ("human_geography", r"dan so|dan cu|dan toc|kinh te|do thi|toan cau hoa|the manh|vung kinh te|nong nghiep|cong nghiep|dich vu"),
        ("map", r"ban do|vi tri|lanh tho|chau|dai duong|dia hinh|song|nui|mien|tu nhien|noi luc|ngoai luc|trai dat|toa do"),
    ],
    "science": [
        ("classification", r"dan nhiet|cach nhiet|phan loai"),
        ("forces_motion", r"sóng|âm thanh|độ to|độ cao của âm|nguồn âm"),
        ("electricity", r"mach dien|dong dien|dien tro|ohm|dan dien|cach dien|nhiem dien|hieu dien the|nang luong dien|doan mach"),
        ("optics", r"anh sang|bong|guong|tia sang|khuc xa|phan xa|thau kinh"),
        ("magnetism", r"nam cham|tu truong|tu tinh|cam ung dien tu"),
        ("equations", r"phuong trinh hoa hoc|can bang phuong trinh"),
        ("atoms", r"nguyen tu|phan tu|nguyen to|bang tuan hoan|lien ket hoa hoc|hoa tri|cong thuc hoa hoc|don chat|hop chat"),
        ("matter", r"chuyen the|the ran|the long|the khi|nong chay|bay hoi|dong dac|tinh chat cua chat|hon hop|dung dich|nuoc|"
                   r"khong khi|bien doi vat li"),
        ("chemistry", r"phan ung|axit|bazo|muoi|oxit|kim loai|toc do phan ung|mol|bao toan khoi luong"),
        ("forces_motion", r"\bluc\b|chuyen dong|toc do|van toc|ap suat|don bay|momen|dao dong|trong luc|khoi luong rieng"),
        ("cell", r"te bao|bao quan|\bmo\b|co the don bao|da bao"),
        ("body", r"dinh duong|tieu hoa|tuan hoan o nguoi|giac quan"),
        ("life_cycle", r"vong doi|sinh san|sinh truong|phat trien|nay mam|cay con|\bhat\b|quang hop|ho hap"),
        ("ecosystem", r"sinh thai|chuoi thuc an|luoi thuc an|moi truong|quan the|quan xa|he sinh thai|da dang sinh hoc"),
        ("body", r"co the|co quan|tieu hoa|tuan hoan|ho hap|than kinh|giac quan|suc khoe|dinh duong|benh|an toan thuc pham"),
        ("classification", r"phan loai|dong vat|thuc vat|nam|vi khuan|sinh vat"),
    ],
    "physics": [
        ("electricity", r"dien|ohm|mach"),
        ("optics", r"anh sang|quang"),
        ("forces_motion", r"luc|newton|chuyen dong|dao dong|song|bien doi deu|dong luc|nang luong|cong suat|momen"),
        ("matter", r"nhiet|khi ly tuong|phong xa|hat nhan|vat ly nhiet"),
    ],
    "chemistry": [
        ("equations", r"phuong trinh|can bang phuong trinh"),
        ("atoms", r"nguyen tu|nguyen to|dong vi|bang tuan hoan|xu huong|lien ket|cau hinh"),
        ("chemistry", r"."),
    ],
    "biology": [
        ("cell", r"te bao|nhan so|nhan thuc|mang|bao quan"),
        ("life_cycle", r"chu ki|phan bao|nguyen phan|giam phan|phien ma|dich ma|quang hop|ho hap|tuan hoan|sinh truong|sinh san|"
                       r"trao doi chat|chuyen hoa"),
        ("ecosystem", r"sinh thai|quan the|quan xa|moi truong|nhan to"),
        ("classification", r"."),
    ],
    "informatics": [
        ("coding", r"python|cau lenh|bien|tim loi|re nhanh|sql|danh sach|ham|chuong trinh con"),
        ("programming", r"lap trinh|thuat toan|vong lap|cau truc lap|tuan tu|cac buoc|giai quyet van de|scratch"),
        ("computer", r"may tinh|phan cung|thiet bi|mang|internet|he dieu hanh|phan mem"),
        ("situation", r"an toan|ung xu|dao duc|ban quyen|tren mang"),
        ("information", r"."),
    ],
    "vietnamese": [  # accented: "vần" and "văn" are different words here
        ("spelling", r"chính tả|phân biệt [^ ]{1,6}/|dấu hỏi"),
        ("word_building", r"tiếng có vần|học vần|ghép chữ|ghép tiếng|chữ cái|âm đầu"),
        ("writing", r"\bviết|nói và nghe|thuyết trình|kể chuyện|dàn ý"),
        ("literature", r"đọc|truyện|\bthơ|văn bản|\bkí\b|kịch|nghị luận|tác phẩm"),
        ("vietnamese_language", r"."),
    ],
    "civics": [("situation", r".")],
    "experience": [("situation", r".")],
    "defense": [("situation", r".")],
    "music": [("music", r".")],
    "fine_arts": [("art", r".")],
    "pe": [("situation", r"an toan|so cuu|chan thuong|duoi nuoc|nen va khong nen|tinh than|dinh duong|ve sinh"),
           ("movement", r"ki thuat|dong tac|chay|nhay|bat|nem|bai the duc|tu the|di deu|doi hinh"),
           ("concepts", r".")],
    "technology": [("situation", r"an toan"),
                   ("process", r"quy trinh|cac buoc|lap rap|lap dat|che bien|thiet ke|ve ki thuat|trong|cham soc|gia cong|lap mach"),
                   ("classification", r"nhom|loai|phan loai"),
                   ("concepts", r".")],
}
_RULES["history_geography"] = _RULES["history"] + _RULES["geography"]
_GEO_ACTIVITIES = {"map", "climate", "human_geography"}
_RULES["info_tech"] = _RULES["informatics"][:4] + _RULES["technology"]
# A pattern written with accents is matched on the text as written (lower case), the others with the accents folded.
_COMPILED = {s: [(a, re.compile(k), not k.isascii()) for a, k in rules] for s, rules in _RULES.items()}
CATCH_ALL = "."

# Lịch sử và Địa lí: a chapter titled "Địa lí: …" is geography whatever its lessons say.
_GEO_CHAPTER = re.compile(r"^dia li")


def activity_of(entry: dict) -> tuple[str, bool]:
    """(activity, declared): the lesson's own `activity`, else the first rule of its subject that matches."""
    lesson = entry["lesson"]
    if lesson.get("activity"):
        return lesson["activity"], True
    games = {g["game"] for g in lesson.get("games", [])}
    if games & {"meteor", "word_shooter"}:
        return "vocabulary", False
    if entry["subject"] == "math" and games & {"defense", "math_bridge"} and not games - {"defense", "math_bridge"}:
        return "arithmetic", False
    subject = entry["subject"]
    raw = [lesson.get("title", "").lower(), entry["chapter"].get("title", "").lower(),
           " ".join(lesson.get("objectives", []) + [lesson.get("description", "")]).lower()]
    folded = [_fold(t) for t in raw]
    rules = _COMPILED.get(subject, [])
    if subject == "history_geography":
        geo = bool(_GEO_CHAPTER.match(folded[1]))
        rules = [r for r in rules if (r[0] in _GEO_ACTIVITIES) == geo]
    specific = [r for r in rules if r[1].pattern != CATCH_ALL]
    for n in (1, 2, 3):  # the title decides first, then with the chapter, then with the objectives
        for activity, pattern, accented in specific:
            if pattern.search(" ".join((raw if accented else folded)[:n])):
                return activity, False
    fallback = next((a for a, p, _ in rules if p.pattern == CATCH_ALL), "concepts")
    return fallback, False


def fit(activity: str, game: str) -> str:
    """How a gameplay serves an activity: best, fits, or wrong."""
    spec = ACTIVITIES.get(activity, ACTIVITIES["concepts"])
    if game in spec["best"]:
        return "best"
    if game in spec["fits"]:
        return "fits"
    return "wrong"


def recommend(activity: str, grade: int) -> list[dict]:
    """The gameplays made for an activity, ready ones first, each with whether it suits the grade."""
    spec = ACTIVITIES.get(activity, ACTIVITIES["concepts"])
    out = []
    for code in spec["best"]:
        gp = GAMEPLAYS[code]
        out.append({"game": code, "name": gp["name"], "status": gp["status"], "grade_ok": gp["grades"][0] <= grade <= gp["grades"][1]})
    return sorted(out, key=lambda g: (g["status"] != READY, not g["grade_ok"]))


def definitions() -> list[dict]:
    """The game definition table (GET /api/learning/gameplays)."""
    return [{"code": code, "name": gp["name"], "family": gp["family"], "interaction": gp["interaction"], "grades": list(gp["grades"]),
             "status": gp["status"], "world": gp["world"], "turn_kind": gp["kind"], "engine_version": gp["engine_version"],
             "serves": [a for a, spec in ACTIVITIES.items() if code in spec["best"]]} for code, gp in GAMEPLAYS.items()]
