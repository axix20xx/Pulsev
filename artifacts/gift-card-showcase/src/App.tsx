import { useEffect, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleUserRound,
  Copy,
  Gift,
  Heart,
  KeyRound,
  Layers3,
  LogOut,
  Mail,
  Menu,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();
const AUTH_KEY = 'morrow-demo-session';

type CardTheme = {
  name: string;
  place: string;
  note: string;
  tone: string;
  accent: string;
  dark?: boolean;
};

const themes: CardTheme[] = [
  { name: 'The Slow Morning', place: 'For the early riser', note: 'A little more time for the good stuff.', tone: 'card-amber', accent: 'Oat & saffron' },
  { name: 'Out of Office', place: 'For the one who needs a day', note: 'Permission to go somewhere beautiful.', tone: 'card-coral', accent: 'Poppy & terracotta' },
  { name: 'A Seat at the Table', place: 'For your favourite person', note: 'The best stories happen over dinner.', tone: 'card-ink', accent: 'Ink & moss', dark: true },
  { name: 'Good Things Ahead', place: 'For a new beginning', note: 'A small signal that you believe in them.', tone: 'card-sage', accent: 'Fennel & limestone' },
];

function Mark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className={`brand-lockup ${inverted ? 'brand-lockup-inverted' : ''}`} data-testid="brand-lockup">
      <span className="brand-mark" aria-hidden="true"><span /><i /></span>
      <span className="brand-word">morrow</span>
    </span>
  );
}

function SiteHeader({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className={`site-header ${dark ? 'site-header-dark' : ''}`}>
      <Link href="/" className="brand-link" data-testid="link-home-header" onClick={() => setOpen(false)}>
        <Mark inverted={dark} />
      </Link>
      <nav className={`main-nav ${open ? 'main-nav-open' : ''}`} aria-label="Primary navigation">
        <a href="#collection" data-testid="link-collection" onClick={() => setOpen(false)}>The collection</a>
        <a href="#ritual" data-testid="link-ritual" onClick={() => setOpen(false)}>Our ritual</a>
        <a href="#about" data-testid="link-about" onClick={() => setOpen(false)}>About morrow</a>
        <Link href="/showcase" className="nav-studio-link" data-testid="link-studio-nav" onClick={() => setOpen(false)}>Your studio <ArrowUpRight size={14} /></Link>
      </nav>
      <button className="mobile-nav-trigger" type="button" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} data-testid="button-mobile-menu">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
    </header>
  );
}

function CardVisual({ theme, compact = false }: { theme: CardTheme; compact?: boolean }) {
  return (
    <div className={`gift-card-visual ${theme.tone} ${compact ? 'gift-card-compact' : ''} ${theme.dark ? 'gift-card-dark' : ''}`} data-testid={`card-visual-${theme.name.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="card-orbit card-orbit-one" />
      <div className="card-orbit card-orbit-two" />
      <div className="card-topline"><span>morrow / 01</span><span>for you</span></div>
      <div className="card-symbol"><span /><span /></div>
      <div className="card-name">{theme.name}</div>
      <div className="card-bottomline"><span>{theme.accent}</span><span>↗</span></div>
    </div>
  );
}

function Home() {
  const [activeTheme, setActiveTheme] = useState(0);
  const [saved, setSaved] = useState(false);
  const selected = themes[activeTheme];

  return (
    <main className="site-shell">
      <section className="hero-section" data-testid="section-hero">
        <SiteHeader />
        <div className="hero-grain" />
        <div className="hero-content page-width">
          <div className="hero-copy reveal reveal-one">
            <p className="eyebrow"><span className="eyebrow-line" /> Digital gift cards, with a little more feeling</p>
            <h1>The gift,<br /><em>beautifully held.</em></h1>
            <p className="hero-description">Morrow turns a simple gesture into a moment worth keeping. Choose a feeling, add your words, and give them something they will remember before they even open it.</p>
            <div className="hero-actions">
              <Link href="/login" className="button button-dark" data-testid="link-begin-gifting">Begin with a feeling <ArrowRight size={16} /></Link>
              <a href="#collection" className="text-link" data-testid="link-explore-collection">Explore the collection <ArrowDown size={15} /></a>
            </div>
          </div>
          <div className="hero-art reveal reveal-two" aria-label="A layered Morrow gift card composition">
            <div className="hero-stamp"><span>make</span><span>it a moment</span></div>
            <div className="hero-card-back"><span>morrow</span><span>02 — 24</span></div>
            <div className="hero-card-front">
              <div className="hero-card-meta"><span>morrow / gift studio</span><span>01</span></div>
              <div className="hero-card-title">A little<br /><i>something</i><br />for you.</div>
              <div className="hero-card-footer"><span>open slowly</span><span className="hero-card-symbol"><Sparkles size={13} /></span></div>
            </div>
            <div className="hero-handnote">You are allowed<br />to make a fuss.</div>
            <div className="hero-art-caption"><span>01 / 04</span><span>the considered gift</span></div>
          </div>
        </div>
        <a className="scroll-cue" href="#collection" aria-label="Scroll to collection" data-testid="link-scroll-collection"><span>Scroll to wander</span><ArrowDown size={14} /></a>
      </section>

      <div className="marquee-band" aria-label="Morrow gift card studio">
        <div className="marquee-track">
          <span>A reason to celebrate</span><i>+</i><span>A reason to pause</span><i>+</i><span>A reason to say I see you</span><i>+</i><span>A reason to celebrate</span><i>+</i>
        </div>
      </div>

      <section className="intro-section page-width" id="about" data-testid="section-about">
        <div className="intro-kicker"><span>01</span><span className="rule" /><span>The Morrow point of view</span></div>
        <div className="intro-grid">
          <h2>A code is useful.<br /><em>A feeling is not.</em></h2>
          <div className="intro-copy">
            <p>We made Morrow for the gifts that are too thoughtful to be reduced to a number. For the long-distance friend. The new chapter. The Tuesday that needed a lift.</p>
            <p>Every card is a small room for your words — composed, personal, and ready to be shared.</p>
            <a href="#ritual" className="circle-link" data-testid="link-read-ritual"><span>Read our<br />little ritual</span><ArrowDown size={16} /></a>
          </div>
        </div>
      </section>

      <section className="collection-section" id="collection" data-testid="section-collection">
        <div className="page-width">
          <div className="section-heading">
            <div><p className="eyebrow"><span className="eyebrow-line" /> The collection</p><h2>Choose the<br /><em>right kind</em> of yes.</h2></div>
            <p className="section-heading-note">Four moods. Infinite ways to say it.<br />Start with the feeling, not the occasion.</p>
          </div>
          <div className="collection-grid">
            <button className="collection-feature" type="button" onClick={() => setActiveTheme(0)} data-testid="button-theme-slow-morning">
              <CardVisual theme={themes[0]} />
              <span className="collection-card-caption"><span><strong>The Slow Morning</strong><small>For the early riser</small></span><ArrowUpRight size={17} /></span>
            </button>
            <div className="collection-side-stack">
              <button className="collection-small-card" type="button" onClick={() => setActiveTheme(1)} data-testid="button-theme-out-of-office">
                <CardVisual theme={themes[1]} compact />
                <span className="collection-card-caption"><span><strong>Out of Office</strong><small>For the one who needs a day</small></span><ArrowUpRight size={17} /></span>
              </button>
              <div className="collection-aside-note"><span className="note-number">02 / 04</span><p>Not every gift needs a reason. Sometimes the reason is simply: <em>you crossed my mind.</em></p><Link href="/login" className="text-link" data-testid="link-build-card">Build your card <ArrowRight size={15} /></Link></div>
            </div>
            <button className="collection-wide-card" type="button" onClick={() => setActiveTheme(2)} data-testid="button-theme-seat-table">
              <CardVisual theme={themes[2]} compact />
              <span className="collection-card-caption"><span><strong>A Seat at the Table</strong><small>For your favourite person</small></span><ArrowUpRight size={17} /></span>
            </button>
            <button className="collection-sage-card" type="button" onClick={() => setActiveTheme(3)} data-testid="button-theme-good-things">
              <CardVisual theme={themes[3]} compact />
              <span className="collection-card-caption"><span><strong>Good Things Ahead</strong><small>For a new beginning</small></span><ArrowUpRight size={17} /></span>
            </button>
          </div>
          <div className="collection-viewer">
            <div className="viewer-copy"><span className="eyebrow-line" /><span>Currently considering</span><strong>{selected.name}</strong><p>{selected.note}</p></div>
            <div className="viewer-dots">{themes.map((theme, index) => <button key={theme.name} className={index === activeTheme ? 'active' : ''} onClick={() => setActiveTheme(index)} aria-label={`View ${theme.name}`} data-testid={`button-view-theme-${index}`}>{String(index + 1).padStart(2, '0')}</button>)}</div>
            <button className={`save-button ${saved ? 'is-saved' : ''}`} type="button" onClick={() => setSaved(!saved)} data-testid="button-save-favourite">{saved ? <Check size={15} /> : <Heart size={15} />}{saved ? 'Saved to favourites' : 'Save this feeling'}</button>
          </div>
        </div>
      </section>

      <section className="ritual-section page-width" id="ritual" data-testid="section-ritual">
        <div className="ritual-intro"><p className="eyebrow"><span className="eyebrow-line" /> The Morrow ritual</p><h2>Three small<br /><em>acts of care.</em></h2><p className="ritual-lede">The best gifts feel effortless to receive and intentional to give. We take care of the in-between.</p></div>
        <div className="ritual-list">
          <div className="ritual-row"><span className="ritual-index">01</span><div><h3>Start with a feeling</h3><p>Choose a mood, not a menu. Our collection is arranged by the thing you want to say.</p></div><Layers3 size={22} /></div>
          <div className="ritual-row"><span className="ritual-index">02</span><div><h3>Make it yours</h3><p>Add a note that sounds like you. A few honest words will always beat a perfect paragraph.</p></div><WandSparkles size={22} /></div>
          <div className="ritual-row"><span className="ritual-index">03</span><div><h3>Send the moment</h3><p>Share a beautiful reveal link, right when it feels right. No inbox archaeology required.</p></div><Share2 size={22} /></div>
        </div>
      </section>

      <section className="quote-section" data-testid="section-quote">
        <div className="quote-orbit" />
        <div className="quote-content"><span className="quote-mark">“</span><blockquote>The most memorable gifts<br />are the ones that say<br /><em>I know you.</em></blockquote><p>— a note from the studio</p></div>
      </section>

      <section className="closing-section page-width" data-testid="section-closing">
        <div className="closing-card"><div className="closing-card-mark"><Mark inverted /></div><h2>Give them<br /><em>a little morrow.</em></h2><p>Something to open now.<br />Something to remember later.</p><Link href="/login" className="button button-light" data-testid="link-open-studio">Open your studio <ArrowUpRight size={16} /></Link></div>
        <div className="closing-aside"><span className="eyebrow">A note from us</span><p>Built for birthdays, breakthroughs, thank-yous, and all the quiet in-betweens.</p><span className="closing-aside-mark">m / 2024</span></div>
      </section>
      <footer className="site-footer page-width"><Mark /><span>Digital gifts with a pulse.</span><span>© Morrow studio</span></footer>
    </main>
  );
}

function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Add an email and a passphrase to enter the demo studio.');
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ email: email.trim(), at: Date.now() }));
      setLocation('/showcase');
    }, 420);
  };

  return (
    <main className="auth-shell">
      <div className="auth-art">
        <Link href="/" className="auth-brand" data-testid="link-home-login"><Mark inverted /></Link>
        <div className="auth-art-copy"><span className="eyebrow eyebrow-light"><span className="eyebrow-line" /> Welcome back</span><h1>Your little<br /><em>corner of care.</em></h1><p>Keep the gifts you are dreaming up close at hand.</p></div>
        <div className="auth-floating-card"><CardVisual theme={themes[1]} /><div className="auth-floating-note">For the moments<br />that matter.</div></div>
        <span className="auth-art-footer">morrow / private studio</span>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form-top"><span>Already have a studio?</span><Link href="/" className="text-link" data-testid="link-return-home-login">Return home <ArrowUpRight size={14} /></Link></div>
        <div className="auth-form-content">
          <span className="auth-icon"><KeyRound size={18} /></span>
          <p className="eyebrow">Demo access</p>
          <h2>Come on in.</h2>
          <p className="auth-intro">This is a local demo — no account, payment, or inbox confirmation needed.</p>
          <form onSubmit={submit} className="auth-form">
            <label htmlFor="email">Your email</label>
            <div className="input-shell"><Mail size={16} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@somewhere.good" autoComplete="email" data-testid="input-email" /></div>
            <label htmlFor="password">A passphrase</label>
            <div className="input-shell"><KeyRound size={16} /><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Anything memorable" autoComplete="current-password" data-testid="input-password" /></div>
            {error && <p className="form-error" role="alert" data-testid="text-login-error">{error}</p>}
            <button type="submit" className="button button-dark auth-submit" disabled={busy} data-testid="button-enter-studio">{busy ? 'Opening your studio…' : 'Enter the studio'} <ArrowRight size={16} /></button>
          </form>
          <p className="auth-footnote"><Sparkles size={14} /> Use any details for this private preview.</p>
        </div>
        <div className="auth-form-bottom"><span>Thoughtfully made for giving well.</span><span>01 / 01</span></div>
      </div>
    </main>
  );
}

function Showcase() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState('All gifts');
  const [showComposer, setShowComposer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userEmail, setUserEmail] = useState('your studio');

  useEffect(() => {
    const session = sessionStorage.getItem(AUTH_KEY);
    if (!session) {
      setLocation('/login');
      return;
    }
    try {
      setUserEmail(JSON.parse(session).email || 'your studio');
    } catch {
      setUserEmail('your studio');
    }
  }, [setLocation]);

  const logout = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setLocation('/');
  };

  const copyLink = () => {
    navigator.clipboard?.writeText('morrow.studio/g/your-little-something');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="showcase-shell">
      <aside className="studio-sidebar">
        <Link href="/" className="sidebar-brand" data-testid="link-home-showcase"><Mark /></Link>
        <div className="sidebar-label">Your studio</div>
        <nav className="sidebar-nav">
          <button className="sidebar-item active" type="button" data-testid="button-sidebar-gifts"><Gift size={17} /> My gifts <span>4</span></button>
          <button className="sidebar-item" type="button" onClick={() => setShowComposer(true)} data-testid="button-sidebar-create"><Plus size={17} /> Create a gift</button>
          <button className="sidebar-item" type="button" data-testid="button-sidebar-favourites"><Heart size={17} /> Favourites <span>2</span></button>
        </nav>
        <div className="sidebar-bottom"><div className="account-chip"><span className="account-avatar">{userEmail.slice(0, 1).toUpperCase()}</span><span><strong>{userEmail.split('@')[0]}</strong><small>Private studio</small></span><CircleUserRound size={15} /></div><button type="button" className="sidebar-logout" onClick={logout} data-testid="button-logout"><LogOut size={16} /> Log out</button></div>
      </aside>
      <div className="showcase-main">
        <header className="showcase-header"><div><span className="eyebrow">Tuesday, 24 September 2024</span><h1>Good things,<br /><em>in progress.</em></h1></div><div className="showcase-header-actions"><Link href="/" className="header-home-link" data-testid="link-home-from-showcase">Back to morrow <ArrowUpRight size={14} /></Link><button type="button" className="button button-dark button-small" onClick={() => setShowComposer(true)} data-testid="button-create-gift"><Plus size={15} /> New gift</button></div></header>
        <section className="studio-spotlight" data-testid="section-studio-spotlight"><div className="spotlight-copy"><span className="eyebrow eyebrow-light"><span className="eyebrow-line" /> Featured draft</span><h2>A little<br /><em>something</em><br />for you.</h2><p>Last touched 12 minutes ago</p><div className="spotlight-actions"><button className="button button-light" type="button" onClick={copyLink} data-testid="button-copy-gift-link">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Link copied' : 'Copy reveal link'}</button><button type="button" className="icon-button-light" aria-label="Share gift link" onClick={copyLink} data-testid="button-share-gift"><Share2 size={17} /></button></div></div><div className="spotlight-card"><CardVisual theme={themes[0]} /><div className="spotlight-card-label">Draft / 01</div></div></section>
        <section className="gifts-section" data-testid="section-your-gifts"><div className="studio-section-head"><div><span className="eyebrow">Your gifts <sup>04</sup></span><h2>Keep making<br /><em>something of it.</em></h2></div><div className="studio-tools"><div className="search-stub"><Search size={15} /><span>Search gifts</span></div><button type="button" className="tool-button" aria-label="Filter gifts" data-testid="button-filter-gifts"><SlidersHorizontal size={16} /></button></div></div><div className="tabs" role="tablist">{['All gifts', 'Drafts', 'Sent'].map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)} role="tab" aria-selected={activeTab === tab} data-testid={`tab-${tab.toLowerCase().replace(' ', '-')}`}>{tab}</button>)}</div><div className="gift-list">{themes.map((theme, index) => <button className="gift-list-item" type="button" key={theme.name} onClick={() => setShowComposer(true)} data-testid={`card-gift-${index}`}><div className="gift-list-thumb"><CardVisual theme={theme} compact /></div><div className="gift-list-info"><span className="gift-status">{index === 0 ? 'Draft' : index === 1 ? 'Ready to send' : 'Saved'}</span><h3>{theme.name}</h3><p>{theme.note}</p></div><span className="gift-list-date">{index === 0 ? 'Today' : index === 1 ? 'Yesterday' : '18 Sep'}</span><ChevronRight size={17} /></button>)}</div></section>
      </div>
      {showComposer && <div className="composer-backdrop" role="presentation" onClick={() => setShowComposer(false)}><section className="composer-panel" role="dialog" aria-modal="true" aria-labelledby="composer-title" onClick={(event) => event.stopPropagation()} data-testid="dialog-create-gift"><div className="composer-top"><span className="eyebrow">New composition</span><button type="button" className="close-button" onClick={() => setShowComposer(false)} aria-label="Close composer" data-testid="button-close-composer"><X size={18} /></button></div><h2 id="composer-title">What do you<br /><em>want to say?</em></h2><p>Start with a feeling. You can add the details when it feels right.</p><div className="composer-options">{themes.slice(0, 3).map((theme) => <button type="button" key={theme.name} onClick={() => setShowComposer(false)} data-testid={`button-compose-${theme.name.toLowerCase().replaceAll(' ', '-')}`}><CardVisual theme={theme} compact /><span>{theme.name}</span></button>)}</div><button type="button" className="button button-dark composer-continue" onClick={() => setShowComposer(false)} data-testid="button-start-composition">Start with this feeling <ArrowRight size={16} /></button></section></div>}
    </main>
  );
}

function NotFound() {
  return <main className="not-found-shell"><Link href="/" className="not-found-brand" data-testid="link-home-404"><Mark /></Link><div className="not-found-content"><span className="not-found-number">404</span><h1>This page took<br /><em>a different route.</em></h1><p>Nothing is lost. The good stuff is still waiting at the beginning.</p><Link href="/" className="button button-dark" data-testid="link-return-home-404">Return to morrow <ArrowRight size={16} /></Link></div><div className="not-found-orbit" /></main>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/login" component={Login} /><Route path="/showcase" component={Showcase} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;