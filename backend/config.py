"""Every tunable number lives here (spec rule 8). Business logic imports these; no magic numbers there."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

# --- storage -------------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
DB_NAME = os.environ.get("DB_NAME", "queuesense")
MONGO_TIMEOUT_MS = 1500          # how long to wait for a real MongoDB before falling back to in-memory


def _secret(name: str) -> str:
    """Stable per-install secret stored next to the code (JWT signing key, phone-hash pepper)."""
    if os.environ.get(name):
        return os.environ[name]
    path = BASE_DIR / f".{name.lower()}"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip()


JWT_SECRET = _secret("JWT_SECRET")
PHONE_PEPPER = _secret("PHONE_PEPPER")
JWT_HOURS = 12
DEFAULT_COUNTRY_CODE = "+91"
DEFAULT_TIMEZONE = "Asia/Kolkata"
TZ_OFFSET_MIN = {"Asia/Kolkata": 330}   # fixed offsets avoid needing tzdata on Windows

# --- estimator (spec 6) ----------------------------------------------------------------------
EW_ALPHA = 0.1                   # exponentially weighted mean/variance smoothing
PRIOR_K = 4                      # template prior counts as 4 samples
N_EFF_CAP = 30                   # data weight stops growing after 30 samples
BUCKET_MINUTES = 30              # time-of-day buckets
BUCKET_MIN_N = 6                 # a bucket needs 6 samples before it corrects the mean
BUCKET_WEIGHT = 0.6              # mu_final = 0.6 * bucket_median + 0.4 * mu_hat
BUCKET_KEEP = 30                 # samples kept per bucket for the median
RECENT_KEEP = 100                # recent samples kept for p90 / outlier checks
SIGMA_FLOOR = 0.25               # sigma >= 0.25 * mu
COLD_START_N = 3                 # below this, sigma comes from the prior cv
REJECT_MIN_SECONDS = 15
REJECT_PRIOR_MULT = 4            # while n < 10: reject d > 4 x prior mean
REJECT_P90_MULT = 3              # once n >= 10: reject d > 3 x p90
REJECT_SWITCH_N = 10
IMPLICIT_WEIGHT = 0.5            # single-tap flow: start time is inferred, so the sample counts half
MC_RUNS = 400
MC_MAX_AHEAD = 60                # very long queues: simulate 60 ahead, extrapolate the rest
MC_COND_TRIES = 20               # rejection sampling tries for "remaining time of a busy resource"
ETA_CACHE_SECONDS = 5
FALLBACK_RANGE = 0.35            # analytic fallback range +/- 35%
CONF_HIGH_N = 15
CONF_HIGH_CV = 0.6
CONF_MEDIUM_N = 5
HYSTERESIS_MIN_SECONDS = 60      # shown estimate changes only if it moves >= max(1 min, 10%)
HYSTERESIS_FRACTION = 0.10
RISE_REASON_SECONDS = 180        # explain rises of 3 min or more
ALMOST_TURN_SECONDS = 60
TIGHT_RANGE_SECONDS = 120        # p80 - p20 < 2 min -> show "~N min"
SIGMA_SCALE_MIN, SIGMA_SCALE_MAX = 0.8, 1.6
CALIBRATE_EVERY = 20
COVERAGE_LOW, COVERAGE_HIGH = 0.50, 0.75
SCALE_UP, SCALE_DOWN = 1.1, 0.92
CALIB_KEEP = 200                 # rolling window of (predicted, actual) pairs
COVERAGE_TOLERANCE_SECONDS = 60  # estimates are shown in whole minutes, so "inside the range" allows 1 min
MAPE_MIN_SECONDS = 60
ACCURATE_WITHIN_SECONDS = 180    # "within 3 minutes X% of the time"
PARTY_BUCKETS = [(1, 2, "1-2"), (3, 4, "3-4"), (5, 99, "5+")]

# --- assignment (spec 7) ---------------------------------------------------------------------
PREBOOK_EARLY_MINUTES = 5        # checked-in bookings due within 5 min jump to rule 2
TABLE_RELAX_MINUTES = 10         # after 10 min any larger table is allowed
SKIP_LOOKAHEAD = 3
MAX_SKIPS = 2
MISSED_CALL_PUSHBACK = 3         # missed call: 3 people go ahead
SNOOZE_STEP = 2
MAX_SNOOZES = 2
SELF_RELEASE_CONFIRM_SECONDS = 60
UNDO_WINDOW_SECONDS = 120
UNDO_MAX = 10
PREBOOK_FREE_CANCEL_MINUTES = 15
REMINDERS_MINUTES = (30, 10)
DEFAULT_SETTINGS = {
    "call_mode": "staff_tap",
    "grace_minutes_prebook": 10,
    "checkin_window_minutes": 15,
    "max_active_tickets_per_phone": 1,
    "call_timeout_seconds": 120,
    "prebook_slot_minutes": 15,
    "prebook_max_advance_days": 2,
    "prebook_capacity_cap": 0.5,
    "priority_enabled": True,
    "starvation_limit_minutes": 60,
    "max_consecutive_priority": 3,
    "max_table_oversize": 2,
    "max_dwell_minutes": 45,
    "self_release_enabled": True,
    "show_rate_default": 0.85,
    "default_language": "en",
    "time_format": "12h",
}
SLOT_GREEN_UTIL, SLOT_AMBER_UTIL = 0.6, 0.9

# --- workplace themes (v2) -------------------------------------------------------------------
# Primary colours are dark enough for white button text (WCAG AA, >= 4.5:1).
THEMES = {
    "restaurant": {"name": "Restaurant", "primary": "#B9472A", "accent": "#E9A23B", "bg": "#FBF7F2",
                   "font": "elegant", "emoji": "🍽️", "description": "Warm terracotta with elegant serif headings"},
    "canteen": {"name": "Canteen", "primary": "#C2410C", "accent": "#2F9E44", "bg": "#FFF8F1",
                "font": "friendly", "emoji": "🍛", "description": "Bright, friendly orange"},
    "hospital": {"name": "Hospital", "primary": "#0B7A70", "accent": "#2F80ED", "bg": "#F3FAF9",
                 "font": "clean", "emoji": "🏥", "description": "Calm teal, easy to read under stress"},
    "admin_office": {"name": "Office", "primary": "#1F5FD6", "accent": "#7A5AF8", "bg": "#F5F7FB",
                     "font": "modern", "emoji": "🏛️", "description": "Trustworthy blue, clean and formal"},
    "custom": {"name": "Violet", "primary": "#6D48E5", "accent": "#EC4899", "bg": "#F8F7FD",
               "font": "modern", "emoji": "✨", "description": "Modern violet"},
    "forest": {"name": "Forest", "primary": "#2F6B3A", "accent": "#C9A227", "bg": "#F5F8F3",
               "font": "classic", "emoji": "🌿", "description": "Natural greens, classic serif"},
    "midnight": {"name": "Midnight", "primary": "#1E2A4A", "accent": "#F2B705", "bg": "#F4F5F8",
                 "font": "clean", "emoji": "🌙", "description": "Deep navy with a gold accent"},
}
FONTS = {"modern": {"name": "Modern", "heading": "Inter", "body": "Inter"},
         "friendly": {"name": "Friendly", "heading": "Nunito", "body": "Nunito"},
         "elegant": {"name": "Elegant", "heading": "Playfair Display", "body": "Lato"},
         "clean": {"name": "Clean", "heading": "DM Sans", "body": "DM Sans"},
         "classic": {"name": "Classic", "heading": "Merriweather", "body": "Merriweather"}}
TEMPLATE_THEME = {"restaurant": "restaurant", "canteen": "canteen", "hospital": "hospital",
                  "admin_office": "admin_office", "custom": "custom"}

# --- notifications (spec 12) -----------------------------------------------------------------
NOTIFY_THROTTLE_SECONDS = 60
DELAYED_MIN_SECONDS = 300

# --- security (spec 15) ----------------------------------------------------------------------
OTP_TTL_SECONDS = 300
OTP_MAX_PER_WINDOW, OTP_WINDOW_SECONDS = 3, 600
JOIN_MAX_PER_MINUTE = 5
LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS = 5, 600
CLIENT_TS_CLAMP_SECONDS = 120
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
PHONE_PURGE_HOURS = 24

# --- realtime & loops (spec 10) --------------------------------------------------------------
SSE_HEARTBEAT_SECONDS = 20
ASSIGN_HEARTBEAT_SECONDS = 5
ETA_REFRESH_SECONDS = 30
QUEUE_SAMPLE_SECONDS = 60        # queue-length time series resolution (virtual time)
