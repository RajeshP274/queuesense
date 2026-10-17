import { useT } from "../i18n/index.jsx";

const ICON = { BOOKED: "📅", WAITING: "⏳", CALLED: "🔔", IN_SERVICE: "✅", DONE: "✓", NO_SHOW: "✕", CANCELLED: "✕", EXPIRED: "⌛" };

/** Status is always shown with an icon AND text, never colour alone. */
export default function StatusChip({ status }) {
  const { t } = useT();
  return (
    <span className={`chip chip-${status}`}>
      <span aria-hidden="true">{ICON[status] || "•"}</span>
      {t(`status.${status}`)}
    </span>
  );
}
