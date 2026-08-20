import { Platform, StyleSheet, type ViewStyle } from 'react-native';
import { FONT } from '@/constants/keys';
import { Poppins, SpaceGrotesk } from '@/constants/fonts';
import { webMaxWidth, WEB_CONTENT_WIDTH, WEB_SCREEN_PADDING_TOP, WEB_SCREEN_PADDING_BOTTOM } from '@/constants/layout';
import type { Theme } from '@/theme';

// Collapsed sidebar geometry — one square button plus its 12px gutters.
const SIDEBAR_ICON_BTN = 40;
const SIDEBAR_RAIL_W   = SIDEBAR_ICON_BTN + 24;

/**
 * The editor's stylesheet.
 *
 * Lifted out of `edit.tsx` so the pieces of editor chrome that more than one screen uses
 * — the transport bar, `IconButton`, `Divider` — can be styled without importing the edit
 * *route* module. The MIDI Studio genuinely needs these styles (it renders the same
 * transport bar); before this it reached them via `import { createStyles } from
 * '@/app/edit'`, which pulled a 2,700-line screen component, its store subscriptions and
 * its whole widget tree along for the ride.
 *
 * Still one sheet rather than split per widget: every one of these controls is styled
 * relative to the others (shared control heights, one hover treatment, one tooltip), and
 * splitting it would trade an import for a set of cross-file constants that have to agree.
 */
export function createStyles(t: Theme) {
  return StyleSheet.create({
    safe:      { flex: 1, backgroundColor: t.bg },
    container: {
      flex: 1,
      ...webMaxWidth(WEB_CONTENT_WIDTH.standard),
      paddingHorizontal: 24,
      paddingTop: Platform.OS === 'web' ? WEB_SCREEN_PADDING_TOP : 24,
      paddingBottom: Platform.OS === 'web' ? WEB_SCREEN_PADDING_BOTTOM : 24,
      gap: 16,
    },
    // The piano roll wants the full viewport width (DAW-style grid), unlike every other
    // screen's centered single-column layout — overrides webMaxWidth's cap for that mode.
    containerFullWidth: { maxWidth: '100%' } as ViewStyle,
    // Cancels the container's own paddingHorizontal so the piano-roll panel spans edge
    // to edge (DAW-style), instead of floating inset like every other centered screen.
    pianoRollEdgeWrap: { flex: 1, marginHorizontal: -24 },

    // List view's sidebar shell — same edge-to-edge trick as pianoRollEdgeWrap (cancel
    // container's own paddingHorizontal), plus cancels container's paddingTop too, so
    // the sidebar reaches the true viewport edge on the left AND touches the TopBar
    // above it, like Home's fullSidebar. The bottom edge meets WebTransportBar via that
    // bar's own `glued` variant instead (cancels container's `gap`, not padding here).
    editShellEdgeWrap: { flex: 1, marginHorizontal: -24, marginTop: -WEB_SCREEN_PADDING_TOP },
    editShell: { flexDirection: 'row', flex: 1 },
    // Home's `fullSidebar`, values and all — same width, same plain `railBg` panel, same
    // accent-tinted hairline. It used to be a solid `sidebarBg` fill with white text on
    // translucent-white pills, which was the shape Home's rail started in too; Home moved
    // off it because 300px of colour beside the content it supports had the emphasis
    // backwards, and the note at the top of `AppSidebar` has been asking for this screen to
    // follow ever since. Every row here now carries its own `railBorder` edge, which is what
    // does the separating once the panel underneath stops doing it.
    // Box styling only — a ScrollView's own `style` can't carry padding or gap for its
    // content (those belong on contentContainerStyle below), and `flexGrow: 0` is what
    // stops the ScrollView from expanding past its column.
    editSidebar: {
      width:             300,
      flexGrow:          0,
      flexShrink:        0,
      backgroundColor:   t.railBg,
      borderRightWidth:  1,
      borderRightColor:  t.railBorder,
      // The rail slides rather than snapping between its two widths. Web-only; on native
      // this is a static width change, which is fine — there's no sidebar there.
      ...(Platform.OS === 'web'
        ? { transitionProperty: 'width', transitionDuration: '160ms', transitionTimingFunction: 'ease' }
        : null),
    } as ViewStyle,
    editSidebarContent: {
      gap:               16,
      paddingHorizontal: 20,
      paddingVertical:   28,
    } as ViewStyle,
    // Collapsed rail: one square button wide plus its padding. Width is the only thing
    // that changes on the container — everything inside swaps shape via its own
    // `collapsed` branch rather than being squeezed by the parent.
    editSidebarCollapsed: { width: SIDEBAR_RAIL_W } as ViewStyle,
    editSidebarContentCollapsed: {
      gap:               10,
      paddingHorizontal: 12,
      paddingVertical:   20,
      alignItems:        'center',
    } as ViewStyle,
    // Square icon button for the collapsed rail — `sidebarRow` reduced to its glyph, and
    // now carrying the same inset treatment: one step *down* from the panel, edged with
    // `railBorder`. The collapsed and expanded rails read as the same rail.
    sidebarIconBtn: {
      width:           SIDEBAR_ICON_BTN,
      height:          SIDEBAR_ICON_BTN,
      alignItems:      'center',
      justifyContent:  'center',
      borderRadius:    10,
      backgroundColor: t.bg,
      borderWidth:     1,
      borderColor:     t.railBorder,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // Export when the rail is collapsed. Its fill has to survive collapsing — the point of
    // a single primary is lost if narrowing the rail turns it into another outlined glyph.
    sidebarIconBtnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    sidebarKeyBadgeText: { fontSize: FONT.md, fontFamily: Poppins.bold, color: t.textPrimary },
    // Expanded-state collapse control — quieter than a full sidebarRow (no fill), since
    // it's chrome for the sidebar itself rather than one of the chart's actions.
    sidebarCollapseRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      alignSelf:         'flex-start',
      paddingVertical:   6,
      paddingHorizontal: 8,
      borderRadius:      8,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarCollapseText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    sidebarSectionCollapsed: { gap: 10, alignItems: 'center' } as ViewStyle,
    // Tight vertical rhythm on purpose: this column already stacks a title, the piano
    // roll's own tool row and its bar ruler between the global TopBar above and the
    // transport bar below, and every band of padding here comes straight out of the
    // note grid's height.
    editMainColumn: { flex: 1, paddingHorizontal: 24, paddingTop: 0, gap: 8 },
    // Piano Roll only: no side gutters, so the panel runs from the sidebar's edge to the
    // window's. The grid is the whole point of the screen and every gutter pixel is a
    // pixel of chart; List keeps its gutters, since a full-bleed column of text rows
    // would just be hard to read.
    editMainColumnFlush: { paddingHorizontal: 0 } as ViewStyle,

    // Centered page title for the chart — heading-sized and editable in place. `width:
    // 100%` + centered text (rather than a shrink-to-fit input) keeps the caret and the
    // placeholder centered too, so it reads as a title in both the empty and filled state.
    chartTitleRow: { alignItems: 'center', paddingTop: 2, paddingBottom: 0 },
    chartTitleInput: {
      width:      '100%',
      textAlign:  'center',
      fontSize:   FONT.xl,
      fontFamily: SpaceGrotesk.bold,
      color:      t.textPrimary,
      letterSpacing: -0.4,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: 'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'text' } as any : null),
    } as any,
    // Notion-style: the field's box only appears under the pointer, so the title reads as
    // a heading at rest and as an input the moment you go near it.
    chartTitleInputHovered: { backgroundColor: t.surface },
    chartTitleMeta: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
      textAlign:  'center',
    },

    // The piano roll's in-panel header: name + note count at the head of its tool row.
    // flexShrink lets the name give up width before the toolbar's fixed controls do.
    pianoRollHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
    // Accent-colored and toolbar-sized (FONT.base, down from the page title's FONT.xl) —
    // inside the panel this labels what you're editing rather than titling the page, and
    // the accent is what stops it reading as one more grey control in the row.
    pianoRollTitleInput: {
      fontSize:          FONT.base,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.accent,
      letterSpacing:     -0.2,
      paddingVertical:   3,
      paddingHorizontal: 6,
      borderRadius:      6,
      minWidth:          80,
      maxWidth:          260,
      flexShrink:        1,
      backgroundColor:   'transparent',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none', cursor: 'text' } as any : null),
    } as any,
    pianoRollTitleInputHovered: { backgroundColor: t.surface },
    pianoRollHeaderMeta: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.medium,
      color:      t.textMuted,
      flexShrink: 0,
    },

    // Add Note as a trailing card in the list itself, matching TabCard's own shape
    // (same radius/vertical rhythm) but dashed/outlined and centered — reads as "the
    // next row" rather than a toolbar action once it's the flatlist's own footer.
    addNoteCard: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               8,
      marginVertical:    3,
      // TabCard's rows are two lines tall (a label over a value) plus its own
      // paddingVertical:10 — this is one centered line, so it needs an explicit
      // minHeight (not just matching paddingVertical) to read as the same row height
      // rather than a visibly shorter card.
      minHeight:         52,
      borderRadius:      10,
      borderWidth:       1.5,
      borderStyle:       'dashed',
      borderColor:       t.border,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    addNoteCardHovered: { backgroundColor: t.surface, borderColor: t.accent },
    addNoteCardText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.accent },

    sidebarSection: { gap: 8 },
    sidebarSectionLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textSub,
      letterSpacing: 1,
      marginBottom:  2,
    },
    // alignSelf: 'stretch' rather than relying on the container's default — the collapsed
    // rail centers its children, and a zero-width divider would just vanish there.
    sidebarDivider: { height: 1, alignSelf: 'stretch', backgroundColor: t.separator },
    chartNameInputSidebar: {
      fontSize:          13,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.textPrimary,
      backgroundColor:   t.bg,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.railBorder,
      paddingHorizontal: 10,
      paddingVertical:   8,
      width:             '100%',
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    } as any,

    // Sidebar's always-visible key/type picker — same pattern as Home's own sidebar
    // (plain selectable rows + KeyGrid's default variant) instead of the toolbar's
    // dropdown-behind-a-badge treatment, since there's no reason to hide it here.
    // Home's `sidebarPickerPanel`, and it is doing real work rather than decoration:
    // `KeyGrid`'s cells are filled with `surface`, which in dark mode (#232329) is within a
    // hair of the rail itself (#202027) — sat directly on the panel the grid would be a
    // block of near-invisible squares held together by a 10%-alpha hairline. One step *down*
    // to `bg` behind them is what gives every cell an edge.
    sidebarPickerPanel: {
      gap:             10,
      padding:         12,
      borderRadius:    12,
      backgroundColor: t.bg,
      borderWidth:     1,
      borderColor:     t.railBorder,
    },
    sidebarTypeToggle: {
      flexDirection:   'row',
      backgroundColor: t.surfaceAlt,
      borderRadius:    8,
      padding:         2,
      gap:             2,
    },
    sidebarTypeSeg: {
      flex:              1,
      alignItems:        'center',
      paddingVertical:   7,
      borderRadius:      6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    // The accent moved from the panel to the selection. On a plain rail the active segment
    // no longer needs to be a white pill fighting a cyan ground — it can just *be* the
    // accent, which is how Home's `sidebarTypeRowActive` marks the same choice.
    sidebarTypeSegActive: { backgroundColor: t.accent },
    sidebarTypeText:       { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    // White on the accent fill. `accentDeep` was for the old white pill; on solid accent
    // it is white that reads, exactly as on Home's primary row.
    sidebarTypeTextActive: { color: '#fff' },
    // Sits under the Transpose/Translate toggle. Quieter than the segment labels because
    // it's a consequence, not a control — but the gap between the two toggles keeps it
    // clearly attached to the one above rather than reading as a label for
    // Diatonic/Chromatic below.
    sidebarKeyModeHint: {
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textMuted,
      marginTop:  -4,
    },

    // Sidebar action rows — Home's `sidebarRow` exactly: inset one step *down* from the
    // panel (`bg`, under `surface`) so a row reads as a control cut into the rail rather
    // than a card stacked on it, edged with `railBorder` rather than plain `border`. On a
    // panel at the same fill the border is the only thing drawing the row, and a neutral
    // hairline at that job reads as an accident instead of an edge.
    sidebarRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      backgroundColor:   t.bg,
      borderWidth:       1,
      borderColor:       t.railBorder,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarRowPressed:   { backgroundColor: t.surfaceAlt, borderColor: t.accent },
    sidebarRowDisabled:  { opacity: 0.55 },
    // The theme's warning colours now that the panel is a normal surface — they were
    // avoided here only because they are tuned for the app background and the rail was not
    // one. Same treatment as Home's own `uploadError`.
    sidebarUploadError: {
      flexDirection:     'row',
      alignItems:        'flex-start',
      gap:               6,
      paddingHorizontal: 10,
      paddingVertical:   8,
      borderRadius:      8,
      backgroundColor:   t.warningSoft,
    },
    sidebarUploadErrorText: {
      flex:       1,
      fontSize:   FONT.xs,
      fontFamily: Poppins.regular,
      color:      t.textPrimary,
    },
    sidebarRowIconWrap:  { width: 20, alignItems: 'center', justifyContent: 'center' },
    sidebarRowText:      { flex: 1, fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary },

    // Undo/Redo side by side — a paired row instead of two full-width stacked rows,
    // since neither needs a trailing chevron/badge and both read fine as compact,
    // centered half-width buttons.
    sidebarRowSplit: { flexDirection: 'row', gap: 8 },
    sidebarRowHalf:  { flex: 1, justifyContent: 'center' },
    sidebarRowHalfText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textPrimary },

    // The one accent-filled object on the rail, which is the whole point of taking the
    // accent off the panel behind it — the same role Start Recording plays on Home. Export
    // is what you came to this screen to finish, and it was already the one action here
    // with a style of its own rather than a plain `sidebarRow`.
    sidebarExportBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      paddingHorizontal: 12,
      borderRadius:      10,
      backgroundColor:   t.accent,
      borderWidth:       1,
      borderColor:       t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    sidebarExportBtnPressed: { backgroundColor: t.accentDim, borderColor: t.accentDim },
    /** Label and glyph on the Export fill. */
    sidebarExportText: { flex: 1, fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: '#fff' },

    // "Soon" tag on the sidebar's disabled Upload row — same pattern as the coming-soon
    // badges on Home's own not-yet-wired upload buttons.
    sidebarComingSoon: {
      fontSize:          9,
      fontFamily:        Poppins.bold,
      color:             t.textMuted,
      letterSpacing:     0.6,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      6,
      paddingHorizontal: 5,
      paddingVertical:   2,
    },

    // New Recording's key/type picker — a real centered Modal (same backdrop/card
    // pattern as ActionSheetModal/NameRecordingModal) rather than an anchored dropdown,
    // since choosing where the next session starts is a deliberate, focused decision,
    // not a quick inline tweak — it deserves the whole screen's attention for a moment.
    newRecordingBackdrop: {
      flex:              1,
      backgroundColor:   'rgba(0,0,0,0.65)',
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 32,
    },
    newRecordingCard: {
      backgroundColor:   t.bg,
      borderRadius:      20,
      paddingHorizontal: 24,
      paddingVertical:   24,
      gap:               12,
      width:             '100%',
      maxWidth:          480,
      borderWidth:       1,
      borderColor:       t.border,
    },
    newRecordingTitle: {
      fontSize:      FONT.lg,
      fontFamily:    SpaceGrotesk.bold,
      color:         t.textPrimary,
      textAlign:     'center',
      letterSpacing: -0.3,
    },
    newRecordingCancel: { alignItems: 'center', paddingVertical: 4 },
    newRecordingCancelText: { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },

    sidebarPopoverLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1,
    },
    sidebarPopoverConfirm: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'center',
      gap:               6,
      paddingVertical:   10,
      borderRadius:      8,
      backgroundColor:   t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    sidebarPopoverConfirmHover: { backgroundColor: t.accentDim },
    sidebarPopoverConfirmText: { fontSize: 12, fontFamily: Poppins.bold, color: '#fff' },

    header:    { gap: 4 },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    viewModeRow: {
      flexDirection:   'row',
      backgroundColor: t.surface,
      borderRadius:    12,
      padding:         3,
      gap:             3,
    },
    viewModeSeg: {
      flex:            1,
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             6,
      paddingVertical: 8,
      borderRadius:    10,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    viewModeSegActive: { backgroundColor: t.accent },
    viewModeText:       { fontSize: FONT.sm, fontFamily: Poppins.semiBold, color: t.textSub },
    viewModeTextActive: { color: '#fff' },

    tempoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    keyBadge: {
      backgroundColor:   t.surface,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 10,
      paddingVertical:   7,
    },
    keyBadgeText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    bpmControl: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               8,
      backgroundColor:   t.surface,
      borderRadius:      8,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
    },
    bpmStepBtn: { padding: 2 },
    bpmValue: {
      fontSize:    FONT.xs,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      minWidth:    54,
      textAlign:   'center',
      fontVariant: ['tabular-nums'],
    },
    // Sized and skinned like the metronome toggle beside it, since both are icon actions
    // hanging off the BPM readout — but it's a momentary action, not a state, so it has no
    // "active" variant.
    detectBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               4,
      height:            32,
      borderRadius:      8,
      paddingHorizontal: 9,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
    },
    detectBtnText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    // Replaces the row's controls' usual quiet for a moment after a detection, then goes.
    // Inline rather than a toast because it's an answer to a button two inches away.
    detectResult: { fontSize: FONT.xs, fontFamily: Poppins.regular, color: t.textMuted, flexShrink: 1 },

    metronomeBtn: {
      width:            32,
      height:           32,
      borderRadius:     8,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.surface,
      borderWidth:      1,
      borderColor:      t.border,
    },
    metronomeBtnActive: { backgroundColor: t.accent, borderColor: t.accent },

    gearBtn:   { padding: 4 },
    title:     { fontSize: FONT.xl, fontFamily: SpaceGrotesk.bold, color: t.accent, letterSpacing: -0.5 },
    subtitle: { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted },
    list:     { flex: 1 },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },

    emptyTitle: { fontSize: FONT.md, fontFamily: Poppins.bold,    color: t.textSub },
    emptyHint:  { fontSize: FONT.sm, fontFamily: Poppins.regular, color: t.textMuted, textAlign: 'center' },
    // Web-only empty-state extras — icon badge + a real, working CTA (no fabricated
    // import/upload buttons for features that don't exist yet).
    emptyIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentSoft,
      marginBottom: 4,
    },
    emptyCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    emptyCtaText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
    playBtn: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             8,
      paddingVertical: 14,
      borderRadius:    14,
      borderWidth:     1,
      backgroundColor: t.surface,
      borderColor:     t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    playBtnText: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.accent },
    playBtnTime: {
      fontSize:    FONT.sm,
      fontFamily:  Poppins.regular,
      color:       t.textMuted,
      fontVariant: ['tabular-nums'],
    },

    actions: { flexDirection: 'row', gap: 10 },

    btn: {
      flex:            1,
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      paddingVertical: 16,
      borderRadius:    14,
      borderWidth:     1,
      gap:             5,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as ViewStyle,
    btnGhost: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnOutlined: {
      backgroundColor: t.surface,
      borderColor:     t.accent,
    },
    btnFilled: {
      backgroundColor: t.accent,
      borderColor:     t.accent,
    },
    btnFilledDisabled: {
      backgroundColor: t.surface,
      borderColor:     t.border,
    },
    btnPressed: { opacity: 0.7 },

    btnTextGhost:    { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.textSub },
    btnTextOutlined: { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: t.accent },
    btnTextFilled:   { fontSize: FONT.base, fontFamily: Poppins.semiBold, color: '#fff' },
    btnTextDisabled: { color: t.textMuted },

    // ─── Web-only toolbar / transport bar — compact desktop chrome, not the mobile
    // stacked-touch-target styles above (those stay for native).
    webToolbar: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: t.separator,
      flexWrap:        'wrap',
      gap:             10,
      // A nested z-index (see keyDropdown below) only outranks siblings within its own
      // parent's stacking context — without this, the toolbar's own un-indexed siblings
      // (the piano roll / list view below it) would paint over the key dropdown
      // regardless of any z-index nested inside it. Same lesson as PianoRoll.tsx's
      // toolbarRow/rulerRow.
      zIndex: 20,
    },
    // Piano-roll mode: the panel below is its own bordered/rounded box (see
    // PianoRoll.tsx's `outer` style), so a second separating line here is redundant —
    // same reasoning as webTransportBarGlued at the other end of the panel. List view
    // keeps the border; it has no boxed panel of its own to make this line redundant.
    webToolbarGlued: { borderBottomWidth: 0 },
    webToolbarGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    // Separates logical clusters (View / Project / Edit / Actions / Export) within a
    // toolbar row — increased spacing plus a visible rule reads more clearly as
    // "distinct groups" than gap alone.
    toolbarDivider: { width: 1, height: 20, backgroundColor: t.separator, marginHorizontal: 2 },

    // Wraps every IconButton so its hover tooltip can be absolutely positioned relative
    // to just that button, not the whole toolbar row.
    iconBtnWrap: { position: 'relative' },
    tooltip: {
      position: 'absolute',
      left: 0,
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 5,
      backgroundColor: t.textPrimary,
      zIndex: 20,
      ...(Platform.OS === 'web' ? { boxShadow: '0 2px 6px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' } : null),
    } as any,
    // Placement is a per-control choice, not a constant: the top toolbar has room beneath
    // its buttons, the transport bar sits on the bottom edge of the screen in both hosts
    // and a tooltip drawn below it lands past the viewport edge, clipped.
    tooltipBelow: { top: '100%', marginTop: 6 },
    tooltipAbove: { bottom: '100%', marginBottom: 6 },
    tooltipText: { fontSize: 10, fontFamily: Poppins.semiBold, color: t.bg },

    webNoteCount: { fontSize: 12, fontFamily: Poppins.regular, color: t.textMuted },

    // The key/type picker lives only in the sidebar (see KeyTypeControl). The toolbar badge
    // that used to open it as a dropdown was unreachable — WebToolbar renders only when the
    // sidebar doesn't, i.e. when there are no notes, and the badge required notes — so it
    // and its styles are gone. The keyDropdown* names below survive because the New
    // Recording modal still uses them for its own key/type picker.
    keyDropdownTypeToggle: {
      flexDirection: 'row',
      backgroundColor: t.surface,
      borderRadius: 8,
      padding: 2,
      gap: 2,
    },
    keyDropdownTypeSeg: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 6,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    keyDropdownTypeSegActive: { backgroundColor: t.accent },
    keyDropdownTypeText: { fontSize: FONT.xs, fontFamily: Poppins.semiBold, color: t.textSub },
    keyDropdownTypeTextActive: { color: '#fff' },
    keyDropdownDivider: { height: 1, backgroundColor: t.border },

    chartNameInput: {
      fontSize:          13,
      fontFamily:        SpaceGrotesk.bold,
      color:             t.textPrimary,
      backgroundColor:   t.surface,
      borderRadius:      6,
      borderWidth:       1,
      borderColor:       t.border,
      paddingHorizontal: 8,
      paddingVertical:   4,
      minWidth:          100,
      maxWidth:          220,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
    } as any,

    exportAnchor: { position: 'relative' },
    exportDropdown: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: 6,
      width: 280,
      backgroundColor: t.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      padding: 10,
      gap: 8,
      zIndex: 20,
      ...(Platform.OS === 'web' ? { boxShadow: t.isDark ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.15)' } : null),
    } as any,
    exportDropdownLabel: {
      fontSize:      FONT.xs,
      fontFamily:    Poppins.bold,
      color:         t.textMuted,
      letterSpacing: 1.2,
      paddingHorizontal: 2,
    },
    exportFormatGroup: {
      backgroundColor: t.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
    },
    exportDropdownActions: { flexDirection: 'row', gap: 8 },
    exportDropdownSaveBtn: {
      flex: 1,
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            6,
      paddingVertical: 10,
      borderRadius:    8,
      borderWidth:     1,
      borderColor:     t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    exportDropdownSaveBtnText: { fontSize: 12, fontFamily: Poppins.bold, color: t.accent },
    exportDropdownShareBtn: {
      flex: 1,
      flexDirection:  'row',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            6,
      paddingVertical: 10,
      borderRadius:    8,
      backgroundColor: t.accent,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
    } as any,
    exportDropdownShareBtnText: { fontSize: 12, fontFamily: Poppins.bold, color: '#fff' },

    // No background/border of its own anymore — sits inside webTransportGroup's pill,
    // which is now the only visual boundary in this cluster (a box-within-a-box read
    // busier, not more polished).
    webBpmControl: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               4,
      paddingHorizontal: 4,
    },
    webMiniStepBtn: { padding: 2, cursor: 'pointer' } as any,
    webBpmValue: {
      fontSize:    11,
      fontFamily:  Poppins.semiBold,
      color:       t.textSub,
      minWidth:    46,
      textAlign:   'center',
      fontVariant: ['tabular-nums'],
    },

    webIconBtn: {
      width:            26,
      height:           26,
      borderRadius:     6,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.surface,
      borderWidth:      1,
      borderColor:      t.border,
      cursor:           'pointer',
    } as any,
    webIconBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
    webIconBtnHover:  { backgroundColor: t.surfaceAlt },
    // Export gets the one filled/accent treatment in the toolbar — it's the "finish"
    // action, everything else is a neutral utility icon.
    webIconBtnAccent: { backgroundColor: t.accent, borderColor: t.accent },
    exportBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 12,
      height:            26,
      borderRadius:      6,
      backgroundColor:   t.accent,
      cursor:            'pointer',
    } as any,
    exportBtnText: { fontSize: 12, fontFamily: Poppins.semiBold, color: '#fff' },
    // "New Recording" gets a labeled button, not just an icon — a bare mic glyph reads
    // ambiguous (record? playback?) next to Export's icon+text pattern right beside it.
    newBtn: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      paddingHorizontal: 12,
      height:            30,
      borderRadius:      6,
      backgroundColor:   t.surface,
      borderWidth:       1,
      borderColor:       t.border,
      cursor:            'pointer',
    } as any,
    newBtnText: { fontSize: 12, fontFamily: Poppins.semiBold, color: t.textSub },

    // Same reasoning as webBpmControl — no border/bg of its own, blends into the
    // enclosing pill.
    webSpeedBtn: {
      minWidth:          30,
      height:            22,
      alignItems:        'center',
      justifyContent:    'center',
      paddingHorizontal: 6,
      borderRadius:      6,
      cursor:            'pointer',
    } as any,
    webSpeedBtnText: { fontSize: 11, fontFamily: Poppins.semiBold, color: t.textSub, fontVariant: ['tabular-nums'] },

    // Docked footer — full viewport width (matches the edge-to-edge sidebar/panel it
    // sits directly against), its own surface tone + upward shadow so it reads as a
    // distinct floating dock rather than a plain strip of page background.
    webTransportBar: {
      flexDirection:     'row',
      alignItems:        'center',
      justifyContent:    'space-between',
      paddingVertical:   14,
      paddingHorizontal: 28,
      marginHorizontal:  -24,
      // Now that this bar has its own opaque surface, container's paddingBottom (below
      // this, its last child) would otherwise show through as a bare strip of page
      // background beneath it — cancel it so the bar's own padding is the real bottom
      // inset, flush to the true viewport edge like the sidebar is to the top edge.
      marginBottom:      Platform.OS === 'web' ? -WEB_SCREEN_PADDING_BOTTOM : 0,
      backgroundColor:   t.surface,
      borderTopWidth:    1,
      borderTopColor:    t.separator,
      ...(Platform.OS === 'web'
        ? { boxShadow: t.isDark ? '0 -6px 18px rgba(0,0,0,0.35)' : '0 -6px 18px rgba(0,0,0,0.06)' } as any
        : null),
    },
    // Piano-roll/list-sidebar mode: cancels container's own `gap` (the visible space
    // between the panel/sidebar and this bar) and drops the top border, so the transport
    // bar reads as their own footer row rather than a separate floating element below.
    webTransportBarGlued: {
      marginTop: -16,
      borderTopWidth: 0,
    },
    webTransportBarCompact: { paddingVertical: 8 },
    webTransportSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
    // Speed stepper + elapsed/total time need to sit side-by-side, not the View default
    // of stacking vertically — this side now holds two elements, not just the time text.
    webTransportSideRight: { justifyContent: 'flex-end' },
    // Shared pill wrapper for each cluster (Loop/BPM/Metronome, and Speed/Time) — a
    // single rounded surface per group reads as "one control cluster" far more clearly
    // than each individual control carrying its own separate border/box.
    webTransportGroup: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               6,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      20,
      paddingHorizontal: 10,
      paddingVertical:   5,
    },
    webTransportCenter: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               12,
      backgroundColor:   t.surfaceAlt,
      borderRadius:      24,
      paddingHorizontal: 12,
      paddingVertical:   6,
    },
    // The one circular control in this UI, deliberately — a play/pause transport button
    // reads as "the" primary action the way a small square icon button doesn't. Sized up
    // and given real depth (shadow) so it reads as the bar's obvious focal point.
    webPlayCircle: {
      width:            40,
      height:           40,
      borderRadius:      20,
      alignItems:       'center',
      justifyContent:   'center',
      backgroundColor:  t.accent,
      cursor:           'pointer',
      ...(Platform.OS === 'web'
        ? { boxShadow: `0 3px 10px ${t.accent}66` } as any
        : null),
    } as any,
    webPlayCircleCompact:  { width: 32, height: 32, borderRadius: 16 },
    webPlayCircleHover:    { backgroundColor: t.accentDim },
    webPlayCircleDisabled: { backgroundColor: t.surface, boxShadow: 'none' } as any,
    // textSub, not textMuted — this is the only readout of elapsed-of-total anywhere on
    // the screen, and at #A1A1AA on white it was sitting around 2.3:1.
    webPlayTime: {
      fontSize:    12,
      fontFamily:  Poppins.medium,
      color:       t.textSub,
      minWidth:    36,
      textAlign:   'right',
      fontVariant: ['tabular-nums'],
    },

    webBtnDisabled:     { backgroundColor: t.surface },
    webBtnHover:         { opacity: 0.7 },
    webBtnHoverFilled:   { backgroundColor: t.accentDim },
  });
}

export type EditStyles = ReturnType<typeof createStyles>;
