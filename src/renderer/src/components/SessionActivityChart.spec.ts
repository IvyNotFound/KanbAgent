import { describe, it, expect } from 'vitest'

// Grouping logic extracted for testing
interface DayRow {
  day: string
  statut: string
  count: number
}

interface DayBars {
  date: string
  completed: number
  blocked: number
  started: number
  total: number
}

function last14Days(refDate: Date): string[] {
  const days: string[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(refDate)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

// Mirrors the Map-based O(n) implementation in SessionActivityChart.vue
function groupByDay(rows: DayRow[], days: string[]): DayBars[] {
  const map = new Map<string, DayRow[]>()
  for (const row of rows) {
    const bucket = map.get(row.day)
    if (bucket) bucket.push(row)
    else map.set(row.day, [row])
  }
  return days.map(day => {
    const dayRows = map.get(day) ?? []
    const completed = dayRows.find(r => r.statut === 'completed')?.count ?? 0
    const blocked = dayRows.find(r => r.statut === 'blocked')?.count ?? 0
    const started = dayRows.find(r => r.statut === 'started')?.count ?? 0
    return { date: day, completed, blocked, started, total: completed + blocked + started }
  })
}

describe('SessionActivityChart grouping logic', () => {
  it('returns 14 days', () => {
    const ref = new Date('2026-03-05T00:00:00Z')
    const days = last14Days(ref)
    expect(days).toHaveLength(14)
    expect(days[0]).toBe('2026-02-20')
    expect(days[13]).toBe('2026-03-05')
  })

  it('groups sessions by day and statut', () => {
    const ref = new Date('2026-03-05T00:00:00Z')
    const days = last14Days(ref)
    const rows: DayRow[] = [
      { day: '2026-03-04', statut: 'completed', count: 3 },
      { day: '2026-03-04', statut: 'blocked', count: 1 },
      { day: '2026-03-05', statut: 'started', count: 2 },
    ]
    const grouped = groupByDay(rows, days)
    const mar04 = grouped.find(d => d.date === '2026-03-04')!
    expect(mar04.completed).toBe(3)
    expect(mar04.blocked).toBe(1)
    expect(mar04.started).toBe(0)
    expect(mar04.total).toBe(4)

    const mar05 = grouped.find(d => d.date === '2026-03-05')!
    expect(mar05.started).toBe(2)
    expect(mar05.completed).toBe(0)
    expect(mar05.total).toBe(2)
  })

  it('returns zero counts for days with no data', () => {
    const ref = new Date('2026-03-05T00:00:00Z')
    const days = last14Days(ref)
    const grouped = groupByDay([], days)
    expect(grouped).toHaveLength(14)
    grouped.forEach(d => {
      expect(d.total).toBe(0)
      expect(d.completed).toBe(0)
      expect(d.blocked).toBe(0)
      expect(d.started).toBe(0)
    })
  })

  it('considers all days empty when rows are outside the 14-day window', () => {
    const ref = new Date('2026-03-05T00:00:00Z')
    const days = last14Days(ref)
    const rows: DayRow[] = [
      { day: '2026-01-01', statut: 'completed', count: 5 },
    ]
    const grouped = groupByDay(rows, days)
    expect(grouped.every(d => d.total === 0)).toBe(true)
  })
})

describe('SuccessRateChart rate computation', () => {
  function computeRate(completed: number, blocked: number): number | null {
    const total = completed + blocked
    return total > 0 ? Math.round((completed / total) * 100) : null
  }

  it('returns null when no terminal sessions', () => {
    expect(computeRate(0, 0)).toBeNull()
  })

  it('returns 100 when all completed', () => {
    expect(computeRate(5, 0)).toBe(100)
  })

  it('returns 0 when all blocked', () => {
    expect(computeRate(0, 3)).toBe(0)
  })

  it('returns 75 for 3 completed / 1 blocked', () => {
    expect(computeRate(3, 1)).toBe(75)
  })

  it('rounds correctly', () => {
    // 1/3 ≈ 33.33 → 33
    expect(computeRate(1, 2)).toBe(33)
    // 2/3 ≈ 66.67 → 67
    expect(computeRate(2, 1)).toBe(67)
  })
})
