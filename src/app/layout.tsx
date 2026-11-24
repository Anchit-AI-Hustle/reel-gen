import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Reel Gen — AI Video Production Studio',
  description: 'Upload raw footage, describe your story, attach reference images, and generate professionally edited MP4 reels.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0B0D12] text-[#F5F5F8] antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
