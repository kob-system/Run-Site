// Coerce with Number() first: a string amount ("12.5") or NaN would otherwise
// slip past `n || 0` and print unformatted (or "$NaN"). Non-numeric → $0.00.
export const formatCurrency = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
