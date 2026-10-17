"""Notification layer (spec 12). A provider interface with a MockProvider that only logs.
Real SMS/WhatsApp providers can implement NotificationProvider later; nothing paid is called here."""
import logging

import config as C
from clock import iso, now, seconds_between
from db import DB, new_id

log = logging.getLogger("queuesense.notify")

TEMPLATES = {
    "JOINED": {"en": "You're in the queue at {venue}. Ticket {code}. Estimated wait: {eta}.",
               "hi": "आप {venue} की कतार में हैं। टिकट {code}। अनुमानित प्रतीक्षा: {eta}।",
               "gu": "તમે {venue} ની કતારમાં છો. ટિકિટ {code}. અંદાજિત રાહ: {eta}."},
    "POSITION_3": {"en": "{code}: 3 people ahead of you. Please head over.",
                   "hi": "{code}: आपके आगे 3 लोग हैं। कृपया पहुँचें।",
                   "gu": "{code}: તમારી આગળ 3 લોકો છે. કૃપા કરીને પહોંચો."},
    "POSITION_1": {"en": "{code}: you're next!", "hi": "{code}: अगली बारी आपकी है!", "gu": "{code}: હવે તમારો વારો છે!"},
    "CALLED": {"en": "{code}: it's your turn. Go to {resource}.", "hi": "{code}: आपकी बारी है। {resource} पर जाएँ।",
               "gu": "{code}: તમારો વારો છે. {resource} પર જાઓ."},
    "DELAYED": {"en": "{code}: the wait has grown to about {eta}. {reason}", "hi": "{code}: प्रतीक्षा लगभग {eta} हो गई है। {reason}",
                "gu": "{code}: રાહ અંદાજે {eta} થઈ ગઈ છે. {reason}"},
    "REMINDER_30": {"en": "Reminder: your {venue} booking {code} is at {slot}.", "hi": "याद दिलाना: {venue} में आपकी बुकिंग {code} {slot} पर है।",
                    "gu": "યાદ અપાવીએ: {venue} માં તમારી બુકિંગ {code} {slot} વાગ્યે છે."},
    "REMINDER_10": {"en": "{code}: your slot at {slot} starts in 10 minutes. Check in when you arrive.",
                    "hi": "{code}: आपका स्लॉट {slot} 10 मिनट में है। पहुँचकर चेक-इन करें।",
                    "gu": "{code}: તમારો સ્લોટ {slot} 10 મિનિટમાં છે. પહોંચીને ચેક-ઇન કરો."},
    "NO_SHOW_WARNING": {"en": "{code}: we called you but you didn't arrive. You've been moved back; next time counts as a no-show.",
                        "hi": "{code}: आपको बुलाया गया पर आप नहीं आए। आपको पीछे किया गया है।",
                        "gu": "{code}: તમને બોલાવ્યા પણ તમે આવ્યા નહીં. તમને પાછળ મૂક્યા છે."},
    "CANCELLED": {"en": "{code}: your ticket was cancelled.", "hi": "{code}: आपका टिकट रद्द हुआ।", "gu": "{code}: તમારી ટિકિટ રદ થઈ."},
    "BOOKING_CONFIRMED": {"en": "Booked: {venue} at {slot}. Code {code}.", "hi": "बुक हुआ: {venue}, {slot}। कोड {code}।",
                          "gu": "બુક થયું: {venue}, {slot}. કોડ {code}."},
}
URGENT = {"CALLED"}


class NotificationProvider:
    channel = "base"

    def send(self, ticket: dict, template: str, text: str) -> str:
        raise NotImplementedError


class MockProvider(NotificationProvider):
    """Mock SMS: logs to console and notifications_log. Never logs a full phone number."""
    channel = "mock_sms"

    def send(self, ticket, template, text):
        to = f"******{ticket['phone_last4']}" if ticket.get("phone_last4") else "(no phone)"
        log.info("[MOCK SMS] to %s | %s", to, text)
        return "sent_mock"


PROVIDER: NotificationProvider = MockProvider()


def notify(ticket: dict, template: str, **params) -> bool:
    """Send one notification (in-app always; mock SMS if the ticket has a phone). Throttled except CALLED."""
    t = now()
    last = ticket.get("last_notice_at")
    if template not in URGENT and last and seconds_between(last, t) < C.NOTIFY_THROTTLE_SECONDS:
        return False
    lang = ticket.get("lang") or "en"
    tpl = TEMPLATES[template].get(lang) or TEMPLATES[template]["en"]
    text = tpl.format(code=ticket["code"], **{k: ("" if v is None else v) for k, v in params.items()}).strip()
    status = PROVIDER.send(ticket, template, text) if ticket.get("phone_hash") else "in_app_only"
    DB.notifications_log.insert_one({"_id": new_id("n"), "ticket_id": ticket["_id"], "channel": PROVIDER.channel,
                                     "template": template, "status": status, "ts": t})
    notice = {"template": template, "text": text, "ts": iso(t)}
    DB.tickets.update_one({"_id": ticket["_id"]}, {"$push": {"notices": {"$each": [notice], "$position": 0, "$slice": 5}},
                                                   "$set": {"last_notice_at": t}})
    ticket["last_notice_at"] = t
    ticket["notices"] = ([notice] + ticket.get("notices", []))[:5]
    return True
