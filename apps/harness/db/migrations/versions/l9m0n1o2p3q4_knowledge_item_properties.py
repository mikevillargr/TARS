"""knowledge_item properties column

Revision ID: l9m0n1o2p3q4
Revises: k8l9m0n1o2p3
Create Date: 2026-06-17 10:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'l9m0n1o2p3q4'
down_revision: Union[str, None] = 'k8l9m0n1o2p3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'knowledge_items',
        sa.Column(
            'properties',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='{}',
        ),
    )


def downgrade() -> None:
    op.drop_column('knowledge_items', 'properties')
