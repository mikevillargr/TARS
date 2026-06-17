"""universal links table

Revision ID: k8l9m0n1o2p3
Revises: j7k8l9m0n1o2
Create Date: 2026-06-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k8l9m0n1o2p3'
down_revision: Union[str, None] = 'j7k8l9m0n1o2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'links',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('source_type', sa.String(), nullable=False),
        sa.Column('source_id', sa.String(), nullable=False),
        sa.Column('target_type', sa.String(), nullable=False),
        sa.Column('target_id', sa.String(), nullable=False),
        sa.Column('relationship', sa.String(), nullable=False, server_default='mentions'),
        sa.Column('context', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_links_source', 'links', ['user_id', 'source_type', 'source_id'])
    op.create_index('idx_links_target', 'links', ['user_id', 'target_type', 'target_id'])
    op.create_unique_constraint(
        'uq_links',
        'links',
        ['user_id', 'source_type', 'source_id', 'target_type', 'target_id', 'relationship'],
    )


def downgrade() -> None:
    op.drop_table('links')
