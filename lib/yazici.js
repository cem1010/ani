// Termal "cat printer" ailesi (Torima C9 / MX / GB serisi) için Web Bluetooth sürücüsü.
// Protokol: 51 78 <komut> 00 <len lo> <len hi> <veri> <crc8> ff · 384 nokta genişlik.
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

  // LSB = en soldaki nokta
  function satirBaytlari(bitler, y) {
    const out = new Uint8Array(GENISLIK / 8);
    for (let x = 0; x < GENISLIK; x++) if (bitler[y * GENISLIK + x]) out[x >> 3] |= 1 << (x & 7);
    return out;
  }

  class Yazici {
    constructor() {
      this.cihaz = null; this.tx = null; this.durum = 0; this.tampon = []; this.boy = 0;
      this.parca = 180; this.ad = '';
    }
    get bagli() { return !!(this.cihaz && this.cihaz.gatt.connected && this.tx); }
    get durumMetni() {
      const d = this.durum, m = [];
      if (d & 1) m.push('kâğıt bitti'); if (d & 2) m.push('kapak açık');
      if (d & 4) m.push('aşırı ısındı'); if (d & 8) m.push('pil zayıf');
      return m.join(', ');
    }

    async sec() {
      this.cihaz = await navigator.bluetooth.requestDevice({
        filters: [{ services: [REKLAM_SRV] }, { services: [BASKI_SRV] }],
        optionalServices: [BASKI_SRV, REKLAM_SRV],
      });
      return this.bagla();
    }

    // Daha önce izin verilmiş cihazı seçim penceresi olmadan bul (Chrome destekliyorsa)
    async oncekiniBul() {
      if (!navigator.bluetooth.getDevices) return false;
      const liste = await navigator.bluetooth.getDevices();
      if (!liste.length) return false;
      this.cihaz = liste[0];
      try { await this.bagla(); return true; } catch { return false; }
    }

    async bagla() {
      this.ad = this.cihaz.name || 'yazıcı';
      const gatt = await this.cihaz.gatt.connect();
      const srv = await gatt.getPrimaryService(BASKI_SRV);
      this.tx = await srv.getCharacteristic(TX);
      try {
        const rx = await srv.getCharacteristic(RX);
        rx.addEventListener('characteristicvaluechanged', (e) => {
          const v = new Uint8Array(e.target.value.buffer);
          if (v.length > 6) this.durum = v[6];
        });
        await rx.startNotifications();
      } catch (e) { console.warn('bildirim yok', e); }
      return this.ad;
    }

    async yaz(veri) {
      const f = this.tx.writeValueWithoutResponse ? 'writeValueWithoutResponse' : 'writeValue';
      for (let i = 0; i < veri.length; i += this.parca) await this.tx[f](veri.slice(i, i + this.parca));
    }
    async gonder(p) {
      if (this.boy + p.length > this.parca) await this.bosalt();
      this.tampon.push(p); this.boy += p.length;
    }
    async bosalt() {
      let bekleme = 0;
      while ((this.durum & 0x10) && bekleme < 100) { await bekle(100); bekleme++; }
      if (!this.boy) return;
      const veri = new Uint8Array(this.boy); let o = 0;
      for (const p of this.tampon) { veri.set(p, o); o += p.length; }
      this.tampon = []; this.boy = 0;
      await this.yaz(veri);
      await bekle(20);
    }

    // bitler: Uint8Array(GENISLIK * yukseklik), 1 = siyah
    async bas(bitler, { hiz = 32, enerji = 24000, sonBesleme = 100, ilerleme } = {}) {
      if (!this.bagli) await this.bagla();
      const h = bitler.length / GENISLIK;
      await this.gonder(paket(0xa3, b1(0)));                                  // durum sor
      await this.gonder(new Uint8Array([0x51, 0x78, 0xbc, 0x00, 0x01, 0x02, 0x01, 0x2d, 0xff]));
      await this.gonder(paket(0xa4, b1(50)));                                 // 200 dpi
      await this.gonder(paket(0xbd, b1(hiz)));
      await this.gonder(paket(0xaf, b2(enerji)));
      await this.gonder(paket(0xbe, b1(1)));                                  // enerjiyi uygula
      await this.gonder(paket(0xa9, b1(0)));
      await this.gonder(paket(0xa6, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]));
      await this.bosalt();
      let bos = 0;
      for (let y = 0; y < h; y++) {
        const satir = satirBaytlari(bitler, y);
        if (satir.every(b => b === 0)) { bos++; continue; }
        if (bos) { await this.gonder(paket(0xbd, b1(8))); await this.gonder(paket(0xa1, b2(bos))); await this.gonder(paket(0xbd, b1(hiz))); bos = 0; }
        await this.gonder(paket(0xa2, satir));
        if (ilerleme && y % 16 === 0) ilerleme(y / h);
      }
      await this.bosalt();
      await this.gonder(paket(0xa6, [0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17]));
      await this.gonder(paket(0xbd, b1(8)));
      await this.gonder(paket(0xa1, b2(bos + sonBesleme)));
      await this.gonder(paket(0xa3, b1(0)));
      await this.bosalt();
      if (ilerleme) ilerleme(1);
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
      const ekle = (dx, dy, k) => { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < w && yy < h) e[yy * w + xx] += hata * k; };
      if (yontem === 'esik') continue;
      if (yontem === 'floyd') { ekle(1, 0, 7 / 16); ekle(-1, 1, 3 / 16); ekle(0, 1, 5 / 16); ekle(1, 1, 1 / 16); }
      else { const k = 1 / 8; ekle(1, 0, k); ekle(2, 0, k); ekle(-1, 1, k); ekle(0, 1, k); ekle(1, 1, k); ekle(0, 2, k); }
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

  return { Yazici, GENISLIK, griTon, titret, esikle, crc8, paket };
})();
if (typeof module === 'object') module.exports = YAZICI;
