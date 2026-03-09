"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Header({ totalMatches }: { totalMatches?: number }) {
    const pathname = usePathname()

    const isActive = (path: string) => {
        return pathname === path
            ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-b-2 border-transparent'
    }

    return (
        <header className="sticky top-0 z-50 bg-[var(--bg-secondary)]/80 backdrop-blur-md border-b border-[var(--border-primary)]">
            <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 flex justify-between items-center py-4">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] tracking-tight">
                        OddsEcho
                    </h1>
                    <p className="text-[var(--text-tertiary)] text-xs mt-0.5">İstatistiksel Oran Analiz Platformu</p>
                </div>
                {totalMatches !== undefined && (
                    <div className="bg-[var(--bg-tertiary)] border border-[var(--border-primary)] px-3 py-1.5 rounded-md text-xs font-mono text-[var(--text-secondary)]">
                        {totalMatches} Maç
                    </div>
                )}
            </div>

            <nav className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 flex space-x-1 -mb-px">
                <Link
                    href="/"
                    className={`px-4 py-2.5 font-medium text-sm transition-colors ${isActive('/')}`}
                >
                    Fikstür
                </Link>
                <Link
                    href="/odds-search"
                    className={`px-4 py-2.5 font-medium text-sm transition-colors ${isActive('/odds-search')}`}
                >
                    Oran Arama
                </Link>
                <Link
                    href="/perfect-match"
                    className={`px-4 py-2.5 font-medium text-sm transition-colors ${isActive('/perfect-match')}`}
                >
                    Mükemmel Eşleşme
                </Link>
            </nav>
        </header>
    )
}
