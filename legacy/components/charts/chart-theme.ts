'use client';

export function useChartColors() {
  if (typeof window === 'undefined') {
    return {
      income: '#10b981',
      expense: '#f43f5e',
      grid: 'rgba(0,0,0,0.06)',
      text: '#64748b',
    };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    income: style.getPropertyValue('--chart-income').trim() || '#10b981',
    expense: style.getPropertyValue('--chart-expense').trim() || '#f43f5e',
    grid: style.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.06)',
    text: style.getPropertyValue('--text-muted').trim() || '#64748b',
  };
}
