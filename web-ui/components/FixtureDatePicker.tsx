"use client"

import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type FixtureDatePickerProps = {
  availableDateKeys: string[]
  selectedDateKey: string
}

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const fromDateKey = (dateKey: string) => new Date(`${dateKey}T00:00:00`)

const formatDateLabel = (dateKey: string) =>
  fromDateKey(dateKey).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

const TR_DAY_NAMES = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']
const TR_MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

function InlineCalendar({
  selectedDateKey,
  availableSet,
  onSelect,
}: {
  selectedDateKey: string
  availableSet: Set<string>
  onSelect: (dateKey: string) => void
}) {
  const selectedDate = fromDateKey(selectedDateKey)
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth())
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear())

  const todayKey = toDateKey(new Date())

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1)
    const lastDay = new Date(viewYear, viewMonth + 1, 0)
    const startOffset = (firstDay.getDay() + 6) % 7 // Monday-start
    const totalDays = lastDay.getDate()

    const days: { date: Date; dateKey: string; isCurrentMonth: boolean }[] = []

    // Previous month days
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(viewYear, viewMonth, -i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: false })
    }

    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(viewYear, viewMonth, i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: true })
    }

    // Fill remaining cells to complete 6 rows
    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(viewYear, viewMonth + 1, i)
      days.push({ date: d, dateKey: toDateKey(d), isCurrentMonth: false })
    }

    return days
  }, [viewMonth, viewYear])

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl p-3 w-full max-w-[320px]">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={goToPrevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">
          {TR_MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          type="button"
          onClick={goToNextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          →
        </button>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 mb-1">
        {TR_DAY_NAMES.map((name) => (
          <div key={name} className="text-center text-[10px] font-medium text-[var(--text-muted)] py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
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
                relative w-full aspect-square flex items-center justify-center text-xs font-medium rounded-lg transition-colors
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
                <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--accent-win)]" />
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
  const selectedDate = useMemo(() => fromDateKey(selectedDateKey), [selectedDateKey])

  const previousDateKey = toDateKey(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - 1)
  )
  const nextDateKey = toDateKey(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1)
  )

  const goToDateKey = (dateKey: string) => {
    const params = new URLSearchParams(searchParams?.toString())
    params.set('date', dateKey)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-4 mb-6 card-glow">
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
        <div>
          <div className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Seçili gün</div>
          <div className="text-lg font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mt-1">
            {formatDateLabel(selectedDateKey)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={() => goToDateKey(previousDateKey)}
              className="px-3 py-2 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              ← Önceki gün
            </button>
            <button
              type="button"
              onClick={() => goToDateKey(nextDateKey)}
              className="px-3 py-2 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Sonraki gün →
            </button>
          </div>
        </div>

        <InlineCalendar
          selectedDateKey={selectedDateKey}
          availableSet={availableSet}
          onSelect={goToDateKey}
        />
      </div>
    </div>
  )
}
