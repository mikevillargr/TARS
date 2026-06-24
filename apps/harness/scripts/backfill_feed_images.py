"""
One-time backfill: fetch og:image for feed_items with no image_url.

Run from /opt/tars/apps/harness:
    python3 scripts/backfill_feed_images.py

Processes up to --limit items (default 500), throttled at ~1 req/sec.
Safe to re-run; skips items that already have an image_url.
"""
import asyncio
import logging
import sys
import time
import argparse

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

sys.path.insert(0, ".")


async def main(limit: int, dry_run: bool) -> None:
    from db.session import AsyncSessionLocal
    from db.models import FeedItem
    from sqlalchemy import select, update
    from connectors.feed_reader import _extract_image_from_html, fetch_og_image

    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(FeedItem.id, FeedItem.url, FeedItem.content, FeedItem.media_type)
            .where(
                FeedItem.image_url.is_(None),
                FeedItem.media_type == "article",
            )
            .order_by(FeedItem.published_at.desc().nullslast())
            .limit(limit)
        )).all()

    log.info("Found %d items with no image_url", len(rows))

    updated = 0
    for i, (item_id, url, content, media_type) in enumerate(rows):
        # Try stored HTML content first (fast, no network)
        img = _extract_image_from_html(content) if content else None

        if not img and url:
            log.info("[%d/%d] Fetching og:image for %s", i + 1, len(rows), url[:80])
            img = fetch_og_image(url, timeout=6)
            time.sleep(0.5)  # polite throttle

        if img:
            log.info("  → %s", img[:100])
            if not dry_run:
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(FeedItem)
                        .where(FeedItem.id == item_id)
                        .values(image_url=img)
                    )
                    await db.commit()
            updated += 1
        else:
            log.debug("[%d/%d] No image found for %s", i + 1, len(rows), url[:60])

    log.info("Done. Updated %d / %d items%s.", updated, len(rows), " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.limit, args.dry_run))
