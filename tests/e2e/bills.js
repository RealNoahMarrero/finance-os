const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q=(s)=>execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "${s.replace(/"/g,'\\"')}"`).toString().trim();
let pass=0,fail=0;const ck=(n,ok,x)=>{ok?pass++:fail++;console.log((ok?'PASS ':'FAIL ')+n+(ok?'':' :: '+x))};
(async()=>{const b=await chromium.launch();const errs=[];
const mk=async(vp)=>{const c=await b.newContext({viewport:vp});const p=await c.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto('http://localhost:4173/');await p.fill('#em','owner@test.local');await p.fill('#pw','correct-horse-battery');await p.click('button.primary');await p.waitForSelector('.page');return p};
const p=await mk({width:1440,height:900});
const snap=()=>q("select (select count(*) from transactions)||'|'||(select sum(amount) from transactions)||'|'||(select string_agg(balance::text,',' order by id) from accounts)||'|'||(select count(*) from bill_payments)");
const pressed=async()=>(await p.locator('.sheet .field:has(label:text-matches("Account|From|Deposit to")) .chip[aria-pressed=true]').first().textContent()).trim();
const closeSheet=async()=>{await p.keyboard.press('Escape');await p.waitForTimeout(400);if(await p.locator('.sheet').count())await p.click('.sheet [aria-label="Close"]').catch(()=>{});};
// ── A3 account defaults ──
const acctId=q("select id from accounts where name='FIXED BILLS' or name ilike 'fixed bills%' limit 1");
await p.evaluate((id)=>location.hash='/accounts/'+id,acctId);await p.waitForSelector('[data-testid=edit-account]');
await p.click('.sidebar button:has-text("Add transaction")');await p.waitForSelector('#payee');
const fb=(await p.locator('.sheet .chip[aria-pressed=true]').allTextContents()).join('|');
ck('Expense defaults to the account page it was opened from',/fixed bills/i.test(await pressed()),fb);
await p.click('.sheet .seg button:has-text("Income"), .sheet [role=tab]:has-text("Income"), .sheet button:text-is("Income")');
ck('Income keeps it as Deposit to',/fixed bills/i.test(await pressed())&&(await p.textContent('.sheet')).includes('Deposit to'));
await p.click('.sheet button:text-is("Transfer")');
ck('Transfer keeps it as From',/fixed bills/i.test(await pressed())&&(await p.textContent('.sheet')).includes('From'));
await p.click('.sheet button:text-is("Expense")');
const other=await p.locator('.sheet .field:has(label:text-is("Account")) .chip[aria-pressed=false]').first();const otherName=(await other.textContent()).trim();await other.click();
await p.click('.sheet button:text-is("Income")');await p.click('.sheet button:text-is("Expense")');
ck('a deliberate manual choice is kept when switching types',(await pressed())===otherName,await pressed());
await closeSheet();
await p.evaluate(()=>location.hash='/');await p.waitForSelector('[data-testid=ov-rta]');
await p.keyboard.press('n');await p.waitForSelector('#payee');
ck('global Add Transaction keeps its normal default (no stale account)',!/fixed bills/i.test(await pressed()),await pressed());
await closeSheet();
// ── A2 advance prompt ──
const addTxn=async(payee,cat,amt)=>{await p.evaluate(()=>location.hash='/');await p.waitForSelector('[data-testid=ov-rta]');await p.keyboard.press('n');await p.waitForSelector('#payee');await p.fill('#payee',payee);await p.fill('input[aria-label=Amount]',amt);
 await p.click('.sheet button:has-text("All categories")');await p.selectOption('select[aria-label="All categories"]',{label:cat});await p.click('.sheet button.primary')};
const billId=q("select id from categories where name='Spectrum - Internet'");const due0=q("select due_date from categories where id="+billId);const amt=q("select coalesce(bill_amount,target_amount) from categories where id="+billId);
console.log('bill',billId,due0,amt);
const t0=snap();
// partial payment: no prompt
await addTxn('Spectrum partial','Spectrum - Internet',String(Number(amt)-1));await p.waitForTimeout(1200);
ck('a partial payment does not offer to advance the bill',(await p.locator('[data-testid=advance-due]').count())===0&&q("select due_date from categories where id="+billId)===due0);
// full payment: prompt, Keep
await addTxn('Spectrum','Spectrum - Internet',amt);await p.waitForSelector('[data-testid=advance-due]');
const label=await p.textContent('[data-testid=advance-due]');console.log(label);
ck('full payment offers Advance / Keep',/Advance to/.test(label)&&(await p.locator('[data-testid=keep-due]').count())===1);
await p.click('[data-testid=keep-due]');await p.waitForTimeout(1200);
ck('Keep leaves the due date and payment history alone',q("select due_date from categories where id="+billId)===due0&&q("select count(*) from bill_payments where category_id="+billId)==='0');
// again: Advance
await addTxn('Spectrum','Spectrum - Internet',amt);await p.waitForSelector('[data-testid=advance-due]');await p.click('[data-testid=advance-due]');await p.waitForTimeout(1500);
const due1=q("select due_date from categories where id="+billId);
ck('Advance moves it one month, keeping the day',due1>due0&&due1.slice(8)===due0.slice(8),due0+' -> '+due1);
ck('payment is recorded once, linked to the transaction',q("select count(*) from bill_payments where category_id="+billId+" and due_date='"+due0+"' and transaction_id is not null")==='1');
await p.click('.toast button:has-text("Undo")');await p.waitForTimeout(1500);
ck('Undo restores the due date and removes the link, keeping the transaction',q("select due_date from categories where id="+billId)===due0&&q("select count(*) from bill_payments where category_id="+billId)==='0'&&Number(q("select count(*) from transactions where payee='Spectrum'"))>=2);
// no prompt for non-bill category / debt
await addTxn('Lunch','Groceries','5');await p.waitForTimeout(1200);
ck('ordinary categories never prompt',(await p.locator('[data-testid=advance-due]').count())===0);
// ── A1 archive ──
const cat2=q("select id from categories where name='Spectrum - Mobile'");const s1=snap();
await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('.brow');
await p.click('.brow:has-text("Spectrum - Mobile")');await p.waitForSelector('[data-testid=archive-bill]');
await p.click('[data-testid=archive-bill]');await p.waitForSelector('[data-testid=archive-category-option]');
console.log((await p.textContent('[data-testid=archive-category-option]')).replace(/\s+/g,' '));
await p.click('.sheet button.primary:has-text("Archive bill")');await p.waitForTimeout(1500);
ck('archive flags the bill and pauses it',q("select bill_archived||'|'||bill_paused||'|'||is_hidden from categories where id="+cat2)==='true|true|false'||q("select bill_archived||'|'||bill_paused||'|'||is_hidden from categories where id="+cat2)==='t|t|f');
ck('archive changes no transactions, payments or balances',snap()===s1);
await p.evaluate(()=>location.hash='/plan/bills');await p.waitForSelector('[data-testid=archived-bills]');
ck('archived bill is gone from active bills and upcoming',!(await p.locator('.list .li:has-text("Spectrum - Mobile")').filter({hasNot:p.locator('[data-testid=archived-bills]')}).count()&&false)&&(await p.locator('section .li:has-text("Spectrum - Mobile")').count())===0);
await p.click('[data-testid=archived-bills] summary');
ck('Archived bills view lists it with Restore',(await p.locator('[data-testid=archived-bills] .li:has-text("Spectrum - Mobile") button:has-text("Restore")').count())===1);
await p.click('[data-testid=archived-bills] button:has-text("Restore")');await p.waitForTimeout(1500);
ck('restore brings it back active with an unpaid future date',q("select bill_archived||'|'||bill_paused from categories where id="+cat2).replace(/true/g,'t').replace(/false/g,'f')==='f|f'&&q("select due_date>=current_date from categories where id="+cat2)==='t');
ck('restore changes no history',snap()===s1);
// category archive via bill sheet: only when allowed
await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('.brow');
await p.click('.brow:has-text("Spectrum - Mobile")');await p.click('[data-testid=archive-bill]');await p.waitForSelector('[data-testid=archive-category-option]');
const cbDisabled=await p.locator('[data-testid=archive-category-option] input').isDisabled();console.log('category option disabled:',cbDisabled);
if(!cbDisabled){await p.check('[data-testid=archive-category-option] input');}
await p.click('.sheet button.primary:has-text("Archive bill")');await p.waitForTimeout(1500);
const hid=q("select is_hidden from categories where id="+cat2);console.log('hidden',hid);
ck('category archived only when opted in and eligible',(cbDisabled&&hid==='f')||(!cbDisabled&&hid==='t'));
if(hid==='t'){
 await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('[data-testid=archived-categories]');
 ck('archived category is out of the active budget list',(await p.locator('.brow:has-text("Spectrum - Mobile")').count())===0);
 await p.keyboard.press('n');await p.waitForSelector('#payee');await p.click('.sheet button:has-text("All categories")');
 ck('archived category is not offered for new transactions',!(await p.locator('select[aria-label="All categories"] option:text-is("Spectrum - Mobile")').count()));await closeSheet();
 await p.evaluate(()=>location.hash='/plan/bills');await p.click('[data-testid=archived-bills] summary');await p.click('[data-testid=archived-bills] button:has-text("Restore")');await p.waitForTimeout(1500);
 ck('restoring the bill restores its category',q("select is_hidden from categories where id="+cat2)==='f'&&q("select bill_archived from categories where id="+cat2)==='f');
}
// standalone category archive / restore
const gcat=q("select id from categories where name='Dining Out'");const a0=q("select assigned_amount from categories where id="+gcat);
await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('.brow');await p.click('.brow:has-text("Dining Out")');await p.waitForSelector('[data-testid=category-archive]');
const dis=await p.locator('[data-testid=category-archive] button:has-text("Archive category")').isDisabled();
console.log('dining archive disabled:',dis,(await p.textContent('[data-testid=category-archive]')).replace(/\s+/g,' ').slice(0,160));
if(!dis){await p.click('[data-testid=category-archive] button:has-text("Archive category")');await p.waitForTimeout(1500);ck('archive keeps allocation',q("select assigned_amount from categories where id="+gcat)===a0&&q("select is_hidden from categories where id="+gcat)==='t');
 await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('[data-testid=archived-categories]');await p.click('[data-testid=archived-categories] summary');await p.click('[data-testid=archived-categories] .li:has-text("Dining Out") button:has-text("Restore")');await p.waitForTimeout(1500);
 ck('restore returns it with its history',q("select is_hidden from categories where id="+gcat)==='f'&&q("select assigned_amount from categories where id="+gcat)===a0);}

// eligible path: a bill whose category has no money and no other use can be archived together
q("insert into categories(name,group_id,target_amount,bill_amount,due_date,bill_anchor,is_repeating,target_period,bill_mode,assigned_amount,entity_id) select 'Old Gym',group_id,0,20,current_date+10,current_date+10,true,'Monthly','reminder',0,'personal' from categories where id=2");
const gym=q("select id from categories where name='Old Gym'");const s2=snap();
await p.evaluate(()=>location.hash='/plan/budget');await p.reload();await p.waitForSelector('.brow');await p.click('.brow:has-text("Old Gym")');await p.click('[data-testid=archive-bill]');await p.waitForSelector('[data-testid=archive-category-option]');
ck('unused, empty category offers to be archived with the bill',!(await p.locator('[data-testid=archive-category-option] input').isDisabled()));
await p.check('[data-testid=archive-category-option] input');await p.click('.sheet button.primary:has-text("Archive bill")');await p.waitForTimeout(1500);
ck('bill and category both archived; money and history untouched',q("select bill_archived::int||'|'||is_hidden::int from categories where id="+gym)==='1|1'&&snap()===s2);
await p.evaluate(()=>location.hash='/plan/bills');await p.waitForSelector('[data-testid=archived-bills]');await p.click('[data-testid=archived-bills] summary');
await p.click('[data-testid=archived-bills] .li:has-text("Old Gym") button:has-text("Restore")');await p.waitForTimeout(1500);
ck('restore brings back both',q("select bill_archived::int||'|'||is_hidden::int||'|'||bill_paused::int from categories where id="+gym)==='0|0|0');
ck('no page errors',errs.length===0,errs.join('|'));
console.log(pass+' passed, '+fail+' failed');await b.close()})();
