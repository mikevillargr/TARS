"""signal context_label

Revision ID: s6t7u8v9w0x1
Revises: r5s6t7u8v9w0
Create Date: 2026-09-08 00:00:00.000000

Adds a dedicated context_label column to signals — a resolved client name or,
for email with no client match, a coarse category ("Billing", "Legal", ...).
Previously baked into source_label/title as text; split out so the frontend
can render it as its own chip and titles stay clean imperatives.

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "s6t7u8v9w0x1"
down_revision: Union[str, None] = "r5s6t7u8v9w0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("signals", sa.Column("context_label", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("signals", "context_label")
