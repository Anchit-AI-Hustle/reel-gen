'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sparkles,
  Film,
  SlidersHorizontal,
  Cloud,
  LayoutDashboard,
  Settings,
  Menu,
  X,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Create', icon: Sparkles },
  { href: '/library', label: 'Media Library', icon: Film },
  { href: '/editor', label: 'Editor', icon: SlidersHorizontal },
  { href: '/drives', label: 'Cloud Drives', icon: Cloud },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0D12] text-[#F5F5F8]">
      <header className="sticky top-0 z-40 border-b border-[#303441] bg-[#12151E]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-lg">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#9A83FF]/20 text-[#9A83FF] border border-[#9A83FF]/40">
              ◈
            </span>
            <span>Reel Gen</span>
            <span className="rounded-full bg-[#222633] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#A6AFC0]">
              Studio V2
            </span>
          </Link>

          {/* Desktop navigation */}
          <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#2E284B] text-[#E3DCFF] border border-[#9A83FF]/40'
                      : 'text-[#A6AFC0] hover:bg-[#1C202C] hover:text-[#F5F5F8]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Mobile menu toggle — fixes clipped mobile nav */}
          <button
            type="button"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="inline-flex md:hidden h-11 w-11 items-center justify-center rounded-lg border border-[#303441] bg-[#171A23] text-[#F5F5F8] hover:bg-[#222633]"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Accessible Mobile Drawer */}
        {mobileOpen && (
          <nav
            aria-label="Mobile navigation"
            className="md:hidden border-t border-[#303441] bg-[#12151E] px-4 py-3 space-y-1"
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium ${
                    active
                      ? 'bg-[#2E284B] text-[#E3DCFF] border border-[#9A83FF]/40'
                      : 'text-[#A6AFC0] hover:bg-[#1C202C] hover:text-[#F5F5F8]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
