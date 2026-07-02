# BIST Market Breadth Tracker

Her 30 dakikada bir otomatik çalışan, tamamen ücretsiz bir BIST piyasa
genişliği (market breadth) takip sistemi.

Ölçtüğü şeyler (her 30 dakikada bir):
- Kaç hisse **pozitif** / **negatif** (önceki güne göre)
- Kaç hisse **%4 üzerinde** / **%4 altında**
- Kaç hisse **günün açılışına göre** pozitif/negatif (senin "sabah iyi başlayıp
  gün sonu kötü kapanıyorsa" hipotezini test etmek için)

## Nasıl çalışıyor?

```
tickers.txt              -> takip edilecek hisse listesi
scripts/fetch_breadth.py -> yfinance ile veri çeker, docs/data.json'a ekler
.github/workflows/breadth.yml -> her 30 dakikada bir scripti otomatik çalıştırır (GitHub Actions, ücretsiz)
docs/index.html           -> data.json'ı okuyup grafikle gösteren dashboard (GitHub Pages, ücretsiz)
```

Hiçbir sunucu kiralamana, bilgisayarını açık tutmana gerek yok — her şey
GitHub'ın ücretsiz katmanında çalışır.

## Kurulum (5 dakika)

1. **GitHub'da yeni bir repo oluştur** (public veya private, ikisi de olur).

2. Bu klasördeki tüm dosyaları o repoya yükle:
   ```bash
   cd bist-breadth
   git init
   git add .
   git commit -m "İlk kurulum"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADIN/REPO_ADIN.git
   git push -u origin main
   ```

3. **GitHub Pages'i aç:**
   Repo → Settings → Pages → "Build and deployment" → Source: `Deploy from a branch`
   → Branch: `main`, klasör: `/docs` → Save.
   Birkaç dakika sonra siten şu adreste yayında olacak:
   `https://KULLANICI_ADIN.github.io/REPO_ADIN/`

4. **GitHub Actions'ın otomatik çalışmasına izin ver:**
   Repo → Settings → Actions → General → "Workflow permissions" →
   `Read and write permissions` seçeneğini işaretle, kaydet.
   (Script her çalıştığında `docs/data.json`'ı commit'leyip push edebilmesi için gerekli.)

5. İlk veriyi hemen görmek için beklemek istemiyorsan:
   Repo → Actions sekmesi → "BIST Breadth Tracker" → "Run workflow" ile elle tetikleyebilirsin.

Bundan sonra iş gününde her 30 dakikada bir (10:00-18:30 İstanbul saati)
otomatik çalışacak ve dashboard kendini güncelleyecek.

## Hisse listesini güncellemek

`tickers.txt` içine `.IS` uzantısı OLMADAN, her satıra bir hisse kodu
yazman yeterli (ör. `THYAO`, `GARAN`). Listeyi genişletmek/daraltmak
istersen bu dosyayı düzenleyip push'laman yeterli — script otomatik
olarak günceli okur.

Güncel BIST100/BIST All listesi için:
https://www.borsaistanbul.com adresindeki endeks bileşenleri sayfasını
veya KAP'ı referans alabilirsin.

## Bilinen sınırlamalar

- **Veri ~15 dakika gecikmelidir** (Yahoo Finance ücretsiz veri kaynağı).
  Trade tetikleyici olarak değil, genel piyasa nabzını ölçmek için kullan.
- Bazı BIST hisseleri Yahoo'da eksik/hatalı veri döndürebilir; script bunları
  otomatik olarak atlar (`total_tracked` alanı kaç hissenin başarıyla
  işlendiğini gösterir).
- GitHub Actions'ın ücretsiz zamanlayıcısı (`cron`) bazen birkaç dakika
  gecikmeli tetiklenebilir — bu GitHub'ın kendi altyapısından kaynaklanır,
  kritik değildir.
- 2000 kayıttan sonra en eski kayıtlar otomatik silinir (dosya şişmesin diye).
  Bunu `scripts/fetch_breadth.py` içindeki `history[-2000:]` satırından
  değiştirebilirsin.

## Sonraki adımlar (istersen)

- `positive_vs_open` / `negative_vs_open` trendini gün sonunda
  `positive` / `negative` ile karşılaştırarak senin hipotezini
  (sabah iyi → gün sonu kötü kapanan piyasa mı, yoksa tersi mi daha
  sağlıklı) geriye dönük test edebilirsin — tüm veri `docs/data.json`
  içinde tarih sırasıyla duruyor, Excel'e veya Python/pandas'a
  kolayca aktarılabilir.
- Stockbee Market Monitor'daki gibi 25-günlük hareketli ortalama
  bazlı ek metrikler (T2108 benzeri) eklemek istersen, `data.json`
  zaten zaman serisi olduğu için üzerine kolayca inşa edilebilir.
