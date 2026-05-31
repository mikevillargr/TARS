"""google_people_contacts

Revision ID: c4d5e6f7g8h9
Revises: a1b2c3d4e5f6
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7g8h9'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── contacts ────────────────────────────────────────────────────────────
    op.create_table(
        'contacts',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('google_resource_name', sa.String(), nullable=False, unique=True),
        sa.Column('etag', sa.String(), nullable=True),
        sa.Column('display_name', sa.String(), nullable=True),
        sa.Column('primary_email', sa.String(), nullable=True),
        sa.Column('primary_phone', sa.String(), nullable=True),
        sa.Column('organization', sa.String(), nullable=True),
        sa.Column('job_title', sa.String(), nullable=True),
        sa.Column('biography', sa.Text(), nullable=True),
        sa.Column('tars_context', sa.Text(), nullable=True),
        sa.Column('emails', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('phones', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('sources', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('events_json', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('is_directory', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('is_other_contact', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_contacts_user_id', 'contacts', ['user_id'])
    op.create_index('ix_contacts_google_resource_name', 'contacts', ['google_resource_name'])
    op.create_index('ix_contacts_display_name', 'contacts', ['display_name'])
    op.create_index('ix_contacts_primary_email', 'contacts', ['primary_email'])

    # ── pending_contacts ────────────────────────────────────────────────────
    op.create_table(
        'pending_contacts',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('detected_name', sa.String(), nullable=True),
        sa.Column('detected_email', sa.String(), nullable=False),
        sa.Column('detected_phone', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('source_id', sa.String(), nullable=True),
        sa.Column('extracted_context', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_pending_contacts_detected_email', 'pending_contacts', ['detected_email'])
    # prevent duplicate enqueue of same (user, email) while still pending
    op.create_index(
        'uq_pending_contacts_user_email_pending',
        'pending_contacts',
        ['user_id', 'detected_email'],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    # ── contact_sync_state ──────────────────────────────────────────────────
    op.create_table(
        'contact_sync_state',
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('sync_token', sa.Text(), nullable=True),
        sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table('contact_sync_state')
    op.drop_index('uq_pending_contacts_user_email_pending', table_name='pending_contacts')
    op.drop_index('ix_pending_contacts_detected_email', table_name='pending_contacts')
    op.drop_table('pending_contacts')
    op.drop_index('ix_contacts_primary_email', table_name='contacts')
    op.drop_index('ix_contacts_display_name', table_name='contacts')
    op.drop_index('ix_contacts_google_resource_name', table_name='contacts')
    op.drop_index('ix_contacts_user_id', table_name='contacts')
    op.drop_table('contacts')
