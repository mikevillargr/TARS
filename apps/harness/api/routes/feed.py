"""
Feed Reader API routes.

Sources: subscribe/manage feeds.
Items: browse, mark read, star, save to Second Brain, open in chat.
Discover: Feedly search proxy.
Presets: one-click category packs.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, func, update as sa_update, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import FeedSource, FeedItem, KnowledgeItem, Conversation, Message

router = APIRouter()
log = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────

class FeedSourceOut(BaseModel):
    id: str
    name: str
    url: str
    original_url: Optional[str]
    source_type: str
    category: Optional[str]
    favicon_url: Optional[str]
    enabled: bool
    fetch_interval_hours: int
    last_fetched_at: Optional[datetime]
    error_count: int
    last_error: Optional[str]
    created_at: datetime
    unread_count: int = 0

    class Config:
        from_attributes = True


class FeedItemOut(BaseModel):
    id: str
    feed_source_id: str
    title: str
    url: str
    author: Optional[str]
    summary: Optional[str]
    image_url: Optional[str]
    published_at: Optional[datetime]
    media_type: str
    media_url: Optional[str]
    is_read: bool
    is_starred: bool
    knowledge_item_id: Optional[str]
    created_at: datetime
    # denormalized from source
    source_name: Optional[str] = None
    source_favicon: Optional[str] = None
    category: Optional[str] = None

    class Config:
        from_attributes = True


class FeedItemDetailOut(FeedItemOut):
    content: Optional[str] = None


class AddFeedRequest(BaseModel):
    url: str
    name: Optional[str] = None
    category: Optional[str] = None
    fetch_interval_hours: int = 24
    source_type: Optional[str] = None  # if provided, skip re-validation
    favicon_url: Optional[str] = None  # if provided, skip re-validation


class UpdateFeedSourceRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    enabled: Optional[bool] = None
    fetch_interval_hours: Optional[int] = None


class UpdateFeedItemRequest(BaseModel):
    is_read: Optional[bool] = None
    is_starred: Optional[bool] = None


class CategoryOut(BaseModel):
    name: str
    total_count: int
    unread_count: int


class DiscoverResultOut(BaseModel):
    feed_url: str
    name: str
    description: Optional[str]
    subscribers: Optional[int]
    icon_url: Optional[str]
    website_url: Optional[str]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_source(db: AsyncSession, source_id: str, user_id: str) -> FeedSource:
    result = await db.execute(
        select(FeedSource).where(FeedSource.id == source_id, FeedSource.user_id == user_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Feed source not found")
    return source


async def _get_item(db: AsyncSession, item_id: str, user_id: str) -> FeedItem:
    result = await db.execute(
        select(FeedItem).where(FeedItem.id == item_id, FeedItem.user_id == user_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Feed item not found")
    return item


def _enrich_item(item: FeedItem, source: FeedSource) -> dict:
    d = {
        "id": item.id,
        "feed_source_id": item.feed_source_id,
        "title": item.title,
        "url": item.url,
        "author": item.author,
        "summary": item.summary,
        "content": item.content,
        "image_url": item.image_url,
        "published_at": item.published_at,
        "media_type": item.media_type,
        "media_url": item.media_url,
        "is_read": item.is_read,
        "is_starred": item.is_starred,
        "knowledge_item_id": item.knowledge_item_id,
        "created_at": item.created_at,
        "source_name": source.name,
        "source_favicon": source.favicon_url,
        "category": source.category,
    }
    return d


async def _do_sync_source(source: FeedSource, db: AsyncSession) -> int:
    """Fetch new items for a single source. Returns count of new items added."""
    from connectors.feed_reader import fetch_feed
    try:
        items, favicon_url = await asyncio.get_event_loop().run_in_executor(
            None, fetch_feed, source.url, source.source_type, source.last_fetched_at
        )
    except Exception as e:
        source.error_count += 1
        source.last_error = str(e)
        await db.commit()
        raise

    if favicon_url and not source.favicon_url:
        source.favicon_url = favicon_url

    new_count = 0
    for item_data in items:
        # Dedup by URL
        existing = (await db.execute(
            select(FeedItem.id).where(
                FeedItem.feed_source_id == source.id,
                FeedItem.url == item_data["url"],
            )
        )).scalar_one_or_none()
        if existing:
            continue
        db.add(FeedItem(
            feed_source_id=source.id,
            user_id=source.user_id,
            **item_data,
        ))
        new_count += 1

    # Rolling cleanup: delete read non-starred non-saved items older than 90 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    await db.execute(
        sa_delete(FeedItem).where(
            FeedItem.feed_source_id == source.id,
            FeedItem.is_read.is_(True),
            FeedItem.is_starred.is_(False),
            FeedItem.knowledge_item_id.is_(None),
            FeedItem.fetched_at < cutoff,
        )
    )

    source.last_fetched_at = datetime.now(timezone.utc)
    source.error_count = 0
    source.last_error = None
    await db.commit()
    return new_count


# ── Sources ───────────────────────────────────────────────────────────────────

@router.get("/sources", response_model=List[FeedSourceOut])
async def list_sources(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    sources = (await db.execute(
        select(FeedSource)
        .where(FeedSource.user_id == user_id)
        .order_by(FeedSource.category.nullslast(), FeedSource.name)
    )).scalars().all()

    # Get unread counts in one query
    unread_counts = dict((await db.execute(
        select(FeedItem.feed_source_id, func.count(FeedItem.id))
        .where(FeedItem.user_id == user_id, FeedItem.is_read.is_(False))
        .group_by(FeedItem.feed_source_id)
    )).all())

    result = []
    for s in sources:
        d = FeedSourceOut.model_validate(s)
        d.unread_count = unread_counts.get(s.id, 0)
        result.append(d)
    return result


@router.post("/sources/preview")
async def preview_feed(body: AddFeedRequest):
    """Validate a URL and return feed info before saving."""
    from connectors.feed_reader import preview_feed as _preview
    loop = asyncio.get_event_loop()
    try:
        info = await loop.run_in_executor(None, _preview, body.url)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not fetch feed: {e}")
    return info


@router.post("/sources", response_model=FeedSourceOut, status_code=201)
async def add_source(
    body: AddFeedRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    loop = asyncio.get_event_loop()

    # Skip expensive preview if caller already knows the feed type (e.g. from Discover)
    if body.source_type and body.name:
        feed_url = body.url
        source_type = body.source_type
        name = body.name
        favicon_url = body.favicon_url
    else:
        from connectors.feed_reader import preview_feed as _preview
        try:
            info = await loop.run_in_executor(None, _preview, body.url)
        except Exception as e:
            raise HTTPException(status_code=422, detail=str(e))
        feed_url = info["feed_url"]
        source_type = info["source_type"]
        name = body.name or info["name"]
        favicon_url = info.get("favicon_url")

    source = FeedSource(
        user_id=user_id,
        name=name,
        url=feed_url,
        original_url=body.url if body.url != feed_url else None,
        source_type=source_type,
        category=body.category,
        favicon_url=favicon_url,
        fetch_interval_hours=body.fetch_interval_hours,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    # Trigger initial sync in background
    source_id = source.id
    async def _initial_sync():
        from db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as bg_db:
            src = (await bg_db.execute(
                select(FeedSource).where(FeedSource.id == source_id)
            )).scalar_one_or_none()
            if src:
                try:
                    await _do_sync_source(src, bg_db)
                except Exception as e:
                    log.warning("Initial sync failed for %s: %s", source_id, e)

    background_tasks.add_task(_initial_sync)

    out = FeedSourceOut.model_validate(source)
    out.unread_count = 0
    return out


@router.patch("/sources/{source_id}", response_model=FeedSourceOut)
async def update_source(
    source_id: str,
    body: UpdateFeedSourceRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    source = await _get_source(db, source_id, user_id)
    if body.name is not None:
        source.name = body.name
    if body.category is not None:
        source.category = body.category
    if body.enabled is not None:
        source.enabled = body.enabled
    if body.fetch_interval_hours is not None:
        source.fetch_interval_hours = body.fetch_interval_hours
    await db.commit()
    await db.refresh(source)
    out = FeedSourceOut.model_validate(source)
    out.unread_count = (await db.execute(
        select(func.count(FeedItem.id))
        .where(FeedItem.feed_source_id == source_id, FeedItem.is_read.is_(False))
    )).scalar_one()
    return out


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    source = await _get_source(db, source_id, user_id)
    await db.delete(source)
    await db.commit()


@router.post("/sources/{source_id}/sync")
async def sync_source(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    source = await _get_source(db, source_id, user_id)
    try:
        new_count = await _do_sync_source(source, db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"new_items": new_count}


# ── Items ─────────────────────────────────────────────────────────────────────

@router.get("/items", response_model=List[FeedItemDetailOut])
async def list_items(
    category: Optional[str] = None,
    source_id: Optional[str] = None,
    unread_only: bool = False,
    starred: bool = False,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    q = (
        select(FeedItem, FeedSource)
        .join(FeedSource, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedItem.user_id == user_id)
    )
    if category:
        q = q.where(FeedSource.category == category)
    if source_id:
        q = q.where(FeedItem.feed_source_id == source_id)
    if unread_only:
        q = q.where(FeedItem.is_read.is_(False))
    if starred:
        q = q.where(FeedItem.is_starred.is_(True))
    if search:
        q = q.where(FeedItem.title.ilike(f"%{search}%") | FeedItem.summary.ilike(f"%{search}%"))
    q = q.order_by(FeedItem.published_at.desc().nullslast(), FeedItem.created_at.desc())
    q = q.offset(offset).limit(limit)

    rows = (await db.execute(q)).all()
    return [_enrich_item(item, source) for item, source in rows]


def _fetch_full_article(url: str) -> Optional[str]:
    """
    Fetch the original article URL and extract readable content.
    Returns an HTML string or None. Runs in a thread (blocking IO).
    Content threshold: only replaces stored content when significantly longer.
    """
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None
        # Try structured HTML output first
        content = trafilatura.extract(
            downloaded,
            output_format="html",
            include_comments=False,
            include_tables=True,
            favor_recall=True,
        )
        if content and len(content) > 300:
            return content
        # Fallback: plain text → wrapped paragraphs
        text = trafilatura.extract(downloaded, favor_recall=True)
        if text:
            paras = [p.strip() for p in text.split("\n\n") if p.strip()]
            if paras:
                return "<p>" + "</p>\n<p>".join(paras) + "</p>"
    except Exception as e:
        log.debug("Full article fetch failed for %s: %s", url, e)
    return None


@router.get("/items/{item_id}", response_model=FeedItemDetailOut)
async def get_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    result = await db.execute(
        select(FeedItem, FeedSource)
        .join(FeedSource, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedItem.id == item_id, FeedItem.user_id == user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Feed item not found")
    item, source = row

    # Mark as read
    if not item.is_read:
        item.is_read = True

    # Lazy full-article fetch: if stored content looks like a summary (under
    # 5000 chars), fetch the original URL and cache it for future opens.
    stored_len = len(item.content or "")
    if item.media_type == "article" and stored_len < 5000:
        try:
            full = await asyncio.to_thread(_fetch_full_article, item.url)
            if full and len(full) > stored_len:
                item.content = full
                log.info("Full article cached for %s (%d chars)", item.url, len(full))
        except Exception as e:
            log.warning("Article fetch failed for %s: %s", item.url, e)

    await db.commit()
    return _enrich_item(item, source)


@router.patch("/items/{item_id}", response_model=FeedItemOut)
async def update_item(
    item_id: str,
    body: UpdateFeedItemRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    result = await db.execute(
        select(FeedItem, FeedSource)
        .join(FeedSource, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedItem.id == item_id, FeedItem.user_id == user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Feed item not found")
    item, source = row

    if body.is_read is not None:
        item.is_read = body.is_read
    if body.is_starred is not None:
        item.is_starred = body.is_starred
    await db.commit()
    return _enrich_item(item, source)


@router.post("/items/mark-all-read", status_code=204)
async def mark_all_read(
    category: Optional[str] = None,
    source_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    q = sa_update(FeedItem).where(
        FeedItem.user_id == user_id,
        FeedItem.is_read.is_(False),
    ).values(is_read=True)

    if source_id:
        q = q.where(FeedItem.feed_source_id == source_id)
    elif category:
        # need a subquery to filter by category via FeedSource
        source_ids = (await db.execute(
            select(FeedSource.id).where(
                FeedSource.user_id == user_id,
                FeedSource.category == category,
            )
        )).scalars().all()
        q = q.where(FeedItem.feed_source_id.in_(source_ids))

    await db.execute(q)
    await db.commit()


@router.post("/items/{item_id}/save")
async def save_to_brain(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """Save a feed article to Second Brain."""
    result = await db.execute(
        select(FeedItem, FeedSource)
        .join(FeedSource, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedItem.id == item_id, FeedItem.user_id == user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Feed item not found")
    item, source = row

    if item.knowledge_item_id:
        return {"knowledge_item_id": item.knowledge_item_id, "already_saved": True}

    from memory.second_brain import _ingest_content
    tags = [source.category] if source.category else []
    knowledge_item = await _ingest_content(
        db=db,
        user_id=user_id,
        item_type="url",
        content=item.content or item.summary or item.title,
        title=item.title,
        url=item.url,
        author=item.author or "",
        tags=tags,
        domain=None,  # auto-classified
    )
    item.knowledge_item_id = knowledge_item.id
    await db.commit()
    return {"knowledge_item_id": knowledge_item.id, "already_saved": False}


@router.post("/items/{item_id}/chat")
async def open_in_chat(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """Create a new chat conversation pre-seeded with the article content."""
    result = await db.execute(
        select(FeedItem, FeedSource)
        .join(FeedSource, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedItem.id == item_id, FeedItem.user_id == user_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Feed item not found")
    item, source = row

    pub_str = item.published_at.strftime("%B %d, %Y") if item.published_at else "unknown date"
    body_text = item.content or item.summary or item.title

    opening_message = (
        f"I'm reading an article and want to discuss it:\n\n"
        f"**{item.title}**\n"
        f"Source: {source.name} · {pub_str}\n\n"
        f"---\n{body_text}"
    )

    conv = Conversation(user_id=user_id, title=item.title[:80])
    db.add(conv)
    await db.flush()

    msg = Message(
        conversation_id=conv.id,
        role="user",
        content=opening_message,
    )
    db.add(msg)
    await db.commit()

    return {"conversation_id": conv.id}


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=List[CategoryOut])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    rows = (await db.execute(
        select(FeedSource.category, func.count(FeedSource.id).label("total_sources"))
        .where(FeedSource.user_id == user_id, FeedSource.category.isnot(None))
        .group_by(FeedSource.category)
        .order_by(FeedSource.category)
    )).all()

    # Get per-category unread counts
    unread_by_cat = dict((await db.execute(
        select(FeedSource.category, func.count(FeedItem.id))
        .join(FeedItem, FeedItem.feed_source_id == FeedSource.id)
        .where(
            FeedSource.user_id == user_id,
            FeedItem.is_read.is_(False),
            FeedSource.category.isnot(None),
        )
        .group_by(FeedSource.category)
    )).all())

    total_by_cat = dict((await db.execute(
        select(FeedSource.category, func.count(FeedItem.id))
        .join(FeedItem, FeedItem.feed_source_id == FeedSource.id)
        .where(FeedSource.user_id == user_id, FeedSource.category.isnot(None))
        .group_by(FeedSource.category)
    )).all())

    return [
        CategoryOut(
            name=row.category,
            total_count=total_by_cat.get(row.category, 0),
            unread_count=unread_by_cat.get(row.category, 0),
        )
        for row in rows
    ]


# ── Discover (Feedly search proxy) ───────────────────────────────────────────

@router.get("/discover", response_model=List[DiscoverResultOut])
async def discover_feeds(
    q: str,
    count: int = 20,
):
    from core.config import settings
    api_key = getattr(settings, "feedly_api_key", "")

    headers = {}
    if api_key:
        headers["Authorization"] = f"OAuth {api_key}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://cloud.feedly.com/v3/search/feeds",
                params={"query": q, "count": count, "locale": "en"},
                headers=headers,
            )
            if resp.status_code == 401 and not api_key:
                raise HTTPException(
                    status_code=503,
                    detail="Feedly API key required. Get a free key at developer.feedly.com and add FEEDLY_API_KEY to .env"
                )
            resp.raise_for_status()
            data = resp.json()
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Feedly search failed: {e}")

    results = []
    for item in data.get("results", []):
        feed_id = item.get("feedId", "")
        feed_url = feed_id.removeprefix("feed/")
        if not feed_url.startswith("http"):
            continue
        results.append(DiscoverResultOut(
            feed_url=feed_url,
            name=item.get("title") or item.get("website") or feed_url,
            description=item.get("description"),
            subscribers=item.get("subscribers"),
            icon_url=item.get("iconUrl") or item.get("visualUrl"),
            website_url=item.get("website"),
        ))
    return results


# ── Presets ───────────────────────────────────────────────────────────────────

@router.get("/presets")
async def list_presets():
    from connectors.feed_reader import PRESET_PACKS
    return [
        {
            "id": pack_id,
            "label": pack["label"],
            "icon": pack["icon"],
            "feed_count": len(pack["feeds"]),
            "feeds": [{"name": f["name"], "url": f["url"]} for f in pack["feeds"]],
        }
        for pack_id, pack in PRESET_PACKS.items()
    ]


@router.post("/presets/{pack_id}/enable", status_code=201)
async def enable_preset(
    pack_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    from connectors.feed_reader import PRESET_PACKS, preview_feed as _preview
    pack = PRESET_PACKS.get(pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail="Preset pack not found")

    added = []
    for feed_def in pack["feeds"]:
        # Skip if already subscribed to this URL
        existing = (await db.execute(
            select(FeedSource.id).where(
                FeedSource.user_id == user_id,
                FeedSource.url == feed_def["url"],
            )
        )).scalar_one_or_none()
        if existing:
            continue

        source = FeedSource(
            user_id=user_id,
            name=feed_def["name"],
            url=feed_def["url"],
            source_type=feed_def["source_type"],
            category=pack["label"],
            fetch_interval_hours=4,
        )
        db.add(source)
        added.append(feed_def["name"])

    await db.commit()

    # Trigger background sync for all new sources
    async def _sync_all_new():
        from db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as bg_db:
            new_sources = (await bg_db.execute(
                select(FeedSource).where(
                    FeedSource.user_id == user_id,
                    FeedSource.category == pack["label"],
                    FeedSource.last_fetched_at.is_(None),
                )
            )).scalars().all()
            for src in new_sources:
                try:
                    await _do_sync_source(src, bg_db)
                except Exception as e:
                    log.warning("Preset sync failed for %s: %s", src.name, e)

    background_tasks.add_task(_sync_all_new)
    return {"added": added, "total": len(added)}


# ── Feed refresh interval ──────────────────────────────────────────────────────

class FeedRefreshIntervalOut(BaseModel):
    hours: int

class UpdateFeedRefreshIntervalRequest(BaseModel):
    hours: int


@router.get("/refresh-interval", response_model=FeedRefreshIntervalOut)
async def get_refresh_interval(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    result = await db.execute(
        select(FeedSource.fetch_interval_hours)
        .where(FeedSource.user_id == user_id)
        .limit(1)
    )
    val = result.scalar_one_or_none()
    return {"hours": val if val is not None else 24}


@router.patch("/refresh-interval", response_model=FeedRefreshIntervalOut)
async def update_refresh_interval(
    body: UpdateFeedRefreshIntervalRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    await db.execute(
        sa_update(FeedSource)
        .where(FeedSource.user_id == user_id)
        .values(fetch_interval_hours=body.hours)
    )
    await db.commit()
    return {"hours": body.hours}
