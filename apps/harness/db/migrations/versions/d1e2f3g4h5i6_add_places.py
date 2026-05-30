"""add_places

Revision ID: d1e2f3g4h5i6
Revises: c4d5e6f7g8h9
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1e2f3g4h5i6'
down_revision: Union[str, None] = 'c4d5e6f7g8h9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'places',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('address', sa.String(), nullable=True),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('osm_id', sa.String(), nullable=True),
        sa.Column('osm_type', sa.String(), nullable=True),
        sa.Column('google_place_id', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default='osm'),
        sa.Column('visited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_saved', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_places_user_id', 'places', ['user_id'])
    op.create_index('ix_places_name', 'places', ['name'])
    op.create_index('ix_places_category', 'places', ['category'])
    op.create_index('ix_places_is_saved', 'places', ['is_saved'])


def downgrade() -> None:
    op.drop_index('ix_places_is_saved', table_name='places')
    op.drop_index('ix_places_category', table_name='places')
    op.drop_index('ix_places_name', table_name='places')
    op.drop_index('ix_places_user_id', table_name='places')
    op.drop_table('places')
