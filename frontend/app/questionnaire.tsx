"use client";

import { useEffect, useState } from "react";
import { type ClientProfile, PersonaSet } from "@qryvox/shared";
import ProfileForm from "./profile-form";
import { Sheet } from "./ui";

// The adviser's questionnaire (#32): the shared form in the adviser's voice, in a sheet, with the
// fabricated personas a click away. A client is known only by a pseudonymous id the screen makes up.

type Persona = { name: string; summary: string; profile: ClientProfile };

export default function Questionnaire({
  initial,
  editing,
  onSave,
  onClose,
}: {
  initial: ClientProfile;
  // True when these are new answers for a client already on the case: saving supersedes their advice.
  editing: boolean;
  onSave: (profile: ClientProfile) => Promise<void>;
  onClose: () => void;
}) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  // A form keyed on the persona loaded, so loading one starts the form from its answers.
  const [seed, setSeed] = useState<{ key: string; profile: ClientProfile }>({ key: initial.client_id, profile: initial });

  // The fabricated personas, from the same answer key the eval reads. Loading one fills the answers; it
  // is a starting point the adviser can change, not an input to anything.
  useEffect(() => {
    if (editing) return;
    void fetch("/eval/personas.json")
      .then((res) => res.json())
      .then((json) => setPersonas(PersonaSet.parse(json).personas))
      .catch(() => setPersonas([]));
  }, [editing]);

  return (
    <Sheet title={editing ? "New answers" : "Add a client"} onClose={onClose}>
      <ProfileForm
        key={seed.key}
        initial={seed.profile}
        voice="adviser"
        submitLabel={editing ? "Record new answers" : "Record answers"}
        busyLabel="Recording…"
        onSubmit={onSave}
        before={(_, current) => (
          <>
            <p className="t-footnote muted">
              Recorded as <code>{current.client_id}</code>, a pseudonymous id. Names never enter the record.
              {editing && " Saving records a new version of the answers and sets aside advice drafted on the old one."}
            </p>
            {personas.length > 0 && (
              <div className="field">
                <p className="t-footnote strong">Start from a persona</p>
                <p className="t-caption muted">Fabricated clients for the demonstration. Every answer can be changed.</p>
                <div className="choices field__control">
                  {personas.map((persona) => (
                    <button
                      key={persona.profile.client_id}
                      type="button"
                      className="chip"
                      aria-pressed={current.client_id === persona.profile.client_id}
                      title={persona.summary}
                      onClick={() => setSeed({ key: persona.profile.client_id, profile: persona.profile })}
                    >
                      {persona.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      />
    </Sheet>
  );
}
