package windowstate

import (
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// fakeStore is an in-memory Store.
type fakeStore struct{ m map[string]string }

func newFakeStore() *fakeStore { return &fakeStore{m: map[string]string{}} }

func (f *fakeStore) GetAll() map[string]string {
	out := make(map[string]string, len(f.m))
	for k, v := range f.m {
		out[k] = v
	}
	return out
}

func (f *fakeStore) Set(key, value string) error {
	f.m[key] = value
	return nil
}

// fakeReader is a scriptable windowReader.
type fakeReader struct {
	full, max bool
	w, h      int
	x, y      int
}

func (r fakeReader) IsFullscreen() bool           { return r.full }
func (r fakeReader) IsMaximised() bool            { return r.max }
func (r fakeReader) Size() (int, int)             { return r.w, r.h }
func (r fakeReader) RelativePosition() (int, int) { return r.x, r.y }

func TestLoad(t *testing.T) {
	t.Run("missing key", func(t *testing.T) {
		if _, ok := Load(newFakeStore()); ok {
			t.Fatal("expected ok=false for empty store")
		}
	})
	t.Run("corrupt json", func(t *testing.T) {
		s := newFakeStore()
		s.m[settingsKey] = "{not json"
		if _, ok := Load(s); ok {
			t.Fatal("expected ok=false for corrupt value")
		}
	})
	t.Run("valid", func(t *testing.T) {
		s := newFakeStore()
		s.m[settingsKey] = `{"mode":"normal","width":1100,"height":700,"x":40,"y":20}`
		st, ok := Load(s)
		if !ok {
			t.Fatal("expected ok=true")
		}
		if st != (State{Mode: modeNormal, Width: 1100, Height: 700, X: 40, Y: 20}) {
			t.Fatalf("unexpected state: %+v", st)
		}
	})
}

func TestApply(t *testing.T) {
	screen := &application.Screen{Size: application.Size{Width: 1000, Height: 800}}
	const minW, minH = 800, 600

	t.Run("first run defaults to maximised at 80%", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		Apply(&opts, State{}, false, screen, minW, minH)
		if opts.StartState != application.WindowStateMaximised {
			t.Fatalf("StartState = %v, want Maximised", opts.StartState)
		}
		if opts.Width != 800 || opts.Height != 640 {
			t.Fatalf("size = %dx%d, want 800x640 (80%%)", opts.Width, opts.Height)
		}
		if opts.InitialPosition != application.WindowCentered {
			t.Fatalf("InitialPosition = %v, want Centered", opts.InitialPosition)
		}
	})

	t.Run("normal restores exact bounds and position", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		st := State{Mode: modeNormal, Width: 1100, Height: 700, X: 40, Y: 20}
		Apply(&opts, st, true, screen, minW, minH)
		if opts.StartState != application.WindowStateNormal {
			t.Fatalf("StartState = %v, want Normal", opts.StartState)
		}
		if opts.Width != 1100 || opts.Height != 700 {
			t.Fatalf("size = %dx%d, want 1100x700", opts.Width, opts.Height)
		}
		if opts.InitialPosition != application.WindowXY || opts.X != 40 || opts.Y != 20 {
			t.Fatalf("position = (%v, %d, %d), want (XY, 40, 20)", opts.InitialPosition, opts.X, opts.Y)
		}
		if opts.Screen != screen {
			t.Fatal("Screen must be set so X/Y are interpreted as WorkArea-relative on all platforms")
		}
	})

	t.Run("maximised keeps restore bounds", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		st := State{Mode: modeMaximised, Width: 1100, Height: 700, X: 40, Y: 20}
		Apply(&opts, st, true, screen, minW, minH)
		if opts.StartState != application.WindowStateMaximised {
			t.Fatalf("StartState = %v, want Maximised", opts.StartState)
		}
		// Saved windowed bounds are kept so un-maximising restores a sensible size.
		if opts.Width != 1100 || opts.Height != 700 || opts.X != 40 || opts.Y != 20 {
			t.Fatalf("restore frame = %dx%d@(%d,%d), want 1100x700@(40,20)", opts.Width, opts.Height, opts.X, opts.Y)
		}
	})

	t.Run("fullscreen", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		Apply(&opts, State{Mode: modeFullscreen, Width: 1100, Height: 700}, true, screen, minW, minH)
		if opts.StartState != application.WindowStateFullscreen {
			t.Fatalf("StartState = %v, want Fullscreen", opts.StartState)
		}
	})

	t.Run("sub-minimum bounds fall back to default+centered", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		Apply(&opts, State{Mode: modeNormal, Width: 100, Height: 100}, true, screen, minW, minH)
		if opts.Width != 800 || opts.Height != 640 {
			t.Fatalf("size = %dx%d, want default 800x640", opts.Width, opts.Height)
		}
		if opts.InitialPosition != application.WindowCentered {
			t.Fatalf("InitialPosition = %v, want Centered", opts.InitialPosition)
		}
	})

	t.Run("nil screen centers and uses fallback size", func(t *testing.T) {
		var opts application.WebviewWindowOptions
		st := State{Mode: modeNormal, Width: 1100, Height: 700, X: 40, Y: 20}
		Apply(&opts, st, true, nil, minW, minH)
		// Without a screen, X/Y can't be placed reliably, so it centers.
		if opts.InitialPosition != application.WindowCentered {
			t.Fatalf("InitialPosition = %v, want Centered when screen is nil", opts.InitialPosition)
		}
	})
}

func TestCapture(t *testing.T) {
	t.Run("normal samples bounds and position", func(t *testing.T) {
		tr := &tracker{reader: fakeReader{w: 1200, h: 800, x: 30, y: 15}}
		got := tr.capture()
		want := State{Mode: modeNormal, Width: 1200, Height: 800, X: 30, Y: 15}
		if got != want {
			t.Fatalf("capture = %+v, want %+v", got, want)
		}
	})

	t.Run("maximised preserves prior normal bounds", func(t *testing.T) {
		tr := &tracker{
			reader: fakeReader{max: true, w: 9999, h: 9999}, // maximised frame must be ignored
			last:   State{Mode: modeNormal, Width: 1200, Height: 800, X: 30, Y: 15},
		}
		got := tr.capture()
		want := State{Mode: modeMaximised, Width: 1200, Height: 800, X: 30, Y: 15}
		if got != want {
			t.Fatalf("capture = %+v, want %+v", got, want)
		}
	})

	t.Run("fullscreen preserves prior normal bounds", func(t *testing.T) {
		tr := &tracker{
			reader: fakeReader{full: true, w: 9999, h: 9999},
			last:   State{Mode: modeNormal, Width: 1200, Height: 800},
		}
		if got := tr.capture(); got.Mode != modeFullscreen || got.Width != 1200 || got.Height != 800 {
			t.Fatalf("capture = %+v, want fullscreen keeping 1200x800", got)
		}
	})

	t.Run("zero-size normal read does not clobber stored state", func(t *testing.T) {
		tr := &tracker{
			reader: fakeReader{w: 0, h: 0}, // e.g. mid-teardown
			last:   State{Mode: modeMaximised, Width: 1200, Height: 800},
		}
		if got := tr.capture(); got != (State{Mode: modeMaximised, Width: 1200, Height: 800}) {
			t.Fatalf("capture = %+v, want unchanged maximised state", got)
		}
	})
}

func TestSaveNowPersistsRoundTrip(t *testing.T) {
	store := newFakeStore()
	tr := &tracker{reader: fakeReader{w: 1280, h: 720, x: 10, y: 5}, store: store}

	tr.saveNow()

	st, ok := Load(store)
	if !ok {
		t.Fatal("expected a persisted record after saveNow")
	}
	if st != (State{Mode: modeNormal, Width: 1280, Height: 720, X: 10, Y: 5}) {
		t.Fatalf("round-trip mismatch: %+v", st)
	}
}

func TestFlushNow(t *testing.T) {
	t.Run("persists last captured state without touching the window", func(t *testing.T) {
		store := newFakeStore()
		tr := &tracker{store: store, last: State{Mode: modeMaximised, Width: 1200, Height: 800}}
		tr.flushNow()
		if st, ok := Load(store); !ok || st.Mode != modeMaximised {
			t.Fatalf("flushNow did not persist last state: %+v ok=%v", st, ok)
		}
	})

	t.Run("does not write a blank record when nothing was captured", func(t *testing.T) {
		store := newFakeStore()
		tr := &tracker{store: store} // last is the zero State (Mode == "")
		tr.flushNow()
		if _, ok := Load(store); ok {
			t.Fatal("flushNow must not persist an empty State")
		}
	})
}

func TestPlatformWindowEvents(t *testing.T) {
	immediate, debounced := platformWindowEvents()
	if len(debounced) == 0 {
		t.Fatal("every platform must debounce-save on resize/move")
	}
	// macOS delivers maximise/fullscreen as discrete Mac.* events (not Common.*).
	if runtime.GOOS == "darwin" && len(immediate) == 0 {
		t.Fatal("darwin must register immediate-save events for maximise/fullscreen")
	}
}
