"""MongoDB access. Uses a real MongoDB at MONGO_URL; if none is reachable, falls back to an in-memory
mongomock database so the app always starts with zero setup (data then lives only while the server runs)."""
import logging
import uuid

import pymongo
from pymongo import ASCENDING, ReturnDocument

from config import DB_NAME, MONGO_TIMEOUT_MS, MONGO_URL

log = logging.getLogger("queuesense.db")


class Conflict(Exception):
    """Optimistic concurrency: the document changed since it was read."""

    def __init__(self, fresh):
        self.fresh = fresh


def _connect():
    try:
        client = pymongo.MongoClient(MONGO_URL, serverSelectionTimeoutMS=MONGO_TIMEOUT_MS, tz_aware=True)
        client.admin.command("ping")
        log.info("Connected to MongoDB at %s", MONGO_URL)
        return client[DB_NAME], "mongodb"
    except Exception as e:  # noqa: BLE001 - any failure means "no server"
        import mongomock
        log.warning("MongoDB not reachable (%s). Using in-memory mongomock - data resets on restart.", type(e).__name__)
        return mongomock.MongoClient(tz_aware=True)[DB_NAME], "mongomock"


DB, BACKEND = _connect()


def ensure_indexes():
    DB.venues.create_index([("slug", ASCENDING)], unique=True)
    DB.resources.create_index([("venue_id", ASCENDING), ("status", ASCENDING)])
    DB.tickets.create_index([("venue_id", ASCENDING), ("status", ASCENDING)])
    DB.tickets.create_index([("venue_id", ASCENDING), ("phone_hash", ASCENDING)])
    DB.tickets.create_index([("code", ASCENDING)], unique=True)
    DB.events.create_index([("venue_id", ASCENDING), ("ts", ASCENDING)])
    DB.events.create_index([("venue_id", ASCENDING), ("idempotency_key", ASCENDING)], unique=True,
                           partialFilterExpression={"idempotency_key": {"$type": "string"}})
    DB.estimator_state.create_index([("venue_id", ASCENDING), ("queue_key", ASCENDING)], unique=True)
    DB.staff_users.create_index([("venue_id", ASCENDING)])
    DB.idempotency.create_index([("key", ASCENDING)], unique=True)
    DB.operators.create_index([("email", ASCENDING)], unique=True)
    DB.venues.create_index([("owner_id", ASCENDING)])


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def update_versioned(coll, doc: dict, changes: dict):
    """Write `changes` only if the version is unchanged; bump version. Raises Conflict otherwise."""
    fresh = DB[coll].find_one_and_update(
        {"_id": doc["_id"], "version": doc.get("version", 0)},
        {"$set": changes, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER)
    if fresh is None:
        raise Conflict(DB[coll].find_one({"_id": doc["_id"]}))
    doc.update(fresh)
    return fresh
