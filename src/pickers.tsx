// One searchable-picker interaction, used wherever a long list of choices (categories, accounts, budget items) would otherwise be a
// dropdown: type to filter, the best match is highlighted, ↑/↓ move, Enter accepts (never submits the form), Tab accepts and moves to the next
// field, Esc closes the list but not the dialog. Mouse and touch work as usual.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface PickOption { id: string; label: string; sub?: string; right?: ReactNode; icon?: ReactNode; disabled?: boolean; keywords?: string }

/** 0 = starts with, 1 = a word starts with, 2 = contains, -1 = no match, 3 = empty search (everything matches, original order). */
export const rankMatch = (text: string, q: string) => {
  if (!q) return 3;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.split(/[\s\-–—·(),/&]+/).some((w) => w.startsWith(q))) return 1;
  return t.includes(q) ? 2 : -1;
};

/** Move keyboard focus to the next control after `el` inside its dialog (what Tab would have done had the list not been open). */
export function focusNextAfter(el: HTMLElement | null) {
  if (!el) return;
  const ae = document.activeElement; if (ae && ae !== document.body && ae !== el) return; // something else (e.g. the next picker, opened for you) already took focus
  const root = el.closest('[role=dialog]') ?? document.body;
  const all = [...root.querySelectorAll<HTMLElement>('input:not([type=hidden]), select, textarea, button, [tabindex]')]
    .filter((e) => !(e as HTMLInputElement).disabled && e.tabIndex >= 0 && e.getClientRects().length > 0);
  const i = all.indexOf(el);
  (i >= 0 ? all[i + 1] : undefined)?.focus();
}

export function SearchSelect({ options, value, onPick, label, testid, placeholder, autoOpen, disabledLabel, className, nothing, inline, searchPlaceholder }: {
  options: PickOption[]; value: string; onPick: (id: string) => void; label: string; testid: string; placeholder: string; autoOpen?: boolean;
  /** Always open, with no trigger of its own (opened by another control, `anchor`). Closing calls onClose and returns focus to the anchor. */
  inline?: { onClose: () => void; anchor: RefObject<HTMLElement | null> };
  /** When set, disabled options are tucked behind this link (label for the count) until you search or expand. */
  disabledLabel?: (n: number, shown: boolean) => string; className?: string; nothing?: string; searchPlaceholder?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [openState, setOpen] = useState(!!autoOpen);
  const open = !!inline || openState;
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.id === value);
  const nq = q.trim().toLowerCase();

  const usable = options.filter((o) => !o.disabled), unusable = options.filter((o) => o.disabled);
  const pool = nq || showAll || !disabledLabel ? options : usable;
  const list = nq
    ? pool.map((o, i) => ({ o, r: Math.min(...[rankMatch(o.label, nq), rankMatch(o.sub ?? '', nq) < 0 ? -1 : rankMatch(o.sub ?? '', nq) + 1, rankMatch(o.keywords ?? '', nq) < 0 ? -1 : 2].filter((x) => x >= 0).concat(99)), i }))
        .filter((x) => x.r < 99).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o)
    : pool;
  const firstEnabled = (from = 0, dir = 1) => { for (let i = from; i >= 0 && i < list.length; i += dir) if (!list[i].disabled) return i; return -1; };
  const active = Math.min(hi, Math.max(0, list.length - 1));

  // Opening highlights what is already chosen (so Enter keeps it), otherwise the first usable match.
  useEffect(() => { if (open) { const s = list.findIndex((o) => o.id === value); setHi(s >= 0 ? s : Math.max(0, firstEnabled())); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [active, open, q]);

  const home = () => (inline ? inline.anchor.current : trigger.current);
  const close = (refocus: boolean) => { setOpen(false); setQ(''); setShowAll(false); inline?.onClose(); if (refocus) setTimeout(() => { const ae = document.activeElement; if (!ae || ae === document.body) home()?.focus(); }, 0); };
  const choose = (o: PickOption | undefined, how: 'click' | 'enter' | 'tab') => {
    if (!o || o.disabled) return;
    onPick(o.id); close(how !== 'tab');
    if (how === 'tab') setTimeout(() => focusNextAfter(home()), 0);
  };
  const step = (dir: 1 | -1) => { const n = firstEnabled(active + dir, dir); if (n >= 0) setHi(n); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(list[active], 'enter'); } // accepts; never submits the form
    else if (e.key === 'Tab' && !e.shiftKey && list[active] && !list[active].disabled) { e.preventDefault(); choose(list[active], 'tab'); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(true); }
  };

  return (
    <div className={className ? `stack gap8 ${className}` : 'stack gap8'} data-testid={testid}>
      {!inline && <button type="button" ref={trigger} className="row between card pick-trigger" aria-label={`${label}: ${cur ? cur.label : 'none chosen'}`} aria-haspopup="listbox" aria-expanded={open} data-testid={`${testid}-btn`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          {cur?.icon}
          <div style={{ minWidth: 0 }}>
            <div className="li-title ellipsis">{cur ? cur.label : <span className="muted">{placeholder}</span>}</div>
            {cur?.sub && <div className="li-sub ellipsis">{cur.sub}</div>}
          </div>
        </div>
        <div className="row gap8">{cur?.right}<ChevronDown size={16} className="muted" /></div>
      </button>}
      {open && (
        <div className="picker fade-in">
          <input className="input" autoFocus placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} autoComplete="off" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={list[active] ? `${uid}-o${active}` : undefined} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} />
          <div role="listbox" id={listId} aria-label={label} ref={listRef} style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {list.length === 0 && <div className="small muted" style={{ padding: 10 }}>{nq ? `Nothing matches “${q}”.` : nothing ?? 'Nothing available.'}</div>}
            {list.map((o, i) => (
              <button type="button" key={o.id} id={`${uid}-o${i}`} role="option" tabIndex={-1} aria-selected={value === o.id} aria-disabled={o.disabled || undefined} data-id={o.id} data-active={i === active ? 'true' : undefined}
                className="li hover pick-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o, 'click')}
                style={{ opacity: o.disabled ? 0.5 : 1, cursor: o.disabled ? 'default' : undefined }}>
                {o.icon}
                <div className="grow" style={{ minWidth: 0 }}><div className="li-title ellipsis" style={{ fontSize: 14, fontWeight: value === o.id ? 680 : undefined }}>{o.label}</div>{o.sub && <div className="li-sub ellipsis" style={{ fontSize: 12 }}>{o.sub}</div>}</div>
                {o.right && <div className="right num small" style={{ fontWeight: 600 }}>{o.right}</div>}
                {value === o.id && <Check size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} aria-label="Selected" />}
              </button>
            ))}
          </div>
          {disabledLabel && unusable.length > 0 && !nq && <button type="button" className="sect-link" style={{ marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>{disabledLabel(unusable.length, showAll)}</button>}
        </div>
      )}
    </div>
  );
}
