(() => {
 const rowsNode=document.getElementById("rs-rows");
 const statusNode=document.getElementById("rs-status");
 const metaNode=document.getElementById("rs-meta");
 const buttons=[...document.querySelectorAll("[data-period]")];
 const exportButton=document.getElementById("rs-export-tv");
 let rows=[], period="3m";
 const numberFormat=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:0});
 function render(){
   const key=period;
   const sorted=[...rows].sort((a,b)=>{
     const av=a.ratings?.[key],bv=b.ratings?.[key];
     if(av==null&&bv==null)return a.ticker.localeCompare(b.ticker);
     if(av==null)return 1;if(bv==null)return -1;
     return bv-av||a.ticker.localeCompare(b.ticker);
   });
   rowsNode.innerHTML=sorted.map((row,index)=>{
     const val=k=>row.ratings?.[k]==null?"—":numberFormat.format(row.ratings[k]);
     const bar=k=>row.ratings?.[k]==null?"":row.ratings[k]>=70?"strong":row.ratings[k]<30?"weak":"";
     return '<tr><td class="rs-rank">'+(row.ratings?.[key]==null?"—":index+1)+'</td><td class="rs-ticker">'+row.ticker+'</td><td class="rs-sector">'+(row.sector||"—")+'</td><td><span class="rs-value '+bar("1m")+'">'+val("1m")+'</span></td><td><span class="rs-value '+bar("3m")+'">'+val("3m")+'</span></td><td><span class="rs-value '+bar("6m")+'">'+val("6m")+'</span></td></tr>';
   }).join("");
   buttons.forEach(button=>button.classList.toggle("active",button.dataset.period===period));
 }
 buttons.forEach(button=>button.addEventListener("click",()=>{period=button.dataset.period;render()}));
 exportButton?.addEventListener("click",()=>{
   const symbols=rows.filter(row=>Number(row.ratings?.["1m"])>80).map(row=>"BIST:"+row.ticker);
   if(!symbols.length){statusNode.textContent="1A RS puanı 80 üzerinde hisse bulunamadı.";return;}
   const blob=new Blob([symbols.join(",")],{type:"text/plain;charset=utf-8"});
   const url=URL.createObjectURL(blob),link=document.createElement("a");
   link.href=url;link.download="bist-rs-1-ay-80-ustu.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   statusNode.textContent=symbols.length+" hisse TradingView için TXT olarak indirildi.";
 });
 fetch("data/rs_ratings.json?v="+Date.now()).then(response=>{if(!response.ok)throw new Error("RS verisi henüz yayımlanmamış");return response.json()}).then(data=>{
   rows=data.rows||[];
   metaNode.textContent="Veri tarihi: "+new Intl.DateTimeFormat("tr-TR",{dateStyle:"long",timeZone:"UTC"}).format(new Date(data.as_of+"T12:00:00Z"))+" • Referans: XU100 • Evren: güncel XUTUM";
   const exportCount=rows.filter(row=>Number(row.ratings?.["1m"])>80).length;
   statusNode.textContent=rows.length+" hisse için RS Rating hazır • "+exportCount+" hissede 1A RS >80.";
   if(exportButton)exportButton.disabled=false;
   if(!rows.length)statusNode.textContent="RS verisi henüz oluşturulmadı.";
   render();
 }).catch(error=>{statusNode.textContent=error.message;metaNode.textContent="Veri kaynağı bekleniyor."});
})();