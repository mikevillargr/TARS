"""task_checklist_columns

Revision ID: h5i6j7k8l9m0
Revises: f3g4h5i6j7k8
Create Date: 2026-06-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h5i6j7k8l9m0'
down_revision: Union[str, None] = 'f3g4h5i6j7k8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('checklist', sa.JSON(), nullable=False, server_default='[]'))

    op.create_table(
        'task_columns',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('color', sa.String(), nullable=False, server_default='var(--c-ink-muted)'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_task_columns_user_id', 'task_columns', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_task_columns_user_id', table_name='task_columns')
    op.drop_table('task_columns')
    op.drop_column('tasks', 'checklist')
