import { UNAIR_LOGO } from '../assets/logo.js';

export default function InfoTab() {
  return (
    <div className="card mx-auto max-w-2xl text-center">
      <img
        src={UNAIR_LOGO}
        alt="Logo Universitas Airlangga"
        className="mx-auto mb-6 h-28 w-28 object-contain"
      />

      <h1 className="text-lg font-semibold leading-snug md:text-xl">
        Rancang Bangun Finite State Machine Berbasis FPGA dalam Sistem Komunikasi
        UART untuk Deteksi Arus Bocor Menggunakan Web Monitoring
      </h1>

      <div className="my-6 h-px bg-border" />

      <div className="space-y-1 text-sm">
        <p className="text-lg font-semibold text-text">PRANAJA ANANTA</p>
        <p className="text-muted">NIM 185221067</p>
      </div>

      <div className="mt-6 space-y-0.5 text-sm leading-relaxed text-muted">
        <p>Program Studi S-1 Teknik Biomedis</p>
        <p>Departemen Fisika</p>
        <p>Fakultas Sains dan Teknologi</p>
        <p>Universitas Airlangga</p>
        <p className="mt-2 font-semibold text-text">2026</p>
      </div>
    </div>
  );
}
