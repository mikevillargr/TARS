"""
One-time backfill: move binary artifact payloads out of the `content` Text
column ("base64:"-prefixed strings) into the disk blob store.

Run from /opt/tars/apps/harness:
    python3 scripts/backfill_artifact_blobs.py          # or: python3 -m scripts.backfill_artifact_blobs

For each affected row: decode the payload, write it to the blob store, set
storage_path, and NULL out content. Commits in batches of 50. Safe to re-run —
only rows that still hold a base64 payload with no storage_path are touched.
"""
import asyncio
import argparse
import base64
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

sys.path.insert(0, ".")

BATCH_SIZE = 50


async def main(dry_run: bool) -> None:
    from sqlalchemy import select

    from core import blob_store
    from db.models import Artifact
    from db.session import AsyncSessionLocal

    migrated = 0
    failed_ids: set[str] = set()

    async with AsyncSessionLocal() as db:
        while True:
            q = (
                select(Artifact)
                .where(Artifact.content.like("base64:%"), Artifact.storage_path.is_(None))
                .order_by(Artifact.created_at, Artifact.id)
                .limit(BATCH_SIZE)
            )
            if failed_ids:
                q = q.where(Artifact.id.notin_(failed_ids))
            rows = (await db.execute(q)).scalars().all()
            if not rows:
                break

            for art in rows:
                try:
                    raw = base64.b64decode(art.content[7:])
                    ext = art.filename.rsplit(".", 1)[-1].lower() if "." in (art.filename or "") else "bin"
                    if not dry_run:
                        art.storage_path = blob_store.store(raw, ext, art.user_id)
                        art.content = None
                    migrated += 1
                    log.info("%s%s (%.1f KB)", "[dry-run] " if dry_run else "", art.filename, len(raw) / 1024)
                except Exception as exc:  # noqa: BLE001 — one bad row must not stop the rest
                    log.warning("artifact %s (%s) failed: %s", art.id, art.filename, exc)
                    failed_ids.add(art.id)

            if dry_run:
                # Rows are not actually migrated, so the same batch would be
                # re-selected forever. One batch is enough to gauge scope.
                break
            await db.commit()
            log.info("Committed batch — %d migrated so far", migrated)

    log.info(
        "Done. %d artifact(s) %s, %d failed.",
        migrated,
        "would be migrated (dry-run)" if dry_run else "migrated",
        len(failed_ids),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run))
