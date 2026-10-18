// Anı: bağlantı/kimlik, şifreleme, fiş düzeni, yükleme kuyruğu.
// Fotoğraf AES-GCM ile telefonda şifrelenir; anahtar yalnız QR'daki #parçada durur, sunucuya hiç gitmez.
'use strict';

const ANI = (() => {
  const SURUM = '0.1.0';
  const SITE = 'https://cem1010.github.io/ani/';
  const DEPO = 'cem1010/ani';
  const W = typeof YAZICI === 'object' ? YAZICI.GENISLIK : 384;

  const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64uCoz = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const rastgele = (n) => crypto.getRandomValues(new Uint8Array(n));

  function yeniKimlik() { return { id: b64u(rastgele(9)), anahtar: b64u(rastgele(16)) }; }
  const baglanti = (k) => `${SITE}#${k.id}.${k.anahtar}`;
  function baglantiCoz(hash) {
    const m = (hash || '').match(/^#?([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{22})$/);
    return m ? { id: m[1], anahtar: m[2] } : null;
  }

  // ---- şifreleme: blob = iv(12) + AES-GCM( [u32 meta uzunluğu][meta json][jpeg] )
  async function anahtarAl(b64) {
    return crypto.subtle.importKey('raw', b64uCoz(b64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function sifrele(anahtar, jpegBlob, meta) {
    const m = new TextEncoder().encode(JSON.stringify(meta));
    const j = new Uint8Array(await jpegBlob.arrayBuffer());
    const duz = new Uint8Array(4 + m.length + j.length);
    new DataView(duz.buffer).setUint32(0, m.length); duz.set(m, 4); duz.set(j, 4 + m.length);
    const iv = rastgele(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await anahtarAl(anahtar), duz));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  }
  async function coz(anahtar, veri) {
    const u = new Uint8Array(veri);
    const duz = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await anahtarAl(anahtar), u.slice(12)));
    const n = new DataView(duz.buffer).getUint32(0);
    const meta = JSON.parse(new TextDecoder().decode(duz.slice(4, 4 + n)));
    return { meta, jpeg: new Blob([duz.slice(4 + n)], { type: 'image/jpeg' }) };
  }

  async function renkliJpeg(src, kesit, uzun = 1600) {
    const { sx, sy, sw, sh } = kesit;
    const s = Math.min(1, uzun / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  }

  // ---- fiş düzeni (1 bit dizileri)
  function tuval(h) {
    const c = document.createElement('canvas'); c.width = W; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, h); x.fillStyle = '#000'; x.textBaseline = 'top';
    return [c, x];
  }
  function qrCiz(x, metin, ox, oy, boy) {
    const q = qrcode(0, 'M'); q.addData(metin); q.make();
    const n = q.getModuleCount(), hucre = Math.max(2, Math.floor(boy / n)), gercek = n * hucre;
    const dx = ox + Math.floor((boy - gercek) / 2), dy = oy + Math.floor((boy - gercek) / 2);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (q.isDark(r, c)) x.fillRect(dx + c * hucre, dy + r * hucre, hucre, hucre);
    return gercek;
  }
  function sar(x, metin, genislik) {
    const kel = metin.split(/\s+/), satir = []; let s = '';
    for (const k of kel) { const d = s ? s + ' ' + k : k; if (x.measureText(d).width > genislik && s) { satir.push(s); s = k; } else s = d; }
    if (s) satir.push(s); return satir;
  }
  const tarihMetni = (d = new Date()) => d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });

  function altBilgi(url, ayar) {
    const H = 184, [c, x] = tuval(H);
    const qb = 168; qrCiz(x, url, 0, 8, qb);
    const tx = qb + 12, tw = W - tx - 4; let y = 22;
    x.font = 'bold 24px system-ui,Roboto,sans-serif';
    for (const s of sar(x, ayar.yazi1 || '', tw)) { x.fillText(s, tx, y); y += 28; }
    x.font = '20px system-ui,Roboto,sans-serif'; y += 4;
    for (const s of sar(x, ayar.yazi2 || '', tw)) { x.fillText(s, tx, y); y += 24; }
    y = Math.max(y + 8, 120);
    x.font = '18px system-ui,Roboto,sans-serif';
    x.fillText(tarihMetni(), tx, y);
    if (ayar.ig) x.fillText('Foto: @' + ayar.ig, tx, y + 24);
    return [YAZICI.esikle(x.getImageData(0, 0, W, H)), H];
  }

  // parçaları alt alta ekle: [bitler, yükseklik] | null
  function birlestir(...parcalar) {
    const p = parcalar.filter(Boolean), bosluk = 10;
    const h = p.reduce((t, [, ph]) => t + ph, 0) + bosluk * (p.length - 1);
    const out = new Uint8Array(W * h); let y = 0;
    for (const [b, ph] of p) { out.set(b, y * W); y += ph + bosluk; }
    return out;
  }

  function onizle(canvas, bit) {
    const h = bit.length / W; canvas.width = W; canvas.height = h;
    const x = canvas.getContext('2d'), img = x.createImageData(W, h);
    for (let i = 0; i < bit.length; i++) { const v = bit[i] ? 20 : 255; img.data.set([v, v, v, 255], i * 4); }
    x.putImageData(img, 0, 0);
  }

  function testFisi(ayar) {
    const H = 170, [c, x] = tuval(H);
    x.font = 'bold 40px system-ui,Roboto,sans-serif'; x.fillText('ANI BASKI', 8, 8);
    x.font = '24px system-ui,Roboto,sans-serif'; x.fillText('Test baskısı çalışıyor ✓', 8, 58);
    x.font = '20px system-ui,Roboto,sans-serif';
    x.fillText(new Date().toLocaleString('tr-TR'), 8, 94);
    x.fillText('çğıöşü ÇĞİÖŞÜ  0123456789', 8, 124);
    const ust = [YAZICI.esikle(x.getImageData(0, 0, W, H)), H];
    // ton şeridi: titretmenin nasıl çıktığını görmek için
    const SH = 40, g = new Float32Array(W * SH);
    for (let y = 0; y < SH; y++) for (let i = 0; i < W; i++) g[y * W + i] = 255 * i / (W - 1);
    const serit = [YAZICI.titret(g, W, SH, 'atkinson'), SH];
    return birlestir(ust, serit, altBilgi(SITE, ayar));
  }

  // ---- yükleme kuyruğu (IndexedDB)
  function db() {
    return db.p || (db.p = new Promise((ok, hata) => {
      const r = indexedDB.open('ani', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kuyruk', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result); r.onerror = () => hata(r.error);
    }));
  }
  async function islem(mod, f) {
    const d = await db();
    return new Promise((ok, hata) => {
      const t = d.transaction('kuyruk', mod), s = t.objectStore('kuyruk'); let sonuc;
      Promise.resolve(f(s)).then(v => { sonuc = v; });
      t.oncomplete = () => ok(sonuc); t.onerror = () => hata(t.error);
    });
  }
  const istek = (r) => new Promise((ok, hata) => { r.onsuccess = () => ok(r.result); r.onerror = () => hata(r.error); });

  async function kuyrugaEkle(kimlik, jpeg) {
    const veri = await sifrele(kimlik.anahtar, jpeg, { t: new Date().toISOString(), v: 1 });
    await islem('readwrite', s => s.put({ id: kimlik.id, link: baglanti(kimlik), veri, t: Date.now(), yuklendi: false }));
  }
  const kuyrukListe = () => islem('readonly', s => istek(s.getAll()));

  async function ucNokta(tazele) {
    let u = !tazele && localStorage.getItem('ucNokta');
    if (u) return u;
    for (const adres of [`https://api.github.com/repos/${DEPO}/contents/endpoint.json?t=${Date.now()}`,
                         `https://raw.githubusercontent.com/${DEPO}/main/endpoint.json?t=${Date.now()}`]) {
      try {
        const r = await fetch(adres, { headers: adres.includes('api.github') ? { Accept: 'application/vnd.github.raw' } : {}, cache: 'no-store' });
        if (r.ok) { u = (await r.json()).url; if (u) { localStorage.setItem('ucNokta', u); return u; } }
      } catch { /* sıradakini dene */ }
    }
    return null;
  }

  async function yukle(kayit, tazele) {
    const anahtar = localStorage.getItem('yukleAnahtar');
    const u = await ucNokta(tazele);
    if (!anahtar || !u) return false;
    try {
      const r = await fetch(`${u}/yukle?id=${kayit.id}`, {
        method: 'POST', body: kayit.veri, headers: { 'X-Anahtar': anahtar, 'Content-Type': 'application/octet-stream' },
      });
      return r.ok;
    } catch { return false; }
  }

  let calisiyor = false;
  async function kuyruguIsle(bildir) {
    if (calisiyor || !navigator.onLine) return; calisiyor = true;
    try {
      for (const k of await kuyrukListe()) {
        if (k.yuklendi) continue;
        if (await yukle(k, false) || await yukle(k, true)) {
          await islem('readwrite', s => s.put({ ...k, veri: null, yuklendi: Date.now() }));
          bildir && bildir();
        } else break;
      }
      // yalnız son 50 kaydı tut
      const l = (await kuyrukListe()).filter(k => k.yuklendi).sort((a, b) => a.t - b.t);
      for (const k of l.slice(0, Math.max(0, l.length - 50))) await islem('readwrite', s => s.delete(k.id));
    } finally { calisiyor = false; }
  }

  return { SURUM, SITE, DEPO, yeniKimlik, baglanti, baglantiCoz, sifrele, coz, renkliJpeg, altBilgi, birlestir,
           onizle, testFisi, kuyrugaEkle, kuyrukListe, kuyruguIsle, tarihMetni, b64u, b64uCoz };
})();
