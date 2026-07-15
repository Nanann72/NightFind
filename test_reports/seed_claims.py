"""
Seed bar claims for Phase 2 UI testing.
- Logs in as emma & lucas
- Creates bar claims on two different clubs
- Prints IDs for cleanup
"""
import os
import requests

BASE = "https://fan-culture-app.preview.emergentagent.com/api"

# 1x1 tiny PNG in base64
PNG_1X1 = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def list_clubs(token: str, search: str = ""):
    r = requests.get(f"{BASE}/clubs", headers={"Authorization": f"Bearer {token}"}, params={"search": search}, timeout=15)
    r.raise_for_status()
    return r.json()


def submit_claim(token: str, club_id: str, owner_name: str, email: str):
    payload = {
        "club_id": club_id,
        "owner_name": owner_name,
        "email": email,
        "phone": "+33612345678",
        "role": "proprietaire",
        "id_document": PNG_1X1,
        "kbis_document": PNG_1X1,
    }
    r = requests.post(
        f"{BASE}/bars/claim",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    print("submit_claim", club_id, "->", r.status_code, r.text[:200])
    return r


def main():
    emma_tok = login("emma.demo@nightfinder.app", "DemoOnly2026!")
    lucas_tok = login("lucas.demo@nightfinder.app", "DemoOnly2026!")
    print("Emma & Lucas logged in")

    clubs = list_clubs(emma_tok)
    # response may be {"clubs":[...]} or list
    if isinstance(clubs, dict):
        clubs = clubs.get("clubs") or clubs.get("results") or []
    print(f"Got {len(clubs)} clubs")
    if len(clubs) < 2:
        raise SystemExit("Need at least 2 clubs")

    club_a = clubs[0]
    club_b = clubs[1]
    print(f"Club A: {club_a.get('name')} ({club_a['club_id']})")
    print(f"Club B: {club_b.get('name')} ({club_b['club_id']})")

    # Emma claims club A
    submit_claim(emma_tok, club_a["club_id"], "Emma Test Owner", "emma.owner+test@example.com")
    # Lucas claims club B (for reject flow)
    submit_claim(lucas_tok, club_b["club_id"], "Lucas Test Owner", "lucas.owner+test@example.com")

    # Save ids for cleanup
    with open("/tmp/test_claim_clubs.txt", "w") as f:
        f.write(f"{club_a['club_id']}\n{club_b['club_id']}\n")
    print("DONE. Saved club ids to /tmp/test_claim_clubs.txt")


if __name__ == "__main__":
    main()
