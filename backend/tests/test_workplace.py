"""Operator accounts + workplace creation -> two websites + themed venue."""
from fastapi.testclient import TestClient


def _signup(c, email="owner@example.com"):
    r = c.post("/api/operators/signup", json={"name": "Asha Rao", "email": email, "password": "secret123"}).json()
    return {"Authorization": f"Bearer {r['token']}"}


def test_operator_signup_signin_and_errors():
    import main
    with TestClient(main.app) as c:
        h = _signup(c)
        assert c.get("/api/operators/me", headers=h).json()["operator"]["email"] == "owner@example.com"
        dup = c.post("/api/operators/signup", json={"name": "Xavier", "email": "OWNER@example.com", "password": "secret123"})
        assert dup.status_code == 409 and dup.json()["error"]["code"] == "EMAIL_TAKEN"
        assert c.post("/api/operators/signin", json={"email": "owner@example.com", "password": "secret123"}).status_code == 200
        bad = c.post("/api/operators/signin", json={"email": "owner@example.com", "password": "wrongpass"})
        assert bad.status_code == 401 and bad.json()["error"]["code"] == "WRONG_LOGIN"
        short = c.post("/api/operators/signup", json={"name": "Y", "email": "y@example.com", "password": "123"})
        assert short.status_code == 422
        assert c.get("/api/operators/me").status_code == 401


def test_create_workplace_requires_operator_and_is_owned():
    import main
    with TestClient(main.app) as c:
        anon = c.post("/api/admin/venues", json={"name": "Spice Garden", "template": "restaurant"})
        assert anon.status_code == 401
        h = _signup(c)
        r = c.post("/api/admin/venues", headers=h, json={"name": "Spice Garden", "template": "restaurant",
                                                          "theme": {"preset": "restaurant", "font": "elegant", "accent": "#123456"},
                                                          "staff_pin": "4321", "admin_pin": "8765"}).json()
        assert r["venue"]["slug"] == "spice-garden"
        assert r["venue"]["theme"]["primary"] == "#B9472A" and r["venue"]["theme"]["accent"] == "#123456"
        assert r["links"]["customer"].endswith("/v/spice-garden") and r["links"]["operator"].endswith("/op/spice-garden")
        me = c.get("/api/operators/me", headers=h).json()
        assert [w["slug"] for w in me["workplaces"]] == ["spice-garden"]
        sess = c.post("/api/operators/workplaces/spice-garden/session", headers=h).json()
        ah = {"Authorization": f"Bearer {sess['token']}"}
        assert c.get("/api/admin/venues/spice-garden", headers=ah).status_code == 200
        other = _signup(c, "someone@example.com")
        assert c.post("/api/operators/workplaces/spice-garden/session", headers=other).status_code == 403
        assert c.post("/api/auth/login", json={"slug": "spice-garden", "pin": "8765"}).json()["role"] == "ADMIN"
        assert c.post("/api/auth/login", json={"slug": "spice-garden", "pin": "4321"}).json()["role"] == "STAFF"
        p = c.patch("/api/admin/venues/spice-garden", json={"theme": {"preset": "forest", "font": "classic"}}, headers=ah).json()
        assert p["theme"]["preset"] == "forest" and p["theme"]["emoji"] == "🍽️"
        again = c.post("/api/admin/venues", headers=h, json={"name": "Spice Garden", "template": "restaurant"}).json()
        assert again["venue"]["slug"] == "spice-garden-2"
        bad = c.post("/api/admin/venues", headers=h, json={"name": "X Y", "template": "restaurant", "staff_pin": "1111", "admin_pin": "1111"})
        assert bad.status_code == 409
