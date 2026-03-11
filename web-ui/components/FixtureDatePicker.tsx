"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type FixtureDatePickerProps = {
  availableDateKeys: string[]
  selectedDateKey: string
}

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const fromDateKey = (dateKey: string) => new Date(`${dateKey}T00:00:00`)

const addDays = (dateKey: string, offset: number) => {
  const d = fromDateKey(dateKey)
  d.setDate(d.getDate() + offset)
  return toDateKey(d)
}

const formatShortDay = (dateKey: string) =>
  fromDateKey(dateKey).toLocaleDateString('tr-TR', { weekday: 'short' })

const formatDayNum = (dateKey: string) =>
  fromDateKey(dateKey).getDate()

const formatMonthShort = (dateKey: string) =>
  fromDateKey(dateKey).toLocaleDateString('tr-TR', { month: 'short' })

const TR_DAY_NAMES = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']
const TR_MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

function InlineCalendar({
  selectedDateKey,
  availableSet,
  onSelect,
  isMobile,
}: {
  selectedDateKey: string
  availableSet: Set<string>
  onSelect: (dateKey: string) => void
  isMobile?: boolean
}) {
  const selectedDate = fromDateKey(selectedDateKey)
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth())
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear())

  const todayKey = toDateKey(new Date())

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    const lastDay = new Date(viewYear, viewMonth + 1, 0)
    const startOffset = (firstDay.getDay() + 6) % 7
    const totalDays = lastDay.getDate()

    const days: { date: Date; dateKey: string; isCurrentMonth: boolean }[] = []

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth, -i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: false })
    }

    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(viewYear, viewMonth, i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: true })
    }

    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(viewYear, viewMonth + 1, i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: false })
    }

    return days
  }, [viewMonth, viewYear])

  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
    else setViewMonth(viewMonth - 1)
  }

  const goToNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
    else setViewMonth(viewMonth + 1)
  }

  return (
    <div className={`bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl p-3 shadow-lg shadow-black/30 ${isMobile ? 'w-full' : 'w-[280px]'}`}>
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={goToPrevMonth} className="w-10 h-10 sm:w-7 sm:h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors text-xs">
          ←
        </button>
        <span className="text-xs font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">
          {TR_MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button type="button" onClick={goToNextMonth} className="w-10 h-10 sm:w-7 sm:h-7 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors text-xs">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {TR_DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-xs sm:text-[9px] font-medium text-[var(--text-muted)] py-0.5">
            {name}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {calendarDays.map((day) => {
          const isSelected = day.dateKey === selectedDateKey
          const isToday = day.dateKey === todayKey
          const isAvailable = availableSet.has(day.dateKey)

          return (
            <button
              key={day.dateKey + (day.isCurrentMonth ? '-cur' : '-out')}
              type="button"
              onClick={() => onSelect(day.dateKey)}
              className={`
                relative w-full aspect-square flex items-center justify-center text-sm sm:text-[11px] font-medium rounded-md transition-colors
                ${isSelected
                  ? 'bg-[var(--accent-blue)] text-white'
                  : isToday
                    ? 'ring-1 ring-[var(--accent-blue)] text-[var(--text-primary)]'
                    : day.isCurrentMonth
                      ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                }
              `}
            >
              {day.date.getDate()}
              {isAvailable && (
                <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--accent-win)]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function FixtureDatePicker({ availableDateKeys, selectedDateKey }: FixtureDatePickerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const availableSet = useMemo(() => new Set(availableDateKeys), [availableDateKeys])
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarRef = useRef<HTMLDivElement>(null)

  const todayKey = toDateKey(new Date())

  // 5-day strip centered on selected date
  const stripDays = useMemo(() => {
    return [-2, -1, 0, 1, 2].map((offset) => addDays(selectedDateKey, offset))
  }, [selectedDateKey])

  const goToDateKey = (dateKey: string) => {
    const params = new URLSearchParams(searchParams?.toString())
    params.set('date', dateKey)
    router.push(`${pathname}?${params.toString()}`)
    setCalendarOpen(false)
  }

  // Close calendar on outside click (desktop only)
  useEffect(() => {
    if (!calendarOpen) return
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [calendarOpen])

  return (
    <div className="relative z-30 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] px-2 sm:px-3 py-2.5 mb-6 card-glow">
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Prev button */}
        <button
          type="button"
          onClick={() => goToDateKey(addDays(selectedDateKey, -1))}
          className="shrink-0 w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Önceki gün"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* 5-day strip — hide first and last on mobile (3 days) */}
        <div className="flex-1 flex items-center justify-center gap-1">
          {stripDays.map((dateKey, index) => {
            const isSelected = dateKey === selectedDateKey
            const isToday = dateKey === todayKey
            const isAvailable = availableSet.has(dateKey)
            const hideOnMobile = index === 0 || index === 4

            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => goToDateKey(dateKey)}
                className={`
                  relative flex flex-col items-center px-2 py-2.5 sm:px-3 sm:py-1.5 rounded-lg transition-colors min-w-[48px] sm:min-w-[52px]
                  ${hideOnMobile ? 'hidden sm:flex' : ''}
                  ${isSelected
                    ? 'bg-[var(--accent-blue)] text-white'
                    : isToday
                      ? 'ring-1 ring-[var(--accent-blue)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }
                `}
              >
                <span className={`text-[10px] font-medium ${isSelected ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                  {formatShortDay(dateKey)}
                </span>
                <span className="text-sm font-bold font-mono leading-tight">
                  {formatDayNum(dateKey)}
                </span>
                <span className={`text-[9px] ${isSelected ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
                  {formatMonthShort(dateKey)}
                </span>
                {isAvailable && !isSelected && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--accent-win)]" />
                )}
              </button>
            )
          })}
        </div>

        {/* Today button */}
        <button
          type="button"
          onClick={() => goToDateKey(todayKey)}
          disabled={selectedDateKey === todayKey}
          className="shrink-0 px-2 py-2 sm:px-2.5 sm:py-1.5 rounded-md text-[11px] sm:text-[10px] font-semibold border border-[var(--border-primary)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue-bg)] disabled:opacity-30 disabled:cursor-default transition-colors"
          title="Bugüne git"
        >
          Bugün
        </button>

        {/* Next button */}
        <button
          type="button"
          onClick={() => goToDateKey(addDays(selectedDateKey, 1))}
          className="shrink-0 w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Sonraki gün"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Calendar toggle */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => setCalendarOpen(!calendarOpen)}
            className={`shrink-0 w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-md transition-colors ${
              calendarOpen
                ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
            title="Takvim"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>

          {/* Desktop calendar dropdown */}
          {calendarOpen && (
            <div className="hidden sm:block absolute right-0 top-full mt-2 z-50">
              <InlineCalendar
                selectedDateKey={selectedDateKey}
                availableSet={availableSet}
                onSelect={goToDateKey}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mobile calendar bottom sheet */}
      {calendarOpen && (
        <div className="sm:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCalendarOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bottom-sheet-enter" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="bg-[var(--bg-primary)] rounded-t-2xl p-4">
              <div className="w-10 h-1 bg-[var(--bg-tertiary)] rounded-full mx-auto mb-4" />
              <InlineCalendar
                selectedDateKey={selectedDateKey}
                availableSet={availableSet}
                onSelect={goToDateKey}
                isMobile
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
