# Test Directory

This directory contains simplified tests for the Next.js OpenAI Custom GPT Actions example.

## 📁 Structure

```
src/__tests__/
├── ui/                    # Frontend/UI tests (3 files)
│   ├── basic-ui.test.tsx         # Basic component rendering tests  
│   ├── home.test.tsx             # Home page tests
│   ├── integration.test.tsx      # User flow integration tests
│   └── simple-render.test.tsx    # Simple component render tests
└── backend/              # Backend/API tests (11 files)
    ├── api.test.ts               # API endpoint tests
    ├── basic.test.ts             # Basic API functionality tests
    ├── checkout.test.ts          # Checkout flow tests
    ├── oauth.test.ts             # OAuth flow tests (blue sky only)
    ├── paywall.test.ts           # Paywall configuration tests
    ├── services.test.ts          # Service layer tests
    ├── tasks.test.ts             # Task CRUD operations tests
    ├── user-plans.test.ts        # User plan management tests (blue sky only)
    ├── integration.test.ts       # Backend integration tests (blue sky only)
    ├── signout.test.ts           # Sign out endpoint tests (blue sky only)
    └── test-utils.ts             # Shared test utilities
```

## 🚀 Running Tests

### All Tests
```bash
npm test
```

### Backend Tests Only
```bash
npm run test:backend
```

### UI Tests Only  
```bash
npm run test:ui-components
```

### Watch Mode
```bash
npm run test:watch
```

## ✅ Test Coverage

### Backend Tests
- **Task CRUD Operations**: Create, list, get, and delete tasks
- **OAuth Flow**: Authorization, token exchange (successful flows)
- **User Plans**: Get and update user plans (successful flows)
- **Integration**: Complete user journey from task CRUD operations
- **Services**: API client and demo service functionality

### UI Tests
- **Component Rendering**: Basic rendering of main pages
- **User Interactions**: Button clicks and form submissions (successful flows)
- **Integration Flows**: OAuth, checkout, and API testing flows

## 🔧 Test Configuration

- **Framework**: Vitest with React Testing Library
- **Environment**: jsdom for UI tests, node for backend tests  
- **Mocking**: Next.js navigation hooks and fetch API
- **Focus**: Blue sky scenarios (happy paths) only
- **Service**: Uses `@solvapay/demo-services` for task management

## 💡 Notes

- Tests focus on blue sky scenarios (successful operations only)
- Error handling and edge cases are not tested in this example
- Tests use pro plan users to avoid paywall limits
- "Things" have been replaced with "Tasks" using the demo-services package
- OAuth tests use mocked search params to handle Next.js router requirements