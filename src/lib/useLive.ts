import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * Loads `loader()` once, then reloads it whenever any of `tables` changes in
 * Postgres — so a guest placing an order, joining the queue or paying a bill
 * shows up on the manager's screen without anyone hitting refresh.
 *
 * Realtime fires per row, and a single guest checkout writes to `orders` and
 * several `order_items` in quick succession, so reloads are debounced rather
 * than run once per event.
 */
export function useLive<T>(
  loader: () => Promise<T>,
  tables: string[],
  deps: unknown[] = [],
): {
  data: T | null
  error: string
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const mounted = useRef(true)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const run = useCallback(async () => {
    try {
      const result = await loaderRef.current()
      if (!mounted.current) return
      setData(result)
      setError('')
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  const reload = useCallback(() => {
    clearTimeout(debounce.current)
    debounce.current = setTimeout(run, 120)
  }, [run])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    run()

    const key = tables.join('-') || 'none'
    const channel = supabase.channel(`manager-${key}-${Math.random().toString(36).slice(2)}`)

    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => reload())
    }
    channel.subscribe()

    // Realtime can drop silently on a flaky connection; a slow poll behind it
    // means the board is never more than half a minute out of date.
    const poll = setInterval(run, 30000)

    return () => {
      mounted.current = false
      clearTimeout(debounce.current)
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload }
}

/** Small helper for "run this action, show any failure, then refresh". */
export function useAction(reload: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setError('')
      try {
        await fn()
        reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [reload],
  )

  return { run, busy, error, clearError: () => setError('') }
}
