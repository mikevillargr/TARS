"""feed_item_content_fetched

Revision ID: q4r5s6t7u8v9
Revises: p3q4r5s6t7u8
Create Date: 2026-06-23 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "q4r5s6t7u8v9"
down_revision: Union[str, None] = "p3q4r5s6t7u8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "feed_items",
        sa.Column("content_fetched", sa.Boolean(), nullable=False, server_default="false"),
    )
    # Mark items that clearly already have full content (very long) as fetched
    # so we don't re-fetch them unnecessarily.
    op.execute(
        "UPDATE feed_items SET content_fetched = TRUE WHERE LENGTH(content) > 15000"
    )


def downgrade() -> None:
    op.drop_column("feed_items", "content_fetched")
