// Minimal PWA shell — coordinates onboarding, home, ask flow, matches, and
// the honest-surfaces screen. Deliberately compact; the UX spec's Part IV
// BUILD copy strings are used verbatim where safety-critical (Pass line,
// privacy line, decline-is-invisible etc.).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bytesToHex,
  generateKeypair,
  HealthLog,
  StubEmbedder,
  type Keypair,
} from '@weft/core';
import { IdbStore } from './idb-store';
import { tokens } from './styles';

type Screen = 'boot' | 'onboarding' | 'home' | 'ask' | 'match' | 'invite' | 'why';

interface AppState {
  screen: Screen;
  identity?: Keypair;
  displayName?: string;
  store?: IdbStore;
  health: HealthLog;
  embedder: StubEmbedder;
}

const KEY_STORAGE_KEY = 'weft:secret:hex';
const NAME_STORAGE_KEY = 'weft:displayName';

export function App(): JSX.Element {
  const [state, setState] = useState<AppState>(() => ({
    screen: 'boot',
    health: new HealthLog(),
    embedder: new StubEmbedder(),
  }));

  const store = useMemo(() => new IdbStore(), []);

  useEffect(() => {
    // Bootstrap: load existing key if we have one, else show onboarding.
    const hex = localStorage.getItem(KEY_STORAGE_KEY);
    const name = localStorage.getItem(NAME_STORAGE_KEY);
    if (hex && name) {
      const secret = hexToBytes(hex);
      const identity = { secret, pubkey: pubkeyFromSecret(secret) };
      store.setUserPubkey(bytesToHex(identity.pubkey));
      setState((s) => ({ ...s, identity, displayName: name, store, screen: 'home' }));
    } else {
      setState((s) => ({ ...s, store, screen: 'onboarding' }));
    }
  }, [store]);

  const complete = useCallback(
    (name: string) => {
      const identity = generateKeypair();
      localStorage.setItem(KEY_STORAGE_KEY, bytesToHex(identity.secret));
      localStorage.setItem(NAME_STORAGE_KEY, name);
      store.setUserPubkey(bytesToHex(identity.pubkey));
      setState((s) => ({ ...s, identity, displayName: name, screen: 'home' }));
    },
    [store],
  );

  return (
    <div
      style={{
        fontFamily: tokens.sans,
        background: tokens.paper,
        minHeight: '100vh',
        color: tokens.ink,
      }}
    >
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '18px 20px 90px' }}>
        {state.screen === 'boot' && <p>Loading…</p>}
        {state.screen === 'onboarding' && <Onboarding onComplete={complete} />}
        {state.screen === 'home' && state.identity && state.displayName && (
          <Home
            name={state.displayName}
            onAsk={() => setState((s) => ({ ...s, screen: 'ask' }))}
            onInvite={() => setState((s) => ({ ...s, screen: 'invite' }))}
            onWhy={() => setState((s) => ({ ...s, screen: 'why' }))}
          />
        )}
        {state.screen === 'ask' && (
          <AskFlow onBack={() => setState((s) => ({ ...s, screen: 'home' }))} />
        )}
        {state.screen === 'invite' && (
          <InviteFlow onBack={() => setState((s) => ({ ...s, screen: 'home' }))} />
        )}
        {state.screen === 'why' && (
          <WhyItWorks
            counters={state.health.snapshot()}
            onBack={() => setState((s) => ({ ...s, screen: 'home' }))}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding — UX spec §9.
// v0 shortcut: skips the invite landing flow because there is no live invite
// service to redeem against at the point of first-run. When an invite is
// scanned via the URL fragment, InviteRedeem handles it.
// ---------------------------------------------------------------------------

function Onboarding({ onComplete }: { onComplete: (name: string) => void }): JSX.Element {
  const [step, setStep] = useState<'welcome' | 'name' | 'interests'>('welcome');
  const [name, setName] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [currentInterest, setCurrentInterest] = useState('');

  if (step === 'welcome') {
    return (
      <Card>
        <H1>Weft</H1>
        <p>Ask your people. Find your people.</p>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          No account, no password. Just a name your people will recognize.
        </p>
        <PrimaryButton onClick={() => setStep('name')}>Continue</PrimaryButton>
      </Card>
    );
  }
  if (step === 'name') {
    return (
      <Card>
        <H2>What should people call you?</H2>
        <input
          type="text"
          placeholder="first name is fine"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: '100%',
            padding: 12,
            fontSize: 16,
            border: `1px solid ${tokens.line}`,
            borderRadius: tokens.buttonRadius,
            marginBottom: 12,
          }}
        />
        <p style={{ color: tokens.muted, fontSize: 13 }}>
          No account, no password. Just a name your people will recognize.
        </p>
        <PrimaryButton disabled={name.trim().length === 0} onClick={() => setStep('interests')}>
          Continue
        </PrimaryButton>
      </Card>
    );
  }
  return (
    <Card>
      <H2>Tell me a couple of things you're into — just talk.</H2>
      <input
        type="text"
        placeholder="e.g. koji fermentation"
        value={currentInterest}
        onChange={(e) => setCurrentInterest(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 16,
          border: `1px solid ${tokens.line}`,
          borderRadius: tokens.buttonRadius,
          marginBottom: 12,
        }}
      />
      <QuietButton
        onClick={() => {
          if (currentInterest.trim() && interests.length < 3) {
            setInterests([...interests, currentInterest.trim()]);
            setCurrentInterest('');
          }
        }}
      >
        Add
      </QuietButton>
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        {interests.map((i, idx) => (
          <Chip key={idx} onClick={() => setInterests(interests.filter((_, j) => j !== idx))}>
            {i} ✕
          </Chip>
        ))}
      </div>
      <PrimaryButton disabled={interests.length === 0} onClick={() => onComplete(name)}>
        Done
      </PrimaryButton>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Home — UX spec §10.
// ---------------------------------------------------------------------------

function Home({
  name,
  onAsk,
  onInvite,
  onWhy,
}: {
  name: string;
  onAsk: () => void;
  onInvite: () => void;
  onWhy: () => void;
}): JSX.Element {
  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: tokens.muted, fontSize: 13 }}>You are</p>
        <H1>{name}</H1>
      </div>
      <Card>
        <H2>Ask your people</H2>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          Say what you're looking for. Your ask travels friend to friend — never a feed, never a database.
        </p>
        <PrimaryButton onClick={onAsk}>Ask</PrimaryButton>
      </Card>
      <div style={{ marginTop: 24 }}>
        <p
          style={{
            color: tokens.muted,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
          }}
        >
          Your people
        </p>
        <Card>
          <p style={{ margin: 0 }}>Bringing someone in means standing behind them.</p>
          <QuietButton onClick={onInvite}>Invite &amp; vouch</QuietButton>
        </Card>
      </div>
      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <a
          href="#why"
          onClick={(e) => {
            e.preventDefault();
            onWhy();
          }}
          style={{ color: tokens.muted, fontSize: 13 }}
        >
          Why it works this way
        </a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ask flow — UX spec §11.
// ---------------------------------------------------------------------------

function AskFlow({ onBack }: { onBack: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Card>
        <p>Your ask is traveling. Answers usually come within a day or two, as friends come online.</p>
        <PrimaryButton onClick={onBack}>OK</PrimaryButton>
      </Card>
    );
  }
  return (
    <Card>
      <BackButton onClick={onBack} />
      <H2>Just talk. Say it the way you'd say it to a friend.</H2>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="I'd love to find people experimenting with koji…"
        style={{
          width: '100%',
          padding: 12,
          fontSize: 16,
          border: `1px solid ${tokens.line}`,
          borderRadius: tokens.buttonRadius,
          marginBottom: 12,
        }}
      />
      <p style={{ color: tokens.muted, fontSize: 13 }}>
        Your name stays hidden until you both agree to connect. To anyone who receives this, it looks
        passed-along — never yours.
      </p>
      <PrimaryButton disabled={text.trim().length === 0} onClick={() => setSent(true)}>
        Send it
      </PrimaryButton>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Invite flow — UX spec §14.
// ---------------------------------------------------------------------------

function InviteFlow({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <Card>
      <BackButton onClick={onBack} />
      <H2>Invite &amp; vouch</H2>
      <p style={{ color: tokens.muted, fontSize: 14 }}>
        Your address book never leaves this phone. In person, two QRs can finish the whole thing with no
        signal at all.
      </p>
      <p style={{ fontSize: 13 }}>Bringing someone in means standing behind them.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Why It Works — UX spec §15.
// ---------------------------------------------------------------------------

function WhyItWorks({
  counters,
  onBack,
}: {
  counters: { asksSent: number; asksMatched: number; handshakesCompleted: number; forwardsRelayed: number; deadQueries: number };
  onBack: () => void;
}): JSX.Element {
  return (
    <Card>
      <BackButton onClick={onBack} />
      <H2>Why it works this way</H2>
      <p>Weft is a channel, not a place. Ask, don't broadcast. Silence is a valid answer.</p>
      <H2>What leaves this phone</H2>
      <ul style={{ fontSize: 14, color: tokens.muted, paddingLeft: 20 }}>
        <li>asks sent: {counters.asksSent}</li>
        <li>asks matched: {counters.asksMatched}</li>
        <li>handshakes completed: {counters.handshakesCompleted}</li>
        <li>forwards relayed: {counters.forwardsRelayed}</li>
        <li>dead queries: {counters.deadQueries}</li>
      </ul>
      <p style={{ fontSize: 13, color: tokens.muted }}>
        These numbers never leave this phone. No topics, no names, no places, no graph.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Primitives — UX spec §6 tokens.
// ---------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginBottom: 15,
      }}
    >
      {children}
    </div>
  );
}
function H1({ children }: { children: React.ReactNode }): JSX.Element {
  return <h1 style={{ fontFamily: tokens.serif, fontSize: 25, margin: '0 0 8px' }}>{children}</h1>;
}
function H2({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 style={{ fontFamily: tokens.serif, fontSize: 19, margin: '0 0 8px' }}>{children}</h2>;
}
function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: 14,
        background: disabled ? tokens.line : tokens.accent,
        color: 'white',
        border: 'none',
        borderRadius: tokens.buttonRadius,
        fontSize: 15,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        marginTop: 12,
      }}
    >
      {children}
    </button>
  );
}
function QuietButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px',
        background: tokens.accentSoft,
        color: tokens.accent,
        border: 'none',
        borderRadius: tokens.buttonRadius,
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        marginTop: 8,
      }}
    >
      {children}
    </button>
  );
}
function Chip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): JSX.Element {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        border: `1.5px solid ${tokens.accent}`,
        color: tokens.accent,
        borderRadius: tokens.chipRadius,
        marginRight: 8,
        marginBottom: 4,
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      {children}
    </span>
  );
}
function BackButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: tokens.muted,
        fontSize: 13,
        cursor: 'pointer',
        padding: 0,
        marginBottom: 12,
      }}
    >
      ← Back
    </button>
  );
}

// ---------------------------------------------------------------------------
// Key utilities.
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function pubkeyFromSecret(secret: Uint8Array): Uint8Array {
  // Delegate to core's public helper for consistency.
  // Import lazily to avoid a top-level circular concern (core index reexports many modules).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { publicKeyFromSecret } = require('@weft/core') as { publicKeyFromSecret: (s: Uint8Array) => Uint8Array };
  return publicKeyFromSecret(secret);
}
