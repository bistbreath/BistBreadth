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
 let stockRows=[],sectorRows=[],period="3m",view="stocks",asOf="",sectorAsOf="";
 const numberFormat=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:0});
 const val=(row,key)=>row.ratings?.[key]==null?"—":numberFormat.format(row.ratings[key]);
 const tone=(row,key)=>row.ratings?.[key]==null?"":row.ratings[key]>=70?"strong":row.ratings[key]<30?"weak":"";
 function render(){
   const source=view==="sectors"?sectorRows:stockRows;
   const sorted=[...source].sort((a,b)=>{
     const av=a.ratings?.[period],bv=b.ratings?.[period];
     if(av==null&&bv==null)return (a.ticker||a.sector).localeCompare(b.ticker||b.sector);
     if(av==null)return 1;if(bv==null)return -1;
     return bv-av||(a.ticker||a.sector).localeCompare(b.ticker||b.sector);
   });
   if(view==="sectors"){
     titleNode.textContent="BIST sektörleri • XU100 karşılaştırması";
     methodNode.textContent="Sektör puanı, ilgili dönemde o sektördeki güncel XUTUM hisselerinin eşit ağırlıklı XU100’e göre ortalama performansının sektörler arasındaki yüzdelik sırasıdır. 100 en güçlü, 0 en zayıf göreli performansı gösterir.";
     tableHead.innerHTML="<tr><th>Rank</th><th>Sektör</th><th>RS 1A</th><th>RS 3A</th><th>RS 6A</th></tr>";
     rowsNode.innerHTML=sorted.map((row,index)=>'<tr><td class="rs-rank">'+(row.ratings?.[period]==null?"—":index+1)+'</td><td class="rs-sector-name">'+row.sector+'</td><td><span class="rs-value '+tone(row,"1m")+'">'+val(row,"1m")+'</span></td><td><span class="rs-value '+tone(row,"3m")+'">'+val(row,"3m")+'</span></td><td><span class="rs-value '+tone(row,"6m")+'">'+val(row,"6m")+'</span></td></tr>').join("");
   }else{
     titleNode.textContent="BIST hisseleri • XU100 karşılaştırması";
     methodNode.textContent="RS Rating, ilgili dönemde hissenin XU100’e göre performansının mevcut XUTUM hisseleri içindeki yüzdelik sırasıdır. 100 en güçlü, 0 en zayıf göreli performansı gösterir. Sıralama seçilen döneme göre yapılır.";
     tableHead.innerHTML="<tr><th>Rank</th><th>Hisse Kodu</th><th>Sektör</th><th>RS 1A</th><th>RS 3A</th><th>RS 6A</th></tr>";
     rowsNode.innerHTML=sorted.map((row,index)=>'<tr><td class="rs-rank">'+(row.ratings?.[period]==null?"—":index+1)+'</td><td class="rs-ticker">'+row.ticker+'</td><td class="rs-sector">'+(row.sector||"—")+'</td><td><span class="rs-value '+tone(row,"1m")+'">'+val(row,"1m")+'</span></td><td><span class="rs-value '+tone(row,"3m")+'">'+val(row,"3m")+'</span></td><td><span class="rs-value '+tone(row,"6m")+'">'+val(row,"6m")+'</span></td></tr>').join("");
   }
   buttons.forEach(button=>button.classList.toggle("active",button.dataset.period===period));
   viewButtons.forEach(button=>button.classList.toggle("active",button.dataset.view===view));
   if(exportButton)exportButton.hidden=view==="sectors";
   const shownDate=view==="sectors"?sectorAsOf:asOf;
   metaNode.textContent="Veri tarihi: "+new Intl.DateTimeFormat("tr-TR",{dateStyle:"long",timeZone:"UTC"}).format(new Date(shownDate+"T12:00:00Z"))+" • Referans: XU100 • "+(view==="sectors"?"Sektör evreni: güncel XUTUM":"Hisse evreni: güncel XUTUM");
   statusNode.textContent=view==="sectors"?sorted.length+" sektör için RS karşılaştırması hazır.":stockRows.length+" hisse için RS Rating hazır • "+stockRows.filter(row=>Number(row.ratings?.["1m"])>80).length+" hissede 1A RS >80.";
 }
 buttons.forEach(button=>button.addEventListener("click",()=>{period=button.dataset.period;render()}));
 viewButtons.forEach(button=>button.addEventListener("click",()=>{view=button.dataset.view;render()}));
 exportButton?.addEventListener("click",()=>{
   const symbols=stockRows.filter(row=>Number(row.ratings?.["1m"])>80).map(row=>"BIST:"+row.ticker);
   if(!symbols.length){statusNode.textContent="1A RS puanı 80 üzerinde hisse bulunamadı.";return;}
   const blob=new Blob([symbols.join(",")],{type:"text/plain;charset=utf-8"});
   const url=URL.createObjectURL(blob),link=document.createElement("a");
   link.href=url;link.download="bist-rs-1-ay-80-ustu.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   statusNode.textContent=symbols.length+" hisse TradingView için TXT olarak indirildi.";
 });
 fetch("data/rs_ratings.json?v="+Date.now()).then(response=>{if(!response.ok)throw new Error("RS verisi henüz yayımlanmamış");return response.json()}).then(data=>{
   stockRows=data.rows||[];
   sectorRows=data.sector_rows||[];
   asOf=data.as_of;
   sectorAsOf=data.sector_as_of||data.as_of;
   if(exportButton)exportButton.disabled=false;
   if(!sectorRows.length){
     viewButtons.find(button=>button.dataset.view==="sectors").disabled=true;
   }
   render();
 }).catch(error=>{statusNode.textContent=error.message;metaNode.textContent="Veri kaynağı bekleniyor."});
})();