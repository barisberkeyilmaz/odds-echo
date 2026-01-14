"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Header({ totalMatches }: { totalMatches?: number }) {
    const pathname = usePathname()

    const isActive = (path: string) => {
        return pathname === path ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
    }

    return (
        <header className="mb-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">📊 Mackolik Analiz</h1>
                    <p className="text-gray-500 mt-1">İstatistiksel Desen ve Oran Analizi</p>
                </div>
                {totalMatches !== undefined && (
                    <div className="bg-white px-4 py-2 rounded shadow text-sm font-medium">
                        Liste: {totalMatches} Maç
                    </div>
                )}
            </div>

            <nav className="flex space-x-2 border-b pb-1">
                <Link
                    href="/"
                    className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${isActive('/')}`}
                >
                    📅 Fikstür
                </Link>
                <Link
                    href="/odds-search"
                    className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${isActive('/odds-search')}`}
                >
                    🔎 Oran Arama
                </Link>
            </nav>
        </header>
    )
}
