'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, Film, SlidersHorizontal, Cloud, LayoutDashboard, Settings, Menu, X } from 'lucide-react';

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
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
  const close = () => drawer.current?.close();

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0D12] text-[#F5F5F8]">
      <header className="sticky top-0 z-40 border-b border-[#303441] bg-[#12151E]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-3 sm:px-6">
          <button ref={trigger} type="button" aria-label="Open navigation menu" aria-haspopup="dialog" aria-controls="reel-navigation" onClick={() => drawer.current?.showModal()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#303441] bg-[#171A23] hover:bg-[#222633] focus-visible:outline-2 focus-visible:outline-[#9A83FF]">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link href="/" className="flex min-w-0 items-center gap-2 font-bold tracking-tight text-lg">
            <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#9A83FF]/20 text-[#9A83FF] border border-[#9A83FF]/40">◈</span>
            <span className="whitespace-nowrap">Reel Gen</span>
            <span className="hidden sm:inline rounded-full bg-[#222633] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#A6AFC0]">Studio V2</span>
          </Link>
        </div>
      </header>
      <dialog ref={drawer} id="reel-navigation" aria-labelledby="reel-nav-title" onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-[#F5F5F8] backdrop:bg-black/60">
        <div className="flex h-full w-[min(85vw,320px)] flex-col overflow-y-auto border-r border-[#303441] bg-[#12151E] p-4 shadow-2xl">
          <div className="mb-5 flex items-center justify-between gap-2">
            <h2 id="reel-nav-title" className="text-lg font-bold">Reel Gen</h2>
            <button type="button" autoFocus aria-label="Close navigation menu" onClick={close} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[#222633] focus-visible:outline-2 focus-visible:outline-[#9A83FF]"><X className="h-5 w-5" /></button>
          </div>
          <nav aria-label="Primary navigation" className="space-y-1">
            {NAV_ITEMS.map(({href,label,icon:Icon}) => (
              <Link key={href} href={href} aria-current={isActive(href) ? 'page' : undefined} onClick={close} className={'flex min-h-[48px] items-center gap-3 rounded-lg border px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[#9A83FF] ' + (isActive(href) ? 'border-[#9A83FF]/40 bg-[#2E284B] text-[#E3DCFF]' : 'border-transparent text-[#A6AFC0] hover:bg-[#222633] hover:text-[#F5F5F8]')}>
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true"/><span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </dialog>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
