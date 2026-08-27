import type { Metadata } from 'next';
import { RosterProvider } from '@/lib/roster-context';
import { SessionProvider } from '@/lib/session-context';
import { ToastProvider } from '@/lib/toast-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'FP&A Control Tower',
  description: 'IDC internal finance dashboard — Value Creation Plan and Investment Requests.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <RosterProvider>
            <ToastProvider>
              <div className="shell">{children}</div>
            </ToastProvider>
          </RosterProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
