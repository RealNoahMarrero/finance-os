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
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead title="Settings" />
      <div className="group-h"><h2>Appearance</h2></div>
      <div className="group"><div className="rowx"><ThemeSwitch theme={theme} setTheme={setTheme} /></div></div>

      <div className="group-h"><h2>Data</h2></div>
      <div className="group">
        <div className="rowx"><div className="grow"><div className="li-title">Export everything</div>
          <div className="li-sub">One JSON file{hb.accounts + hb.transactions > 0 ? `, including ${hb.transactions} hidden Business transactions` : ''}.</div></div>
          <button className="btn" onClick={async () => { try { await exportEverything(); toast('Export downloaded'); } catch { toast('Export failed — please try again'); } }}><Download />Export</button></div>
        <div className="rowx"><div className="grow"><div className="li-title">Opening balances</div><div className="li-sub">Set or change each account’s verified starting balance.</div></div>
          <button className="btn" onClick={() => openModal({ type: 'cutover' })}><Scale />Set…</button></div>
        {archived > 0 && <div className="rowx"><div className="grow"><div className="li-title">Archived accounts</div><div className="li-sub">{archived} hidden, history kept.</div></div><a className="btn" href="#/accounts">View</a></div>}
        <div className="rowx"><div className="grow"><div className="li-title">Archived Plan items</div><div className="li-sub">Restore an item you archived.</div></div><a className="btn" href="#/plan?filter=archived">View</a></div>
      </div>

      <div className="group-h"><h2>Account</h2></div>
      <div className="group"><div className="rowx"><div className="grow"><div className="li-title">Signed in</div><div className="li-sub">{email}</div></div>
        <button className="btn" onClick={() => { void signOut(); }}><LogOut />Sign out</button></div></div>
      <p className="xs muted" style={{ marginTop: 14 }}>Balances are what you record — Finances isn’t connected to your bank.</p>
    </div>
  );
}
