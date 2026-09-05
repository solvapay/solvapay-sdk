'use client'

import React from 'react'
import { cx } from './cx'

export function Section({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <section className={cx('solvapay-mcp-section', className)}>
      {title ? <h2 className="solvapay-mcp-section-title">{title}</h2> : null}
      {children}
    </section>
  )
}

export function Eyebrow({
  children,
  variant = 'rail',
  className,
}: {
  children: React.ReactNode
  variant?: 'step' | 'rail'
  className?: string
}): React.ReactElement {
  return (
    <p className={cx('solvapay-mcp-eyebrow', className)} data-variant={variant}>
      {children}
    </p>
  )
}

export function LineItem({
  label,
  value,
  muted,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  muted?: boolean
  className?: string
}): React.ReactElement {
  return (
    <div
      className={cx('solvapay-mcp-line-item', className)}
      data-muted={muted ? 'true' : undefined}
    >
      <span>{label}</span>
      <span className="solvapay-mcp-line-item-value">{value}</span>
    </div>
  )
}

export interface AmountLadderRow {
  label: React.ReactNode
  value: React.ReactNode
  muted?: boolean
}

export function AmountLadder({
  rows,
  className,
}: {
  rows: readonly AmountLadderRow[]
  className?: string
}): React.ReactElement {
  return (
    <div className={cx('solvapay-mcp-amount-ladder', className)}>
      {rows.map((row, index) => (
        <LineItem key={index} label={row.label} value={row.value} muted={row.muted} />
      ))}
    </div>
  )
}

export function PresetTile({
  amount,
  credits,
  selected,
  onClick,
  className,
}: {
  amount: React.ReactNode
  credits: React.ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      className={cx('solvapay-mcp-preset-tile', className)}
      data-state={selected ? 'selected' : undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="solvapay-mcp-preset-tile-amount">{amount}</span>
      <span className="solvapay-mcp-preset-tile-credits">{credits}</span>
    </button>
  )
}

export function PlanRow({
  name,
  description,
  price,
  selected,
  current,
  disabled,
  state,
  onClick,
  className,
  ...rest
}: {
  name: React.ReactNode
  description?: React.ReactNode
  price: React.ReactNode
  selected?: boolean
  current?: boolean
  disabled?: boolean
  state?: 'idle' | 'selected' | 'current' | 'disabled'
  onClick?: () => void
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>): React.ReactElement {
  const dataState = state ?? (selected ? 'selected' : undefined)
  return (
    <button
      type="button"
      {...rest}
      className={cx('solvapay-mcp-plan-row', className)}
      data-state={dataState}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
    >
      <span className="solvapay-mcp-plan-row-body">
        <span className="solvapay-mcp-plan-row-name">
          {name}
          {current ? <StatusDot label="Current" /> : null}
        </span>
        {description ? (
          <span className="solvapay-mcp-plan-row-description">{description}</span>
        ) : null}
      </span>
      <span className="solvapay-mcp-plan-row-meta">
        <span className="solvapay-mcp-plan-row-price">{price}</span>
        <span className="solvapay-mcp-plan-row-check" aria-hidden>
          ✓
        </span>
      </span>
    </button>
  )
}

export function StatusDot({
  label,
  className,
}: {
  label?: string
  className?: string
}): React.ReactElement {
  return <span className={cx('solvapay-mcp-status-dot', className)}>{label}</span>
}

export function Pill({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return <span className={cx('solvapay-mcp-pill', className)}>{children}</span>
}

export function sanitizeDecimalInput(raw: string): string {
  const normalized = raw.includes(',') && !raw.includes('.') ? raw.replace(',', '.') : raw
  let next = normalized.replace(/[^0-9.]/g, '')
  const parts = next.split('.')
  if (parts.length > 2) {
    next = `${parts[0]}.${parts.slice(1).join('')}`
  }
  return next
}

export function Field({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  disabled,
  inputMode = 'decimal',
  ariaLabel,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  prefix?: string
  suffix?: string
  placeholder?: string
  disabled?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  ariaLabel?: string
  className?: string
}): React.ReactElement {
  return (
    <div className={cx('solvapay-mcp-field', className)}>
      <label className="solvapay-mcp-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="solvapay-mcp-field-control">
        {prefix ? <span className="solvapay-mcp-field-affix">{prefix}</span> : null}
        <input
          id={id}
          className="solvapay-mcp-field-input"
          aria-label={ariaLabel ?? label}
          value={value}
          disabled={disabled}
          inputMode={inputMode}
          placeholder={placeholder}
          onChange={event =>
            onChange(
              inputMode === 'decimal' || inputMode === 'numeric'
                ? sanitizeDecimalInput(event.target.value)
                : event.target.value,
            )
          }
        />
        {suffix ? <span className="solvapay-mcp-field-affix">{suffix}</span> : null}
      </div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  className?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('solvapay-mcp-toggle', className)}
      data-state={checked ? 'on' : 'off'}
      onClick={() => onChange(!checked)}
    >
      <span className="solvapay-mcp-toggle-knob" />
    </button>
  )
}

export function LedgerRow({
  cells,
  className,
}: {
  cells: readonly { content: React.ReactNode; align?: 'left' | 'right' }[]
  className?: string
}): React.ReactElement {
  return (
    <div className={cx('solvapay-mcp-ledger-row', className)}>
      {cells.map((cell, index) => (
        <span key={index} data-align={cell.align}>
          {cell.content}
        </span>
      ))}
    </div>
  )
}

export function AttributionFooter({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return <div className={cx('solvapay-mcp-attribution', className)}>{children}</div>
}

export function SplitRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return <div className={cx('solvapay-mcp-split-row', className)}>{children}</div>
}
