(async function(){
  const select=document.getElementById('financial-ticker');
  const host=document.getElementById('company-update-content');
  const status=document.getElementById('company-update-status');
  if(!select||!host||!status)return;
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const style=document.createElement('style');
  style.textContent='.company-updates{margin:14px 0;padding:18px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(135deg,#13233a,#111c2e 65%)}.company-updates h3{margin:0 0 5px;font-size:17px}.company-updates-intro,.company-update-meta{color:var(--muted);font-size:12px;line-height:1.55}.company-update-empty{margin-top:14px;padding:13px;border:1px dashed var(--line);border-radius:9px;color:var(--muted);font-size:13px;line-height:1.6}.company-update-list{display:grid;gap:10px;margin-top:14px}.company-update-item{padding:13px;border:1px solid var(--line);border-radius:9px;background:#0d1726}.company-update-item h4{margin:8px 0;font-size:14px}.company-update-item p{margin:7px 0;font-size:13px;line-height:1.6}.company-update-badge{display:inline-block;padding:3px 8px;border-radius:99px;font-size:11px;font-weight:700;background:#24364d;color:#cbdcff}.company-update-badge.positive{color:#8be0a1}.company-update-badge.negative{color:#ff9a9a}.company-update-badge.neutral{color:#cbdcff}.company-update-item a{font-size:12px;color:#8bbaff}';
  document.head.appendChild(style);
  let db={companies:{}};
  try{const response=await fetch('data/company_updates.json?v=20261109-1',{cache:'no-cache'});if(response.ok)db=await response.json();}catch(error){console.warn('Şirket gelişme notları yüklenemedi',error);}
  function render(){
    const ticker=select.value,company=db.companies?.[ticker],items=company?.items||[];
    if(!items.length){
      status.textContent=ticker+' için manuel tarama notu bulunmuyor.';
      host.innerHTML='<div class="company-update-empty">Bu bölüm otomatik tarama yapmaz. “Tara” dediğinizde şirketin KAP bildirimleri ve faaliyet raporları incelenip; satış/kârlılık etkisi, beklenti değişikliği, değerlendirme ve kaynak bağlantıları buraya eklenir.</div>';
      return;
    }
    status.textContent=ticker+' • Son inceleme: '+escapeHtml(company.reviewedAt||'—');
    host.innerHTML='<div class="company-update-list">'+items.map(item=>{
      const tone=item.direction==='olumlu'?'positive':item.direction==='olumsuz'?'negative':'neutral';
      return '<article class="company-update-item"><div class="company-update-meta">'+escapeHtml(item.date||'')+' • '+escapeHtml(item.type||'Gelişme')+' <span class="company-update-badge '+tone+'">'+escapeHtml(item.direction||'Nötr')+'</span></div><h4>'+escapeHtml(item.title||'')+'</h4><p>'+escapeHtml(item.summary||'')+'</p>'+(item.revision?'<p><b>Beklenti değişikliği:</b> '+escapeHtml(item.revision)+'</p>':'')+(item.analysis?'<p><b>Olası etkisi:</b> '+escapeHtml(item.analysis)+'</p>':'')+(item.sourceUrl?'<a href="'+escapeHtml(item.sourceUrl)+'" target="_blank" rel="noopener noreferrer">KAP / rapor kaynağını aç</a>':'')+'</article>';
    }).join('')+'</div>';
  }
  select.addEventListener('change',render);
  render();
})();