"""Hành trình sự nghiệp (Career Journey): career paths as RPG skill trees.

Content lives in data/careers.json (not in the app). At startup it is upserted by code: a changed path gets a new
`content_version`; a skill no longer in the file is retired, never deleted, so no one's progress is lost; a
prerequisite cycle or unknown prerequisite stops the start (and the tests). Administrators edit the file and call
POST /api/admin/careers/reload (or restart).

Progress is honest about what it is:
- `in_progress`: the user's own estimate (0–100 %);
- `practiced`: the user says they did a practice activity;
- `assessed`: they passed the skill's short check (all answers right), when the skill has one;
- "verified" (a real, external verification) does not exist yet, so nothing claims it.
Nothing here says a user has mastered a skill.

A skill opens when every prerequisite is practiced (or assessed). Practising earns 5 EXP and passing a check 5 EXP,
once per skill, through the shared task/learning daily cap. Badges (a group, or the whole tree, practiced) are
awarded once (unique per user and milestone). Changing career keeps every path's progress.
"""
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .errors import APIError
from .life_access import life_user
from .models import (CareerMilestone, CareerPath, CareerSkill, User, UserCareerAchievement, UserCareerProfile,
                     UserSkillProgress, as_utc, utcnow)
from .progression import award_exp
from .schemas import CareerProfileSet, SkillAssessment, SkillProgressUpdate
from .security import admin_user

router = APIRouter(prefix="/api/careers", tags=["careers"])
admin_router = APIRouter(prefix="/api/admin/careers", tags=["careers admin"])

CONTENT = Path(__file__).parent / "data" / "careers.json"
DONE = ("practiced", "assessed")
RANK = {"in_progress": 0, "practiced": 1, "assessed": 2}
SKILL_EXP = 5


class ContentError(ValueError):
    pass


def validate(paths: list[dict]) -> None:
    """Unique codes, known prerequisites inside the same path, no cycle, well-formed checks."""
    seen_paths = set()
    for path in paths:
        if path["code"] in seen_paths:
            raise ContentError(f"duplicate path {path['code']}")
        seen_paths.add(path["code"])
        codes = [s["code"] for s in path["skills"]]
        if len(codes) != len(set(codes)):
            raise ContentError(f"{path['code']}: duplicate skill code")
        needs = {s["code"]: list(s.get("prerequisites", [])) for s in path["skills"]}
        for code, pre in needs.items():
            for p in pre:
                if p not in needs:
                    raise ContentError(f"{path['code']}/{code}: unknown prerequisite {p}")
        # Kahn's algorithm: every skill must be reachable without a loop.
        remaining = {c: set(p) for c, p in needs.items()}
        while remaining:
            free = [c for c, p in remaining.items() if not p]
            if not free:
                raise ContentError(f"{path['code']}: prerequisite cycle among {sorted(remaining)}")
            for c in free:
                del remaining[c]
            for p in remaining.values():
                p.difference_update(free)
        for s in path["skills"]:
            for q in s.get("assessment", []):
                if not (0 <= q["answer"] < len(q["options"])):
                    raise ContentError(f"{path['code']}/{s['code']}: answer out of range")


def load_content() -> list[dict]:
    paths = json.loads(CONTENT.read_text(encoding="utf-8"))["paths"]
    validate(paths)
    return paths


def seed_careers(db: Session, paths: list[dict] | None = None) -> None:
    """Upsert paths, skills and milestones by code; retire what was removed. Safe to run again."""
    paths = paths if paths is not None else load_content()
    existing = {p.code: p for p in db.scalars(select(CareerPath))}
    for position, data in enumerate(paths):
        path = existing.get(data["code"])
        meta = {"name": data["name"], "description": data["description"], "icon": data.get("icon", "🧭"), "position": position}
        if path is None:
            path = CareerPath(code=data["code"], content_version=1, **meta)
            db.add(path)
            db.flush()
            changed = False
        else:
            changed = any(getattr(path, k) != v for k, v in meta.items()) or path.status != "published"
            for k, v in meta.items():
                setattr(path, k, v)
            path.status = "published"
        skills = {s.code: s for s in db.scalars(select(CareerSkill).where(CareerSkill.career_path_id == path.id))}
        for i, s in enumerate(data["skills"]):
            values = {"group_name": s["group"], "name": s["name"], "description": s["description"], "goal": s.get("goal", ""),
                      "level": s.get("level", 1), "prerequisites": json.dumps(s.get("prerequisites", []), ensure_ascii=False),
                      "activities": json.dumps(s.get("activities", []), ensure_ascii=False),
                      "assessment": json.dumps(s.get("assessment", []), ensure_ascii=False), "position": i, "status": "published"}
            row = skills.pop(s["code"], None)
            if row is None:
                db.add(CareerSkill(career_path_id=path.id, code=s["code"], **values))
                changed = True
            elif any(getattr(row, k) != v for k, v in values.items()):
                for k, v in values.items():
                    setattr(row, k, v)
                changed = True
        for gone in skills.values():
            if gone.status != "retired":
                gone.status = "retired"
                changed = True
        if changed and path.content_version and path.id in {p.id for p in existing.values()}:
            path.content_version += 1
        # Badges: each group, and the whole tree.
        groups: dict[str, list[str]] = {}
        for s in data["skills"]:
            groups.setdefault(s["group"], []).append(s["code"])
        wanted = {f"group:{g}": (f"Hoàn thành nhóm {g}", codes) for g, codes in groups.items()}
        wanted["path:all"] = (f"Chinh phục {data['name']}", [s["code"] for s in data["skills"]])
        milestones = {m.code: m for m in db.scalars(select(CareerMilestone).where(CareerMilestone.career_path_id == path.id))}
        for code, (title, codes) in wanted.items():
            req = json.dumps({"skills": codes, "status": "practiced"}, ensure_ascii=False)
            if code in milestones:
                milestones[code].title, milestones[code].requirements = title, req
            else:
                db.add(CareerMilestone(career_path_id=path.id, code=code[:64], title=title, requirements=req))
    for code, path in existing.items():
        if code not in {p["code"] for p in paths}:
            path.status = "retired"
    db.flush()


def path_by_code(db: Session, code: str) -> CareerPath:
    path = db.scalar(select(CareerPath).where(CareerPath.code == code, CareerPath.status == "published"))
    if path is None:
        raise APIError(404, "career_not_found", "Career not found")
    return path


def progress_map(db: Session, user: User, path_id: int | None = None) -> dict[int, UserSkillProgress]:
    query = select(UserSkillProgress).where(UserSkillProgress.user_id == user.id)
    if path_id is not None:
        query = query.join(CareerSkill, CareerSkill.id == UserSkillProgress.skill_id).where(CareerSkill.career_path_id == path_id)
    return {p.skill_id: p for p in db.scalars(query)}


def skills_of(db: Session, path_id: int) -> list[CareerSkill]:
    return list(db.scalars(select(CareerSkill).where(CareerSkill.career_path_id == path_id, CareerSkill.status == "published")
                           .order_by(CareerSkill.position)))


def skill_views(db: Session, user: User, path: CareerPath) -> list[dict]:
    skills = skills_of(db, path.id)
    progress = progress_map(db, user, path.id)
    by_code = {s.code: s for s in skills}
    status_of = {s.code: (progress[s.id].status if s.id in progress else None) for s in skills}
    out = []
    for s in skills:
        pre = [p for p in json.loads(s.prerequisites) if p in by_code]
        open_ = all(status_of[p] in DONE for p in pre)
        row = progress.get(s.id)
        questions = json.loads(s.assessment)
        out.append({"id": s.id, "code": s.code, "group": s.group_name, "name": s.name, "description": s.description,
                    "goal": s.goal, "level": s.level, "prerequisites": pre, "activities": json.loads(s.activities),
                    "has_assessment": bool(questions),
                    # Questions without their answers.
                    "assessment": [{"q": q["q"], "options": q["options"]} for q in questions],
                    "unlocked": open_, "status": row.status if row else ("available" if open_ else "locked"),
                    "progress_percent": row.progress_percent if row else 0,
                    "updated_at": as_utc(row.updated_at).isoformat() if row else None})
    return out


def achievement_views(db: Session, user: User, path_id: int | None = None) -> list[dict]:
    query = (select(UserCareerAchievement, CareerMilestone, CareerPath)
             .join(CareerMilestone, CareerMilestone.id == UserCareerAchievement.milestone_id)
             .join(CareerPath, CareerPath.id == CareerMilestone.career_path_id)
             .where(UserCareerAchievement.user_id == user.id))
    if path_id is not None:
        query = query.where(CareerPath.id == path_id)
    return [{"id": a.id, "milestone": m.code, "title": m.title, "career": p.code, "career_name": p.name, "icon": p.icon,
             "earned_at": as_utc(a.earned_at).isoformat()} for a, m, p in db.execute(query.order_by(UserCareerAchievement.id))]


def path_summary(db: Session, user: User, path: CareerPath, profiles: dict[int, UserCareerProfile]) -> dict:
    total = db.scalar(select(func.count()).select_from(CareerSkill).where(CareerSkill.career_path_id == path.id,
                                                                          CareerSkill.status == "published")) or 0
    done = db.scalar(select(func.count()).select_from(UserSkillProgress).join(CareerSkill, CareerSkill.id == UserSkillProgress.skill_id)
                     .where(UserSkillProgress.user_id == user.id, CareerSkill.career_path_id == path.id,
                            CareerSkill.status == "published", UserSkillProgress.status.in_(DONE))) or 0
    profile = profiles.get(path.id)
    return {"id": path.id, "code": path.code, "name": path.name, "description": path.description, "icon": path.icon,
            "content_version": path.content_version, "skills_total": total, "skills_done": done,
            "selected": profile is not None, "active": bool(profile and profile.active),
            "current_goal": profile.current_goal if profile else None}


def my_profiles(db: Session, user: User) -> dict[int, UserCareerProfile]:
    return {p.career_path_id: p for p in db.scalars(select(UserCareerProfile).where(UserCareerProfile.user_id == user.id))}


@router.get("")
def list_careers(user: User = Depends(life_user), db: Session = Depends(get_db)):
    profiles = my_profiles(db, user)
    return [path_summary(db, user, p, profiles)
            for p in db.scalars(select(CareerPath).where(CareerPath.status == "published").order_by(CareerPath.position))]


def path_detail(db: Session, user: User, path: CareerPath, earned: list[dict] | None = None) -> dict:
    skills = skill_views(db, user, path)
    groups: list[dict] = []
    for s in skills:
        if not groups or groups[-1]["name"] != s["group"]:
            groups.append({"name": s["group"], "skills": []})
        groups[-1]["skills"].append(s)
    got = {a["milestone"] for a in achievement_views(db, user, path.id)}
    milestones = [{"code": m.code, "title": m.title, "earned": m.code in got}
                  for m in db.scalars(select(CareerMilestone).where(CareerMilestone.career_path_id == path.id).order_by(CareerMilestone.id))]
    return {**path_summary(db, user, path, my_profiles(db, user)), "groups": groups, "milestones": milestones,
            "new_badges": earned or []}


@router.get("/achievements")
def list_achievements(user: User = Depends(life_user), db: Session = Depends(get_db)):
    return achievement_views(db, user)


@router.get("/my-progress")
def my_progress(user: User = Depends(life_user), db: Session = Depends(get_db)):
    profiles = my_profiles(db, user)
    paths = [path_summary(db, user, p, profiles) for p in db.scalars(select(CareerPath).where(CareerPath.id.in_(list(profiles))))] if profiles else []
    active = next((p for p in paths if p["active"]), None)
    return {"active": active, "careers": paths, "badges": len(achievement_views(db, user))}


@router.post("/profile")
def set_profile(data: CareerProfileSet, user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Choose (or switch to) a career. The others stay selected, with their progress, just not active."""
    path = path_by_code(db, data.career_code)
    db.execute(update(UserCareerProfile).where(UserCareerProfile.user_id == user.id).values(active=False)
               .execution_options(synchronize_session=False))
    profile = db.scalar(select(UserCareerProfile).where(UserCareerProfile.user_id == user.id, UserCareerProfile.career_path_id == path.id))
    if profile is None:
        profile = UserCareerProfile(user_id=user.id, career_path_id=path.id, current_goal=data.current_goal, active=True)
        try:
            with db.begin_nested():
                db.add(profile)
        except IntegrityError:
            profile = db.scalar(select(UserCareerProfile).where(UserCareerProfile.user_id == user.id, UserCareerProfile.career_path_id == path.id))
    profile.active = True
    if data.current_goal is not None:
        profile.current_goal = data.current_goal
    db.commit()
    return path_detail(db, user, path)


@router.get("/{code}")
def get_career(code: str, user: User = Depends(life_user), db: Session = Depends(get_db)):
    return path_detail(db, user, path_by_code(db, code))


@router.get("/{code}/skills")
def get_skills(code: str, user: User = Depends(life_user), db: Session = Depends(get_db)):
    return skill_views(db, user, path_by_code(db, code))


def open_skill(db: Session, user: User, skill_id: int) -> tuple[CareerSkill, CareerPath]:
    skill = db.scalar(select(CareerSkill).where(CareerSkill.id == skill_id, CareerSkill.status == "published"))
    if skill is None:
        raise APIError(404, "skill_not_found", "Skill not found")
    path = db.get(CareerPath, skill.career_path_id)
    if path is None or path.status != "published":
        raise APIError(404, "skill_not_found", "Skill not found")
    if db.scalar(select(UserCareerProfile.id).where(UserCareerProfile.user_id == user.id, UserCareerProfile.career_path_id == path.id)) is None:
        raise APIError(409, "career_not_selected", "Choose this career first")
    view = next(s for s in skill_views(db, user, path) if s["id"] == skill.id)
    if not view["unlocked"]:
        raise APIError(409, "skill_locked", "Practise its prerequisites first")
    return skill, path


def progress_row(db: Session, user: User, skill: CareerSkill) -> UserSkillProgress:
    row = db.scalar(select(UserSkillProgress).where(UserSkillProgress.user_id == user.id, UserSkillProgress.skill_id == skill.id))
    if row is None:
        row = UserSkillProgress(user_id=user.id, skill_id=skill.id, status="in_progress", progress_percent=0)
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            row = db.scalar(select(UserSkillProgress).where(UserSkillProgress.user_id == user.id, UserSkillProgress.skill_id == skill.id))
    return row


def award_badges(db: Session, user: User, path: CareerPath) -> list[dict]:
    """Every milestone of the path now met and not yet earned; each once."""
    done = {s["code"] for s in skill_views(db, user, path) if s["status"] in DONE}
    earned = []
    have = {a.milestone_id for a in db.scalars(select(UserCareerAchievement).where(UserCareerAchievement.user_id == user.id))}
    for m in db.scalars(select(CareerMilestone).where(CareerMilestone.career_path_id == path.id)):
        if m.id in have:
            continue
        need = json.loads(m.requirements)["skills"]
        live = {s.code for s in skills_of(db, path.id)}
        need = [c for c in need if c in live]
        if need and all(c in done for c in need):
            try:
                with db.begin_nested():
                    db.add(UserCareerAchievement(user_id=user.id, milestone_id=m.id, earned_at=utcnow()))
                    db.flush()
                earned.append({"milestone": m.code, "title": m.title})
            except IntegrityError:
                pass
    return earned


@router.patch("/skills/{skill_id}/progress")
def update_progress(skill_id: int, data: SkillProgressUpdate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    skill, path = open_skill(db, user, skill_id)
    if data.progress_percent is None and not data.practiced:
        raise APIError(422, "nothing_to_update", "Send a progress or mark the practice done")
    row = progress_row(db, user, skill)
    exp = 0
    if data.practiced:
        if RANK.get(row.status, 0) < RANK["practiced"]:
            row.status = "practiced"
        row.progress_percent = 100
        exp = award_exp(user, db, source="task", reference_id=f"career:practice:{skill.id}", requested=SKILL_EXP,
                        daily_cap=settings.task_daily_exp_cap)
    elif row.status == "in_progress":
        # A self-reported estimate never lowers a practiced or assessed skill.
        row.progress_percent = data.progress_percent
    row.updated_at = utcnow()
    badges = award_badges(db, user, path)
    db.commit()
    return {**path_detail(db, user, path, badges), "skill_id": skill.id, "awarded_exp": exp}


@router.post("/skills/{skill_id}/assessment")
def assess(skill_id: int, data: SkillAssessment, user: User = Depends(life_user), db: Session = Depends(get_db)):
    """The skill's short check. Passing (every answer right) marks it assessed; answers are checked here, never sent."""
    skill, path = open_skill(db, user, skill_id)
    questions = json.loads(skill.assessment)
    if not questions:
        raise APIError(409, "no_assessment", "This skill has no check yet")
    if len(data.answers) != len(questions):
        raise APIError(422, "wrong_answer_count", "Answer every question")
    correct = sum(1 for q, a in zip(questions, data.answers) if q["answer"] == a)
    passed = correct == len(questions)
    exp = 0
    badges: list[dict] = []
    if passed:
        row = progress_row(db, user, skill)
        row.status, row.progress_percent, row.updated_at = "assessed", 100, utcnow()
        exp = award_exp(user, db, source="task", reference_id=f"career:assess:{skill.id}", requested=SKILL_EXP,
                        daily_cap=settings.task_daily_exp_cap)
        badges = award_badges(db, user, path)
    db.commit()
    return {**path_detail(db, user, path, badges), "skill_id": skill.id, "passed": passed, "correct": correct,
            "total": len(questions), "awarded_exp": exp}


@admin_router.post("/reload")
def reload_content(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    """Re-read data/careers.json after an edit. Invalid content is refused and nothing changes."""
    try:
        paths = load_content()
    except (ContentError, KeyError, ValueError) as exc:
        raise APIError(422, "invalid_career_content", str(exc)[:300])
    seed_careers(db, paths)
    db.commit()
    return {"paths": len(paths)}
