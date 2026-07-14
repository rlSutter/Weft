import { useState, useEffect } from "react";

/* ============================================================
   WEFT — tappable UX mockup v2
   New in v2: travel modes (§17.5), plural personas (§18.5),
   meetup escrow (§24.2), standing asks (§25), steward mode (§29),
   softened trust lines (§17.2), updated philosophy screen.
   Amber is reserved for one thing only: trust (vouches).
   Dashed gray pills are demo controls, not product UI.
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Young+Serif&family=Karla:wght@400;500;700&display=swap');

.sf-root{min-height:100vh; background:#DFE5DC; display:flex; justify-content:center;
  padding:18px 10px 40px; font-family:'Karla',sans-serif;}
.sf-phone{width:100%; max-width:400px; border:1px solid var(--line); border-radius:34px;
  overflow:hidden; box-shadow:0 18px 50px rgba(33,48,43,.12); display:flex; flex-direction:column;
  min-height:780px; position:relative; background:var(--card); color:var(--ink);
  transition:background .4s;}
.sf-phone{--card:#FBFBF7; --ink:#21302B; --muted:#6B7A72; --accent:#2F6B58;
  --accent-soft:#DDE8E1; --amber:#B9812E; --amber-soft:#F3E8D4; --line:#D5DCD4;
  --danger:#9C3D2E;}
.sf-phone.quiet{--card:#F7F4FA; --ink:#2C2433; --muted:#777080; --accent:#5C4676;
  --accent-soft:#E6DFEF; --line:#DCD5E3;}
*{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
.sf-body{flex:1; overflow-y:auto; padding:18px 20px 90px;}
.sf-display{font-family:'Young Serif',serif; font-weight:400;}
h1.sf-display{font-size:25px; margin:0 0 4px; line-height:1.15;}
h2.sf-display{font-size:19px; margin:0 0 6px; line-height:1.25;}
.sf-sub{color:var(--muted); font-size:14px; line-height:1.5; margin:0;}
.sf-eyebrow{font-size:11px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--muted); font-weight:700; margin:24px 0 10px;}
.sf-card{background:#fff; border:1px solid var(--line); border-radius:18px; padding:15px; margin-bottom:12px;}
.sf-phone.quiet .sf-card{background:#FDFCFE;}
.sf-btn{display:block; width:100%; border:none; border-radius:14px; padding:14px;
  font-family:'Karla'; font-size:15.5px; font-weight:700; cursor:pointer;}
.sf-btn.primary{background:var(--accent); color:#fff;}
.sf-btn.quietBtn{background:var(--accent-soft); color:var(--accent);}
.sf-btn.ghost{background:transparent; color:var(--muted); font-weight:500; font-size:14px;}
.sf-btn:active{transform:scale(.985);}
.sf-row{display:flex; align-items:center; gap:12px;}
.sf-chip{border:1.5px solid var(--accent); background:#fff; color:var(--accent);
  border-radius:999px; padding:8px 15px; font-family:'Karla'; font-size:14px;
  font-weight:700; cursor:pointer; margin:0 8px 8px 0;}
.sf-demo{border:1.5px dashed #A8B2AA; background:transparent; color:#7c8781;
  border-radius:999px; padding:5px 11px; font-size:12px; font-family:'Karla';
  cursor:pointer; display:inline-block;}
.sf-seal{display:inline-block; width:11px; height:11px; border-radius:50%;
  background:radial-gradient(circle at 35% 35%, #D9A458, var(--amber)); margin-right:6px;
  box-shadow:0 0 0 2px var(--amber-soft); vertical-align:-1px;}
.sf-trust{background:var(--amber-soft); border:1px solid #E4D3B4; border-radius:12px;
  padding:10px 12px; font-size:13.5px; line-height:1.45; color:#6E4E1D;}
.sf-back{background:none; border:none; color:var(--muted); font-family:'Karla';
  font-size:14px; cursor:pointer; padding:0; margin-bottom:12px;}
.sf-toast{position:absolute; bottom:20px; left:20px; right:20px; background:var(--ink);
  color:#fff; border-radius:14px; padding:12px 16px; font-size:14px; text-align:center; z-index:40;}
.sf-notif{border:1px solid var(--accent); background:var(--accent-soft); border-radius:18px;
  padding:13px 16px; margin-bottom:14px; cursor:pointer;}
.sf-mic{width:92px; height:92px; border-radius:50%; border:none; background:var(--accent);
  color:#fff; font-size:32px; cursor:pointer; position:relative; z-index:2;
  box-shadow:0 8px 24px rgba(47,107,88,.32);}
.sf-mic:active{transform:scale(.95);}
.rippleWrap{position:relative; height:140px; display:flex; align-items:center; justify-content:center;}
.ring{position:absolute; border:1.5px solid var(--accent); border-radius:50%; opacity:0;
  width:92px; height:92px; animation:sfring 3.2s ease-out infinite;}
.ring:nth-child(2){animation-delay:1.05s;} .ring:nth-child(3){animation-delay:2.1s;}
@keyframes sfring{0%{transform:scale(1); opacity:.5;} 100%{transform:scale(3.1); opacity:0;}}
.dot{position:absolute; width:7px; height:7px; border-radius:50%; background:#B9C6BC;}
.dot.lit{animation:sfdot 3.2s ease-out infinite;}
@keyframes sfdot{0%,55%{background:#B9C6BC;} 70%{background:var(--accent); transform:scale(1.5);} 100%{background:#B9C6BC;}}
.flip{perspective:1100px;}
.flipInner{position:relative; transition:transform .8s; transform-style:preserve-3d;}
.flip.revealed .flipInner{transform:rotateY(180deg);}
.face{backface-visibility:hidden;}
.face.backSide{position:absolute; inset:0; transform:rotateY(180deg);}
.mono{font-family:ui-monospace,Menlo,monospace; font-size:11.5px; line-height:1.6;
  background:#21302B; color:#CFE3D8; border-radius:12px; padding:14px; overflow-x:auto; white-space:pre;}
.toggleLine{display:flex; justify-content:space-between; align-items:center; padding:8px 0;
  border-bottom:1px solid var(--line); font-size:14.5px;}
.toggleLine:last-child{border-bottom:none;}
.tog{width:42px; height:24px; border-radius:999px; border:none; cursor:pointer; position:relative;
  background:#C9D2CA; transition:background .2s; flex-shrink:0;}
.tog.on{background:var(--accent);}
.tog::after{content:''; position:absolute; top:3px; left:3px; width:18px; height:18px;
  border-radius:50%; background:#fff; transition:left .2s;}
.tog.on::after{left:21px;}
.radioCard{border:1.5px solid var(--line); border-radius:14px; padding:12px 14px;
  margin-bottom:10px; cursor:pointer; background:#fff;}
.radioCard.sel{border-color:var(--accent); background:var(--accent-soft);}
.radioCard strong{font-size:15px;}
.radioCard .sf-sub{font-size:13px; margin-top:2px;}
.contactRow{display:flex; align-items:center; gap:12px; padding:11px; border:1px solid var(--line);
  border-radius:14px; margin-bottom:10px; cursor:pointer; background:#fff;}
.avatar{width:38px; height:38px; border-radius:50%; background:var(--accent-soft); color:var(--accent);
  display:flex; align-items:center; justify-content:center; font-weight:700; flex-shrink:0; font-size:14px;}
.philP{font-size:14.5px; line-height:1.62; margin:0 0 10px; color:var(--ink);}
.philNever{color:var(--danger); font-weight:700;}
.linklike{background:none; border:none; color:var(--accent); font-family:'Karla'; font-size:14px;
  font-weight:700; cursor:pointer; text-decoration:underline; padding:0;}
.personaPill{display:flex; align-items:center; gap:8px; border:1px solid var(--line);
  background:#fff; border-radius:999px; padding:6px 12px 6px 6px; cursor:pointer;
  font-family:'Karla'; font-size:13.5px; font-weight:700; color:var(--ink); margin-bottom:14px;}
.personaDot{width:22px; height:22px; border-radius:50%; background:var(--accent);}
.modal{position:absolute; inset:0; background:rgba(33,48,43,.45); z-index:50;
  display:flex; align-items:flex-end;}
.sheet{background:var(--card); border-radius:24px 24px 0 0; padding:20px; width:100%;}
.dial{display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line); font-size:14px;}
.dial:last-child{border-bottom:none;}
.dial b.good{color:var(--accent);} .dial b.warn{color:var(--amber);}
@media (prefers-reduced-motion: reduce){
  .ring,.dot.lit{animation:none;} .flipInner{transition:none;} .sf-phone{transition:none;}
}
`;

const DOTS = [
  { top: "12%", left: "16%" }, { top: "8%", left: "62%" }, { top: "22%", left: "84%" },
  { top: "70%", left: "10%" }, { top: "80%", left: "44%" }, { top: "72%", left: "78%" },
  { top: "34%", left: "5%" },  { top: "30%", left: "93%" },
];

const CONTACTS = [
  { n: "Bob Tanaka", d: "mobile · +1 ***-**-4417" },
  { n: "Priya S.", d: "mobile · +1 ***-**-9022" },
  { n: "Dana Okafor", d: "email · d.okafor@…" },
];

const CHIP_QUESTIONS = [
  { q: "Looking to…", opts: ["learn", "swap as peers", "trade materials"] },
  { q: "Location…", opts: ["anywhere", "prefer nearby", "must be local"] },
  { q: "Hoping for…", opts: ["a person or two", "a small group"] },
];

const TRAVEL_MODES = [
  { id: "friends", name: "Through friends", desc: "Fastest. People close to you may see what's asked — never that it's you, but near you." },
  { id: "deniable", name: "Deniably", desc: "Through friends as a coarse whisper — 'food-adjacent'. Specifics stay sealed until a match. Slower." },
  { id: "anon", name: "Anonymously", desc: "To a vouched-members-only square. Nobody, including friends, sees anything." },
];

function Seal() { return <span className="sf-seal" aria-hidden="true" />; }
function Toast({ text }) { return <div className="sf-toast">{text}</div>; }

export default function WeftMockup() {
  const [persona, setPersona] = useState("main"); // 'main' | 'quiet'
  const [personaSheet, setPersonaSheet] = useState(false);
  const [quietExists, setQuietExists] = useState(false);
  const [screen, setScreen] = useState("home");
  const [askStep, setAskStep] = useState("speak");
  const [chipIdx, setChipIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [travel, setTravel] = useState("friends");
  const [neverThrough, setNeverThrough] = useState({ family: false, work: false });
  const [standing, setStanding] = useState(false);
  const [askOut, setAskOut] = useState(null); // null | 'traveling' | 'match'
  const [terms, setTerms] = useState({ name: true, vouches: true, city: false });
  const [revealed, setRevealed] = useState(false);
  const [meetStep, setMeetStep] = useState("none"); // none | planned | checkin | done
  const [convos, setConvos] = useState([{ id: 1, name: "Fermentation Club", last: "Maya: the barley koji is alive!" }]);
  const [inviteStep, setInviteStep] = useState("start");
  const [invitesOut, setInvitesOut] = useState([]);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (s) => setScreen(s);
  const resetAsk = () => { setAskStep("speak"); setChipIdx(0); setAnswers([]); setTravel(persona === "quiet" ? "anon" : "friends"); setStanding(false); };
  const pickChip = (opt) => {
    const next = [...answers, opt];
    setAnswers(next);
    if (chipIdx + 1 < CHIP_QUESTIONS.length) setChipIdx(chipIdx + 1);
    else setAskStep("travel");
  };
  const switchPersona = (p) => { setPersona(p); setPersonaSheet(false); go("home"); setAskOut(null); setRevealed(false); setMeetStep("none"); };

  /* ---------------- home ---------------- */

  const Home = (
    <div>
      <button className="personaPill" onClick={() => setPersonaSheet(true)}>
        <span className="personaDot" />
        {persona === "main" ? "You — main self" : "Quiet self · identity sealed"} ▾
      </button>

      {persona === "quiet" ? (
        <div>
          <h1 className="sf-display">A separate self</h1>
          <p className="sf-sub">This self carries proof that a vouched person stands behind it — without saying who. Asks from here travel anonymously by default and never through your main self's people.</p>
        </div>
      ) : (
        <div>
          <h1 className="sf-display">Ask your people</h1>
          <p className="sf-sub">Hold the button and say what you're looking for. Your ask travels friend to friend — never a feed, never a database.</p>
        </div>
      )}

      <div className="rippleWrap">
        {askOut === "traveling" && (<><div className="ring" /><div className="ring" /><div className="ring" /></>)}
        {DOTS.map((d, i) => (
          <div key={i} className={"dot" + (askOut === "traveling" ? " lit" : "")}
               style={{ top: d.top, left: d.left, animationDelay: (i * 0.35) + "s" }} />
        ))}
        <button className="sf-mic" aria-label="Hold to ask" onClick={() => { resetAsk(); go("ask"); }}>🎙</button>
      </div>

      {askOut === "match" && (
        <div className="sf-notif" onClick={() => { setRevealed(false); go("match"); }}>
          <strong>A match came back.</strong>
          <div className="sf-sub" style={{ marginTop: 4 }}>
            {persona === "quiet" ? "A vouched member of the square fits your ask. Tap to look." : "Someone a couple of hops away fits your koji ask — through people Maya trusts. Tap to look."}
          </div>
        </div>
      )}

      {askOut === "traveling" && (
        <div className="sf-card">
          <div className="sf-row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong style={{ fontSize: 15 }}>Koji techniques, small group</strong>
              <div className="sf-sub">
                {travel === "anon" ? "Waiting at the vouched square…" : travel === "deniable" ? "Whispering coarsely through friends…" : "Traveling… reached friends of friends"}
                {standing && " · asks again in 6 days"}
              </div>
            </div>
            <button className="sf-demo" onClick={() => setAskOut("match")}>demo: a day passes ▸</button>
          </div>
        </div>
      )}

      {persona === "main" && (
        <div>
          <div className="sf-eyebrow">Conversations</div>
          {convos.map((c) => (
            <div key={c.id} className="sf-card">
              <strong style={{ fontSize: 15 }}>{c.name}</strong>
              <div className="sf-sub">{c.last}</div>
            </div>
          ))}
          <div className="sf-eyebrow">Your people</div>
          <div className="sf-card sf-row" style={{ cursor: "pointer" }} onClick={() => { setInviteStep(invitesOut.length ? "list" : "start"); go("invite"); }}>
            <div className="avatar">+</div>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 15 }}>Invite &amp; vouch</strong>
              <div className="sf-sub">Bringing someone in means standing behind them.</div>
            </div>
          </div>
        </div>
      )}

      {persona === "quiet" && (
        <div>
          <div className="sf-eyebrow">This self's standing</div>
          <div className="sf-trust" style={{ marginBottom: 12 }}>
            <Seal />Carries anonymous proof: <strong>"vouched by someone in this network"</strong> — usable 3 times this quarter, never naming who.
          </div>
          <p className="sf-sub" style={{ fontSize: 13 }}>People who come to know this self can vouch for it directly. Over time it earns its own standing — the origin story never travels with it.</p>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 22, display: "flex", gap: 18, justifyContent: "center" }}>
        <button className="linklike" onClick={() => go("phil")}>Why it works this way</button>
        {persona === "main" && <button className="linklike" onClick={() => go("steward")}>Steward mode</button>}
      </div>
    </div>
  );

  /* ---------------- persona sheet ---------------- */

  const PersonaSheet = personaSheet && (
    <div className="modal" onClick={() => setPersonaSheet(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="sf-display">Which self is speaking?</h2>
        <div className="radioCard sel" onClick={() => switchPersona("main")}>
          <strong>You — main self</strong>
          <div className="sf-sub">Your name, your people, your vouches.</div>
        </div>
        {quietExists ? (
          <div className="radioCard" onClick={() => switchPersona("quiet")}>
            <strong>Quiet self</strong>
            <div className="sf-sub">Unlinkable. Anonymous standing. Its own world.</div>
          </div>
        ) : (
          <div>
            <button className="sf-btn quietBtn" onClick={() => { setQuietExists(true); }}>
              Start a separate self
            </button>
            {quietExists === false && (
              <p className="sf-sub" style={{ fontSize: 13, marginTop: 10 }}>
                The network can't link your selves. <strong>Your habits can</strong> — the same rare interests, the same phrasing, the same hours of the day. Keep this self's world separate.
              </p>
            )}
          </div>
        )}
        {quietExists && !["quiet"].includes(persona) && (
          <p className="sf-sub" style={{ fontSize: 12.5, marginTop: 4 }}>
            Separate selves live behind a separate unlock and never share contacts, asks, or channels.
          </p>
        )}
      </div>
    </div>
  );

  /* ---------------- ask flow ---------------- */

  const Ask = (
    <div>
      <button className="sf-back" onClick={() => go("home")}>← Back</button>
      {askStep === "speak" && (
        <div>
          <h2 className="sf-display">Just talk.</h2>
          <p className="sf-sub">Say it the way you'd say it to a friend. Typing works too.</p>
          <div className="rippleWrap">
            <button className="sf-mic" onClick={() => setAskStep("chips")}>🎙</button>
          </div>
          <p className="sf-sub" style={{ textAlign: "center" }}>(tap to simulate speaking)</p>
        </div>
      )}
      {askStep === "chips" && (
        <div>
          <div className="sf-card" style={{ background: "var(--accent-soft)", border: "none" }}>
            <div className="sf-sub" style={{ marginBottom: 4 }}>You said</div>
            <em style={{ fontSize: 15.5 }}>"I want to find people experimenting with koji — I've been at it about a year."</em>
          </div>
          <h2 className="sf-display" style={{ marginTop: 16 }}>{CHIP_QUESTIONS[chipIdx].q}</h2>
          <p className="sf-sub" style={{ marginBottom: 12 }}>Question {chipIdx + 1} of 3 — your level was already heard, so it won't be asked.</p>
          <div>
            {CHIP_QUESTIONS[chipIdx].opts.map((o) => (
              <button key={o} className="sf-chip" onClick={() => pickChip(o)}>{o}</button>
            ))}
          </div>
        </div>
      )}
      {askStep === "travel" && (
        <div>
          <h2 className="sf-display">How should this travel?</h2>
          {TRAVEL_MODES.map((m) => (
            <div key={m.id} className={"radioCard" + (travel === m.id ? " sel" : "")} onClick={() => setTravel(m.id)}>
              <strong>{m.name}</strong>
              <div className="sf-sub">{m.desc}</div>
            </div>
          ))}
          {travel !== "anon" && (
            <div className="sf-card">
              <strong style={{ fontSize: 14.5 }}>Never through…</strong>
              <div className="toggleLine"><span>Family circle</span>
                <button className={"tog" + (neverThrough.family ? " on" : "")} onClick={() => setNeverThrough({ ...neverThrough, family: !neverThrough.family })} /></div>
              <div className="toggleLine"><span>Work circle</span>
                <button className={"tog" + (neverThrough.work ? " on" : "")} onClick={() => setNeverThrough({ ...neverThrough, work: !neverThrough.work })} /></div>
              <p className="sf-sub" style={{ fontSize: 12.5, marginTop: 8 }}>Safe to use: a person who never receives your ask can't tell being excluded from the path simply not passing their way.</p>
            </div>
          )}
          <button className="sf-btn primary" onClick={() => setAskStep("confirm")}>Continue</button>
        </div>
      )}
      {askStep === "confirm" && (
        <div>
          <h2 className="sf-display">Ready to send</h2>
          <div className="sf-card">
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.55 }}>
              Ask for: <strong>{answers[2] || "a small group"}</strong> to <strong>{answers[0] || "swap as peers"}</strong> on koji techniques, intermediate, <strong>{answers[1] || "anywhere"}</strong> — traveling <strong>{TRAVEL_MODES.find((m) => m.id === travel).name.toLowerCase()}</strong>.
            </p>
            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "12px 0" }} />
            <div className="toggleLine">
              <span style={{ paddingRight: 8 }}>Keep asking on a gentle rhythm<br /><span className="sf-sub" style={{ fontSize: 12.5 }}>weekly, easing to monthly — lives only on this phone; a quarterly "still looking?" keeps it honest</span></span>
              <button className={"tog" + (standing ? " on" : "")} onClick={() => setStanding(!standing)} />
            </div>
            <p className="sf-sub" style={{ fontSize: 13, marginTop: 10 }}>
              Your name stays hidden until you both agree to connect. To anyone who receives this, it looks passed-along — never yours.
            </p>
          </div>
          <button className="sf-btn primary" onClick={() => { setAskOut("traveling"); go("home"); setToast("Your ask is traveling. Answers usually come within a day or two, as friends come online."); }}>
            Send it
          </button>
          <button className="sf-btn ghost" onClick={() => setAskStep("travel")}>Edit</button>
        </div>
      )}
    </div>
  );

  /* ---------------- match + reveal + escrow ---------------- */

  const Match = (
    <div>
      <button className="sf-back" onClick={() => go("home")}>← Back</button>
      <h2 className="sf-display">A possible match</h2>

      <div className={"flip" + (revealed ? " revealed" : "")}>
        <div className="flipInner">
          <div className="face sf-card">
            <div className="sf-row">
              <div className="avatar" aria-hidden="true">?</div>
              <div>
                <strong style={{ fontSize: 16 }}>{persona === "quiet" ? "Someone at the square" : "Someone, a few hops away"}</strong>
                <div className="sf-sub">A small group · 5 people · meets monthly · intermediate · your region</div>
              </div>
            </div>
            <div className="sf-trust" style={{ marginTop: 12 }}>
              {persona === "quiet"
                ? (<span><Seal />A vouched member of this community — identity sealed, like yours.</span>)
                : (<span><Seal />Arrived through people <strong>Maya</strong> trusts. Their endorsements will be checked the moment names unlock.</span>)}
            </div>
          </div>
          <div className="face backSide sf-card" style={{ borderColor: "var(--amber)" }}>
            <div className="sf-row">
              <div className="avatar" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>BT</div>
              <div>
                <strong style={{ fontSize: 16 }}>Bob Tanaka</strong>
                <div className="sf-sub">Koji Circle · 5 members</div>
              </div>
            </div>
            <div className="sf-trust" style={{ marginTop: 12 }}>
              <Seal />Vouched by <strong>Maya Chen</strong> (since 2024)<br />
              <Seal />Vouched by <strong>Priya S.</strong> (fermentation group)
            </div>
          </div>
        </div>
      </div>

      {!revealed ? (
        <div>
          <div className="sf-card">
            <div className="sf-sub" style={{ marginBottom: 6 }}>If you both agree, you exchange — at the same moment, or not at all:</div>
            {[["Your name", "name"], ["Your vouches", "vouches"], ["Your city", "city"]].map(([label, k]) => (
              <div className="toggleLine" key={k}>
                <span>{label}</span>
                <button className={"tog" + (terms[k] ? " on" : "")} aria-label={label}
                        onClick={() => setTerms({ ...terms, [k]: !terms[k] })} />
              </div>
            ))}
          </div>
          <button className="sf-btn primary" onClick={() => setRevealed(true)}>Connect</button>
          <button className="sf-btn quietBtn" style={{ marginTop: 8 }}
                  onClick={() => { setAskOut(null); go("home"); setToast("Passed quietly — there is no message for declining, so nothing can reach them."); }}>
            Pass
          </button>
          <p className="sf-sub" style={{ textAlign: "center", marginTop: 10, fontSize: 13 }}>
            Passing is invisible. The protocol has no "no" — silence is indistinguishable from an ask that faded.
          </p>
        </div>
      ) : (
        <div>
          <p className="sf-sub" style={{ margin: "6px 0 12px" }}>
            Both of you said yes, so both cards flipped at once — and the endorsements checked out against his real identity.
          </p>

          {meetStep === "none" && (
            <div>
              <button className="sf-btn primary" onClick={() => {
                if (persona === "main") setConvos([{ id: 2, name: "Koji Circle", last: "You joined — say hello" }, ...convos]);
                setMeetStep("planned");
              }}>
                Say hello
              </button>
              <button className="sf-btn ghost" onClick={() => go("phil")}>How the reveal stays fair →</button>
            </div>
          )}

          {meetStep === "planned" && (
            <div className="sf-card">
              <strong style={{ fontSize: 15 }}>Their monthly meetup is Saturday — going?</strong>
              <p className="sf-sub" style={{ margin: "6px 0 10px" }}>First hellos are safest where the group already gathers. If you'd rather meet one-on-one, keep someone you trust in the loop:</p>
              <button className="sf-btn quietBtn" onClick={() => { setMeetStep("checkin"); setToast("Maya has the who, when, and where — sent over your own channel, no server involved."); }}>
                Share this meetup with Maya
              </button>
              <button className="sf-btn ghost" onClick={() => { setMeetStep("done"); }}>Skip</button>
            </div>
          )}

          {meetStep === "checkin" && (
            <div className="sf-card" style={{ borderColor: "var(--amber)" }}>
              <strong style={{ fontSize: 15 }}>Check-in armed.</strong>
              <p className="sf-sub" style={{ margin: "6px 0 10px" }}>Saturday, 90 minutes after the meeting starts, this phone will ask if you're okay. Silence pings Maya with the details she already holds.</p>
              <button className="sf-demo" onClick={() => setMeetStep("checkinAsk")}>demo: 90 minutes later ▸</button>
            </div>
          )}

          {meetStep === "checkinAsk" && (
            <div className="sf-card" style={{ borderColor: "var(--accent)" }}>
              <strong style={{ fontSize: 15 }}>All good?</strong>
              <div className="sf-row" style={{ marginTop: 10 }}>
                <button className="sf-btn primary" style={{ flex: 1 }} onClick={() => { setMeetStep("done"); setToast("Marked safe. Maya's copy quietly expires — nothing about this meetup persists anywhere."); }}>
                  I'm okay
                </button>
                <button className="sf-btn quietBtn" style={{ flex: 1 }} onClick={() => { setMeetStep("done"); setToast("Maya pinged now, with everything she needs."); }}>
                  Ping Maya now
                </button>
              </div>
            </div>
          )}

          {meetStep === "done" && (
            <div>
              <div className="sf-card">
                <strong style={{ fontSize: 15 }}>Afterwards, one quiet question:</strong>
                <p className="sf-sub" style={{ margin: "6px 0 10px" }}>"Glad you connected?" — your answer tunes only your own phone's sense of good paths. It is never shown to Bob, never a rating on a person.</p>
                <div className="sf-row">
                  <button className="sf-chip" onClick={() => { setAskOut(null); go("home"); setToast("Noted, privately. Paths like this one will be favored."); }}>Glad</button>
                  <button className="sf-chip" onClick={() => { setAskOut(null); go("home"); setToast("Noted, privately. Nothing else happens — that's the point."); }}>Meh</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ---------------- invite flow ---------------- */

  const Invite = (
    <div>
      <button className="sf-back" onClick={() => go("home")}>← Back</button>
      <h2 className="sf-display">Invite &amp; vouch</h2>

      {inviteStep === "start" && (
        <div>
          <p className="sf-sub" style={{ marginBottom: 14 }}>
            An invite is a promise: <em>"I know this person, and I stand behind them."</em> It becomes their first vouch — and it carries your community's mailbox addresses and house rules in one QR.
          </p>
          <button className="sf-btn primary" onClick={() => setInviteStep("picker")}>Choose from contacts</button>
          <button className="sf-btn quietBtn" style={{ marginTop: 8 }} onClick={() => setInviteStep("picker")}>Type an email or number</button>
          <button className="sf-btn quietBtn" style={{ marginTop: 8 }} onClick={() => setInviteStep("compose")}>Show a QR in person</button>
          <div className="sf-card" style={{ marginTop: 16, background: "var(--accent-soft)", border: "none" }}>
            <p className="sf-sub" style={{ fontSize: 13.5, color: "var(--ink)" }}>
              Your address book never leaves this phone. In person, two QRs — theirs back to yours — can finish the whole thing with no signal at all; everything posts when either phone finds a mailbox.
            </p>
          </div>
        </div>
      )}

      {inviteStep === "picker" && (
        <div>
          <p className="sf-sub" style={{ marginBottom: 12 }}>This is your phone's picker, not the app's. Only your choice is handed over.</p>
          {CONTACTS.map((c) => (
            <div key={c.n} className="contactRow" onClick={() => setInviteStep("compose")}>
              <div className="avatar">{c.n.split(" ").map((w) => w[0]).join("")}</div>
              <div>
                <strong style={{ fontSize: 15 }}>{c.n}</strong>
                <div className="sf-sub" style={{ fontSize: 13 }}>{c.d}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {inviteStep === "compose" && (
        <div>
          <div className="sf-card">
            <div className="sf-sub" style={{ marginBottom: 6 }}>Ready to send via your Messages app:</div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
              "Bob — I'm on something new for finding people through friends instead of feeds.
              This link is my personal vouch for you: <span style={{ color: "var(--accent)" }}>weft.link/i#7Kq…</span>
              (works once, expires in 14 days)"
            </p>
            <p className="sf-sub" style={{ fontSize: 12, marginTop: 8 }}>The token rides after the #, which browsers never send to any server — even our website can't see it pass.</p>
          </div>
          <button className="sf-btn primary" onClick={() => {
            setInvitesOut([{ to: "Bob Tanaka", state: "sent" }]);
            setInviteStep("list"); setToast("Handed to Messages — sent from your number, not a server.");
          }}>
            Send via Messages
          </button>
        </div>
      )}

      {inviteStep === "list" && (
        <div>
          <div className="sf-eyebrow">Invites out</div>
          {invitesOut.map((inv, i) => (
            <div className="sf-card" key={i}>
              <div className="sf-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong style={{ fontSize: 15 }}>{inv.to}</strong>
                  <div className="sf-sub">{inv.state === "sent" ? "Sent · single use · expires in 14 days" : "Confirmed — your vouch is live"}</div>
                </div>
                {inv.state === "sent" && !pendingConfirm && (
                  <button className="sf-demo" onClick={() => setPendingConfirm(true)}>demo: Bob joins ▸</button>
                )}
              </div>
              {inv.state === "sent" && !pendingConfirm && (
                <button className="sf-btn ghost" style={{ textAlign: "left", paddingLeft: 0 }}
                        onClick={() => { setInvitesOut([]); setInviteStep("start"); setToast("Invite revoked — the link is now dead."); }}>
                  Revoke
                </button>
              )}
            </div>
          ))}

          {pendingConfirm && (
            <div className="sf-card" style={{ borderColor: "var(--amber)" }}>
              <strong style={{ fontSize: 15 }}>Someone joined with your invite to Bob.</strong>
              <div className="sf-sub" style={{ margin: "6px 0 12px" }}>
                Their name reads "Bob T." — is this your Bob? Links travel like postcards, so your vouch waits for your word.
              </div>
              <button className="sf-btn primary" onClick={() => {
                setInvitesOut([{ to: "Bob Tanaka", state: "confirmed" }]); setPendingConfirm(false);
                setToast("Confirmed. Bob now carries your vouch."); }}>
                Yes, that's my Bob
              </button>
              <button className="sf-btn quietBtn" style={{ marginTop: 8 }} onClick={() => {
                setInvitesOut([]); setPendingConfirm(false); setInviteStep("start");
                setToast("Voided. Whoever joined holds a key with no vouches — and here, that means no reach."); }}>
                That's not them
              </button>
            </div>
          )}

          <button className="sf-btn ghost" onClick={() => go("phil")}>Why invites never touch a server →</button>
        </div>
      )}
    </div>
  );

  /* ---------------- steward mode ---------------- */

  const Steward = (
    <div>
      <button className="sf-back" onClick={() => go("home")}>← Back</button>
      <h1 className="sf-display">Steward mode</h1>
      <p className="sf-sub">Cascade Fermentation Collective · you + 2 co-stewards</p>

      <div className="sf-eyebrow">This week's health</div>
      <div className="sf-card">
        <div className="dial"><span>Asks matched within 48h</span><b className="good">58% ↑</b></div>
        <div className="dial"><span>Found through friends vs. the square</span><b className="good">near parity ↑</b></div>
        <div className="dial"><span>Handshakes completed</span><b className="good">71%</b></div>
        <div className="dial"><span>Asks that died quietly</span><b className="warn">31% ↓ slowly</b></div>
        <div className="dial"><span>Members active this week</span><b className="good">39 of 54</b></div>
      </div>
      <p className="sf-sub" style={{ fontSize: 12.5 }}>Computed on this device from your cell's opt-in beacons — blurred counters, no names, no topics. The same numbers anyone can compute.</p>

      <div className="sf-eyebrow">Nudges</div>
      <div className="sf-card" style={{ borderColor: "var(--amber)" }}>
        <strong style={{ fontSize: 15 }}>54 members — time for your own mailbox.</strong>
        <p className="sf-sub" style={{ margin: "4px 0 10px" }}>You've been borrowing public relays. One container on a Pi or a $5 box gives the cell its own; the charter update carries the new address to everyone.</p>
        <button className="sf-btn quietBtn" onClick={() => setToast("Relay guide opened in the steward kit (mock).")}>Open the relay guide</button>
      </div>

      <div className="sf-card">
        <div className="sf-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong style={{ fontSize: 15 }}>Weekly ask prompt</strong>
            <div className="sf-sub">"Ask one thing you'd never bring up at the meetup."</div>
          </div>
          <button className="sf-btn quietBtn" style={{ width: "auto", padding: "10px 14px" }}
                  onClick={() => setToast("Prompt posted to the cell channel.")}>Post</button>
        </div>
      </div>

      <div className="sf-eyebrow">House rules</div>
      <div className="sf-card">
        <p className="sf-sub" style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
          No selling · Three strikes · Disputes go to two rotating members · Your sponsor answers for you at first · First-timers come to the monthly
        </p>
        <p className="sf-sub" style={{ fontSize: 12, marginTop: 8 }}>Charter v3 · amendments need 2 of 3 steward signatures · every member agreed at their own front porch.</p>
      </div>

      <div className="sf-eyebrow">If you step down</div>
      <p className="sf-sub" style={{ fontSize: 13 }}>Stewardship is a role, not a person: hand over with one charter update. If every steward vanished tomorrow, asks, matches, and conversations would keep working — only rule changes and greeting would stall.</p>
    </div>
  );

  /* ---------------- philosophy & privacy ---------------- */

  const BEACON = `// this week's health beacon — exactly as sent
{
  "kind": 4905,
  "week": "2026-W28",
  "counters": {
    "asks_sent":        "1-5",     // bucketed
    "asks_matched":     "1-5",     // + noise
    "median_hops":      "2",
    "handshakes_done":  "1-5",
    "forwards_relayed": "6-20",
    "vouch_failures":   "0"
  }
  // no topics. no names. no places. no graph.
}`;

  const Phil = (
    <div>
      <button className="sf-back" onClick={() => go("home")}>← Back</button>
      <h1 className="sf-display">Why it works this way</h1>
      <p className="sf-sub">The short, honest version — the same one the protocol has to live up to.</p>

      <div className="sf-eyebrow">A channel, not a place</div>
      <p className="philP">There is no feed here because there is nothing to scroll. This app is a way of <em>asking</em>, the way email is a way of writing — designed to be comfortable closed. Its only success metric is matches made, never minutes spent.</p>

      <div className="sf-eyebrow">Asking, not broadcasting — and never signed</div>
      <p className="philP">Your ask travels hand to hand through people you know, shedding detail at every hop. And it is never marked as yours: to everyone who receives it, an ask you wrote and an ask you passed along are the same bytes. Even your closest friend sees only "this came through here" — never "this came from her."</p>

      <div className="sf-eyebrow">You choose how it travels</div>
      <p className="philP">Every ask picks its road: <strong>through friends</strong> (fastest, and people near you may see what's asked), <strong>deniably</strong> (friends carry only a coarse whisper — "food-adjacent" — while the specifics stay sealed until a match tests them privately), or <strong>anonymously</strong> (a members-only square where everyone has proven they're vouched and no one has said by whom). The personal questions get the most protected roads.</p>

      <div className="sf-eyebrow">Rejection can't leak — there's no message for it</div>
      <p className="philP">A match starts masked on both sides; names unlock together, at the same instant, or not at all. Declining sends nothing — not out of politeness, but because the protocol contains no "no." What cannot be expressed cannot be weaponized.</p>

      <div className="sf-eyebrow">Several selves, honestly bounded</div>
      <p className="philP">You may keep separate selves — a work self, a quiet self — that the network cannot link, each carrying anonymous proof that <em>some</em> vouched person stands behind it. Bounded, so trust can't be counterfeited by the thousand: a few selves per season, and each answers permanently, by its own face, in every room it enters. A banned self stays banned — even though no one ever learned whose it was.</p>

      <div className="sf-eyebrow">Trust is people, not points</div>
      <p className="philP">You will never see a score. Trust reads as sentences — <span className="sf-trust" style={{ display: "inline", padding: "2px 8px" }}><Seal />vouched by Maya Chen, since 2024</span> — because that's how trust works. A thousand fake accounts can vouch for each other; none can forge a path through <em>your</em> friends. Numbers invite gaming. Names invite judgment.</p>

      <div className="sf-eyebrow">What leaves this phone</div>
      <p className="philP">Asks travel as scrambled meaning-codes inside sealed envelopes — the mailboxes that carry them cannot read mail and forget everything within days. Your name leaves only when you tap Connect. If you opt into health sharing, six blurred counters leave weekly. This week's, exactly as sent:</p>
      <div className="mono">{BEACON}</div>
      <p className="philP" style={{ marginTop: 10 }}>
        What <span className="philNever">never</span> leaves: your address book, your messages, your location, your contacts' interests, which self is yours, or who declined whom.
      </p>

      <div className="sf-eyebrow">Meeting people stays yours too</div>
      <p className="philP">When a match becomes a meetup, the safety net is your own people, not a platform: one tap shares the who-when-where with a friend you choose, over your own channel, with a check-in timer. Say you're okay and her copy quietly expires. No server ever knew you met.</p>

      <div className="sf-eyebrow">Invites never touch a server</div>
      <p className="philP">Your phone's own picker hands the app one name; your own Messages app carries the link; the token rides behind a # that browsers never transmit. In person, two QRs finish everything with no signal at all. An invite is your personal vouch — it works once, expires in two weeks, and waits for you to confirm it reached the right hands.</p>

      <div className="sf-eyebrow">Forgetting is the default</div>
      <p className="philP">Asks expire. Stalled handshakes evaporate. Mailboxes hold nothing for long — every envelope carries its own burn-by date. Seize every server this system touches and you'd find sealed letters and empty shelves. Anything worth keeping, a person you trust keeps on purpose.</p>

      <div className="sf-card" style={{ background: "var(--accent-soft)", border: "none", marginTop: 20 }}>
        <p className="philP" style={{ margin: 0 }}><strong>The whole idea in one line:</strong> it should feel like leaving a note with a trusted friend — brief to write, safe to wait on, and warm when an answer comes back.</p>
      </div>
    </div>
  );

  /* ---------------- render ---------------- */

  return (
    <div className="sf-root">
      <style>{CSS}</style>
      <div className={"sf-phone" + (persona === "quiet" ? " quiet" : "")}>
        <div className="sf-body">
          {screen === "home" && Home}
          {screen === "ask" && Ask}
          {screen === "match" && Match}
          {screen === "invite" && Invite}
          {screen === "steward" && Steward}
          {screen === "phil" && Phil}
        </div>
        {PersonaSheet}
        {toast && <Toast text={toast} />}
      </div>
    </div>
  );
}
