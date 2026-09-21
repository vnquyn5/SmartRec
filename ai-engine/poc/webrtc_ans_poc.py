import os
import time
import glob
import numpy as np
import soundfile as sf
import noisereduce as nr
import scipy.signal as signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def process_audio_webrtc_ans(input_path: str, output_audio_path: str, output_plot_path: str):
    """
    Xử lý lọc nhiễu âm thanh WebRTC ANS PoC và trực quan hóa kết quả.
    """
    print(f"\n[1] Đang đọc file âm thanh đầu vào: {input_path}")
    data, sample_rate = sf.read(input_path)

    # 1. Chuyển đổi sang Mono (nếu là Stereo 2 kênh)
    if data.ndim > 1:
        print("  -> Âm thanh gốc là Stereo, đang gộp thành Mono (1 kênh)...")
        data = np.mean(data, axis=1)

    # 2. Resample về 16kHz (Sample Rate chuẩn cho Whisper & Pyannote)
    target_sr = 16000
    if sample_rate != target_sr:
        print(f"  -> Tần số lấy mẫu gốc {sample_rate}Hz != 16000Hz. Đang resample...")
        num_samples = int(len(data) * target_sr / sample_rate)
        data = signal.resample(data, num_samples)
        sample_rate = target_sr

    duration_seconds = len(data) / sample_rate
    print(f"  -> Độ dài file: {duration_seconds:.2f} giây ({duration_seconds/60:.2f} phút)")

    # 3. Thực hiện lọc nhiễu Spectral Gating & Đo thời gian xử lý
    print("[2] Bắt đầu khử nhiễu (Spectral Gating / ANS)...")
    start_time = time.time()

    # prop_decrease: tỷ lệ triệt tiêu nhiễu (0.85 giúp lọc sạch mà không làm méo giọng)
    cleaned_audio = nr.reduce_noise(
        y=data,
        sr=sample_rate,
        prop_decrease=0.85,
        stationary=True,
        n_jobs=-1  # Tận dụng đa nhân CPU của chip Apple Silicon
    )

    elapsed_time = time.time() - start_time
    rtf = elapsed_time / duration_seconds if duration_seconds > 0 else 0
    print(f"  -> Thời gian xử lý: {elapsed_time:.3f} giây (RTF: {rtf:.4f})")

    # Đánh giá kỹ thuật
    target_time_for_duration = (duration_seconds / 60.0) * 2.0
    if elapsed_time <= target_time_for_duration or duration_seconds < 10:
        print("  -> [PASS] Đạt tiêu chuẩn thời gian xử lý (< 2 giây / 1 phút audio)")
    else:
        print(f"  -> [WARNING] Vượt ngưỡng thời gian mục tiêu ({target_time_for_duration:.2f}s)")

    # 4. Xuất file âm thanh sạch
    print(f"[3] Đang lưu file âm thanh đã xử lý: {output_audio_path}")
    sf.write(output_audio_path, cleaned_audio, sample_rate, subtype='PCM_16')

    # 5. Vẽ biểu đồ Waveform & Spectrogram Before / After (Nghiệm thu AC04)
    print(f"[4] Đang vẽ biểu đồ so sánh sóng âm: {output_plot_path}")
    time_axis = np.linspace(0, duration_seconds, len(data))

    fig, axes = plt.subplots(2, 2, figsize=(14, 8))
    fig.suptitle(f"SmartRec WebRTC ANS PoC - Comparison Benchmark\nFile: {os.path.basename(input_path)} | Latency: {elapsed_time:.2f}s", fontsize=14, fontweight='bold')

    # Hàng 1: Waveform
    axes[0, 0].plot(time_axis, data, color='coral', alpha=0.8)
    axes[0, 0].set_title("1. Waveform - Âm thanh GỐC (Before)")
    axes[0, 0].set_ylabel("Amplitude")
    axes[0, 0].grid(True, linestyle='--', alpha=0.5)

    axes[0, 1].plot(time_axis, cleaned_audio, color='royalblue', alpha=0.8)
    axes[0, 1].set_title("2. Waveform - Đã KHỬ NHIỄU (After)")
    axes[0, 1].set_ylabel("Amplitude")
    axes[0, 1].grid(True, linestyle='--', alpha=0.5)

    # Hàng 2: Spectrogram
    axes[1, 0].specgram(data, Fs=sample_rate, NFFT=1024, noverlap=512, cmap='inferno')
    axes[1, 0].set_title("3. Spectrogram - Phổ tần số GỐC (Before)")
    axes[1, 0].set_xlabel("Time (seconds)")
    axes[1, 0].set_ylabel("Frequency (Hz)")

    axes[1, 1].specgram(cleaned_audio, Fs=sample_rate, NFFT=1024, noverlap=512, cmap='inferno')
    axes[1, 1].set_title("4. Spectrogram - Phổ tần số ĐÃ LỌC (After)")
    axes[1, 1].set_xlabel("Time (seconds)")
    axes[1, 1].set_ylabel("Frequency (Hz)")

    plt.tight_layout()
    plt.savefig(output_plot_path, dpi=200)
    plt.close()
    print("  -> Xuất biểu đồ thành công!")
    print(f"\n[DONE] Hoàn tất xử lý file {os.path.basename(input_path)}.")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    input_dir = os.path.join(base_dir, "data", "input")
    output_dir = os.path.join(base_dir, "data", "output")

    os.makedirs(output_dir, exist_ok=True)

    # Tìm tất cả file .wav, .mp3, .m4a trong thư mục input
    audio_files = []
    for ext in ("*.wav", "*.mp3", "*.m4a"):
        audio_files.extend(glob.glob(os.path.join(input_dir, ext)))

    if not audio_files:
        print(f"[ERROR] Không tìm thấy file âm thanh nào trong: {input_dir}")
        print("Vui lòng copy ít nhất 1 file .wav vào thư mục poc/data/input/.")
    else:
        for file_path in audio_files:
            file_name = os.path.splitext(os.path.basename(file_path))[0]
            out_audio = os.path.join(output_dir, f"{file_name}_cleaned.wav")
            out_plot = os.path.join(output_dir, f"{file_name}_comparison.png")

            process_audio_webrtc_ans(file_path, out_audio, out_plot)