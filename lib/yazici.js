// Termal "cat printer" ailesi (Torima C9 = PD01 / MX / GB serisi) sürücüsü.
// Protokol: 51 78 <komut> 00 <len lo> <len hi> <veri> <crc8> ff · 384 nokta genişlik.
// Taşıma: APK içinde yerel BLE köprüsü (window.Yerel), tarayıcıda Web Bluetooth.
'use strict';

const YAZICI = (() => {
  const REKLAM_SRV = 0xaf30, BASKI_SRV = 0xae30, TX = 0xae01, RX = 0xae02;
  const GENISLIK = 384;

  const CRC = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    CRC[i] = c;
  }
  const crc8 = (veri) => { let c = 0; for (const b of veri) c = CRC[(c ^ b) & 0xff]; return c; };

  const paket = (komut, veri) => new Uint8Array([
    0x51, 0x78, komut, 0x00, veri.length & 0xff, veri.length >> 8, ...veri, crc8(veri), 0xff,
  ]);
  const b1 = (v) => [v & 0xff];
  const b2 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const bekle = (ms) => new Promise(r => setTimeout(r, ms));
  const birles = (parcalar) => {
    const out = new Uint8Array(parcalar.reduce((t, p) => t + p.length, 0)); let o = 0;
    for (const p of parcalar) { out.set(p, o); o += p.length; }
    return out;
  };

  // LSB = en soldaki nokta
  function satirBaytlari(bitler, y) {
    const out = new Uint8Array(GENISLIK / 8);
    for (let x = 0; x < GENISLIK; x++) if (bitler[y * GENISLIK + x]) out[x >> 3] |= 1 << (x & 7);
    return out;
  }

  // Tüm baskı işini bayt dizisine çevir. hazirlik = ilk bölümün uzunluğu (sonrasında kısa bekleme gerekir:
  // yazıcı hazırlık komutlarını işlemeden gelen ilk satırlar yarım basılıyor).
  function isBaytlari(bitler, { hiz = 32, enerji = 24000, basBesleme = 8, sonBesleme = 60 } = {}) {
    const h = bitler.length / GENISLIK;
    const ilk = [
      paket(0xa3, b1(0)),
      new Uint8Array([0x51, 0x78, 0xbc, 0x00, 0x01, 0x02, 0x01, 0x2d, 0xff]),
      paket(0xa4, b1(50)),                       // 200 dpi
      paket(0xbd, b1(hiz)),
      paket(0xaf, b2(enerji)),
      paket(0xbe, b1(1)),                        // enerjiyi uygula
      paket(0xa9, b1(0)),
      paket(0xa6, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]),
    ];
    const govde = [];
    if (basBesleme) govde.push(paket(0xbd, b1(8)), paket(0xa1, b2(basBesleme)), paket(0xbd, b1(hiz)));
    let bos = 0;
    for (let y = 0; y < h; y++) {
      const satir = satirBaytlari(bitler, y);
      if (satir.every(b => b === 0)) { bos++; continue; }
      if (bos) { govde.push(paket(0xbd, b1(8)), paket(0xa1, b2(bos)), paket(0xbd, b1(hiz))); bos = 0; }
      govde.push(paket(0xa2, satir));
    }
    govde.push(
      paket(0xa6, [0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17]),
      paket(0xbd, b1(8)),
      paket(0xa1, b2(bos + sonBesleme)),
      paket(0xa3, b1(0)),
    );
    const a = birles(ilk), b = birles(govde);
    return { veri: birles([a, b]), hazirlik: a.length };
  }

  // ---- yerel köprü (APK): Yerel.bagla(yeniTara) / Yerel.yaz(b64, id, hazirlik) / Yerel.bagliMi() / Yerel.ad()
  const yerel = typeof window === 'object' && window.Yerel ? window.Yerel : null;
  const dinleyiciler = new Set();
  if (yerel) window.YEREL_OLAY = (o) => { for (const f of [...dinleyiciler]) f(o); };
  const olayBekle = (kosul, ms) => new Promise((ok, hata) => {
    const f = (o) => { const r = kosul(o); if (r !== undefined) { dinleyiciler.delete(f); clearTimeout(z); r instanceof Error ? hata(r) : ok(r); } };
    const z = setTimeout(() => { dinleyiciler.delete(f); hata(new Error('zaman aşımı')); }, ms);
    dinleyiciler.add(f);
  });
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

  // Li-ion açık devre gerilimi → yaklaşık yüzde
  const PIL_EGRI = [[4.15, 100], [4.10, 92], [4.00, 80], [3.92, 70], [3.87, 60], [3.83, 50], [3.79, 40],
                    [3.75, 30], [3.71, 20], [3.65, 10], [3.50, 3], [3.30, 0]];
  function pilYuzde(v) {
    if (v >= PIL_EGRI[0][0]) return 100;
    for (let i = 1; i < PIL_EGRI.length; i++) {
      const [v1, p1] = PIL_EGRI[i - 1], [v2, p2] = PIL_EGRI[i];
      if (v >= v2) return Math.round(p2 + (p1 - p2) * (v - v2) / (v1 - v2));
    }
    return 0;
  }

  class Yazici {
    constructor() {
      this.cihaz = null; this.tx = null; this.durum = 0; this.ad = ''; this.parca = 180; this.yerel = !!yerel;
      this.volt = null;
      this.degisti = () => {};
      if (yerel) dinleyiciler.add((o) => {
        if (o.ham) this._ham(Uint8Array.from(o.ham.match(/../g).map(h => parseInt(h, 16))));
        if (o.tur === 'durum') this.durum = o.d;
        if (o.tur === 'bagli') this.ad = o.ad;
        if (o.tur === 'bagli' || o.tur === 'koptu') this.degisti();
      });
    }
    get bagli() { return yerel ? yerel.bagliMi() : !!(this.cihaz && this.cihaz.gatt.connected && this.tx); }
    // A3 (durum) yanıtı: 51 78 a3 01 03 00 <durum> <gerilim hi> <gerilim lo> crc ff · gerilim 10 mV
    _ham(v) {
      if (v.length >= 11 && v[2] === 0xa3 && v[4] === 3) {
        const volt = ((v[7] << 8) | v[8]) / 100;
        if (volt > 2.5 && volt < 4.5) this.volt = this.volt ? this.volt * 0.6 + volt * 0.4 : volt;
      }
    }
    get pil() { return this.volt ? pilYuzde(this.volt) : null; }
    async durumSor() {
      if (!this.bagli) return;
      const p = paket(0xa3, b1(0));
      try {
        if (yerel) yerel.yaz(b64(p), 'durum' + Date.now(), 0);
        else await this.tx.writeValueWithoutResponse(p);
      } catch { /* baskı sürüyorsa sonra */ }
    }
    get durumMetni() {
      const d = this.durum, m = [];
      if (d & 1) m.push('kâğıt bitti'); if (d & 2) m.push('kapak açık');
      if (d & 4) m.push('aşırı ısındı'); if (d & 8) m.push('pil zayıf');
      return m.join(', ');
    }

    async sec() {
      if (yerel) return this._yerelBagla(true);
      this.cihaz = await navigator.bluetooth.requestDevice({
        filters: [{ services: [REKLAM_SRV] }, { services: [BASKI_SRV] }],
        optionalServices: [BASKI_SRV, REKLAM_SRV],
      });
      this.cihaz.addEventListener('gattserverdisconnected', () => this.degisti());
      return this.bagla();
    }

    // Daha önce kullanılan yazıcıya seçim penceresi olmadan bağlan
    async oncekiniBul() {
      if (yerel) { try { await this._yerelBagla(false); return true; } catch { return false; } }
      if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return false;
      const liste = await navigator.bluetooth.getDevices();
      if (!liste.length) return false;
      this.cihaz = liste[0];
      this.cihaz.addEventListener('gattserverdisconnected', () => this.degisti());
      try { await this.bagla(); return true; } catch { return false; }
    }

    async _yerelBagla(yeniTara) {
      const s = olayBekle(o => o.tur === 'bagli' ? o.ad : o.tur === 'hata' ? new Error(o.mesaj) : undefined, 25000);
      yerel.bagla(!!yeniTara);
      this.ad = await s; return this.ad;
    }

    async bagla() {
      if (yerel) return this._yerelBagla(false);
      this.ad = this.cihaz.name || 'yazıcı';
      const gatt = await this.cihaz.gatt.connect();
      const srv = await gatt.getPrimaryService(BASKI_SRV);
      this.tx = await srv.getCharacteristic(TX);
      try {
        const rx = await srv.getCharacteristic(RX);
        rx.addEventListener('characteristicvaluechanged', (e) => {
          const v = new Uint8Array(e.target.value.buffer);
          if (v.length > 6) this.durum = v[6];
          this._ham(v);
        });
        await rx.startNotifications();
      } catch (e) { console.warn('bildirim yok', e); }
      this.degisti();
      return this.ad;
    }

    // bitler: Uint8Array(GENISLIK * yukseklik), 1 = siyah
    async bas(bitler, ayar = {}) {
      if (!this.bagli) await this.bagla();
      const { veri, hazirlik } = isBaytlari(bitler, ayar);
      const ilerleme = ayar.ilerleme || (() => {});
      if (yerel) {
        const id = String(Date.now());
        const f = (o) => { if (o.tur === 'ilerleme' && o.id === id) ilerleme(o.p); };
        dinleyiciler.add(f);
        try {
          const s = olayBekle(o => o.id !== id ? undefined : o.tur === 'bitti' ? true : o.tur === 'hata' ? new Error(o.mesaj) : undefined, 120000);
          yerel.yaz(b64(veri), id, hazirlik);
          await s;
        } finally { dinleyiciler.delete(f); }
        ilerleme(1); return;
      }
      const yaz = this.tx.writeValueWithoutResponse ? 'writeValueWithoutResponse' : 'writeValue';
      for (let i = 0; i < veri.length;) {
        let bekleme = 0;
        while ((this.durum & 0x10) && bekleme++ < 100) await bekle(100);
        const son = i < hazirlik ? hazirlik : Math.min(veri.length, i + this.parca);
        for (let j = i; j < son; j += this.parca) await this.tx[yaz](veri.slice(j, Math.min(son, j + this.parca)));
        await bekle(i < hazirlik ? 80 : 20);
        i = son; ilerleme(i / veri.length);
      }
    }
  }

  // --- görüntü işleme: canvas → 1 bit ---
  function griTon(img, { parlaklik = 0, kontrast = 1.15, gama = 1 } = {}) {
    const d = img.data, g = new Float32Array(img.width * img.height);
    let min = 255, max = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const a = d[i + 3] / 255;
      const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
      g[j] = v; if (v < min) min = v; if (v > max) max = v;
    }
    const aralik = Math.max(1, max - min);
    for (let j = 0; j < g.length; j++) {
      let v = (g[j] - min) / aralik;                       // otomatik seviye
      v = Math.pow(Math.min(1, Math.max(0, v)), gama);
      v = (v - 0.5) * kontrast + 0.5 + parlaklik;
      g[j] = Math.min(1, Math.max(0, v)) * 255;
    }
    return g;
  }

  // Atkinson: termalde Floyd-Steinberg'den daha temiz, açık tonları korur
  function titret(g, w, h, yontem = 'atkinson') {
    const bit = new Uint8Array(w * h), e = Float32Array.from(g);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, eski = e[i], yeni = eski < 128 ? 0 : 255, hata = eski - yeni;
      bit[i] = yeni === 0 ? 1 : 0;
      if (yontem === 'esik') continue;
      if (yontem === 'floyd') {
        if (x + 1 < w) e[i + 1] += hata * 7 / 16;
        if (y + 1 < h) { if (x) e[i + w - 1] += hata * 3 / 16; e[i + w] += hata * 5 / 16; if (x + 1 < w) e[i + w + 1] += hata / 16; }
      } else {
        const k = hata / 8;
        if (x + 1 < w) e[i + 1] += k; if (x + 2 < w) e[i + 2] += k;
        if (y + 1 < h) { if (x) e[i + w - 1] += k; e[i + w] += k; if (x + 1 < w) e[i + w + 1] += k; }
        if (y + 2 < h) e[i + 2 * w] += k;
      }
    }
    return bit;
  }

  function esikle(img, esik = 160) {
    const d = img.data, bit = new Uint8Array(img.width * img.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const a = d[i + 3] / 255, v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a);
      bit[j] = v < esik ? 1 : 0;
    }
    return bit;
  }

  return { Yazici, GENISLIK, griTon, titret, esikle, crc8, paket, isBaytlari, yerelMi: !!yerel };
})();
if (typeof module === 'object') module.exports = YAZICI;
