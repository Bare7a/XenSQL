//go:build production

package app

// Silent startup update check is on for release builds (-tags production).
const autoCheckUpdatesOnStartup = true
