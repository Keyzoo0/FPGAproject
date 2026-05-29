# Sistem Deteksi Arus Bocor — Web Monitoring

Web monitoring (Vite + React + Tailwind + Chart.js) untuk skripsi
*"Rancang Bangun Finite State Machine Berbasis FPGA dalam Sistem Komunikasi
UART untuk Deteksi Arus Bocor Menggunakan Web Monitoring"* — Pranaja Ananta (185221067).

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output ke dist/
npm run preview  # sajikan dist/ di http://localhost:4173
```

> Web Serial API hanya didukung Chrome / Edge (desktop).

### Penting: jangan buka `dist/index.html` lewat `file://`

Aplikasi **harus disajikan lewat server lokal** (`http://localhost`) atau HTTPS,
karena `navigator.serial` (Web Serial API) hanya tersedia di *secure context* —
membuka file `dist/index.html` langsung (double-click → `file://`) membuat tombol
Connect mati, plus modul JS diblokir CORS. Sajikan dengan salah satu cara:

```bash
npm run preview                                  # → http://localhost:4173
# atau
npx serve dist                                   # server statis
python3 -m http.server 8000 --directory dist     # → http://localhost:8000
```

## Alur

1. **Connect** — pilih channel (0–3) lalu Connect Serial Port.
2. **Tab Dashboard** — voltage mV / V / raw + grafik + banner alarm
   (⚠ ARUS BOCOR / ✓ ARUS NORMAL).
3. **Tab Calibration** — pilih channel + sensitivity (20–80%).
   `threshold = sensitivity% × (maxVal − minVal)`; min/max auto-tracking;
   **Simpan ke EEPROM** / **Muat dari EEPROM** Arduino.
4. **Tab Info** — judul, identitas, logo Universitas Airlangga.

Logika alarm: **BOCOR** jika `current − minVal > threshold`.

## Protokol Serial (9600 8N1)

FPGA → Arduino: `+CH0,+CH1,+CH2,+CH3\r\n`

| Arah | Pesan | Arti |
|------|-------|------|
| Web → Arduino | `SEL:<ch>` | pilih channel yang di-stream |
| Web → Arduino | `SAVE:<ch>,<min>,<max>,<sens>` | simpan kalibrasi ke EEPROM |
| Web → Arduino | `GET:<ch>` | minta kalibrasi tersimpan |
| Arduino → Web | `D,<ch>,<raw>` | data channel terpilih |
| Arduino → Web | `C,<ch>,<min>,<max>,<sens>` | balasan kalibrasi EEPROM |
| Arduino → Web | `OK,<msg>` | ack |

Sketch Arduino: `../nanta.ino`.

## Konversi

ADS1115 PGA ±4.096 V, 16-bit signed → `mV = raw × 0.125`.
