"""artifact_storage_path

Revision ID: 5be03b800395
Revises: s6t7u8v9w0x1
Create Date: 2026-09-13 23:21:37.805262

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '5be03b800395'
down_revision: Union[str, None] = 's6t7u8v9w0x1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('artifacts', sa.Column('storage_path', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('artifacts', 'storage_path')
