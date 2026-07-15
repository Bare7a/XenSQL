package windowtheme

import "testing"

func TestLoadDefaultsToDark(t *testing.T) {
	if got := Load(nil); got != "dark" {
		t.Fatalf("Load(nil) = %q, want dark", got)
	}
	if got := Load(map[string]string{}); got != "dark" {
		t.Fatalf("Load(empty) = %q, want dark", got)
	}
	if got := Load(map[string]string{settingsKey: "solarized"}); got != "dark" {
		t.Fatalf("Load(unknown) = %q, want dark", got)
	}
}

func TestLoadReadsLight(t *testing.T) {
	if got := Load(map[string]string{settingsKey: "light"}); got != "light" {
		t.Fatalf("Load(light) = %q, want light", got)
	}
}
