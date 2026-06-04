package database

import "context"

type connIDKey struct{}

type queryRegistryKey struct{}

func WithConnectionID(ctx context.Context, connectionID string) context.Context {
	return context.WithValue(ctx, connIDKey{}, connectionID)
}

func WithQueryRegistry(ctx context.Context, r *QueryRegistry) context.Context {
	return context.WithValue(ctx, queryRegistryKey{}, r)
}

func ConnectionIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(connIDKey{}).(string)
	return id, ok && id != ""
}

func QueryRegistryFromContext(ctx context.Context) *QueryRegistry {
	r, _ := ctx.Value(queryRegistryKey{}).(*QueryRegistry)
	return r
}
