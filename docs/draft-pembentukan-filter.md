# Draft: Cara membentuk filter dari referensi

Status: draft diskusi, 10 November 2026. Belum ada kode yang berubah.

## Ringkasan

Referensi menunjukkan tampilan yang dituju, tetapi tidak memberi resepnya. Membentuk filter berarti menerjemahkan tampilan itu menjadi urutan operasi gambar yang tetap bagus di foto lain.

Usulan utama draft ini:

- Baca setiap referensi dulu, lalu putuskan apakah ia cukup jadi preset, butuh blok atau filter baru, atau sebenarnya gabungan beberapa filter (bagian 5).
- Rakit filter dari blok yang dipakai bersama. Blok ini sudah ada di dalam tiga filter kita, tetapi belum berdiri sendiri (bagian 4).
- Nilai hasilnya dengan membandingkan langsung ke referensi, lalu uji di foto yang tidak ada di referensi (bagian 5).
- Samakan Rim Light dengan produk referensinya sebelum menambah efek baru. Spread 360° sudah ditambahkan. Kekurangan yang tersisa ada dua: latar berwarna atau transparan, dan warna Bloom terpisah (bagian 3).

Keputusan yang saya perlukan ada di bagian 9.

## 1. Arti "referensi" di draft ini

Saya membaca "referensi" sebagai dua hal yang saling terkait:

- **Produk referensi:** [Rim Light di Filter Archive](https://sesohq.com/pages/rim-light-effect) dari Sesohq, titik awal PDF rencana. Ini menentukan standar fitur dan kualitas.
- **Gambar referensi:** foto contoh yang tampilannya ingin dicapai. Ini menentukan warna dan nilai yang dituju.

Kalau maksudmu berbeda, koreksi ini dulu karena bagian lain bergantung padanya.

Batas yang saya usulkan: kita mempelajari teknik dan tampilannya, tetapi tidak menyalin gambar contoh, teks, atau nilai preset mereka. Nama preset kita juga sebaiknya dibedakan sebelum rilis, karena Golden Hour, Cold Moon, dan Studio Strip cukup dekat dengan Golden, Moonlight, dan Studio milik mereka.

## 2. Bagaimana filter tersusun

Halaman produknya menggambarkan Rim Light sebagai pencahayaan tepi "the way designers do it by hand in Photoshop, in one filter". Itu definisi kerja yang bagus: **filter adalah resep retouch manual yang dibuat bisa diulang dan diatur.** Tutorial retouch manual karena itu juga sumber resep yang baik.

Susunannya punya empat tingkat:

| Tingkat | Artinya | Contoh | Bentuknya sekarang |
|---|---|---|---|
| Blok | Satu operasi gambar | Blur mask, pita tepi, Screen | Potongan GLSL di dalam tiap efek, belum berdiri sendiri |
| Filter | Urutan blok dan slider yang diperlihatkan | Rim Light | Satu berkas di `plugin/ui/js/effects/` |
| Preset | Satu set nilai slider untuk satu filter | Neon Edge | JSON di `plugin/presets/` |
| Stack | Beberapa filter berurutan, hasil yang satu jadi masukan berikutnya | Rim Light lalu Duotone | Daftar Layers dan Save stack |

Di dalam satu filter selalu ada lima bagian:

1. **Bahan:** apa yang dibaca dari foto, yaitu warna, terang-gelap, dan mask subjek.
2. **Bentuk:** di mana efek muncul, misalnya pita tepi, area terang, atau seluruh gambar.
3. **Warna dan kekuatan:** apa yang ditambahkan dan sebanyak apa.
4. **Penggabungan:** cara efek duduk di atas foto, yaitu blend mode dan area yang kena.
5. **Slider:** bagian resep yang boleh diubah pengguna.

Contohnya Rim Light kita:

| Bagian yang terlihat | Cara dibentuk | Slider |
|---|---|---|
| Garis kontak tajam | Mask dikali kebalikan mask yang sedikit di-blur, hasilnya pita tipis di sisi dalam tepi | Contact, Contact Width |
| Rim lembut | Rumus yang sama dengan blur lebih besar, lalu dipecah oleh terang-gelap foto agar mengikuti rambut dan kain | Rim, Rim Width, Detail |
| Arah cahaya | Gradien mask yang di-blur memberi arah "keluar" tiap titik tepi, lalu dibandingkan dengan arah ke lampu | Position X, Position Y, Spread |
| Warna cahaya | Tiap lampu menyumbang warna kali intensitas, lalu dijumlahkan | Color, Intensity |
| Bloom | Semua pita berwarna di-blur menjadi satu | Amount, Radius |
| Glow belakang | Mask dengan blur besar, hanya di luar subjek dan di sisi yang menghadap lampu | Amount, Radius |
| Penggabungan | Foto digelapkan satu kali, lalu cahaya ditumpuk dengan Screen atau Linear Dodge | Blend, Background, Subject |

## 3. Rim Light kita dibanding produk referensi

Bagian yang terlihat sama dengan deskripsi mereka: garis kontak, rim yang dipecah rambut dan kain, bloom, dan glow di belakang subjek. Rumus di dalam produk mereka tidak kita ketahui.

| Hal | Referensi | Kita | Keadaan |
|---|---|---|---|
| Susunan cahaya | Kontak, rim, bloom, glow | Sama | Setara |
| Jumlah lampu | Satu, dengan opsi lampu kedua di sisi berlawanan | Sampai 6, posisi bebas, masing-masing di belakang atau di depan subjek | Kita lebih |
| Spread | Pada 360° melingkari seluruh subjek menjadi halo | 0 sampai 360°, dan pada 360° menjadi halo yang rata | Setara |
| Background | Foto tetap, warna polos di belakang subjek, atau transparan | Foto tetap dengan slider gelap-terang, dan di nilai 0 latar menjadi hitam | Kurang warna lain dan transparan |
| Warna | Color, Color, Bloom Color, Background Color | Bloom mengikuti warna lampu, tidak ada warna latar | Kurang |
| Pengaturan per lampu | Tidak disebutkan di halaman | Edge, Bloom, Back Glow, dan Shadow bisa disalin ke satu lampu; Scene selalu bersama | Kita lebih, sejauh yang diketahui |
| Jumlah pengaturan | 32 | 22 untuk satu lampu, belum termasuk salinan per lampu | 29 pengaturan mereka tidak disebutkan di halaman |
| Preset | 8 | 7 | Kurang |
| Hasil | Layer baru di atas foto asli | Sama | Setara |
| Stack tersimpan | Ada | Ada | Setara |

Satu koreksi untuk PDF: PDF menyebut Filter Archive memakai Smart Filter dan hasilnya bisa diatur lagi. Halaman Rim Light tidak menyebut Smart Filter. Yang tertulis hanya hasilnya masuk ke layer baru dan semua pengaturan bisa diubah setelah memilih preset. Jadi hasil Apply kita yang berupa satu layer piksel belum tentu kalah. Ini baru bisa dipastikan dengan melihat produknya langsung.

## 4. Daftar blok

Sudah ada, tetapi masih tersimpan di dalam tiap filter:

| Blok | Fungsi | Dipakai di |
|---|---|---|
| Blur | Melembutkan gambar atau mask | Semua |
| Pita tepi dalam | Daerah sempit di sisi dalam garis subjek | Rim Light |
| Arah tepi dan gerbang lampu | Memilih tepi yang menghadap lampu | Rim Light |
| Modulasi detail | Memecah efek mengikuti tekstur foto | Rim Light |
| Kunci terang | Mengambil hanya area terang | Soft Glow |
| Gradient map | Memetakan terang-gelap ke dua warna | Duotone |
| Pengali area | Membedakan subjek dan latar | Semua |
| Screen dan Linear Dodge | Menumpuk cahaya di atas foto | Rim Light, Soft Glow |

Belum ada. Biaya di bawah ini perkiraan saya:

| Blok | Tampilan yang dibuka | Jenis menurut PDF | Biaya |
|---|---|---|---|
| Kurva tone | Semua perubahan kontras | Per piksel | Kecil |
| Grading bayangan, tengah, terang atau LUT | Tampilan film dan color grade | Per piksel | Kecil sampai sedang |
| Grain | Film, cetak | Rendering | Kecil |
| Vignette | Fokus ke subjek | Rendering | Kecil |
| Halation | Pendaran merah di tepi terang ala film | Konvolusi | Kecil |
| Sharpen dan clarity | Ketajaman dan tekstur | Konvolusi | Kecil |
| Displacement | RGB split, glitch, gelombang | Distorsi | Sedang |
| Generator noise dan tekstur | Light leak, kabut | Rendering | Sedang |
| Relighting 3D | Cahaya yang jatuh di dalam wajah | AI | Di luar arsitektur ini |

## 5. Alur dari referensi ke filter

**Langkah 1: kumpulkan referensi.** Nilainya berbeda menurut jenisnya:

| Yang tersedia | Yang bisa diketahui | Kekuatan |
|---|---|---|
| Sebelum dan sesudah dari foto yang sama | Perubahan tiap piksel, sehingga kurva warna dan bentuk cahaya bisa diukur | Paling kuat |
| Hanya foto sesudah | Palet, kontras, dan lebar cahaya, tetapi tidak jelas mana efek dan mana warna asli foto | Sedang |
| Video atau demo slider | Slider apa saja yang ada dan pengaruhnya | Pelengkap |

**Langkah 2: baca tampilannya.**

- Terang-gelap: apakah hitam terangkat, terang diredam, kontras naik?
- Warna: apa warna bayangan dan warna terang, saturasinya naik atau turun?
- Cahaya: dari mana datangnya, apa warnanya, selebar apa dibanding sisi pendek foto, apakah mengikuti rambut, apakah tumpah ke latar?
- Kehalusan: adakah glow di area terang, seberapa tajam, adakah grain?
- Area: apakah subjek dan latar diperlakukan berbeda?
- Urutan: apakah glow ikut terwarnai grading, apakah grain ada di atas semuanya?

**Langkah 3: tentukan tingkatnya.**

| Jika tampilan bisa dicapai dengan | Hasilnya |
|---|---|
| Menggeser slider yang sudah ada | Preset baru |
| Beberapa filter yang masing-masing masuk akal sendiri | Stack |
| Operasi baru yang menyatu dengan satu efek | Blok baru di filter itu, atau filter baru |

Satu referensi biasanya setara dengan stack, bukan satu filter.

**Langkah 4: rakit.** Tentukan urutan blok, lalu pilih yang menjadi slider. Hal yang berbeda per foto atau per selera menjadi slider, misalnya posisi lampu dan lebar rim. Hal yang menjaga tampilan tetap menyatu menjadi konstanta, misalnya kelembutan batas tepi dan kompensasi energi bloom. Ukuran tetap memakai 1/1000 sisi pendek supaya preview cocok dengan hasil penuh.

**Langkah 5: kalibrasi.** Bandingkan berdampingan dengan referensi. Ukur warna rata-rata di bayangan, tengah, dan terang, serta di subjek dan latar. Angka hanya alat bantu, keputusan akhir tetap di mata. Mode browser sekarang hanya memakai potret buatan, jadi langkah ini butuh pemuatan foto asli dan mask PNG.

**Langkah 6: uji di foto lain.** Filter yang hanya bagus di foto referensi baru merupakan preset untuk satu foto. Usul set uji sekitar 10 foto: kulit terang dan gelap, rambut halus, cahaya dari belakang, latar ramai, foto gelap, beberapa orang, foto tanpa subjek jelas, resolusi kecil dan besar.

## 6. Contoh penerapan

Contoh ini rekaan untuk menunjukkan alurnya. Misalkan referensinya potret malam dengan tepi biru di sisi kanan, latar gelap, bayangan agak hijau, dan sedikit grain.

| Yang terbaca | Tingkat | Keadaan |
|---|---|---|
| Tepi biru di kanan, latar gelap | Preset Rim Light | Sudah bisa |
| Bayangan agak hijau | Blok grading | Belum ada |
| Grain | Blok grain | Belum ada |

Hasilnya stack tiga filter, dan urutannya mengubah hasil. Kalau grading diletakkan setelah Rim Light, tepi birunya ikut berubah warna. Kalau cahayanya harus tetap biru murni, grading diletakkan sebelumnya. Grain selalu terakhir supaya butirannya tidak ikut ter-blur oleh filter sesudahnya. Saat ini urutan layer belum bisa diubah di panel, jadi referensi seperti ini akan membutuhkan fitur itu.

## 7. Batas yang perlu diterima

- **Filter hanya tahu garis luar subjek.** Mask tidak memberi bentuk 3D. Lampu depan memakai permukaan tiruan yang menggembung dari mask, jadi tubuh terlihat membulat, tetapi hidung dan pipi tetap tidak punya bentuk. Referensi dengan bayangan wajah yang detail tidak tercapai dengan blok ini.
- **Hanya lampu depan yang membuat bayangan.** Bayangan dari lampu belakang jatuh ke arah kamera, ke lantai di depan subjek, dan itu butuh bidang lantai yang belum ada di model ini.
- **Satu foto sesudah tidak bisa dibongkar sepenuhnya.** Latar gelap bisa berasal dari filter, bisa juga dari foto aslinya.
- **Pencocokan otomatis hanya andal untuk warna dan tone.** Cahaya tepi bergantung pada bentuk subjek, jadi tidak bisa dipindahkan seperti palet.
- **Kualitas tepi bergantung pada mask.** Tepi rambut yang gagal terdeteksi akan terlihat jelas pada Rim Light.
- **Masih RGB 8-bit.**
- **Engine belum pernah berjalan di Photoshop.** Semua blok di draft ini mengandaikan WebGL2 bekerja di panel. Kalau ternyata tidak, blok harus dibangun ulang memakai layer dan blend mode Photoshop, dan sebagian isi draft ini berubah.

## 8. Arah yang saya usulkan

**Tiga cara memakai referensi:**

| Cara | Prosesnya | Batasnya |
|---|---|---|
| A. Racik tangan | Kita membaca referensi, menyusun blok, mengatur slider | Makan waktu per preset, tetapi cocok untuk semua jenis tampilan |
| B. Alat pencocokan internal | Dari pasangan sebelum dan sesudah, program mencari nilai slider yang paling dekat | Hanya menyetel angka, susunan bloknya tetap harus dirancang |
| C. Fitur Match Look untuk pengguna | Pengguna memasukkan gambar, plugin meniru warnanya | Hanya warna dan tone |

Rekomendasi saya: pakai A sekarang, tambah B setelah ada beberapa filter dan blok, dan anggap C fitur tambahan nanti. B masuk akal karena preview berjalan 60 fps di GTX 1660 Ti, sehingga ribuan percobaan per menit terlihat realistis. Angka ini perkiraan dan belum diukur untuk kasus ini. Pasangan fotonya sebaiknya buatan sendiri, bukan gambar demo produk referensi, supaya presetnya benar-benar milik kita.

**Filter sebagai kode atau sebagai data:** untuk sekarang, keluarkan blok menjadi kode bersama tetapi biarkan tiap filter tetap ditulis sebagai kode. Resep JSON penuh akan memaksa satu proses GPU per blok, padahal Rim Light kini menghitung pita dan arah dalam satu proses. Di 24 MP itu berarti lebih banyak memori dan waktu. Resep JSON layak dipertimbangkan setelah ada sekitar 10 filter dan polanya stabil.

**Urutan kerja usulan:**

1. Selesaikan load test di Photoshop, karena hasilnya bisa mengubah dasar teknisnya.
2. Tambah pemuatan foto asli, mask PNG, dan tampilan banding di mode browser.
3. Tutup dua kekurangan Rim Light yang tersisa: latar berwarna atau transparan, dan warna Bloom.
4. Keluarkan blok bersama dari tiga filter tanpa mengubah hasilnya.
5. Tambah kurva dan grading, lalu grain, dan urutan layer yang bisa diubah.
6. Racik preset dari referensi dan uji di set foto.

## 9. Pertanyaan untuk kamu

1. **Referensi yang kamu maksud apa:** Filter Archive, gambar contoh pilihanmu, atau keduanya? Anggapan saya keduanya.
2. **Siapa yang memakai referensi:** kita saat merancang filter, atau pengguna di dalam plugin? Usul saya kita dulu.
3. **Apakah kamu punya pasangan foto sebelum dan sesudah,** atau bisa membuatnya manual di Photoshop? Usul saya 3 sampai 5 pasang untuk mulai.
4. **Rim Light disempurnakan dulu atau langsung tambah efek?** Usul saya Rim Light dulu, sejalan dengan saran PDF untuk memvalidasi efek pertama.
5. **Seberapa mirip yang dianggap cukup:** sama persis di foto referensi, atau rasa yang sama di banyak foto? Usul saya rasa yang sama di banyak foto.
