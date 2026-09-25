import { useState } from "react";
import TemplatesTab from "../components/TemplatesTab.jsx";
import ExercisesTab from "../components/ExercisesTab.jsx";

const TABS = [
  { id: "templates", label: "Treinos" },
  { id: "exercises", label: "Exercícios" },
];

export default function Workouts() {
  const [tab, setTab] = useState("templates");
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Treinos</h1>
        <p className="text-sm text-muted mt-0.5">
          Seus treinos de força, séries e cargas.
        </p>
      </div>
      <div className="flex gap-1 border-b divider">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
              tab === t.id
                ? "border-brand-500 text-brand-700 dark:text-brand-300"
                : "border-transparent text-muted hover:text-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "templates" && <TemplatesTab />}
      {tab === "exercises" && <ExercisesTab />}
    </div>
  );
}
