import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import ExercisePicker from "./ExercisePicker.jsx";

export default function WorkoutForm({
  initial,
  habits,
  exercises,
  onCreatedExercise,
  onSubmit,
  onCancel,
  submitting,
  error,
}) {
  const [name, setName] = useState(initial?.name || "");
  const [habitId, setHabitId] = useState(initial?.habitId || habits[0]?._id || "");
  const [items, setItems] = useState(
    (initial?.exercises || []).map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, reps: e.reps }))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState("");

  const exercisesById = Object.fromEntries(exercises.map((e) => [e._id, e]));

  const addExercise = (exercise) => {
    setItems((list) => [...list, { exerciseId: exercise._id, sets: 3, reps: 10 }]);
  };
  const updateItem = (index, patch) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const removeItem = (index) => setItems((list) => list.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !habitId || !items.length) {
      setFormError("Informe nome, hábito e pelo menos um exercício.");
      return;
    }
    setFormError("");
    onSubmit({
      name: name.trim(),
      habitId,
      exercises: items.map((it) => ({
        exerciseId: it.exerciseId,
        sets: Number(it.sets),
        reps: Number(it.reps),
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome do treino</label>
        <input
          className="input"
          placeholder="ex.: Peito"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>
      <div>
        <label className="label">Hábito</label>
        <select className="input" value={habitId} onChange={(e) => setHabitId(e.target.value)}>
          {habits.map((h) => (
            <option key={h._id} value={h._id}>
              {h.icon} {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="label">Exercícios</div>
        {items.map((item, index) => (
          <div key={`${item.exerciseId}-${index}`} className="glass rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate">
                {exercisesById[item.exerciseId]?.name || "Exercício"}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(index, -1)} aria-label="Mover para cima">
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(index, 1)} aria-label="Mover para baixo">
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5 text-rose-500" onClick={() => removeItem(index)} aria-label="Remover exercício">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Séries</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="input"
                  value={item.sets}
                  onChange={(e) => updateItem(index, { sets: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Reps</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={item.reps}
                  onChange={(e) => updateItem(index, { reps: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}

        {pickerOpen ? (
          <ExercisePicker
            exercises={exercises}
            onPick={addExercise}
            onCreated={onCreatedExercise}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <button type="button" className="btn-secondary w-full" onClick={() => setPickerOpen(true)}>
            + Exercício
          </button>
        )}
      </div>

      {(formError || error) && <div className="text-sm text-rose-500">{formError || error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : initial ? "Salvar alterações" : "Criar treino"}
        </button>
      </div>
    </form>
  );
}
