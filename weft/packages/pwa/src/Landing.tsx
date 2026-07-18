// Landing — the marketing / explanatory page shown to first-time visitors
// who haven't onboarded. Long scrolling, no JS beyond the CTA buttons.
//
// Content is drawn from weft-manifesto.md and weft-overview.md, distilled
// for a landing surface. The framing is deliberately contrast-heavy: names
// the pattern (attention/data monetization) and the platforms that embody
// it. Not mean-spirited; accurate.

import { useState } from 'react';
import { tokens } from './styles';

interface LandingProps {
  onStart: () => void;
  onRedeem: (token: string) => void;
  /** True when the user already has an identity — CTAs say "Back to Weft". */
  alreadyOnboarded?: boolean | undefined;
  /** If provided, TopBar shows a "Back to Weft →" button. */
  onGoHome?: (() => void) | undefined;
}

export function Landing({ onStart, onRedeem, alreadyOnboarded, onGoHome }: LandingProps): JSX.Element {
  return (
    <div style={{ background: tokens.paper, minHeight: '100vh', color: tokens.ink, fontFamily: tokens.sans }}>
      <TopBar onGoHome={onGoHome} />
      <Hero onStart={onStart} onRedeem={onRedeem} alreadyOnboarded={alreadyOnboarded} />
      <TheProblem />
      <WhatWeftIs />
      <HowItWorks />
      <ComparisonTable />
      <WhatItDoesnt />
      <HowItStaysFree />
      <Invariants />
      <FinalCTA onStart={onStart} alreadyOnboarded={alreadyOnboarded} />
      <TheName />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function TopBar({ onGoHome }: { onGoHome?: (() => void) | undefined }): JSX.Element {
  return (
    <div
      style={{
        borderBottom: `1px solid ${tokens.line}`,
        padding: '12px 0',
      }}
    >
      <Wide>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: tokens.serif, fontSize: 22, fontWeight: 400 }}>Weft</span>
          <nav style={{ display: 'flex', gap: 20, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
            <NavLink href="#what">What it is</NavLink>
            <NavLink href="#how">How it works</NavLink>
            <NavLink href="#free">Free forever</NavLink>
            <NavLink href="https://github.com/rlSutter/Weft" external>
              GitHub ↗
            </NavLink>
            {onGoHome && (
              <button
                onClick={onGoHome}
                style={{
                  padding: '6px 14px',
                  background: tokens.accent,
                  color: 'white',
                  border: 'none',
                  borderRadius: tokens.buttonRadius,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Back to Weft →
              </button>
            )}
          </nav>
        </div>
      </Wide>
    </div>
  );
}

function NavLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}): JSX.Element {
  // Intercept in-page anchor links (#what, #how, #free, etc.) so they
  // scroll to the section without touching window.location.hash — which
  // would otherwise switch the app's route (unknown hashes default to
  // 'home', which routes back to Onboarding / Home depending on state).
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    if (external) return;
    if (!href.startsWith('#')) return;
    const id = href.slice(1);
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      style={{ color: tokens.muted, textDecoration: 'none' }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function Hero({ onStart, onRedeem, alreadyOnboarded }: LandingProps): JSX.Element {
  const [tokenText, setTokenText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleRedeem = (): void => {
    const t = tokenText.trim();
    if (!t) return;
    // Accept either a full URL like https://.../#/i/<token> or the bare token.
    let token = t;
    const hashIdx = t.indexOf('#/i/');
    if (hashIdx >= 0) token = t.slice(hashIdx + 4);
    else if (t.startsWith('weft:i:')) token = t.slice(7);
    if (token.length < 20) {
      setError("That doesn't look like a Weft invite. Paste the full link your friend sent.");
      return;
    }
    onRedeem(token);
  };

  return (
    <div style={{ padding: '80px 0 60px', background: tokens.paper }}>
      <Wide>
        <h1
          style={{
            fontFamily: tokens.serif,
            fontSize: 52,
            lineHeight: 1.1,
            margin: '0 0 24px',
            fontWeight: 400,
          }}
        >
          A post-platform communications channel.
        </h1>
        <p style={{ fontSize: 20, lineHeight: 1.5, color: tokens.ink, marginBottom: 12, maxWidth: 620 }}>
          Weft is a way to find your people without a social media platform standing in the middle.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: tokens.muted, maxWidth: 620 }}>
          You say what you're looking for. Your ask travels friend to friend through your real
          social network, like asking around at a dinner table — without your name attached. When
          it finds someone who fits, you're each shown what the other <em>is</em>, never who, until
          you both say yes.
        </p>
        <div style={{ marginTop: 32, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <BigButton onClick={onStart} primary>
            {alreadyOnboarded ? 'Back to Weft' : 'Try Weft'}
          </BigButton>
          <BigButton onClick={() => document.getElementById('what')?.scrollIntoView({ behavior: 'smooth' })}>
            Read more first
          </BigButton>
        </div>

        <div style={{ marginTop: 40, maxWidth: 620 }}>
          <p style={{ fontSize: 13, color: tokens.muted, marginBottom: 8 }}>
            <strong>{alreadyOnboarded ? 'Have another invite?' : 'Already got an invite?'}</strong> Paste the link:
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              type="text"
              value={tokenText}
              onChange={(e) => {
                setTokenText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRedeem();
              }}
              placeholder="https://…/#/i/qQAB…"
              style={{
                flex: 1,
                padding: 12,
                fontSize: 14,
                border: `1px solid ${tokens.line}`,
                borderRadius: tokens.buttonRadius,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                background: tokens.card,
              }}
            />
            <button
              onClick={handleRedeem}
              style={{
                padding: '0 20px',
                background: tokens.accent,
                color: 'white',
                border: 'none',
                borderRadius: tokens.buttonRadius,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Open
            </button>
          </div>
          {error && <p style={{ color: tokens.danger, fontSize: 13, marginTop: 6 }}>{error}</p>}
        </div>
      </Wide>
    </div>
  );
}

function TheProblem(): JSX.Element {
  return (
    <Section>
      <SectionTitle>Somewhere along the way, connecting people became a business.</SectionTitle>
      <Prose>
        <p>
          Facebook and Instagram harvest your relationships as fuel for an ad auction. X and
          TikTok compete for your attention against everything else in your life. Reddit ranks your
          conversations by what keeps you scrolling. Nextdoor sells your neighborhood's anxieties.
        </p>
        <p>
          Even the well-meaning alternatives — Mastodon, Bluesky, Nostr — mostly just decentralize{' '}
          <em>publishing</em>: they're still feeds, still built around broadcasting to an audience,
          still counting followers.
        </p>
        <p>
          None of them help you find someone real to talk to. That is not the shape of the
          problem their business model wants to solve.
        </p>
      </Prose>
    </Section>
  );
}

function WhatWeftIs(): JSX.Element {
  return (
    <Section id="what" alt>
      <SectionTitle>Weft is a channel, not a place.</SectionTitle>
      <Prose>
        <p>
          There is nothing to visit, nothing to scroll, nothing that wants you back. It is a way of
          asking, the way email is a way of writing.
        </p>
        <p>
          You say what you're looking for — <em>"I want to find people experimenting with koji,"</em>{' '}
          <em>"I'd love a small group that runs slow on Sunday mornings,"</em>{' '}
          <em>"I'm trying to learn banjo and I need patient humans."</em> Your ask travels quietly
          from friend to friend to friend, the way a question travels when you ask someone at a
          dinner table and they say <em>"oh, you should talk to my cousin."</em>
        </p>
        <p>
          When it finds someone who fits, you're each shown what the other <em>is</em> — a small
          group, a fellow beginner — but not who they are. If you both say yes, names unlock at the
          same moment, along with the chain of real people who vouch for each of you.
        </p>
        <p>Then you just… talk.</p>
      </Prose>
    </Section>
  );
}

function HowItWorks(): JSX.Element {
  return (
    <Section id="how">
      <SectionTitle>How it works, in five steps.</SectionTitle>
      <NumberedList>
        <NumberedItem n={1} title="You ask, out loud.">
          Speaking is the intended input — voice on your device, no words sent to any server. Text
          works too, always.
        </NumberedItem>
        <NumberedItem n={2} title="The ask travels your real graph.">
          Friend to friend to friend, up to a few hops. Each hop drops your name before passing it
          on. Nobody who receives it can tell whether it started with the person who handed it to
          them or with someone three houses over.
        </NumberedItem>
        <NumberedItem n={3} title="It finds people who match.">
          Their device decides — semantically — if they're a fit. If yes, they reply masked. If no,
          the ask keeps moving.
        </NumberedItem>
        <NumberedItem n={4} title="Nobody meets before both say yes.">
          Identities unlock simultaneously or not at all. Declining sends <em>nothing</em> — the
          protocol contains no word for "no", so rejection can never be turned into a weapon.
        </NumberedItem>
        <NumberedItem n={5} title="You talk.">
          End-to-end encrypted, on your terms. Weft's job ends when you find your people.
        </NumberedItem>
      </NumberedList>
    </Section>
  );
}

function ComparisonTable(): JSX.Element {
  const rows: Array<[string, string, string, string]> = [
    ['What it\'s for', 'Broadcasting / keeping a profile', 'Topic communities', 'Finding people you don\'t know yet, through people you do'],
    ['Who decides what you see', 'An engagement algorithm', 'Mods + votes + algorithm', 'Nobody — there\'s nothing to see but your own asks and answers'],
    ['How you find new people', 'Suggestions, ads, virality', 'Join big rooms, hope', 'Ask out loud; the answer travels your real social graph'],
    ['Who holds your data', 'The company', 'The company', 'Your device; the network sees sealed envelopes that expire'],
    ['Business model', 'Ads (you\'re the product)', 'Ads / subscriptions', 'None: communities run their own $5 mailboxes'],
    ['Trust & identity', 'Blue checks, follower counts', 'Karma scores', 'Real people vouching for real people, readable as sentences'],
    ['Its measure of success', 'Your time on feed', 'Your time in threads', 'You found your people, and closed the app'],
  ];
  return (
    <Section alt>
      <SectionTitle>How it compares.</SectionTitle>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            marginTop: 12,
            minWidth: 700,
          }}
        >
          <thead>
            <tr>
              <th style={thStyle()}></th>
              <th style={thStyle()}>Facebook / X / TikTok</th>
              <th style={thStyle()}>Reddit / Discord</th>
              <th style={thStyle({ highlight: true })}>Weft</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b, c], idx) => (
              <tr key={idx}>
                <td style={tdStyle({ bold: true })}>{label}</td>
                <td style={tdStyle()}>{a}</td>
                <td style={tdStyle()}>{b}</td>
                <td style={tdStyle({ highlight: true })}>{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: tokens.muted, marginTop: 24, maxWidth: 620 }}>
        The closest cousins deserve a fair word. <strong>Mastodon</strong> and{' '}
        <strong>Bluesky</strong> decentralize <em>publishing</em> — they're better Twitters, and
        genuinely so. But they keep the feed, the follower counts, and the broadcast model. Weft
        decentralizes <em>introduction</em> instead. <strong>Signal</strong> perfected private
        conversation between people who already know each other; Weft is for the step before that —
        becoming people who know each other — and happily hands the conversation off once you've
        met.
      </p>
    </Section>
  );
}

function WhatItDoesnt(): JSX.Element {
  return (
    <Section>
      <SectionTitle>What Weft doesn't do.</SectionTitle>
      <Prose>
        <BulletList>
          <li>
            <strong>No feed.</strong> There is nothing to scroll. Ever. When nothing's happening,
            the app is quiet.
          </li>
          <li>
            <strong>No broadcasting.</strong> No followers, no likes, no view counts. Weft is not
            for building an audience, going viral, or becoming an influencer.
          </li>
          <li>
            <strong>No algorithmic discovery.</strong> Weft doesn't know what you like. It knows
            what you <em>asked</em> — because you said so, on purpose.
          </li>
          <li>
            <strong>Not instant.</strong> Answers arrive as friends' phones come online — usually
            within a day or two. Finding the right person isn't a same-second problem, and Weft
            doesn't pretend it is.
          </li>
          <li>
            <strong>No central police.</strong> Communities set and enforce their own rules.
            Serious crimes remain matters for actual law enforcement. This is a genuine tradeoff,
            chosen openly: the same design that means no one can read your messages means no one
            can scan everyone's messages.
          </li>
          <li>
            <strong>No rescue from an empty room.</strong> Weft works in proportion to your
            community using it. Bring it to a group you're already part of, not to a stranger.
          </li>
        </BulletList>
      </Prose>
    </Section>
  );
}

function HowItStaysFree(): JSX.Element {
  return (
    <Section id="free" alt>
      <SectionTitle>How this stays free.</SectionTitle>
      <Prose>
        <p>
          Nothing about Weft has a business model. Not "not yet" — architecturally impossible.
        </p>
        <BulletList>
          <li>
            <strong>No ads, ever.</strong> The servers involved are dumb encrypted mailboxes that
            cannot read anything. There is nothing to sell. This isn't a policy promise — it's
            math. Promises can be broken; math has to be broken.
          </li>
          <li>
            <strong>No subscriptions.</strong> The software is free and open-source (
            <a href="https://github.com/rlSutter/Weft" style={{ color: tokens.accent }}>
              GitHub ↗
            </a>
            ). Every part is auditable.
          </li>
          <li>
            <strong>No engagement metrics driving anything.</strong> Weft's only measure of success
            is whether you found your people — not how long you stared at the screen. The app is
            designed to be comfortable closed.
          </li>
          <li>
            <strong>No company.</strong> There is no corporation behind Weft. There is this code,
            these ideas, and communities that choose to use them.
          </li>
        </BulletList>
        <div
          style={{
            marginTop: 24,
            padding: 20,
            background: tokens.card,
            border: `1px solid ${tokens.line}`,
            borderRadius: tokens.cardRadius,
          }}
        >
          <p style={{ fontSize: 14, marginTop: 0 }}>
            <strong>The economics, plainly:</strong> a Weft relay for a community of thousands runs
            on a $5–$10/month VPS. Communities fund their own relay the same way they fund a
            mailing list or a meeting space — dues, patronage, or a member's spare capacity.
            Anyone can run one. Running one is a gesture, not a business.
          </p>
        </div>
      </Prose>
    </Section>
  );
}

function Invariants(): JSX.Element {
  return (
    <Section>
      <SectionTitle>The five invariants we test every change against.</SectionTitle>
      <Prose>
        <p>
          Weft's design is disciplined by five properties. Anything we add must pass all of them,
          or it doesn't go in.
        </p>
      </Prose>
      <NumberedList>
        <NumberedItem n={1} title="Encryption is layered by lifetime.">
          Permanent identity keys, durable pairwise channels, ephemeral handshake keys — each
          class stored, wrapped, and expired according to how long it lives.
        </NumberedItem>
        <NumberedItem n={2} title="Persistence is inversely proportional to sensitivity.">
          Vouches are held privately by their subject. Handshakes evaporate in hours. Relays hold
          only sealed, expiring envelopes. Seize every server and you find ciphertext and empty
          shelves.
        </NumberedItem>
        <NumberedItem n={3} title="Scaling is edge-bounded by construction.">
          Per-query work is fixed by fan-out × hops, independent of network size. A bigger network
          just means more people to reach — never more cost per ask.
        </NumberedItem>
        <NumberedItem n={4} title="Attribute nothing by default.">
          Identity enters only where a human chooses to reveal it. Nothing your device sends
          carries your name unless you decided it should.
        </NumberedItem>
        <NumberedItem n={5} title="Plurality is bounded, accountability is scoped.">
          You can be several selves; nobody can be unlimited selves; every self answers, within
          each community it enters, permanently.
        </NumberedItem>
      </NumberedList>
    </Section>
  );
}

function FinalCTA({ onStart, alreadyOnboarded }: { onStart: () => void; alreadyOnboarded?: boolean | undefined }): JSX.Element {
  return (
    <Section alt>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <h2
          style={{
            fontFamily: tokens.serif,
            fontSize: 32,
            margin: '0 0 16px',
            fontWeight: 400,
          }}
        >
          Ready?
        </h2>
        <p style={{ color: tokens.muted, fontSize: 15, marginBottom: 28, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto' }}>
          Weft works best when brought to a community you're already part of. Try it, invite a
          handful of friends, and see who your network already contains.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <BigButton onClick={onStart} primary>
            {alreadyOnboarded ? 'Back to Weft' : 'Try Weft'}
          </BigButton>
          <BigButton
            onClick={() => window.open('https://github.com/rlSutter/Weft', '_blank', 'noreferrer')}
          >
            Read the design
          </BigButton>
        </div>
      </div>
    </Section>
  );
}

function TheName(): JSX.Element {
  return (
    <Section>
      <SectionTitle>On the name.</SectionTitle>
      <Prose>
        <p>
          In weaving, the <em>warp</em> threads are the fixed structure, and the <em>weft</em> is
          the thread that travels — carried hand to hand by the shuttle, across the warp, over and
          under, binding separate strands into cloth. Relationships are the warp; asks are the
          weft. The name keeps the heritage of "social fabric" while naming the motion instead of
          the venue: the traveling thread, not the finished sheet.
        </p>
        <p
          style={{
            fontFamily: tokens.serif,
            fontSize: 22,
            fontStyle: 'italic',
            color: tokens.accent,
            marginTop: 24,
          }}
        >
          The warp is already there. Come be the thread.
        </p>
      </Prose>
    </Section>
  );
}

function Footer(): JSX.Element {
  return (
    <div style={{ borderTop: `1px solid ${tokens.line}`, padding: '32px 0', marginTop: 40 }}>
      <Wide>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, fontSize: 13, color: tokens.muted }}>
          <div>
            <p style={{ margin: '0 0 4px', color: tokens.ink, fontWeight: 700 }}>Weft</p>
            <p style={{ margin: 0 }}>A post-platform communications channel.</p>
          </div>
          <div>
            <p style={{ margin: '0 0 4px', color: tokens.ink, fontWeight: 700 }}>Source</p>
            <a
              href="https://github.com/rlSutter/Weft"
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: tokens.muted }}
            >
              github.com/rlSutter/Weft
            </a>
          </div>
          <div>
            <p style={{ margin: '0 0 4px', color: tokens.ink, fontWeight: 700 }}>License</p>
            <p style={{ margin: 0 }}>Apache-2.0 (protocol) · AGPL-3.0 (reference client)</p>
          </div>
        </div>
      </Wide>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable pieces
// ---------------------------------------------------------------------------

function Wide({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px' }}>{children}</div>;
}

function Section({
  children,
  alt,
  id,
}: {
  children: React.ReactNode;
  alt?: boolean;
  id?: string;
}): JSX.Element {
  return (
    <div id={id} style={{ background: alt ? tokens.card : tokens.paper, padding: '60px 0' }}>
      <Wide>{children}</Wide>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2
      style={{
        fontFamily: tokens.serif,
        fontSize: 32,
        lineHeight: 1.2,
        margin: '0 0 24px',
        fontWeight: 400,
        maxWidth: 720,
      }}
    >
      {children}
    </h2>
  );
}

function Prose({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 15, lineHeight: 1.7, color: tokens.ink, maxWidth: 700 }}>{children}</div>
  );
}

function BulletList({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ul style={{ paddingLeft: 20, margin: '12px 0' }}>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <li key={i} style={{ marginBottom: 12 }}>
              {child}
            </li>
          ))
        : children}
    </ul>
  );
}

function NumberedList({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ marginTop: 12 }}>{children}</div>;
}

function NumberedItem({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 20, marginBottom: 24, maxWidth: 720 }}>
      <div
        style={{
          fontFamily: tokens.serif,
          fontSize: 28,
          color: tokens.accent,
          minWidth: 40,
          fontWeight: 400,
        }}
      >
        {n}.
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.6 }}>
        <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{title}</p>
        <p style={{ margin: 0, color: tokens.muted }}>{children}</p>
      </div>
    </div>
  );
}

function BigButton({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '14px 28px',
        background: primary ? tokens.accent : 'transparent',
        color: primary ? 'white' : tokens.accent,
        border: `1.5px solid ${tokens.accent}`,
        borderRadius: tokens.buttonRadius,
        fontSize: 15,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function thStyle(opts: { highlight?: boolean } = {}): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${opts.highlight ? tokens.accent : tokens.line}`,
    background: opts.highlight ? tokens.accentSoft : 'transparent',
    fontWeight: 700,
    fontSize: 12,
    color: opts.highlight ? tokens.accent : tokens.muted,
  };
}

function tdStyle(opts: { highlight?: boolean; bold?: boolean } = {}): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.line}`,
    background: opts.highlight ? tokens.accentSoft : 'transparent',
    color: opts.highlight ? tokens.accent : opts.bold ? tokens.ink : tokens.muted,
    fontWeight: opts.bold || opts.highlight ? 700 : 400,
    fontSize: 13,
    verticalAlign: 'top',
  };
}
