# QueueSense: live queues and honest wait times, with no cameras or sensors

An operator creates a **workplace** (restaurant, canteen, hospital OPD, office or custom) and gets **two separate websites**:

| Website | Address | Who uses it |
|---|---|---|
| **Customer website** | `/v/<workplace>` (+ `/t/<ticket>`, `/b/<workplace>` for booking) | Visitors scan the QR, see the wait, take a token |
| **Operator website** | `/op/<workplace>` | You: overview, staff console, analytics, what-if, setup, look & feel, QR poster |

Each workplace also has:
- a **staff console** at `/staff/<workplace>` (staff PIN)
- a **TV display board** at `/board/<workplace>`
- its own **step-by-step tutorial with its real links** at `/guide/<workplace>`

The customer website uses the workplace's own **colours, fonts and icon**. The operator changes them under *Look & feel*.

## Start
1. Double-click **`start.bat`**. The first run installs everything.
2. Keep the window open.
3. Open **http://localhost:8000**.
4. Phones on the same Wi-Fi use the network address shown in the window and on the tutorial page.

- Data is stored in **MongoDB** (`mongodb://127.0.0.1:27017`, database `queuesense`). If MongoDB isn't running, the server falls back to an in-memory database, and that data is lost on restart.
- **Tutorial:** http://localhost:8000/guide.

## First use (2 minutes)
1. Start page → **I run a place → Create a workplace**.
2. Enter the name, pick the type, choose colours and font, and set the staff and admin PINs.
3. **"Your two websites are ready"** shows both links, the QR code and your PINs. Write the PINs down; they're shown only once.
4. Print the QR poster, give staff the staff console link and PIN, and open the board on a screen.

## How it works
- **Staff:** one tap per customer (**NEXT**; **SEATED** and **LEFT** for tables). No cameras, no sensors.
- **Customers:** join anonymously, with no phone number or OTP. They get a ticket code, a live position and an honest range like *8–12 min* with a confidence label.
- **Estimates:**
  - Service times are learned from taps, starting from typical times for the workplace type.
  - The wait comes from a Monte Carlo replay of the real queue (400 runs) with the 20th–80th percentile shown.
  - The engine checks its own accuracy and widens or narrows the range to stay honest.
- **Assignment:**
  - emergencies first (staff only)
  - then checked-in bookings at their slot
  - then anyone waiting past the fairness limit
  - then seniors, capped so others still move
  - then everyone else by arrival

  Tables use the smallest that fits. Every call shows its reason.
- **Data:** append-only event log in MongoDB. Estimator state can be rebuilt from it at any time.

## Tests
```powershell
cd backend
.venv\Scripts\python -m pytest -q tests     # 17 engine/API tests, isolated in-memory database
```

## Notes and limits
- **No SMS service is connected.** Customers keep their ticket page open for live updates. The phone/OTP code remains behind an interface for a real SMS provider later.
- **Accuracy starts low.** Estimates say "Low confidence" until a few dozen customers have been served.
- **Security is fine for one site, not hardened:** PINs are bcrypt-hashed, and logins use 12-hour tokens. Run behind HTTPS if you host it online.
- **Fonts:** Google Fonts load when online; offline, system fonts are used.
- **Translations:** Hindi and Gujarati cover the customer pages and key staff text; everything else is English.
