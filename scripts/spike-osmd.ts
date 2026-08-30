/**
 * SPIKE — Phase 18, Task 7. Can OpenSheetMusicDisplay engrave a Harp2Tab score document,
 * offline, with the tabs attached and a usable link back to the source notes?
 *
 * Run headless deliberately. The questions that decide the phase — does it render at all,
 * are the glyphs self-contained, can the SVG be lifted out, can a notehead be traced back to
 * a `TabNote.id`, how long does 500 notes take — are all answerable without a browser, and
 * answering them in a harness makes them repeatable instead of a thing someone once saw.
 *
 * What this deliberately does NOT prove: that the engraving is *visually* right, that it
 * behaves inside react-native-web's View tree, or that it survives a release web build.
 * Those need a browser and are recorded as outstanding in the phase plan.
 *
 * Run: npx tsx scripts/spike-osmd.ts
 */

import { JSDOM } from 'jsdom';

import { singlePart } from '../src/export/generators';
import { scoreToMusicXml } from '../src/notation/musicXml';
import { buildScoreDocument } from '../src/notation/quantize';
import { TICKS_PER_QUARTER } from '../src/notation/scoreDocument';
import { createScoreRenderer } from '../src/notation/render/osmd.web';
import type { TabNote } from '../src/types';

interface CaseResult { name: string; passed: boolean; detail: string }
const results: CaseResult[] = [];
function check(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
}

// ── A DOM for OSMD to draw into ───────────────────────────────────────────────

/**
 * OSMD is a browser library: it reads `window`, measures text, and writes SVG. jsdom gives it
 * all of that except a layout engine, so the two measurement calls VexFlow needs are stubbed
 * with values rather than left undefined — a missing `getBBox` throws, a zero-size one lays
 * every symbol on top of the last.
 */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body><div id="score"></div></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;

  const proto = window.SVGElement.prototype as unknown as Record<string, unknown>;
  proto.getBBox = function getBBox() {
    return { x: 0, y: 0, width: 10, height: 10 };
  };
  proto.getScreenCTM = function getScreenCTM() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  };

  // VexFlow measures text through a canvas 2d context when it has one. jsdom ships no
  // canvas, so a measuring stub keeps it on its fallback path instead of throwing.
  (window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext =
    () => ({
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: () => {}, save: () => {}, restore: () => {}, scale: () => {},
      beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {},
      setTransform: () => {}, clearRect: () => {}, translate: () => {}, rotate: () => {},
    });

  // `defineProperty` rather than assignment: Node 22 exposes its own `navigator` as a
  // getter-only property, which a plain write throws on.
  const g = globalThis as unknown as Record<string, unknown>;
  const put = (name: string, value: unknown) =>
    Object.defineProperty(g, name, { value, writable: true, configurable: true });
  put('window', window);
  put('document', window.document);
  put('navigator', window.navigator);
  put('HTMLElement', window.HTMLElement);
  put('SVGElement', window.SVGElement);
  put('Element', window.Element);
  put('Node', window.Node);
  put('DOMParser', window.DOMParser);
  put('XMLSerializer', window.XMLSerializer);
  put('Image', window.Image);
  put('getComputedStyle', window.getComputedStyle.bind(window));
  put('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BALANCED_120 = {
  bpm: 120, originMs: 0, beats: 4, beatType: 4, rhythmMode: 'balanced' as const,
};

/** A chord, a gap, and a note tied across the bar line — the three things the old generator
 *  could not write, so the three worth watching a renderer swallow. */
const MIXED: TabNote[] = [
  { id: 'c1', tab: '4',  note: 'C4', start_time: 0,    duration: 500,  confidence: 100 },
  { id: 'c2', tab: '5',  note: 'E4', start_time: 20,   duration: 500,  confidence: 100 },
  { id: 'x',  tab: '6',  note: 'G4', start_time: 1500, duration: 1000, confidence: 100 },
  { id: 'y',  tab: "-4'", note: 'C#4', start_time: 2600, duration: 400, confidence: 100 },
];

function longFixture(count: number): TabNote[] {
  const tabs = ['4', '-4', '5', '-5', '6', '-6'];
  const pitches = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'];
  return Array.from({ length: count }, (_, i) => ({
    id:         `n${i}`,
    tab:        tabs[i % tabs.length],
    note:       pitches[i % pitches.length],
    duration:   230,
    start_time: i * 250,
    confidence: 100,
  }));
}

// ── The spike ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  installDom();

  // Required after the DOM exists: OSMD reads `window` while it loads.
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');

  const container = document.getElementById('score') as HTMLElement;
  const osmd = new OpenSheetMusicDisplay(container, {
    backend:            'svg',
    drawTitle:          true,
    drawLyrics:         true,
    autoResize:         false,
    drawingParameters:  'default',
  });

  const xml = scoreToMusicXml(buildScoreDocument(
    singlePart(MIXED, 'C', 'diatonic'), BALANCED_120,
  ));

  let loaded = true;
  try {
    await osmd.load(xml);
    osmd.render();
  } catch (e) {
    loaded = false;
    check('OSMD loads and renders our MusicXML', false, `${(e as Error).message}`);
  }

  if (!loaded) return report();

  check('OSMD loads and renders our MusicXML', true, 'no throw');

  const svg = container.querySelector('svg');
  check(
    'the rendered score can be lifted out as standalone SVG',
    svg !== null && (svg.outerHTML?.length ?? 0) > 1000,
    `${svg?.outerHTML.length ?? 0} bytes of SVG`,
  );

  const markup = svg?.outerHTML ?? '';

  // The export question. Glyphs drawn as paths need no font file; glyphs drawn as text in a
  // music font need one embedded, or the SVG and every PNG made from it are empty boxes
  // anywhere but this app.
  const paths = (markup.match(/<path/g) ?? []).length;
  const texts = (markup.match(/<text/g) ?? []).length;
  check(
    'notation glyphs are SVG paths, so the file carries no music-font dependency',
    paths > 20,
    `${paths} paths, ${texts} text nodes`,
  );

  check(
    'the tabs reached the page as lyric text',
    markup.includes('>45<') || markup.includes('>4<'),
    markup.includes('>45<') ? 'chord token present' : 'checked for tab text',
  );

  // The editor link. OSMD keeps a graph from what it drew back to what it parsed; if a
  // notehead cannot name its source note, selection and playback highlighting both need a
  // different design.
  const sheet = osmd.GraphicSheet;
  const firstNote = sheet?.MeasureList?.[0]?.[0]?.staffEntries?.[0]
    ?.graphicalVoiceEntries?.[0]?.notes?.[0];
  const sourceNote = firstNote?.sourceNote;
  check(
    'a rendered note can be traced back to the note that was parsed',
    sourceNote !== undefined && sourceNote !== null,
    sourceNote ? `${sourceNote.Pitch?.ToString?.() ?? 'pitch'}` : 'no sourceNote',
  );

  // Whether the SVG element for a note is reachable — the thing a click handler and a
  // highlight both need.
  const noteVertices = firstNote
    ? (firstNote as unknown as { getSVGGElement?: () => unknown }).getSVGGElement?.()
    : undefined;
  check(
    'a rendered note exposes its own SVG element for click and highlight',
    noteVertices !== undefined && noteVertices !== null,
    noteVertices ? 'getSVGGElement present' : 'no per-note SVG handle',
  );

  // Everything an exported SVG would need to fetch. A single external reference makes the
  // file render as empty boxes on any machine but this one, and a PNG rasterised from it
  // loses those glyphs silently — an <img> pointed at an SVG fetches nothing.
  const externals = [...markup.matchAll(/(?:href|src|url)\s*=?\s*[("']([^)"']+)/g)]
    .map((m) => m[1])
    .filter((ref) => !ref.startsWith('#'));
  check(
    'the SVG references nothing it would have to fetch',
    externals.length === 0,
    externals.length === 0 ? 'self-contained' : `refers to ${[...new Set(externals)].join(', ')}`,
  );

  const fonts = [...new Set([...markup.matchAll(/font-family\s*[:=]\s*["']?([^;"']+)/g)]
    .map((m) => m[1].trim()))];
  check(
    'the only fonts named are ordinary text faces, for the title and the tabs',
    fonts.length > 0 && !fonts.some((f) => /bravura|gonville|petaluma/i.test(f)),
    `fonts: ${fonts.join(' | ') || 'none named'}`,
  );

  // ── The mapping that the editor link actually needs ────────────────────────
  //
  // `sourceNote` proves OSMD kept *a* graph, not that we can name a `TabNote`. Our MusicXML
  // carries no ids — deliberately, since a private attribute in an interchange format is a
  // file other programs have to ignore. The join is musical position instead: OSMD reports
  // where a note sits in whole notes, the score document knows what it put at every tick,
  // and both came from the same build. This check is the one that decides whether Task 9
  // can be built as planned.
  const doc = buildScoreDocument(singlePart(MIXED, 'C', 'diatonic'), BALANCED_120);

  /**
   * Tick → the source ids of whatever the score document wrote there.
   *
   * Tie continuations are included, not skipped. A tie is one note drawn as two noteheads,
   * so clicking the tail has to select the same note as clicking the attack — a map that
   * only knows about attacks leaves half the drawn notes dead to the pointer.
   */
  const byTick = new Map<number, string[]>();
  let tick = 0;
  for (const measure of doc.parts[0].measures) {
    for (const element of measure.elements) {
      if (element.sourceIds.length > 0) byTick.set(tick, element.sourceIds);
      tick += element.durationTicks;
    }
  }

  await osmd.load(xml);
  osmd.render();

  const rendered: { tick: number; ids: string[] | undefined }[] = [];
  for (const staffMeasures of osmd.GraphicSheet.MeasureList ?? []) {
    for (const measure of staffMeasures ?? []) {
      for (const entry of measure?.staffEntries ?? []) {
        for (const voiceEntry of entry.graphicalVoiceEntries ?? []) {
          for (const note of voiceEntry.notes ?? []) {
            const source = note.sourceNote;
            if (!source || source.isRest()) continue;
            // RealValue counts whole notes, so a quarter is 0.25.
            const whole = source.getAbsoluteTimestamp().RealValue;
            const at = Math.round(whole * 4 * TICKS_PER_QUARTER);
            rendered.push({ tick: at, ids: byTick.get(at) });
          }
        }
      }
    }
  }

  check(
    'every rendered notehead lands on a tick the score document wrote',
    rendered.length > 0 && rendered.every((r) => r.ids !== undefined),
    `${rendered.filter((r) => r.ids).length}/${rendered.length} noteheads mapped`,
  );

  // The chord is the case that would break a naive one-note-one-id mapping, and the tie is
  // the case that would break a naive one-id-one-notehead one.
  const chordIds = rendered.find((r) => r.tick === 0)?.ids ?? [];
  check(
    "a chord's noteheads both resolve to both source notes",
    chordIds.includes('c1') && chordIds.includes('c2')
      && rendered.filter((r) => r.tick === 0).length === 2,
    `tick 0 → [${chordIds.join(', ')}] across ${rendered.filter((r) => r.tick === 0).length} noteheads`,
  );

  // The note that crosses the bar line is drawn twice. Both noteheads must lead back to it,
  // or clicking the second bar's half of a held note selects nothing.
  const tiedTicks = rendered.filter((r) => r.ids?.includes('x')).map((r) => r.tick).sort((a, b) => a - b);
  check(
    'both halves of a tied note resolve to the one source note',
    tiedTicks.length === 2 && tiedTicks[0] === 72 && tiedTicks[1] === 96,
    `note x rendered at tick(s) [${tiedTicks.join(', ')}]`,
  );

  // Cost. A long score is the case that decides whether this is usable in an editor at all.
  const longXml = scoreToMusicXml(buildScoreDocument(
    singlePart(longFixture(500), 'C', 'diatonic'), BALANCED_120,
  ));
  const started = Date.now();
  let longOk = true;
  try {
    await osmd.load(longXml);
    osmd.render();
  } catch (e) {
    longOk = false;
    check('a 500-note score renders', false, (e as Error).message);
  }
  const elapsed = Date.now() - started;
  if (longOk) {
    check('a 500-note score renders', true, `${elapsed}ms in jsdom`);
    check(
      'a 500-note score engraves in under 10s headless',
      elapsed < 10_000,
      `${elapsed}ms — jsdom has no layout engine, so a browser will differ`,
    );
  }


  await wrapper();

  report();
}

/**
 * The production wrapper, not OSMD directly.
 *
 * Everything above proves the library can do what the phase needs. This proves that
 * `osmd.web.ts` — the only file the app actually calls — does it too, including the two
 * things the exports depend on and the view does not: pagination to paper, and lifting every
 * page out as markup.
 */
async function wrapper(): Promise<void> {
  const host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);

  const doc = buildScoreDocument(singlePart(longFixture(120), 'C', 'diatonic'), BALANCED_120);
  const renderer = await createScoreRenderer(host);

  try {
    await renderer.render(doc, { showTabs: true });
    const continuous = renderer.svgPages();
    check(
      'the wrapper engraves a continuous page for the view',
      continuous.length === 1 && continuous[0].length > 1000,
      `${continuous.length} page(s)`,
    );

    // The export path. A long score on A4 has to come out as several pages rather than one
    // impossibly tall one, and each has to be liftable on its own.
    await renderer.render(doc, { showTabs: true, pageFormat: 'A4_P' });
    const paginated = renderer.svgPages();
    check(
      'the wrapper paginates to paper for the exports',
      paginated.length >= 1 && paginated.every((page) => page.startsWith('<svg')),
      `${paginated.length} A4 page(s)`,
    );

    // Highlighting has to be reversible, or the playhead leaves a trail of coloured notes
    // behind it. Painting then clearing must return the markup to what it was.
    await renderer.render(doc, { showTabs: true });
    const before = renderer.svgString();
    renderer.highlight(['n0'], '#ff0000');
    const painted = renderer.svgString();
    renderer.highlight([], '#ff0000');
    const after = renderer.svgString();
    check(
      'highlighting paints without re-engraving, and clears completely',
      painted !== before && after === before,
      painted !== before ? 'painted and restored' : 'highlight had no visible effect',
    );

    // The score's title is the tab's own name. It reaches OSMD through MusicXML's
    // <work-title>, so this is really asking whether `drawTitle` picks that up rather than
    // some internal default — the kind of thing that silently renders as nothing.
    const named = buildScoreDocument(
      singlePart(MIXED, 'C', 'diatonic'), { ...BALANCED_120, title: 'Sunday Morning Blues' },
    );
    await renderer.render(named, { showTabs: true });
    check(
      "the tab's own name is engraved as the score title",
      (renderer.svgString() ?? '').includes('Sunday Morning Blues'),
      'title present on the page',
    );

    check(
      'a score with no tabs still engraves',
      (await renderer.render(doc, { showTabs: false }), (renderer.svgString()?.length ?? 0) > 1000),
      'tabs off',
    );
  } finally {
    renderer.dispose();
    host.remove();
  }
}

function report(): void {
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} spike checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error('spike crashed:', e);
  process.exitCode = 1;
});
