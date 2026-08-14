/**
 * The marketing landing page at `/` (12-3). Web only — `src/app/index.tsx` redirects to `/app`
 * on native, and `LandingPage.tsx` is the stub that keeps this file out of the native bundle.
 *
 * ## Why this is plain DOM instead of react-native-web
 *
 * Three reasons, each on its own sufficient:
 *
 * 1. **Semantics.** `Text` renders as a `<div>`. A page whose entire search payload is
 *    headings would ship without a single `<h1>` or `<h2>`.
 * 2. **Static rendering.** `useTheme()` reads `useSettingsStore`, so every component in
 *    `src/components/` transitively touches a persisted store. That is exactly why
 *    `dist/index.html` was almost empty before this page existed — the home screen could not
 *    render without client state. Nothing here reads a store, so the whole page lands in the
 *    static HTML where a crawler can see it.
 * 3. **Capability.** `<picture>`/`srcset`, the measured gradient scrim, `@media` and
 *    `prefers-reduced-motion` have no react-native-web equivalent.
 *
 * So the page shares *tokens, data and pure functions* with the app — the palette, the two
 * font families, `EXPORT_FORMAT_META`, `MOCK_WEB_PLANS`, and `HarmonicaMapper` in the key lab
 * — but no components and no stores.
 */
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { MOCK_WEB_PLANS, PLAN_PERKS } from '@/billing/plans';
import { EXPORT_FORMATS, EXPORT_FORMAT_META } from '@/constants/keys';

import type { HarmonicaKey } from '@/types';

import { KEY_LAB_CSS, KeyLab } from './KeyLab.web';
import { LANDING_CSS } from './landingStyles';
import { SAMPLE_DEMO_CSS, SampleDemo } from './SampleDemo.web';
import { HERO_INTRINSIC, PLAY_STORE_URL } from './tokens';

/**
 * What the demo clip actually transcribes to, used to seed the key lab before anyone presses
 * play — so that section is alive on arrival and its default state lands in the static HTML.
 *
 * These are not invented: they are the real output of `public/demo/sample.mp3` through the
 * pipeline, verified in the browser, and they round-trip exactly to the tab the demo shows
 * (`5 5 -5 6 6 -5 5 -4 4 4 -4 5 -4 4 4` on a C harp). Regenerate them by running the demo and
 * reading `result.notes` if the clip is ever replaced.
 */
const SEED_NOTES = [
  'E5', 'E5', 'F5', 'G5', 'G5', 'F5', 'E5', 'D5', 'C5', 'C5', 'D5', 'E5', 'D5', 'C5', 'C5',
] as const;
const SEED_KEY: HarmonicaKey = 'C';

/**
 * Provisional until the domain is bought — it is step 1 of the release sequence in
 * `docs/plan/README.md`, and the canonical URL, the sitemap and the absolute Open Graph URLs
 * all depend on it. Change it here and `public/sitemap.xml` together.
 */
const SITE_URL = 'https://harp2tab.com';

const TITLE = 'Harp2Tab — turn harmonica playing into harmonica tab';
const DESCRIPTION =
  'Record your harmonica or upload an audio or MIDI file, and Harp2Tab works out which hole '
  + 'and breath produces each note — blows, draws, bends and overblows — then lets you edit '
  + 'and export the tab. Runs in your browser.';

const HERO_SRCSET_WEBP =
  '/hero/harmonicas-960.webp 960w, /hero/harmonicas-1440.webp 1440w, /hero/harmonicas-1920.webp 1920w';
const HERO_SRCSET_JPEG =
  '/hero/harmonicas-960.jpg 960w, /hero/harmonicas-1440.jpg 1440w, /hero/harmonicas-1920.jpg 1920w';

/** Rich-result eligibility for the pricing table. Prices track `src/billing/plans.ts`. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Harp2Tab',
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web, Android',
  description: DESCRIPTION,
  url: SITE_URL,
  offers: MOCK_WEB_PLANS.map((plan) => ({
    '@type': 'Offer',
    name: plan.name,
    price: plan.price.replace('$', ''),
    priceCurrency: 'USD',
    category: plan.cadence === 'one time' ? 'one-time' : 'subscription',
  })),
};

const FAQ = [
  {
    q: 'Do I need to install anything?',
    a: 'No. Harp2Tab runs in your browser — open the app and start playing. There is also an '
      + 'Android app on Google Play if you would rather have it on your phone.',
  },
  {
    q: 'Does my audio leave my device?',
    a: 'No. Recording, transcription and editing all happen locally in your browser. Your '
      + 'audio is never uploaded to a server, which is also why the transcription works '
      + 'offline once the page has loaded.',
  },
  {
    q: 'Which harmonicas are supported?',
    a: 'Ten-hole diatonic in all 12 keys, including bends, overblows and overdraws, and the '
      + '12-hole chromatic with slide notation. You choose the harp before you start. When you '
      + 'upload audio the diatonic key is detected automatically; for MIDI you pick the harp '
      + 'and Harp2Tab flags the notes that need a bend or an overblow so you can simplify them.',
  },
  {
    q: 'What can I export?',
    a: 'Plain text tab, CSV, MIDI, MusicXML and JSON — so your transcription can go into a '
      + 'DAW, a notation program, a spreadsheet or your own tooling.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. You can record, transcribe, edit and export without signing in. An account is '
      + 'optional and exists so your work can follow you between devices later.',
  },
];

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  // The demo's own output, once it has run, so the key lab moves the visitor's transcription
  // rather than a canned one. Same clip either way — but it makes the two sections one story.
  const [labNotes, setLabNotes] = useState<readonly string[]>(SEED_NOTES);
  const [labKey, setLabKey] = useState<HarmonicaKey>(SEED_KEY);

  const handleDemoResult = useCallback((tabs: { note: string }[], key: string) => {
    if (tabs.length) setLabNotes(tabs.map((t) => t.note));
    setLabKey(key as HarmonicaKey);
  }, []);

  // The page owns its scroll box (see `.lp-root` in landingStyles.ts), so the header's
  // scrolled state has to come from that element rather than from window.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 80);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={SITE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={`${SITE_URL}/hero/harmonicas-1440.jpg`} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={`${SITE_URL}/hero/harmonicas-1440.jpg`} />
      </Head>

      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS + SAMPLE_DEMO_CSS + KEY_LAB_CSS }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <div className="lp-root" ref={rootRef}>
        <header className={scrolled ? 'lp-header lp-header--scrolled' : 'lp-header'}>
          <div className="lp-header__inner">
            <a className="lp-logo" href="/">
              {/* Served from public/ rather than `require`d, because this page is plain DOM
                  and not react-native-web. Generated at 1x/2x by
                  scripts/build-landing-images.py. Decorative: the wordmark beside it already
                  names the link, so the alt is deliberately empty. */}
              <img
                src="/logo/harp2tab-icon-42.png"
                srcSet="/logo/harp2tab-icon-42.png 1x, /logo/harp2tab-icon-84.png 2x"
                width={42}
                height={42}
                alt=""
              />
              <span>Harp2Tab</span>
            </a>
            <nav className="lp-nav">
              <a href="#how">How it works</a>
              <a href="#editing">Editing</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
            </nav>
            <a className="lp-btn lp-btn--primary lp-btn--sm" href="/app">Open the app</a>
          </div>
        </header>

        {/* ------------------------------------------------------------ hero */}
        <section className="lp-hero">
          <div className="lp-hero__media">
            <picture>
              <source type="image/webp" srcSet={HERO_SRCSET_WEBP} sizes="100vw" />
              <img
                src="/hero/harmonicas-1440.jpg"
                srcSet={HERO_SRCSET_JPEG}
                sizes="100vw"
                width={HERO_INTRINSIC.width}
                height={HERO_INTRINSIC.height}
                alt="Two diatonic harmonicas resting on a wooden table in a rehearsal room, with acoustic guitars behind them."
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </div>
          <div className="lp-hero__scrim" />

          <div className="lp-hero__body">
            <div className="lp-wrap">
              <div className="lp-hero__content">
                <h1>Play it.<br />Get the tab.</h1>
                <p className="lp-hero__sub">
                  Harp2Tab turns harmonica playing into harmonica tab — the hole and breath
                  for every note, bends and overblows included. Record from your microphone, or
                  upload an audio or MIDI file.
                </p>
                <div className="lp-tabline" aria-label="Example harmonica tab: 4, minus 4, minus 3 bend, 4 overblow">
                  <span>4</span><span>-4</span><span>-3&apos;</span><span>4o</span><span>5</span><span>-5</span>
                </div>
                <div className="lp-hero__actions">
                  <a className="lp-btn lp-btn--primary" href="/app">Open the app — free, no account</a>
                  <a className="lp-btn lp-btn--ghost" href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
                    Get it on Google Play
                  </a>
                </div>
                <p className="lp-hero__note">
                  Runs in your browser. Nothing to install, and your audio never leaves your device.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ demo */}
        <section className="lp-section" id="demo">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <span className="lp-eyebrow">Hear it work</span>
              <h2>A real harmonica transcription, right here</h2>
              <p className="lp-section__lead">
                Press play. A real harmonica recording is transcribed to tab here in your
                browser — no upload, no account. Then move that same take onto any other harp
                and see what it costs to play.
              </p>
            </div>

            {/* The demo and the key lab are one panel, not two cards: the lab operates on
                whatever the demo just produced, and stacking them inside a single surface is
                what makes that relationship legible rather than incidental. */}
            <div className="lp-panel">
              <SampleDemo onResult={handleDemoResult} />
              <div className="lp-panel__rule" />
              <KeyLab notes={labNotes} sourceKey={labKey} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------- three entry points */}
        <section className="lp-section lp-section--alt" id="how">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <span className="lp-eyebrow">Three ways in</span>
              <h2>Three ways to get harmonica tab</h2>
              <p className="lp-section__lead">
                Play it, upload it, or import a MIDI part. Every route ends in tab you can
                edit and export.
              </p>
            </div>

            <div className="lp-row">
              <div>
                <h3>Record straight from the microphone</h3>
                <p>
                  Pick your harp&apos;s key and play. Pitch detection runs live, so the tab
                  builds up as you go and you can see whether that bend landed where you
                  thought it did. Stop when you are done and the take is waiting in your
                  library.
                </p>
              </div>
              <div className="lp-row__media">
                <div className="lp-tabline"><span>-2</span><span>-3&apos;</span><span>4</span><span>-4</span></div>
                <span className="lp-row__hint">Live pitch detection while you play</span>
              </div>
            </div>

            <div className="lp-row lp-row--flip">
              <div>
                <h3>Turn an audio file into harmonica tab</h3>
                <p>
                  Upload a WAV, MP3 or M4A and Harp2Tab transcribes it, detecting the
                  harmonica key automatically. For the voice memo you recorded months ago and
                  never wrote down.
                </p>
              </div>
              <div className="lp-row__media">
                <span className="lp-legend__sym">.wav .mp3 .m4a</span>
                <span className="lp-row__hint">Key detected automatically</span>
              </div>
            </div>

            <div className="lp-row">
              <div>
                <h3>Convert MIDI to harmonica tab</h3>
                <p>
                  Import a MIDI file, choose the harp you want to play it on, and Harp2Tab maps
                  every note to a hole and breath — flagging the ones that need a bend or an
                  overblow so you can decide whether to keep them or simplify. Multi-track files
                  open in the MIDI Studio, where you can convert any track you like.
                </p>
              </div>
              <div className="lp-row__media">
                <span className="lp-legend__sym">.mid .midi</span>
                <span className="lp-row__hint">Bends and overblows flagged, not hidden</span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ editing */}
        <section className="lp-section" id="editing">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <span className="lp-eyebrow">After the transcription</span>
              <h2>Edit, play back and export your tab</h2>
              <p className="lp-section__lead">
                Two editors over the same take — a list for fixing individual notes, a piano
                roll for seeing the shape of a phrase — with playback and a metronome in both,
                and five export formats when you are done.
              </p>
            </div>

            <div className="lp-row">
              <div>
                <h3>Two editors, one take</h3>
                <p>
                  The list editor is for precision — retype a hole, nudge a duration, delete the
                  note that was a squeak. The piano roll is for shape: drag notes around, see
                  the phrase in time, and work the way you would in a DAW. Both drive the same
                  recording, so you can switch whenever the task changes.
                </p>
              </div>
              <div>
                <h3>Play it back while you work</h3>
                <p>
                  Hear the transcription against a metronome at whatever tempo you like, loop a
                  bar you are unsure about, and check the tab says what you actually played.
                  Multi-track MIDI opens in the MIDI Studio, where any track can become tab.
                </p>
              </div>
            </div>

            <h3 style={{ margin: '56px 0 24px' }}>Export it anywhere</h3>
            <div className="lp-formats">
              {EXPORT_FORMATS.map((format) => (
                <div className="lp-format" key={format}>
                  <span className="lp-format__name">{EXPORT_FORMAT_META[format].label}</span>
                  <span className="lp-format__desc">{EXPORT_FORMAT_META[format].description}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- keys and notation */}
        <section className="lp-section lp-section--alt" id="keys">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <span className="lp-eyebrow">Keys &amp; notation</span>
              <h2>Diatonic and chromatic</h2>
              <p className="lp-section__lead">
                Ten-hole diatonic in all twelve keys, with bends, overblows and overdraws — and
                the twelve-hole chromatic, with the slide written in. Harp2Tab writes the
                notation players already use, whichever harp you picked.
              </p>
            </div>

            <h3 className="lp-subhead">Ten-hole diatonic</h3>
            <div className="lp-legend">
              <div className="lp-legend__item">
                <span className="lp-legend__sym">4</span>
                <span className="lp-legend__desc">Blow into hole 4</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">-4</span>
                <span className="lp-legend__desc">Draw on hole 4</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">-3&apos;</span>
                <span className="lp-legend__desc">Draw bend — a semitone down</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">4o</span>
                <span className="lp-legend__desc">Overblow on hole 4</span>
              </div>
            </div>

            <h3 className="lp-subhead">Twelve-hole chromatic</h3>
            <div className="lp-legend">
              <div className="lp-legend__item">
                <span className="lp-legend__sym">5</span>
                <span className="lp-legend__desc">Blow into hole 5</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">-5</span>
                <span className="lp-legend__desc">Draw on hole 5</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">5+</span>
                <span className="lp-legend__desc">Blow with the slide in</span>
              </div>
              <div className="lp-legend__item">
                <span className="lp-legend__sym">-5+</span>
                <span className="lp-legend__desc">Draw with the slide in</span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ pricing */}
        <section className="lp-section" id="pricing">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <span className="lp-eyebrow">Pricing</span>
              <h2>Free while in beta</h2>
              <p className="lp-section__lead">
                Harp2Tab on the web is free to use right now, in full. These are the plans it
                will move to — web checkout is not open yet.
              </p>
            </div>

            <div className="lp-plans">
              {MOCK_WEB_PLANS.map((plan) => (
                <div
                  className={plan.badge ? 'lp-plan lp-plan--featured' : 'lp-plan'}
                  key={plan.id}
                >
                  {plan.badge && <span className="lp-plan__badge">{plan.badge}</span>}
                  <span className="lp-plan__name">{plan.name}</span>
                  <div>
                    <span className="lp-plan__price">{plan.price}</span>
                    <span className="lp-plan__cadence">{plan.cadence}</span>
                  </div>
                  {plan.note && <p className="lp-plan__note">{plan.note}</p>}
                  <div className="lp-perks">
                    {PLAN_PERKS.map((perk) => (
                      <span className="lp-perk" key={perk}>{perk}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="lp-pricing__foot">
              <p>
                <strong>Everything is free while Harp2Tab is in beta</strong> — open the app and
                use it, no card and no account. Web checkout is coming soon.
              </p>
              <p style={{ marginTop: 12 }}>
                <strong>Bought Harp2Tab on Google Play? You keep lifetime access.</strong> That
                purchase stays honoured; you will never be asked to pay again for what you
                already own.
              </p>
              <p style={{ marginTop: 20 }}>
                <a className="lp-btn lp-btn--primary" href="/app">Open the app — free while in beta</a>
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ faq */}
        <section className="lp-section lp-section--alt" id="faq">
          <div className="lp-wrap">
            <div className="lp-section__head">
              <h2>Harmonica tab questions</h2>
            </div>
            <div className="lp-faq">
              {FAQ.map((item) => (
                // `open` by default so the answers are in the static HTML as visible text —
                // a crawler should not have to simulate a click to read them.
                <details key={item.q} open>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <footer className="lp-footer">
          <div className="lp-wrap lp-footer__row">
            {/* Deliberately no year: this page is prerendered at build time and hydrated
                later, so a `new Date()` here is a hydration mismatch waiting for New Year. */}
            <span>© Chewpaca Studios</span>
            <div className="lp-footer__links">
              <a href="/app">Open the app</a>
              <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">Google Play</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
