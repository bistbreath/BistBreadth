const financialSelect = document.getElementById('financial-ticker');
const financialRange = document.getElementById('financial-range');
const financialContainer = document.getElementById('financial-charts');
const financialStatus = document.getElementById('financial-status');
let financialAllRows = [];
const quarterColors = {1:'#4f7fb3',2:'#ef8c2f',3:'#75b7b2',4:'#a878a5'};
const billions = value => value == null || !Number.isFinite(value) ? null : value / 1e9;
const quarterLabel = period => {
  const [year, month] = period.split('/').map(Number);
  return `${Math.ceil(month / 3)}Ç ${year}`;
};
const pretty = (value, digits = 2) => Number(value).toLocaleString('tr-TR', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const escapeSvg = value => String(value).replace(/[&<>"']/g, ch => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[ch]));

function buildFinancialRows(company) {
  const source = company.periods || [];
  return source.map((row, index) => {
    const sales = billions(row.sales);
    const gross = billions(row.grossProfit);
    const netOperating = billions(row.netOperatingProfit);
    const netProfit = billions(row.netProfit);
    const cash = billions(row.cash);
    const investments = billions(row.financialInvestments);
    const shortDebt = billions(row.shortTermDebt);
    const longDebt = billions(row.longTermDebt);
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
          sum + item.operatingProfit + item.depreciationAmortization, 0) / 1e9;
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
  const groupWidth = Math.min(slot * 0.72, 42);
  const barWidth = Math.max(2, Math.min(28, groupWidth / Math.max(1,barDefs.length)));
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
  let comparison = 'Geçen yılın aynı çeyrek verisi yok.';
  if (prior != null && Number.isFinite(prior)) {
    if (isPercent) {
      const delta = current-prior;
      comparison = `Geçen yıl aynı çeyrek: ${formatValue(prior)} • Fark: ${signed(delta,1)} puan`;
      if (prior > 0) comparison += ` • Oransal değişim: ${signed((current/prior-1)*100,1)}%`;
    } else if (prior > 0) {
      comparison = `Geçen yıl aynı çeyrek: ${formatValue(prior)} • Büyüme: ${signed((current/prior-1)*100,1)}%`;
    } else {
      const delta = current-prior;
      comparison = `Geçen yıl aynı çeyrek: ${formatValue(prior)} • Fark: ${signed(delta,2)} ${isRatio ? 'x' : unit} • Önceki değer sıfır/negatif olduğu için büyüme oranı anlamlı değil.`;
    }
  }
  tooltip.innerHTML = `<strong>${escapeSvg(mark.dataset.tipPeriod)} • ${escapeSvg(mark.dataset.tipSeries)}</strong><span>Değer <b>${escapeSvg(formatValue(current))}</b></span><small>${escapeSvg(comparison)}</small>`;
  tooltip.hidden = false;
  const rect = wrap.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX-rect.left+14, wrap.clientWidth-tooltip.offsetWidth-8));
  const top = Math.max(8, Math.min(event.clientY-rect.top+14, wrap.clientHeight-tooltip.offsetHeight-8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
function renderFinancials() {
  if (!window.financialData) return;
  const ticker = financialSelect.value;
  const company = window.financialData.companies[ticker];
  financialAllRows = buildFinancialRows(company);
  let rows = financialAllRows;
  const limit = financialRange.value;
  if (limit !== 'all') rows = rows.slice(-Number(limit));

  const bar = (key,label,color) => ({key,label,color});
  const charts = [
    drawFinancialChart('Satış gelirleri', 'Çeyreklik', rows, [bar('sales','Satış','#ef8c2f')], '₺ milyar'),
    drawFinancialChart('Net faaliyet kârı*', 'Çeyreklik • görseldeki formül', rows, [bar('netOperatingProfit','Net faaliyet kârı','#75b7b2')], '₺ milyar'),
    drawFinancialChart('Net kâr (ana ortaklık payı)', 'Çeyreklik', rows, [bar('netProfit','Ana ortaklık net kârı','#8e79ad')], '₺ milyar'),
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
    ], '₺ milyar'),
    drawFinancialChart('Net nakit', '(Nakit + finansal yatırımlar) − kısa vadeli finansal borçlar', rows, [
      bar('netCash','Net nakit / (borç)','#5c91c9'),
    ], '₺ milyar'),
    drawFinancialChart('Net borç / FAVÖK', 'Net borç: toplam finansal borç − (nakit + finansal yatırımlar) • FAVÖK: son 4 çeyrek', rows, [
      bar('netDebtEbitda','Net borç / FAVÖK','#d77b79'),
    ], 'x', {ratio:true}),
  ];
  financialContainer.innerHTML = charts.join('');
  const latest = rows.at(-1);
  financialStatus.textContent = `${company.name} • ${rows.length} dönem gösteriliyor • Son dönem ${latest?.label || '—'}`;
}

fetch('./data/financials.json', {cache:'no-store'})
  .then(response => {
    if (!response.ok) throw new Error('Finansal veri dosyası yüklenemedi.');
    return response.json();
  })
  .then(payload => {
    window.financialData = payload;
    renderFinancials();
  })
  .catch(error => {
    financialStatus.textContent = error.message;
    financialContainer.innerHTML = '<div class="financial-chart-empty">Finansal tablolar şu anda yüklenemiyor.</div>';
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
