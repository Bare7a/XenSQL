// Package windowstate remembers the window's size, position and mode (maximised / fullscreen / normal) across launches.
// It lives in settings.json under one key, so it shares the SettingsStore mutex with the frontend's preferences.
package windowstate

import (
	"encoding/json"
	"runtime"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const settingsKey = "xensql-window-state"

// debounceInterval collapses a drag's resize/move burst into one write.
const debounceInterval = 500 * time.Millisecond

const (
	modeNormal     = "normal"
	modeMaximised  = "maximised"
	modeFullscreen = "fullscreen"
)

// State is the persisted geometry. Width/Height/X/Y are the *normal* bounds even in
// maximised/fullscreen mode; X/Y are relative to the screen WorkArea.
type State struct {
	Mode   string `json:"mode"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
}

// Store is the slice of *storage.SettingsStore used here, as an interface so tests
// can fake it and this package needn't import storage.
type Store interface {
	GetAll() map[string]string
	Set(key, value string) error
}

// Load returns the persisted state and whether a usable record was found.
func Load(s Store) (State, bool) {
	raw := s.GetAll()[settingsKey]
	if raw == "" {
		return State{}, false
	}
	var st State
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return State{}, false
	}
	return st, true
}

// Apply fills opts' start state, size and position from a saved State, falling back
// to the first-run default (maximised, 80% of screen, centred) when ok is false or
// the bounds are unusable. screen is set on opts so X/Y read as WorkArea-relative on
// every platform (and the window stays on-screen if its monitor is gone).
func Apply(opts *application.WebviewWindowOptions, st State, ok bool, screen *application.Screen, minW, minH int) {
	defaultW, defaultH := defaultSize(screen)
	hasBounds := ok && st.Width >= minW && st.Height >= minH

	if hasBounds {
		opts.Width, opts.Height = st.Width, st.Height
	} else {
		opts.Width, opts.Height = defaultW, defaultH
	}

	if hasBounds && screen != nil {
		opts.InitialPosition = application.WindowXY
		opts.X, opts.Y = st.X, st.Y
	} else {
		opts.InitialPosition = application.WindowCentered
	}
	opts.Screen = screen

	switch {
	case !ok:
		opts.StartState = application.WindowStateMaximised
	case st.Mode == modeFullscreen:
		opts.StartState = application.WindowStateFullscreen
	case st.Mode == modeMaximised:
		opts.StartState = application.WindowStateMaximised
	default:
		opts.StartState = application.WindowStateNormal
	}
}

// defaultSize is 80% of the screen, or 1280x720 when no screen is available.
func defaultSize(screen *application.Screen) (int, int) {
	if screen != nil {
		return screen.Size.Width * 80 / 100, screen.Size.Height * 80 / 100
	}
	return 1280, 720
}

// windowReader is the read side of a window; *WebviewWindow satisfies it.
type windowReader interface {
	IsFullscreen() bool
	IsMaximised() bool
	Size() (int, int)
	RelativePosition() (int, int)
}

// Track persists size/position/mode changes and returns a shutdown flush. Mode
// toggles save immediately; resize/move are debounced.
func Track(window *application.WebviewWindow, s Store) (flush func()) {
	t := &tracker{reader: window, store: s}
	if st, ok := Load(s); ok {
		t.last = st
	}

	on := func(evt events.WindowEventType, save func()) {
		window.OnWindowEvent(evt, func(*application.WindowEvent) { save() })
	}
	immediate, debounced := platformWindowEvents()
	for _, evt := range immediate {
		on(evt, t.saveNow)
	}
	for _, evt := range debounced {
		on(evt, t.saveDebounced)
	}
	return t.flushNow
}

// platformWindowEvents returns the events to save on, immediate (mode toggles) vs
// debounced (resize/move). Window events use platform-specific ids and are never
// translated to events.Common.*, so we register per-OS types. Linux emits only
// resize/move; capture() infers maximise/fullscreen from the resize.
func platformWindowEvents() (immediate, debounced []events.WindowEventType) {
	switch runtime.GOOS {
	case "darwin":
		immediate = []events.WindowEventType{
			events.Mac.WindowMaximise, events.Mac.WindowUnMaximise,
			events.Mac.WindowDidEnterFullScreen, events.Mac.WindowDidExitFullScreen,
		}
		debounced = []events.WindowEventType{
			events.Mac.WindowDidResize, events.Mac.WindowDidMove,
		}
	case "windows":
		immediate = []events.WindowEventType{
			events.Windows.WindowMaximise, events.Windows.WindowUnMaximise,
			events.Windows.WindowFullscreen, events.Windows.WindowUnFullscreen,
			events.Windows.WindowClosing,
		}
		debounced = []events.WindowEventType{
			events.Windows.WindowDidResize, events.Windows.WindowDidMove,
		}
	default: // linux and others
		debounced = []events.WindowEventType{
			events.Linux.WindowDidResize, events.Linux.WindowDidMove,
		}
	}
	return immediate, debounced
}

type tracker struct {
	reader windowReader
	store  Store

	mu    sync.Mutex
	last  State
	timer *time.Timer
}

// capture refreshes the in-memory state from the window. Bounds are sampled only in
// normal mode (the maximised/fullscreen frame isn't a restore size); a zero-size
// read is ignored so a mid-teardown event can't clobber a good record.
func (t *tracker) capture() State {
	// Read getters before locking: each hops to the main thread. Safe off the main
	// thread because OnWindowEvent listeners run on their own goroutine.
	var mode string
	switch {
	case t.reader.IsFullscreen():
		mode = modeFullscreen
	case t.reader.IsMaximised():
		mode = modeMaximised
	default:
		mode = modeNormal
	}
	var w, h, x, y int
	if mode == modeNormal {
		w, h = t.reader.Size()
		x, y = t.reader.RelativePosition()
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	switch {
	case mode != modeNormal:
		t.last.Mode = mode
	case w > 0 && h > 0:
		t.last = State{Mode: modeNormal, Width: w, Height: h, X: x, Y: y}
	}
	return t.last
}

// saveNow captures and persists immediately, cancelling any pending debounced write.
func (t *tracker) saveNow() {
	st := t.capture()
	t.mu.Lock()
	if t.timer != nil {
		t.timer.Stop()
		t.timer = nil
	}
	t.mu.Unlock()
	t.persist(st)
}

// saveDebounced captures now but defers the write until the resize/move burst settles.
func (t *tracker) saveDebounced() {
	st := t.capture()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.timer != nil {
		t.timer.Stop()
	}
	t.timer = time.AfterFunc(debounceInterval, func() { t.persist(st) })
}

// flushNow persists the last captured state synchronously without reading the
// window, for shutdown (listener goroutines may not finish before exit).
func (t *tracker) flushNow() {
	t.mu.Lock()
	st := t.last
	if t.timer != nil {
		t.timer.Stop()
		t.timer = nil
	}
	t.mu.Unlock()
	t.persist(st)
}

func (t *tracker) persist(st State) {
	if st.Mode == "" {
		return // nothing captured yet; don't write a blank record
	}
	data, err := json.Marshal(st)
	if err != nil {
		return
	}
	_ = t.store.Set(settingsKey, string(data))
}
