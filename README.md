# Selamat Datang di Project abal2 Komunitas Malas Ngedit 😹
## Author : Lumi

> Malas baca bang? langsung ke release aja [Releases](https://github.com/luminexrecon/malasngedit/releases)

Plugin Photoshop (UXP) berisi efek foto yang memanfaatkan deteksi subjek: **Rim Light**, **Soft Glow**, dan **Duotone**. Efek bisa ditumpuk sebagai stack, diatur lewat slider dengan preview langsung, lalu diterapkan ke layer baru tanpa mengubah foto asli.

> **Status: beta awal (ver01.2026).** Plugin ini baru diuji di browser dengan Photoshop tiruan dan belum pernah dijalankan di Photoshop sungguhan. Anggap semua fitur di bawah ini belum terverifikasi di Photoshop.

## Fitur

**Rim Light**
- Sampai 6 lampu. Tiap lampu punya warna, intensitas, dan posisi sendiri, dan bisa digeser langsung di preview.
- Tiap lampu bisa diletakkan **di belakang subjek** (cahaya tepi) atau **di depan subjek** (menerangi permukaan subjek).
- Spread 0–360°. Pada 360° cahaya melingkari subjek menjadi halo.
- Bayangan opsional dari lampu depan, jatuh berlawanan arah dari lampunya.
- Edge, Bloom, Back Glow, dan Shadow memakai pengaturan bersama, tetapi bisa diberi pengaturan sendiri per lampu. Scene selalu bersama.

**Soft Glow** dan **Duotone**: bisa diterapkan ke seluruh gambar, subjek saja, atau latar saja.

**Umum**
- Stack filter berurutan: hasil satu filter menjadi masukan filter berikutnya.
- Preset bawaan, preset buatan sendiri, dan stack yang bisa disimpan.
- Hasil diterapkan sebagai layer baru di atas foto asli.

## Kebutuhan

- Photoshop 2025 (v26.0) atau lebih baru, dengan aplikasi Creative Cloud.
- Dokumen RGB 8-bit.
- GPU yang mendukung WebGL2.

## Memasang

1. Unduh `malasngedit-verXX.YYYY.zip` dari halaman [Releases](https://github.com/luminexrecon/malasngedit/releases), lalu ekstrak.
2. Klik dua kali file `.ccx` di dalamnya. Aplikasi Creative Cloud akan memasangnya setelah kamu menyetujui peringatan bahwa plugin ini bukan dari Marketplace.
3. Buka Photoshop, lalu pilih menu **Plugins → malasngedit**.

Kalau pemasangan `.ccx` gagal, folder `plugin/` di dalam zip bisa dimuat lewat UXP Developer Tool (lihat [Memuat di Photoshop](#memuat-di-photoshop)).

Laporkan masalah di [Issues](https://github.com/luminexrecon/malasngedit/issues). Sertakan versi plugin, versi Photoshop, dan ukuran serta mode warna dokumen.

## Batasan yang diketahui

- Hanya untuk dokumen RGB 8-bit.
- Hasil Apply berupa satu layer piksel dan tidak bisa diedit ulang.
- Urutan filter di stack belum bisa diubah.
- Hanya lampu di depan subjek yang membuat bayangan.
- Lampu depan menerangi bentuk yang diperkirakan dari garis luar subjek, jadi detail seperti hidung dan pipi tidak punya bentuk sendiri.
- Kecepatan di GPU kelas bawah dan pada foto 24 MP ke atas belum diukur.

## Pengembangan

Repo ini berisi versi pengembangan. Versi rilis dibuat dari sini dengan `npm run release` dan tidak pernah diedit langsung.

```
plugin/        kode plugin: manifest, host.js (sisi Photoshop), ui/ (panel), presets/
tools/         server browser, Photoshop tiruan, skrip rilis, runner uji browser
tests/         uji protokol (Node) dan uji browser (tests/ui)
docs/          catatan rancangan
release.json   nama, ID, dan label versi rilis
```

Butuh Node.js 20.15 atau lebih baru. Tidak ada dependensi npm.

### Cara kerja singkat

Panel Photoshop memuat UI di dalam WebView. `host.js` berbicara dengan Photoshop: mengambil piksel dokumen, menjalankan Select Subject untuk mask, dan menulis hasil ke layer baru. UI merender efek dengan WebGL2. Preview memakai salinan berukuran 1200 px, dan Apply merender ulang di resolusi penuh. Ukuran efek dihitung relatif terhadap sisi pendek gambar, jadi preview dan hasil akhir cocok.

### Mencoba di browser

```
npm run dev
```

Buka http://127.0.0.1:5177/. Photoshop diganti versi tiruan yang memakai potret buatan, jadi UI dan efek bisa dicoba tanpa Photoshop.

### Memuat di Photoshop

1. Aktifkan Developer Mode di Photoshop (Settings → Plugins).
2. Buka UXP Developer Tool, pilih **Add Plugin**, lalu pilih `plugin/manifest.json`.
3. Pilih **Load**.

Versi dev bernama **malasngedit (dev)** dengan ID `com.malasngedit.dev`, sehingga bisa terpasang berdampingan dengan versi rilis (`com.malasngedit`).

### Uji

```
npm test                       uji protokol
npm run test:ui                semua uji browser
npm run test:ui -- own shadow  hanya uji tertentu
npm run test:ui -- perf        kecepatan dengan enam lampu
npm run test:ui -- --record    rekam ulang tests/ui/reference.json
```

Uji browser butuh [playwright-cli](https://github.com/microsoft/playwright-cli) (`npm install -g @playwright/cli`). Uji ini membandingkan preset dengan gambar acuan di `tests/ui/reference.json`. Rekam ulang hanya setelah perubahan yang memang dimaksudkan mengubah gambar.

### Membuat rilis

1. Ubah `release` di `release.json`, misalnya menjadi `ver02.2026`. Formatnya `verXX.YYYY`, dan nomornya dimulai dari 01.
2. Jalankan `npm run release`. Hasilnya ada di folder `../release`, di luar repo ini:
   - `plugin/`: salinan bersih plugin
   - `malasngedit-verXX.YYYY.ccx`: paket untuk diklik dua kali
   - `malasngedit-verXX.YYYY.zip`: `.ccx`, folder `plugin/`, dan petunjuk pemasangan, siap diunggah ke Releases
3. Unggah zip ke halaman Releases.

Manifest Photoshop hanya menerima versi berupa angka `x.y.z`, jadi label `verXX.YYYY` otomatis diubah menjadi `YY.XX.0`. Contohnya `ver01.2026` menjadi `26.1.0`, dan `ver01.2027` menjadi `27.1.0`, sehingga rilis yang lebih baru selalu bernomor lebih tinggi.

Dibanding versi dev, versi rilis memakai ID `com.malasngedit`, nama `malasngedit`, nomor versi dari label, dan inspector debug dimatikan.
