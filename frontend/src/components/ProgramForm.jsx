import { useState } from "react";

export default function ProgramForm({ initial, onSubmit, onCancel, submitting, error }) {
  const [name, setName] = useState(initial?.name || "");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome do programa</label>
        <input
          className="input"
          placeholder="ex.: Treino p secar, Jiujitsu, Mobilidade"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : initial ? "Salvar alterações" : "Criar programa"}
        </button>
      </div>
    </form>
  );
}
