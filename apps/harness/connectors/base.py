from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ConnectorStatus:
    id: str                    # slug: "fireflies", "gmail", "gcal"
    name: str                  # display name
    status: str                # "connected" | "disconnected" | "error"
    capabilities: List[str]    # ["read", "webhook"]
    last_synced_at: Optional[str] = None
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)
