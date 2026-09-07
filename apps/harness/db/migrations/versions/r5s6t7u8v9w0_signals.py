"""signals

Revision ID: r5s6t7u8v9w0
Revises: q4r5s6t7u8v9
Create Date: 2026-09-07 00:00:00.000000

Creates the signals table backing the /today screen.

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "r5s6t7u8v9w0"
down_revision: Union[str, None] = "q4r5s6t7u8v9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "signals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="action"),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("source_label", sa.String(), nullable=False),
        sa.Column("source_ref", sa.String(), nullable=True),
        sa.Column("citation", sa.String(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("urgency", sa.String(), nullable=False, server_default="normal"),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("actions", sa.JSON(), nullable=True),
        sa.Column("calendar_event", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acted_kind", sa.String(), nullable=True),
        sa.Column("result_ref", sa.String(), nullable=True),
        sa.Column("dedupe_key", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_signals_user_id", "signals", ["user_id"])
    op.create_index("ix_signals_status", "signals", ["status"])
    op.create_index("ix_signals_dedupe_key", "signals", ["dedupe_key"])
    # Stops a dismissed signal reappearing on the next generator sweep.
    # Repeated NULLs are permitted by Postgres, so sources that can't produce a
    # stable key are unaffected.
    op.create_unique_constraint(
        "uq_signals_user_dedupe", "signals", ["user_id", "dedupe_key"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_signals_user_dedupe", "signals", type_="unique")
    op.drop_index("ix_signals_dedupe_key", table_name="signals")
    op.drop_index("ix_signals_status", table_name="signals")
    op.drop_index("ix_signals_user_id", table_name="signals")
    op.drop_table("signals")
