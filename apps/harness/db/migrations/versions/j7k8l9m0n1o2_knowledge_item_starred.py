"""knowledge_item starred

Revision ID: j7k8l9m0n1o2
Revises: i6j7k8l9m0n1
Create Date: 2026-06-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j7k8l9m0n1o2'
down_revision: Union[str, None] = 'i6j7k8l9m0n1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'knowledge_items',
        sa.Column('starred', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('knowledge_items', 'starred')
