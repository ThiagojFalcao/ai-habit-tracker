import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Habits from "./pages/Habits.jsx";
import HabitDetail from "./pages/HabitDetail.jsx";
import Weekly from "./pages/Weekly.jsx";
import Insights from "./pages/Insights.jsx";
import Stats from "./pages/Stats.jsx";
import Workouts from "./pages/Workouts.jsx";
import ProgramDetail from "./pages/ProgramDetail.jsx";
import ActiveWorkout from "./pages/ActiveWorkout.jsx";
import AppLayout from "./components/AppLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/habits" element={<Habits />} />
        <Route path="/habits/:habitId" element={<HabitDetail />} />
        <Route path="/weekly" element={<Weekly />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/workouts/programs/:programId" element={<ProgramDetail />} />
        <Route path="/workouts/logs/:logId" element={<ActiveWorkout />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
