const el = document.getElementById('chart');
const chartOptions = {
  layout: { background: { color: '#111c2e' }, textColor: '#a9b8cc' },
  grid: { vertLines: { color: '#1d2a3d' }, horzLines: { color: '#1d2a3d' } },
  rightPriceScale: { borderColor: '#28374c' },
  timeScale: { borderColor: '#28374c', timeVisible: false },
  crosshair: { mode: 0 },
};
let chart;
let series;
let data;
let selectedIndex;
let tooltip;

const fmt = n => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = value => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(value + 'T00:00:00'));
const rangeMonths = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '5y': 60 };

function setStatus(message, healthy = true) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = healthy ? '#42c7a5' : '#e9bd66';
}

function ensureChart() {
  if (chart) return;
  const { width, height } = el.getBoundingClientRect();
  chart = LightweightCharts.createChart(el, {
    ...chartOptions,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });
  series = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderUpColor: '#26a69a', borderDownColor: '#ef5350',
    wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  el.appendChild(tooltip);
  chart.subscribeCrosshairMove(showCandleTooltip);
  new ResizeObserver(entries => {
    if (!entries.length) return;
    const rect = entries[0].contentRect;
    if (rect.width > 0 && rect.height > 0) {
      chart.resize(Math.round(rect.width), Math.round(rect.height));
    }
  }).observe(el);
}

function dateKey(time) {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function showCandleTooltip(param) {
  if (!tooltip || !selectedIndex || !param.point || !param.seriesData) {
    if (tooltip) tooltip.hidden = true;
    return;
  }
  const bar = param.seriesData.get(series);
  if (!bar || !('close' in bar)) {
    tooltip.hidden = true;
    return;
  }
  const key = dateKey(bar.time ?? param.time);
  const index = selectedIndex.candles.findIndex(candle => candle.time === key);
  if (index < 0) {
    tooltip.hidden = true;
    return;
  }
  const candle = selectedIndex.candles[index];
  const previous = index > 0 ? selectedIndex.candles[index - 1] : null;
  const difference = previous ? candle.close - previous.close : null;
  const percent = previous ? difference / previous.close * 100 : null;
  const signed = value => `${value >= 0 ? '+' : ''}${fmt(value)}`;
  const deltaClass = difference === null ? '' : difference >= 0 ? 'positive' : 'negative';

  tooltip.innerHTML = `<strong>${dateFmt(candle.time)}</strong>
    <span>Açılış <b>${fmt(candle.open)}</b></span>
    <span>Yüksek <b>${fmt(candle.high)}</b></span>
    <span>Düşük <b>${fmt(candle.low)}</b></span>
    <span>Kapanış <b>${fmt(candle.close)}</b></span>
    <div class="tooltip-delta">
      <small>Önceki mum kapanışına göre</small>
      <b class="${deltaClass}">${previous ? `${signed(difference)} (${percent >= 0 ? '+' : ''}${percent.toFixed(2).replace('.', ',')}%)` : '—'}</b>
    </div>`;
  tooltip.hidden = false;

  const left = Math.max(8, Math.min(param.point.x + 14, el.clientWidth - tooltip.offsetWidth - 8));
  const top = Math.max(8, Math.min(param.point.y + 14, el.clientHeight - tooltip.offsetHeight - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showRange(range) {
  if (!selectedIndex?.candles?.length) return;
  const candles = selectedIndex.candles;
  const last = new Date(candles[candles.length - 1].time + 'T00:00:00');
  const from = new Date(last);
  if (range !== 'all') from.setMonth(from.getMonth() - rangeMonths[range]);
  const key = from.toISOString().slice(0, 10);
  series.setData(range === 'all' ? candles : candles.filter(row => row.time >= key));
  chart.timeScale().fitContent();
}

function renderIndex(code) {
  selectedIndex = data.indexes[code];
  if (!selectedIndex?.candles?.length) throw new Error(`${code} için henüz mum verisi bulunamadı.`);

  const candles = selectedIndex.candles;
  const last = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : null;
  document.getElementById('index-name').textContent = selectedIndex.short_name;
  document.getElementById('subtitle').textContent =
    `${selectedIndex.constituent_count} hissenin eşit ağırlıklı sentetik fiyat endeksi`;
  document.getElementById('chart-title').textContent = `${selectedIndex.short_name} günlük mum grafiği`;
  const blockers = selectedIndex.history_start_blockers || [];
  const blockerNote = blockers.length ? ` • Ortak başlangıcı belirleyen: ${blockers.join(', ')}` : '';
  document.getElementById('history-note').textContent =
    `Tüm ${selectedIndex.constituent_count} hissede ortak fiyat geçmişi: ${selectedIndex.history_starts}${blockerNote} • Başlangıç 1.000`;
  document.getElementById('value').textContent = fmt(last.close);
  document.getElementById('date').textContent = dateFmt(last.time);
  document.getElementById('count').textContent = selectedIndex.constituent_count;
  document.getElementById('membership-date').textContent = dateFmt(selectedIndex.membership_as_of);
  const change = document.getElementById('change');
  if (previous) {
    const pct = (last.close / previous.close - 1) * 100;
    change.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2).replace('.', ',')}%`;
    change.style.color = pct >= 0 ? '#42c7a5' : '#ff7777';
  } else {
    change.textContent = '—';
  }

  // Reveal the panel before creating the canvas so its initial width and height
  // are measurable; hidden chart containers can otherwise remain blank.
  document.getElementById('empty').style.display = 'none';
  document.getElementById('panel').style.display = '';
  ensureChart();
  document.querySelectorAll('[data-range]').forEach(button => button.classList.toggle('active', button.dataset.range === 'all'));
  showRange('all');
}

document.querySelectorAll('[data-range]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-range]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    showRange(button.dataset.range);
  });
});

document.getElementById('index-select').addEventListener('change', event => {
  try {
    renderIndex(event.target.value);
  } catch (error) {
    setStatus(error.message, false);
  }
});

fetch('./data/indices.json', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('Veri dosyası henüz yayımlanmamış.');
    return response.json();
  })
  .then(payload => {
    data = payload;
    const picker = document.getElementById('index-select');
    const available = Object.keys(data.indexes || {});
    if (!available.length) throw new Error('Endeks verisi bulunamadı.');
    [...picker.options].forEach(option => { option.disabled = !available.includes(option.value); });
    if (!available.includes(picker.value)) picker.value = available[0];
    renderIndex(picker.value);
    const updated = new Date(data.updated_at);
    setStatus(`Veri güncellendi ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(updated)}`);
  })
  .catch(error => {
    document.getElementById('empty-title').textContent = 'Piyasa verisi yüklenemedi.';
    document.getElementById('empty-message').textContent =
      `${error.message} Veri yenilemesi tamamlandığında grafik otomatik görünür.`;
    setStatus('Veri bekleniyor', false);
  });
