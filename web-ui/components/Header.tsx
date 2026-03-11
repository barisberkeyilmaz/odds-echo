"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
    { href: '/', label: 'Fikstür', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    )},
{ href: '/perfect-match', label: 'Mükemmel Eşleşme', shortLabel: 'Eşleşme', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
        </svg>
    )},
    { href: '/surprise-analysis', label: 'Sürpriz Analiz', shortLabel: 'Sürpriz', icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    )},
]

export default function Header({ totalMatches }: { totalMatches?: number }) {
    const pathname = usePathname()

    const isActive = (path: string) => {
        return pathname === path
    }

    const desktopLinkClass = (path: string) =>
        isActive(path)
            ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-b-2 border-transparent'

    return (
        <>
            <header className="sticky top-0 z-50 bg-[var(--bg-secondary)]/80 backdrop-blur-md border-b border-[var(--border-primary)]">
                <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 flex justify-between items-center py-4">
                    <div>
                        <h1 className="text-lg md:text-2xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] tracking-tight">
                            OddsEcho
                        </h1>
                        <p className="hidden sm:block text-[var(--text-tertiary)] text-xs mt-0.5">İstatistiksel Oran Analiz Platformu</p>
                    </div>
                    {totalMatches !== undefined && (
                        <div className="bg-[var(--bg-tertiary)] border border-[var(--border-primary)] px-3 py-1.5 rounded-md text-xs font-mono text-[var(--text-secondary)]">
                            {totalMatches} Maç
                        </div>
                    )}
                </div>

                <nav className="hidden md:flex max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 space-x-1 -mb-px">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`px-4 py-2.5 font-medium text-sm transition-colors ${desktopLinkClass(item.href)}`}
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>
            </header>

            {/* Mobile bottom tab bar */}
            <nav className="fixed bottom-0 inset-x-0 z-50 flex md:hidden bg-[var(--bg-secondary)]/95 backdrop-blur-md border-t border-[var(--border-primary)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {NAV_ITEMS.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] text-[10px] font-medium transition-colors ${
                            isActive(item.href)
                                ? 'text-[var(--accent-blue)]'
                                : 'text-[var(--text-muted)]'
                        }`}
                    >
                        {item.icon}
                        <span>{item.shortLabel || item.label}</span>
                    </Link>
                ))}
            </nav>
        </>
    )
}
