const financialSelect = document.getElementById('financial-ticker');
const financialRange = document.getElementById('financial-range');
const financialContainer = document.getElementById('financial-charts');
const financialStatus = document.getElementById('financial-status');
let financialAllRows = [];
const quarterColors = {1:'#4f7fb3',2:'#ef8c2f',3:'#75b7b2',4:'#a878a5'};
const millions = value => value == null || !Number.isFinite(value) ? null : value / 1e6;
const quarterLabel = period => period;
const pretty = (value, digits = 2) => Number(value).toLocaleString('tr-TR', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const escapeSvg = value => String(value).replace(/[&<>"']/g, ch => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[ch]));

function buildFinancialRows(company) {
  const source = company.periods || [];
  return source.map((row, index) => {
    const sales = millions(row.sales);
    const gross = millions(row.grossProfit);
    const netOperating = millions(row.netOperatingProfit);
    const netProfit = millions(row.netProfit);
    const cash = millions(row.cash);
    const investments = millions(row.financialInvestments);
    const shortDebt = millions(row.shortTermDebt);
    const longDebt = millions(row.longTermDebt);
    const totalCash = cash == null || investments == null ? null : cash + investments;
    const netCash = totalCash == null || shortDebt == null ? null : totalCash - shortDebt;
    const netDebt = totalCash == null || shortDebt == null || longDebt == null
      ? null : shortDebt + longDebt - totalCash;

    let ebitdaTtm = null;
    if (index >= 3) {
      const lastFour = source.slice(index - 3, index + 1);
      const consecutive = lastFour.every((item, i) => {
        if (i === 0) return true;
        const [py, pm] = lastFour[i - 1].period.split('/').map(Number);
        const [cy, cm] = item.period.split('/').map(Number);
        return (cy * 4 + Math.ceil(cm / 3)) - (py * 4 + Math.ceil(pm / 3)) === 1;
      });
      if (consecutive && lastFour.every(item =>
        Number.isFinite(item.operatingProfit) && Number.isFinite(item.depreciationAmortization))) {
        ebitdaTtm = lastFour.reduce((sum, item) =>
          sum + item.operatingProfit + item.depreciationAmortization, 0) / 1e6;
      }
    }
    const ratio = netDebt != null && ebitdaTtm > 0 ? netDebt / ebitdaTtm : null;
    return {
      ...row, label: quarterLabel(row.period), sales, grossProfit: gross,
      netOperatingProfit: netOperating, netProfit, cash, investments,
      shortDebt, longDebt, cashAndInvestments: totalCash, netCash, netDebt, ebitdaTtm, netDebtEbitda: ratio,
      grossMargin: sales && gross != null ? gross / sales * 100 : null,
      operatingMargin: sales && netOperating != null ? netOperating / sales * 100 : null,
      netMargin: sales && netProfit != null ? netProfit / sales * 100 : null,
    };
  }).map((row, index, rows) => {
    const average4 = key => {
      if (index < 3) return null;
      const last = rows.slice(index - 3, index + 1).map(item => item[key]);
      return last.every(value => value != null) ? last.reduce((a,b) => a+b,0)/4 : null;
    };
    return {
      ...row,
      grossMarginSma4: average4('grossMargin'),
      operatingMarginSma4: average4('operatingMargin'),
      netMarginSma4: average4('netMargin'),
    };
  });
}

function tooltipAttributes(row, definition, value, unit, options) {
  const quarter = row.quarter?.[1];
  const priorPeriod = `${row.quarter?.[0]-1}/${quarter*3}`;
  const priorRow = financialAllRows.find(item => item.period === priorPeriod);
  const priorValue = priorRow?.[definition.key];
  return `data-fin-tooltip="1" data-tip-period="${escapeSvg(row.label)}" data-tip-series="${escapeSvg(definition.label)}" data-tip-value="${value}" data-tip-prior="${Number.isFinite(priorValue) ? priorValue : ''}" data-tip-unit="${escapeSvg(unit)}" data-tip-percent="${options.percent ? '1' : '0'}" data-tip-ratio="${options.ratio ? '1' : '0'}"`;
}

function drawFinancialChart(title, subtitle, rows, definitions, unit, options = {}) {
  const width = 980, height = 310;
  const margin = { left: 76, right: 20, top: 22, bottom: 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = rows.flatMap(row => definitions.map(def => row[def.key])).filter(Number.isFinite);
  if (!values.length) {
    return `<article class="financial-chart-card"><h3>${escapeSvg(title)}</h3><p>${escapeSvg(subtitle)}</p><div class="financial-chart-empty">Bu dönemler için karşılaştırılabilir veri bulunamadı.</div></article>`;
  }
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  if (min < 0) min -= pad;
  if (max > 0) max += pad;
  const y = value => margin.top + (max - value) / (max - min) * plotH;
  const zero = y(0);
  const slot = plotW / Math.max(rows.length, 1);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 14));
  const numberLabel = value => options.percent
    ? `%${pretty(value,1)}`
    : options.ratio ? `${pretty(value,1)}x` : pretty(value,2);
  let svg = `<svg class="financial-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvg(title)}">`;

  for (let i=0;i<=4;i++) {
    const value = max - (max-min) * i / 4;
    const yy = y(value);
    svg += `<line x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}" class="fin-grid"/>`;
    svg += `<text x="${margin.left-9}" y="${yy+4}" text-anchor="end" class="fin-axis">${escapeSvg(numberLabel(value))}</text>`;
  }
  svg += `<line x1="${margin.left}" y1="${zero}" x2="${width-margin.right}" y2="${zero}" class="fin-zero"/>`;

  const barDefs = definitions.filter(def => def.type !== 'line');
  const groupWidth = Math.min(slot * 0.88, 70);
  const barWidth = Math.max(2, Math.min(68, groupWidth / Math.max(1,barDefs.length)));
  rows.forEach((row,index) => {
    const cx = margin.left + slot * index + slot / 2;
    let barIndex = 0;
    for (const def of definitions) {
      const value = row[def.key];
      if (!Number.isFinite(value) || def.type === 'line') continue;
      const x = cx - (barDefs.length * barWidth) / 2 + barIndex * barWidth + 1;
      const yy = y(value);
      const rectY = Math.min(yy,zero);
      const rectH = Math.max(1,Math.abs(zero-yy));
      const quarterColor = quarterColors[row.quarter?.[1]] || def.color || '#72b7b1';
      svg += `<rect x="${x}" y="${rectY}" width="${Math.max(2,barWidth-3)}" height="${rectH}" rx="2" fill="${quarterColor}" ${tooltipAttributes(row,def,value,unit,options)}><title>${escapeSvg(row.label)} • ${escapeSvg(def.label)}: ${escapeSvg(numberLabel(value))} ${escapeSvg(unit)}</title></rect>`;
      if (rows.length <= 12) {
        const textY = value >= 0 ? Math.max(margin.top+11,yy-5) : Math.min(height-margin.bottom-3,yy+13);
        svg += `<text x="${x+(barWidth-3)/2}" y="${textY}" text-anchor="middle" class="fin-value">${escapeSvg(numberLabel(value))}</text>`;
      }
      barIndex++;
    }
    if (index % labelEvery === 0 || index === rows.length-1) {
      svg += `<text x="${cx}" y="${height-20}" text-anchor="middle" class="fin-axis">${escapeSvg(row.label)}</text>`;
    }
  });

  definitions.filter(def => def.type === 'line').forEach(def => {
    let path = '', active = false;
    rows.forEach(row => {
      const value = row[def.key];
      if (!Number.isFinite(value)) { active = false; return; }
      const cx = margin.left + slot * rows.indexOf(row) + slot / 2;
      path += `${active ? 'L' : 'M'} ${cx} ${y(value)} `;
      active = true;
    });
    svg += `<path d="${path}" fill="none" stroke="${def.color}" stroke-width="3" stroke-dasharray="7 5"/>`;
    rows.forEach((row,index) => {
      const value = row[def.key];
      if (!Number.isFinite(value)) return;
      const cx = margin.left + slot * index + slot / 2;
      svg += `<circle cx="${cx}" cy="${y(value)}" r="3.5" fill="${def.color}" ${tooltipAttributes(row,def,value,unit,options)}><title>${escapeSvg(row.label)} • ${escapeSvg(def.label)}: ${escapeSvg(numberLabel(value))}</title></circle>`;
    });
  });

  svg += '</svg>';
  const periodLegend = Object.entries(quarterColors).map(([quarter,color]) =>
    `<span class="fin-legend-item"><i style="background:${color}"></i>${quarter}Ç</span>`).join('');
  const lineLegend = definitions.filter(def => def.type === 'line').map(def =>
    `<span class="fin-legend-item"><i style="background:${def.color}"></i>${escapeSvg(def.label)}</span>`).join('');
  return `<article class="financial-chart-card"><div class="fin-title"><div><h3>${escapeSvg(title)}</h3><p>${escapeSvg(subtitle)}</p></div><span class="fin-unit">${escapeSvg(unit)}</span></div><div class="fin-svg-wrap">${svg}<div class="financial-tooltip" hidden></div></div><div class="fin-legend">${periodLegend}${lineLegend}</div></article>`;
}

function showFinancialTooltip(mark, event) {
  const wrap = mark.closest('.fin-svg-wrap');
  const tooltip = wrap?.querySelector('.financial-tooltip');
  if (!tooltip) return;
  const current = Number(mark.dataset.tipValue);
  const prior = mark.dataset.tipPrior === '' ? null : Number(mark.dataset.tipPrior);
  const isPercent = mark.dataset.tipPercent === '1';
  const isRatio = mark.dataset.tipRatio === '1';
  const unit = mark.dataset.tipUnit;
  const formatValue = value => isPercent ? `%${pretty(value,1)}`
    : isRatio ? `${pretty(value,2)}x` : `${pretty(value,2)} ${unit}`;
  const signed = (value,digits=2) => `${value >= 0 ? '+' : ''}${pretty(value,digits)}`;
  let growthText = 'Geçen yılın aynı çeyrek verisi bulunmuyor.';
  let delta = null;
  if (prior != null && Number.isFinite(prior)) {
    delta = current-prior;
    if (prior > 0) {
      const rate = (current/prior-1)*100;
      growthText = isPercent
        ? `${signed(rate,1)}% büyüme • marj farkı ${signed(delta,1)} puan`
        : `${signed(rate,1)}% büyüme`;
    } else {
      growthText = isPercent
        ? `Oransal büyüme hesaplanamıyor • marj farkı ${signed(delta,1)} puan`
        : `Oransal büyüme hesaplanamıyor • dönem farkı ${signed(delta,2)} ${isRatio ? 'x' : unit}`;
    }
  }
  const tone = delta == null ? '' : delta >= 0 ? 'positive' : 'negative';
  tooltip.innerHTML = `<strong>${escapeSvg(mark.dataset.tipPeriod)} • ${escapeSvg(mark.dataset.tipSeries)}</strong><span>Değer <b>${escapeSvg(formatValue(current))}</b></span><div class="fin-growth ${tone}"><small>Geçen yılın aynı çeyreğine göre</small><b>${escapeSvg(growthText)}</b></div>`;
  tooltip.hidden = false;
  const rect = wrap.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX-rect.left+14, wrap.clientWidth-tooltip.offsetWidth-8));
  const top = Math.max(8, Math.min(event.clientY-rect.top+14, wrap.clientHeight-tooltip.offsetHeight-8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function quarterAvailableDate(period) {
  const [year, month] = period.split('/').map(Number);
  const end = new Date(Date.UTC(year, month, 0));
  end.setUTCDate(end.getUTCDate() + (month === 12 ? 75 : 60));
  return end.toISOString().slice(0,10);
}

function buildFnfkSeries(company, prices) {
  const quarters = company.periods || [];
  const shares = Number(company.shares_outstanding);
  if (!(shares > 0)) return [];
  return (prices || []).map(point => {
    const known = quarters.filter(q => quarterAvailableDate(q.period) <= point.time);
    if (known.length < 4) return null;
    const latest = known[known.length-1];
    const endIndex = quarters.indexOf(latest);
    const lastFour = quarters.slice(endIndex-3,endIndex+1);
    const continuous = lastFour.length === 4 && lastFour.every((q,i) => {
      if (i===0) return true;
      const [py,pm]=lastFour[i-1].period.split('/').map(Number);
      const [cy,cm]=q.period.split('/').map(Number);
      return (cy*4+Math.ceil(cm/3))-(py*4+Math.ceil(pm/3))===1;
    });
    if (!continuous || !lastFour.every(q => Number.isFinite(q.netOperatingProfit))) return null;
    const ttm = lastFour.reduce((sum,q)=>sum+q.netOperatingProfit,0);
    const perShare = ttm/shares;
    if (!Number.isFinite(perShare) || perShare === 0) return null;
    return {time:point.time,price:point.close,ttm,perShare,ratio:point.close/perShare};
  }).filter(Boolean);
}

function dailyLabel(time) {
  const [year,month]=time.split('-');
  return `${year}/${Number(month)}`;
}

function drawFnfkChart(company, ticker) {
  const host=document.getElementById('fnfk-chart');
  if (!window.financialPriceData) {
    host.innerHTML='<div class="financial-chart-empty">Günlük fiyat geçmişi hazırlanıyor…</div>';
    return;
  }
  const all=buildFnfkSeries(company,window.financialPriceData.daily_prices?.[ticker]);
  const range=document.querySelector('[data-daily-range].active')?.dataset.dailyRange || 'all';
  let points=all;
  if (points.length && range!=='all') {
    const months=range==='1y'?12:36;
    const cutoff=new Date(points[points.length-1].time+'T00:00:00Z');
    cutoff.setUTCMonth(cutoff.getUTCMonth()-months);
    const key=cutoff.toISOString().slice(0,10);
    points=points.filter(p=>p.time>=key);
  }
  if (points.length<2) {
    host.innerHTML='<div class="financial-chart-empty">Bu hisse için yeterli günlük F/NFK geçmişi bulunamadı.</div>';
    return;
  }
  const width=980,height=350,margin={left:72,right:22,top:20,bottom:48};
  const plotW=width-margin.left-margin.right,plotH=height-margin.top-margin.bottom;
  const values=points.map(p=>p.ratio);
  let min=Math.min(...values),max=Math.max(...values);
  if(min===max){min-=1;max+=1;}
  const pad=(max-min)*0.08;min-=pad;max+=pad;
  const y=v=>margin.top+(max-v)/(max-min)*plotH;
  const x=i=>margin.left+i*plotW/(points.length-1);
  const average=values.reduce((a,b)=>a+b,0)/values.length;
  const band=Math.abs(average)*0.2;
  const upper=average+band,lower=average-band;
  let path='';
  points.forEach((p,i)=>{path+=`${i?'L':'M'} ${x(i).toFixed(2)} ${y(p.ratio).toFixed(2)} `;});
  let svg=`<svg class="financial-svg fnfk-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvg(ticker)} günlük fiyat net faaliyet kârı katsayısı">`;
  for(let i=0;i<=4;i++){
    const value=max-(max-min)*i/4, yy=y(value);
    svg+=`<line x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}" class="fin-grid"/><text x="${margin.left-9}" y="${yy+4}" text-anchor="end" class="fin-axis">${pretty(value,1)}x</text>`;
  }
  const levels=[
    {value:upper,color:'#3dc8f4',label:'Ort. %20 üstü'},
    {value:average,color:'#75d27b',label:'Ortalama'},
    {value:lower,color:'#3dc8f4',label:'Ort. %20 altı'},
  ];
  levels.forEach(level=>{
    const yy=y(level.value);
    svg+=`<line x1="${margin.left}" y1="${yy}" x2="${width-margin.right}" y2="${yy}" class="fnfk-level" stroke="${level.color}"/><text x="${margin.left+7}" y="${yy-7}" class="fnfk-level-label" fill="${level.color}">${level.label}: ${pretty(level.value,2)}</text>`;
  });
  svg+=`<path d="${path}" fill="none" stroke="#82aaff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><title>${escapeSvg(ticker)} F/NFK günlük</title></path>`;
  const labels=5;
  for(let i=0;i<labels;i++){
    const index=Math.round(i*(points.length-1)/(labels-1));
    svg+=`<text x="${x(index)}" y="${height-17}" text-anchor="middle" class="fin-axis">${dailyLabel(points[index].time)}</text>`;
  }
  svg+='<line class="fnfk-crosshair" x1="0" y1="'+margin.top+'" x2="0" y2="'+(height-margin.bottom)+'" stroke="#a9c8ff" stroke-dasharray="4 4" style="display:none;pointer-events:none"/><circle class="fnfk-hover-dot" cx="0" cy="0" r="4" fill="#ffffff" stroke="#82aaff" stroke-width="2" style="display:none;pointer-events:none"/>';
  svg+='</svg>';
  host.innerHTML=svg+'<div class="fnfk-hover-tooltip" role="status" aria-live="polite" hidden></div>';
  const svgNode=host.querySelector('svg');
  const tip=host.querySelector('.fnfk-hover-tooltip');
  const crosshair=host.querySelector('.fnfk-crosshair');
  const dot=host.querySelector('.fnfk-hover-dot');
  svgNode.addEventListener('pointermove',event=>{
    const rect=svgNode.getBoundingClientRect();
    const viewX=(event.clientX-rect.left)/rect.width*width;
    const index=Math.max(0,Math.min(points.length-1,Math.round((viewX-margin.left)/plotW*(points.length-1))));
    const point=points[index], px=x(index), py=y(point.ratio);
    crosshair.setAttribute('x1',px);crosshair.setAttribute('x2',px);crosshair.style.display='';
    dot.setAttribute('cx',px);dot.setAttribute('cy',py);dot.style.display='';
    tip.innerHTML='<b>'+escapeSvg(point.time)+'</b><span>F/NFK <strong>'+pretty(point.ratio,2)+'x</strong></span><span>Kapanış <strong>'+pretty(point.price,2)+' ₺</strong></span>';
    tip.hidden=false;
    const hostRect=host.getBoundingClientRect();
    const left=Math.max(8,Math.min(hostRect.width-190,event.clientX-hostRect.left+14));
    const top=Math.max(4,Math.min(hostRect.height-92,event.clientY-hostRect.top-72));
    tip.style.left=left+'px';tip.style.top=top+'px';
  });
  svgNode.addEventListener('pointerleave',()=>{tip.hidden=true;crosshair.style.display='none';dot.style.display='none';});
  const last=points[points.length-1];
  const caption=document.getElementById('fnfk-caption');
  caption.textContent=`${points.length.toLocaleString('tr-TR')} günlük gözlem • Son oran ${pretty(last.ratio,2)}x • F/NFK = kapanış fiyatı / TTM net faaliyet kârı hisse başına`;
}

function median(values) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b), mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
function growthRate(current,previous) {
  return Number.isFinite(current)&&Number.isFinite(previous)&&previous>0
    ? (current/previous-1)*100 : null;
}
function scoreGrowth(medianGrowth) {
  if (!Number.isFinite(medianGrowth)) return null;
  const clipped=Math.max(-100,Math.min(200,medianGrowth));
  return 50+50*Math.tanh(clipped/60);
}
function calculateQuarterScores(rows) {
  const growthRows=rows.map(row=>{
    const yearAgo=rows.find(item=>item.quarter?.[0]===row.quarter?.[0]-1&&item.quarter?.[1]===row.quarter?.[1]);
    return {...row,yoy:{sales:growthRate(row.sales,yearAgo?.sales),op:growthRate(row.netOperatingProfit,yearAgo?.netOperatingProfit)}};
  });
  return growthRows.map((row,index)=>{
    const yearAgo=growthRows.find(item=>item.quarter?.[0]===row.quarter?.[0]-1&&item.quarter?.[1]===row.quarter?.[1]);
    const salesGrowth=growthRate(row.sales,yearAgo?.sales);
    const opGrowth=growthRate(row.netOperatingProfit,yearAgo?.netOperatingProfit);
    const recent=growthRows.slice(Math.max(0,index-3),index+1).map(item=>item.yoy).filter(Boolean);
    const salesRates=recent.map(item=>item.sales).filter(Number.isFinite);
    const opRates=recent.map(item=>item.op).filter(Number.isFinite);
    const salesScore=scoreGrowth(median(salesRates));
    const opScore=scoreGrowth(median(opRates));
    const levelScore=salesScore==null ? opScore : opScore==null ? salesScore : salesScore*0.35+opScore*0.65;
    const positiveRates=[...salesRates,...opRates];
    const consistencyScore=positiveRates.length
      ? positiveRates.filter(value=>value>0).length/positiveRates.length*100 : null;
    const cashRatio=row.shortDebt>0&&row.cashAndInvestments!=null
      ? row.cashAndInvestments/row.shortDebt
      : row.shortDebt===0&&row.cashAndInvestments!=null ? Infinity : null;
    const liquidityScore=cashRatio==null ? null
      : !Number.isFinite(cashRatio)||cashRatio>=1.5 ? 100
      : cashRatio<=0 ? 0
      : cashRatio<=0.5 ? cashRatio*100
      : cashRatio<=1 ? 50+(cashRatio-0.5)*60
      : 80+(cashRatio-1)*40;
    const parts=[
      {key:'growth',label:'Büyüme seviyesi',value:levelScore,weight:0.45},
      {key:'consistency',label:'Büyüme düzenliliği',value:consistencyScore,weight:0.25},
      {key:'liquidity',label:'Nakit / kısa borç',value:liquidityScore,weight:0.30},
    ];
    const available=parts.filter(part=>Number.isFinite(part.value));
    const score=available.length
      ? available.reduce((sum,part)=>sum+part.value*part.weight,0)/available.reduce((sum,part)=>sum+part.weight,0)
      : null;
    return {...row,yoy:{sales:salesGrowth,op:opGrowth},score,scoreParts:parts,
      scoreCoverage:recent.length, cashDebtCoverage:cashRatio};
  });
}
function renderFinancialScore(rows, company) {
  const host=document.getElementById('financial-score');
  if (!host) return;
  const latest=[...rows].reverse().find(row=>Number.isFinite(row.score));
  if (!latest) {
    host.innerHTML='<div class="score-empty">Karşılaştırılabilir aynı çeyrek verisi bulunamadı.</div>';
    return;
  }
  const score=Math.round(latest.score);
  const color=score>=70?'#75d27b':score>=45?'#e9bd66':'#ff6868';
  const name=score>=75?'Güçlü':score>=60?'Olumlu':score>=40?'Orta':'Zayıf';
  const parts=latest.scoreParts.map(part=>{
    const value=Number.isFinite(part.value)?Math.round(part.value):null;
    return '<div class="score-part"><div><span>'+part.label+'</span><b>'+(value==null?'Veri yok':value+'/100')+'</b></div><div class="score-track"><i style="width:'+(value??0)+'%;background:'+(part.key==='liquidity'?'#67b8d5':color)+'"></i></div></div>';
  }).join('');
  const coverage=latest.scoreCoverage;
  host.innerHTML='<div class="score-top"><div><h3>Çeyreklik finansal kalite puanı</h3><p>'+company.name+' • Son değerlendirilen dönem '+latest.label+'</p></div><div class="score-total" style="--score-color:'+color+'"><b>'+score+'</b><span>/ 100</span></div></div><div class="score-meter"><i style="width:'+score+'%;background:'+color+'"></i></div><div class="score-rating" style="color:'+color+'">'+name+'</div><div class="score-breakdown">'+parts+'</div><div class="score-history"><span>Çeyreklik puan geçmişi</span><div class="score-spark">'+rows.filter(row=>Number.isFinite(row.score)).map(row=>'<span tabindex="0" data-tip="'+escapeSvg(row.label)+' • '+Math.round(row.score)+'/100 puan" aria-label="'+escapeSvg(row.label)+': '+Math.round(row.score)+'/100" title="'+row.label+': '+Math.round(row.score)+'/100" style="height:'+Math.max(4,row.score)+'%"></span>').join('')+'</div></div><p class="score-method">Puan: büyüme seviyesi %45 (satış büyümesi %35, net faaliyet kârı büyümesi %65; son 4 aynı-çeyrek yıllık değişimin medyanı), pozitif büyüme düzenliliği %25, (nakit + finansal yatırımlar) / kısa vadeli finansal borç %30. Tek dönemlik sıçramalar medyan ve sınırlı büyüme dönüşümüyle yumuşatılır. Büyüme yalnızca önceki yıl karşılaştırma tabanı pozitif olduğunda hesaplanır. Eksik bileşenler kalan ağırlıklara orantılı dağıtılır; dönemsel nakit karşılama 1,5x ve üzerinde tam puandır. Bu gösterge yatırım tavsiyesi değildir.</p>';
}
function renderFinancials() {
  if (!window.financialData) return;
  const ticker = financialSelect.value;
  const company = window.financialData.companies[ticker];
  financialAllRows = calculateQuarterScores(buildFinancialRows(company));
  renderFinancialScore(financialAllRows, company);
  let rows = financialAllRows;
  const limit = financialRange.value;
  if (limit !== 'all') rows = rows.slice(-Number(limit));

  const bar = (key,label,color) => ({key,label,color});
  const charts = [
    drawFinancialChart('Satış gelirleri', 'Çeyreklik', rows, [bar('sales','Satış','#ef8c2f')], '₺ milyon'),
    drawFinancialChart('Net faaliyet kârı*', 'Çeyreklik • görseldeki formül', rows, [bar('netOperatingProfit','Net faaliyet kârı','#75b7b2')], '₺ milyon'),
    drawFinancialChart('Net kâr (ana ortaklık payı)', 'Çeyreklik', rows, [bar('netProfit','Ana ortaklık net kârı','#8e79ad')], '₺ milyon'),
    drawFinancialChart('Brüt kâr marjı', 'Çeyreklik marj ve basit 4Ç hareketli ortalama', rows, [
      bar('grossMargin','Brüt kâr marjı','#ef8c2f'),
      {key:'grossMarginSma4',label:'4Ç ortalaması',color:'#e9eef5',type:'line'},
    ], '%', {percent:true}),
    drawFinancialChart('Net faaliyet kârı marjı', 'Çeyreklik marj ve basit 4Ç hareketli ortalama', rows, [
      bar('operatingMargin','Net faaliyet kârı marjı','#75b7b2'),
      {key:'operatingMarginSma4',label:'4Ç ortalaması',color:'#e9eef5',type:'line'},
    ], '%', {percent:true}),
    drawFinancialChart('Net kâr marjı', 'Ana ortaklık payı / satış gelirleri', rows, [
      bar('netMargin','Net kâr marjı','#8e79ad'),
      {key:'netMarginSma4',label:'4Ç ortalaması',color:'#e9eef5',type:'line'},
    ], '%', {percent:true}),
    drawFinancialChart('Nakit ve finansal yatırımlar / kısa vadeli finansal borçlar', 'Nakit ve yatırımlar toplamı ile bilanço dönemi sonu kısa vadeli borç karşılaştırması', rows, [
      bar('cashAndInvestments','Nakit + finansal yatırımlar','#75b7b2'),
      {key:'shortDebt',label:'Kısa vadeli finansal borçlar',color:'#ef8c2f',type:'line'},
    ], '₺ milyon'),
    drawFinancialChart('Net nakit', '(Nakit + finansal yatırımlar) − kısa vadeli finansal borçlar', rows, [
      bar('netCash','Net nakit / (borç)','#5c91c9'),
    ], '₺ milyon'),
    drawFinancialChart('Net borç / FAVÖK', 'Net borç: toplam finansal borç − (nakit + finansal yatırımlar) • FAVÖK: son 4 çeyrek', rows, [
      bar('netDebtEbitda','Net borç / FAVÖK','#d77b79'),
    ], 'x', {ratio:true}),
  ];
  financialContainer.innerHTML = charts.join('');
  const latest = rows.at(-1);
  financialStatus.textContent = `${company.name} • ${rows.length} dönem gösteriliyor • Son dönem ${latest?.label || '—'}`;
  drawFnfkChart(company,ticker);
}

Promise.all([
  fetch('./data/financials.json',{cache:'no-store'}).then(response=>{
    if(!response.ok) throw new Error('Finansal veri dosyası yüklenemedi.');
    return response.json();
  }),
  fetch('./data/financial_prices.json',{cache:'no-store'}).then(response=>
    response.ok ? response.json() : null
  ).catch(()=>null)
]).then(([fundamentals,prices])=>{
  window.financialData=fundamentals;
  window.financialPriceData=prices;
  renderFinancials();
}).catch(error=>{
  financialStatus.textContent=error.message;
  financialContainer.innerHTML='<div class="financial-chart-empty">Finansal tablolar şu anda yüklenemiyor.</div>';
});

financialContainer.addEventListener('pointermove', event => {
  const mark = event.target.closest('[data-fin-tooltip]');
  financialContainer.querySelectorAll('.financial-tooltip:not([hidden])').forEach(node => { if (!mark || !mark.closest('.fin-svg-wrap')?.contains(node)) node.hidden = true; });
  if (mark) showFinancialTooltip(mark,event);
});
financialContainer.addEventListener('pointerleave', () => {
  financialContainer.querySelectorAll('.financial-tooltip').forEach(node => { node.hidden = true; });
});
financialSelect.addEventListener('change', renderFinancials);
financialRange.addEventListener('change', renderFinancials);
document.querySelectorAll('[data-daily-range]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-daily-range]').forEach(item=>item.classList.remove('active'));
  button.classList.add('active');
  renderFinancials();
}));

(function addFinancialHoverStyles(){
  if(document.getElementById('financial-hover-styles'))return;
  const style=document.createElement('style');style.id='financial-hover-styles';
  style.textContent='.score-spark{position:relative}.score-spark span{position:relative;cursor:crosshair}.score-spark span:hover,.score-spark span:focus{outline:2px solid #fff;outline-offset:2px;z-index:2}.score-spark span::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);display:none;white-space:nowrap;padding:8px 10px;border:1px solid #466184;border-radius:7px;background:#08111f;color:#eef5ff;font-size:13px;font-weight:700;z-index:20;box-shadow:0 5px 18px #0008}.score-spark span:hover::after,.score-spark span:focus::after{display:block}#fnfk-chart{position:relative}.fnfk-hover-tooltip{position:absolute;z-index:10;min-width:154px;padding:9px 11px;border:1px solid #466184;border-radius:8px;background:#08111fee;color:#dce8fa;font-size:13px;line-height:1.5;box-shadow:0 6px 20px #0008;pointer-events:none}.fnfk-hover-tooltip b,.fnfk-hover-tooltip strong{color:#fff}.fnfk-hover-tooltip span{display:block}';
  document.head.appendChild(style);
})();
