package service

import (
	"io"
	"strings"
	"testing"
)

func TestSniffDelimiter(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want rune
	}{
		{"comma", "a,b,c\n1,2,3\n", ','},
		{"semicolon", "a;b;c\n1;2;3\n", ';'},
		{"tab", "a\tb\tc\n1\t2\t3\n", '\t'},
		{"pipe", "a|b|c\n1|2|3\n", '|'},
		{
			name: "quoted commas do not win",
			in:   "a;b\n\"x,y,z\";2\n\"p,q,r\";4\n",
			want: ';',
		},
		{
			name: "the consistent separator wins over the erratic one",
			in:   "a,b\tc\n1,2,3\td\n",
			want: '\t',
		},
		{
			name: "no consistent separator falls back to comma",
			in:   "a,b\n1,2,3\n",
			want: ',',
		},
		{"single column falls back to comma", "onlyone\nvalue\n", ','},
		{"empty input", "", ','},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := SniffDelimiter(tc.in); got != tc.want {
				t.Errorf("SniffDelimiter() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSniffDelimiterIgnoresPartialFinalLine(t *testing.T) {
	if got := SniffDelimiter("a;b;c\n1;2;3\n4;5"); got != ';' {
		t.Errorf("SniffDelimiter() = %q, want ';'", got)
	}
}

func TestParseDelimiter(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want rune
	}{{",", ','}, {";", ';'}, {`\t`, '\t'}, {"\t", '\t'}, {"|", '|'}} {
		got, err := ParseDelimiter(tc.in)
		if err != nil || got != tc.want {
			t.Errorf("ParseDelimiter(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
	for _, bad := range []string{"", "ab", "::"} {
		if _, err := ParseDelimiter(bad); err == nil {
			t.Errorf("ParseDelimiter(%q) should fail", bad)
		}
	}
}

func TestNewCSVReaderStripsBOMAndSkipsRows(t *testing.T) {
	// \ufeff is the UTF-8 BOM Excel writes, escaped so this file doesn't carry one.
	input := "\ufeffpreamble line\nname,age\nAlice,30\n"
	reader, err := NewCSVReader(strings.NewReader(input), CSVOptions{SkipRows: 1, HasHeader: true})
	if err != nil {
		t.Fatalf("NewCSVReader: %v", err)
	}
	header, err := reader.Read()
	if err != nil {
		t.Fatalf("read header: %v", err)
	}
	if header[0] != "name" {
		t.Errorf("header[0] = %q, want %q", header[0], "name")
	}
	row, err := reader.Read()
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	if row[0] != "Alice" || row[1] != "30" {
		t.Errorf("row = %v", row)
	}
	if _, err := reader.Read(); err != io.EOF {
		t.Errorf("expected EOF, got %v", err)
	}
}

func TestNewCSVReaderSniffsDelimiter(t *testing.T) {
	reader, err := NewCSVReader(strings.NewReader("a;b\n1;2\n"), CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("NewCSVReader: %v", err)
	}
	if reader.Comma != ';' {
		t.Errorf("Comma = %q, want ';'", reader.Comma)
	}
	rec, _ := reader.Read()
	if len(rec) != 2 {
		t.Errorf("expected 2 fields, got %v", rec)
	}
}

func TestNewCSVReaderToleratesRaggedRows(t *testing.T) {
	reader, err := NewCSVReader(strings.NewReader("a,b,c\n1,2\n3,4,5\n"), CSVOptions{HasHeader: true})
	if err != nil {
		t.Fatalf("NewCSVReader: %v", err)
	}
	if _, err := reader.Read(); err != nil {
		t.Fatalf("header: %v", err)
	}
	short, err := reader.Read()
	if err != nil || len(short) != 2 {
		t.Fatalf("short row = %v, err = %v", short, err)
	}
	full, err := reader.Read()
	if err != nil || len(full) != 3 {
		t.Fatalf("full row = %v, err = %v", full, err)
	}
}

func TestInferColumnType(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want InferredType
	}{
		{"integers", []string{"1", "42", "-7"}, InferInt},
		{"floats", []string{"1.5", "2", "-0.25"}, InferFloat},
		{"booleans", []string{"true", "false", "yes"}, InferBool},
		{"dates", []string{"2026-01-02", "2026-12-31"}, InferDate},
		{"timestamps", []string{"2026-01-02 15:04:05", "2026-01-02T15:04:05"}, InferTimestamp},
		{"text", []string{"alice", "bob"}, InferText},
		{
			name: "zero and one read as boolean",
			in:   []string{"0", "1", "1"},
			want: InferBool,
		},
		{
			name: "a single non-numeric widens to text",
			in:   []string{"1", "2", "n/a"},
			want: InferText,
		},
		{"mixed int and float widens to float", []string{"1", "2.5"}, InferFloat},
		{"blanks are ignored", []string{"", "  ", "10"}, InferInt},
		{"all blank is text", []string{"", "  "}, InferText},
		{"no samples is text", nil, InferText},
		{
			name: "zero-padded digits still read as int",
			in:   []string{"007", "010"},
			want: InferInt,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := InferColumnType(tc.in); got != tc.want {
				t.Errorf("InferColumnType(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestUniqueColumnNames(t *testing.T) {
	got := UniqueColumnNames([]string{"id", "name", "", "name", "NAME", "  spaced  "})
	want := []string{"id", "name", "col3", "name_2", "NAME_3", "spaced"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("UniqueColumnNames()[%d] = %q, want %q (full: %v)", i, got[i], want[i], got)
		}
	}
}

func TestPositionalHeader(t *testing.T) {
	got := PositionalHeader(3)
	if strings.Join(got, ",") != "col1,col2,col3" {
		t.Errorf("PositionalHeader(3) = %v", got)
	}
	if len(PositionalHeader(0)) != 0 {
		t.Error("PositionalHeader(0) should be empty")
	}
}
