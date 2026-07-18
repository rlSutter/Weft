// Main PWA app. Routes on URL hash. Reads all state from WeftContext.
//
// Screens:
//   Onboarding    first-run flow (no key yet)
//   Home          asks-out, matches, invites, conversations, links
//   AskFlow       "just talk" text field → client.ask()
//   MatchCard     masked → Connect (initiate handshake) / Pass (Gate 2)
//   Reveal        shown once channelOpen fires; shows real name + vouches
//   Conversation  message thread post-reveal
//   InviteFlow    createInvite → URL to copy; list of invites out
//   ConfirmCard   Alice's "someone joined with your invite" prompt
//   Redeem       fragment path: /#/i/<token>; charter consent → keypair
//   WhyItWorks    counters + honest surfaces

import { useEffect, useState } from 'react';
import { WeftProvider, useWeft, useRoute } from './context';
import { decodeInviteToken, describeToken, generateKeypair, bytesToHex } from '@weft/core';
import type { InviteTokenDescription } from '@weft/core';
import { tokens } from './styles';
import { Landing } from './Landing';

export function App(): JSX.Element {
  return (
    <WeftProvider>
      <Shell />
    </WeftProvider>
  );
}

function Shell(): JSX.Element {
  const { client, state, identity } = useWeft();
  const [route, navigate] = useRoute();
  const [startedOnboarding, setStartedOnboarding] = useState(false);

  // Redeem route works even without an identity (identity is created inside
  // the redemption flow).
  if (route.name === 'redeem') return <RedeemScreen token={route.token} />;

  // The About / Landing route is always available — new visitors land here
  // by default; returning users can revisit via #about.
  const showLandingAsDefault = !identity && !startedOnboarding;
  if (route.name === 'about' || showLandingAsDefault) {
    return (
      <Landing
        alreadyOnboarded={!!identity}
        onStart={() => {
          if (identity) {
            navigate({ name: 'home' });
          } else {
            setStartedOnboarding(true);
            // Clear any leftover hash so we don't bounce back to about.
            if (window.location.hash === '#about') {
              window.location.hash = '#/';
            }
          }
        }}
        onRedeem={(token) => {
          window.location.hash = `#/i/${token}`;
        }}
        onGoHome={identity ? () => navigate({ name: 'home' }) : undefined}
      />
    );
  }

  return (
    <Frame>
      {!identity && <Onboarding onBackToLanding={() => setStartedOnboarding(false)} />}
      {identity && client && state && (
        <>
          {route.name === 'home' && <Home onNav={navigate} />}
          {route.name === 'ask' && <AskScreen onBack={() => navigate({ name: 'home' })} />}
          {route.name === 'invite' && <InviteScreen onBack={() => navigate({ name: 'home' })} />}
          {route.name === 'why' && <WhyItWorks onBack={() => navigate({ name: 'home' })} />}
          {route.name === 'match' && (
            <MatchScreen queryId={route.queryId} onBack={() => navigate({ name: 'home' })} />
          )}
          {route.name === 'chat' && (
            <ChatScreen peerPubkey={route.peerPubkey} onBack={() => navigate({ name: 'home' })} />
          )}
        </>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Frame — universal layout container
// ---------------------------------------------------------------------------

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontFamily: tokens.sans, background: tokens.paper, minHeight: '100vh', color: tokens.ink }}>
      <div style={{ maxWidth: 400, margin: '0 auto', padding: '18px 20px 90px' }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function Onboarding({ onBackToLanding }: { onBackToLanding: () => void }): JSX.Element {
  const { completeOnboarding } = useWeft();
  const [step, setStep] = useState<'welcome' | 'name'>('welcome');
  const [name, setName] = useState('');

  if (step === 'welcome') {
    return (
      <>
        <BackButton onClick={onBackToLanding} />
        <Card>
          <H1>Weft</H1>
          <p>Ask your people. Find your people.</p>
          <p style={{ color: tokens.muted, fontSize: 14 }}>
            No account, no password. Just a name your people will recognize.
          </p>
          <PrimaryButton onClick={() => setStep('name')}>Continue</PrimaryButton>
        </Card>
      </>
    );
  }

  return (
    <>
      <BackButton onClick={() => setStep('welcome')} />
      <Card>
        <H2>What should people call you?</H2>
        <TextInput placeholder="first name is fine" value={name} onChange={setName} />
        <p style={{ color: tokens.muted, fontSize: 13, marginTop: 12 }}>
          No account, no password. Just a name your people will recognize.
        </p>
        <PrimaryButton
          disabled={name.trim().length === 0}
          onClick={() => completeOnboarding(name.trim())}
        >
          Continue
        </PrimaryButton>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Redeem — arrives via #/i/<token>
// ---------------------------------------------------------------------------

function RedeemScreen({ token }: { token: string }): JSX.Element {
  const { client, identity, adoptRedeemedIdentity } = useWeft();
  const [description, setDescription] = useState<InviteTokenDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const r = decodeInviteToken(token, Math.floor(Date.now() / 1000));
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDescription(describeToken(r.token));
  }, [token]);

  if (error) {
    return (
      <Frame>
        <DangerCard>
          <H2>This invite can't be used</H2>
          <p>
            {error === 'expired'
              ? "This invite has expired. Ask your friend for a fresh one."
              : "This invite isn't valid."}
          </p>
          <PrimaryButton onClick={() => (window.location.hash = '#/')}>OK</PrimaryButton>
        </DangerCard>
      </Frame>
    );
  }

  if (!description) return <Frame><p>Loading invite…</p></Frame>;

  if (done) {
    return (
      <Frame>
        <Card>
          <H2>You're in.</H2>
          <p style={{ color: tokens.muted }}>
            Waiting for your friend to confirm the invite. Your vouch line reads
            "invitation pending" until they do.
          </p>
          <PrimaryButton onClick={() => (window.location.hash = '#/')}>Continue to home</PrimaryButton>
        </Card>
      </Frame>
    );
  }

  const tierLabel = description.tier === 3 ? 'personally' : description.tier === 2 ? 'contextually' : 'provisionally';

  return (
    <Frame>
      <Card>
        <H2>Someone invited you.</H2>
        <p>
          The inviter's key: <code style={{ fontSize: 11 }}>{description.inviterPubkey.slice(0, 16)}…</code>
        </p>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          They vouch for you {tierLabel} for {description.vouchValidityDays} days. That means people
          here can trust you're real, because they say so.
        </p>
      </Card>
      {identity && (
        <DangerCard>
          <p>
            <strong>Note:</strong> you already have a Weft identity on this device. Redeeming this
            invite will replace it. Only proceed if you want to switch identities.
          </p>
        </DangerCard>
      )}
      <Card>
        <H2>What should people call you?</H2>
        <TextInput placeholder="first name is fine" value={name} onChange={setName} />
        <PrimaryButton
          disabled={name.trim().length === 0 || busy}
          onClick={async () => {
            setBusy(true);
            // The invite engine needs a temporary client to send the 4918. If
            // we already have an identity, use its client; else spin up a
            // one-shot redeemer via a fresh WeftClient below.
            // Simplest: create a fresh keypair, use InviteEngine directly.
            // But InviteEngine.redeemInvite generates its own keypair for
            // us — we adopt it after.
            let bobKp: { secret: Uint8Array; pubkey: Uint8Array } | null = null;
            let redemptionSent = false;
            try {
              if (client) {
                const result = await client.redeemInvite(token, name.trim());
                if (result.ok && result.bobKeypair) {
                  bobKp = result.bobKeypair;
                  redemptionSent = true;
                }
              } else {
                // No existing client — the redeem engine on a temporary
                // WeftClient is overkill; use the InviteEngine directly via
                // a fresh keypair path. Since InviteEngine internal to
                // WeftClient needs the WeftClient itself, easiest is:
                // create a throwaway keypair identity first via
                // completeOnboarding-adjacent path — but we need to adopt
                // the redeemed key.
                // Practical approach: create a fresh temporary client, run
                // redeem, then adopt.
                const tempKp = generateKeypair();
                const { WeftClient } = await import('./weft-client');
                const tempClient = new WeftClient({ me: tempKp, displayName: name.trim() });
                try {
                  const result = await tempClient.redeemInvite(token, name.trim());
                  if (result.ok && result.bobKeypair) {
                    bobKp = result.bobKeypair;
                    redemptionSent = true;
                  }
                } finally {
                  tempClient.destroy();
                }
              }
              if (bobKp && redemptionSent) {
                adoptRedeemedIdentity(bobKp.secret, name.trim());
                setDone(true);
              } else {
                setError('redemption failed');
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Joining…' : 'Agree & join'}
        </PrimaryButton>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function Home({ onNav }: { onNav: (r: import('./context').Route) => void }): JSX.Element {
  const { state, identity } = useWeft();
  if (!state || !identity) return <p style={{ color: tokens.muted }}>Loading your Weft…</p>;

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: tokens.muted, fontSize: 13 }}>You are</p>
        <H1>{identity.displayName}</H1>
      </div>

      {/* Pending confirmations first — they're time-sensitive. */}
      {state.pendingConfirmations.map((p) => (
        <ConfirmationCard key={p.iid} pending={p} />
      ))}

      {/* Impersonation alerts — same priority. */}
      {state.impersonationAlerts.map((a) => (
        <DangerCard key={a.matchId}>
          <H2>Impersonation caught</H2>
          <p>
            A person tried to connect but their vouches don't check out — the endorsements were for
            someone else. We've closed the connection.
          </p>
          <p style={{ color: tokens.muted, fontSize: 12 }}>{a.note}</p>
        </DangerCard>
      ))}

      {/* Active match arrivals */}
      {state.activeMatches.map((m) => (
        <div key={m.queryId} style={{ marginBottom: 12 }}>
          <QuietCard onClick={() => onNav({ name: 'match', queryId: m.queryId })}>
            <p>A match came back.</p>
            <p style={{ color: tokens.muted, fontSize: 13 }}>
              Score: {m.reply.scoreBucket} · Vouches: {m.reply.vouchCount}
            </p>
          </QuietCard>
        </div>
      ))}

      {/* The mic-like ask button */}
      <Card>
        <H2>Ask your people</H2>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          Say what you're looking for. Your ask travels friend to friend — never a feed, never a database.
        </p>
        <PrimaryButton onClick={() => onNav({ name: 'ask' })}>Ask</PrimaryButton>
      </Card>

      {/* Asks in flight */}
      {state.asksOut.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Eyebrow>Asks out in the world</Eyebrow>
          {state.asksOut.map((a) => (
            <Card key={a.queryId}>
              <p>{a.text}</p>
              <p style={{ color: tokens.muted, fontSize: 12 }}>
                {a.status === 'traveling' && 'Traveling… reached friends of friends'}
                {a.status === 'matched' && `${a.matches.length} match${a.matches.length === 1 ? '' : 'es'} came back`}
                {a.status === 'dead' && "This one didn't find anyone — networks have gaps."}
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* Conversations */}
      {state.conversations.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Eyebrow>Conversations</Eyebrow>
          {state.conversations.map((c) => (
            <QuietCard key={c.peerPubkey} onClick={() => onNav({ name: 'chat', peerPubkey: c.peerPubkey })}>
              <p>
                <strong>{c.peerName}</strong>
              </p>
              <p style={{ color: tokens.muted, fontSize: 12 }}>
                {c.messages.length > 0 ? c.messages[c.messages.length - 1].text : 'No messages yet'}
              </p>
            </QuietCard>
          ))}
        </div>
      )}

      {/* Interests — what you want others to be able to match against */}
      <InterestsCard />

      {/* Your people */}
      <div style={{ marginTop: 24 }}>
        <Eyebrow>Your people</Eyebrow>
        <QuietCard onClick={() => onNav({ name: 'invite' })}>
          <p style={{ margin: 0 }}>Bringing someone in means standing behind them.</p>
          <p style={{ color: tokens.muted, fontSize: 12 }}>Invite &amp; vouch</p>
        </QuietCard>
      </div>

      <div style={{ marginTop: 32, textAlign: 'center', display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a
          href="#why"
          onClick={(e) => {
            e.preventDefault();
            onNav({ name: 'why' });
          }}
          style={{ color: tokens.muted, fontSize: 13 }}
        >
          Why it works this way
        </a>
        <a
          href="#about"
          onClick={(e) => {
            e.preventDefault();
            onNav({ name: 'about' });
          }}
          style={{ color: tokens.muted, fontSize: 13 }}
        >
          About Weft
        </a>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AskScreen
// ---------------------------------------------------------------------------

function AskScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { client } = useWeft();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  if (status === 'sent') {
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
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <p style={{ color: tokens.muted, fontSize: 13 }}>
        Your name stays hidden until you both agree to connect. To anyone who receives this, it looks
        passed-along — never yours.
      </p>
      <PrimaryButton
        disabled={text.trim().length === 0 || status === 'sending' || !client}
        onClick={async () => {
          if (!client) return;
          setStatus('sending');
          await client.ask(text.trim());
          setStatus('sent');
        }}
      >
        {status === 'sending' ? 'Sending…' : 'Send it'}
      </PrimaryButton>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MatchScreen — masked match + Connect/Pass
// ---------------------------------------------------------------------------

function MatchScreen({ queryId, onBack }: { queryId: string; onBack: () => void }): JSX.Element {
  const { client, state } = useWeft();
  const [passed, setPassed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  if (!state || !client) return <p style={{ color: tokens.muted }}>Connecting to relays…</p>;

  const match = state.activeMatches.find((m) => m.queryId === queryId);
  const revealed = state.revealed.find((r) => r.matchId === queryId);

  if (revealed) return <RevealCard revealed={revealed} onDone={onBack} />;

  if (passed) {
    return (
      <Card>
        <p>Passed quietly — the protocol has no message for "no", so nothing can reach them.</p>
        <PrimaryButton onClick={onBack}>OK</PrimaryButton>
      </Card>
    );
  }

  if (!match) {
    return (
      <Card>
        <p>This match is no longer active.</p>
        <PrimaryButton onClick={onBack}>Back</PrimaryButton>
      </Card>
    );
  }

  if (connecting) {
    return (
      <Card>
        <BackButton onClick={onBack} />
        <H2>Waiting for both cards to flip…</H2>
        <p style={{ color: tokens.muted }}>
          The reveal happens the moment both sides say yes. Neither of you sees the other until then.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <BackButton onClick={onBack} />
        <H2>Someone, a few hops away</H2>
        <p style={{ color: tokens.muted }}>Score: {match.reply.scoreBucket}</p>
      </Card>
      <TrustCard>
        <p style={{ margin: 0 }}>
          A vouched member of this community — identity sealed. Their endorsements will be checked
          the moment names unlock.
        </p>
      </TrustCard>
      <Card>
        <p>They will share: <strong>name, vouches</strong></p>
        <p>You will share: <strong>name, vouches</strong></p>
      </Card>
      <PrimaryButton
        onClick={async () => {
          setConnecting(true);
          await client.connectToMatch(match);
        }}
      >
        Connect
      </PrimaryButton>
      <QuietButton
        onClick={async () => {
          await client.passOnMatch(match);
          setPassed(true);
        }}
      >
        Pass
      </QuietButton>
      <p style={{ color: tokens.muted, fontSize: 12, marginTop: 8 }}>
        Passing is invisible. The protocol has no "no" — silence is indistinguishable from an ask
        that faded.
      </p>
    </>
  );
}

function RevealCard({
  revealed,
  onDone,
}: {
  revealed: { matchId: string; identity: import('@weft/core').IdentityPayload; openedAt: number };
  onDone: () => void;
}): JSX.Element {
  return (
    <>
      <TrustCard>
        <p style={{ color: tokens.muted, fontSize: 13, margin: 0 }}>
          Both of you said yes, so both cards flipped at once — and the endorsements checked out
          against their real identity.
        </p>
      </TrustCard>
      <Card style={{ borderColor: tokens.amber, background: tokens.amberSoft }}>
        <H1>{revealed.identity.displayName}</H1>
        <p style={{ color: tokens.muted, fontSize: 12 }}>
          {revealed.identity.pubkey.slice(0, 16)}…
        </p>
        {revealed.identity.vouches.length > 0 ? (
          <>
            <Eyebrow>Vouched by</Eyebrow>
            {revealed.identity.vouches.map((v) => (
              <p key={v.id} style={{ fontSize: 13 }}>
                • {v.pubkey.slice(0, 12)}…
              </p>
            ))}
          </>
        ) : (
          <p style={{ color: tokens.muted, fontSize: 13 }}>No vouches attached (early-network state)</p>
        )}
      </Card>
      <PrimaryButton onClick={onDone}>Say hello</PrimaryButton>
    </>
  );
}

// ---------------------------------------------------------------------------
// ChatScreen
// ---------------------------------------------------------------------------

function ChatScreen({ peerPubkey, onBack }: { peerPubkey: string; onBack: () => void }): JSX.Element {
  const { client, state } = useWeft();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  if (!state || !client) return <p style={{ color: tokens.muted }}>Connecting to relays…</p>;

  const convo = state.conversations.find((c) => c.peerPubkey === peerPubkey);
  if (!convo) return <p>Conversation not found</p>;

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await client.sendMessage(peerPubkey, text);
      setDraft('');
    } catch (e) {
      setSendError((e as Error).message ?? 'send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <BackButton onClick={onBack} />
      <H2>{convo.peerName}</H2>
      <div style={{ marginBottom: 12, minHeight: 200 }}>
        {convo.messages.length === 0 && (
          <p style={{ color: tokens.muted, fontSize: 13 }}>Say hello.</p>
        )}
        {convo.messages.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              background: m.from === 'me' ? tokens.accentSoft : tokens.card,
              border: `1px solid ${tokens.line}`,
              borderRadius: tokens.buttonRadius,
              maxWidth: '80%',
              marginLeft: m.from === 'me' ? 'auto' : 0,
              marginRight: m.from === 'them' ? 'auto' : 0,
            }}
          >
            {m.text}
          </div>
        ))}
      </div>
      <TextInput
        placeholder="Message…"
        value={draft}
        onChange={setDraft}
        onSubmit={() => void send()}
      />
      <PrimaryButton disabled={draft.trim().length === 0 || sending} onClick={() => void send()}>
        {sending ? 'Sending…' : 'Send'}
      </PrimaryButton>
      {sendError && (
        <p style={{ color: tokens.danger, fontSize: 13, marginTop: 8 }}>
          Couldn't send: {sendError}. The message wasn't delivered — try again.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// InviteScreen
// ---------------------------------------------------------------------------

function InviteScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const { client, state } = useWeft();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [openInvite, setOpenInvite] = useState<{ name: string; url: string } | null>(null);

  if (!state || !client) return <p style={{ color: tokens.muted }}>Connecting to relays…</p>;

  const create = async (): Promise<void> => {
    if (name.trim().length === 0 || creating) return;
    setCreating(true);
    const trimmedName = name.trim();
    const result = await client.createInvite({ sentTo: trimmedName, tier: 3, ctx: 'personal' });
    setOpenInvite({ name: trimmedName, url: result.url });
    setName('');
    setCreating(false);
  };

  return (
    <>
      <BackButton onClick={onBack} />
      <Card>
        <H2>Invite &amp; vouch</H2>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          Bringing someone in means standing behind them. Your address book never leaves this phone —
          you send the invite yourself, through whatever channel you already use with your friend.
        </p>
      </Card>

      <Card>
        <H2>Create a new invite</H2>
        <p style={{ color: tokens.muted, fontSize: 13, marginTop: 0 }}>
          Who are you inviting? The name is just a local label so you can recognize the invite in
          your list — your friend won't see it.
        </p>
        <TextInput
          placeholder="e.g. Bob"
          value={name}
          onChange={setName}
          onSubmit={() => void create()}
        />
        <PrimaryButton disabled={name.trim().length === 0 || creating} onClick={() => void create()}>
          {creating ? 'Creating…' : 'Create invite'}
        </PrimaryButton>
      </Card>

      {openInvite && <SharePanel invite={openInvite} onClose={() => setOpenInvite(null)} />}

      <div style={{ marginTop: 24 }}>
        <Eyebrow>Invites out</Eyebrow>
        {state.invites.length === 0 && (
          <p style={{ color: tokens.muted, fontSize: 13 }}>None yet.</p>
        )}
        {state.invites.map((i) => {
          const canReopen = i.status === 'sent' || i.status === 'awaitingConfirm';
          const reopen = (): void => {
            const url = `${window.location.origin}${window.location.pathname}#/i/${i.tokenStr}`;
            setOpenInvite({ name: i.sentTo, url });
          };
          const body = (
            <>
              <p style={{ margin: 0 }}>
                <strong>{i.sentTo}</strong>
              </p>
              <p style={{ color: tokens.muted, fontSize: 12 }}>
                {i.status === 'sent' && 'Sent — waiting for them to open it · tap to show link again'}
                {i.status === 'awaitingConfirm' && 'They opened the invite — see your Home for the confirmation card'}
                {i.status === 'confirmed' && 'Confirmed — vouched'}
                {i.status === 'voided' && 'Voided'}
              </p>
            </>
          );
          return canReopen ? (
            <QuietCard key={i.iid} onClick={reopen}>{body}</QuietCard>
          ) : (
            <Card key={i.iid}>{body}</Card>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SharePanel — the "how to actually send it to your friend" UI.
// ---------------------------------------------------------------------------

function SharePanel({
  invite,
  onClose,
}: {
  invite: { name: string; url: string };
  onClose: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<'link' | 'qr'>('link');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'qr') return;
    let cancelled = false;
    void (async () => {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(invite.url, {
        width: 320,
        margin: 2,
        color: { dark: '#21302B', light: '#FBFBF7' },
      });
      if (!cancelled) setQrDataUrl(dataUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, invite.url]);

  const shareApiAvailable =
    typeof navigator !== 'undefined' && typeof (navigator as Navigator).share === 'function';

  const copy = (): void => {
    void navigator.clipboard.writeText(invite.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const nativeShare = (): void => {
    void (navigator as Navigator).share({
      title: `Weft invite for ${invite.name}`,
      text: `Here's your Weft invite. Open this link on your phone to join:`,
      url: invite.url,
    });
  };

  return (
    <TrustCard>
      <H2>Send this to {invite.name}</H2>
      <p style={{ color: tokens.muted, fontSize: 13, marginTop: 0 }}>
        Any channel works — Signal, iMessage, email, in-person. The link IS the invite; there's
        nothing else to send. Weft's servers never see the token because it rides after the <code>#</code>.
      </p>

      {/* Mode picker */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <ModeButton active={mode === 'link'} onClick={() => setMode('link')}>
          Link
        </ModeButton>
        <ModeButton active={mode === 'qr'} onClick={() => setMode('qr')}>
          QR
        </ModeButton>
      </div>

      {mode === 'link' && (
        <>
          <textarea
            readOnly
            value={invite.url}
            style={{
              width: '100%',
              padding: 12,
              fontSize: 12,
              border: `1px solid ${tokens.line}`,
              borderRadius: tokens.buttonRadius,
              marginBottom: 8,
              fontFamily: 'monospace',
              minHeight: 80,
              boxSizing: 'border-box',
              background: tokens.card,
            }}
            onFocus={(e) => e.target.select()}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <QuietButton onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</QuietButton>
            {shareApiAvailable && <QuietButton onClick={nativeShare}>Share via…</QuietButton>}
          </div>
        </>
      )}

      {mode === 'qr' && (
        <>
          {qrDataUrl ? (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <img
                src={qrDataUrl}
                alt="Invite QR code"
                style={{
                  width: '100%',
                  maxWidth: 280,
                  border: `1px solid ${tokens.line}`,
                  borderRadius: tokens.buttonRadius,
                  background: tokens.card,
                }}
              />
            </div>
          ) : (
            <p style={{ color: tokens.muted, fontSize: 13 }}>Generating QR…</p>
          )}
          <p style={{ color: tokens.muted, fontSize: 12 }}>
            Have your friend point their phone camera at this QR. Any camera app can open the link;
            no app install needed.
          </p>
        </>
      )}

      <hr style={{ border: 'none', borderTop: `1px solid ${tokens.line}`, margin: '16px 0' }} />
      <p style={{ color: tokens.muted, fontSize: 12, marginBottom: 4 }}>
        <strong>What happens next:</strong> when {invite.name} opens the link, a confirmation card
        appears on <em>your</em> Home asking "Is this really your {invite.name}?" — until you tap
        yes, no vouch is finalized. That step is the defense against someone forwarding your invite
        to a stranger.
      </p>
      <div style={{ marginTop: 12 }}>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.muted,
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'inherit',
          }}
        >
          Close
        </button>
      </div>
    </TrustCard>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        background: active ? tokens.accent : 'transparent',
        color: active ? 'white' : tokens.accent,
        border: `1.5px solid ${tokens.accent}`,
        borderRadius: tokens.chipRadius,
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function InterestsCard(): JSX.Element {
  const { client, state } = useWeft();
  const [text, setText] = useState('');
  if (!client || !state) return <></>;

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    if (state.interests.includes(t)) {
      setText('');
      return;
    }
    void client.declareInterest(t);
    setText('');
  };

  return (
    <div style={{ marginTop: 24 }}>
      <Eyebrow>What you're into</Eyebrow>
      <Card>
        <p style={{ color: tokens.muted, fontSize: 13, marginTop: 0, marginBottom: 12 }}>
          Tell your device what you'd want to be found for. These stay on this phone; they're what
          your matcher checks against incoming asks.
        </p>
        <TextInput
          placeholder="e.g. koji fermentation"
          value={text}
          onChange={setText}
          onSubmit={submit}
        />
        <QuietButton onClick={submit}>Add</QuietButton>
        {state.interests.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {state.interests.map((i, idx) => (
              <span
                key={`${idx}-${i}`}
                style={{
                  display: 'inline-block',
                  padding: '4px 12px',
                  border: `1.5px solid ${tokens.accent}`,
                  color: tokens.accent,
                  borderRadius: tokens.chipRadius,
                  marginRight: 8,
                  marginBottom: 6,
                  fontSize: 13,
                  background: tokens.accentSoft,
                }}
              >
                {i}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ConfirmationCard({
  pending,
}: {
  pending: { iid: string; redeemerName: string; redeemerPubkey: string };
}): JSX.Element {
  const { client, state } = useWeft();
  const [working, setWorking] = useState<'confirming' | 'voiding' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!client || !state) return <></>;
  const inviteRow = state.invites.find((i) => i.iid === pending.iid);
  const originalName = inviteRow?.sentTo ?? 'someone';

  const decide = async (yes: boolean): Promise<void> => {
    if (working) return;
    setWorking(yes ? 'confirming' : 'voiding');
    setError(null);
    try {
      await client.confirmInvite(pending.iid, yes);
    } catch (e) {
      setError((e as Error).message ?? 'action failed');
    } finally {
      setWorking(null);
    }
  };

  return (
    <TrustCard>
      <H2>Someone joined with your invite to {originalName}.</H2>
      <p>
        Their name reads "<strong>{pending.redeemerName}</strong>". Is this your {originalName}?
      </p>
      <p style={{ color: tokens.muted, fontSize: 12 }}>
        Links travel like postcards, so your vouch waits for your word.
      </p>
      <PrimaryButton disabled={!!working} onClick={() => void decide(true)}>
        {working === 'confirming' ? 'Confirming…' : `Yes, that's my ${originalName}`}
      </PrimaryButton>
      <QuietButton onClick={() => void decide(false)}>
        {working === 'voiding' ? 'Voiding…' : "That's not them"}
      </QuietButton>
      {error && (
        <p style={{ color: tokens.danger, fontSize: 13, marginTop: 8 }}>
          Couldn't reach the relays: {error}. Try again in a moment.
        </p>
      )}
    </TrustCard>
  );
}

// ---------------------------------------------------------------------------
// WhyItWorks
// ---------------------------------------------------------------------------

function WhyItWorks({ onBack }: { onBack: () => void }): JSX.Element {
  const { state } = useWeft();
  if (!state) return <p style={{ color: tokens.muted }}>Connecting to relays…</p>;
  return (
    <>
      <BackButton onClick={onBack} />
      <Card>
        <H2>Why it works this way</H2>
        <p>Weft is a channel, not a place. Ask, don't broadcast. Silence is a valid answer.</p>
        <p>
          Every ask travels friend to friend, shedding your name at the first step. Nobody meets
          before both say yes. Trust reads as sentences, not scores. Forgetting is the default.
        </p>
      </Card>
      <Card>
        <H2>What leaves this phone</H2>
        <ul style={{ fontSize: 14, color: tokens.muted, paddingLeft: 20 }}>
          <li>asks sent: {state.counters.asksSent}</li>
          <li>asks matched: {state.counters.asksMatched}</li>
          <li>handshakes completed: {state.counters.handshakesCompleted}</li>
          <li>forwards relayed: {state.counters.forwardsRelayed}</li>
          <li>dead queries: {state.counters.deadQueries}</li>
        </ul>
        <p style={{ fontSize: 13, color: tokens.muted }}>
          These numbers never leave this phone. No topics, no names, no places, no map of who knows
          whom.
        </p>
      </Card>
      <StartOverSection />
    </>
  );
}

// ---------------------------------------------------------------------------
// StartOverSection — destructive; two-step confirm before wiping.
// ---------------------------------------------------------------------------

function StartOverSection(): JSX.Element {
  const { reset, identity } = useWeft();
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  if (wiping) {
    return (
      <Card>
        <p style={{ margin: 0, color: tokens.muted }}>Wiping…</p>
      </Card>
    );
  }

  if (!confirming) {
    return (
      <Card>
        <H2>Start over</H2>
        <p style={{ color: tokens.muted, fontSize: 14 }}>
          Wipes this device's identity, contacts, invites, messages, and interests. Your friends
          keep their copies of the vouches you sent them, but they'll see you as a stranger until
          you invite each other fresh.
        </p>
        <QuietButton onClick={() => setConfirming(true)}>Start over…</QuietButton>
      </Card>
    );
  }

  return (
    <DangerCard>
      <H2>Wipe everything on this device?</H2>
      <p>
        This deletes:
      </p>
      <ul style={{ fontSize: 14, paddingLeft: 20 }}>
        <li>Your identity ({identity?.displayName ?? 'unknown'})</li>
        <li>Every contact and vouch you've received</li>
        <li>Every invite you've sent</li>
        <li>Every message in every conversation</li>
        <li>Every declared interest</li>
      </ul>
      <p style={{ color: tokens.muted, fontSize: 13 }}>
        This is not recoverable — Weft has no server-side backup. Only proceed if you meant to.
      </p>
      <button
        onClick={async () => {
          setWiping(true);
          await reset();
          // Reload for a clean slate — the URL becomes the About page after
          // the identity is gone (Shell default without identity is Landing).
          window.location.hash = '#about';
          window.location.reload();
        }}
        style={{
          width: '100%',
          padding: 14,
          background: tokens.danger,
          color: 'white',
          border: 'none',
          borderRadius: tokens.buttonRadius,
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: 12,
          fontFamily: 'inherit',
        }}
      >
        Yes, wipe everything
      </button>
      <QuietButton onClick={() => setConfirming(false)}>Cancel</QuietButton>
    </DangerCard>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginBottom: 15,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TrustCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: tokens.amberSoft,
        border: `1.5px solid ${tokens.amber}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginBottom: 15,
      }}
    >
      {children}
    </div>
  );
}

function DangerCard({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: tokens.dangerSoft,
        border: `1.5px solid ${tokens.danger}`,
        borderRadius: tokens.cardRadius,
        padding: 15,
        marginBottom: 15,
      }}
    >
      {children}
    </div>
  );
}

function QuietCard({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        background: tokens.accentSoft,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.cardRadius,
        padding: 12,
        marginBottom: 10,
        cursor: onClick ? 'pointer' : 'default',
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

function Eyebrow({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p
      style={{
        color: tokens.muted,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        margin: '0 0 8px',
      }}
    >
      {children}
    </p>
  );
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
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function QuietButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: 12,
        background: tokens.accentSoft,
        color: tokens.accent,
        border: 'none',
        borderRadius: tokens.buttonRadius,
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        marginTop: 8,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
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
        fontFamily: 'inherit',
      }}
    >
      ← Back
    </button>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}): JSX.Element {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (onSubmit && e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        }
      }}
      style={{
        width: '100%',
        padding: 12,
        fontSize: 16,
        border: `1px solid ${tokens.line}`,
        borderRadius: tokens.buttonRadius,
        marginBottom: 8,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Silence: bytesToHex referenced but not needed here in current use.
void bytesToHex;
