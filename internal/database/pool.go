package database

import (
	"context"
	"fmt"
	"sync"
)

// Per-ID flight locks prevent duplicate sessions when concurrent Connect calls race on a cold cache.
type Pool struct {
	mu           sync.RWMutex
	sessions     map[string]Session
	fingerprints map[string]string
	flight       sync.Map // id -> *sync.Mutex
}

func NewPool() *Pool {
	return &Pool{
		sessions:     make(map[string]Session),
		fingerprints: make(map[string]string),
	}
}

func (p *Pool) Connect(ctx context.Context, cfg ConnectionConfig) error {
	driver, err := GetDriver(cfg.Driver)
	if err != nil {
		return err
	}
	fp := ConfigFingerprint(cfg)

	mu, _ := p.flight.LoadOrStore(cfg.ID, &sync.Mutex{})
	flight := mu.(*sync.Mutex)
	flight.Lock()
	defer flight.Unlock()

	if existing, ok := p.snapshotSession(cfg.ID); ok {
		if existing.fingerprint == fp {
			return nil
		}
		// Remove before close so concurrent Session() callers error on the next op rather than using a closing session.
		p.removeSession(cfg.ID)
		_ = existing.session.Close()
	}

	session, err := driver.Connect(ctx, cfg)
	if err != nil {
		return err
	}
	p.storeSession(cfg.ID, session, fp)
	return nil
}

type pooledSession struct {
	session     Session
	fingerprint string
}

func (p *Pool) snapshotSession(id string) (pooledSession, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	s, ok := p.sessions[id]
	if !ok {
		return pooledSession{}, false
	}
	return pooledSession{session: s, fingerprint: p.fingerprints[id]}, true
}

func (p *Pool) removeSession(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.sessions, id)
	delete(p.fingerprints, id)
}

func (p *Pool) storeSession(id string, s Session, fingerprint string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sessions[id] = s
	p.fingerprints[id] = fingerprint
}

func (p *Pool) Disconnect(id string) {
	p.mu.Lock()
	s, ok := p.sessions[id]
	if ok {
		delete(p.sessions, id)
	}
	delete(p.fingerprints, id)
	p.mu.Unlock()
	if ok {
		_ = s.Close()
	}
	// Keep the per-ID flight mutex: deleting it here races an in-flight Connect.
	// Bounded by connection count and cleared in CloseAll.
}

func (p *Pool) Session(id string) (Session, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	s, ok := p.sessions[id]
	if !ok {
		return nil, fmt.Errorf("not connected: %s", id)
	}
	return s, nil
}

func (p *Pool) IsConnected(id string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	_, ok := p.sessions[id]
	return ok
}

func (p *Pool) CloseAll() {
	p.mu.Lock()
	sessions := p.sessions
	p.sessions = make(map[string]Session)
	p.fingerprints = make(map[string]string)
	p.mu.Unlock()
	for _, s := range sessions {
		_ = s.Close()
	}
	p.flight.Range(func(k, _ any) bool {
		p.flight.Delete(k)
		return true
	})
}
