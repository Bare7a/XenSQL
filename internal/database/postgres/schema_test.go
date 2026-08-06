package postgres

import "testing"

func TestConstraintTypeName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"p", "PRIMARY KEY"},
		{"f", "FOREIGN KEY"},
		{"u", "UNIQUE"},
		{"c", "CHECK"},
		{"x", "EXCLUDE"},
		{"t", "T"},
	}
	for _, tc := range tests {
		if got := constraintTypeName(tc.in); got != tc.want {
			t.Errorf("constraintTypeName(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestDecodeTriggerType(t *testing.T) {
	tests := []struct {
		name       string
		tgtype     int
		wantTiming string
		wantEvents string
	}{
		{
			name: "before insert row", tgtype: 1 | trigTypeBefore | trigTypeInsert,
			wantTiming: "BEFORE", wantEvents: "INSERT",
		},
		{
			name: "after update", tgtype: trigTypeUpdate,
			wantTiming: "AFTER", wantEvents: "UPDATE",
		},
		{
			name: "instead of outranks before", tgtype: trigTypeInstead | trigTypeBefore | trigTypeDelete,
			wantTiming: "INSTEAD OF", wantEvents: "DELETE",
		},
		{
			name:       "multiple events",
			tgtype:     trigTypeBefore | trigTypeDelete | trigTypeInsert | trigTypeUpdate,
			wantTiming: "BEFORE", wantEvents: "INSERT, UPDATE, DELETE",
		},
		{
			name: "truncate", tgtype: trigTypeTruncate,
			wantTiming: "AFTER", wantEvents: "TRUNCATE",
		},
		{
			name: "no event bits", tgtype: trigTypeBefore,
			wantTiming: "BEFORE", wantEvents: "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			timing, events := decodeTriggerType(tc.tgtype)
			if timing != tc.wantTiming || events != tc.wantEvents {
				t.Errorf("decodeTriggerType(%d) = %q/%q, want %q/%q",
					tc.tgtype, timing, events, tc.wantTiming, tc.wantEvents)
			}
		})
	}
}

func TestSerialTypeFor(t *testing.T) {
	tests := []struct{ in, want string }{
		{"smallint", "smallserial"},
		{"integer", "serial"},
		{"bigint", "bigserial"},
		{"text", ""},
		{"numeric", ""},
		{"", ""},
	}
	for _, tc := range tests {
		if got := serialTypeFor(tc.in); got != tc.want {
			t.Errorf("serialTypeFor(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestQuoteLiteral(t *testing.T) {
	tests := []struct{ in, want string }{
		{"plain", "'plain'"},
		{"it's", "'it''s'"},
		{"", "''"},
		{"'; DROP TABLE users; --", "'''; DROP TABLE users; --'"},
	}
	for _, tc := range tests {
		if got := quoteLiteral(tc.in); got != tc.want {
			t.Errorf("quoteLiteral(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
