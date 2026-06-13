//go:build !production

package app

// Silent startup update check is off for dev/local builds; the manual
// "Check for Updates" button still works. Release builds flip this on.
const autoCheckUpdatesOnStartup = false
