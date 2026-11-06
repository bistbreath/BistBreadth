# BIST 100 Equal Weight

BIST 100 hisselerinden eşit ağırlıklı sentetik günlük OHLC mum serisi oluşturmak için başlangıç projesi.

## Proje durumu

- Web arayüzü ve mum grafik bileşeni hazır.
- Sentetik eşit ağırlık hesaplama betiği hazır.
- Gerçek piyasa verisi ve doğrulanmış BIST 100 bileşen listesi henüz eklenmedi.
- Bu nedenle site şu anda boş veri durumunu gösterir; örnek veya uydurma fiyat kullanılmaz.

## Dosyalar

- `docs/`: GitHub Pages ile yayımlanacak web sitesi
- `data/constituents.csv`: seçilen dönem için BIST 100 bileşenleri
- `data/prices.csv`: günlük OHLC girdisi
- `scripts/build_index.py`: eşit ağırlıklı sentetik endeks hesaplaması

## Veri hazırlığı

`data/constituents.csv`:
```csv
ticker
AKBNK
ASELS
...
```

İlk sürümde dosyada tam 100 benzersiz sembol olmalıdır.

`data/prices.csv`:
```csv
date,ticker,open,high,low,close
2026-01-02,AKBNK,....
2026-01-02,ASELS,....
```

Her işlem gününde listedeki 100 hissenin tamamı bulunmalıdır. Eksik fiyatı sessizce atlamak yerine betik hata verir; böylece ağırlıklar farkında olmadan değişmez.

## Hesaplama metodolojisi

Her gün, önceki kapanış itibarıyla 100 hisseye eşit ağırlık verilir. Her hissenin o günkü OHLC değeri önceki kapanışına bölünür. Bu 100 oranın aritmetik ortalaması, sentetik endeksin önceki kapanışına uygulanır.

- Başlangıç seviyesi: 1.000
- Yeniden dengeleme: günlük
- Kapanış, takip eden günün hesaplamasında yeni referans olur.
- Sentetik High/Low değerleri bağımsız hisse zirve/dip oranlarının ortalamasıdır. Hisselerin gün içi zirve ve dip zamanları aynı olmadığından bu değerler eşzamanlı olarak işlem görebilen gerçek bir portföyün kesin High/Low'u değildir.

İlk fiyat günü yalnızca 1.000 başlangıç noktasıdır; ilk günlük getiri ikinci işlem gününde hesaplanır.

## Çalıştırma

Python 3.10+:

```bash
pip install -r requirements.txt
python scripts/build_index.py
```

Komut `docs/data/index.json` üretir. Yerelde görüntülemek için proje kökünde:

```bash
python -m http.server 8000
```

Ardından `http://localhost:8000/docs/` adresini açın.

## GitHub Pages

Repository → Settings → Pages → Deploy from a branch → `main` → `/docs`.

## Veri ve lisans notu

Yahoo Finance, yfinance veya başka bir kaynağın verilerine erişebilmek, bunları herkese açık bir sitede yeniden yayımlama hakkı vermez. Veri sağlayıcısının kullanım ve yeniden dağıtım koşulları kontrol edilmelidir. Kurumsal ve kalıcı kullanım için lisanslı, düzeltilmiş tarihsel OHLC verisi tercih edilmelidir.

Bugünkü BIST 100 listesini geçmişe uygulamak sağkalım yanlılığı yaratır. Gerçek 10 yıllık karşılaştırma için tarihsel endeks bileşenleri ve etkinlik tarihleri gerekir. Bu sürümde tarihsel bileşen arşivi varmış gibi davranılmaz.

Bu proje Borsa İstanbul tarafından hesaplanan resmî bir endeks değildir; araştırma amaçlı sentetik bir göstergedir.
