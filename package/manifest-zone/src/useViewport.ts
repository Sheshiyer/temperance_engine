import { useEffect, useState } from 'react'

export const COMPACT_QUERY = '(max-width: 1279px)'

export function useCompact(query = COMPACT_QUERY): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setCompact(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [query])
  return compact
}
