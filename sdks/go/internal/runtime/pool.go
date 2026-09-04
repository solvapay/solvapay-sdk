package runtime

import (
	"context"
	"sync"
)

// pool is a demand-grown, bounded pool of guest instances.
//
// The buffered `sem` channel caps the number of instances in circulation
// (in-use + idle) at `max`; borrowers block on it when the pool is saturated.
// Instances are created lazily on first borrow and reused via the `idle` stack.
type pool struct {
	sem     chan struct{}
	newInst func(context.Context) (*instance, error)

	mu   sync.Mutex
	idle []*instance
}

func newPool(max int, newInst func(context.Context) (*instance, error)) *pool {
	return &pool{
		sem:     make(chan struct{}, max),
		newInst: newInst,
	}
}

// borrow returns a ready instance, creating one on demand up to the bound, and
// blocking when the pool is at capacity until a slot frees or ctx is cancelled.
func (p *pool) borrow(ctx context.Context) (*instance, error) {
	select {
	case p.sem <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	p.mu.Lock()
	if n := len(p.idle); n > 0 {
		inst := p.idle[n-1]
		p.idle = p.idle[:n-1]
		p.mu.Unlock()
		return inst, nil
	}
	p.mu.Unlock()

	inst, err := p.newInst(ctx)
	if err != nil {
		<-p.sem // release the slot we reserved
		return nil, err
	}
	return inst, nil
}

// release returns a clean instance to the idle stack and frees its slot.
func (p *pool) release(inst *instance) {
	p.mu.Lock()
	p.idle = append(p.idle, inst)
	p.mu.Unlock()
	<-p.sem
}

// discard closes a dirty / cancelled instance and frees its slot without reuse.
func (p *pool) discard(ctx context.Context, inst *instance) {
	inst.close(ctx)
	<-p.sem
}

// closeAll tears down every idle instance (in-use ones close with the runtime).
func (p *pool) closeAll(ctx context.Context) {
	p.mu.Lock()
	idle := p.idle
	p.idle = nil
	p.mu.Unlock()
	for _, inst := range idle {
		inst.close(ctx)
	}
}
