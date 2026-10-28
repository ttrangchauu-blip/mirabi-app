from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import CommunityPost, User
from .schemas import PostInput
from .security import current_user
from .companion import maybe_start_walk

router = APIRouter(prefix="/api/community", tags=["community"])


@router.get("/posts")
def community_posts(db: Session = Depends(get_db)):
    posts = db.scalars(select(CommunityPost).order_by(desc(CommunityPost.created_at)).limit(50))
    return [
        {"id": post.id,
         "author": (author.display_name if (author := db.get(User, post.user_id)) else "NgÆ°á»i dÃ¹ng Mirabi"),
         "body": post.body, "image_url": post.image_url, "likes": post.likes,
         "created_at": post.created_at}
        for post in posts
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
    post = db.get(CommunityPost, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    post.likes += 1
    db.commit()
    return {"id": post.id, "likes": post.likes}
