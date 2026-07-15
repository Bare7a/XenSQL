package windowtheme

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

static void xensqlSetWindowAppearance(void *nsWindow, bool dark) {
	NSWindow *window = (NSWindow *)nsWindow;
	NSAppearanceName name = dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua;
	[window setAppearance:[NSAppearance appearanceNamed:name]];
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// The transparent title bar shows the NSWindow background colour; the window
// appearance keeps the native title text legible on it.
func configureOS(opts *application.WebviewWindowOptions, p colours, dark bool) {
	opts.Mac.TitleBar = application.MacTitleBar{AppearsTransparent: true}
	opts.Mac.Appearance = application.NSAppearanceNameAqua
	if dark {
		opts.Mac.Appearance = application.NSAppearanceNameDarkAqua
	}
	opts.BackgroundColour = p.panel
}

func applyOS(window *application.WebviewWindow, p colours, dark bool) {
	window.SetBackgroundColour(p.panel)
	handle := window.NativeWindow()
	if handle == nil {
		return
	}
	application.InvokeSync(func() {
		C.xensqlSetWindowAppearance(handle, C.bool(dark))
	})
}
