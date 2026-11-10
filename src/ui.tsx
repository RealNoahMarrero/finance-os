import { useEffect, useRef, type ReactNode } from 'react';
import {
  House, Car, GraduationCap, Droplets, Zap, Wifi, Smartphone, ShieldCheck, Tv, ShoppingBasket, Fuel, Wrench, HeartPulse, Utensils, Film,
  ShoppingBag, Gift, Umbrella, Hammer, Plane, CreditCard, Landmark, Banknote, Wallet, PiggyBank, X, Check, Info, TriangleAlert, Sun, Moon, Monitor,
} from 'lucide-react';
import { cn } from './lib';
import type { Account, Category } from './data';

const ICONS: Record<string, typeof House> = {
  home: House, car: Car, grad: GraduationCap, droplets: Droplets, zap: Zap, wifi: Wifi, phone: Smartphone, shield: ShieldCheck, tv: Tv,
  cart: ShoppingBasket, fuel: Fuel, wrench: Wrench, heart: HeartPulse, utensils: Utensils, film: Film, bag: ShoppingBag, gift: Gift,
  umbrella: Umbrella, hammer: Hammer, plane: Plane, card: CreditCard,
};
export function CatIcon({ k, size }: { k: string; size?: number }) {
  const I = ICONS[k];
  if (!I && k) return <span className="emoji-ico" aria-hidden="true" style={size ? { fontSize: size } : undefined}>{k}</span>;
  const W = I || Wallet;
  return <W size={size} />;
}
export function AccountIcon({ type }: { type: Account['type'] }) {
  const I = type === 'credit' ? CreditCard : type === 'savings' ? PiggyBank : type === 'cash' ? Banknote : Landmark;
  return <I />;
}
export const catIconFor = (c?: Category | null) => (c ? <CatIcon k={c.icon} /> : <Wallet />);

/** $1,234.56 with softened cents. Size comes from the parent's font-size. */
export function Money({ v, sign, className, cents = true, tone }: { v: number; sign?: boolean; className?: string; cents?: boolean; tone?: 'auto' }) {
  const neg = v < 0;
  const abs = Math.abs(v);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const cc = String(abs % 100).padStart(2, '0');
  return (
    <span className={cn('money', tone === 'auto' && (neg ? 'neg' : v > 0 ? 'pos' : ''), className)}>
      {neg ? '−' : sign && v > 0 ? '+' : ''}${dollars}{cents && <span className="cents">.{cc}</span>}
    </span>
  );
}

/** The three kinds of money, always labelled the same way. */
export function Kind({ kind, label }: { kind: 'actual' | 'planned' | 'projected'; label?: string }) {
  const map = { actual: ['dot actual', 'Actual'], planned: ['dot planned', 'Planned'], projected: ['dot proj', 'Projected'] } as const;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className={map[kind][0]} />{label ?? map[kind][1]}</span>;
}
export function MoneyLegend() {
  return (
    <div className="legend" aria-label="How to read the figures">
      <span><Kind kind="actual" label="Actual · in your accounts" /></span>
      <span><Kind kind="planned" label="Planned · budgeted" /></span>
      <span><Kind kind="projected" label="Projected · not yet real" /></span>
    </div>
  );
}

export function Sheet({ title, onClose, children, footer, wide, sub }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; sub?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus moves into the dialog on open, is kept inside while it is open (Tab wraps), and returns to what opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select');
    if (first) first.focus(); else ref.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const a = document.activeElement as HTMLElement;
      if (e.shiftKey && (a === f[0] || !ref.current.contains(a))) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (a === f[f.length - 1] || !ref.current.contains(a))) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} className={cn('sheet', wide && 'wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="grab" />
        <div className="sheet-head">
          <div>
            <div className="sheet-title">{title}</div>
            {sub && <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <div className="ico">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options, block }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[]; block?: boolean }) {
  return (
    <div className={cn('seg', block && 'block')} role="group">
      {options.map((o) => (
        <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function ThemeSwitch({ theme, setTheme }: { theme: string; setTheme: (t: 'light' | 'dark' | 'system') => void }) {
  const opts = [['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'Auto']] as const;
  return (
    <div className="seg block theme-seg" role="group" aria-label="Theme">
      {opts.map(([v, I, l]) => (
        <button key={v} aria-pressed={theme === v} onClick={() => setTheme(v)}><I />{l}</button>
      ))}
    </div>
  );
}

export function Callout({ tone, children, icon }: { tone?: 'proj' | 'warn' | 'neg' | 'planned'; children: ReactNode; icon?: ReactNode }) {
  return <div className={cn('callout', tone)}>{icon ?? (tone === 'warn' || tone === 'neg' ? <TriangleAlert /> : <Info />)}<div>{children}</div></div>;
}

export function StatusPill({ status, children }: { status: 'ok' | 'warn' | 'late' | 'proj' | 'planned' | 'muted'; children: ReactNode }) {
  const cls = { ok: 'pill pos', warn: 'pill warn', late: 'pill neg', proj: 'pill proj', planned: 'pill planned', muted: 'pill' }[status];
  return <span className={cls}>{status === 'ok' && <Check />}{children}</span>;
}
