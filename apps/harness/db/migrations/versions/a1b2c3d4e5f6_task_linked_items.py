"""task_linked_items

Revision ID: a1b2c3d4e5f6
Revises: 43bfcfd9fc19
Create Date: 2026-05-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '43bfcfd9fc19'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('linked_artifacts', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('tasks', sa.Column('linked_knowledge', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('tasks', 'linked_knowledge')
    op.drop_column('tasks', 'linked_artifacts')
