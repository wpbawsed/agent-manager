export function fmtTime(ms?: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function fmtDuration(ms?: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} 秒` : `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`
}

export function fmtCost(usd?: number | null): string {
  if (usd == null) return '—'
  return `$${usd < 0.01 && usd > 0 ? usd.toFixed(4) : usd.toFixed(2)}`
}

export function fmtAgo(ms?: number | null): string {
  if (!ms) return '從未'
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分前`
  if (s < 86400) return `${Math.round(s / 3600)} 小時前`
  return `${Math.round(s / 86400)} 天前`
}
