'use client';

import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useSession } from '@/lib/session-context';

interface NotificationItem {
  id: string;
  tower: 'vcp' | 'inv';
  event: string;
  label: string;
  clr: string;
  at: string;
  subject: string;
  body: string;
  link: { kind: string; ref: string } | null;
  read: boolean;
  isCc: boolean;
}

export function NotificationBell() {
  const { me, signedIn, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const unread = (me?.unread.vcp ?? 0) + (me?.unread.inv ?? 0);

  useEffect(() => {
    if (!open || loaded) return;
    api
      .get<{ notifications: NotificationItem[] }>('/api/notifications?limit=50')
      .then((res) => {
        setItems(res.notifications);
        setLoaded(true);
      })
      .catch(() => setItems([]));
  }, [open, loaded]);

  async function markAllRead() {
    await Promise.all([
      api.post('/api/notifications/read', { tower: 'vcp', all: true }).catch(() => {}),
      api.post('/api/notifications/read', { tower: 'inv', all: true }).catch(() => {}),
    ]);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    refresh();
  }

  if (!signedIn) return null;

  return (
    <div className="popover-anchor">
      <button type="button" className="bell-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={18} strokeWidth={1.75} />
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover">
          <div className="popover__header">
            <span>Notifications</span>
            <button type="button" className="popover__mark-all" onClick={markAllRead}>
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <div className="popover-empty">No notifications yet.</div>
          ) : (
            items.map((n) => (
              <div className="notif-row" key={n.id}>
                <span className="notif-dot" style={{ background: n.clr }} />
                <div style={{ flex: 1 }}>
                  <p className="notif-row__subject">{n.subject}</p>
                  <p className="notif-row__meta">
                    {new Date(n.at).toLocaleString()} · {n.label}
                  </p>
                </div>
                {!n.read && <span className="notif-row__unread-dot" />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
