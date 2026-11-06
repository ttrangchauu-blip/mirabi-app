"""Bảng tin: the post feed. Only signed-in users read it. Posts of disabled accounts, and of anyone blocked either way,
are left out for the reader (friends.py owns blocks), and such a post can't be liked either. One person likes a post
once: `community_post_likes` remembers who did, and `community_posts.likes` is the count the app shows (it also keeps
the likes counted before people were remembered)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .friends import blocked_ids
from .models import CommunityPost, CommunityPostLike, User
from .schemas import PostInput
from .security import current_user
from .companion import maybe_start_walk

router = APIRouter(prefix="/api/community", tags=["community"])

UNNAMED_AUTHOR = "Người dùng Mirabi"


def visible_posts(db: Session, reader: User):
    """The posts `reader` may see, with their authors."""
    return (select(CommunityPost, User).join(User, User.id == CommunityPost.user_id)
            .where(User.status == "active", CommunityPost.user_id.not_in(blocked_ids(db, reader.id))))


@router.get("/posts")
def community_posts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(visible_posts(db, user).order_by(desc(CommunityPost.created_at)).limit(50)).all()
    return [
        {"id": post.id,
         "author": author.display_name or UNNAMED_AUTHOR,
         "body": post.body, "image_url": post.image_url, "likes": post.likes,
         "created_at": post.created_at}
        for post, author in rows
    ]


@router.post("/posts")
def create_post(data: PostInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    post = CommunityPost(user_id=user.id, body=data.body.strip(), image_url=data.image_url)
    db.add(post)
    db.commit()
    db.refresh(post)
    maybe_start_walk(user, db)
    return {"id": post.id, "author": user.display_name, "body": post.body,
            "likes": post.likes, "created_at": post.created_at}


@router.post("/posts/{post_id}/like")
def like_post(post_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Idempotent: a second like, from any device and at any moment, changes nothing and answers the same count."""
    found = db.execute(visible_posts(db, user).where(CommunityPost.id == post_id)).first()
    if found is None:
        raise HTTPException(status_code=404, detail="Post not found")
    post = found[0]
    try:
        with db.begin_nested():
            db.add(CommunityPostLike(post_id=post.id, user_id=user.id))
        db.execute(update(CommunityPost).where(CommunityPost.id == post.id).values(likes=CommunityPost.likes + 1)
                   .execution_options(synchronize_session=False))
    except IntegrityError:  # this person's like is already counted
        pass
    db.commit()
    db.refresh(post)
    return {"id": post.id, "likes": post.likes}
