# Rancang Bangun Finite State Machine Berbasis FPGA dalam Sistem Komunikasi UART untuk Deteksi Arus Bocor Menggunakan Web Monitoring

**Pranaja Ananta** — NIM 185221067
Program Studi S-1 Teknik Biomedis · Departemen Fisika
Fakultas Sains dan Teknologi · Universitas Airlangga · 2026

---

Sistem deteksi **arus bocor** (leakage current) end-to-end: sensor analog dibaca
ADC, diproses **FSM pada FPGA**, dikirim via **UART** ke Arduino Uno sebagai
jembatan, lalu dimonitor lewat **web dashboard** (Web Serial API). Web menghitung
status alarm: **ARUS BOCOR** bila melewati threshold, **ARUS NORMAL** bila di bawahnya.

## Arsitektur

```
Sensor analog → ADS1115 (ADC 16-bit, I²C) → FPGA Spartan-6 (FSM, I²C master, UART TX)
   → Arduino Uno (UART→USB, EEPROM kalibrasi) → Web (React, Web Serial API)
```

| Komponen | Peran |
|----------|-------|
| **ADS1115** | ADC 16-bit, PGA ±4.096 V (LSB = 0.125 mV), 4 channel single-ended |
| **FPGA Spartan-6** | Finite State Machine: baca ADS1115 via I²C, kirim frame UART |
| **Arduino Uno** | Jembatan UART→USB, filter channel terpilih, simpan kalibrasi ke EEPROM |
| **Web** | Dashboard monitoring, kalibrasi, alarm arus bocor |

## Isi Repository

```
.
├── nanta.ino        # Sketch Arduino Uno (jembatan FPGA↔Web + EEPROM)
├── web-react/       # Web monitoring (Vite + React + Tailwind + Chart.js)
└── Web/             # Versi web lama (vanilla HTML/CSS/JS) — arsip
```

## Web Dashboard (`web-react/`)

Stack: **Vite + React + Tailwind + Chart.js**. Tiga tab:

1. **Dashboard** — voltage (mV / V), ADC raw, grafik time-series, banner alarm
   (⚠ ARUS BOCOR / ✓ ARUS NORMAL). Kontrol grafik lengkap: pilih *window*
   (0.5 s – 5 min), pause/resume (tombol & `Space`), drag-pan saat paused,
   double-click reset pan, hover tooltip, export CSV.
2. **Calibration** — pilih channel + *sensitivity* (20–80%).
   `threshold = sensitivity% × (maxVal − minVal)`; minVal/maxVal auto-tracking
   (maxVal naik bila reading > maxVal, minVal turun bila reading < minVal);
   simpan/muat dari **EEPROM Arduino**.
3. **Info** — judul laporan, identitas, logo Universitas Airlangga.

**Logika alarm:** `BOCOR` jika `current − minVal > threshold`.

### Menjalankan

```bash
cd web-react
npm install
npm run dev      # http://localhost:5173
npm run build    # output ke dist/
```

> Web Serial API hanya didukung **Chrome / Edge** desktop.

## Arduino (`nanta.ino`)

Membaca frame 4-channel dari FPGA, mem-forward **hanya channel terpilih**,
menangani command kalibrasi, dan menyimpan min/max/sensitivity per channel
ke **EEPROM** (5 byte/channel, dengan magic-byte inisialisasi).

Library: `SoftwareSerial`, `EEPROM` (bawaan Arduino IDE). RX dari FPGA di pin 2.

## Protokol Serial (9600 8N1)

**FPGA → Arduino:** `+CH0,+CH1,+CH2,+CH3\r\n`

| Arah | Pesan | Arti |
|------|-------|------|
| Web → Arduino | `SEL:<ch>` | pilih channel yang di-stream (0–3) |
| Web → Arduino | `SAVE:<ch>,<min>,<max>,<sens>` | simpan kalibrasi ke EEPROM |
| Web → Arduino | `GET:<ch>` | minta kalibrasi tersimpan |
| Arduino → Web | `D,<ch>,<raw>` | data channel terpilih |
| Arduino → Web | `C,<ch>,<min>,<max>,<sens>` | balasan kalibrasi EEPROM |
| Arduino → Web | `OK,<msg>` | ack |

## Konversi

ADS1115 PGA ±4.096 V, 16-bit signed → `mV = raw × 0.125`.
