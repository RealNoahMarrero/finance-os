'use client';

import { AlertTriangle, TrendingUp } from 'lucide-react';
import { formatMoney, MONEY_EPSILON } from '@/lib/money';

type RtaBannerExtrasProps = {
  readyToAssign: number;
  assignableReadyToAssign: number;
  totalOverspent: number;
  pendingInflow?: number;
  guaranteedInflow?: number;
  anticipatedInflow?: number;
  projectedAssignableReadyToAssign?: number;
  conservativeAssignableRta?: number;
};

export function RtaBannerExtras({
  readyToAssign,
  totalOverspent,
  pendingInflow = 0,
  guaranteedInflow = 0,
  anticipatedInflow = 0,
  projectedAssignableReadyToAssign,
  conservativeAssignableRta,
}: RtaBannerExtrasProps) {
  const showOverspend = totalOverspent > MONEY_EPSILON;
  const showProjected = pendingInflow > 0 && conservativeAssignableRta != null;

  if (!showOverspend && !showProjected) return null;

  return (
    <div className="z-10 mt-3 flex w-full max-w-md flex-col gap-2 font-medium leading-snug">
      {showOverspend && (
        <div className="rounded-xl border border-red-300/35 bg-red-950/30 px-3 py-2.5 text-left backdrop-blur-sm">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-100/90">
            <AlertTriangle size={12} className="shrink-0" />
            Overspent envelopes
          </p>
          <p className="text-xs text-red-50/95">
            <span className="font-black text-white">
              ${formatMoney(totalOverspent)}
            </span>{' '}
            needs coverage · ${formatMoney(readyToAssign)} before coverage
          </p>
        </div>
      )}

      {showProjected && (
        <div className="rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-left backdrop-blur-sm">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/75">
            <TrendingUp size={12} className="shrink-0 text-emerald-200" />
            Expected income
          </p>
          <div className="space-y-0.5 text-xs text-white/85">
            <p>
              If guaranteed arrives:{' '}
              <span className="font-black text-white">
                ${formatMoney(conservativeAssignableRta!)}
              </span>
            </p>
            {anticipatedInflow > 0 &&
              projectedAssignableReadyToAssign != null &&
              guaranteedInflow != null && (
                <p>
                  If all pending (${formatMoney(guaranteedInflow)} + $
                  {formatMoney(anticipatedInflow)}):{' '}
                  <span className="font-black text-white">
                    ${formatMoney(projectedAssignableReadyToAssign)}
                  </span>
                </p>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Primary RTA figure: assignable when overspent exists, otherwise standard RTA. */
export function displayReadyToAssign(
  readyToAssign: number,
  assignableReadyToAssign: number,
  totalOverspent: number
) {
  return totalOverspent > MONEY_EPSILON ? assignableReadyToAssign : readyToAssign;
}

/** Banner / hero color from the displayed assignable amount. */
export function rtaIsNegative(
  readyToAssign: number,
  assignableReadyToAssign: number,
  totalOverspent: number
) {
  return displayReadyToAssign(readyToAssign, assignableReadyToAssign, totalOverspent) < 0;
}
