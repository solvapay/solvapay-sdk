# @solvapay/demo-services

**Internal Package - Not Published to npm**

This package contains shared demo services used across SolvaPay SDK examples and integration tests.

## Purpose

Provides reusable business logic for demonstrating paywall protection patterns in examples and testing SDK functionality with realistic scenarios.

## Contents

### Tasks Service

A simple in-memory CRUD service for task management that demonstrates paywall-protected operations.

**Features:**
- In-memory task storage
- CRUD operations (Create, Read, List, Delete)
- Paywall integration via `auth` parameter
- Task completion tracking

**Usage:**

```typescript
import { createTask, getTask, listTasks, deleteTask, clearAllTasks } from '@solvapay/demo-services';

// Create a task
const result = await createTask({
  title: 'My Task',
  description: 'Task description',
  auth: { customer_ref: 'user_123' }
});

// List tasks
const tasks = await listTasks({
  limit: 10,
  offset: 0,
  auth: { customer_ref: 'user_123' }
});

// Clear all tasks (useful for tests)
clearAllTasks();
```

## Used By

- **SDK Integration Tests**: Tests SDK paywall protection with real backend
- **Examples**: Demonstrates SDK usage in different frameworks (Express, Next.js, etc.)

## Development

This package is for internal use only:
- ✅ Private package (not published)
- ✅ Used as workspace dependency
- ✅ Source files imported directly (no build step)

## Adding New Demo Services

When adding new demo services:

1. Create the service in `src/`
2. Export from `src/index.ts`
3. Update this README with usage documentation
4. Ensure service follows the auth pattern (accepts `auth?: { customer_ref?: string }`)

