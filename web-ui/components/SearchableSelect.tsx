"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type SelectOption = {
  value: string
  label: string
  group?: string
}

type SearchableSelectProps = {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  allLabel?: string
  allValue?: string
  className?: string
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Ara...',
  allLabel = 'Tümü',
  allValue = 'Tümü',
  className = '',
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabel = useMemo(() => {
    if (value === allValue) return allLabel
    return options.find((o) => o.value === value)?.label ?? value
  }, [value, options, allLabel, allValue])

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.group && o.group.toLowerCase().includes(q))
    )
  }, [options, search])

  // Group filtered options
  const grouped = useMemo(() => {
    const groups = new Map<string, SelectOption[]>()
    const ungrouped: SelectOption[] = []
    for (const opt of filtered) {
      if (opt.group) {
        const list = groups.get(opt.group)
        if (list) list.push(opt)
        else groups.set(opt.group, [opt])
      } else {
        ungrouped.push(opt)
      }
    }
    return { groups, ungrouped }
  }, [filtered])

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val)
      setIsOpen(false)
      setSearch('')
    },
    [onChange]
  )

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] hover:border-[var(--border-accent)] focus:border-[var(--accent-blue)] focus:outline-none transition-colors"
      >
        <span className={value === allValue ? 'text-[var(--text-muted)]' : ''}>
          {selectedLabel}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg shadow-black/30 overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-[var(--border-subtle)]">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none transition-colors"
            />
          </div>

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto">
            {/* "All" option */}
            {!search.trim() && (
              <button
                type="button"
                onClick={() => handleSelect(allValue)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
                  value === allValue
                    ? 'text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {allLabel}
              </button>
            )}

            {/* Ungrouped */}
            {grouped.ungrouped.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
                  value === opt.value
                    ? 'text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {/* Grouped */}
            {Array.from(grouped.groups.entries()).map(([groupName, items]) => (
              <div key={groupName}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-tertiary)] sticky top-0">
                  {groupName}
                </div>
                {items.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors ${
                      value === opt.value
                        ? 'text-[var(--accent-blue)] bg-[var(--accent-blue-bg)]'
                        : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ))}

            {/* Empty state */}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                Sonuç bulunamadı
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
