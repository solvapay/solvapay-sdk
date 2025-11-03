# Checkout Flow Documentation

This document describes the checkout flow implementation for copying to another example project. It covers the plan selection layout, functionality, navigation, styling, and file references.

## Overview

The checkout flow consists of two main views:
1. **Plan Selection View** - Allows users to select between PRO and ENTERPRISE plans
2. **Payment Confirmation View** - Shows payment summary and allows confirmation (note: actual card input is NOT rendered in this example)

## File Structure

```
src/app/checkout/
├── page.tsx                    # Main checkout page with plan selection and payment confirmation
└── complete/
    └── page.tsx                # Checkout completion page

src/app/api/checkout/
└── complete/
    └── route.ts                # API route that processes checkout completion

src/app/
├── layout.tsx                  # Root layout with navigation (hidden during checkout)
└── globals.css                 # Tailwind CSS imports
```

## Key Files to Copy

### 1. Main Checkout Page (`src/app/checkout/page.tsx`)

**Purpose:** Handles plan selection and payment confirmation UI

**Key Features:**
- Plan selection with radio button interface
- View state management (`'plan' | 'payment-confirmation'`)
- URL parameter handling (`plan`, `return_url`, `user_id`, `customer_ref`)
- Navigation hiding via inline styles
- Loading states and error handling
- Close button that redirects to `return_url`

**Key Components:**
- `renderPlanView()` - Displays plan selection UI
- `renderPaymentConfirmation()` - Displays payment summary and confirmation

### 2. Checkout Completion Page (`src/app/checkout/complete/page.tsx`)

**Purpose:** Shows success/error state after payment processing

**Note:** This is optional if you already have a completion page in your target app.

### 3. API Route (`src/app/api/checkout/complete/route.ts`)

**Purpose:** Processes checkout completion server-side

**Note:** Adapt this to your backend implementation. This example handles OAuth authentication and updates user plans.

## Styling

### Tailwind CSS Configuration

The project uses Tailwind CSS for styling. Ensure your target project has:

1. **Tailwind Config** (`tailwind.config.js`):
```javascript
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

2. **Global CSS** (`src/app/globals.css`):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

3. **Dependencies** (from `package.json`):
- `tailwindcss`: `^3.4.0`
- `autoprefixer`: `^10.4.16`
- `postcss`: `^8.4.32`

### Navigation Hiding

The checkout page hides the main navigation using inline styles injected via `useEffect`:

```typescript
const style = document.createElement('style')
style.textContent = `
  body > div:first-child > nav,
  body > div:first-child > header,
  nav, header, .min-h-screen > nav {
    display: none !important;
  }
  body > div:first-child > main {
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
  }
  body {
    background: #fafafa !important;
  }
`
document.head.appendChild(style)
```

**Note:** Adapt the selectors based on your target app's layout structure.

## Layout Structure

### Container Layout

The checkout page uses a fixed overlay layout:

```tsx
<div className="fixed inset-0 bg-gray-50 z-50 overflow-y-auto">
  <div className="max-w-md mx-auto py-10 px-5 relative font-sans">
    {/* Content */}
  </div>
</div>
```

### Plan Selection View Layout

```tsx
<div className="bg-white border border-gray-200 rounded-lg p-8">
  {/* Plan Selection Grid */}
  <div className="grid grid-cols-1 gap-4">
    {/* Plan Options */}
  </div>
  
  {/* Selected Plan Summary */}
  <div className="border-b border-gray-100 pb-6 mb-6">
    {/* Plan Name and Price */}
  </div>
  
  {/* Plan Features List */}
  <div className="mb-8">
    {/* Feature Items with Checkmarks */}
  </div>
  
  {/* Error Display */}
  {/* Upgrade Button */}
</div>
```

### Payment Confirmation View Layout

```tsx
<div className="bg-white border border-gray-200 rounded-lg p-8">
  {/* Plan Summary */}
  <div className="border-b border-gray-100 pb-6 mb-6">
    {/* Plan Name and Price */}
  </div>
  
  {/* Payment Details */}
  <div className="mb-8">
    {/* Plan, Amount, Billing, Payment Method */}
  </div>
  
  {/* Error Display */}
  {/* Confirm Payment Button */}
  {/* Back to Plan Button */}
</div>
```

## Plan Selection Functionality

### Plan Data Structure

```typescript
const planFeatures = {
  pro: {
    name: 'PRO Plan',
    price: 29,
    features: [
      'Unlimited API calls',
      'Priority support',
      'Advanced analytics',
      'Custom integrations'
    ]
  },
  enterprise: {
    name: 'ENTERPRISE Plan',
    price: 99,
    features: [
      'Everything in Pro',
      'Dedicated support',
      'Custom SLA',
      'On-premise deployment'
    ]
  }
}
```

### Plan Selection UI

- **Radio Button Style**: Visual radio buttons using custom styled divs
- **Selection State**: Highlighted border (`border-blue-500 bg-blue-50`) when selected
- **Click Handler**: `onClick={() => setPlan(planKey)}` updates selected plan
- **Visual Indicator**: Circular radio button with filled state when selected

### Plan Features Display

- Uses SVG checkmark icons (green color)
- Features listed vertically with spacing
- Responsive text sizing

## Navigation Flow

### View State Management

```typescript
const [view, setView] = useState<'plan' | 'payment-confirmation'>('plan')
```

### Navigation Transitions

1. **Plan Selection → Payment Confirmation**
   - Triggered by clicking "Upgrade to {Plan Name}" button
   - Calls `handleUpgrade()` which simulates processing delay
   - Sets `view` to `'payment-confirmation'`

2. **Payment Confirmation → Plan Selection**
   - Triggered by clicking "← Back to Plan" button
   - Directly sets `view` back to `'plan'`

3. **Close Button**
   - Always visible in top-right corner
   - Redirects to `return_url` if provided
   - Falls back to `window.close()` if no return URL

### URL Parameters

The checkout page reads and handles these URL parameters:

- `plan` - Pre-selects a plan (`'pro'` or `'enterprise'`)
- `return_url` - URL to redirect to when closing checkout
- `user_id` - User identifier (read but not currently used in UI)
- `customer_ref` - Customer reference (passed to completion API)

## Styling Details

### Color Scheme

- **Background**: `bg-gray-50` for page background, `bg-white` for cards
- **Primary Actions**: `bg-gray-900` with `hover:bg-gray-700`
- **Secondary Actions**: `bg-transparent` with gray border
- **Selected State**: `border-blue-500 bg-blue-50`
- **Error State**: `bg-red-50 border-red-200 text-red-700`
- **Success Elements**: Green checkmarks (`text-green-500`)

### Typography

- **Page Title**: `text-3xl font-semibold text-gray-900`
- **Section Title**: `text-xl font-semibold text-gray-900`
- **Plan Name**: `text-lg font-semibold` or `text-xl font-semibold`
- **Price**: `text-3xl font-bold text-gray-900` with `text-base text-gray-600` for "/month"
- **Body Text**: `text-base text-gray-600` or `text-sm text-gray-700`

### Spacing

- **Container Padding**: `p-8` for main content cards
- **Section Spacing**: `mb-6`, `mb-8` for vertical spacing
- **Grid Gap**: `gap-4` for plan selection grid
- **Button Padding**: `py-4` for primary buttons

### Border Radius

- **Cards**: `rounded-lg`
- **Buttons**: `rounded-md`
- **Plan Items**: `rounded-lg`

### Interactive States

- **Hover**: `hover:border-gray-300`, `hover:bg-gray-50`, `hover:text-gray-700`
- **Disabled**: `disabled:bg-gray-300 disabled:cursor-not-allowed`
- **Loading**: Spinner animation with `animate-spin`

## Important Notes

### Card Input Not Included

**This example does NOT render actual card input fields.** The payment confirmation view shows a demo payment method:

```tsx
<span className="text-gray-900 font-medium">Demo Credit Card ending in 4242</span>
```

When copying to your target app, **keep your existing card input implementation** and integrate it into the payment confirmation view.

### State Management

- Uses React `useState` for local state
- No external state management library required
- View state is simple (`'plan' | 'payment-confirmation'`)

### Loading States

- Loading state shows spinner and "Processing..." text
- Buttons are disabled during loading
- Loading state is reset after navigation or error

### Error Handling

- Errors displayed in red alert boxes
- Error state cleared when retrying actions
- Error messages shown above action buttons

## Integration Steps

1. **Copy Core Files**
   - Copy `src/app/checkout/page.tsx` to your target app
   - Adapt the navigation hiding selectors to match your layout
   - Update plan data structure if needed

2. **Update Styling**
   - Ensure Tailwind CSS is configured
   - Adjust color scheme if needed
   - Update container selectors for navigation hiding

3. **Integrate Card Input**
   - Keep your existing card input component
   - Add it to the payment confirmation view (replace the demo payment method line)
   - Connect it to your payment processing logic

4. **Update Navigation**
   - Adjust `return_url` handling to match your app's routing
   - Update close button behavior if needed
   - Ensure URL parameter handling matches your API expectations

5. **Update API Integration**
   - Modify `handleConfirmPayment()` to call your payment API
   - Update the completion flow to match your backend
   - Ensure `customer_ref` or user identification is properly handled

6. **Test Flow**
   - Test plan selection and navigation
   - Test loading states
   - Test error handling
   - Test close button and return URL redirect

## Example Usage

### URL Parameters

```
/checkout?plan=pro&return_url=/dashboard&user_id=user123&customer_ref=cust456
```

### State Flow

1. User lands on `/checkout` → Plan Selection View
2. User selects plan → Plan highlights, summary updates
3. User clicks "Upgrade to {Plan}" → Loading → Payment Confirmation View
4. User reviews details → Can go back or confirm
5. User clicks "Confirm Payment" → Loading → Redirects to completion/API route
6. User clicks close/X → Redirects to `return_url` or closes window

## Dependencies

Ensure these dependencies are available:

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "typescript": "^5.5.4"
  }
}
```

## Customization Points

1. **Plan Data**: Modify `planFeatures` object to match your plans
2. **Colors**: Update Tailwind classes to match your brand
3. **Layout**: Adjust container width (`max-w-md`) and spacing
4. **Typography**: Modify font sizes and weights
5. **Features Display**: Customize feature list rendering
6. **Button Text**: Update button labels and copy
7. **Navigation Hiding**: Adjust CSS selectors for your layout structure

