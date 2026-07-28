// Settings screen — DD §36.3 M11.5 UX.
//
// Ships:
//   - Persona directory listing (root + secondary personas)
//   - Persona creation flow with the verbatim §18.5 warning
//   - Switch persona with a confirm-tap (M11.5-e's alpha-viable
//     "separate unlock" — see the comment at ConfirmSwitchCard)
//   - Remove non-root personas
//
// The screen is intentionally settings-only, not mid-flow (§36.3
// "Creation is a settings action, never mid-flow, to avoid
// cross-contamination"). It sits behind the #settings route.

import { useState } from 'react';
import { useWeft } from './context';
import { tokens } from './styles';
import { personaPalette } from './persona-tint';

/**
 * DD §18.5 warning. Shown verbatim at persona creation time. Bumping this
 * string requires Fable review — the wording is a promise (`weft-ux-spec.md`
 * §14 copy discipline).
 */
export const PERSONA_WARNING_VERBATIM =
  "the network can't link your selves; your habits can";

export function SettingsScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { activePersona, personas, createPersona, switchPersona, removePersona } = useWeft();
  const [creating, setCreating] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!activePersona) return <p style={{ color: tokens.muted }}>Loading…</p>;

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: tokens.muted,
          padding: 0,
          marginBottom: 10,
          fontSize: 13,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        ← Back
      </button>

      <h2 style={{ fontFamily: tokens.serif, fontSize: 19, margin: '0 0 16px' }}>Settings</h2>

      <p
        style={{
          color: tokens.muted,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
          margin: '20px 0 8px',
        }}
      >
        Your selves
      </p>

      {personas.map((p) => (
        <PersonaRow
          key={p.index}
          persona={p}
          isActive={p.index === activePersona.index}
          onSwitch={() => setPendingSwitch(p.index)}
          onRemove={
            p.index === 0
              ? undefined
              : async () => {
                  try {
                    await removePersona(p.index);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }
          }
        />
      ))}

      {!creating && (
        <button
          onClick={() => setCreating(true)}
          style={{
            marginTop: 8,
            width: '100%',
            padding: 12,
            background: tokens.accentSoft,
            color: tokens.accent,
            border: 'none',
            borderRadius: tokens.buttonRadius,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Start a separate self
        </button>
      )}

      {creating && (
        <CreatePersonaForm
          onCancel={() => setCreating(false)}
          onCreated={async (label) => {
            setCreating(false);
            try {
              await createPersona(label);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}

      {pendingSwitch !== null && pendingSwitch !== activePersona.index && (
        <ConfirmSwitchCard
          targetIndex={pendingSwitch}
          onCancel={() => setPendingSwitch(null)}
          onConfirm={async () => {
            const idx = pendingSwitch;
            setPendingSwitch(null);
            try {
              await switchPersona(idx);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}

      {error && (
        <p style={{ color: tokens.danger, marginTop: 12, fontSize: 13 }}>{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonaRow
// ---------------------------------------------------------------------------

function PersonaRow({
  persona,
  isActive,
  onSwitch,
  onRemove,
}: {
  persona: { index: number; label: string; createdAt: number };
  isActive: boolean;
  onSwitch: () => void;
  onRemove?: (() => void) | (() => Promise<void>) | undefined;
}): JSX.Element {
  const palette = personaPalette(persona.index, '', persona.label);
  const dotColor = persona.index === 0 ? tokens.accent : palette.accent;

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${isActive ? dotColor : tokens.line}`,
        borderRadius: tokens.cardRadius,
        padding: 12,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
        aria-hidden
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          {persona.label}
          {persona.index === 0 && (
            <span style={{ color: tokens.muted, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              (root)
            </span>
          )}
        </p>
        <p style={{ margin: 0, color: tokens.muted, fontSize: 12 }}>
          {isActive ? 'Active' : 'Not active'}
        </p>
      </div>
      {!isActive && (
        <button
          onClick={onSwitch}
          style={{
            padding: '6px 10px',
            background: tokens.accentSoft,
            color: tokens.accent,
            border: 'none',
            borderRadius: tokens.buttonRadius,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Switch
        </button>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            color: tokens.danger,
            border: `1px solid ${tokens.danger}`,
            borderRadius: tokens.buttonRadius,
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label={`Remove ${persona.label}`}
        >
          Remove
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreatePersonaForm — with verbatim §18.5 warning
// ---------------------------------------------------------------------------

function CreatePersonaForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (label: string) => void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const trimmed = label.trim();

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginTop: 12,
      }}
    >
      <h3 style={{ fontFamily: tokens.serif, fontSize: 17, margin: '0 0 8px' }}>
        Start a separate self
      </h3>

      <p style={{ color: tokens.muted, fontSize: 13, margin: '0 0 12px', lineHeight: 1.4 }}>
        A separate self runs alongside your main one — with its own contacts,
        interests, and reveals. From other people's perspective it looks like a
        different person entirely.
      </p>

      {/* The §18.5 warning — VERBATIM. Do not paraphrase. */}
      <div
        style={{
          background: tokens.amberSoft,
          border: `1.5px solid ${tokens.amber}`,
          borderRadius: tokens.cardRadius,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontStyle: 'italic',
            color: tokens.ink,
          }}
        >
          {PERSONA_WARNING_VERBATIM}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: tokens.muted, lineHeight: 1.4 }}>
          You can hold as many selves as you like without anyone learning they're
          all you — as long as the way you write, what times you're online, and
          what you're curious about don't quietly connect them. That's on you,
          not on Weft.
        </p>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginTop: 10,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>I understand the network can't link my selves; my habits can.</span>
        </label>
      </div>

      <input
        type="text"
        placeholder="Label for you only (e.g. Quiet, Work)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        style={{
          width: '100%',
          padding: 10,
          border: `1px solid ${tokens.line}`,
          borderRadius: tokens.buttonRadius,
          fontSize: 14,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: 12,
            background: 'transparent',
            color: tokens.muted,
            border: `1px solid ${tokens.line}`,
            borderRadius: tokens.buttonRadius,
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onCreated(trimmed)}
          disabled={!acknowledged || trimmed.length === 0}
          style={{
            flex: 1,
            padding: 12,
            background: !acknowledged || trimmed.length === 0 ? tokens.line : tokens.accent,
            color: 'white',
            border: 'none',
            borderRadius: tokens.buttonRadius,
            fontSize: 14,
            fontWeight: 700,
            cursor: !acknowledged || trimmed.length === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Create
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmSwitchCard — M11.5-e's alpha-viable "separate unlock"
// ---------------------------------------------------------------------------

/**
 * DD §36.3 "separate unlock by default" — full implementation would gate
 * persona switch behind a passphrase (each persona backed by a distinct
 * scrypt-derived key in the encrypted backup blob). For the alpha we ship
 * a lightweight version: the switch takes an explicit confirm tap, which
 * gives users the "you're changing selves" moment without the full
 * passphrase overhead. Ratchet up to a real passphrase in v0.3 alongside
 * the encrypted-backup work (v2 IOU per SECURITY.md).
 */
function ConfirmSwitchCard({
  targetIndex,
  onCancel,
  onConfirm,
}: {
  targetIndex: number;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        background: tokens.card,
        border: `1.5px solid ${tokens.accent}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginTop: 12,
      }}
    >
      <h3 style={{ fontFamily: tokens.serif, fontSize: 17, margin: '0 0 8px' }}>
        Switch to another self?
      </h3>
      <p style={{ color: tokens.muted, fontSize: 13, margin: '0 0 12px', lineHeight: 1.4 }}>
        Your other self has its own contacts, its own interests, and its own
        conversations. Switching won't merge them.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: 12,
            background: 'transparent',
            color: tokens.muted,
            border: `1px solid ${tokens.line}`,
            borderRadius: tokens.buttonRadius,
            fontSize: 14,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Stay here
        </button>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            padding: 12,
            background: tokens.accent,
            color: 'white',
            border: 'none',
            borderRadius: tokens.buttonRadius,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label={`Switch to persona ${targetIndex}`}
        >
          Switch
        </button>
      </div>
    </div>
  );
}
