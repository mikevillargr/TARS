"""prompt_cron_fields and drop email_digests

Revision ID: f3g4h5i6j7k8
Revises: e2f3g4h5i6j7
Create Date: 2026-06-03 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision: str = 'f3g4h5i6j7k8'
down_revision = 'b44136b7d629'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop email_digests table
    op.drop_table('email_digests')

    # Add prompt cron fields to cron_jobs
    op.add_column('cron_jobs', sa.Column('type', sa.String(), nullable=False, server_default='connector'))
    op.add_column('cron_jobs', sa.Column('prompt_text', sa.Text(), nullable=True))
    op.add_column('cron_jobs', sa.Column('schedule_config', sa.JSON(), nullable=True))
    op.add_column('cron_jobs', sa.Column('timezone', sa.String(), nullable=False, server_default='Asia/Manila'))
    op.add_column('cron_jobs', sa.Column('last_output', sa.Text(), nullable=True))
    op.add_column('cron_jobs', sa.Column('output_conversation_id', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('cron_jobs', 'output_conversation_id')
    op.drop_column('cron_jobs', 'last_output')
    op.drop_column('cron_jobs', 'timezone')
    op.drop_column('cron_jobs', 'schedule_config')
    op.drop_column('cron_jobs', 'prompt_text')
    op.drop_column('cron_jobs', 'type')

    op.create_table(
        'email_digests',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('action_items', sa.JSON(), nullable=True),
        sa.Column('raw_thread_ids', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    )
