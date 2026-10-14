"use client";

import { useState } from "react";
import { updateState, useAppState, type Gender, type Theme } from "@/lib/store";
import { THEMES } from "@/components/KidApp";

export default function ParentDashboard() {
  const state = useAppState();
  const [unlocked, setUnlocked] = useState(false);

  if (!state.parentPin) {
    return <PinSetup />;
  }
  if (!unlocked) {
    return <PinLogin onOk={() => setUnlocked(true)} pin={state.parentPin} />;
  }
  return (
    <main className="parent-shell">
      <header className="parent-header">
        <h1>Parent dashboard</h1>
        <button className="link" onClick={() => setUnlocked(false)}>
          Lock
        </button>
      </header>
      <AddKid />
      {state.kids.length === 0 && <p className="muted">No child profiles yet. Add one above.</p>}
      {state.kids.map((kid) => {
        const accuracy = kid.attempted === 0 ? 0 : Math.round((kid.correct / kid.attempted) * 100);
        return (
          <section key={kid.id} className="card kid-card">
            <h2>
              {THEMES[kid.theme].emoji} {kid.name}
            </h2>
            <p className="muted">
              Age {kid.age} · {kid.gender.replace(/-/g, " ")} · {THEMES[kid.theme].label}
            </p>
            <dl className="stats">
              <div>
                <dt>Level</dt>
                <dd>{kid.level}</dd>
              </div>
              <div>
                <dt>Unlocked</dt>
                <dd>Level {kid.unlockedLevel}</dd>
              </div>
              <div>
                <dt>Answered</dt>
                <dd>{kid.attempted}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>{accuracy}%</dd>
              </div>
              <div>
                <dt>Points</dt>
                <dd>{kid.points}</dd>
              </div>
              <div>
                <dt>Approved minutes</dt>
                <dd>{kid.approvedMinutes}</dd>
              </div>
            </dl>
            <div className="approve">
              <span>
                Requested screen time: <strong>{kid.requestedMinutes} min</strong>
              </span>
              <button
                className="primary"
                disabled={kid.requestedMinutes === 0}
                onClick={() =>
                  updateState((s) => ({
                    ...s,
                    kids: s.kids.map((k) =>
                      k.id === kid.id
                        ? { ...k, approvedMinutes: k.approvedMinutes + k.requestedMinutes, requestedMinutes: 0 }
                        : k,
                    ),
                  }))
                }
              >
                Approve {kid.requestedMinutes} min
              </button>
            </div>
          </section>
        );
      })}
    </main>
  );
}

function PinSetup() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="parent-shell">
      <section className="card">
        <h1>Create a parent PIN</h1>
        <p className="muted">Use at least 4 digits. This keeps the parent area away from children.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{4,}$/.test(pin)) {
              setError("Use at least 4 digits.");
              return;
            }
            updateState((s) => ({ ...s, parentPin: pin }));
          }}
        >
          <input inputMode="numeric" type="password" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="New parent PIN" />
          <button type="submit" className="primary">
            Save PIN
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function PinLogin({ pin, onOk }: { pin: string; onOk: () => void }) {
  const [entry, setEntry] = useState("");
  const [error, setError] = useState("");
  return (
    <main className="parent-shell">
      <section className="card">
        <h1>Parent sign-in</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (entry === pin) onOk();
            else setError("Incorrect PIN.");
          }}
        >
          <input inputMode="numeric" type="password" value={entry} onChange={(e) => setEntry(e.target.value)} aria-label="Parent PIN" />
          <button type="submit" className="primary">
            Enter
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function AddKid() {
  const [name, setName] = useState("");
  const [age, setAge] = useState(5);
  const [gender, setGender] = useState<Gender>("prefer-not-to-say");
  const [theme, setTheme] = useState<Theme>("space");
  return (
    <section className="card">
      <h2>Add a child</h2>
      <form
        className="add-kid"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          updateState((s) => ({
            ...s,
            kids: [
              ...s.kids,
              {
                id: crypto.randomUUID(),
                name: trimmed,
                gender,
                age,
                theme,
                level: 1,
                unlockedLevel: 1,
                usedByLevel: {},
                points: 0,
                attempted: 0,
                correct: 0,
                requestedMinutes: 0,
                approvedMinutes: 0,
              },
            ],
          }));
          setName("");
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Age
          <input type="number" min={3} max={18} value={age} onChange={(e) => setAge(Number(e.target.value))} />
        </label>
        <label>
          Gender
          <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
            <option value="boy">Boy</option>
            <option value="girl">Girl</option>
            <option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </label>
        <label>
          Theme
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            {(Object.keys(THEMES) as Theme[]).map((t) => (
              <option key={t} value={t}>
                {THEMES[t].label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primary">
          Add child
        </button>
      </form>
    </section>
  );
}
