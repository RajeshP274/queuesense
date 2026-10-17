// "My tickets" remembered on this device (codes only, no personal data).
const KEY = "qs_my_tickets";

export function myTickets() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

export function rememberTicket(tk) {
  if (!tk || !tk.code) return;
  const list = myTickets().filter((x) => x.code !== tk.code);
  list.unshift({ code: tk.code, venue: tk.venue_name, at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5))); } catch { /* ignore */ }
}
