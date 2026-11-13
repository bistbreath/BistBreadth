(() => {
 const rowsNode=document.getElementById("rs-rows");
 const statusNode=document.getElementById("rs-status");
 const metaNode=document.getElementById("rs-meta");
 const titleNode=document.getElementById("rs-title");
 const methodNode=document.getElementById("rs-method");
 const buttons=[...document.querySelectorAll("[data-period]")];
 const viewButtons=[...document.querySelectorAll("[data-view]")];
 const exportButton=document.getElementById("rs-export-tv");
 const tableHead=document.querySelector(".rs-table thead");
 let stockRows=[],sectorRows=[],period="3m",view="stocks",expandedSector="",asOf="",sectorAsOf="",updatedAt="",refreshing=false;
 const numberFormat=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:0});
 const val=(row,key)=>row.ratings?.[key]==null?"—":numberFormat.format(row.ratings[key]);
 const tone=(row,key)=>row.ratings?.[key]==null?"":row.ratings[key]>=70?"strong":row.ratings[key]<30?"weak":"";
 const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 function sortRows(rows){
   return [...rows].sort((a,b)=>{
     const av=a.ratings?.[period],bv=b.ratings?.[period];
     if(av==null&&bv==null)return (a.ticker||a.sector).localeCompare(b.ticker||b.sector);
     if(av==null)return 1;if(bv==null)return -1;
     return bv-av||(a.ticker||a.sector).localeCompare(b.ticker||b.sector);
   });
 }
 function ratingCells(row){
   return ["1m","3m","6m"].map(key=>'<td><span class="rs-value '+tone(row,key)+'">'+val(row,key)+'</span></td>').join("");
 }
 function render(){
   const source=view==="sectors"?sectorRows:stockRows;
   const sorted=sortRows(source);
   if(view==="sectors"){
     titleNode.textContent="BIST sektörleri • XU100 karşılaştırması";
     methodNode.textContent="Sektör puanı, o sektördeki güncel XUTUM hisselerinin eşit ağırlıklı XU100’e göre ortalama performansının sektörler arasındaki yüzdelik sırasıdır. Hisse listesini görmek için sektöre basın.";
     tableHead.innerHTML="<tr><th>Rank</th><th>Sektör / Hisse</th><th>RS 1A</th><th>RS 3A</th><th>RS 6A</th></tr>";
     rowsNode.innerHTML=sorted.map((sector,index)=>{
       const isOpen=expandedSector===sector.sector;
       const parent='<tr class="rs-sector-parent"><td class="rs-rank">'+(sector.ratings?.[period]==null?"—":index+1)+'</td><td class="rs-sector-name"><button type="button" class="rs-sector-link" data-sector-name="'+escapeHtml(sector.sector)+'" aria-expanded="'+isOpen+'" aria-label="'+escapeHtml(sector.sector)+(isOpen?" hisselerini kapat":" sektöründeki hisseleri göster")+'"><span class="rs-sector-caret" aria-hidden="true">'+(isOpen?"−":"+")+'</span>'+escapeHtml(sector.sector)+'</button></td>'+ratingCells(sector)+'</tr>';
       if(!isOpen)return parent;
       const members=sortRows(stockRows.filter(row=>row.sector===sector.sector));
       const children=members.map((row,childIndex)=>'<tr class="rs-sector-stock-row"><td class="rs-rank">'+(row.ratings?.[period]==null?"—":childIndex+1)+'</td><td class="rs-sector-stock">'+escapeHtml(row.ticker)+'</td>'+ratingCells(row)+'</tr>').join("");
       return parent+children;
     }).join("");
     rowsNode.querySelectorAll("[data-sector-name]").forEach(button=>button.addEventListener("click",()=>{
       const name=button.dataset.sectorName;
       expandedSector=expandedSector===name?"":name;
       render();
     }));
   }else{
     titleNode.textContent="BIST hisseleri • XU100 karşılaştırması";
     methodNode.textContent="RS Rating, ilgili dönemde hissenin XU100’e göre performansının mevcut XUTUM hisseleri içindeki yüzdelik sırasıdır. 100 en güçlü, 0 en zayıf göreli performansı gösterir. Sıralama seçilen döneme göre yapılır.";
     tableHead.innerHTML="<tr><th>Rank</th><th>Hisse Kodu</th><th>Sektör</th><th>RS 1A</th><th>RS 3A</th><th>RS 6A</th></tr>";
     rowsNode.innerHTML=sorted.map((row,index)=>'<tr><td class="rs-rank">'+(row.ratings?.[period]==null?"—":index+1)+'</td><td class="rs-ticker">'+escapeHtml(row.ticker)+'</td><td class="rs-sector">'+escapeHtml(row.sector||"—")+'</td>'+ratingCells(row)+'</tr>').join("");
   }
   buttons.forEach(button=>button.classList.toggle("active",button.dataset.period===period));
   viewButtons.forEach(button=>button.classList.toggle("active",button.dataset.view===view));
   if(exportButton)exportButton.hidden=view==="sectors";
   const shownDate=view==="sectors"?sectorAsOf:asOf;
   metaNode.textContent="Veri tarihi: "+new Intl.DateTimeFormat("tr-TR",{dateStyle:"long",timeZone:"UTC"}).format(new Date(shownDate+"T12:00:00Z"))+" • Referans: XU100 • "+(view==="sectors"?"Sektör evreni: güncel XUTUM":"Hisse evreni: güncel XUTUM");
   if(view==="sectors"){
     const openCount=stockRows.filter(row=>row.sector===expandedSector).length;
     statusNode.textContent=expandedSector?expandedSector+" altında "+openCount+" hisse gösteriliyor.":sorted.length+" sektör hazır. Hisseleri açmak için bir sektöre basın.";
   }else{
     statusNode.textContent=stockRows.length+" hisse için RS Rating hazır • "+stockRows.filter(row=>Number(row.ratings?.["1m"])>80).length+" hissede 1A RS >80.";
   }
 }
 buttons.forEach(button=>button.addEventListener("click",()=>{period=button.dataset.period;render()}));
 viewButtons.forEach(button=>button.addEventListener("click",()=>{
   view=button.dataset.view;
   if(view!=="sectors")expandedSector="";
   render();
 }));
 exportButton?.addEventListener("click",()=>{
   const symbols=stockRows.filter(row=>Number(row.ratings?.["1m"])>80).map(row=>"BIST:"+row.ticker);
   if(!symbols.length){statusNode.textContent="1A RS puanı 80 üzerinde hisse bulunamadı.";return;}
   const blob=new Blob([symbols.join(",")],{type:"text/plain;charset=utf-8"});
   const url=URL.createObjectURL(blob),link=document.createElement("a");
   link.href=url;link.download="bist-rs-1-ay-80-ustu.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   statusNode.textContent=symbols.length+" hisse TradingView için TXT olarak indirildi.";
 });
 async function refreshRatings(silent=false){
   if(refreshing||document.visibilityState==="hidden")return;
   refreshing=true;
   try{
     const response=await fetch("data/rs_ratings.json?refresh="+Date.now(),{cache:"no-store"});
     if(!response.ok)throw new Error("RS verisi henüz yayımlanmamış");
     const data=await response.json();
     if(data.updated_at===updatedAt)return;
     updatedAt=data.updated_at||data.as_of||"";
     stockRows=data.rows||[];
     sectorRows=data.sector_rows||[];
     asOf=data.as_of;
     sectorAsOf=data.sector_as_of||data.as_of;
     if(exportButton)exportButton.disabled=false;
     const sectorButton=viewButtons.find(button=>button.dataset.view==="sectors");
     if(sectorButton)sectorButton.disabled=!sectorRows.length;
     render();
   }catch(error){
     if(!silent){statusNode.textContent=error.message;metaNode.textContent="Veri kaynağı bekleniyor."}
   }finally{refreshing=false}
 }
 refreshRatings();
 setInterval(()=>refreshRatings(true),60000);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshRatings(true)});
})();