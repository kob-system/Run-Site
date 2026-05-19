import React from 'react'
import { formatCurrency } from '../utils/formatCurrency'

export default function BudgetBar({ label, spent, budget }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const colorClass = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : ''

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#888', marginBottom: '4px' }}>
        <span>{label}</span>
        <span>{formatCurrency(spent)} / {formatCurrency(budget)}</span>
      </div>
      <div className="budget-bar">
        <div className={'budget-bar-fill ' + colorClass} style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}