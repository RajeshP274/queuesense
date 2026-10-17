import os
import sys
from pathlib import Path

# Isolated in-memory database for tests: an unreachable MONGO_URL makes db.py fall back to mongomock.
os.environ["MONGO_URL"] = "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    import service as S
    from clock import CLOCK
    from db import DB
    for c in DB.list_collection_names():
        DB[c].delete_many({})
    S._EST.clear(), S._CAL.clear(), S.ETA_CACHE.clear(), S.UNDO.clear(), S.VERSION.clear()
    CLOCK.set_speed(1)
    import time
    from datetime import datetime, timezone
    # Fix "now" to a weekday noon IST (06:30 UTC) so opening hours never interfere.
    CLOCK.set_virtual(datetime(2026, 10, 14, 6, 30, tzinfo=timezone.utc).timestamp())
    yield


ALL_DAY = [{"weekday": d, "open": "00:00", "close": "23:59"} for d in range(7)]
