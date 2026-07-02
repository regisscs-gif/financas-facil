#!/usr/bin/env node
// Testa LOCALMENTE o mapeamento Pluggy → modelo do app (conta corrente/cartão),
// contra dados reais do sandbox, antes de portar para o lab.html.
//   node pluggy/merge-test.js
const fs = require('fs'), path = require('path');
function loadEnv(){for(const p of [path.join(__dirname,'.env')]){if(!fs.existsSync(p))continue;for(const l of fs.readFileSync(p,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);if(m&&!(m[1]in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}}
const BASE='https://api.pluggy.ai',sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function api(method,url,apiKey,body){const res=await fetch(BASE+url,{method,headers:{'Content-Type':'application/json',...(apiKey?{'X-API-KEY':apiKey}:{})},...(body?{body:JSON.stringify(body)}:{})});const t=await res.text();let j;try{j=JSON.parse(t)}catch{j=t}if(!res.ok)throw new Error(`${method} ${url} → ${res.status}: ${t}`);return j;}

// ===== FUNÇÕES PURAS (idênticas às que vão para o lab.html) =====
function mapCatPluggy(plCat, desc, tipo){
  var c=(plCat||'').toLowerCase();
  if(tipo==='r'){
    if(/salary|paycheck|payroll|retirement|pension/.test(c))return 'Salário';
    if(/invest|interest|dividend|yield/.test(c))return 'Investimentos';
    if(/freelanc|self-?employ/.test(c))return 'Freelance';
    return 'Outros';
  }
  if(/rent|mortgage|housing|condomin|real estate|home/.test(c))return 'Moradia';
  if(/electric|water|gas bill|utilit|telecom|internet|phone|mobile|cable/.test(c))return 'Moradia';
  if(/food|drink|restaurant|supermarket|grocer|bar|coffee|fast food/.test(c))return 'Alimentação';
  if(/transport|fuel|gas station|taxi|ride|uber|parking|toll|mobility|public transport/.test(c))return 'Transporte';
  if(/health|pharmac|doctor|hospital|dentist|medical|gym|fitness/.test(c))return 'Saúde';
  if(/stream|entertain|movie|game|leisure|travel|hotel|music|video|hobby/.test(c))return 'Lazer';
  if(/educat|school|course|book|tuition/.test(c))return 'Educação';
  if(/cloth|apparel|shoe|fashion/.test(c))return 'Vestuário';
  return 'Outros';
}
function isCardPayment(cat, desc){
  var s=((cat||'')+' '+(desc||'')).toLowerCase();
  return /credit card payment|pagamento.*fatura|fatura.*cart|pagto.*cart/.test(s);
}
function buildCandidates(data, existingPlIds){
  var out=[], skipped=0;
  (data.transactions||[]).forEach(function(t){
    if(t.plId && existingPlIds[t.plId]){skipped++;return;}
    var amt=t.amount, val=Math.abs(amt);
    if(t.accountType==='CREDIT'){
      var flag=(amt>0)?'card_credit':null; // estorno/pagamento no cartão
      out.push({target:'cc', accountId:t.accountId, desc:t.description, val:val,
        data:t.date, cat:mapCatPluggy(t.category,t.description,'e'), titular:'eu',
        installment:(t.installment&&t.installment.total>1)?t.installment:null,
        plId:t.plId, flag:flag, checked:!flag});
    }else{ // BANK
      var tipo=(amt<0)?'e':'r';
      var f=isCardPayment(t.category,t.description)?'card_payment':null;
      out.push({target:'lancs', tipo:tipo, desc:t.description, val:val, data:t.date,
        cat:mapCatPluggy(t.category,t.description,tipo), plId:t.plId, flag:f, checked:!f});
    }
  });
  return {candidates:out, skipped:skipped};
}
// ================================================================

async function main(){
  loadEnv();
  const {apiKey}=await api('POST','/auth',null,{clientId:process.env.CLIENT_ID,clientSecret:process.env.CLIENT_SECRET});
  // cria item fresco
  let item=await api('POST','/items',apiKey,{connectorId:2,parameters:{user:'user-ok',password:'password-ok'}});
  const itemId=item.id;
  for(let i=0;i<30;i++){await sleep(2000);item=await api('GET',`/items/${itemId}`,apiKey);if(item.status!=='UPDATING')break;}
  console.log('item',itemId,item.status);
  const accs=(await api('GET',`/accounts?itemId=${itemId}`,apiKey)).results||[];
  // monta payload igual ao da Edge Function
  const transactions=[];
  for(const a of accs){let cur=null,g=0;do{const r=await api('GET',`/v2/transactions?accountId=${a.id}`+(cur?`&cursor=${cur}`:''),apiKey);(r.results||[]).forEach(t=>{const cc=t.creditCardMetadata;transactions.push({plId:t.id,accountType:a.type,date:(t.date||'').slice(0,10),description:t.description||t.descriptionRaw,amount:t.amount,category:t.category,installment:cc?{n:cc.installmentNumber,total:cc.totalInstallments}:null});});cur=r.next||null;g++;}while(cur&&g<50);}

  const {candidates,skipped}=buildCandidates({transactions}, {});
  console.log('\n=== CANDIDATOS (skipped já-mesclados:'+skipped+') ===');
  ['lancs','cc'].forEach(function(tg){
    console.log('\n--- '+(tg==='lancs'?'CONTA CORRENTE (db.lancs)':'CARTÃO (db.ccLancs)')+' ---');
    candidates.filter(c=>c.target===tg).forEach(function(c){
      console.log([c.checked?'[x]':'[ ]', c.data, (c.tipo||'cc'), String(c.val).padStart(9),
        (c.cat||'').padEnd(14), (c.flag||'').padEnd(12), c.desc].join(' '));
    });
  });
  const nCheck=candidates.filter(c=>c.checked).length;
  console.log('\nTotal candidatos:',candidates.length,'| pré-marcados:',nCheck);
  // re-teste de dedup: se todos já existem, deve pular todos
  var existing={};candidates.forEach(c=>existing[c.plId]=true);
  const round2=buildCandidates({transactions}, existing);
  console.log('Idempotência (2ª rodada) → candidatos:',round2.candidates.length,'(esperado 0)');
}
main().catch(e=>{console.error('✗',e.message);process.exit(1);});
