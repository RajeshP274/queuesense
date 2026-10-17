// Fetch wrapper: parses the backend error shape {error: {code, message, hint}} and adds auth headers.
export class ApiError extends Error {
  constructor(code, message, hint, status, network = false) {
    super(message || code);
    this.code = code;
    this.hint = hint || null;
    this.status = status || 0;
    this.network = network;
  }
}

const CUSTOMER_KEY = "qs_customer";
const STAFF_KEY = "qs_staff";
const OPERATOR_KEY = "qs_operator";

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, val) {
  try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked */ }
}

export const auth = {
  customer: () => read(CUSTOMER_KEY),            // {token, phone_last4}
  setCustomer: (v) => write(CUSTOMER_KEY, v),
  staff: () => read(STAFF_KEY),                   // {token, role, name, slug}
  setStaff: (v) => write(STAFF_KEY, v),
  logoutStaff: () => write(STAFF_KEY, null),
  operator: () => read(OPERATOR_KEY),             // {token, operator: {id, name, email}}
  setOperator: (v) => write(OPERATOR_KEY, v),
  logoutOperator: () => { write(OPERATOR_KEY, null); write(STAFF_KEY, null); },
};

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * api(path, {method, body, as: 'customer'|'staff'|'operator', idem: true|string, headers})
 * Throws ApiError. Network failures have err.network === true.
 */
export async function api(path, opts = {}) {
  const { method = "GET", body, as, idem, headers = {} } = opts;
  const h = { Accept: "application/json", ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  const who = as === "customer" ? auth.customer() : as === "staff" ? auth.staff() : as === "operator" ? auth.operator() : null;
  if (who && who.token) h.Authorization = `Bearer ${who.token}`;
  if (idem) h["Idempotency-Key"] = typeof idem === "string" ? idem : uuid();
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError("NETWORK", "No connection", null, 0, true);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = (data && data.error) || {};
    if (res.status === 401 && as === "staff") auth.logoutStaff();
    if (res.status === 401 && as === "operator") write(OPERATOR_KEY, null);
    throw new ApiError(err.code || `HTTP_${res.status}`, err.message || (data && data.detail) || res.statusText, err.hint, res.status);
  }
  return data;
}

export const get = (path, as) => api(path, { as });
export const post = (path, body, opts = {}) => api(path, { method: "POST", body: body || {}, ...opts });
