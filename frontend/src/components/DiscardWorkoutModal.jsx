import Modal from "./Modal.jsx";

export default function DiscardWorkoutModal({ open, onClose, onConfirm, busy, error }) {
  return (
    <Modal open={open} onClose={onClose} title="Descartar treino?" maxWidth="max-w-sm">
      <p className="text-sm text-soft">
        Descartar este treino? As séries preenchidas serão perdidas. Essa ação não
        pode ser desfeita.
      </p>
      {error && <div className="text-sm text-rose-500 mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 shadow-lg shadow-rose-500/30 transition"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Descartando…" : "Descartar"}
        </button>
      </div>
    </Modal>
  );
}
