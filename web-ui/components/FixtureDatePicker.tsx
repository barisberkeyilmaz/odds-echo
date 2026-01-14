"use client"

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

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

export default function FixtureDatePicker({ availableDateKeys, selectedDateKey }: FixtureDatePickerProps) {
  const router = useRouter()
  const availableSet = useMemo(() => new Set(availableDateKeys), [availableDateKeys])
  const selectedDate = useMemo(() => fromDateKey(selectedDateKey), [selectedDateKey])

  const previousDateKey = toDateKey(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - 1)
  )
  const nextDateKey = toDateKey(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1)
  )

  const goToDateKey = (dateKey: string) => {
    router.push(`/?date=${dateKey}`)
  }

  const handleSelect = (date: Date | null) => {
    if (!date) return
    const dateKey = toDateKey(date)
    goToDateKey(dateKey)
  }

  const getDayClassName = (date: Date) => {
    const dateKey = toDateKey(date)
    return availableSet.has(dateKey) ? 'fixture-day--available' : ''
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-gray-500">Seçili gün</div>
          <div className="text-lg font-semibold text-gray-900">
            {formatDateLabel(selectedDateKey)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              onClick={() => goToDateKey(previousDateKey)}
              className="px-3 py-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ← Önceki gün
            </button>
            <button
              type="button"
              onClick={() => goToDateKey(nextDateKey)}
              className="px-3 py-2 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Sonraki gün →
            </button>
          </div>
        </div>

        <DatePicker
          inline
          selected={selectedDate}
          onChange={handleSelect}
          calendarClassName="fixture-calendar"
          dayClassName={getDayClassName}
          showPopperArrow={false}
        />
      </div>
    </div>
  )
}
