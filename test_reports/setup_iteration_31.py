"""
Iteration 31 setup:
- Login emma + admin
- Submit claim on Club Rex with synthetic PIL docs (/tmp/id_doc.txt, /tmp/kbis.txt)
- Wait for AI robot to auto-approve (~30-60s)
- Verify state
"""
import time
import requests
import sys

BASE = "https://fan-culture-app.preview.emergentagent.com/api"

def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    r.raise_for_status()
    j = r.json()
    return j["token"], j["user"]

def read_file(path):
    with open(path, "r") as f:
        return f.read().strip()

def main():
    emma_tok, emma_user = login("emma.demo@nightfinder.app", "DemoOnly2026!")
    admin_tok, admin_user = login("admin@nightfinder.app", "NightFinder2026!Admin")
    print(f"emma id={emma_user['user_id']}")
    print(f"admin id={admin_user['user_id']}")

    id_doc = read_file("/tmp/id_doc.txt")
    kbis_doc = read_file("/tmp/kbis.txt")
    print(f"id_doc len={len(id_doc)} kbis_doc len={len(kbis_doc)}")

    payload = {
        "club_id": "club_6c802df155",
        "owner_name": "Emma Martin",
        "email": "emma.owner+test@example.com",
        "phone": "+33612345678",
        "role": "proprietaire",
        "id_document": id_doc,
        "kbis_document": kbis_doc,
    }
    r = requests.post(
        f"{BASE}/bars/claim",
        headers={"Authorization": f"Bearer {emma_tok}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    print("submit_claim status:", r.status_code, r.text[:300])
    if r.status_code not in (200, 201):
        sys.exit("Failed to submit claim")

    # Poll admin claims for auto-approval up to 90s
    print("Polling for AI verdict...")
    approved_claim = None
    for i in range(30):
        time.sleep(4)
        rr = requests.get(
            f"{BASE}/me/bar-claims",
            headers={"Authorization": f"Bearer {emma_tok}"},
            timeout=15,
        )
        if rr.status_code == 200:
            claims = rr.json()
            if isinstance(claims, dict):
                claims = claims.get("claims", [])
            if claims:
                c = claims[0]
                status = c.get("status")
                reviewed_by = c.get("reviewed_by")
                print(f"  [{i*4}s] status={status} reviewed_by={reviewed_by}")
                if status in ("approved", "rejected"):
                    approved_claim = c
                    break
    if not approved_claim:
        print("Timeout — no auto-verdict")
        sys.exit(2)
    print("Final claim:", approved_claim.get("status"), approved_claim.get("club_id"))

    # Save token for playwright test
    with open("/tmp/emma_token.txt", "w") as f:
        f.write(emma_tok)
    with open("/tmp/admin_token.txt", "w") as f:
        f.write(admin_tok)
    with open("/tmp/emma_userid.txt", "w") as f:
        f.write(emma_user["user_id"])
    print("Setup complete")

if __name__ == "__main__":
    main()
