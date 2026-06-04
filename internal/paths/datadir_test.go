package paths

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDataDir_override(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XENSQL_DATA_DIR", dir)
	if got := DataDir(); got != dir {
		t.Fatalf("DataDir() = %q, want %q", got, dir)
	}
}

func TestIsGoRunTempDir(t *testing.T) {
	if !isGoRunTempDir(filepath.Join(os.TempDir(), "go-build123456789", "b001", "exe")) {
		t.Fatal("expected go-build path to match")
	}
	if isGoRunTempDir(`C:\Program Files\XenSQL`) {
		t.Fatal("expected normal install path not to match")
	}
}

func TestEnsureDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XENSQL_DATA_DIR", dir)
	got, err := EnsureDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != dir {
		t.Fatalf("EnsureDataDir() = %q, want %q", got, dir)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("data dir not created: %v", err)
	}
}

func TestDataDir_defaultUsesDataFolder(t *testing.T) {
	t.Setenv("XENSQL_DATA_DIR", "")
	// `go test` runs from a go-build temp dir, so the dev fallback returns ./XenSQL-data.
	dir := DataDir()
	if !strings.HasSuffix(filepath.ToSlash(dir), "/"+dataFolderName) {
		t.Fatalf("DataDir() = %q, expected .../%s suffix", dir, dataFolderName)
	}
}

func TestResolveDataDir(t *testing.T) {
	const (
		exeDir   = "/usr/bin"
		wd       = "/work/dir"
		portable = "/apps/XenSQL-data"
		cfgDir   = "/home/u/.config"
	)
	tests := []struct {
		name     string
		devMode  bool
		wd       string
		portable string
		cfgDir   string
		haveCfg  bool
		exeDir   string
		haveExe  bool
		want     string
	}{
		{"dev mode beats everything", true, wd, portable, cfgDir, true, exeDir, true, filepath.Join(wd, dataFolderName)},
		{"writable portable wins", false, wd, portable, cfgDir, true, exeDir, true, portable},
		{"read-only portable falls back to config dir", false, wd, "", cfgDir, true, exeDir, true, filepath.Join(cfgDir, dataFolderName)},
		{"no config dir falls back to exe dir", false, wd, "", "", false, exeDir, true, filepath.Join(exeDir, dataFolderName)},
		{"nothing known falls back to ./XenSQL-data", false, "", "", "", false, "", false, filepath.Join(".", dataFolderName)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveDataDir(tt.devMode, tt.wd, tt.portable, tt.cfgDir, tt.haveCfg, tt.exeDir, tt.haveExe)
			if got != tt.want {
				t.Fatalf("resolveDataDir() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPortableDataDir(t *testing.T) {
	tests := []struct {
		name   string
		goos   string
		exeDir string
		want   string
	}{
		{"windows next to exe", "windows", `C:\Apps\XenSQL`, filepath.Join(`C:\Apps\XenSQL`, dataFolderName)},
		{"linux next to exe", "linux", "/opt/xensql", filepath.Join("/opt/xensql", dataFolderName)},
		{"macOS bundle uses sibling of .app", "darwin", "/Users/u/Desktop/XenSQL.app/Contents/MacOS", filepath.Join("/Users/u/Desktop", dataFolderName)},
		{"macOS bare binary uses next to exe", "darwin", "/Users/u/bin", filepath.Join("/Users/u/bin", dataFolderName)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := portableDataDir(tt.goos, tt.exeDir); got != tt.want {
				t.Fatalf("portableDataDir(%q, %q) = %q, want %q", tt.goos, tt.exeDir, got, tt.want)
			}
		})
	}
}

func TestMacAppBundleParent(t *testing.T) {
	if parent, ok := macAppBundleParent("/Applications/XenSQL.app/Contents/MacOS"); !ok || parent != "/Applications" {
		t.Fatalf("bundle path: got (%q, %v), want (\"/Applications\", true)", parent, ok)
	}
	if _, ok := macAppBundleParent("/usr/local/bin"); ok {
		t.Fatal("non-bundle path should not be detected as a bundle")
	}
}

func TestIsWritableDir(t *testing.T) {
	if !isWritableDir(t.TempDir()) {
		t.Fatal("temp dir should be writable")
	}
	// A not-yet-created dir under a writable parent is "writable" (we can make it).
	if !isWritableDir(filepath.Join(t.TempDir(), "child")) {
		t.Fatal("creatable child dir should be writable")
	}
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("read-only dir perms not enforced for this OS/user")
	}
	ro := t.TempDir()
	if err := os.Chmod(ro, 0o500); err != nil {
		t.Skipf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(ro, 0o700) })
	if isWritableDir(filepath.Join(ro, "child")) {
		t.Fatal("dir under a read-only parent should not be writable")
	}
}
