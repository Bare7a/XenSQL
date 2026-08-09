package service

import (
	"bufio"
	"io"
	"strings"
	"unicode"
)

// CSVField is one parsed field; Quoted tells an empty string ("") apart from an absent value.
type CSVField struct {
	Value  string
	Quoted bool
}

// Like encoding/csv (LazyQuotes, FieldsPerRecord=-1) but reports quoting; pinned by csvreader_diff_test.go.
type CSVReader struct {
	br    *bufio.Reader
	comma rune
	trim  bool
	// Own pushback: bufio's UnreadRune silently no-ops after a Peek.
	pushback []rune
	fields   []CSVField
	sb       strings.Builder
}

func (r *CSVReader) Comma() rune { return r.comma }

func CSVValues(fields []CSVField) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = f.Value
	}
	return out
}

// The returned slice is reused across calls.
func (r *CSVReader) Read() ([]CSVField, error) {
	for {
		fields, blank, err := r.readRecord()
		if err != nil {
			return nil, err
		}
		// encoding/csv drops blank lines.
		if blank {
			continue
		}
		return fields, nil
	}
}

func (r *CSVReader) readRecord() (fields []CSVField, blank bool, err error) {
	r.fields = r.fields[:0]
	consumed := false
	// A line of only spaces is a one-empty-field record, not a blank line.
	spaceSkipped := false

	for {
		r.sb.Reset()

		if r.trim {
			if err := r.skipLeadingSpace(&spaceSkipped); err != nil && err != io.EOF {
				return nil, false, err
			}
			consumed = consumed || spaceSkipped
		}

		c, err := r.readRune()
		switch {
		case err == io.EOF:
			if !consumed && len(r.fields) == 0 {
				return nil, false, io.EOF
			}
			r.fields = append(r.fields, CSVField{Value: ""})
			return r.fields, false, nil
		case err != nil:
			return nil, false, err
		}
		consumed = true

		if c == '"' {
			done, err := r.readQuoted()
			if err != nil {
				return nil, false, err
			}
			r.fields = append(r.fields, CSVField{Value: r.sb.String(), Quoted: true})
			if done {
				return r.fields, false, nil
			}
			continue
		}

		r.unreadRune(c)
		done, endedBlank, err := r.readBare(len(r.fields) == 0)
		if err != nil {
			return nil, false, err
		}
		r.fields = append(r.fields, CSVField{Value: r.sb.String()})
		if done {
			return r.fields, endedBlank && !spaceSkipped, nil
		}
	}
}

// Mirrors TrimLeadingSpace, which trims even when the delimiter itself is whitespace.
func (r *CSVReader) skipLeadingSpace(skipped *bool) error {
	for {
		c, err := r.readRune()
		if err != nil {
			return err
		}
		// A lone \r is whitespace; \r\n is the record terminator.
		if !unicode.IsSpace(c) || c == '\n' || (c == '\r' && r.peekIsNewline()) {
			r.unreadRune(c)
			return nil
		}
		*skipped = true
	}
}

func (r *CSVReader) readQuoted() (recordDone bool, err error) {
	for {
		c, err := r.readRune()
		if err == io.EOF {
			// LazyQuotes: an unterminated quote ends the field rather than failing.
			return true, nil
		}
		if err != nil {
			return false, err
		}
		if c != '"' {
			// encoding/csv folds a \r\n line ending inside a quoted field to \n.
			if c == '\r' && r.peekIsNewline() {
				_, _ = r.readRune()
				r.sb.WriteRune('\n')
				continue
			}
			r.sb.WriteRune(c)
			continue
		}
		next, nErr := r.readRune()
		if nErr == io.EOF {
			return true, nil
		}
		if nErr != nil {
			return false, nErr
		}
		switch {
		case next == '"':
			r.sb.WriteRune('"')
		case next == r.comma:
			return false, nil
		case next == '\n':
			return true, nil
		case next == '\r' && r.peekIsNewline():
			_, _ = r.readRune()
			return true, nil
		default:
			// LazyQuotes: a bare quote mid-field is data.
			r.sb.WriteRune('"')
			r.unreadRune(next)
		}
	}
}

// blankLine marks a lone-terminator record.
func (r *CSVReader) readBare(firstField bool) (recordDone, blankLine bool, err error) {
	empty := true
	for {
		c, err := r.readRune()
		if err == io.EOF {
			return true, false, nil
		}
		if err != nil {
			return false, false, err
		}
		switch {
		case c == r.comma:
			return false, false, nil
		case c == '\n':
			return true, firstField && empty, nil
		case c == '\r' && r.peekIsNewline():
			_, _ = r.readRune()
			return true, firstField && empty, nil
		default:
			r.sb.WriteRune(c)
			empty = false
		}
	}
}

func (r *CSVReader) readRune() (rune, error) {
	if n := len(r.pushback); n > 0 {
		c := r.pushback[n-1]
		r.pushback = r.pushback[:n-1]
		return c, nil
	}
	c, _, err := r.br.ReadRune()
	if err == nil && c == '\r' {
		// encoding/csv drops a trailing \r before EOF.
		if _, peekErr := r.br.Peek(1); peekErr != nil {
			if peekErr == io.EOF {
				return 0, io.EOF
			}
			return 0, peekErr
		}
	}
	return c, err
}

func (r *CSVReader) unreadRune(c rune) {
	r.pushback = append(r.pushback, c)
}

func (r *CSVReader) peekIsNewline() bool {
	c, err := r.readRune()
	if err != nil {
		return false
	}
	r.unreadRune(c)
	return c == '\n'
}
