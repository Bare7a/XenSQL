package appmenu

import "testing"

func TestParseStatesDecodesGenericPayload(t *testing.T) {
	payload := []any{
		map[string]any{"id": "toggleSidebar", "label": "Toggle Sidebar", "checked": true, "accelerator": "cmdorctrl+b"},
		map[string]any{"id": "zoomIn", "enabled": false},
	}
	states, err := ParseStates(payload)
	if err != nil {
		t.Fatalf("ParseStates: %v", err)
	}
	if len(states) != 2 {
		t.Fatalf("len = %d, want 2", len(states))
	}
	if states[0].ID != "toggleSidebar" || states[0].Checked == nil || !*states[0].Checked || states[0].Accelerator != "cmdorctrl+b" {
		t.Fatalf("state[0] = %+v", states[0])
	}
	if states[1].Enabled == nil || *states[1].Enabled {
		t.Fatalf("state[1] = %+v", states[1])
	}
	if states[0].Enabled != nil || states[1].Checked != nil {
		t.Fatalf("unset fields must stay nil: %+v %+v", states[0], states[1])
	}
}

func TestParseStatesRejectsNonArray(t *testing.T) {
	if _, err := ParseStates(map[string]any{"id": "x"}); err == nil {
		t.Fatal("want error for non-array payload")
	}
}
