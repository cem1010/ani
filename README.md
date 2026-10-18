# Anı

Termal yazıcıyla basılan anı fotoğraflarının dijital hali. Fotoğraflar telefonda AES-GCM ile şifrelenir; anahtar yalnız basılı QR'daki bağlantının `#` kısmında durur, sunucuya gitmez. `p/` klasöründeki dosyalar anahtarsız okunamaz.

- `index.html`: QR'ın açtığı fotoğraf sayfası
- `baski.html`: baskı uygulaması (Web Bluetooth, cat-printer protokolü)
- `lib/qrcode.js`: qrcode-generator (MIT, Kazuhiko Arase)
