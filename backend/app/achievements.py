"""Thành tựu: badges that record what the user really did in Mirabi.

Nothing here keeps a count of its own. Every achievement reads one metric from the records the features already write
and verify, so
- an event never counts twice: the record it is read from is unique already (one completion per task occurrence, one
  settlement per walk, one harvest per planting, one result per learning stage...);
- the app can't move progress: no endpoint takes a number from it, and only results the backend confirmed are read
  (a stage it completed, a focus session it timed, a walk it settled), never a screen being opened;
- history counts: an account's first check finds what it did before achievements existed (`backfilled`).
What is stored is the tiers reached (achievement_unlocks: one row per user, achievement and tier, never removed) and
whether their coins were taken. A tier stays reached even if its count later goes down (a task removed, a friend lost).

A check (`evaluate`) measures every metric and writes the tiers newly reached. It runs when the screen opens and on the
app's regular poll (`/unseen`), at most once every CHECK_SECONDS for the poll, so nothing has to be wired into the
features themselves and a result recorded while the app was closed is found on the next check.

Rewards: coins (xu) through wallet.earn, once per tier and only when the user takes them ("Nhận thưởng"): the tier's
claim is a conditional update and the coin event's key `achievement:<id>:<tier>` is unique, so taps, retries and
devices never pay twice. Achievements of what users declare themselves (money entries, moods, journal, career skills)
give the badge only. No EXP: the pet's EXP, its levels and the daily caps are left exactly as they are.

Cuộc sống achievements exist only for accounts that may use Mirabi Life (life_access.py); nobody else sees them.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import distinct, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import days, friends, garden_catalog, lesson_api, lesson_catalog as lc, wallet
from .config import settings
from .db import get_db
from .errors import APIError
from .finance import goal_balance
from .life_access import life_eligible
from .models import (Activity, AchievementCheck, AchievementUnlock, FinanceGoal, FinanceTransaction, FriendPetExpGrant,
                     GardenCare, GardenHarvest, InventoryEvent, JournalEntry, LearningSession, LearningSessionItem,
                     LearningSubject, MoodEntry, PetEvolution, PetWalk, StudyRoomParticipant, StudyRoomSession,
                     StudySession, TeamQuest, TeamQuestMember, User, UserCareerAchievement, UserTask,
                     UserTaskCompletion, WalkReward, as_utc, utcnow)
from .progression import lock_user
from .security import current_user

router = APIRouter(prefix="/api/achievements", tags=["achievements"])

# The app's poll checks at most this often; opening the screen always checks.
CHECK_SECONDS = 20
# Task completions counted per day: a day of real work counts in full, creating and ticking tasks in a loop does not.
DAILY_TASKS_COUNTED = 10

TIER_NAMES = {1: "Đồng", 2: "Bạc", 3: "Vàng", 4: "Kim cương", 5: "Huyền thoại"}
TIER_KEYS = {1: "bronze", 2: "silver", 3: "gold", 4: "diamond", 5: "legendary"}
TIER_COINS = {1: 10, 2: 20, 3: 40, 4: 80, 5: 150}
# A one-time milestone (the first pet hatched...): shown as gold, one reward.
MILESTONE_RANK, MILESTONE_COINS, MILESTONE_NAME = 3, 20, "Cột mốc"

GROUPS = [
    {"id": "learning", "name": "Học tập", "icon": "school"},
    {"id": "games", "name": "Trò chơi học tập", "icon": "game-controller"},
    {"id": "pet", "name": "Pet", "icon": "paw"},
    {"id": "tasks", "name": "Nhiệm vụ", "icon": "checkmark-done"},
    {"id": "focus", "name": "Tập trung", "icon": "timer"},
    {"id": "garden", "name": "Vườn nhà", "icon": "leaf"},
    {"id": "friends", "name": "Bạn bè và học nhóm", "icon": "people"},
    {"id": "life", "name": "Cuộc sống", "icon": "heart"},
]


def _a(id: str, group: str, icon: str, metric: str, unit: str, description: str, goal: str,
       tiers: list[tuple], *, coins: bool = True) -> dict:
    """`tiers`: (rank, threshold, title) in growing order; a single tier is a milestone. `goal` has {n} for the
    threshold."""
    milestone = len(tiers) == 1
    out = []
    for rank, threshold, title in tiers:
        rank = MILESTONE_RANK if milestone else rank
        out.append({"rank": rank, "threshold": threshold, "title": title, "goal": goal.format(n=threshold),
                    "name": MILESTONE_NAME if milestone else TIER_NAMES[rank], "material": TIER_KEYS[rank],
                    "reward_coins": (MILESTONE_COINS if milestone else TIER_COINS[rank]) if coins else 0})
    return {"id": id, "group": group, "icon": icon, "metric": metric, "unit": unit, "description": description,
            "milestone": milestone, "coins": coins, "tiers": out}


# Ids and ranks are stored in achievement_unlocks: only ever add achievements and tiers, never renumber them.
ACHIEVEMENTS: list[dict] = [
    # Học tập: catalog lessons (lesson_api.lesson_state), every school year; a lesson studied again counts once.
    _a("lessons", "learning", "book", "lessons_completed", "bài học",
       "Bài học hoàn thành: mọi trò chơi bắt buộc của bài đều đạt. Học lại một bài không tính thêm.",
       "Hoàn thành {n} bài học",
       [(1, 1, "Bước chân đầu tiên"), (2, 10, "Người ham học"), (3, 25, "Chăm chỉ tích lũy"),
        (4, 50, "Nhà khám phá tri thức"), (5, 100, "Học giả Mirabi")]),
    _a("learning_days", "learning", "calendar", "learning_days", "ngày",
       "Những ngày khác nhau bạn hoàn thành ít nhất một màn học.", "Học trong {n} ngày khác nhau",
       [(1, 3, "Khởi động"), (2, 7, "Học tập chăm chỉ"), (3, 30, "Thói quen vàng"), (4, 100, "Bền bỉ"),
        (5, 200, "Không ngừng học hỏi")]),
    _a("subject_expert", "learning", "ribbon", "best_subject_lessons", "bài học",
       "Số bài học hoàn thành của môn bạn học nhiều nhất.", "Hoàn thành {n} bài học của một môn",
       [(1, 3, "Bạn của môn học"), (2, 6, "Học sinh giỏi môn"), (3, 10, "Chuyên gia môn học"),
        (4, 16, "Bậc thầy môn học"), (5, 25, "Huyền thoại môn học")]),
    _a("chapters", "learning", "trophy", "chapters_completed", "chủ đề",
       "Chủ đề (chương) có mọi bài học đã sẵn sàng đều được bạn hoàn thành.", "Hoàn thành trọn {n} chủ đề",
       [(1, 1, "Chinh phục kiến thức"), (2, 3, "Nhà chinh phục"), (3, 8, "Người mở đường"),
        (4, 15, "Bản đồ tri thức"), (5, 30, "Đại kiện tướng")]),
    # Trò chơi học tập: stages (learning_sessions) the backend scored. Lost or abandoned stages never count.
    _a("stages", "games", "game-controller", "stages_completed", "màn",
       "Màn chơi hoàn thành. Màn thua hoặc bỏ dở giữa chừng không tính.", "Hoàn thành {n} màn chơi",
       [(1, 1, "Màn chơi đầu tiên"), (2, 10, "Chiến binh nhỏ"), (3, 50, "Tay chơi chăm chỉ"), (4, 150, "Cao thủ"),
        (5, 500, "Nhà vô địch")]),
    _a("correct_answers", "games", "checkmark-circle", "correct_answers", "câu",
       "Câu trả lời đúng ngay lần đầu trong các màn hoàn thành.", "Trả lời đúng {n} câu ngay lần đầu",
       [(1, 25, "Trả lời chính xác"), (2, 100, "Trăm câu đúng"), (3, 500, "Tinh mắt"), (4, 1500, "Nhanh trí"),
        (5, 5000, "Bách khoa toàn thư")]),
    _a("perfect_stages", "games", "star", "perfect_stages", "màn",
       "Màn hoàn thành mà mọi câu đều đúng ngay lần đầu: không sai, không gợi ý, không xem đáp án.",
       "Có {n} màn hoàn hảo",
       [(1, 1, "Hoàn hảo"), (2, 5, "Không tì vết"), (3, 20, "Xuất sắc"), (4, 50, "Siêu sao"), (5, 150, "Bất bại")]),
    _a("game_subjects", "games", "apps", "game_subjects", "môn",
       "Các môn khác nhau có ít nhất một màn chơi bạn hoàn thành.", "Hoàn thành màn chơi của {n} môn",
       [(1, 2, "Đa năng"), (2, 3, "Tò mò"), (3, 5, "Toàn diện"), (4, 8, "Nhà thám hiểm môn học"), (5, 12, "Vạn năng")]),
    # Pet: levels and hatching as progression.py decides them; walks as companion.py settles them.
    _a("pet_hatched", "pet", "egg", "pets_hatched", "pet", "Quả trứng đầu tiên nở thành pet.", "Nở pet đầu tiên",
       [(1, 1, "Chào đời")]),
    _a("pet_level", "pet", "sparkles", "pet_level", "cấp",
       "Cấp cao nhất pet của bạn đạt được, theo đúng EXP và quy tắc lên cấp của pet.", "Pet đạt cấp {n}",
       [(1, 2, "Lớn khôn"), (2, 3, "Trưởng thành"), (3, 4, "Rực rỡ"), (4, 5, "Uy nghi"), (5, 6, "Pet huyền thoại")]),
    _a("walks", "pet", "footsteps", "walks", "chuyến",
       "Chuyến đi dạo đã về nhà. Pet đi dạo khi bạn hoàn thành mọi mục tiêu trong ngày.",
       "Hoàn thành {n} chuyến đi dạo",
       [(1, 1, "Chuyến đi đầu tiên"), (2, 10, "Bạn đồng hành"), (3, 30, "Kẻ lữ hành"), (4, 100, "Nhà thám hiểm"),
        (5, 250, "Huyền thoại du hành")]),
    _a("walk_finds", "pet", "gift", "walk_finds", "món", "Những món khác nhau pet mang về từ các chuyến đi dạo.",
       "Nhận {n} món khác nhau từ đi dạo",
       [(1, 1, "Món quà đầu tiên"), (2, 10, "Túi quà nhỏ"), (3, 20, "Nhà sưu tầm"), (4, 35, "Kho báu"),
        (5, 50, "Bảo tàng của pet")]),
    # Nhiệm vụ: occurrences completed (once each, never undone) of tasks still kept, and the day's quests.
    _a("tasks_done", "tasks", "checkbox", "tasks_completed", "nhiệm vụ",
       f"Nhiệm vụ và mục tiêu hằng ngày đã hoàn thành. Mỗi ngày tính tối đa {DAILY_TASKS_COUNTED}; nhiệm vụ đã xóa không tính.",
       "Hoàn thành {n} nhiệm vụ",
       [(1, 1, "Nhiệm vụ đầu tiên"), (2, 10, "Người hành động"), (3, 50, "Chăm chỉ mỗi ngày"), (4, 200, "Kỷ luật thép"),
        (5, 500, "Bậc thầy kế hoạch")]),
    _a("habit", "tasks", "repeat", "best_recurring_task", "lần",
       "Số lần bạn hoàn thành nhiệm vụ lặp lại mà bạn làm đều nhất (mỗi ngày một lần).",
       "Hoàn thành một nhiệm vụ lặp lại {n} lần",
       [(1, 3, "Gieo thói quen"), (2, 7, "Một tuần đều đặn"), (3, 21, "21 ngày bền bỉ"), (4, 60, "Thói quen vững vàng"),
        (5, 120, "Lối sống tích cực")]),
    _a("task_categories", "tasks", "grid", "task_categories", "nhóm",
       "Các nhóm nhiệm vụ khác nhau (học tập, sức khỏe, thói quen, cá nhân, công việc, khác) bạn đã hoàn thành.",
       "Hoàn thành nhiệm vụ thuộc {n} nhóm",
       [(1, 2, "Cân bằng"), (2, 4, "Đa dạng"), (3, 6, "Toàn diện")]),
    # Tập trung: sessions the server timed to their end (study.py's PUT flow, and group sessions it computed).
    _a("focus_sessions", "focus", "timer", "focus_sessions", "phiên",
       "Phiên tập trung (Pomodoro) chạy đến hết giờ. Phiên dừng giữa chừng không tính.",
       "Hoàn thành {n} phiên tập trung",
       [(1, 1, "Phiên đầu tiên"), (2, 10, "Tập trung cao độ"), (3, 50, "Dòng chảy"), (4, 150, "Thiền sư"),
        (5, 400, "Bậc thầy tập trung")]),
    _a("focus_hours", "focus", "hourglass", "focus_hours", "giờ",
       "Tổng thời gian các phiên tập trung hoàn thành, một mình và cùng nhóm.", "Tích lũy {n} giờ tập trung",
       [(1, 5, "Giờ vàng"), (2, 20, "Bền bỉ"), (3, 50, "Say mê"), (4, 100, "Kiên trì"), (5, 250, "Thời gian huyền thoại")]),
    _a("focus_days", "focus", "sunny", "focus_days", "ngày",
       "Những ngày khác nhau có ít nhất một phiên tập trung hoàn thành.", "Tập trung trong {n} ngày khác nhau",
       [(1, 3, "Khởi đầu đều đặn"), (2, 7, "Tuần lễ tập trung"), (3, 30, "Tháng tập trung"), (4, 100, "Trăm ngày"),
        (5, 200, "Ngọn hải đăng")]),
    # Vườn nhà: plantings (a seed used) and harvests (garden_harvests: a ready plant, once per planting).
    _a("first_planting", "garden", "leaf", "plantings", "cây", "Gieo hạt giống đầu tiên vào Vườn nhà.",
       "Trồng cây đầu tiên", [(1, 1, "Mầm xanh đầu tiên")]),
    _a("harvests", "garden", "basket", "harvests", "lần",
       "Lần thu hoạch cây đã chín. Thử thu hoạch cây chưa chín không tính.", "Thu hoạch {n} lần",
       [(1, 1, "Mùa vụ đầu tiên"), (2, 10, "Nhà nông chăm chỉ"), (3, 50, "Vườn sai quả"), (4, 150, "Điền chủ"),
        (5, 400, "Thần nông")]),
    _a("harvest_varieties", "garden", "flower", "harvest_varieties", "loại",
       "Những loại cây khác nhau bạn đã trồng đến lúc thu hoạch.", "Thu hoạch {n} loại cây",
       [(1, 3, "Vườn nhiều màu"), (2, 6, "Nhà thực vật học nhỏ"), (3, 10, "Bộ sưu tập xanh"),
        (4, 16, "Vườn bách thảo"), (5, 24, "Bách khoa cây cỏ")]),
    _a("harvest_rarities", "garden", "diamond", "harvest_rarities", "độ hiếm",
       "Độ hiếm khác nhau (Thường đến Huyền thoại) của những cây bạn đã thu hoạch.", "Thu hoạch cây thuộc {n} độ hiếm",
       [(1, 2, "Hai sắc màu"), (2, 3, "Ba sắc màu"), (3, 4, "Bốn mùa hoa"), (4, 5, "Ngũ sắc")]),
    # Bạn bè và học nhóm.
    _a("friends", "friends", "people", "friends", "bạn", "Bạn bè đã chấp nhận lời mời kết bạn.", "Có {n} người bạn",
       [(1, 1, "Người bạn đầu tiên"), (2, 3, "Nhóm bạn nhỏ"), (3, 5, "Hội bạn thân"), (4, 10, "Được yêu mến"),
        (5, 20, "Ngôi sao kết nối")]),
    _a("group_sessions", "friends", "school", "group_sessions", "phiên",
       "Phiên học nhóm bạn hoàn thành ít nhất một vòng tập trung.", "Hoàn thành {n} phiên học nhóm",
       [(1, 1, "Học nhóm lần đầu"), (2, 10, "Đồng đội"), (3, 30, "Nhóm học ăn ý"), (4, 75, "Thủ lĩnh học nhóm"),
        (5, 150, "Huyền thoại học nhóm")]),
    _a("team_quests", "friends", "flag", "team_quests", "nhiệm vụ", "Nhiệm vụ nhóm hoàn thành mà bạn có góp sức.",
       "Hoàn thành {n} nhiệm vụ nhóm",
       [(1, 1, "Góp sức"), (2, 5, "Đồng lòng"), (3, 15, "Đội ăn ý"), (4, 40, "Liên minh"), (5, 100, "Huyền thoại đồng đội")]),
    _a("friend_pet_days", "friends", "paw", "friend_pet_days", "ngày",
       "Những ngày khác nhau bạn ghé chơi với pet của bạn bè.", "Chơi với pet của bạn bè trong {n} ngày",
       [(1, 1, "Lần ghé đầu tiên"), (2, 7, "Khách quen"), (3, 30, "Người bạn của pet"), (4, 75, "Bạn của muôn loài"),
        (5, 150, "Sứ giả yêu thương")]),
    _a("garden_helper", "friends", "water", "garden_care_days", "ngày",
       "Những ngày khác nhau bạn tưới hoặc chăm cây trong vườn của bạn bè.", "Chăm vườn bạn bè trong {n} ngày",
       [(1, 1, "Bàn tay xanh"), (2, 7, "Hàng xóm tốt bụng"), (3, 30, "Người làm vườn tận tâm"), (4, 75, "Thần tưới cây"),
        (5, 150, "Thiên thần của khu vườn")]),
    # Cuộc sống (Mirabi Life, 16+): what users record themselves, so the badge only. No amount is ever shown or compared.
    _a("mood_days", "life", "happy", "mood_days", "ngày", "Những ngày bạn ghi lại cảm xúc ở Góc thư giãn.",
       "Ghi lại cảm xúc trong {n} ngày",
       [(1, 3, "Lắng nghe bản thân"), (2, 7, "Một tuần thấu hiểu"), (3, 30, "Nhật ký cảm xúc"), (4, 100, "Tâm hồn bình an"),
        (5, 200, "Bậc thầy tĩnh tâm")], coins=False),
    _a("journal_days", "life", "create", "journal_days", "ngày", "Những ngày bạn viết nhật ký.",
       "Viết nhật ký trong {n} ngày",
       [(1, 1, "Trang nhật ký đầu tiên"), (2, 7, "Người viết đều đặn"), (3, 30, "Cuốn sổ đầy"), (4, 100, "Nhà văn nhỏ"),
        (5, 200, "Hồi ký Mirabi")], coins=False),
    _a("money_days", "life", "wallet", "money_days", "ngày",
       "Những ngày bạn ghi chép thu chi hoặc tiết kiệm. Chỉ đếm ngày, không xét số tiền.",
       "Ghi chép tài chính trong {n} ngày",
       [(1, 3, "Người ghi chép"), (2, 7, "Tuần chi tiêu thông minh"), (3, 30, "Quản lý tài chính"),
        (4, 100, "Nhà hoạch định"), (5, 200, "Bậc thầy tài chính")], coins=False),
    _a("savings_goals", "life", "rose", "savings_goals_reached", "mục tiêu",
       "Mục tiêu tiết kiệm ở Vườn tài chính đạt đủ số đã đặt ra. Mirabi không hiển thị hay so sánh số tiền.",
       "Đạt {n} mục tiêu tiết kiệm",
       [(1, 1, "Cây đơm hoa"), (2, 3, "Vườn trĩu quả"), (3, 5, "Rừng tiết kiệm")], coins=False),
    _a("career_badges", "life", "briefcase", "career_badges", "huy hiệu", "Huy hiệu nghề nhận ở Hành trình sự nghiệp.",
       "Nhận {n} huy hiệu nghề",
       [(1, 1, "Huy hiệu nghề đầu tiên"), (2, 3, "Định hướng"), (3, 6, "Vững nghề"), (4, 10, "Chuyên gia"),
        (5, 20, "Bậc thầy nghề nghiệp")], coins=False),
]
BY_ID = {a["id"]: a for a in ACHIEVEMENTS}


def visible(user: User) -> list[dict]:
    return [a for a in ACHIEVEMENTS if a["group"] != "life" or life_eligible(user)]


# ---------------------------------------------------------------------------------------------------------------
# Metrics: each reads the records of one feature, never the app's numbers
# ---------------------------------------------------------------------------------------------------------------
def _zone(name: str | None):
    try:
        return ZoneInfo(name) if name else ZoneInfo(settings.daily_reset_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(settings.daily_reset_timezone)


def _local_day(at: datetime, zone: str | None) -> date:
    """The day where the user was (focus sessions and learning stages keep their own zone)."""
    return as_utc(at).astimezone(_zone(zone)).date()


def _count(db: Session, query) -> int:
    return int(db.scalar(query) or 0)


class _Measure:
    """The metrics of one user, read once per check (several achievements share a query)."""

    def __init__(self, db: Session, user: User, lessons_cache: str | None = None):
        self.db, self.user, self._lessons = db, user, None
        self.lessons_cache = lessons_cache  # AchievementCheck.lessons_json, updated when the lessons are read again

    def _completed_lessons(self) -> set[str]:
        if self._lessons is not None:
            return self._lessons
        catalog = (LearningSession.user_id == self.user.id, LearningSession.catalog_lesson.is_not(None),
                   LearningSession.archive_year.is_(None))
        # Every change of a session bumps its version: the same signature means the same results.
        count, last, versions = self.db.execute(select(func.count(), func.max(LearningSession.id),
                                                       func.sum(LearningSession.version)).where(*catalog)).one()
        sig = f"{count}:{last}:{versions}"
        try:
            cached = json.loads(self.lessons_cache) if self.lessons_cache else None
        except ValueError:
            cached = None
        if isinstance(cached, dict) and cached.get("sig") == sig and isinstance(cached.get("lessons"), list):
            self._lessons = {k for k in cached["lessons"] if lc.lesson(k)}
            return self._lessons
        keys = [k for k in self.db.scalars(select(LearningSession.catalog_lesson).where(*catalog).distinct()) if lc.lesson(k)]
        # Every school year at once: a lesson completed in any year is completed, and counts once.
        progress = lesson_api.game_progress(self.db, self.user.id, keys)
        self._lessons = {k for k in keys
                         if lesson_api.lesson_state(lc.lesson(k), progress.get(k, {}))["status"] == "completed"}
        self.lessons_cache = json.dumps({"sig": sig, "lessons": sorted(self._lessons)})
        return self._lessons

    # Học tập ----------------------------------------------------------------------------------------------------
    def lessons_completed(self) -> int:
        return len(self._completed_lessons())

    def best_subject_lessons(self) -> int:
        by_subject = Counter(lc.lesson(k)["subject"] for k in self._completed_lessons())
        return max(by_subject.values(), default=0)

    def chapters_completed(self) -> int:
        done = self._completed_lessons()
        chapters: dict[tuple, dict] = {}
        for key in done:
            entry = lc.lesson(key)
            chapters[(entry["subject"], entry["grade"], entry["chapter"]["key"])] = entry["chapter"]
        complete = 0
        for chapter in chapters.values():
            ready = [lesson["key"] for lesson in chapter["lessons"] if lesson.get("status") == "ready"]
            complete += bool(ready) and all(k in done for k in ready)
        return complete

    def learning_days(self) -> int:
        rows = self.db.execute(select(LearningSession.ended_at, LearningSession.timezone).where(
            LearningSession.user_id == self.user.id, LearningSession.status == "completed",
            LearningSession.ended_at.is_not(None))).all()
        return len({_local_day(ended, zone) for ended, zone in rows})

    # Trò chơi học tập ---------------------------------------------------------------------------------------------
    def stages_completed(self) -> int:
        return _count(self.db, select(func.count()).select_from(LearningSession).where(
            LearningSession.user_id == self.user.id, LearningSession.status == "completed"))

    def _own_turns(self):
        """A stage's own graded turns: not the re-practice after "Xem đáp án", not self-assessment (never right/wrong)."""
        return (LearningSessionItem.practice_of_id.is_(None), LearningSessionItem.required.is_(True),
                LearningSessionItem.kind != "choice_explain")

    def correct_answers(self) -> int:
        return _count(self.db, select(func.count()).select_from(LearningSessionItem)
                      .join(LearningSession, LearningSession.id == LearningSessionItem.session_id).where(
            LearningSession.user_id == self.user.id, LearningSession.status == "completed",
            LearningSessionItem.outcome == "first_try", *self._own_turns()))

    def perfect_stages(self) -> int:
        completed = (LearningSession.user_id == self.user.id, LearningSession.status == "completed")
        flawed = select(LearningSessionItem.session_id).join(
            LearningSession, LearningSession.id == LearningSessionItem.session_id).where(
            *completed, *self._own_turns(),
            (LearningSessionItem.outcome.is_(None)) | (LearningSessionItem.outcome != "first_try"))
        played = select(LearningSessionItem.session_id).join(
            LearningSession, LearningSession.id == LearningSessionItem.session_id).where(*completed, *self._own_turns())
        return _count(self.db, select(func.count()).select_from(LearningSession).where(
            *completed, LearningSession.id.in_(played), LearningSession.id.not_in(flawed)))

    def game_subjects(self) -> int:
        rows = self.db.execute(select(LearningSession.catalog_lesson, LearningSubject.code)
                               .join(LearningSubject, LearningSubject.id == LearningSession.subject_id)
                               .where(LearningSession.user_id == self.user.id, LearningSession.status == "completed")
                               .distinct()).all()
        subjects = set()
        for lesson_key, code in rows:
            entry = lc.lesson(lesson_key) if lesson_key else None
            subjects.add(entry["subject"] if entry else code)
        return len(subjects)

    # Pet -----------------------------------------------------------------------------------------------------------
    def pets_hatched(self) -> int:
        return _count(self.db, select(func.count()).select_from(PetEvolution).where(
            PetEvolution.user_id == self.user.id, PetEvolution.hatched_at.is_not(None)))

    def pet_level(self) -> int:
        return _count(self.db, select(func.max(PetEvolution.level)).where(PetEvolution.user_id == self.user.id))

    def walks(self) -> int:
        return _count(self.db, select(func.count()).select_from(PetWalk).where(
            PetWalk.user_id == self.user.id, PetWalk.rewarded_at.is_not(None)))

    def walk_finds(self) -> int:
        found = set(self.db.scalars(select(WalkReward.item_id).where(WalkReward.user_id == self.user.id).distinct()))
        # Walks settled before walk_rewards existed keep what they gave in pet_walks.rewards.
        for raw in self.db.scalars(select(PetWalk.rewards).where(PetWalk.user_id == self.user.id,
                                                                 PetWalk.rewarded_at.is_not(None),
                                                                 PetWalk.rewards.is_not(None))):
            try:
                found.update(r["item_id"] for r in json.loads(raw) if isinstance(r, dict) and r.get("item_id"))
            except (TypeError, ValueError):
                continue
        return len(found)

    # Nhiệm vụ ------------------------------------------------------------------------------------------------------
    def tasks_completed(self) -> int:
        per_day: Counter = Counter()
        for day, n in self.db.execute(select(UserTaskCompletion.occurrence_date, func.count())
                                      .join(UserTask, UserTask.id == UserTaskCompletion.task_id)
                                      .where(UserTask.user_id == self.user.id, UserTask.archived_at.is_(None))
                                      .group_by(UserTaskCompletion.occurrence_date)):
            per_day[day] += n
        # The day's quests (Nhiệm vụ hằng ngày): one Activity per quest and day (companion.complete_quest).
        for at in self.db.scalars(select(Activity.created_at).where(Activity.user_id == self.user.id,
                                                                    Activity.kind.like("quest\\_%", escape="\\"))):
            per_day[days.today(as_utc(at))] += 1
        return sum(min(n, DAILY_TASKS_COUNTED) for n in per_day.values())

    def best_recurring_task(self) -> int:
        per_task = (select(func.count(distinct(UserTaskCompletion.occurrence_date)).label("n"))
                    .join(UserTask, UserTask.id == UserTaskCompletion.task_id)
                    .where(UserTask.user_id == self.user.id, UserTask.archived_at.is_(None), UserTask.repeat != "none")
                    .group_by(UserTaskCompletion.task_id).subquery())
        return _count(self.db, select(func.max(per_task.c.n)))

    def task_categories(self) -> int:
        return _count(self.db, select(func.count(distinct(UserTask.category)))
                      .join(UserTaskCompletion, UserTaskCompletion.task_id == UserTask.id)
                      .where(UserTask.user_id == self.user.id, UserTask.archived_at.is_(None)))

    # Tập trung -----------------------------------------------------------------------------------------------------
    def _focus_done(self):
        """A focus session that ran to its end, as the server timed it: status "completed" is only written by the
        Pomodoro flow it bounds (study.record_pomodoro) and by group sessions it computes (study_rooms). Sessions
        posted with a duration of the app's own (no status) and breaks never count."""
        return (StudySession.user_id == self.user.id, StudySession.status == "completed",
                StudySession.completed.is_(True), StudySession.duration_seconds >= 60,
                ~func.coalesce(StudySession.mode, "").contains("break"))

    def focus_sessions(self) -> int:
        return _count(self.db, select(func.count()).select_from(StudySession).where(
            *self._focus_done(), StudySession.study_type == "self_study"))

    def focus_hours(self) -> int:
        return _count(self.db, select(func.coalesce(func.sum(StudySession.duration_seconds), 0))
                      .where(*self._focus_done())) // 3600

    def focus_days(self) -> int:
        rows = self.db.execute(select(StudySession.ended_at, StudySession.created_at, StudySession.timezone)
                               .where(*self._focus_done())).all()
        return len({_local_day(ended or created, zone) for ended, created, zone in rows})

    # Vườn nhà ------------------------------------------------------------------------------------------------------
    def plantings(self) -> int:
        return _count(self.db, select(func.count()).select_from(InventoryEvent).where(
            InventoryEvent.user_id == self.user.id, InventoryEvent.kind == "plant"))

    def harvests(self) -> int:
        return _count(self.db, select(func.count()).select_from(GardenHarvest).where(GardenHarvest.user_id == self.user.id))

    def _harvested_plants(self) -> set[str]:
        return set(self.db.scalars(select(GardenHarvest.plant_id).where(GardenHarvest.user_id == self.user.id).distinct()))

    def harvest_varieties(self) -> int:
        return len(self._harvested_plants())

    def harvest_rarities(self) -> int:
        return len({garden_catalog.PLANTS[p]["tier"] for p in self._harvested_plants() if p in garden_catalog.PLANTS})

    # Bạn bè và học nhóm --------------------------------------------------------------------------------------------
    def friends(self) -> int:
        return len(friends.friend_ids(self.db, self.user.id))

    def group_sessions(self) -> int:
        return _count(self.db, select(func.count()).select_from(StudyRoomParticipant)
                      .join(StudyRoomSession, StudyRoomSession.id == StudyRoomParticipant.session_id).where(
            StudyRoomParticipant.user_id == self.user.id, StudyRoomParticipant.cycles_completed > 0,
            StudyRoomSession.finalized_at.is_not(None)))

    def team_quests(self) -> int:
        return _count(self.db, select(func.count()).select_from(TeamQuestMember)
                      .join(TeamQuest, TeamQuest.id == TeamQuestMember.quest_id).where(
            TeamQuestMember.user_id == self.user.id, TeamQuestMember.contribution > 0, TeamQuest.status == "completed"))

    def friend_pet_days(self) -> int:
        return _count(self.db, select(func.count(distinct(FriendPetExpGrant.local_date))).where(
            FriendPetExpGrant.visitor_id == self.user.id))

    def garden_care_days(self) -> int:
        return _count(self.db, select(func.count(distinct(GardenCare.local_date))).where(
            GardenCare.carer_id == self.user.id, GardenCare.owner_id != self.user.id))

    # Cuộc sống -----------------------------------------------------------------------------------------------------
    def mood_days(self) -> int:
        return _count(self.db, select(func.count(distinct(MoodEntry.local_date))).where(MoodEntry.user_id == self.user.id))

    def journal_days(self) -> int:
        return len({days.today(as_utc(at)) for at in self.db.scalars(
            select(JournalEntry.created_at).where(JournalEntry.user_id == self.user.id))})

    def money_days(self) -> int:
        return len({days.today(as_utc(at)) for at in self.db.scalars(
            select(FinanceTransaction.created_at).where(FinanceTransaction.user_id == self.user.id,
                                                        FinanceTransaction.deleted_at.is_(None)))})

    def savings_goals_reached(self) -> int:
        goals = self.db.execute(select(FinanceGoal.id, FinanceGoal.target_amount).where(
            FinanceGoal.user_id == self.user.id)).all()
        return sum(1 for goal_id, target in goals if target > 0 and goal_balance(self.db, goal_id) >= target)

    def career_badges(self) -> int:
        return _count(self.db, select(func.count()).select_from(UserCareerAchievement).where(
            UserCareerAchievement.user_id == self.user.id))


def measure(db: Session, user: User, lessons_cache: str | None = None) -> tuple[dict[str, int], str | None]:
    """achievement id → its current count, for the achievements this user can see; and the lessons' cache to keep."""
    m = _Measure(db, user, lessons_cache)
    values: dict[str, int] = {}
    out = {}
    for a in visible(user):
        if a["metric"] not in values:
            values[a["metric"]] = int(getattr(m, a["metric"])())
        out[a["id"]] = values[a["metric"]]
    return out, m.lessons_cache


# ---------------------------------------------------------------------------------------------------------------
# Checking and recording
# ---------------------------------------------------------------------------------------------------------------
def _unlocks(db: Session, user_id: int) -> list[AchievementUnlock]:
    return list(db.scalars(select(AchievementUnlock).where(AchievementUnlock.user_id == user_id)
                           .order_by(AchievementUnlock.id)))


def record(db: Session, user: User, progress: dict[str, int], *, first: bool) -> list[AchievementUnlock]:
    """Write the tiers `progress` reaches that aren't stored yet. Concurrent checks may both try: the unique key keeps
    one row, the other is skipped. The caller commits."""
    have = {(u.achievement, u.tier) for u in _unlocks(db, user.id)}
    now, new = utcnow(), []
    for a in visible(user):
        value = progress.get(a["id"], 0)
        for tier in a["tiers"]:
            if value < tier["threshold"] or (a["id"], tier["rank"]) in have:
                continue
            row = AchievementUnlock(user_id=user.id, achievement=a["id"], tier=tier["rank"], progress=value,
                                    reward_coins=tier["reward_coins"], backfilled=first, unlocked_at=now)
            try:
                with db.begin_nested():
                    db.add(row)
                    db.flush()
                new.append(row)
            except IntegrityError:
                pass
    return new


def evaluate(db: Session, user: User, *, force: bool = False) -> tuple[dict[str, int] | None, list[AchievementUnlock]]:
    """Check the user's records and store the tiers newly reached. Without `force`, does nothing (None, []) when the
    last check is less than CHECK_SECONDS old. Commits."""
    now = utcnow()
    check = db.get(AchievementCheck, user.id)
    if check is not None and not force and (now - as_utc(check.checked_at)).total_seconds() < CHECK_SECONDS:
        return None, []
    progress, lessons = measure(db, user, check.lessons_json if check is not None else None)
    new = record(db, user, progress, first=check is None)
    if check is None:
        try:
            with db.begin_nested():
                db.add(AchievementCheck(user_id=user.id, checked_at=now, lessons_json=lessons))
                db.flush()
        except IntegrityError:
            pass  # another check of the same account got there first
    else:
        check.checked_at, check.lessons_json = now, lessons
    db.commit()
    return progress, new


# ---------------------------------------------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------------------------------------------
def _iso(at: datetime | None) -> str | None:
    return as_utc(at).isoformat() if at else None


def unlock_view(row: AchievementUnlock) -> dict:
    a = BY_ID.get(row.achievement)
    tier = next((t for t in a["tiers"] if t["rank"] == row.tier), None) if a else None
    return {"id": row.id, "achievement": row.achievement, "tier": row.tier,
            "title": tier["title"] if tier else row.achievement, "name": tier["name"] if tier else TIER_NAMES.get(row.tier),
            "material": tier["material"] if tier else TIER_KEYS.get(row.tier, "bronze"),
            "icon": a["icon"] if a else "ribbon", "group": a["group"] if a else None,
            "reward_coins": row.reward_coins, "unlocked_at": _iso(row.unlocked_at), "claimed_at": _iso(row.claimed_at),
            "claimable": row.reward_coins > 0 and row.claimed_at is None, "backfilled": bool(row.backfilled),
            "new": row.seen_at is None}


def achievement_view(a: dict, value: int, unlocked: dict[int, AchievementUnlock]) -> dict:
    tiers = []
    for t in a["tiers"]:
        row = unlocked.get(t["rank"])
        tiers.append({**t, "unlocked": row is not None, "unlock_id": row.id if row else None,
                      "unlocked_at": _iso(row.unlocked_at) if row else None,
                      "claimed_at": _iso(row.claimed_at) if row else None,
                      "reward_coins": row.reward_coins if row else t["reward_coins"],
                      "claimable": bool(row and row.reward_coins > 0 and row.claimed_at is None),
                      "backfilled": bool(row and row.backfilled), "new": bool(row and row.seen_at is None)})
    reached = [t for t in tiers if t["unlocked"]]
    upcoming = [t for t in tiers if not t["unlocked"]]
    current, nxt = (reached[-1] if reached else None), (upcoming[0] if upcoming else None)
    return {"id": a["id"], "group": a["group"], "icon": a["icon"], "unit": a["unit"], "description": a["description"],
            "milestone": a["milestone"], "coins": a["coins"], "progress": value,
            "title": (current or tiers[0])["title"], "tier": current["rank"] if current else 0,
            "material": current["material"] if current else None, "tier_name": current["name"] if current else None,
            "next": nxt and {k: nxt[k] for k in ("rank", "threshold", "title", "goal", "name", "material", "reward_coins")},
            "completed": nxt is None, "claimable": sum(1 for t in tiers if t["claimable"]),
            "new": any(t["new"] for t in tiers), "tiers": tiers}


def overview(db: Session, user: User, progress: dict[str, int]) -> dict:
    rows = _unlocks(db, user.id)
    by: dict[str, dict[int, AchievementUnlock]] = {}
    for r in rows:
        by.setdefault(r.achievement, {})[r.tier] = r
    shown = visible(user)
    items = [achievement_view(a, progress.get(a["id"], 0), by.get(a["id"], {})) for a in shown]
    total = sum(len(a["tiers"]) for a in shown)
    unlocked = sum(1 for i in items for t in i["tiers"] if t["unlocked"])
    claimable = [t for i in items for t in i["tiers"] if t["claimable"]]
    near = sorted((i for i in items if i["next"] and i["progress"] > 0),
                  key=lambda i: (-i["progress"] / i["next"]["threshold"], i["next"]["threshold"] - i["progress"]))[:3]
    visible_ids = {a["id"] for a in shown}
    recent = sorted((r for r in rows if r.achievement in visible_ids), key=lambda r: (as_utc(r.unlocked_at), r.id),
                    reverse=True)[:6]
    groups = [{**g, "total": sum(len(a["tiers"]) for a in shown if a["group"] == g["id"]),
               "unlocked": sum(1 for i in items if i["group"] == g["id"] for t in i["tiers"] if t["unlocked"])}
              for g in GROUPS if any(a["group"] == g["id"] for a in shown)]
    return {"summary": {"unlocked": unlocked, "total": total, "percent": round(100 * unlocked / total) if total else 0,
                        "claimable": len(claimable), "claimable_coins": sum(t["reward_coins"] for t in claimable)},
            "groups": groups, "tiers": [{"rank": r, "name": TIER_NAMES[r], "material": TIER_KEYS[r]} for r in TIER_NAMES],
            "achievements": items, "near": [i["id"] for i in near], "recent": [unlock_view(r) for r in recent],
            "daily_tasks_counted": DAILY_TASKS_COUNTED, "coins": user.coins}


# ---------------------------------------------------------------------------------------------------------------
# Rewards
# ---------------------------------------------------------------------------------------------------------------
def claim(db: Session, user: User, row: AchievementUnlock) -> bool:
    """Pay a reached tier's coins, once: True when this call paid them. Under the user's lock (wallet.py), in one
    transaction with the claim, so a crash or a lost connection leaves either both or neither. The caller commits."""
    lock_user(db, user.id)
    if row.reward_coins <= 0:
        return False
    claimed = db.execute(update(AchievementUnlock).where(AchievementUnlock.id == row.id,
                                                         AchievementUnlock.claimed_at.is_(None))
                         .values(claimed_at=utcnow()).execution_options(synchronize_session=False)).rowcount == 1
    if not claimed:
        return False
    # None: these coins were paid already (the coin event's key is unique); the claim is recorded either way.
    return wallet.earn(db, user.id, row.reward_coins, kind="achievement", ref=f"{row.achievement}:{row.tier}",
                       event_key=f"achievement:{row.achievement}:{row.tier}") is True


# ---------------------------------------------------------------------------------------------------------------
# Routes (every one is the signed-in user's own: there is no way to name another account)
# ---------------------------------------------------------------------------------------------------------------
@router.get("", summary="Every achievement with its progress, tiers and rewards (checks the user's records first)")
def get_achievements(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    progress, _ = evaluate(db, user, force=True)
    db.refresh(user)
    return overview(db, user, progress)


@router.get("/unseen", summary="Tiers reached that the app hasn't announced yet (the regular poll; checks at most every few seconds)")
def get_unseen(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    evaluate(db, user)
    rows = [r for r in _unlocks(db, user.id) if r.seen_at is None and r.achievement in {a["id"] for a in visible(user)}]
    # The latest few to name, and every id, so the app acknowledges them all at once (a first check may find many).
    return {"count": len(rows), "ids": [r.id for r in rows], "unlocks": [unlock_view(r) for r in rows[-10:]]}


class SeenInput(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=500)


@router.post("/seen", summary="The app announced these tiers (idempotent, any device)")
def mark_seen(data: SeenInput, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    changed = 0
    if data.ids:
        changed = db.execute(update(AchievementUnlock).where(
            AchievementUnlock.user_id == user.id, AchievementUnlock.id.in_(data.ids), AchievementUnlock.seen_at.is_(None))
            .values(seen_at=utcnow()).execution_options(synchronize_session=False)).rowcount
        db.commit()
    return {"seen": changed}


def _own_unlock(db: Session, user: User, unlock_id: int) -> AchievementUnlock:
    row = db.scalar(select(AchievementUnlock).where(AchievementUnlock.id == unlock_id,
                                                    AchievementUnlock.user_id == user.id))
    if row is None:
        raise APIError(404, "achievement_not_found", "No such achievement tier")
    return row


@router.post("/unlocks/{unlock_id}/claim", summary="Take a reached tier's coins (once; a retry changes nothing)")
def claim_one(unlock_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    row = _own_unlock(db, user, unlock_id)
    if row.reward_coins <= 0:
        raise APIError(409, "no_reward", "This achievement gives a badge only")
    paid = claim(db, user, row)
    db.commit()
    db.refresh(row)
    db.refresh(user)
    return {"paid": paid, "already_claimed": not paid, "reward_coins": row.reward_coins if paid else 0,
            "coins": user.coins, "unlock": unlock_view(row)}


@router.post("/claim-all", summary="Take the coins of every reached tier not taken yet")
def claim_all(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    lock_user(db, user.id)
    rows = [r for r in _unlocks(db, user.id) if r.reward_coins > 0 and r.claimed_at is None]
    paid = [r for r in rows if claim(db, user, r)]
    db.commit()
    db.refresh(user)
    return {"paid": len(paid), "reward_coins": sum(r.reward_coins for r in paid), "coins": user.coins}
