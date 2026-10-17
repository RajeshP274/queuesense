"""Venue creation from templates (spec 5). Differences between venue types are data, not code."""
import json
import re
import string

import config as C
from auth import hash_pin
from clock import now
from db import DB, new_id


def templates():
    out = {}
    for p in sorted(C.TEMPLATE_DIR.glob("*.json")):
        t = json.loads(p.read_text(encoding="utf-8"))
        out[t["id"]] = t
    return out


TEMPLATE_PREFIX = {"canteen": "C", "hospital": "H", "admin_office": "A", "restaurant": "R"}


def _prefix(name, template_id=None):
    used = {v.get("code_prefix") for v in DB.venues.find({}, {"code_prefix": 1})}
    first = TEMPLATE_PREFIX.get(template_id) or (name.strip()[:1] or "Q").upper()
    if first.isalpha() and first not in used:
        return first
    for a in string.ascii_uppercase:
        for b in string.ascii_uppercase:
            if first + b not in used and (first + b).isalpha():
                return first + b
    return new_id("")[-3:].upper()


HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def make_slug(name):
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "workplace"
    slug, n = base, 2
    while DB.venues.find_one({"slug": slug}):
        slug, n = f"{base}-{n}", n + 1
    return slug


def clean_theme(theme, template_id):
    """Store only the preset id plus validated overrides; venue_view resolves the full theme."""
    theme = dict(theme or {})
    preset = theme.get("preset") if theme.get("preset") in C.THEMES else C.TEMPLATE_THEME.get(template_id, "custom")
    out = {"preset": preset}
    for k in ("primary", "accent", "bg"):
        if theme.get(k) and HEX.match(str(theme[k])):
            out[k] = theme[k]
    if theme.get("font") in C.FONTS:
        out["font"] = theme["font"]
    if theme.get("emoji") and len(str(theme["emoji"])) <= 4:
        out["emoji"] = theme["emoji"]
    return out


def resolve_theme(venue):
    t = venue.get("theme") or {"preset": C.TEMPLATE_THEME.get(venue.get("template"), "custom")}
    base = C.THEMES.get(t.get("preset"), C.THEMES["custom"])
    # The icon follows the kind of workplace (a restaurant stays 🍽️ in any colour scheme) unless set explicitly.
    type_emoji = C.THEMES[C.TEMPLATE_THEME.get(venue.get("template"), "custom")]["emoji"]
    return {"preset": t.get("preset"), "name": base["name"], "primary": t.get("primary", base["primary"]),
            "accent": t.get("accent", base["accent"]), "bg": t.get("bg", base["bg"]),
            "font": t.get("font", base["font"]), "emoji": t.get("emoji", type_emoji)}


def create_venue(template_id, name, slug=None, open_hours=None, theme=None, staff_pin=None, admin_pin=None, owner_id=None):
    tpls = templates()
    if template_id not in tpls:
        raise ValueError("unknown template")
    tpl = tpls[template_id]
    slug = slug or make_slug(name)
    if DB.venues.find_one({"slug": slug}):
        raise ValueError("slug already taken")
    for pin in (staff_pin, admin_pin):
        if pin is not None and not re.fullmatch(r"\d{4,6}", str(pin)):
            raise ValueError("PINs must be 4-6 digits")
    if staff_pin and admin_pin and staff_pin == admin_pin:
        raise ValueError("staff and admin PINs must be different")
    vid = new_id("v")
    venue = {"_id": vid, "slug": slug, "name": name, "template": template_id,
             "timezone": tpl.get("timezone", C.DEFAULT_TIMEZONE), "open_hours": open_hours or tpl["open_hours"],
             "created_at": now(), "settings": {**C.DEFAULT_SETTINGS, **tpl.get("settings", {})},
             "arrivals": tpl.get("arrivals", {}), "sample_names": tpl.get("sample_names", []),
             "code_prefix": _prefix(name, template_id), "ticket_counter": 0, "consecutive_priority": 0,
             "theme": clean_theme(theme, template_id), "owner_id": owner_id}
    DB.venues.insert_one(venue)
    keys = {}
    for st in tpl["service_types"]:
        sid = new_id("st")
        keys[st["key"]] = sid
        DB.service_types.insert_one({"_id": sid, "venue_id": vid, "key": st["key"], "name": st["name"],
                                     "prior_mean_seconds": st["prior_mean_seconds"], "prior_cv": st["prior_cv"],
                                     "color": st.get("color", "#1F6FEB"), "allows_priority": st.get("allows_priority", False),
                                     "resource_kind": st["resource_kind"]})
    for i, r in enumerate(tpl["resources"]):
        DB.resources.insert_one({"_id": new_id("r"), "venue_id": vid, "kind": r["kind"], "label": r["label"],
                                 "capacity": r["capacity"], "service_type_ids": [keys[k] for k in r["service_keys"]],
                                 "status": "OPEN", "current_ticket_id": None, "held_for_ticket_id": None,
                                 "held_until": None, "status_changed_at": now(), "version": 0, "order": i,
                                 "paused": False, "pending_release": False})
    staff_pin, admin_pin = staff_pin or tpl.get("staff_pin", "1234"), admin_pin or tpl.get("admin_pin", "0000")
    DB.staff_users.insert_one({"_id": new_id("u"), "venue_id": vid, "name": "Front desk", "role": "STAFF", "pin_hash": hash_pin(staff_pin)})
    DB.staff_users.insert_one({"_id": new_id("u"), "venue_id": vid, "name": "Manager", "role": "ADMIN", "pin_hash": hash_pin(admin_pin)})
    return DB.venues.find_one({"_id": vid}), staff_pin, admin_pin
