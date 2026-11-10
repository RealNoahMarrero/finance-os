import { Download, LogOut, Scale } from 'lucide-react';
import { useStore } from '../store';
import { exportEverything } from '../db';
import { ThemeSwitch } from '../ui';
import { PageHead } from '../shared';

export function Settings() {
  const { email, signOut, data, toast, theme, setTheme, openModal } = useStore();
  const hb = data.hiddenBusiness;
  const archived = data.allAccounts.filter((a) => a.archived).length;
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHead title="Settings" />
      <div className="grid" style={{ gap: 16 }}>
        <section className="card pad" aria-label="Appearance">
          <div className="sect-head"><h2 className="sect-title">Appearance</h2></div>
          <ThemeSwitch theme={theme} setTheme={setTheme} />
          <div className="xs muted" style={{ marginTop: 8 }}>Auto follows your device’s light or dark setting.</div>
        </section>

        <section className="card pad" aria-label="Your data">
          <div className="sect-head"><h2 className="sect-title">Your data</h2></div>
          <div className="rowx"><div className="grow"><div className="li-title">Export everything</div>
            <div className="li-sub">One JSON file with every record{hb.accounts + hb.transactions > 0 ? `, including ${hb.transactions} hidden Business transactions` : ''}.</div></div>
            <button className="btn" onClick={async () => { try { await exportEverything(); toast('Export downloaded'); } catch { toast('Export failed — please try again'); } }}><Download />Export</button></div>
          <div className="rowx"><div className="grow"><div className="li-title">Opening balances</div><div className="li-sub">Set or change the verified starting balance for each account.</div></div>
            <button className="btn" onClick={() => openModal({ type: 'cutover' })}><Scale />Set…</button></div>
          {archived > 0 && <div className="rowx"><div className="grow"><div className="li-title">Archived accounts</div><div className="li-sub">{archived} hidden, history kept.</div></div><a className="btn" href="#/accounts">View</a></div>}
          {(hb.accounts + hb.transactions) > 0 && <div className="xs muted" style={{ marginTop: 8 }}>Business records ({hb.transactions} transactions) are hidden from every screen but safely stored.</div>}
        </section>

        <section className="card pad" aria-label="Account">
          <div className="sect-head"><h2 className="sect-title">Account</h2></div>
          <div className="rowx"><div className="grow"><div className="li-title">Signed in</div><div className="li-sub">{email}</div></div>
            <button className="btn" onClick={() => { void signOut(); }}><LogOut />Sign out</button></div>
        </section>

        <p className="xs muted">Balances are what you record — Finances isn’t connected to your bank.</p>
      </div>
    </div>
  );
}
