// Step-by-step tutorial. /guide lists workplaces; /guide/:slug shows that workplace's own links inside the steps.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ThemeScope } from "../components/Themed.jsx";
import { linksFor } from "../components/Links.jsx";
import { TopBar, toast } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { resolveTheme, useVenue } from "../lib/theme.js";

function copy(text) {
  const done = () => toast("Link copied");
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, () => {}); return; }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch { /* ignore */ }
  ta.remove();
}

function LinkRow({ icon, label, who, url }) {
  return (
    <div className="guide-link">
      <span className="guide-link-ico" aria-hidden="true">{icon}</span>
      <div className="guide-link-text">
        <b>{label}</b> <span className="tiny muted">{who}</span>
        <code>{url}</code>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button type="button" className="btn sm" onClick={() => copy(url)}>⧉ Copy</button>
        <a className="btn sm primary" href={url} target="_blank" rel="noopener">Open ↗</a>
      </div>
    </div>
  );
}

function Step({ n, icon, title, children, action }) {
  return (
    <li className="guide-step">
      <span className="guide-num" aria-hidden="true">{n}</span>
      <div style={{ minWidth: 0 }}>
        <h3><span aria-hidden="true">{icon}</span> {title}</h3>
        <div className="small guide-body">{children}</div>
        {action && <div style={{ marginTop: 10 }}>{action}</div>}
      </div>
    </li>
  );
}

function Section({ id, kicker, title, intro, children }) {
  return (
    <section id={id} className="card stack guide-section">
      <div>
        <div className="guide-kicker">{kicker}</div>
        <h2 style={{ margin: "2px 0 4px" }}>{title}</h2>
        {intro && <p className="muted small" style={{ margin: 0 }}>{intro}</p>}
      </div>
      <ol className="guide-steps">{children}</ol>
    </section>
  );
}

export default function Guide() {
  const { slug } = useParams();
  const { venue } = useVenue(slug);
  const [venues, setVenues] = useState(null);
  useEffect(() => { if (!slug) api("/api/venues").then(setVenues).catch(() => setVenues([])); }, [slug]);
  useEffect(() => { document.title = venue ? `Tutorial · ${venue.name}` : "Tutorial · QueueSense"; }, [venue]);

  const L = slug ? linksFor(slug) : null;
  const name = venue ? venue.name : "your workplace";
  const th = resolveTheme(venue && venue.theme);
  const open = (url, label) => (L ? <a className="btn sm primary" href={url} target="_blank" rel="noopener">{label} ↗</a> : null);

  const body = (
    <main className="page stack guide">
      <header className="guide-hero">
        <div className="guide-kicker">Tutorial</div>
        <h1>{venue ? <>{th.emoji} How to run {venue.name}</> : "How to use QueueSense"}</h1>
        <p className="muted">Five short parts: set up, share your links, staff taps, what customers see, and managing the day.
          No cameras, no sensors: just one tap per customer.</p>
        <nav className="row guide-toc" aria-label="Tutorial sections">
          <a href="#links">🔗 Links</a><a href="#setup">1 · Set up</a><a href="#share">2 · Share</a>
          <a href="#staff">3 · Staff</a><a href="#customers">4 · Customers</a><a href="#manage">5 · Manage</a><a href="#help">❓ Problems</a>
        </nav>
      </header>

      <section id="links" className="card stack">
        {slug ? (
          <>
            <h2 style={{ margin: 0 }}>Your links for {name}</h2>
            <p className="muted small" style={{ margin: 0 }}>Each workplace has its own separate websites. Share the first two; keep the operator link for yourself.</p>
            <LinkRow icon="👥" label="Customer website" who="for visitors (put this on the QR poster)" url={L.customer} />
            <LinkRow icon="📅" label="Booking page" who="for visitors who want a time slot" url={L.booking} />
            <LinkRow icon="🧑‍💼" label="Operator website" who="for you · admin PIN" url={L.operator} />
            <LinkRow icon="🎛️" label="Staff console" who="for staff phones · staff PIN" url={L.staff} />
            <LinkRow icon="📺" label="TV display board" who="for a screen at the entrance" url={L.board} />
            <div className="row" style={{ alignItems: "center", gap: 14 }}>
              <img src={`/api/venues/${slug}/qr.svg`} alt={`QR code for ${name}`} width="120" height="120" style={{ background: "#fff", borderRadius: 10, padding: 6 }} />
              <p className="small muted" style={{ margin: 0, maxWidth: 380 }}>This QR opens the customer website. Phones must be on the same Wi-Fi as this computer
                (or the site must be hosted online).</p>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ margin: 0 }}>Pick your workplace</h2>
            <p className="muted small" style={{ margin: 0 }}>The tutorial will show that workplace's own links.</p>
            {venues === null ? <p className="muted small">Loading…</p> : venues.length === 0 ? (
              <div className="row"><span className="muted small">No workplaces yet.</span><Link to="/signup" className="btn sm primary">Sign up to create one</Link></div>
            ) : (
              <div className="guide-pick">
                {venues.map((v) => (
                  <Link key={v.slug} to={`/guide/${v.slug}`} className="guide-pick-item" style={{ borderColor: v.theme && v.theme.primary }}>
                    <span aria-hidden="true">{v.emoji}</span><b>{v.name}</b><span className="tiny muted">/{v.slug}</span>
                  </Link>
                ))}
                <Link to="/create" className="guide-pick-item"><span aria-hidden="true">＋</span><b>Create a new one</b></Link>
              </div>
            )}
          </>
        )}
      </section>

      <Section id="setup" kicker="Part 1 · Operator · 2 minutes" title="Create and set up your workplace"
        intro="You do this once. Everything can be changed later.">
        <Step n="1" icon="🏪" title="Sign up, then create the workplace" action={!slug && <Link to="/signup" className="btn sm primary">Sign up</Link>}>
          On the start page choose <b>I'm an operator → New operator · Sign up</b> (or <b>Existing operator · Sign in</b>), then
          <b> + Create a workplace</b> from your account page. Type the name (e.g. <i>Spice Garden</i>) and pick the type:
          Restaurant, Canteen, Hospital OPD, Admin office or Custom. The type sets up tables or counters, typical service times and hours.
        </Step>
        <Step n="2" icon="🎨" title="Choose your look">
          Pick a colour theme and a font. The preview shows exactly how your customer website will look. Change it any time in
          <b> Operator website → Look &amp; feel</b>.
        </Step>
        <Step n="3" icon="🔐" title="Set two PINs">
          A <b>staff PIN</b> for people at counters/tables and an <b>admin PIN</b> for you (4–6 digits, different from each other).
          Write them down: they are shown only once.
        </Step>
        <Step n="4" icon="🛠️" title="Check tables, counters and hours" action={open(L && `${L.operator}/setup`, "Open Setup")}>
          In the operator website open <b>Setup</b>: add or remove tables (2, 4, 6 seats…) or counters, which services each one handles,
          opening hours, and the typical service time. <b>Settings</b> has rules like the call timeout and booking grace time.
        </Step>
      </Section>

      <Section id="share" kicker="Part 2 · Before you open" title="Share the links">
        <Step n="1" icon="🖨️" title="Print the QR poster" action={open(L && `${L.operator}/poster`, "Open QR poster")}>
          Operator website → <b>QR poster</b> → Print. Stick it at the entrance and on tables. Customers scan it to join.
        </Step>
        <Step n="2" icon="🎛️" title="Set up staff phones" action={open(L && L.staff, "Open staff console")}>
          Send staff the <b>staff console</b> link (WhatsApp works). They open it, enter the staff PIN once, and keep it open.
        </Step>
        <Step n="3" icon="📺" title="Put the board on a screen" action={open(L && L.board, "Open TV board")}>
          Open the <b>TV display board</b> link on a TV, tablet or old phone near the entrance. It shows who is being served and who is next
          (ticket codes only, no names).
        </Step>
      </Section>

      <Section id="staff" kicker="Part 3 · Staff" title="One tap per customer">
        <Step n="1" icon="👆" title="Counters and rooms: press NEXT">
          <b>NEXT</b> finishes the current person and calls the next one, so one tap per customer is enough. Use <b>SERVED</b> if you want to
          finish without calling anyone, <b>NO-SHOW</b> if the called person never came, <b>SKIP</b> to let them come back a bit later,
          and <b>PAUSE</b> for a break.
        </Step>
        <Step n="2" icon="🍽️" title="Tables: SEATED and LEFT">
          Tap <b>SEATED</b> when the group sits down and <b>LEFT</b> when they go. The next suitable group is called automatically, and gets
          the smallest table that fits them. "Still occupied?" appears if a table runs long.
        </Step>
        <Step n="3" icon="📋" title="Up next, walk-ins and undo">
          <b>Up next</b> shows who comes next and why ("Next in line, waiting 12 min", "Pre-booked 13:15"). <b>+ Walk-in</b> issues a ticket
          for someone without a phone; read the code out or write it down. Tapped by mistake? <b>Undo</b> works for 2 minutes.
        </Step>
      </Section>

      <Section id="customers" kicker="Part 4 · Customers" title="What your visitors do">
        <Step n="1" icon="📱" title="Scan and see the wait" action={open(L && L.customer, "Open customer website")}>
          They scan the QR and see the live wait as an honest range (e.g. <b>8–12 min</b>) with a confidence label, <i>before</i> joining.
        </Step>
        <Step n="2" icon="🎫" title="Get a token">
          They pick what they need (and party size for tables) and tap <b>Get my token</b>. No app, no sign-up, no phone number. They get a
          ticket like <b>R-012</b> with their live position.
        </Step>
        <Step n="3" icon="🔔" title="Come when called">
          Keeping the ticket page open, the phone vibrates and shows <b>"Go to Table 4"</b> when it's their turn. They can also let 2 people
          go ahead, cancel, share the ticket on WhatsApp, or tap "I'm leaving" at a table.
        </Step>
        <Step n="4" icon="📅" title="Or book a time" action={open(L && L.booking, "Open booking page")}>
          The booking page shows time slots coloured by how busy they usually are. Bookings are held for a grace period, then released.
        </Step>
      </Section>

      <Section id="manage" kicker="Part 5 · Operator · during the day" title="Watch and improve">
        <Step n="1" icon="📊" title="Overview" action={open(L && L.operator, "Open operator website")}>
          Live queue length, wait for a new arrival, open counters/tables and who is next, all updating by itself.
        </Step>
        <Step n="2" icon="📈" title="Analytics">
          Average and busiest waits, peak hours, no-shows, and how accurate the estimates are ("within 3 minutes X% of the time").
          Download tickets as CSV.
        </Step>
        <Step n="3" icon="🧪" title="What-if">
          Before adding staff, try <b>add 1 counter</b> or <b>pause a counter</b>: it simulates your current queue and shows the wait before and after.
        </Step>
        <Step n="4" icon="🎯" title="Estimates get better on their own">
          On day one estimates use typical times for your type of workplace and say <b>Low confidence</b>. Every staff tap teaches the
          system, so after a few dozen customers they become <b>Medium</b> and then <b>High</b> confidence.
        </Step>
      </Section>

      <section id="help" className="card stack">
        <h2 style={{ margin: 0 }}>❓ Common problems</h2>
        {[
          ["Phones can't open the links", "Phones must be on the same Wi-Fi or hotspot as the computer running QueueSense, and use the computer's network address (shown in the links above, not 'localhost'). On Windows, allow Python through the firewall for private networks. College or office Wi-Fi often blocks phone-to-laptop traffic: use your phone's hotspot instead."],
          ["Nothing loads at all", "The server must be running: double-click start.bat in the queuesense folder and keep that window open."],
          ["Forgot a PIN", "Log in to the operator website with the admin PIN and add a new staff user/PIN in Setup. If the admin PIN is lost, sign in with your operator account and open the operator website from 'My workplaces' (no PIN needed for the owner), then set new PINs."],
          ["The wait looks wrong", "Make sure staff tap for every customer (NEXT / LEFT). A forgotten tap makes a counter look busy; the console shows 'Still serving?' when that happens."],
          ["Customer closed the ticket page", "They can reopen it from the same phone's browser history, or ask staff, who can see their code in Up next."],
        ].map(([q, a]) => (
          <details key={q}><summary style={{ fontWeight: 700, cursor: "pointer", minHeight: 32 }}>{q}</summary><p className="small muted">{a}</p></details>
        ))}
      </section>

      <div className="row">
        <Link to="/" className="btn">← Start page</Link>
        {slug && <a href={L.operator} className="btn primary">Go to operator website →</a>}
      </div>
    </main>
  );

  return (
    <>
      <TopBar />
      {venue ? <ThemeScope theme={venue.theme}>{body}</ThemeScope> : body}
    </>
  );
}
