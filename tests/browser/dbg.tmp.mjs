import { start } from '../../tools/demo/server.mjs';
const s = await start(54396); 
const r = await fetch('http://127.0.0.1:54396/rest/v1/credit_scores?select=*&order=id.asc'); console.log(r.status, (await r.text()).slice(0, 150));
const r2 = await fetch('http://127.0.0.1:54396/rest/v1/credit_card_meta?select=*&order=account_id.asc'); console.log(r2.status, (await r2.text()).slice(0, 150));
s.close(); process.exit(0);
