"""user_domains

Revision ID: i6j7k8l9m0n1
Revises: h5i6j7k8l9m0
Create Date: 2026-06-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i6j7k8l9m0n1'
down_revision: Union[str, None] = 'h5i6j7k8l9m0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default system domains seeded for every user
_SYSTEM_DOMAINS = [
    ("work",     "#3B82F6", 0),
    ("personal", "#8B5CF6", 1),
    ("health",   "#10B981", 2),
    ("cycling",  "#F59E0B", 3),
    ("client",   "#EF4444", 4),
    ("general",  "#6B7280", 5),
]


def upgrade() -> None:
    op.create_table(
        'user_domains',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('color', sa.String(), nullable=False, server_default='#6B7280'),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_domains_user_id', 'user_domains', ['user_id'])

    # Seed defaults for every existing user
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM users")).fetchall()
    import uuid
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for (user_id,) in users:
        for name, color, position in _SYSTEM_DOMAINS:
            conn.execute(sa.text(
                "INSERT INTO user_domains (id, user_id, name, color, is_system, position, created_at) "
                "VALUES (:id, :uid, :name, :color, true, :pos, :now)"
            ), {"id": str(uuid.uuid4()), "uid": user_id, "name": name,
                "color": color, "pos": position, "now": now})


def downgrade() -> None:
    op.drop_index('ix_user_domains_user_id', table_name='user_domains')
    op.drop_table('user_domains')
