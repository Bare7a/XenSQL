package database

import (
	"context"
	"testing"
)

func TestConnectionIDRoundtrip(t *testing.T) {
	ctx := WithConnectionID(context.Background(), "abc")
	id, ok := ConnectionIDFromContext(ctx)
	if !ok || id != "abc" {
		t.Fatalf("expected (abc, true), got (%q, %v)", id, ok)
	}
}

func TestConnectionIDMissing(t *testing.T) {
	if id, ok := ConnectionIDFromContext(context.Background()); ok || id != "" {
		t.Fatalf("expected (\"\", false), got (%q, %v)", id, ok)
	}
}

func TestConnectionIDEmptyTreatedAsMissing(t *testing.T) {
	ctx := WithConnectionID(context.Background(), "")
	if _, ok := ConnectionIDFromContext(ctx); ok {
		t.Fatal("empty connection ID should report missing")
	}
}

func TestQueryRegistryRoundtrip(t *testing.T) {
	r := NewQueryRegistry()
	ctx := WithQueryRegistry(context.Background(), r)
	if got := QueryRegistryFromContext(ctx); got != r {
		t.Fatal("expected the registry back")
	}
}

func TestQueryRegistryMissingReturnsNil(t *testing.T) {
	if got := QueryRegistryFromContext(context.Background()); got != nil {
		t.Fatal("expected nil when registry absent")
	}
}
