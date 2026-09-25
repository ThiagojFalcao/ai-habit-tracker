import { useMemo, useState } from "react";
import api from "../api/axios.js";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExercisePicker({ exercises, onPick, onCreated, onClose }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [muscleGroup, setMuscleGroup] = useState(MUSCLE_GROUPS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = exercises.filter((e) => !e.archived);
    if (!q) return active;
    return active.filter((e) => e.name.toLowerCase().includes(q));
  }, [exercises, query]);

  const create = async () => {
    if (!query.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/exercises", { name: query.trim(), muscleGroup });
      onCreated(res.data);
      onPick(res.data);
      onClose();
    } catch (err) {
      setError(
        err.response?.status === 409
          ? "Já existe um exercício com esse nome."
          : "Não foi possível criar o exercício."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass rounded-xl p-3 space-y-3">
      <input
        className="input"
        placeholder="Buscar exercício…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCreating(false);
        }}
        autoFocus
      />
      <div className="max-h-56 overflow-y-auto space-y-1">
        {filtered.map((exercise) => (
          <button
            key={exercise._id}
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-soft hover:bg-[var(--surface-hover)]"
            onClick={() => {
              onPick(exercise);
              onClose();
            }}
          >
            <span className="truncate">{exercise.name}</span>
            <span className="chip shrink-0">{exercise.muscleGroup}</span>
          </button>
        ))}
        {!filtered.length && (
          <div className="text-xs text-muted px-1 py-2">Nenhum exercício encontrado.</div>
        )}
      </div>
      {!creating ? (
        <button type="button" className="btn-secondary w-full" onClick={() => setCreating(true)}>
          + Novo exercício
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">
            Criar <b>{query.trim()}</b>
          </div>
          <select
            className="input"
            value={muscleGroup}
            onChange={(e) => setMuscleGroup(e.target.value)}
          >
            {MUSCLE_GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          {error && <div className="text-xs text-rose-500">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setCreating(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={create}
              disabled={saving || !query.trim()}
            >
              {saving ? "Criando…" : "Criar e usar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
