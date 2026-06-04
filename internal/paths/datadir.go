package paths

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const dataFolderName = "XenSQL-data"

// DataDir returns the directory holding XenSQL's settings and per-user data; the
// folder is always named "XenSQL-data". Resolution order:
//  1. $XENSQL_DATA_DIR, if set.
//  2. In the working dir under `go run` / `wails dev` (go-build temp dir).
//  3. Portable, when writable: next to the executable, or beside the .app bundle on
//     macOS (writing inside the bundle breaks signing and is wiped on update).
//  4. Else in the OS config dir (~/Library/Application Support, ~/.config, %AppData%)
//     when the portable spot is read-only (/Applications, system installs).
func DataDir() string {
	if dir := strings.TrimSpace(os.Getenv("XENSQL_DATA_DIR")); dir != "" {
		return dir
	}
	exeDir, haveExe := executableDir()
	wd, _ := os.Getwd()
	cfgDir, cfgErr := os.UserConfigDir()

	devMode := haveExe && isGoRunTempDir(exeDir)
	portable := ""
	if haveExe && !devMode {
		if cand := portableDataDir(runtime.GOOS, exeDir); cand != "" && isWritableDir(cand) {
			portable = cand
		}
	}
	return resolveDataDir(devMode, wd, portable, cfgDir, cfgErr == nil, exeDir, haveExe)
}

// resolveDataDir is the pure decision (unit-tested per platform). portable is set
// only when a writable next-to-app location was found.
func resolveDataDir(devMode bool, wd, portable, cfgDir string, haveCfg bool, exeDir string, haveExe bool) string {
	switch {
	case devMode && wd != "":
		return filepath.Join(wd, dataFolderName)
	case portable != "":
		return portable
	case haveCfg:
		return filepath.Join(cfgDir, dataFolderName)
	case haveExe:
		return filepath.Join(exeDir, dataFolderName)
	default:
		return filepath.Join(".", dataFolderName)
	}
}

// portableDataDir is the "next to the app" candidate: a sibling of the .app bundle
// on macOS, else next to the executable.
func portableDataDir(goos, exeDir string) string {
	if goos == "darwin" {
		if parent, ok := macAppBundleParent(exeDir); ok {
			return filepath.Join(parent, dataFolderName)
		}
	}
	return filepath.Join(exeDir, dataFolderName)
}

// macAppBundleParent returns the dir containing the bundle when exeDir is a
// ".../Foo.app/Contents/MacOS".
func macAppBundleParent(exeDir string) (parent string, ok bool) {
	contents := filepath.Dir(exeDir)   // <...>/Foo.app/Contents
	bundle := filepath.Dir(contents)   // <...>/Foo.app
	if filepath.Base(exeDir) == "MacOS" &&
		filepath.Base(contents) == "Contents" &&
		strings.HasSuffix(bundle, ".app") {
		return filepath.Dir(bundle), true
	}
	return "", false
}

// isWritableDir reports whether files can be created in dir (probing its parent
// when dir doesn't exist yet), leaving nothing behind.
func isWritableDir(dir string) bool {
	target := dir
	if _, err := os.Stat(dir); err != nil {
		target = filepath.Dir(dir)
	}
	probe, err := os.CreateTemp(target, ".xensql-probe-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return true
}

// executableDir returns the running executable's directory, symlinks resolved.
func executableDir() (dir string, ok bool) {
	exe, err := os.Executable()
	if err != nil {
		return "", false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe), true
}

func EnsureDataDir() (string, error) {
	dir := DataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return dir, err
	}
	return dir, nil
}

func isGoRunTempDir(dir string) bool {
	return strings.Contains(filepath.ToSlash(dir), "go-build")
}
