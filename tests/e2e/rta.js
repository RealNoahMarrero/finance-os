const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q=(s)=>execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "${s}"`).toString().trim();
let pass=0,fail=0;const ck=(n,ok,x)=>{ok?pass++:fail++;console.log((ok?'PASS ':'FAIL ')+n+(ok?'':' :: '+x))};
(async()=>{const b=await chromium.launch();const errs=[];
const mk=async(vp,scheme)=>{const c=await b.newContext({viewport:vp,colorScheme:scheme||'light'});const p=await c.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto('http://localhost:4173/');await p.fill('#em','owner@test.local');await p.fill('#pw','correct-horse-battery');await p.click('button.primary');await p.waitForSelector('.page');return p};
const txt=async(p,s)=>(await p.textContent(s)).replace(/\s/g,'');
const p=await mk({width:1440,height:900});
const both=async()=>{await p.evaluate(()=>location.hash='/');await p.waitForSelector('[data-testid=ov-rta]');const o=await txt(p,'[data-testid=ov-rta-value]');await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('[data-testid=rta-value]');return [o,await txt(p,'[data-testid=rta-value]')]};
let [o,bu]=await both();console.log('rta',o,bu);
ck('Overview and Budget show the same value',o===bu&&/^\$/.test(o),o+' '+bu);
ck('Overview card is above the fold',await (async()=>{await p.evaluate(()=>location.hash='/');await p.waitForSelector('[data-testid=ov-rta]');const bx=await p.locator('[data-testid=ov-rta]').boundingBox();return bx.y+bx.height<900})());
const state=async(label,expectRe,actionRe)=>{const [o,bu]=await both();console.log(label,o,bu);
 ck(label+': both screens agree',o===bu,o+' '+bu);
 const card=await txt(p,'[data-testid=rta]');ck(label+': text/action',expectRe.test(card)&&actionRe.test(await txt(p,'[data-testid=rta-action]')),card);return o};
// zero
await both();
ck('Budget: not hidden in Advanced',(await p.locator('details [data-testid=rta-value]').count())===0&&!/unassigned/.test(await p.textContent('summary')));
await state('zero',/Everythingisassigned/,/Movemoney/);
ck('zero is calm (not warning color)',(await p.locator('[data-testid=rta-value].neg').count())===0);
// positive
q("update accounts set balance=balance+250 where id=1");await p.reload();
const pv=await state('positive',/Moneywaitingforajob/,/Assignmoney/);ck('positive amount is +250 over zero',pv==='$250.00',pv);
const gen=()=>q("select sum(assigned_amount) from categories");const g0=gen();
await p.click('[data-testid=rta-action]');await p.waitForSelector('.sheet');
await p.keyboard.press('Escape');await p.waitForTimeout(400);
// move between categories must not change RTA
await p.evaluate(()=>location.hash='/plan/budget');await p.waitForSelector('[data-testid=rta-value]');
await p.click('button:has-text("Move money") >> nth=0');await p.waitForSelector('[data-testid=move-from]');
if(!(await p.locator('input[aria-label="Search From"]').count()))await p.click('[data-testid=move-from-btn]');await p.fill('input[aria-label="Search From"]','Gas');await p.keyboard.press('Enter');
if(!(await p.locator('input[aria-label="Search To"]').count()))await p.click('[data-testid=move-to-btn]');await p.fill('input[aria-label="Search To"]','Groc');await p.keyboard.press('Enter');
await p.locator('.sheet .field:has(label:has-text("Amount")) input').first().fill('5');await p.click('.sheet button.primary:has-text("Move")');await p.waitForTimeout(1500);
ck('moving between categories leaves Ready to Assign unchanged',await txt(p,'[data-testid=rta-value]')==='$250.00');
// assign from the Overview card through the real dialog
await p.evaluate(()=>location.hash='/');await p.waitForSelector('[data-testid=ov-rta-action]');await p.click('[data-testid=ov-rta-action]');await p.waitForSelector('.sheet');
console.log((await p.textContent('.sheet')).replace(/\s+/g,' ').slice(0,260));
await p.screenshot({path:'rta-assign.png'});
await p.keyboard.press('Escape');await p.waitForTimeout(400);
// negative
q("update accounts set balance=balance-600 where id=1");await p.reload();
const nv=await state('negative',/Over-assigned/,/Reviewover-assignment/);ck('negative preserved, not clamped',nv.startsWith('−')&&nv==='−$350.00',nv);
ck('negative uses warning styling',(await p.locator('[data-testid=rta-value].neg').count())===1);
await p.click('[data-testid=rta-action]');await p.waitForSelector('[data-testid=move-to]');ck('negative action opens Move Money into Ready to Assign',(await txt(p,'[data-testid=move-to-btn]')).includes('ReadytoAssign'));
await p.keyboard.press('Escape');await p.waitForTimeout(300);
// screenshots
q("update accounts set balance=balance+600 where id=1");
for(const [n,vp,sc] of [['d-l',{width:1440,height:900},'light'],['d-dark',{width:1440,height:900},'dark'],['m-l',{width:390,height:844},'light'],['m-dark',{width:390,height:844},'dark']]){const pp=await mk(vp,sc);await pp.screenshot({path:`rta-ov-${n}.png`});await pp.evaluate(()=>location.hash='/plan/budget');await pp.waitForSelector('[data-testid=rta]');await pp.waitForTimeout(300);await pp.screenshot({path:`rta-bu-${n}.png`});
 const ov=await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth);ck('no horizontal overflow '+n,!ov);}
ck('no page errors',errs.length===0,errs.join('|'));
console.log(pass+' passed, '+fail+' failed');await b.close()})();
