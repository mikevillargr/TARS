"""feed_reader

Revision ID: p3q4r5s6t7u8
Revises: o2p3q4r5s6t7
Create Date: 2026-06-23 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'p3q4r5s6t7u8'
down_revision: Union[str, None] = 'o2p3q4r5s6t7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'feed_sources',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('original_url', sa.String(), nullable=True),
        sa.Column('source_type', sa.String(), nullable=False, server_default='rss'),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('favicon_url', sa.String(), nullable=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('fetch_interval_hours', sa.Integer(), nullable=False, server_default='4'),
        sa.Column('last_fetched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_feed_sources_user_id', 'feed_sources', ['user_id'])
    op.create_index('ix_feed_sources_category', 'feed_sources', ['category'])

    op.create_table(
        'feed_items',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('feed_source_id', sa.String(), sa.ForeignKey('feed_sources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('author', sa.String(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('image_url', sa.String(), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('media_type', sa.String(), nullable=False, server_default='article'),
        sa.Column('media_url', sa.String(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_starred', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('knowledge_item_id', sa.String(), sa.ForeignKey('knowledge_items.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_feed_items_feed_source_id', 'feed_items', ['feed_source_id'])
    op.create_index('ix_feed_items_user_id', 'feed_items', ['user_id'])
    op.create_index('ix_feed_items_url', 'feed_items', ['url'])


def downgrade() -> None:
    op.drop_index('ix_feed_items_url', table_name='feed_items')
    op.drop_index('ix_feed_items_user_id', table_name='feed_items')
    op.drop_index('ix_feed_items_feed_source_id', table_name='feed_items')
    op.drop_table('feed_items')
    op.drop_index('ix_feed_sources_category', table_name='feed_sources')
    op.drop_index('ix_feed_sources_user_id', table_name='feed_sources')
    op.drop_table('feed_sources')
