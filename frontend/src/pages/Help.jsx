import { Link } from "react-router-dom";
import { TopBar } from "../components/ui.jsx";
import { useT } from "../i18n/index.jsx";

const STEPS = [
  ["📱", "Scan the QR", "At the entrance, scan the QR code. No app, no login. You see the honest wait range before deciding to join."],
  ["🎫", "Get a token", "Pick what you need and tap Get my token. You get an anonymous ticket like A-042 with your live position - no sign-up, no phone number."],
  ["👆", "Staff tap once", "Staff press one big button (NEXT / SERVED / LEFT) per customer on any phone. No cameras or sensors."],
  ["📈", "The system learns", "Every tap teaches QueueSense how long service really takes at this time of day, so estimates improve during the day."],
  ["🔔", "Come back on time", "Keep the ticket page open: it updates live, shows a notice when you're near the front and a clear 'Go to Counter 3' when it's your turn."],
];

const FAQ = [
  ["Why a range and not one number?", "Service times vary. A range like 12–18 min is honest; the confidence tag tells you how much data it's based on."],
  ["Why did my estimate go up?", "Usually a counter paused, service got slower, or a priority patient was seen. We show the reason when we know it."],
  ["What do you store about me?", "Nothing personal: an anonymous ticket code and, only if you type it, a first name. You can delete it from your ticket page."],
  ["Can someone skip the line?", "Only emergency cases (added by staff), checked-in bookings at their slot time, and seniors (capped so regular customers still move). Every call shows its reason."],
  ["What if I'm late for a booking?", "You have a grace period. After that your booking is released and you can rejoin as a late booking."],
];

export default function Help() {
  const { t } = useT();
  return (
    <>
      <TopBar />
      <main className="page narrow stack">
        <h1>{t("help.title")}</h1>
        <ol className="stack" style={{ listStyle: "none", padding: 0 }}>
          {STEPS.map(([icon, title, text], i) => (
            <li key={title} className="card row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <span aria-hidden="true" style={{ fontSize: 34, lineHeight: 1 }}>{icon}</span>
              <div><b>{i + 1}. {title}</b><p className="small muted" style={{ margin: "4px 0 0" }}>{text}</p></div>
            </li>
          ))}
        </ol>

        <section className="card stack">
          <h2>Quick guides</h2>
          <div><b>Customers</b><p className="small muted" style={{ margin: 0 }}>Scan → pick a service → Get my token → keep the ticket page open. Use "Let 2 people go ahead" if you need a few extra minutes; cancel if plans change.</p></div>
          <div><b>Staff</b><p className="small muted" style={{ margin: 0 }}>Log in with your venue PIN. Tap NEXT to call the next person (it closes the previous one). Tables: SEATED when they sit, LEFT when they go. Undo is available for 2 minutes. Works offline: taps sync when you're back online.</p></div>
          <div><b>Admins</b><p className="small muted" style={{ margin: 0 }}>Create your workplace (name, type, colours and fonts, PINs) to get your customer website and operator website, then adjust services, counters/tables/rooms and hours and print the QR poster. Analytics shows how accurate the estimates are.</p></div>
        </section>

        <section className="card stack">
          <h2>How the estimate is computed</h2>
          <p className="small" style={{ margin: 0 }}>
            QueueSense learns the service time for each service (and each table size) from staff taps, blending it with the venue's starting guess until it has enough data.
            For your ticket it simulates 400 possible futures: how long each busy counter still needs, who is ahead of you in the exact order the assignment engine uses, and expected bookings.
            We show the middle range (20th–80th percentile) and a confidence label. The system checks its own past predictions and widens or narrows the range to stay honest.
          </p>
        </section>

        <section className="card stack">
          <h2>FAQ</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}><summary style={{ fontWeight: 700, cursor: "pointer", minHeight: 32 }}>{q}</summary><p className="small muted">{a}</p></details>
          ))}
        </section>
        <Link to="/" className="btn">← {t("nav.home")}</Link>
      </main>
    </>
  );
}
