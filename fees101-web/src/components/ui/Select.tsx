'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/*
 * Select — the app's own dropdown, used in place of a native <select> so the
 * open menu renders in the Modernist system rather than the OS/browser style.
 *
 * Near drop-in for `<select value onChange>`: `onChange` hands back the value
 * string (not a change event). The trigger carries the caller's `className`
 * and `id` so it swaps in where a `.m-select` was without shifting layout; the
 * menu is a portalled, fixed-position panel so it never disturbs the page flow
 * and can flip above the trigger when there is no room below.
 */

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  id?: string
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  /* Renders a hidden input so the value is picked up by native form submission. */
  name?: string
  /* `ink` styles the control for a dark card (transparent trigger, dark menu). */
  tone?: 'light' | 'ink'
}

type Pos = { left: number; width: number; top?: number; bottom?: number }

const MENU_MAX_HEIGHT = 320

export default function Select({
  value,
  onChange,
  options,
  id,
  className,
  style,
  disabled,
  placeholder,
  ariaLabel,
  name,
  tone = 'light',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pos, setPos] = useState<Pos | null>(null)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef<{ query: string; at: number }>({ query: '', at: 0 })

  const listboxId = useId()
  const optionId = (index: number) => `${listboxId}-opt-${index}`

  const selectedIndex = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value],
  )
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const ink = tone === 'ink'

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      const n = options.length
      for (let step = 0; step < n; step++) {
        const i = (from + dir * step + n * 10) % n
        if (!options[i].disabled) return i
      }
      return -1
    },
    [options],
  )

  const measure = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const spaceAbove = r.top
    const flipUp = spaceBelow < Math.min(MENU_MAX_HEIGHT, 220) && spaceAbove > spaceBelow
    setPos(
      flipUp
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
        : { left: r.left, width: r.width, top: r.bottom + 4 },
    )
  }, [])

  const openMenu = useCallback(
    (active: number) => {
      if (disabled) return
      measure()
      setActiveIndex(active)
      setOpen(true)
    },
    [disabled, measure],
  )

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setActiveIndex(-1)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const pick = useCallback(
    (index: number) => {
      const opt = options[index]
      if (!opt || opt.disabled) return
      onChange(opt.value)
      close()
    },
    [options, onChange, close],
  )

  // Keep the menu glued to the trigger while open, and reposition on scroll/resize.
  useEffect(() => {
    if (!open) return
    measure()
    const onScroll = () => measure()
    const onResize = () => measure()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, measure])

  // Bring the active option into view as the user arrows through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const el = menuRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`)
    el?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex])

  // Close on a click anywhere outside the trigger and menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  const runTypeahead = useCallback(
    (key: string) => {
      const now = Date.now()
      const q = now - typeahead.current.at > 600 ? key : typeahead.current.query + key
      typeahead.current = { query: q, at: now }
      const lower = q.toLowerCase()
      const match = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(lower))
      if (match >= 0) {
        if (open) setActiveIndex(match)
        else onChange(options[match].value)
      }
    },
    [options, open, onChange],
  )

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabled(options.length - 1, -1))
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) runTypeahead(e.key)
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(i => firstEnabled(i < 0 ? 0 : i + 1, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(i => firstEnabled(i < 0 ? options.length - 1 : i - 1, -1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(firstEnabled(0, 1))
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(firstEnabled(options.length - 1, -1))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (activeIndex >= 0) pick(activeIndex)
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'Tab':
        close(false)
        break
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) runTypeahead(e.key)
    }
  }

  function onBlur(e: React.FocusEvent) {
    setFocused(false)
    // Close when focus leaves the control entirely (e.g. tabbing away). The menu
    // keeps focus on the trigger, so a next target inside the menu never happens.
    const next = e.relatedTarget as Node | null
    if (next && (triggerRef.current?.contains(next) || menuRef.current?.contains(next))) return
    if (open) close(false)
  }

  const triggerClass = ink ? className : ['m-select', className].filter(Boolean).join(' ')
  const triggerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    // The system focus treatment: a signal-red ring at 2px offset. Shown on any
    // focus (as the native field does), and also covered by `.m-select:focus`
    // for the light tone; set here so the ink tone gets it too.
    ...(focused ? { outline: '2px solid var(--color-signal)', outlineOffset: 2 } : null),
    ...(ink
      ? {
          width: '100%',
          minHeight: 40,
          padding: '9px 12px',
          fontSize: 14,
          background: 'transparent',
          color: 'var(--color-paper)',
          border: '2px solid var(--color-neutral-600)',
          borderRadius: 0,
        }
      : null),
    ...style,
  }

  const label = selected?.label ?? ''
  const showPlaceholder = !selected

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={triggerClass}
        style={triggerStyle}
        onClick={() => (open ? close(false) : openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1)))}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: showPlaceholder ? 'var(--color-neutral-700)' : undefined,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {showPlaceholder ? (placeholder ?? '') : label}
        </span>
        <Chevron open={open} ink={ink} />
      </button>

      {name !== undefined && <input type="hidden" name={name} value={value} />}

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            className="m-anim-fade"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              width: pos.width,
              maxHeight: MENU_MAX_HEIGHT,
              overflowY: 'auto',
              margin: 0,
              padding: 0,
              listStyle: 'none',
              zIndex: 1000,
              background: ink ? 'var(--color-neutral-900)' : 'var(--color-paper)',
              color: ink ? 'var(--color-paper)' : 'var(--color-ink)',
              border: `2px solid ${ink ? 'var(--color-neutral-600)' : 'var(--color-ink)'}`,
              borderRadius: 0,
              fontSize: 14,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {options.map((opt, index) => {
              const isSelected = opt.value === value
              const isActive = index === activeIndex
              let background = 'transparent'
              if (isSelected) background = ink ? 'var(--color-paper)' : 'var(--color-ink)'
              else if (isActive && !opt.disabled)
                background = ink
                  ? 'color-mix(in srgb, var(--color-paper) 12%, transparent)'
                  : 'color-mix(in srgb, var(--color-ink) 8%, transparent)'

              let color: string | undefined
              if (isSelected) color = ink ? 'var(--color-ink)' : 'var(--color-paper)'
              else if (opt.disabled) color = ink ? 'var(--color-neutral-500)' : 'var(--color-neutral-500)'

              return (
                <li
                  key={opt.value || `opt-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  // Keep focus on the trigger when the pointer presses an option.
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(index)}
                  onClick={() => pick(index)}
                  style={{
                    padding: '9px 12px',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    background,
                    color,
                    fontWeight: isSelected ? 600 : 400,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {opt.label}
                </li>
              )
            })}
          </ul>,
          document.body,
        )}
    </>
  )
}

function Chevron({ open, ink }: { open: boolean; ink: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform var(--dur-tick) var(--ease-out)',
        color: ink ? 'var(--color-paper)' : 'var(--color-ink)',
      }}
    >
      <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  )
}
