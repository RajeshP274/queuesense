"""The server clock. Server time is the only clock that matters (spec rule 10).

All timers (call timeouts, grace windows, dwell alerts) read this clock. It is plain UTC wall time; tests can
set or advance it to check timer behaviour."""
import threading
import time
from datetime import datetime, timedelta, timezone

from config import TZ_OFFSET_MIN, DEFAULT_TIMEZONE


class Clock:
    def __init__(self):
        self._lock = threading.Lock()
        self._base_real = time.time()
        self._base_virtual = self._base_real
        self.speed = 1.0

    def ts(self) -> float:
        with self._lock:
            return self._base_virtual + (time.time() - self._base_real) * self.speed

    def now(self) -> datetime:
        return datetime.fromtimestamp(self.ts(), tz=timezone.utc)

    def set_speed(self, speed: float):
        with self._lock:
            v = self._base_virtual + (time.time() - self._base_real) * self.speed
            self._base_real, self._base_virtual, self.speed = time.time(), v, float(speed)

    def set_virtual(self, ts: float):
        """Used only by the startup seeder to replay recent history."""
        with self._lock:
            self._base_real, self._base_virtual = time.time(), ts

    def advance(self, seconds: float):
        with self._lock:
            self._base_virtual += seconds


CLOCK = Clock()


def now() -> datetime:
    return CLOCK.now()


def iso(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def aware(dt):
    """Mongo returns naive UTC datetimes; make them timezone-aware."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def local(dt, tz_name=DEFAULT_TIMEZONE) -> datetime:
    return aware(dt).astimezone(timezone(timedelta(minutes=TZ_OFFSET_MIN.get(tz_name, 330))))


def seconds_between(a, b) -> float:
    return (aware(b) - aware(a)).total_seconds()
