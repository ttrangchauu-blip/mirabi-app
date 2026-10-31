"""Who can use Mirabi Life (Nhiệm vụ công việc, Góc thư giãn, Phiêu lưu cuộc sống, Vườn tài chính, Thị trấn Mirabi,
Hành trình sự nghiệp): accounts whose age is at least LIFE_MIN_AGE.

The age is the one the user gave at registration or in "Độ tuổi & lớp học" (users.age). An account without an age
has no access until it gives one. Every Mirabi Life endpoint depends on `life_user`; anyone else gets 403
`age_restricted`, and the app hides the entries (mobile/src/life/access.ts keeps the same rule). Social features of the
town only ever show and reach other eligible accounts, so a younger friend is never visible or reachable from there.
"""
from fastapi import Depends

from .errors import APIError
from .models import User
from .security import current_user

LIFE_MIN_AGE = 16


def life_eligible(user: User) -> bool:
    return user.age is not None and user.age >= LIFE_MIN_AGE


def life_user(user: User = Depends(current_user)) -> User:
    if not life_eligible(user):
        raise APIError(403, "age_restricted", f"Mirabi Life is for users aged {LIFE_MIN_AGE} and over")
    return user
