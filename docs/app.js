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
let selectedRange = 'all';
let pollingIndexData = false;

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
    <span>Fiyat verisi bulunan hisse <b>${candle.constituent_count}/${candle.universe_count}</b></span>
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

function renderFollowThrough(report) {
  const section = document.getElementById('follow-through');
  const period = document.getElementById('follow-through-period');
  const rate = document.getElementById('follow-through-rate');
  const summary = document.getElementById('follow-through-summary');
  const positive = document.getElementById('follow-through-positive');
  const negative = document.getElementById('follow-through-negative');
  const pending = document.getElementById('follow-through-pending');
  const positiveBar = document.getElementById('follow-through-bar-positive');
  const negativeBar = document.getElementById('follow-through-bar-negative');
  const pendingBar = document.getElementById('follow-through-bar-pending');

  if (!report) {
    period.textContent = 'Takip hesabı için yeterli seans verisi yok.';
    rate.textContent = '—';
    summary.textContent = 'Uygun fiyat verisi geldiğinde hesaplanacak.';
    [positive, negative, pending].forEach(node => { node.textContent = '—'; });
    [positiveBar, negativeBar, pendingBar].forEach(node => { node.style.width = '0%'; });
    return;
  }

  period.textContent = `${dateFmt(report.mover_date)} hareketi → ${dateFmt(report.follow_through_date)} takibi • ≥%4 yükselenler • Fiyat kapsamı ${report.priced_member_count}/${report.member_count}`;
  const resolved = report.following_through_count + report.below_count;
  const enoughCoverage = report.status !== 'insufficient_coverage';
  rate.textContent = !enoughCoverage || report.rate_percent == null ? '—' : `${report.rate_percent.toFixed(2).replace('.', ',')}%`;
  if (!enoughCoverage) {
    summary.textContent = `Yeterli dünkü hisse fiyatı yok (${report.priced_member_count}/${report.member_count}); oran hesaplanamadı.`;
    positive.textContent = negative.textContent = pending.textContent = '—';
    [positiveBar, negativeBar, pendingBar].forEach(node => { node.style.width = '0%'; });
  } else if (report.status === 'no_movers') {
    summary.textContent = 'Dünkü kapanışı en az %4 yükselen hisse bulunamadı.';
    positive.textContent = report.following_through_count;
    negative.textContent = report.below_count;
    pending.textContent = report.awaiting_count;
    [positiveBar, negativeBar, pendingBar].forEach(node => { node.style.width = '0%'; });
  } else {
    summary.textContent = `${report.following_through_count} / ${report.candidate_count} hissede bugünkü kapanış dünkü kapanışı korudu${report.awaiting_count ? ` • ${report.awaiting_count} hisse beklemede` : ''}`;
    positive.textContent = report.following_through_count;
    negative.textContent = report.below_count;
    pending.textContent = report.awaiting_count;
    const denominator = report.candidate_count || 1;
    positiveBar.style.width = `${report.following_through_count / denominator * 100}%`;
    negativeBar.style.width = `${report.below_count / denominator * 100}%`;
    pendingBar.style.width = `${report.awaiting_count / denominator * 100}%`;
  }
  document.getElementById('follow-through-bar').setAttribute(
    'aria-label',
    `${report.following_through_count} kapanışı korudu, ${report.below_count} altına indi, ${report.awaiting_count} fiyat bekleniyor`
  );
}

function renderIndex(code) {
  selectedIndex = data.indexes[code];
  if (!selectedIndex?.candles?.length) throw new Error(`${code} için henüz mum verisi bulunamadı.`);

  const candles = selectedIndex.candles;
  const last = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : null;
  document.getElementById('index-name').textContent = selectedIndex.short_name;
  document.getElementById('subtitle').textContent =
    `Günlük tarihsel bileşenlerle eşit ağırlıklı sentetik fiyat endeksi • Son listede ${selectedIndex.constituent_count} hisse`;
  document.getElementById('chart-title').textContent = `${selectedIndex.short_name} günlük mum grafiği`;
  document.getElementById('history-note').textContent =
    `Tarihsel BIST bileşen kayıtları • ${selectedIndex.history_membership_snapshots} üyelik dönemi • Geniş endekslere ilk fiyat gününde eklenen yeni hisseler • Başlangıç 1.000`;
  renderFollowThrough(selectedIndex.follow_through);
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
  document.querySelectorAll('[data-range]').forEach(button => button.classList.toggle('active', button.dataset.range === selectedRange));
  showRange(selectedRange);
}

document.querySelectorAll('[data-range]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-range]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    selectedRange = button.dataset.range;
    showRange(selectedRange);
  });
});

document.getElementById('index-select').addEventListener('change', event => {
  try {
    renderIndex(event.target.value);
  } catch (error) {
    setStatus(error.message, false);
  }
});

async function refreshIndexData() {
  if (pollingIndexData || document.visibilityState === 'hidden' || !data) return;
  pollingIndexData = true;
  try {
    const response = await fetch(`./data/indices.json?refresh=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = await response.json();
    if (!latest.updated_at || latest.updated_at === data.updated_at) return;
    data = latest;
    const picker = document.getElementById('index-select');
    const available = Object.keys(data.indexes || {});
    [...picker.options].forEach(option => { option.disabled = !available.includes(option.value); });
    if (!available.includes(picker.value)) picker.value = available[0];
    renderIndex(picker.value);
    const updated = new Date(data.updated_at);
    setStatus(`Veri güncellendi ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(updated)}`);
  } catch (_) {
    // Keep showing the last published data and retry on the next poll.
  } finally {
    pollingIndexData = false;
  }
}

setInterval(refreshIndexData, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshIndexData();
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
