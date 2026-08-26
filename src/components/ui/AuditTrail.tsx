interface AuditEntry {
  at: string;
  actorName: string;
  action: string;
  note?: string | null;
}

export function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <div className="empty-state">No activity yet.</div>;
  return (
    <table className="idc-table idc-table--dense">
      <thead>
        <tr>
          <th>When</th>
          <th>Who</th>
          <th>Action</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, idx) => (
          <tr key={idx}>
            <td>{new Date(e.at).toLocaleString()}</td>
            <td>{e.actorName}</td>
            <td>{e.action}</td>
            <td>{e.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
