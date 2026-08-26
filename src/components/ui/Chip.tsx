export function Chip({ label, text, bg }: { label: string; text: string; bg: string }) {
  return (
    <span className="chip" style={{ color: text, background: bg }}>
      {label}
    </span>
  );
}
