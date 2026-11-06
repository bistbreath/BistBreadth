const el = document.getElementById('chart');
const chart = LightweightCharts.createChart(el, {
  layout: { background: { color: '#111c2e' }, textColor: '#a9b8cc' },
  grid: { vertLines: { color: '#1d2a3d' }, horzLines: { color: '#1d2a3d' } },
  rightPriceScale: { borderColor: '#28374c' },
  timeScale: { borderColor: '#28374c', timeVisible: false },
  crosshair: { mode: 0 },
});
const series = chart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

const fmt = n => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = value => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(value + 'T00:00:00'));
const rangeMonths = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '5y': 60 };
let data;
let selectedIndex;

function setStatus(message, healthy = true) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.style.color = healthy ? '#42c7a5' : '#e9bd66';
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
  document.getElementById('history-note').textContent =
    `Geçmiş hesaplama ${selectedIndex.history_starts} tarihinde başlıyor • Başlangıç seviyesi 1.000 • Günlük eşit ağırlık`;
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
  document.getElementById('empty').style.display = 'none';
  document.getElementById('panel').style.display = '';
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

new ResizeObserver(entries => {
  if (!entries.length) return;
  const { width, height } = entries[0].contentRect;
  // The chart is created while its parent panel is hidden. Resize both dimensions
  // when the panel opens so the canvas is not left at zero height.
  if (width > 0 && height > 0) {
    chart.applyOptions({ width, height });
    chart.timeScale().fitContent();
  }
}).observe(el);
