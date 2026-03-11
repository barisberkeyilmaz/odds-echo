"use client"

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'favorite-leagues'

export function useFavoriteLeagues() {
  const [favorites, setFavorites] = useState<string[]>([])

  // SSR-safe: read from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) setFavorites(parsed)
      }
    } catch {}
  }, [])

  const persist = useCallback((next: string[]) => {
    setFavorites(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }, [])

  const addLeague = useCallback(
    (key: string) => {
      if (!favorites.includes(key)) {
        persist([...favorites, key])
      }
    },
    [favorites, persist]
  )

  const removeLeague = useCallback(
    (key: string) => {
      persist(favorites.filter((k) => k !== key))
    },
    [favorites, persist]
  )

  const clearAll = useCallback(() => {
    persist([])
  }, [persist])

  return { favorites, addLeague, removeLeague, clearAll }
}
