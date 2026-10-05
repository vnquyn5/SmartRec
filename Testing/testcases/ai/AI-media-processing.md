# AI - Media processing va FFmpeg

## B. FFmpeg wrapper

| ID | Uu tien | Dieu kien tien quyet | Buoc thuc hien | Ket qua mong doi |
|---|---|---|---|---|
| AI-FF-001 | P1 | FFmpeg cai dat va co trong PATH | Goi `get_ffmpeg_version()` | Tra dong dau output `ffmpeg -version` |
| AI-FF-002 | P1 | FFmpeg khong co trong PATH | Goi `get_ffmpeg_version()` | Loi subprocess duoc day len caller; khong tra version thanh cong gia |
| AI-FF-003 | P1 | Co file audio/video hop le, FFmpeg san sang | Goi `extract_audio(input, output, sample_rate=16000)` | Tao thu muc output neu chua co; tao audio mono 16 kHz; ham tra output path |
| AI-FF-004 | P1 | Input khong ton tai/khong giai ma duoc | Goi `extract_audio` voi input khong hop le | FFmpeg process that bai; loi duoc day len caller; output khong duoc coi la ket qua thanh cong |
| AI-FF-005 | P2 | Co media hop le | Goi `extract_audio` voi sample rate tuy chon | Output co sample rate da chon; neu khong truyen thi mac dinh 16000 Hz |
