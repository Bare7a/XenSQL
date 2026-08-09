package service

import (
	"encoding/csv"
	"fmt"
	"io"
	"math/rand"
	"strings"
	"testing"
)

func readAllCSVReader(t *testing.T, in string, opts CSVOptions) [][]string {
	t.Helper()
	r, err := NewCSVReader(strings.NewReader(in), opts)
	if err != nil {
		t.Fatalf("NewCSVReader: %v", err)
	}
	var out [][]string
	for {
		fields, err := r.Read()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		rec := make([]string, len(fields))
		for i, f := range fields {
			rec[i] = f.Value
		}
		out = append(out, rec)
	}
}

// The exact encoding/csv configuration the import used before.
func readAllStdlib(in string, comma rune, trim bool) ([][]string, error) {
	r := csv.NewReader(strings.NewReader(in))
	r.Comma = comma
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.TrimLeadingSpace = trim
	var out [][]string
	for {
		rec, err := r.Read()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		cp := make([]string, len(rec))
		copy(cp, rec)
		out = append(out, cp)
	}
}

func sameRecords(a, b [][]string) bool {
	return fmt.Sprintf("%q", a) == fmt.Sprintf("%q", b)
}

var csvDiffCases = []string{
	"",
	"\n",
	"\n\n\n",
	"a,b,c",
	"a,b,c\n",
	"a,b,c\r\n",
	"a,b,c\n\n",
	"a,b\nc,d\n",
	",",
	",,\n",
	`"",,""` + "\n",
	`a,"",b` + "\n",
	`"a","b"`,
	`"a,b",c`,
	`"a""b",c`,
	`"multi
line",x`,
	"\"crlf\r\ninside\",x\n",
	`"unterminated,x`,
	`"ab"c,d`,
	`a"b,c`,
	`"a"b"c",d`,
	"  a,  b\n",
	"\ta\t,b\n",
	"a,b\r",
	"a\rb,c\n",
	"trailing,\n",
	"trailing,",
	"   \n",
	"  ,  \n",
	`\.` + "\n",
	`"\."` + "\n",
	"a,b\n\nc,d\n",
	"ragged,row,here\nshort\n",
	"quoted\"in\"middle,x\n",
	`"",` + "\n",
	"\xef\xbb\xbfa,b\n",
}

func TestCSVReaderMatchesStdlib(t *testing.T) {
	for _, trim := range []bool{false, true} {
		for _, comma := range []rune{',', ';', '\t', '|'} {
			for _, in := range csvDiffCases {
				src := in
				if comma != ',' {
					src = strings.ReplaceAll(in, ",", string(comma))
				}
				opts := CSVOptions{Delimiter: string(comma), TrimSpace: trim}
				if comma == '\t' {
					opts.Delimiter = "\t"
				}
				want, err := readAllStdlib(stripBOMString(src), comma, trim)
				if err != nil {
					// The stdlib config is tolerant; anything it still rejects is out of scope.
					continue
				}
				got := readAllCSVReader(t, src, opts)
				if !sameRecords(got, want) {
					t.Errorf("comma=%q trim=%v input=%q\n got=%q\nwant=%q", comma, trim, src, got, want)
				}
			}
		}
	}
}

// NewCSVReader strips the BOM; the stdlib comparison must see the same bytes.
func stripBOMString(s string) string {
	return strings.TrimPrefix(s, "\xef\xbb\xbf")
}

func TestCSVReaderMatchesStdlibOnRandomInput(t *testing.T) {
	// Fixed seed: reproducible corpus.
	rng := rand.New(rand.NewSource(20260809))
	alphabet := []string{"a", "b", ",", `"`, "\n", "\r\n", "\r", " ", "\t", `""`, `\.`, "é"}

	for i := 0; i < 25000; i++ {
		var b strings.Builder
		for n := rng.Intn(20); n > 0; n-- {
			b.WriteString(alphabet[rng.Intn(len(alphabet))])
		}
		src := b.String()
		trim := i%2 == 0

		want, err := readAllStdlib(src, ',', trim)
		if err != nil {
			continue
		}
		got := readAllCSVReader(t, src, CSVOptions{Delimiter: ",", TrimSpace: trim})
		if !sameRecords(got, want) {
			t.Fatalf("trim=%v input=%q\n got=%q\nwant=%q", trim, src, got, want)
		}
	}
}

func TestCSVReaderReportsQuoting(t *testing.T) {
	r, err := NewCSVReader(strings.NewReader(`a,,"",  "x" ,"y"`+"\n"), CSVOptions{Delimiter: ","})
	if err != nil {
		t.Fatalf("NewCSVReader: %v", err)
	}
	fields, err := r.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	want := []CSVField{
		{Value: "a"},
		{Value: ""},
		{Value: "", Quoted: true},
		{Value: `  "x" `},
		{Value: "y", Quoted: true},
	}
	if fmt.Sprintf("%#v", fields) != fmt.Sprintf("%#v", want) {
		t.Errorf("fields = %#v, want %#v", fields, want)
	}
}
