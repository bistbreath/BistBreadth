(() => {
 const rowsNode=document.getElementById("rs-rows");
 const statusNode=document.getElementById("rs-status");
 const metaNode=document.getElementById("rs-meta");
 const buttons=[...document.querySelectorAll("[data-period]")];
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
 fetch("data/rs_ratings.json?v="+Date.now()).then(response=>{if(!response.ok)throw new Error("RS verisi henüz yayımlanmamış");return response.json()}).then(data=>{
   rows=data.rows||[];
   metaNode.textContent="Veri tarihi: "+new Intl.DateTimeFormat("tr-TR",{dateStyle:"long",timeZone:"UTC"}).format(new Date(data.as_of+"T12:00:00Z"))+" • Referans: XU100 • Evren: güncel XUTUM";
   statusNode.textContent=rows.length+" hisse için RS Rating hazır.";
   if(!rows.length)statusNode.textContent="RS verisi henüz oluşturulmadı.";
   render();
 }).catch(error=>{statusNode.textContent=error.message;metaNode.textContent="Veri kaynağı bekleniyor."});
})();