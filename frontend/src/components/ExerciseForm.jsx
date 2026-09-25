import { useState } from "react";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExerciseForm({ initial, onSubmit, onCancel, submitting, error }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    muscleGroup: initial?.muscleGroup || MUSCLE_GROUPS[0],
    archived: initial?.archived || false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({ ...form, name: form.name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          autoFocus
          required
        />
      </div>
      <div>
        <label className="label">Grupo muscular</label>
        <select
          className="input"
          value={form.muscleGroup}
          onChange={(e) => setForm((f) => ({ ...f, muscleGroup: e.target.value }))}
        >
          {MUSCLE_GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-3 text-sm text-soft">
        <input
          type="checkbox"
          checked={form.archived}
          onChange={(e) => setForm((f) => ({ ...f, archived: e.target.checked }))}
          className="accent-brand-600"
        />
        Arquivado
      </label>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
