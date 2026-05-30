"""add tool_results column to messages

Revision ID: e2f3g4h5i6j7
Revises: d1e2f3g4h5i6
Create Date: 2026-05-30 06:00:00.000000

Adds a JSON column for storing structured tool result payloads
(place_card, contact_card, calendar_suggest, task_suggest, artifact_created)
so they can be rehydrated when reloading a conversation.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2f3g4h5i6j7'
down_revision: Union[str, None] = 'd1e2f3g4h5i6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'messages',
        sa.Column('tool_results', sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
    )


def downgrade() -> None:
    op.drop_column('messages', 'tool_results')
