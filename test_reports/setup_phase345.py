"""Setup: Emma becomes owner of Club Rex via claim + admin approval."""
import requests, os, sys
BASE = os.environ.get('EXPO_BACKEND_URL', 'https://fan-culture-app.preview.emergentagent.com').rstrip('/')
EMMA = ("emma.demo@nightfinder.app", "DemoOnly2026!")
ADMIN = ("admin@nightfinder.app", "NightFinder2026!Admin")
CLUB_ID = "club_6c802df155"  # Club Rex

def login(email, pw):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]

def main():
    et = login(*EMMA)
    at = login(*ADMIN)
    # 1x1 PNG base64
    tiny = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    doc = f"data:image/png;base64,{tiny}"
    payload = {
        "club_id": CLUB_ID,
        "owner_name": "Emma Demo",
        "email": "emma.demo@nightfinder.app",
        "phone": "+33600000000",
        "role": "gerant",
        "id_document": doc,
        "kbis_document": doc,
    }
    r = requests.post(f"{BASE}/api/bars/claim", json=payload,
                      headers={"Authorization": f"Bearer {et}"}, timeout=15)
    print("claim status:", r.status_code, r.text[:200])
    if r.status_code >= 400:
        # maybe already exists — list
        r2 = requests.get(f"{BASE}/api/bars/my-claims", headers={"Authorization": f"Bearer {et}"})
        print("my-claims:", r2.status_code, r2.text[:400])
        sys.exit(1)
    claim_id = r.json()["claim"]["claim_id"]
    print("claim_id:", claim_id)
    # Approve as admin
    r = requests.post(f"{BASE}/api/admin/bar-claims/{claim_id}/approve",
                      headers={"Authorization": f"Bearer {at}"}, timeout=15)
    print("approve:", r.status_code, r.text[:300])
    r.raise_for_status()
    print("OK — Emma is now owner of Club Rex")

if __name__ == "__main__":
    main()
