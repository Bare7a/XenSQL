package service

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type CSVOptions struct {
	// Delimiter is empty to sniff it. Quoting is always the CSV standard.
	Delimiter string `json:"delimiter,omitempty"`
	HasHeader bool   `json:"hasHeader"`
	// NullLiteral is extra text that becomes SQL NULL; a bare empty field already is.
	NullLiteral string `json:"nullLiteral,omitempty"`
	// SkipRows drops leading lines before the header is read.
	SkipRows  int  `json:"skipRows,omitempty"`
	TrimSpace bool `json:"trimSpace,omitempty"`
}

var candidateDelimiters = []rune{',', ';', '\t', '|'}

// A candidate must split every line into the same number of fields, and more than one - an
// absent character is "consistent" at one field and would otherwise win.
func SniffDelimiter(sample string) rune {
	lines := sampleLines(sample, 5)
	if len(lines) == 0 {
		return ','
	}
	best, bestFields := ',', 1
	for _, d := range candidateDelimiters {
		count := -1
		consistent := true
		for _, line := range lines {
			n := countFields(line, d)
			if count == -1 {
				count = n
			} else if n != count {
				consistent = false
				break
			}
		}
		if consistent && count > bestFields {
			best, bestFields = d, count
		}
	}
	return best
}

func sampleLines(sample string, max int) []string {
	raw := strings.Split(strings.ReplaceAll(sample, "\r\n", "\n"), "\n")
	out := make([]string, 0, max)
	for i, line := range raw {
		if line == "" {
			continue
		}
		if i == len(raw)-1 && !strings.HasSuffix(sample, "\n") && len(out) > 0 {
			break
		}
		out = append(out, line)
		if len(out) == max {
			break
		}
	}
	return out
}

func countFields(line string, delim rune) int {
	fields, inQuotes := 1, false
	for _, r := range line {
		switch {
		case r == '"':
			inQuotes = !inQuotes
		case r == delim && !inQuotes:
			fields++
		}
	}
	return fields
}

func NewCSVReader(r io.Reader, opts CSVOptions) (*CSVReader, error) {
	br := bufio.NewReaderSize(r, 64*1024)
	if err := stripBOM(br); err != nil {
		return nil, err
	}
	// Before sniffing: a preamble carries no delimiters and would make every candidate inconsistent.
	if err := skipLines(br, opts.SkipRows); err != nil {
		return nil, err
	}
	delim, err := resolveDelimiter(br, opts)
	if err != nil {
		return nil, err
	}
	return &CSVReader{br: br, comma: delim, trim: opts.TrimSpace}, nil
}

func skipLines(br *bufio.Reader, n int) error {
	for i := 0; i < n; i++ {
		if _, err := br.ReadString('\n'); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
	return nil
}

func resolveDelimiter(br *bufio.Reader, opts CSVOptions) (rune, error) {
	if opts.Delimiter != "" {
		d, err := ParseDelimiter(opts.Delimiter)
		if err != nil {
			return 0, err
		}
		return d, nil
	}
	head, err := br.Peek(br.Size())
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		return 0, err
	}
	return SniffDelimiter(string(head)), nil
}

func ParseDelimiter(s string) (rune, error) {
	switch s {
	case `\t`, "\t":
		return '\t', nil
	case `\\`:
		return '\\', nil
	}
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError || size != len(s) {
		return 0, fmt.Errorf("delimiter must be a single character, got %q", s)
	}
	return r, nil
}

func stripBOM(br *bufio.Reader) error {
	head, err := br.Peek(3)
	if err != nil && err != io.EOF {
		return err
	}
	if len(head) == 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF {
		_, _ = br.Discard(3)
	}
	return nil
}

type InferredType string

const (
	InferBool      InferredType = "bool"
	InferInt       InferredType = "int"
	InferFloat     InferredType = "float"
	InferDate      InferredType = "date"
	InferTimestamp InferredType = "timestamp"
	InferText      InferredType = "text"
)

var inferOrder = []InferredType{InferBool, InferInt, InferFloat, InferDate, InferTimestamp}

func InferColumnType(samples []string) InferredType {
	seen := false
	fits := map[InferredType]bool{}
	for _, t := range inferOrder {
		fits[t] = true
	}
	for _, raw := range samples {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		seen = true
		for _, t := range inferOrder {
			if fits[t] && !matchesType(t, v) {
				fits[t] = false
			}
		}
	}
	if !seen {
		return InferText
	}
	for _, t := range inferOrder {
		if fits[t] {
			return t
		}
	}
	return InferText
}

func matchesType(t InferredType, v string) bool {
	switch t {
	case InferBool:
		switch strings.ToLower(v) {
		case "true", "false", "t", "f", "yes", "no", "y", "n", "0", "1":
			return true
		}
		return false
	case InferInt:
		_, err := strconv.ParseInt(v, 10, 64)
		return err == nil
	case InferFloat:
		_, err := strconv.ParseFloat(v, 64)
		return err == nil
	case InferDate:
		return matchesLayouts(v, dateLayouts)
	case InferTimestamp:
		return matchesLayouts(v, timestampLayouts)
	}
	return false
}

var (
	dateLayouts      = []string{"2006-01-02", "2006/01/02", "02/01/2006", "01/02/2006"}
	timestampLayouts = []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02 15:04:05.999999",
		"2006-01-02T15:04:05.999999Z07:00",
	}
)

func matchesLayouts(v string, layouts []string) bool {
	for _, layout := range layouts {
		if _, err := time.Parse(layout, v); err == nil {
			return true
		}
	}
	return false
}

// Blanks become col1..colN and repeats gain a suffix, so a CREATE TABLE cannot collide.
func UniqueColumnNames(header []string) []string {
	out := make([]string, len(header))
	seen := map[string]int{}
	for i, raw := range header {
		name := strings.TrimSpace(raw)
		if name == "" {
			name = fmt.Sprintf("col%d", i+1)
		}
		lower := strings.ToLower(name)
		if n, dup := seen[lower]; dup {
			seen[lower] = n + 1
			name = fmt.Sprintf("%s_%d", name, n+1)
		} else {
			seen[lower] = 1
		}
		out[i] = name
	}
	return out
}

func PositionalHeader(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("col%d", i+1)
	}
	return out
}
